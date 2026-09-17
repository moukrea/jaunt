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
        env={**host.env,'jaunt_SESSION_ID':session};self.p=subprocess.Popen([sys.executable,'-m','jaunt.cli','bridge-mcp','claude','--state',str(host.state)],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True);self.n=0
        self.call('initialize',{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'e2e','version':'0'}})
    def call(self,method,params=None,timeout=200):
        self.n+=1;self.p.stdin.write(json.dumps({'jsonrpc':'2.0','id':self.n,'method':method,'params':params or {}})+'\n');self.p.stdin.flush()
        deadline=time.time()+timeout
        while time.time()<deadline:
            line=self.p.stdout.readline()
            if not line:raise AssertionError('MCP server exited')
            m=json.loads(line)
            if m.get('id')==self.n:return m
        raise AssertionError('MCP reply timed out')
    def tools(self):return [t['name'] for t in self.call('tools/list')['result']['tools']]
    def tool(self,name,args,timeout=200):
        r=self.call('tools/call',{'name':name,'arguments':args},timeout);return r['result']['content'][0]['text']
    def close(self):self.p.kill()

def main():
    A=Harness(name='laptop');B=Harness(name='homelab',extra_env={'jaunt_AGENT_LEASE':'4'})
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
        def approve(decision):
            def wait():
                pending=json.loads(B.cli('agents','pending'))
                if pending:
                    B.cli('agents','allow' if decision!='deny' else 'deny',pending[0]['id'],*(['--trust',decision] if decision in ('1h','24h','always') else []));return True
                return False
            return wait
        import threading
        def approver(decision):
            def run():
                for _ in range(60):
                    if approve(decision)():return
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
