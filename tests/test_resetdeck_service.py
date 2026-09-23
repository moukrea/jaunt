import base64,os,shlex
from types import SimpleNamespace
import pytest
from jaunt.agents import Policy,Approvals,Executor,requester_key
from jaunt.daemon import Host
from jaunt.state import State

PY,AGENT='/usr/bin/python3','/opt/resetdeck/remote_agent.py'

def exchange(payload=b'{}',python=PY,agent=AGENT):
    return shlex.join([python,agent,'exchange',base64.b64encode(payload).decode()])

def service_host(tmp_path,approve='once'):
    """A Host reduced to what agent_run/agent_read touch, with a real policy, journal and executor."""
    state=State(tmp_path);state.data.setdefault('name','homelab');state.data['devices']={'host-a':{'kind':'host','name':'laptop'}};state.save()
    policy=Policy(state);policy.set_feature('exec',True)
    h=SimpleNamespace(state=state,policy=policy,run_owners={},asked=[])
    for name in ('SERVICES','COLLECTOR_PAYLOAD','RUNTIME_NAMES','REFUSAL','FEATURE_NAMES','SERVICE_PEER_METHODS'):setattr(h,name,getattr(Host,name))
    h.collector_rule=Host.collector_rule
    for name in ('_require','_requester_of','_authorize','agent_run','agent_read'):setattr(h,name,getattr(Host,name).__get__(h))
    async def ask(requester,right,kind,detail):h.asked.append(detail);return approve
    h.approvals=SimpleNamespace(ask=ask)
    async def run(key,command,cwd,timeout):
        result={'run':'r_'+os.urandom(6).hex(),'status':'ok','exitCode':0,'bytes':0,'command':command}
        (tmp_path/(result['run']+'.log')).write_bytes(b'RESETDECK_PACKET=x')
        return result
    def read(run,offset,limit):return {'run':run,'data':'eA=='}
    h.executor=SimpleNamespace(run=run,read=read)
    return h

PEER=SimpleNamespace(device_id='host-a',is_host=True)

def test_service_has_distinct_identity_and_still_requires_enabled_policy():
    h=SimpleNamespace(policy=SimpleNamespace(enabled=True),RUNTIME_NAMES=Host.RUNTIME_NAMES,SERVICES=Host.SERVICES)
    assert Host._caller(h,{'runtime':'resetdeck','service':'resetdeck'})==('service:resetdeck','resetdeck')
    with pytest.raises(ValueError):Host._caller(h,{'runtime':'resetdeck'})
    h.policy.enabled=False
    with pytest.raises(ValueError):Host._caller(h,{'runtime':'resetdeck','service':'resetdeck'})

def test_status_announces_the_service_apart_from_the_switches(tmp_path):
    state=State(tmp_path);policy=Policy(state)
    h=SimpleNamespace(SERVICES=Host.SERVICES,policy=policy,links=SimpleNamespace(list=lambda:[]),approvals=SimpleNamespace(list=lambda:[]),agent_shells=SimpleNamespace(list=lambda:[]))
    status=Host.agents_status(h)
    assert status['services']==['resetdeck'] and 'resetdeck' not in status['features']

@pytest.mark.asyncio
async def test_service_cannot_type_or_open_shells():
    h=SimpleNamespace(_caller=lambda p:('service:resetdeck','resetdeck'),SERVICES=Host.SERVICES,SERVICE_METHODS=Host.SERVICE_METHODS)
    for method in ('agents.type','agents.shell','agents.output','agents.sessions'):
        with pytest.raises(ValueError):await Host.agents_gateway(h,method,{})

@pytest.mark.asyncio
async def test_receiving_host_refuses_other_methods_even_when_trusted(tmp_path):
    """A linked host (older, or not playing along) asking in ResetDeck's name gets no shell, typing or messages here."""
    h=service_host(tmp_path)
    key=requester_key('host-a','resetdeck');h.policy.requester(key,name='laptop · ResetDeck');h.policy.set_level(key,'exec','trust','always')
    h.stopping=SimpleNamespace(is_set=lambda:False);h.reexec=False
    for method in ('agent.shell','agent.sessions','agent.type','agent.output','agent.peers','agent.message'):
        with pytest.raises(ValueError,match='collector'):await Host.rpc(h,PEER,method,{'runtime':'resetdeck','action':'open'})

@pytest.mark.asyncio
async def test_collector_rule_cannot_be_used_for_shell_injection(tmp_path):
    h=service_host(tmp_path)
    for command in (exchange()+';id',PY+' '+AGENT+' exchange $(id)',PY+' '+AGENT+' shell QQ==','python3 '+AGENT+' exchange QQ==',
                    exchange()+' extra','"'+PY+'" '+AGENT+' exchange QQ==',PY+' '+AGENT+' exchange '+'A'*200_004,PY+" '"):
        with pytest.raises(ValueError,match='collector exchange'):await h.agent_run(PEER,{'runtime':'resetdeck','command':command})
    assert not h.asked,'refused before any approval is asked'

@pytest.mark.asyncio
async def test_always_allow_covers_future_exchanges_of_the_same_collector_only(tmp_path):
    h=service_host(tmp_path,approve='rule')
    long_payload=exchange(os.urandom(3000))
    assert len(long_payload)>200
    first=await h.agent_run(PEER,{'runtime':'resetdeck','command':long_payload})
    assert first['status']=='ok' and len(h.asked)==1 and h.asked[0]['summary']=='ResetDeck collector exchange · '+AGENT
    key=requester_key('host-a','resetdeck')
    assert h.policy.rules(key)==[PY+' '+AGENT+' exchange *']
    await h.agent_run(PEER,{'runtime':'resetdeck','command':exchange(b'next cycle')})
    assert len(h.asked)==1,'the next payload of the same pair runs under the rule'
    for other in (exchange(python='/usr/bin/python3.12'),exchange(agent='/tmp/evil.py')):
        await h.agent_run(PEER,{'runtime':'resetdeck','command':other})
    assert len(h.asked)==3,'another interpreter or agent asks again'

def test_glob_characters_in_paths_stay_literal():
    rule=Host.collector_rule(exchange(agent='/opt/rd[1]/a*.py'))
    import fnmatch
    assert fnmatch.fnmatchcase(exchange(b'x',agent='/opt/rd[1]/a*.py'),rule)
    assert not fnmatch.fnmatchcase(exchange(b'x',agent='/opt/rd1/abc.py'),rule)
    assert not fnmatch.fnmatchcase(exchange(b'x',agent='/opt/rd[1]/aXYZ.py'),rule)

@pytest.mark.asyncio
async def test_an_overlong_collector_prefix_runs_once_without_a_wider_rule(tmp_path):
    h=service_host(tmp_path,approve='rule')
    agent='/opt/'+'d'*220+'/remote_agent.py'
    result=await h.agent_run(PEER,{'runtime':'resetdeck','command':exchange(agent=agent)})
    key=requester_key('host-a','resetdeck')
    assert result['status']=='ok' and h.policy.rules(key)==[]
    assert h.policy.data['log'][-2]['kind']=='rule' and h.policy.data['log'][-2]['reason']=='longer than 200 characters'

@pytest.mark.asyncio
async def test_service_reads_only_its_own_runs(tmp_path):
    h=service_host(tmp_path)
    mine=await h.agent_run(PEER,{'runtime':'resetdeck','command':exchange()})
    assert h.agent_read(PEER,{'runtime':'resetdeck','run':mine['run']})['run']==mine['run']
    with pytest.raises(ValueError):h.agent_read(PEER,{'runtime':'resetdeck','run':'r_someoneelse'})
    other=SimpleNamespace(device_id='host-b',is_host=True);h.state.data['devices']['host-b']={'kind':'host','name':'desk'}
    with pytest.raises(ValueError):h.agent_read(other,{'runtime':'resetdeck','run':mine['run']})
