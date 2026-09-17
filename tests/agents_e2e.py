#!/usr/bin/env python3
"""Agents and machines, phase 1, against two real hosts: host A links to host B with B's pairing
code; an MCP client driven over stdio as a Claude Code session on A lists machines and runs commands
on B; B's owner answers approvals from the CLI; trust and block levels behave; long output is read
in chunks; the messaging bridge is untouched."""
import asyncio,json,os,subprocess,sys,time
from pathlib import Path
from browser_e2e import Harness,ROOT,until

class Mcp:
    """The jaunt MCP server as Claude Code would start it, speaking JSON-RPC over stdio."""
    def __init__(self,host,session):
        env={**host.env,'jaunt_SESSION_ID':session};self.p=subprocess.Popen([sys.executable,'-m','jaunt.cli','bridge-mcp','claude','--state',str(host.state)],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open(os.environ.get('MCP_STDERR',os.devnull),'a'),text=True);self.n=0
        self.call('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'e2e','version':'0'}})
    def call(self,method,params=None,timeout=200):
        self.n+=1;self.p.stdin.write(json.dumps({'jsonrpc':'2.0','id':self.n,'method':method,'params':params or {}})+'\n');self.p.stdin.flush()
        deadline=time.time()+timeout
        while time.time()<deadline:
            line=self.p.stdout.readline()
            if not line:raise AssertionError(f'MCP server exited rc={self.p.poll()}')
            m=json.loads(line)
            if m.get('id')==self.n:return m
        raise AssertionError('MCP reply timed out')
    def tools(self):return [t['name'] for t in self.call('tools/list')['result']['tools']]
    def tool(self,name,args,timeout=200):
        r=self.call('tools/call',{'name':name,'arguments':args},timeout);return r['result']['content'][0]['text']
    def close(self):self.p.kill()

def main():
    # Stand-in runtimes: enough of `claude` / `codex` for detection, the MCP registration and Codex's queue.
    import tempfile
    fake=Path(tempfile.mkdtemp(prefix='jaunt-fake-runtimes-'));queue_log=fake/'codex-queue.log'
    (fake/'claude').write_text('#!/bin/sh\ncase "$1" in --version) echo "2.1.300 (Claude Code)";; esac\nexit 0\n');(fake/'claude').chmod(0o755)
    (fake/'codex').write_text('#!/bin/bash\ncase "$1" in --version) echo "codex-cli 0.160.0";; queue) printf \'%s\\n\' "$@" >> "$CODEX_QUEUE_LOG";; "") exec -a codex sleep 600;; esac\nexit 0\n');(fake/'codex').chmod(0o755)
    runtimes_env={'PATH':str(fake)+':'+os.environ.get('PATH',''),'CODEX_QUEUE_LOG':str(queue_log)}
    A=Harness(name='laptop',extra_env=runtimes_env);B=Harness(name='homelab',extra_env={'jaunt_AGENT_LEASE':'4',**runtimes_env})
    try:
        checks=[]
        def passed(s):checks.append(s);print('PASS',s,flush=True)
        status=lambda h:json.loads(h.cli('status'))
        sid=json.loads(A.cli('status'))['sessions'][0]['id'] if status(A)['sessions'] else None
        if sid is None:
            # A shell on A whose session id the MCP server will carry, like a real Claude session would.
            import socket
            sock=socket.socket(socket.AF_UNIX);sock.connect(str(A.state/'control.sock'));sock.sendall(json.dumps({'method':'ui.connect'}).encode()+b'\n')
            f=sock.makefile('rw');f.readline();f.write(json.dumps({'type':'rpc','id':'c1','method':'session.create','params':{'cwd':str(A.work),'cols':80,'rows':24}})+'\n');f.flush()
            while True:
                m=json.loads(f.readline())
                if m.get('type')=='reply' and m.get('id')=='c1':sid=m['result']['id'];break
            sock.close()
        mcp=Mcp(A,sid)
        assert 'jaunt_run' not in mcp.tools(),'agent tools are not listed while the switch is off'
        assert 'off' in mcp.tool('jaunt_hosts',{}).lower() or 'not' in mcp.tool('jaunt_hosts',{}).lower()
        passed('with the switch off, no agent tool is listed and a direct call is refused')
        # Owner turns the feature on on both machines and links A → B with B's pairing code.
        A.cli('agents','status');subprocess.run([sys.executable,'-c','''
import json,sys;sys.path.insert(0,sys.argv[1]);from jaunt.cli import control;print(json.dumps(control("agents.configure",{"enabled":True})["enabled"]))''',str(ROOT/'host')],env=A.env,check=True,capture_output=True)
        subprocess.run([sys.executable,'-c','''
import json,sys;sys.path.insert(0,sys.argv[1]);from jaunt.cli import control;print(json.dumps(control("agents.configure",{"enabled":True})["enabled"]))''',str(ROOT/'host')],env=B.env,check=True,capture_output=True)
        code=B.pair()['code'];links=json.loads(A.cli('link',code))
        assert links and links[0]['state']=='online' and links[0]['name']=='homelab',links
        devices=json.loads(B.cli('devices'));assert any(d.get('kind')=='host' and d['name']=='host: laptop' for d in devices),devices
        passed('host A enrolled on host B as a device of kind host with one pairing code; link online')
        assert 'jaunt_run' in mcp.tools() and 'jaunt_hosts' in mcp.tools()
        hosts=mcp.tool('jaunt_hosts',{});assert 'homelab' in hosts and 'asks its owner' in hosts,hosts
        passed('the session sees the linked machine and that it will be asked')
        # Ask mode: B's owner approves once from the CLI.
        marker=B.work/'agent-was-here'
        def approve(decision,h=B):
            def wait():
                pending=json.loads(h.cli('agents','pending'))
                if pending:
                    h.cli('agents','allow' if decision!='deny' else 'deny',pending[0]['id'],*(['--trust',decision] if decision in ('1h','24h','always','rule') else []));return True
                return False
            return wait
        import threading
        def approver(decision,h=B):
            def run():
                for _ in range(60):
                    if approve(decision,h)():return
                    time.sleep(.5)
            t=threading.Thread(target=run,daemon=True);t.start();return t
        t=approver('once');result=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':f"echo agent > '{marker}'; echo done; hostname"}));t.join()
        assert result['status']=='ok' and result['exitCode']==0 and 'done' in result['stdout'] and marker.read_text().strip()=='agent',result
        log=json.loads(B.cli('agents','log'));assert log[-1]['kind']=='run' and log[-1]['decision']=='once'
        passed('ask mode: the command waited for the owner, ran on B after "allow once", and was journaled')
        # Ask mode, denied.
        t=approver('deny');refused=mcp.tool('jaunt_run',{'host':'homelab','command':'id'});t.join()
        assert 'Refused' in refused and 'denied' in refused,refused
        passed('a denied request comes back as an explicit refusal, not as a failed command')
        # Trust for 1 h: no approval needed any more; jaunt_hosts says so.
        t=approver('1h');result=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':'echo trusted-now'}));t.join()
        assert 'trusted-now' in result['stdout']
        assert not json.loads(B.cli('agents','pending'))
        result=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':'echo second'},timeout=30));assert 'second' in result['stdout']
        assert 'trusted: commands run at once' in mcp.tool('jaunt_hosts',{})
        table=json.loads(B.cli('agents','status'))['requesters'];assert len(table)==1 and table[0]['exec']['level']=='trust' and table[0]['type']['level']=='ask' and table[0]['name']=='host: laptop · Claude Code'
        passed('"trust 1h" from the approval makes later commands run at once; the requester table shows it per right')
        # Long output is read in chunks from B's file.
        big=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':"head -c 200000 /dev/zero | tr '\\0' z; printf END"}));assert big['truncated'] and big['bytes']==200003
        tail=json.loads(mcp.tool('jaunt_read',{'host':'homelab','run':big['run'],'offset':199990,'limit':100}));assert tail['eof'] and tail['text'].endswith('END')
        passed('output beyond 64 KiB stays on B and is read in bounded chunks')
        # Timeout is bounded and reported as such.
        slow=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':'sleep 30','timeout_seconds':1}));assert slow['status']=='timeout'
        # Block from the owner side: refused without any prompt.
        key=table[0]['id'];B.cli('agents','block',key)
        refused=mcp.tool('jaunt_run',{'host':'homelab','command':'id'},timeout=30);assert 'blocked' in refused
        assert 'blocked' in mcp.tool('jaunt_hosts',{})
        passed('a blocked requester is refused at once and sees it in jaunt_hosts')
        # Revocation removes the row; the next request asks again. Unlink removes the machine.
        B.cli('agents','revoke','all');assert not json.loads(B.cli('agents','status'))['requesters']
        t=approver('once');result=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':'echo again'}));t.join();assert 'again' in result['stdout']
        A.cli('unlink',links[0]['room']);assert not json.loads(A.cli('links'))
        assert 'No machine is linked' in mcp.tool('jaunt_hosts',{})
        passed('revoke resets to ask; unlink removes the machine for the session')
        # Background agent shell (phase 2): its own PTY on B, never a jaunt session, dies on close / lease / revoke.
        links=json.loads(A.cli('link',B.pair()['code']))
        t=approver('always');opened=json.loads(mcp.tool('jaunt_shell',{'host':'homelab','action':'open','cwd':str(B.work)}));t.join()
        shell=opened['id'];assert opened['alive'] and shell.startswith('s_')
        assert all(s['id']!=shell for s in status(B)['sessions']),'an agent shell is not a jaunt session'
        assert json.loads(B.cli('agents','shells'))[0]['id']==shell
        mcp.tool('jaunt_shell',{'host':'homelab','action':'send','input':'cd / && export STATEFUL=yes'})
        mcp.tool('jaunt_shell',{'host':'homelab','action':'send','shell':shell,'input':'cd / && export STATEFUL=yes'})
        mcp.tool('jaunt_shell',{'host':'homelab','action':'send','shell':shell,'input':'echo got-$STATEFUL-$(pwd)'})
        for _ in range(40):
            out=json.loads(mcp.tool('jaunt_shell',{'host':'homelab','action':'read','shell':shell,'offset':0}))
            if 'got-yes-/' in out['text']:break
            time.sleep(.25)
        else:raise AssertionError('shell output missing: '+out['text'][-300:])
        passed('a background agent shell keeps state between sends and its output is read from an offset')
        mcp.tool('jaunt_shell',{'host':'homelab','action':'close','shell':shell});assert not json.loads(B.cli('agents','shells'))
        opened=json.loads(mcp.tool('jaunt_shell',{'host':'homelab','action':'open'}));shell=opened['id']
        for _ in range(40):
            if not json.loads(B.cli('agents','shells')):break
            time.sleep(.5)
        else:raise AssertionError('lease expiry did not kill the forgotten shell')
        log=json.loads(B.cli('agents','log'));assert any(e.get('shell')==shell and e.get('reason')=='lease expired' for e in log)
        passed('a forgotten agent shell dies when its lease expires (4 s in this run) and the journal says why')
        opened=json.loads(mcp.tool('jaunt_shell',{'host':'homelab','action':'open'}));shell=opened['id']
        B.cli('agents','revoke','all');assert not json.loads(B.cli('agents','shells'))
        assert 'Unknown agent shell' in mcp.tool('jaunt_shell',{'host':'homelab','action':'read','shell':shell},timeout=60) or 'Refused' in mcp.tool('jaunt_shell',{'host':'homelab','action':'read','shell':shell},timeout=60)
        passed('revoking the requester kills its agent shells at once')
        # The jaunt session that opened a shell elsewhere ends: A releases it on B.
        sock=__import__('socket').socket(__import__('socket').AF_UNIX);sock.connect(str(A.state/'control.sock'));sock.sendall(json.dumps({'method':'ui.connect'}).encode()+b'\n')
        f=sock.makefile('rw');f.readline();f.write(json.dumps({'type':'rpc','id':'c2','method':'session.create','params':{'cwd':str(A.work),'cols':80,'rows':24}})+'\n');f.flush()
        while True:
            m=json.loads(f.readline())
            if m.get('type')=='reply' and m.get('id')=='c2':sid2=m['result']['id'];break
        mcp2=Mcp(A,sid2);t=approver('always');opened=json.loads(mcp2.tool('jaunt_shell',{'host':'homelab','action':'open'}));t.join();assert json.loads(B.cli('agents','shells'))
        f.write(json.dumps({'type':'rpc','id':'c3','method':'session.terminate','params':{'id':sid2}})+'\n');f.flush()
        for _ in range(40):
            if not json.loads(B.cli('agents','shells')):break
            time.sleep(.5)
        else:raise AssertionError('the agent shell outlived the session that opened it')
        sock.close();mcp2.close()
        passed('when the jaunt session that opened an agent shell ends, the shell on the other host is closed')
        # Phase 3: typing into the owner's EXISTING jaunt shells, remote and local, one grant per shell, cut.
        def new_session(h):
            sk=__import__('socket').socket(__import__('socket').AF_UNIX);sk.connect(str(h.state/'control.sock'));sk.sendall(json.dumps({'method':'ui.connect'}).encode()+b'\n')
            g=sk.makefile('rw');g.readline();g.write(json.dumps({'type':'rpc','id':'n1','method':'session.create','params':{'cwd':str(h.work),'cols':80,'rows':24}})+'\n');g.flush()
            while True:
                m=json.loads(g.readline())
                if m.get('type')=='reply' and m.get('id')=='n1':sk.close();return m['result']['id']
        def output(args,needle,tries=40):
            for _ in range(tries):
                text=mcp.tool('jaunt_output',args,timeout=60)
                if needle in text:return text
                time.sleep(.25)
            raise AssertionError('missing '+needle+': '+text[-400:])
        sidB=new_session(B);time.sleep(1)
        listed=mcp.tool('jaunt_sessions',{'host':'homelab'});assert sidB in listed and 'the owner is asked once' in listed,listed
        t=approver('once');typed=mcp.tool('jaunt_type',{'host':'homelab','session':sidB,'input':'echo typed-$((20+22))'});t.join();assert 'Typed' in typed,typed
        output({'host':'homelab','session':sidB},'typed-42')
        sB=[x for x in status(B)['sessions'] if x['id']==sidB][0];assert sB['agents'] and 'laptop' in sB['agents'][0]['name'] and 'Claude Code' in sB['agents'][0]['name'],sB['agents']
        log=json.loads(B.cli('agents','log'));assert log[-1]['kind']=='typed' and log[-1]['session']==sidB and 'typed-' in log[-1]['input']
        passed('a session types into one of the owner\'s shells on the other host after one approval; the shell is marked and the keystrokes journaled')
        mcp.tool('jaunt_type',{'host':'homelab','session':sidB,'input':'echo again-$((1+1))'},timeout=60);assert not json.loads(B.cli('agents','pending'))
        output({'host':'homelab','session':sidB},'again-2')
        assert 'you may type there' in mcp.tool('jaunt_sessions',{'host':'homelab'})
        passed('the grant covers that shell: the second input goes in without a prompt')
        cut=json.loads(B.cli('agents','cut','--',sidB));assert cut['kind']=='cut' and cut['session']==sidB
        assert not [x for x in status(B)['sessions'] if x['id']==sidB][0]['agents']
        t=approver('deny');refused=mcp.tool('jaunt_type',{'host':'homelab','session':sidB,'input':'echo nope'});t.join();assert 'Refused' in refused,refused
        passed('cut removes the mark and makes the agent ask again for that shell; deny refuses it')
        key=[r['id'] for r in json.loads(B.cli('agents','status'))['requesters']][0];B.cli('agents','block',key,'--right','type')
        assert 'blocked' in mcp.tool('jaunt_type',{'host':'homelab','session':sidB,'input':'echo nope'},timeout=60)
        assert 'blocked' not in mcp.tool('jaunt_hosts',{}),'exec right untouched by a type block'
        passed('the type right is blocked independently of the exec right')
        sidA=new_session(A);time.sleep(1)
        listed=mcp.tool('jaunt_sessions',{});assert sidA in listed and sid not in listed,listed
        assert 'own shell' in mcp.tool('jaunt_type',{'session':sid,'input':'echo self'},timeout=30)
        t=approver('once',A);typed=mcp.tool('jaunt_type',{'session':sidA,'input':'echo local-$((1+1))'});t.join();assert 'Typed' in typed,typed
        output({'session':sidA},'local-2')
        rows=json.loads(A.cli('agents','status'))['requesters'];assert any(r['local'] and r['name']=='Claude Code on this machine' for r in rows),rows
        passed('a local session types into another shell of its own host under a local requester row; never into its own shell')
        # Phase 4: allow-lists. "Always allow this command" from an approval, patterns from the CLI, removal.
        B.cli('agents','revoke','all')
        t=approver('rule');result=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':'echo rule-$((2+2))'}));t.join();assert 'rule-4' in result['stdout'],result
        txt=mcp.tool('jaunt_run',{'host':'homelab','command':'echo  rule-$((2+2))'},timeout=60);assert txt.startswith('{'),txt;result=json.loads(txt);assert 'rule-4' in result['stdout'] and not json.loads(B.cli('agents','pending'))
        log=json.loads(B.cli('agents','log'));assert log[-1]['kind']=='run' and log[-1]['decision']=='rule' and log[-1]['rule']=='echo rule-$((2+2))',log[-1]
        t=approver('deny');assert 'Refused' in mcp.tool('jaunt_run',{'host':'homelab','command':'echo other'});t.join()
        passed('"always allow this command" turns the exact command into a rule: it runs without a prompt, other commands still ask')
        key=[r['id'] for r in json.loads(B.cli('agents','status'))['requesters']][0]
        B.cli('agents','rule',key,'--pattern','echo pat-*');rules=json.loads(B.cli('agents','rules',key))[key];assert rules==['echo rule-$((2+2))','echo pat-*'],rules
        result=json.loads(mcp.tool('jaunt_run',{'host':'homelab','command':'echo pat-1 pat-2'},timeout=60));assert 'pat-1 pat-2' in result['stdout'] and not json.loads(B.cli('agents','pending'))
        assert 'pre-approved without a prompt: echo rule-$((2+2)), echo pat-*' in mcp.tool('jaunt_hosts',{})
        B.cli('agents','rule',key,'--pattern','echo pat-*','--remove');assert json.loads(B.cli('agents','rules',key))[key]==['echo rule-$((2+2))']
        t=approver('deny');assert 'Refused' in mcp.tool('jaunt_run',{'host':'homelab','command':'echo pat-3'});t.join()
        passed('rules with * are managed from the CLI, shown to the session in jaunt_hosts, and stop applying once removed')
        # Messages between sessions across machines: its own switch; sessions register through the hooks;
        # discovery and delivery go through the links, both directions, whatever the runtimes.
        import socket as _socket,threading as _threading
        def ctl(h,method,params):
            return json.loads(subprocess.check_output([sys.executable,'-c','import json,sys;sys.path.insert(0,sys.argv[1]);from jaunt.cli import control;print(json.dumps(control(sys.argv[2],json.loads(sys.argv[3]))))',str(ROOT/'host'),method,json.dumps(params)],env=h.env))
        assert json.loads(A.cli('agents','enable','messages'))['messages'] and json.loads(B.cli('agents','enable','messages'))['messages']
        assert '/bridge/hook-claude' in (A.root/'home/.claude/settings.json').read_text() and '/bridge/hook-codex' in (B.root/'home/.codex/hooks.json').read_text(),'the switch installs the hooks so sessions register'
        B.cli('link',A.pair()['code'])
        def register(h,session,runtime,conv,inbox=None):
            pid=[x for x in status(h)['sessions'] if x['id']==session][0]['pid']
            r=ctl(h,'bridge.register',{'runtime':runtime,'session':session,'conversation':conv,'pid':pid,'cwd':str(h.work),'event':'start','project':{'root':str(h.work),'common':'','kind':'dir'},'modeClass':'prompting','inbox':inbox or {}})
            assert r.get('id'),r;return r['id'],pid
        idA,_=register(A,sid,'claude','convA-laptop-0001')
        assert 'context' in ctl(A,'bridge.register',{'runtime':'claude','session':sid,'conversation':'convA-laptop-0001','pid':[x for x in status(A)['sessions'] if x['id']==sid][0]['pid'],'cwd':str(A.work),'event':'prompt','project':{'root':str(A.work)}}) and not ctl(A,'bridge.register',{'runtime':'claude','session':sid,'conversation':'convA-laptop-0001','pid':[x for x in status(A)['sessions'] if x['id']==sid][0]['pid'],'cwd':str(A.work),'event':'start','project':{'root':str(A.work)}})['context'],'no roster is injected while the local bridge is off'
        sidB2=new_session(B);time.sleep(1)
        idBcodex,_=register(B,sidB,'codex','convB-codex-0001')
        # A stand-in Claude Code inbox on B: the session registry entry plus the private socket.
        inbox_dir=B.root/'home/.claude/sessions';inbox_dir.mkdir(parents=True,exist_ok=True);sock_path=str(B.root/'inbox.sock');frames=[]
        srv=_socket.socket(_socket.AF_UNIX);srv.bind(sock_path);srv.listen(4)
        def serve():
            while True:
                try:c,_=srv.accept()
                except OSError:return
                with c:
                    data=b''
                    c.settimeout(3)
                    try:
                        while not data.endswith(b'\n') or data.count(b'\n')<2:
                            chunk=c.recv(65536)
                            if not chunk:break
                            data+=chunk
                    except OSError:pass
                    frames.extend(json.loads(l) for l in data.decode().splitlines() if l.strip())
        _threading.Thread(target=serve,daemon=True).start()
        pidB2=[x for x in status(B)['sessions'] if x['id']==sidB2][0]['pid']
        (inbox_dir/f'{pidB2}.json').write_text(json.dumps({'pid':pidB2,'sessionId':'convB-claude-0002','messagingSocketPath':sock_path}))
        idBclaude,_=register(B,sidB2,'claude','convB-claude-0002',{'socket':sock_path})
        # A Codex program open in a jaunt shell of B that has NOT registered (no prompt yet) is named as such, not hidden.
        sidB3=new_session(B);_sk=__import__('socket').socket(__import__('socket').AF_UNIX);_sk.connect(str(B.state/'control.sock'));_sk.sendall(json.dumps({'method':'ui.connect'}).encode()+b'\n')
        from jaunt.crypto import b64 as _b64
        _sk.makefile('r').readline();_sk.sendall((json.dumps({'type':'terminal.input','id':sidB3,'data':_b64(b'codex\r')})+'\n').encode())
        for _ in range(40):
            if any(x['id']==sidB3 and x['program']=='codex' for x in status(B)['sessions']):break
            time.sleep(.5)
        else:raise AssertionError('the stand-in codex was not detected as the program of the shell')
        peers=mcp.tool('jaunt_peers',{});assert f'homelab/{idBcodex}' in peers and f'homelab/{idBclaude}' in peers and 'turned off on this host (this machine)' in peers,peers
        assert 'a codex session is open in terminal' in peers and 'NOT registered' in peers,peers
        _sk.close()
        passed('with messages on, jaunt_peers lists the registered Claude Code and Codex sessions of the linked machine, names the unregistered Codex program, and the local bridge stays off')
        sent=mcp.tool('jaunt_send',{'to':f'homelab/{idBcodex}','text':'ping codex'});assert 'Delivered to homelab/' in sent,sent
        for _ in range(20):
            if queue_log.exists() and 'ping codex' in queue_log.read_text():break
            time.sleep(.25)
        text=queue_log.read_text();assert '--thread\nconvB-codex-0001' in text and '[jaunt bridge]' in text and 'on the machine "laptop"' in text and f'to="laptop/{idA}"' in text,text
        sent=mcp.tool('jaunt_send',{'to':f'homelab/{idBclaude}','text':'ping claude'});msg_id=sent.split('message id ')[1].split(')')[0]
        for _ in range(20):
            if any(f.get('type')=='user' for f in frames):break
            time.sleep(.25)
        user=[f for f in frames if f.get('type')=='user'][0]['message']['content'];assert 'ping claude' in user and f'from-name="jaunt · laptop/{idA}"' in user and 'from-mode="prompting"' in user,user
        passed('a session sends to a Codex and to a Claude Code session on the other machine, same runtime included; each lands in the runtime\'s own inbox with its provenance')
        mcpB=Mcp(B,sidB2);box={}
        def waiter():box['r']=mcp.tool('jaunt_wait_reply',{'id':msg_id,'seconds':40},timeout=60)
        t=_threading.Thread(target=waiter,daemon=True);t.start();time.sleep(1.5)
        reply=mcpB.tool('jaunt_send',{'to':f'laptop/{idA}','text':'pong from homelab','in_reply_to':msg_id});assert 'Delivered to laptop/' in reply,reply
        t.join(60);assert 'pong from homelab' in box.get('r','') and 'homelab/' in box['r'],box.get('r')
        log=json.loads(A.cli('agents','log'));assert any(e.get('kind')=='message' and e.get('status')=='delivered' for e in log)
        passed('the reply travels back over the other link and is handed to the waiting call; both hosts journal the exchange')
        B.cli('agents','disable','messages')
        refused=mcp.tool('jaunt_send',{'to':f'homelab/{idBcodex}','text':'again'},timeout=60);assert 'off on homelab' in refused,refused
        A.cli('agents','disable','messages');mcpB.close();srv.close()
        assert not status(A)['machine']['bridge']['participants'],'nothing registers once messages and the bridge are off'
        passed('turning messages off on the target refuses further messages; off on both, the sessions are forgotten')
        B.cli('unlink',json.loads(B.cli('links'))[0]['room'])
        A.cli('unlink',links[0]['room'])
        # The messaging bridge is untouched: no hooks were installed for agents alone, and bridge status is off.
        bridge=json.loads(subprocess.check_output([sys.executable,'-c','''
import json,sys;sys.path.insert(0,sys.argv[1]);from jaunt.cli import control;print(json.dumps(control("bridge.status" if False else "status")["machine"]["bridge"]))''',str(ROOT/'host')],env=A.env))
        assert not bridge.get('enabled') and not bridge.get('participants')
        passed('the Claude Code ↔ Codex bridge stays off and unchanged while agents and machines is on')
        mcp.close();print(f'{len(checks)} agents checks passed.')
    finally:
        A.close();B.close()

if __name__=='__main__':main()
