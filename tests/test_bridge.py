import asyncio,json,os,sys,time
from pathlib import Path
import pytest,pytest_asyncio
from jaunt.daemon import Host
from jaunt.state import State
from jaunt import bridge as bridge_module
from jaunt.bridge import Bridge, Participant

class FakeSession:
    def __init__(self,id,name,pid,cwd,program='',alive=True):self.id,self.name,self.pid,self.cwd,self.program,self.alive=id,name,pid,cwd,program,alive

REAL_SESSION_FOR_PID=Bridge.session_for_pid

@pytest_asyncio.fixture
async def host(tmp_path,monkeypatch):
    h=Host(State(tmp_path));sent=[]
    async def broadcast(v):sent.append(v)
    h.broadcast=broadcast;h.sent=sent
    # Process identity is faked per test: claims[pid] -> jaunt session id.
    h.claims={}
    monkeypatch.setattr(Bridge,'session_for_pid',lambda self,pid:h.claims.get(pid,''))
    h.state.data['bridge']={'enabled':True};h.state.save()
    return h

def project(root,common=''):return {'root':root,'common':common,'kind':'git' if common else 'dir'}

async def register(h,session,runtime,conv,cwd,root=None,event='start',pid=4242,source='startup'):
    h.claims[pid]=session
    return await h.bridge.register({'runtime':runtime,'session':session,'conversation':conv,'pid':pid,'cwd':cwd,'event':event,'source':source,'project':project(root or cwd)})

@pytest.mark.asyncio
async def test_awareness_is_automatic_symmetric_and_project_scoped(host):
    h=host
    h.sessions.items={'s1':FakeSession('s1','Claude tab',100,'/work/x','claude'),'s2':FakeSession('s2','Codex tab',200,'/work/x/sub','codex'),'s3':FakeSession('s3','Other',300,'/work/y','codex')}
    first=await register(h,'s1','claude','claude-conv-000001','/work/x')
    # The Codex program already runs in a jaunt shell on this project but has not registered:
    # it is announced as present, not as reachable.
    assert first['enabled'] and 'has not started its conversation on the bridge yet' in first['context'] and 'Codex tab' in first['context']
    assert h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['present'][0]['terminal']=='Codex tab'
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
    assert 'No Claude Code session is currently working on this project through jaunt' in other['context']
    assert [p['id'] for p in h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['peers']]==['codex:codex-th']

@pytest.mark.asyncio
async def test_worktrees_of_one_repository_are_related(host):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/repo','claude'),'s2':FakeSession('s2','B',2,'/repo-wt','codex')};h.claims={1:'s1',2:'s2'}
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
    # A hook whose process belongs to another terminal cannot register a session it did not run in.
    h.claims[7777]='s2'
    with pytest.raises(ValueError,match='does not belong'):
        await h.bridge.register({'runtime':'claude','session':'s1','conversation':'claude-conv-000009','pid':7777,'cwd':'/p','event':'start','project':project('/p')})
    # A stripped environment (no session id) still registers through the hook's own process.
    h.claims[8888]='s1'
    ok=await h.bridge.register({'runtime':'claude','session':'','conversation':'claude-conv-000010','pid':0,'hookPid':8888,'cwd':'/p','event':'start','project':project('/p')})
    assert ok['id']=='claude:claude-c' and h.bridge.participants['claude:claude-conv-000010'].session=='s1'
    await register(h,'s1','claude','claude-conv-000001','/p');await register(h,'s2','claude','claude-conv-000002','/p')
    assert h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['peers']==[]
    # Terminal gone: participant ends, sweep reports the change.
    h.sessions.items['s2'].alive=False
    assert h.bridge.sweep() and h.bridge.participants['claude:claude-conv-000002'].state=='ended'

def test_setup_edits_are_targeted_and_reversible(tmp_path,monkeypatch):
    from jaunt import bridge_setup
    monkeypatch.setenv('CLAUDE_CONFIG_DIR',str(tmp_path/'claude'));monkeypatch.setenv('CODEX_HOME',str(tmp_path/'codex'));monkeypatch.setenv('jaunt_STATE',str(tmp_path/'state'))
    settings=tmp_path/'claude/settings.json';settings.parent.mkdir()
    original={'permissions':{'allow':['Bash(ls)']},'hooks':{'PreToolUse':[{'matcher':'Bash','hooks':[{'type':'command','command':'/me/check.sh'}]}],'SessionStart':[{'matcher':'startup','hooks':[{'type':'command','command':'/me/start.sh','timeout':15}]}]},'enabledPlugins':{'x@y':True}}
    settings.write_text(json.dumps(original))
    calls=[]
    monkeypatch.setattr(bridge_setup,'_run',lambda cmd,timeout=60:(calls.append(cmd) or type('R',(),{'returncode':0,'stdout':'','stderr':''})()))
    assert bridge_setup.install({'claude':{'path':'/bin/claude'},'codex':{'path':'/bin/codex'}})=={'claude':{'ok':True,'hooks':str(settings),'mcp':'jaunt-bridge'},'codex':{'ok':True,'hooks':str(tmp_path/'codex/hooks.json'),'mcp':'jaunt-bridge'}}
    after=json.loads(settings.read_text())
    assert after['permissions']['allow']==['Bash(ls)','mcp__jaunt-bridge__jaunt_peers','mcp__jaunt-bridge__jaunt_send','mcp__jaunt-bridge__jaunt_wait_reply','mcp__jaunt-bridge__jaunt_hosts','mcp__jaunt-bridge__jaunt_run','mcp__jaunt-bridge__jaunt_read','mcp__jaunt-bridge__jaunt_shell'] and after['enabledPlugins']==original['enabledPlugins']
    assert after['hooks']['PreToolUse']==original['hooks']['PreToolUse']
    wrapper=tmp_path/'state/bridge/hook-claude'
    assert after['hooks']['SessionStart'][0]==original['hooks']['SessionStart'][0] and after['hooks']['SessionStart'][1]['hooks'][0]['command']==str(wrapper)
    assert wrapper.exists() and os.access(wrapper,os.X_OK) and 'bridge-hook claude --state' in wrapper.read_text() and 'hook.log' in wrapper.read_text() and (tmp_path/'state/bridge/mcp-codex').exists()
    assert after['hooks']['SessionEnd'][0]['hooks'][0]['timeout']==3
    # The wrapper never fails the runtime's hook pipeline: a missing interpreter is logged instead.
    import subprocess
    broken=tmp_path/'state/bridge/hook-codex';broken.write_text(broken.read_text().replace(sys.executable,'/nonexistent/python'))
    r=subprocess.run([str(broken)],input=b'{}',capture_output=True);assert r.returncode==0 and 'interpreter not executable' in (tmp_path/'state/bridge/hook.log').read_text()
    assert all(any('/bridge/hook-' in h['command'] for g in after['hooks'][e] for h in g['hooks']) for e in ('UserPromptSubmit','Stop','SessionEnd','PostCompact'))
    assert bridge_setup.installed({})=={'claude':{'hooks':True},'codex':{'hooks':True}}
    assert [c[:4] for c in calls if c[1]=='mcp' and c[2]=='add']==[['/bin/claude','mcp','add','--scope'],['/bin/codex','mcp','add','jaunt-bridge']]
    assert all(any(a.startswith('jaunt_STATE=') for a in c) and c[-1]==str(tmp_path/'state/bridge'/('mcp-claude' if c[0]=='/bin/claude' else 'mcp-codex')) for c in calls if c[1]=='mcp' and c[2]=='add')
    # Installing twice never duplicates entries.
    bridge_setup.install({'claude':{'path':'/bin/claude'},'codex':{'path':'/bin/codex'}})
    assert len(json.loads(settings.read_text())['hooks']['SessionStart'])==2
    bridge_setup.uninstall({'claude':{'path':'/bin/claude'},'codex':{'path':'/bin/codex'}})
    assert json.loads(settings.read_text())==original
    assert not (tmp_path/'codex/hooks.json').exists() and not (tmp_path/'state/bridge').exists()
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
    sender=Participant(id='codex:abc',session='s2',runtime='codex',conversation='abc',pid=1,cwd='/p',project={'root':'/p'},mode_class='bypass')
    recipient=Participant(id='claude:conv',session='s1',runtime='claude',conversation='conv-a',pid=7,cwd='/p',project={'root':'/p'})
    await bridge_deliver.deliver_claude(B(),sender,recipient,{'id':'m-1','text':'hello there','inReplyTo':None})
    server.close();await server.wait_closed()
    assert received[0]=={'type':'auth','token':'secret-token'} and received[1]['type']=='user' and received[1]['priority']=='next'
    body=received[1]['message']['content']
    assert body.startswith('<cross-session-message from="jaunt-bridge" from-name="jaunt · codex:abc" from-mode="bypass">') and '[jaunt bridge] Message from the Codex session in jaunt terminal "Codex tab" (id codex:abc)' in body and 'hello there' in body and 'jaunt_send' in body


@pytest.mark.asyncio
async def test_mcp_calls_resolve_their_terminal_by_process_ancestry(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1000,'/p','claude'),'s2':FakeSession('s2','B',2000,'/p','codex')}
    await register(h,'s1','claude','claude-conv-000001','/p',pid=1001);await register(h,'s2','codex','codex-thread-00001','/p',pid=2001)
    monkeypatch.setattr(Bridge,'session_for_pid',REAL_SESSION_FOR_PID)
    monkeypatch.setattr(Bridge,'_ancestors',classmethod(lambda cls,pid:{2050:[2050,2001,2000,5,1]}.get(pid,[pid])))
    monkeypatch.setattr(Bridge,'tty_of_pid',staticmethod(lambda pid:''))
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


def test_terminal_identity_matches_a_reparented_process(host,monkeypatch):
    # No ancestry link (the runtime daemonised or was reparented) but the process still
    # sits on the PTY the host owns: that terminal identifies it.
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1000,'/p','claude'),'s2':FakeSession('s2','B',2000,'/p','codex')}
    for s in h.sessions.items.values():s.fd=5
    monkeypatch.setattr(Bridge,'session_for_pid',REAL_SESSION_FOR_PID)
    monkeypatch.setattr(Bridge,'_ancestors',classmethod(lambda cls,pid:[pid,1]))
    monkeypatch.setattr(Bridge,'tty_of_pid',staticmethod(lambda pid:{4242:'dev:34818'}.get(pid,'')))
    monkeypatch.setattr(Bridge,'session_tty',lambda self,s:{'s1':'dev:34817','s2':'dev:34818'}[s.id])
    assert h.bridge.session_for_pid(4242)=='s2' and h.bridge.session_for_pid(4243)==''


@pytest.mark.asyncio
async def test_startup_detection_runs_even_when_the_bridge_is_off(host,monkeypatch):
    h=host;h.state.data['bridge']={'enabled':False};h.state.save()
    calls=[]
    async def fake_detect(self,force=False):calls.append(force);self.detected={'runtimes':{},'visible':True,'available':True,'reason':'','checkedAt':1};return self.detected
    monkeypatch.setattr(Bridge,'detect',fake_detect)
    await h.bridge.refresh_integrations()
    assert calls==[True] and h.bridge.status()['visible'] is True


@pytest.mark.asyncio
async def test_hook_under_a_wrapper_shell_registers_the_runtime_process_not_the_wrapper(host,monkeypatch):
    # hook (pid 30) <- sh wrapper (pid 20, exits right after) <- codex (pid 10) <- jaunt shell (pid 2000)
    h=host;h.sessions.items={'s2':FakeSession('s2','B',2000,'/p','codex')}
    monkeypatch.setattr(Bridge,'session_for_pid',REAL_SESSION_FOR_PID)
    monkeypatch.setattr(Bridge,'_ancestors',classmethod(lambda cls,pid:{30:[30,20,10,2000,1],20:[20,10,2000,1],10:[10,2000,1]}.get(pid,[pid])))
    monkeypatch.setattr(Bridge,'tty_of_pid',staticmethod(lambda pid:''))
    monkeypatch.setattr(Bridge,'command_of_pid',staticmethod(lambda pid:{20:'/bin/sh /state/bridge/hook-codex',10:'/home/u/.local/bin/codex'}.get(pid,'')))
    monkeypatch.setattr(Bridge,'_alive',staticmethod(lambda pid:pid!=20))
    r=await h.bridge.register({'runtime':'codex','session':'','conversation':'codex-thread-00009','pid':20,'hookPid':30,'cwd':'/p','event':'prompt','project':project('/p')})
    participant=h.bridge.participants['codex:codex-thread-00009']
    assert r['enabled'] and participant.session=='s2' and participant.pid==10
    # The wrapper is gone but the runtime lives: the participant must survive the sweep.
    assert not h.bridge.sweep() or participant.state!='ended'
    assert participant.state!='ended'


@pytest.mark.asyncio
async def test_reply_consumed_by_a_waiting_call_is_not_delivered_twice(host,monkeypatch):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude'),'s2':FakeSession('s2','B',2,'/p','codex')}
    await register(h,'s1','claude','claude-conv-000001','/p');await register(h,'s2','codex','codex-thread-00001','/p')
    delivered=[]
    async def fake_deliver(bridge,sender,recipient,message):delivered.append(message['text'])
    monkeypatch.setattr('jaunt.bridge_deliver.deliver',fake_deliver)
    me={'runtime':'claude','session':'s1','conversation':'claude-conv-000001'};them={'runtime':'codex','session':'s2','conversation':'codex-thread-00001'}
    sent=await h.bridge.send({**me,'to':'codex:codex-th','text':'question?'})
    waiter=asyncio.create_task(h.bridge.wait_reply({**me,'id':sent['id'],'seconds':5}));await asyncio.sleep(0.05)
    reply=await h.bridge.send({**them,'to':'claude:claude-c','text':'answer!','inReplyTo':sent['id']})
    assert (await waiter)['reply']['text']=='answer!' and reply['state']=='delivered' and reply['detail']=='handed to the waiting call'
    assert delivered==['question?']  # the answer went to the waiting call only
    # Nobody waiting: the reply is pushed into the conversation as usual.
    late=await h.bridge.send({**them,'to':'claude:claude-c','text':'later','inReplyTo':sent['id']})
    assert delivered==['question?','later'] and late['detail']==''

def test_mode_class_and_home_git_root(monkeypatch,tmp_path):
    from jaunt import bridge_client
    assert bridge_client.mode_class('claude','bypassPermissions')=='bypass' and bridge_client.mode_class('claude','default')=='prompting' and bridge_client.mode_class('claude','')==''
    assert bridge_client.mode_class('codex','danger-full-access')=='bypass' and bridge_client.mode_class('codex','default')=='prompting'
    monkeypatch.setenv('HOME',str(tmp_path));monkeypatch.setattr(os.path,'expanduser',lambda p:str(tmp_path) if p=='~' else p)
    import subprocess
    subprocess.run(['git','init','-q',str(tmp_path)],check=True);(tmp_path/'Code/test').mkdir(parents=True)
    assert bridge_client.project_of(str(tmp_path/'Code/test'))['root']==os.path.realpath(tmp_path/'Code/test')


@pytest.mark.asyncio
async def test_mcp_identity_follows_the_terminal_after_clear(host):
    # The MCP server was started with the first conversation id; /clear registered a newer one in the same terminal.
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude')}
    await register(h,'s1','claude','claude-conv-000001','/p')
    await register(h,'s1','claude','claude-conv-000002','/p',source='clear')
    resolved=h.bridge.resolve({'runtime':'claude','session':'s1','conversation':'claude-conv-000001','pid':1})
    assert resolved['conversation']=='claude-conv-000002' and h.bridge.sender_of(resolved).id=='claude:claude-c'

def test_participants_survive_a_runtime_handoff(host):
    h=host;h.sessions.items={'s1':FakeSession('s1','A',1,'/p','claude')}
    h.bridge.participants['claude:c1']=Participant(id='claude:c1',session='s1',runtime='claude',conversation='c1',pid=1,cwd='/p',project={'root':'/p'},mode_class='bypass')
    h.bridge.participants['codex:t1']=Participant(id='codex:t1',session='s2',runtime='codex',conversation='t1',pid=2,cwd='/p',project={'root':'/p'},state='ended')
    rows=h.bridge.export();assert [r['id'] for r in rows]==['claude:c1']
    fresh=Bridge(h);fresh.restore(rows)
    p=fresh.participants['claude:c1'];assert p.mode_class=='bypass' and p.session=='s1' and p.roster_seen==-1 and fresh.version==1

@pytest.mark.asyncio
async def test_roster_names_same_runtime_sessions_it_does_not_bridge(host):
    """A second Claude session on the project is not a bridge peer, but the roster must say it exists
    (a model took the cross-runtime list for the full list of agents and missed a neighbour)."""
    h=host
    h.sessions.items={'s1':FakeSession('s1','Claude A',100,'/work/x','claude'),'s2':FakeSession('s2','Claude B',200,'/work/x','claude'),'s3':FakeSession('s3','Codex tab',300,'/work/x','codex')}
    first=await register(h,'s1','claude','claude-conv-000001','/work/x')
    assert 'This list covers only Codex sessions' in first['context']
    assert 'Also 1 other Claude Code session(s) open on this project in jaunt terminal(s) "Claude B"' in first['context'] and 'ListAgents' in first['context']
    # Registered or not, a same-runtime session is named once, and never listed as a peer.
    await register(h,'s2','claude','claude-conv-000002','/work/x')
    again=await register(h,'s1','claude','claude-conv-000001','/work/x',event='compact')
    assert again['context'].count('Claude B')==1 and 'jaunt_send' not in again['context'].split('Also 1 other')[1].split('\n')[0]
    assert [p['id'] for p in h.bridge.peers_for({'runtime':'claude','session':'s1','conversation':'claude-conv-000001'})['peers']]==[]
    # Codex sees both Claude sessions as peers and no sibling line.
    codex=await register(h,'s3','codex','codex-thread-00001','/work/x')
    assert codex['context'].count('Claude Code session in jaunt terminal')==2 and 'Also ' not in codex['context']
