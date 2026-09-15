import asyncio,json,os,sys,time
from pathlib import Path
import pytest,pytest_asyncio
from jaunt.daemon import Host
from jaunt.state import State
from jaunt import bridge as bridge_module
from jaunt.bridge import Bridge, Participant

class FakeSession:
    def __init__(self,id,name,pid,cwd,program='',alive=True):self.id,self.name,self.pid,self.cwd,self.program,self.alive=id,name,pid,cwd,program,alive

@pytest_asyncio.fixture
async def host(tmp_path,monkeypatch):
    h=Host(State(tmp_path));sent=[]
    async def broadcast(v):sent.append(v)
    h.broadcast=broadcast;h.sent=sent
    monkeypatch.setattr(Bridge,'_descends',staticmethod(lambda pid,anc:True))
    h.state.data['bridge']={'enabled':True};h.state.save()
    return h

def project(root,common=''):return {'root':root,'common':common,'kind':'git' if common else 'dir'}

async def register(h,session,runtime,conv,cwd,root=None,event='start',pid=4242,source='startup'):
    return await h.bridge.register({'runtime':runtime,'session':session,'conversation':conv,'pid':pid,'cwd':cwd,'event':event,'source':source,'project':project(root or cwd)})

@pytest.mark.asyncio
async def test_awareness_is_automatic_symmetric_and_project_scoped(host):
    h=host
    h.sessions.items={'s1':FakeSession('s1','Claude tab',100,'/work/x','claude'),'s2':FakeSession('s2','Codex tab',200,'/work/x/sub','codex'),'s3':FakeSession('s3','Other',300,'/work/y','codex')}
    first=await register(h,'s1','claude','claude-conv-000001','/work/x')
    assert first['enabled'] and 'No other AI session' in first['context']
    # Codex arrives later on a subdirectory of the same project: both sides learn about each other.
    second=await register(h,'s2','codex','codex-thread-00001','/work/x/sub','/work/x')
    assert 'Claude Code session in jaunt terminal "Claude tab"' in second['context'] and 'claude:claude-c' in second['context']
    again=await register(h,'s1','claude','claude-conv-000001','/work/x',event='prompt')
    assert 'Codex session in jaunt terminal "Codex tab"' in again['context']
    # Nothing changed: no roster re-injection on the next prompt (sober).
    assert (await register(h,'s1','claude','claude-conv-000001','/work/x',event='prompt'))['context']==''
    # A resume/compaction always gets the roster again.
    assert 'Codex session' in (await register(h,'s1','claude','claude-conv-000001','/work/x',event='compact'))['context']
    # A Codex session on an unrelated project is not a collaborator.
    other=await register(h,'s3','codex','codex-thread-00002','/work/y')
    assert 'No other AI session' in other['context']
    assert [p['id'] for p in h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['peers']]==['codex:codex-th']

@pytest.mark.asyncio
async def test_worktrees_of_one_repository_are_related(host):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/repo','claude'),'s2':FakeSession('s2','B',2,'/repo-wt','codex')}
    await h.bridge.register({'runtime':'claude','session':'s1','conversation':'claude-conv-000001','pid':1,'cwd':'/repo','event':'start','project':project('/repo','/repo/.git')})
    r=await h.bridge.register({'runtime':'codex','session':'s2','conversation':'codex-thread-00001','pid':2,'cwd':'/repo-wt','event':'start','project':project('/repo-wt','/repo/.git')})
    assert 'another worktree of the same repository' in r['context']

@pytest.mark.asyncio
async def test_replaced_conversation_never_receives_old_messages(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude'),'s2':FakeSession('s2','B',2,'/p','codex')}
    await register(h,'s1','claude','claude-conv-000001','/p');await register(h,'s2','codex','codex-thread-00001','/p')
    delivered=[]
    async def fake_deliver(bridge,sender,recipient,message):delivered.append((recipient.conversation,message['text']))
    monkeypatch.setattr('jaunt.bridge_deliver.deliver',fake_deliver)
    sent=await h.bridge.send({'runtime':'claude','session':'s1','conversation':'claude-conv-000001','to':'codex:codex-th','text':'hello codex'})
    assert sent['state']=='delivered' and delivered==[('codex-thread-00001','hello codex')]
    # /clear in the Codex terminal: a new thread id supersedes the old participant.
    await register(h,'s2','codex','codex-thread-00002','/p',source='clear')
    ids=[p['id'] for p in h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['peers']]
    assert ids==['codex:codex-th'] and h.bridge.participants['codex:codex-thread-00001'].state=='ended'
    with pytest.raises(ValueError,match='No live session'):
        await h.bridge.send({'runtime':'claude','session':'s1','conversation':'claude-conv-000001','to':'codex:codex-thread-00001','text':'late'})
    # The new thread is reachable; MCP tool calls without a conversation id resolve to it.
    resolved=h.bridge.resolve({'runtime':'codex','session':'s2','conversation':'current'})
    assert resolved['conversation']=='codex-thread-00002'

@pytest.mark.asyncio
async def test_reply_correlation_wait_and_loop_guard(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude'),'s2':FakeSession('s2','B',2,'/p','codex')}
    await register(h,'s1','claude','claude-conv-000001','/p');await register(h,'s2','codex','codex-thread-00001','/p')
    async def fake_deliver(bridge,sender,recipient,message):pass
    monkeypatch.setattr('jaunt.bridge_deliver.deliver',fake_deliver)
    me={'runtime':'claude','session':'s1','conversation':'claude-conv-000001'};them={'runtime':'codex','session':'s2','conversation':'codex-thread-00001'}
    sent=await h.bridge.send({**me,'to':'codex:codex-th','text':'question?'})
    waiter=asyncio.create_task(h.bridge.wait_reply({**me,'id':sent['id'],'seconds':5}))
    await asyncio.sleep(0.05)
    reply=await h.bridge.send({**them,'to':'claude:claude-c','text':'answer!','inReplyTo':sent['id']})
    result=await waiter
    assert result['state']=='replied' and result['reply']['text']=='answer!' and result['reply']['inReplyTo']==sent['id']
    assert (await h.bridge.wait_reply({**me,'id':sent['id'],'seconds':1}))['state']=='replied'
    # Bounded ping-pong: hops accumulate through inReplyTo chains.
    last=reply
    for i in range(5):
        who,other=(me,'codex:codex-th') if i%2==0 else (them,'claude:claude-c')
        last=await h.bridge.send({**who,'to':other,'text':'again','inReplyTo':last['id']})
    with pytest.raises(ValueError,match='too many times'):
        await h.bridge.send({**them,'to':'claude:claude-c','text':'again','inReplyTo':last['id']})

@pytest.mark.asyncio
async def test_off_refuses_tools_and_unblocks_waiters(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude'),'s2':FakeSession('s2','B',2,'/p','codex')}
    await register(h,'s1','claude','claude-conv-000001','/p');await register(h,'s2','codex','codex-thread-00001','/p')
    async def fake_deliver(bridge,sender,recipient,message):pass
    monkeypatch.setattr('jaunt.bridge_deliver.deliver',fake_deliver)
    me={'runtime':'claude','session':'s1','conversation':'claude-conv-000001'}
    sent=await h.bridge.send({**me,'to':'codex:codex-th','text':'q'})
    waiter=asyncio.create_task(h.bridge.wait_reply({**me,'id':sent['id'],'seconds':30}))
    await asyncio.sleep(0.05)
    h.state.data['bridge']={'enabled':False};h.bridge.disable_now()
    assert (await waiter)['state']=='cancelled'
    with pytest.raises(ValueError,match='turned off'):
        await h.bridge.send({**me,'to':'codex:codex-th','text':'q2'})
    assert h.bridge.peers_for(me)['enabled'] is False
    assert (await h.bridge.register({'runtime':'claude','session':'s1','conversation':'claude-conv-000001','pid':1,'cwd':'/p','event':'prompt'}))=={'enabled':False,'context':''}

@pytest.mark.asyncio
async def test_registration_requires_a_live_jaunt_shell_and_same_runtime_is_refused(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude'),'s2':FakeSession('s2','B',2,'/p','claude')}
    with pytest.raises(ValueError,match='not a running jaunt shell'):
        await register(h,'nope','claude','claude-conv-000001','/p')
    await register(h,'s1','claude','claude-conv-000001','/p');await register(h,'s2','claude','claude-conv-000002','/p')
    assert h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['peers']==[]
    # Terminal gone: participant ends, sweep reports the change.
    h.sessions.items['s2'].alive=False
    assert h.bridge.sweep() and h.bridge.participants['claude:claude-conv-000002'].state=='ended'

def test_setup_edits_are_targeted_and_reversible(tmp_path,monkeypatch):
    from jaunt import bridge_setup
    monkeypatch.setenv('CLAUDE_CONFIG_DIR',str(tmp_path/'claude'));monkeypatch.setenv('CODEX_HOME',str(tmp_path/'codex'))
    settings=tmp_path/'claude/settings.json';settings.parent.mkdir()
    original={'permissions':{'allow':['Bash(ls)']},'hooks':{'PreToolUse':[{'matcher':'Bash','hooks':[{'type':'command','command':'/me/check.sh'}]}],'SessionStart':[{'matcher':'startup','hooks':[{'type':'command','command':'/me/start.sh','timeout':15}]}]},'enabledPlugins':{'x@y':True}}
    settings.write_text(json.dumps(original))
    calls=[]
    monkeypatch.setattr(bridge_setup,'_run',lambda cmd,timeout=60:(calls.append(cmd) or type('R',(),{'returncode':0,'stdout':'','stderr':''})()))
    assert bridge_setup.install({'claude':{'path':'/bin/claude'},'codex':{'path':'/bin/codex'}})=={'claude':{'ok':True,'hooks':str(settings),'mcp':'jaunt-bridge'},'codex':{'ok':True,'hooks':str(tmp_path/'codex/hooks.json'),'mcp':'jaunt-bridge'}}
    after=json.loads(settings.read_text())
    assert after['permissions']['allow']==['Bash(ls)','mcp__jaunt-bridge__jaunt_peers','mcp__jaunt-bridge__jaunt_send','mcp__jaunt-bridge__jaunt_wait_reply'] and after['enabledPlugins']==original['enabledPlugins']
    assert after['hooks']['PreToolUse']==original['hooks']['PreToolUse']
    assert after['hooks']['SessionStart'][0]==original['hooks']['SessionStart'][0] and 'bridge-hook claude' in after['hooks']['SessionStart'][1]['hooks'][0]['command']
    assert all(any('bridge-hook' in h['command'] for g in after['hooks'][e] for h in g['hooks']) for e in ('UserPromptSubmit','Stop','SessionEnd','PostCompact'))
    assert bridge_setup.installed({})=={'claude':{'hooks':True},'codex':{'hooks':True}}
    assert [c[:4] for c in calls if c[1]=='mcp' and c[2]=='add']==[['/bin/claude','mcp','add','--scope'],['/bin/codex','mcp','add','jaunt-bridge']]
    assert all(any(a.startswith('jaunt_STATE=') for a in c) for c in calls if c[1]=='mcp' and c[2]=='add')
    # Installing twice never duplicates entries.
    bridge_setup.install({'claude':{'path':'/bin/claude'},'codex':{'path':'/bin/codex'}})
    assert len(json.loads(settings.read_text())['hooks']['SessionStart'])==2
    bridge_setup.uninstall({'claude':{'path':'/bin/claude'},'codex':{'path':'/bin/codex'}})
    assert json.loads(settings.read_text())==original
    assert not (tmp_path/'codex/hooks.json').exists()
    assert bridge_setup.installed({})=={'claude':{'hooks':False},'codex':{'hooks':False}}

def test_hook_client_is_silent_outside_jaunt_shells(monkeypatch,capsys):
    from jaunt import bridge_client
    monkeypatch.delenv('jaunt_SESSION_ID',raising=False);monkeypatch.delenv('JAUNT_SESSION_ID',raising=False)
    monkeypatch.setattr('sys.stdin',type('S',(),{'read':lambda self:'{"hook_event_name":"SessionStart","session_id":"x"}'})())
    assert bridge_client.hook_main('claude')==0 and capsys.readouterr().out==''

def test_hook_client_injects_context_from_host(monkeypatch,capsys,tmp_path):
    from jaunt import bridge_client
    monkeypatch.setenv('jaunt_SESSION_ID','s1');monkeypatch.setenv('CLAUDE_PID','777')
    seen={}
    monkeypatch.setattr(bridge_client,'control',lambda m,p,timeout=60:(seen.update({m:p}) or {'enabled':True,'context':'[jaunt bridge] roster'}))
    monkeypatch.setattr('sys.stdin',type('S',(),{'read':lambda self:json.dumps({'hook_event_name':'UserPromptSubmit','session_id':'conv-1','cwd':str(tmp_path)})})())
    assert bridge_client.hook_main('claude')==0
    out=json.loads(capsys.readouterr().out)
    assert out['hookSpecificOutput']['additionalContext']=='[jaunt bridge] roster' and out['hookSpecificOutput']['hookEventName']=='UserPromptSubmit'
    assert seen['bridge.register']['pid']==777 and seen['bridge.register']['event']=='prompt' and seen['bridge.register']['project']['root']==os.path.realpath(tmp_path)

def test_mcp_server_speaks_jsonrpc(monkeypatch,tmp_path):
    from jaunt import bridge_client
    import io
    monkeypatch.setenv('jaunt_SESSION_ID','s1');monkeypatch.setenv('CLAUDE_CODE_SESSION_ID','conv-1')
    monkeypatch.setattr(bridge_client,'control',lambda m,p,timeout=60:{'bridge.peers':{'enabled':True,'peers':[{'runtime':'codex','terminal':'B','id':'codex:abc','cwd':'/p','state':'idle'}]},'bridge.send':{'to':'codex:abc','id':'m-1'}}[m])
    frames=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05'}},{'jsonrpc':'2.0','method':'notifications/initialized'},{'jsonrpc':'2.0','id':2,'method':'tools/list'},{'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'jaunt_peers','arguments':{}}},{'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'jaunt_send','arguments':{'to':'codex:abc','text':'hi'}}}]
    stdin=io.BytesIO(''.join(json.dumps(f)+'\n' for f in frames).encode());stdout=io.BytesIO()
    monkeypatch.setattr('sys.stdin',type('S',(),{'buffer':stdin})());monkeypatch.setattr('sys.stdout',type('S',(),{'buffer':stdout})())
    assert bridge_client.mcp_main('claude')==0
    replies=[json.loads(l) for l in stdout.getvalue().decode().splitlines()]
    assert replies[0]['result']['capabilities']=={'tools':{}} and [t['name'] for t in replies[1]['result']['tools']]==['jaunt_peers','jaunt_send','jaunt_wait_reply']
    assert 'codex:abc' in replies[2]['result']['content'][0]['text'] and 'Delivered to codex:abc' in replies[3]['result']['content'][0]['text']

def test_claude_inbox_lookup_uses_the_session_registry(tmp_path,monkeypatch):
    from jaunt import bridge_deliver
    monkeypatch.setenv('CLAUDE_CONFIG_DIR',str(tmp_path))
    sessions=tmp_path/'sessions';sessions.mkdir();sock=tmp_path/'inbox.sock';sock.write_text('')
    (sessions/'4242.json').write_text(json.dumps({'pid':4242,'sessionId':'conv-a','messagingSocketPath':str(sock)}))
    (sessions/'4242.abcd.key').write_text(json.dumps({'peerToken':'tok-a','procStart':'1','pidDomain':'x'}))
    (sessions/'5151.json').write_text(json.dumps({'pid':5151,'sessionId':'conv-b','messagingSocketPath':str(tmp_path/'missing.sock')}))
    assert bridge_deliver.find_claude_inbox('conv-a',4242)==(str(sock),'tok-a')
    assert bridge_deliver.find_claude_inbox('conv-a',0)==(str(sock),'tok-a')
    with pytest.raises(ValueError,match='no live inbox'):bridge_deliver.find_claude_inbox('conv-b',5151)
    with pytest.raises(ValueError,match='no longer registered'):bridge_deliver.find_claude_inbox('conv-zzz',0)
    # No registry record yet: the socket the session's own hook reported is used, with that process's key.
    hinted=tmp_path/'hinted.sock';hinted.write_text('');(sessions/'6060.k.key').write_text(json.dumps({'peerToken':'tok-h'}))
    assert bridge_deliver.find_claude_inbox('conv-h',6060,str(hinted))==(str(hinted),'tok-h')
    # The registry says this process now runs another conversation: never deliver there.
    with pytest.raises(ValueError,match='different Claude Code conversation'):bridge_deliver.find_claude_inbox('conv-old',4242,str(sock))

@pytest.mark.asyncio
async def test_claude_delivery_frames_authenticate_then_inject(tmp_path,monkeypatch):
    import asyncio
    from jaunt import bridge_deliver
    monkeypatch.setenv('CLAUDE_CONFIG_DIR',str(tmp_path))
    import tempfile
    sessions=tmp_path/'sessions';sessions.mkdir()
    sock=Path(tempfile.mkdtemp(prefix='jb',dir='/tmp'))/'i.sock'  # macOS limits AF_UNIX paths to ~104 bytes
    received=[]
    async def handler(reader,writer):
        while line:=await reader.readline():received.append(json.loads(line))
        writer.close()
    server=await asyncio.start_unix_server(handler,path=str(sock))
    (sessions/'7.json').write_text(json.dumps({'pid':7,'sessionId':'conv-a','messagingSocketPath':str(sock)}))
    (sessions/'7.k.key').write_text(json.dumps({'peerToken':'secret-token'}))
    class B:
        def public(self,p):return {'terminal':'Codex tab'}
    sender=Participant(id='codex:abc',session='s2',runtime='codex',conversation='abc',pid=1,cwd='/p',project={'root':'/p'})
    recipient=Participant(id='claude:conv',session='s1',runtime='claude',conversation='conv-a',pid=7,cwd='/p',project={'root':'/p'})
    await bridge_deliver.deliver_claude(B(),sender,recipient,{'id':'m-1','text':'hello there','inReplyTo':None})
    server.close();await server.wait_closed()
    assert received[0]=={'type':'auth','token':'secret-token'} and received[1]['type']=='user' and received[1]['priority']=='next'
    body=received[1]['message']['content']
    assert body.startswith('<cross-session-message from="jaunt-bridge"') and '[jaunt bridge] Message from the Codex session in jaunt terminal "Codex tab" (id codex:abc)' in body and 'hello there' in body and 'jaunt_send' in body


@pytest.mark.asyncio
async def test_mcp_calls_resolve_their_terminal_by_process_ancestry(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1000,'/p','claude'),'s2':FakeSession('s2','B',2000,'/p','codex')}
    await register(h,'s1','claude','claude-conv-000001','/p',pid=1001);await register(h,'s2','codex','codex-thread-00001','/p',pid=2001)
    monkeypatch.setattr(Bridge,'_ancestors',classmethod(lambda cls,pid:{2050:[2050,2001,2000,5,1]}.get(pid,[pid])))
    # A Codex MCP server started without the PTY environment still finds its terminal and conversation.
    resolved=h.bridge.resolve({'runtime':'codex','session':'','conversation':'current','pid':2050})
    assert resolved['session']=='s2' and resolved['conversation']=='codex-thread-00001'
    with pytest.raises(ValueError,match='not started from a jaunt shell'):
        h.bridge.sender_of(h.bridge.resolve({'runtime':'codex','session':'','conversation':'current','pid':999}))

@pytest.mark.asyncio
async def test_detection_finds_per_user_installs_outside_the_service_path(host,tmp_path,monkeypatch):
    # A user service has a minimal PATH; runtimes installed under ~/.local/bin must still be found.
    home=tmp_path/'home';(home/'.local/bin').mkdir(parents=True)
    for name in ('claude','codex'):
        exe=home/'.local/bin'/name;exe.write_text('#!/bin/sh\necho "%s 9.9.9"\n'%name);exe.chmod(0o755)
    monkeypatch.setenv('HOME',str(home));monkeypatch.setenv('PATH','/usr/bin:/bin');monkeypatch.setenv('SHELL','/bin/sh')
    monkeypatch.setattr(Path,'home',classmethod(lambda cls:home))
    detected=await host.bridge.detect(force=True)
    assert detected['visible'] and detected['available'],detected
    assert detected['runtimes']['claude']['path']==str(home/'.local/bin/claude') and detected['runtimes']['codex']['version']=='9.9.9'
