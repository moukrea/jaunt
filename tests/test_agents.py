import asyncio,json,os,time
import pytest
from pathlib import Path
from jaunt.agents import Policy,Approvals,Executor,requester_key,INLINE_BYTES,PER_MINUTE
from jaunt.state import State

class FakeHost:
    def __init__(self,state):self.state=state;self.events=[];self.notifications=[]
    async def broadcast(self,value):self.events.append(value)
    async def notify(self,title,body,session,only=""):self.notifications.append((title,body));return {}

def test_policy_levels_expiry_and_revocation(tmp_path):
    state=State(tmp_path);policy=Policy(state)
    key=requester_key('host-abc','claude')
    assert policy.level(key,'exec')=='ask','unknown requesters ask'
    policy.requester(key,name='laptop · Claude Code',runtime='claude',host='host-abc')
    row=policy.set_level(key,'exec','trust','1h');assert row['exec']['level']=='trust' and row['exec']['until']>time.time()+3500
    assert policy.level(key,'type')=='ask','rights are independent'
    policy.set_level(key,'type','block');assert policy.level(key,'type')=='block'
    # An expired trust falls back to ask, and the change is persisted.
    state.data['agents']['requesters'][key]['exec']['until']=time.time()-1
    assert policy.level(key,'exec')=='ask' and json.loads((tmp_path/'host.json').read_text())['agents']['requesters'][key]['exec']['level']=='ask'
    policy.set_level(key,'exec','trust','always');assert policy.public_row(key)['exec']=={'level':'trust','until':None}
    with pytest.raises(ValueError):policy.set_level(key,'exec','trust','2d')
    with pytest.raises(ValueError):policy.set_level('nobody:codex','exec','block')
    policy.grants[(key,'shell-1')]=time.time();policy.revoke([key])
    assert key not in policy.data['requesters'] and not policy.grants
    entry=policy.journal(kind='run',requester=key,command='ls');assert entry['id'] and policy.data['log'][-1]['command']=='ls'

@pytest.mark.asyncio
async def test_approvals_first_answer_wins_and_timeout(tmp_path,monkeypatch):
    monkeypatch.setattr('jaunt.agents.APPROVAL_SECONDS',1)
    host=FakeHost(State(tmp_path));approvals=Approvals(host)
    requester={'id':'host-abc:claude','name':'laptop · Claude Code'}
    task=asyncio.create_task(approvals.ask(requester,'exec','run',{'summary':'docker ps','command':'docker ps'}))
    await asyncio.sleep(.05)
    pending=approvals.list();assert len(pending)==1 and pending[0]['detail']['command']=='docker ps' and 'future' not in pending[0]
    assert host.events[0]['type']=='agent.approval' and host.notifications
    approvals.decide(pending[0]['id'],'1h',by='phone')
    with pytest.raises(ValueError):approvals.decide(pending[0]['id'],'deny',by='desktop')
    assert await task=='1h' and host.events[-1]=={'type':'agent.approval.closed','id':pending[0]['id']}
    assert await approvals.ask(requester,'exec','run',{'summary':'x'})=='deny','no answer within the deadline denies'
    with pytest.raises(ValueError):approvals.decide('nope','once')

@pytest.mark.asyncio
async def test_executor_bounds_truncation_log_and_rate(tmp_path,monkeypatch):
    monkeypatch.setenv('SHELL','/bin/sh')
    state=State(tmp_path);executor=Executor(tmp_path,Policy(state))
    result=await executor.run('host-a:claude',"echo hello; echo oops >&2; exit 3",None,None)
    assert result['status']=='ok' and result['exitCode']==3 and result['stdout']=='hello\n' and result['stderr']=='oops\n' and not result['truncated']
    assert (tmp_path/'agent-runs'/(result['run']+'.log')).stat().st_size==len('hello\noops\n')
    big=await executor.run('host-a:claude',"head -c 300000 /dev/zero | tr '\\0' x",None,None)
    assert big['truncated'] and big['bytes']==300000 and len(big['stdout'])==INLINE_BYTES
    chunk=executor.read(big['run'],offset=299990,limit=100);assert chunk['eof'] and len(__import__('jaunt.crypto',fromlist=['unb64']).unb64(chunk['data']))==10
    with pytest.raises(ValueError):executor.read('../host.json')
    slow=await executor.run('host-a:claude',"echo start; sleep 5; echo never",None,1)
    assert slow['status']=='timeout' and slow['exitCode'] is None and slow['stdout'].startswith('start') and slow['durationMs']<4000
    with pytest.raises(ValueError):await executor.run('host-a:claude','ls',str(tmp_path/'missing'),None)
    for _ in range(PER_MINUTE):executor._rate('host-b:codex')
    with pytest.raises(ValueError):executor._rate('host-b:codex')
    # A run in progress blocks a second one for the same requester, not for another.
    running=asyncio.create_task(executor.run('host-c:claude','sleep 1',None,None));await asyncio.sleep(.1)
    with pytest.raises(ValueError):await executor.run('host-c:claude','true',None,None)
    assert (await executor.run('host-d:claude','true',None,None))['exitCode']==0
    await running
    # Old logs are swept.
    old=tmp_path/'agent-runs'/'r_old.log';old.write_bytes(b'x');os.utime(old,(time.time()-90000,)*2);executor.sweep();assert not old.exists()

@pytest.mark.asyncio
async def test_agent_shells_lease_caps_and_kill(tmp_path,monkeypatch):
    from jaunt import agents
    from jaunt.crypto import unb64
    monkeypatch.setenv('SHELL','/bin/sh');monkeypatch.setattr(agents,'LEASE_SECONDS',2);monkeypatch.setattr(agents,'ORPHAN_GRACE',1)
    journal=[];shells=agents.AgentShells(tmp_path,lambda **e:journal.append(e))
    try:
        s=await shells.open('host-a:claude','laptop · Claude Code','sess-1',str(tmp_path))
        assert s.alive and (tmp_path/'agent-runs'/(s.id+'.log')).exists() and journal[-1]['action']=='open'
        shells.send(s,'cd / && export MARK=leased && echo start-$MARK-end')
        for _ in range(100):
            await asyncio.sleep(.05)
            text=unb64(shells.read(s,0,65536)['data']).decode()
            if 'start-leased-end' in text:break
        else:pytest.fail('agent shell produced no output: '+text[-200:])
        assert shells.read(s,0,10)['bytes']==s.offset and not shells.read(s,0,65536)['eof'] is None
        # Caps: two per requester, eight per host.
        await shells.open('host-a:claude','x','sess-1',None)
        with pytest.raises(ValueError):await shells.open('host-a:claude','x','sess-1',None)
        # Wrong requester cannot touch it.
        with pytest.raises(ValueError):shells.get(s.id,'host-b:codex')
        # kill_for and kill_origin.
        await shells.kill_for('host-a:claude','test');assert not shells.items and journal[-1]['action']=='closed'
        t=await shells.open('host-a:claude','x','sess-9',None);await shells.kill_origin('host-a','sess-9','origin gone');assert not shells.items
        # Lease expiry and orphan grace are enforced by the sweeper.
        u=await shells.open('host-a:claude','x','sess-2',None);await asyncio.sleep(0)
        u.last_used=time.time()-10
        for _ in range(140):
            await asyncio.sleep(.1)
            if u.id not in shells.items:break
        else:pytest.fail('lease expiry did not kill the shell')
        assert journal[-1]['reason']=='lease expired'
        monkeypatch.setattr(agents,'LEASE_SECONDS',30)
        v=await shells.open('host-a:claude','x','sess-3',None);shells.mark_orphans('host-a',True)
        for _ in range(140):
            await asyncio.sleep(.1)
            if v.id not in shells.items:break
        else:pytest.fail('orphan grace did not kill the shell')
        assert journal[-1]['reason']=='requesting host disconnected'
        w=await shells.open('host-a:claude','x','sess-4',None);shells.mark_orphans('host-a',True);shells.mark_orphans('host-a',False);await asyncio.sleep(1.5);assert w.id in shells.items,'a host that came back keeps its shells'
        shells.send(w,'exit');
        for _ in range(100):
            await asyncio.sleep(.05)
            if w.id not in shells.items:break
        else:pytest.fail('an exited shell was not reaped')
    finally:await shells.shutdown()

@pytest.mark.asyncio
async def test_links_carry_label_and_icon(tmp_path):
    """The device's friendly name and icon for a machine are stored with the link and survive updates."""
    from jaunt.hostlink import Links
    from jaunt.crypto import b64
    state=State(tmp_path/'state.json');state.data.setdefault('links',{});state.save()
    links=Links(state,{'room':'me','name':'host: me'},None)
    record={'room':'other','relay':'wss://x','relayToken':b64(b'\0'*32),'pairId':'p','pairSecret':b64(b'\0'*32),'name':'homelab','deviceId':'host-x','added':0}
    links.records['other']=record
    Links.decorate(record,'Serveur',{'name':'server','nodes':[['path',{'d':'M0 0'}]],'junk':1})
    assert record['label']=='Serveur' and record['icon']=={'name':'server','nodes':[['path',{'d':'M0 0'}]]}
    await links.update('other','Serveur 2',None)
    assert record['label']=='Serveur 2' and 'icon' not in record
    Links.decorate(record,'',{'name':'big','nodes':[['path',{'d':'M'*9000}]]})
    assert 'icon' not in record and record['label']=='Serveur 2'
    assert links.get('serveur 2') is not None and links.get('homelab') is not None and links.get('nope') is None
    assert links.list()[0]['label']=='Serveur 2' and links.list()[0]['icon'] is None
    with pytest.raises(ValueError):await links.update('unknown','x',None)


def test_policy_shell_grants_and_cut(tmp_path):
    """Right `type`: one grant per requester × shell, dropped by cut, trust change, revoke or shell end."""
    state=State(tmp_path/'state.json');state.save();policy=Policy(state)
    k=requester_key('host-a','claude');policy.requester(k,name='a')
    assert policy.allowed_shell(k,'s1')=='ask'
    policy.grant(k,'s1');assert policy.allowed_shell(k,'s1')=='trust' and policy.allowed_shell(k,'s2')=='ask'
    assert policy.cut('s1')==[k] and policy.allowed_shell(k,'s1')=='ask'
    policy.set_level(k,'type','trust','always');assert policy.allowed_shell(k,'s2')=='trust' and policy.allowed_shell(k,'s1')=='ask','a cut shell asks again even for a trusted requester'
    policy.grant(k,'s1');assert policy.allowed_shell(k,'s1')=='trust' and 's1' not in policy.cuts
    policy.set_level(k,'type','ask');assert policy.allowed_shell(k,'s1')=='ask','lowering trust drops the grants'
    policy.grant(k,'s3');policy.forget_session('s3');assert not policy.granted(k,'s3')
    policy.grant(k,'s4');policy.revoke([k]);assert not policy.grants
    policy.requester(k,name='a');policy.set_level(k,'type','block');policy.grant(k,'s5');assert policy.allowed_shell(k,'s5')=='block'


def test_policy_rules_pre_approve_commands(tmp_path):
    """Allow-list: globs on the whole normalized command, capped, never * alone."""
    state=State(tmp_path/'state.json');state.save();policy=Policy(state)
    k=requester_key('host-a','claude');policy.requester(k,name='a')
    assert policy.matches(k,'git status') is None
    assert policy.add_rule(k,'git  status')==['git status'] and policy.matches(k,' git status ')=='git status' and policy.matches(k,'git status --short') is None
    policy.add_rule(k,'npm test *');assert policy.matches(k,'npm test -- --grep x')=='npm test *' and policy.matches(k,'npm testing') is None
    for bad in ('','*','x'*201):
        with pytest.raises(ValueError):policy.add_rule(k,bad)
    assert policy.remove_rule(k,'git status')==['npm test *'] and policy.public_row(k)['rules']==['npm test *']
    for i in range(49):policy.add_rule(k,f'cmd{i}')
    with pytest.raises(ValueError):policy.add_rule(k,'one-too-many')
    with pytest.raises(ValueError):policy.add_rule('nobody','ls')


def test_policy_features_migrate_and_switch(tmp_path):
    """The single switch of earlier versions becomes the three shell capabilities; messages stay off."""
    state=State(tmp_path/'state.json');state.data['agents']={'enabled':True,'requesters':{},'log':[]};state.save()
    policy=Policy(state);assert policy.features()=={'exec':True,'typeLocal':True,'typeRemote':True,'messages':False} and policy.enabled
    for f in ('exec','typeLocal','typeRemote'):policy.set_feature(f,False)
    assert not policy.enabled and not state.data['agents']['enabled']
    policy.set_feature('messages',True);assert policy.enabled and policy.feature('messages') and not policy.feature('exec')
    with pytest.raises(ValueError):policy.set_feature('nope',True)
    with pytest.raises(ValueError):policy.set_feature('exec','yes')
    fresh=Policy(State(tmp_path/'fresh.json'));assert not fresh.enabled and fresh.features()['messages'] is False
