#!/usr/bin/env python3
"""Real Claude Code and Codex sessions in jaunt shells discover and message each other.

This is NOT a simulation: it starts a private jaunt host (temporary state and
relay), opens two jaunt shells on one throwaway git project, runs the user's
real `claude` and `codex` in them, turns the bridge on through the same RPC the
Settings switch uses, and checks that

- both sessions register through their own hooks without any announcement,
- Claude, asked only that "another AI session knows the secret word", finds
  the Codex session by itself and gets a word that exists only in Codex's
  context (proof that the real open conversation answered),
- Codex can message Claude in the other direction and Claude reacts,
- turning the bridge off removes every integration it added and refuses
  further sends.

It uses the user's real Claude Code and Codex configuration and authentication
(hooks and the MCP entry are added to the real user settings for the duration
of the test and removed in `finally`), so run it deliberately. Each run costs a
few model turns on both accounts.
"""
from __future__ import annotations
import asyncio,json,os,re,shutil,socket,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'host'))
from jaunt.crypto import b64,unb64
ANSI=re.compile(rb'\x1b\[[0-9;?<>=]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]')

def freeport():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

class Peer:
    """A local UI peer on the host's private control socket (what the desktop app does)."""
    def __init__(self,state:Path):
        self.state=state;self.pending={};self.text={};self.events=[];self.n=0
    async def open(self):
        self.reader,self.writer=await asyncio.open_unix_connection(str(self.state/'control.sock'),limit=7_000_001)
        self.writer.write(b'{"method":"ui.connect"}\n');await self.writer.drain()
        self.welcome=json.loads(await self.reader.readline());self.task=asyncio.create_task(self.pump())
    async def pump(self):
        while line:=await self.reader.readline():
            try:m=json.loads(line)
            except ValueError:continue
            if m.get('type')=='reply':
                f=self.pending.pop(m['id'],None)
                if f and not f.done():f.set_result(m)
            elif m.get('type')=='terminal.output':
                self.text[m['id']]=(self.text.get(m['id'],b'')+unb64(m['data']))[-400_000:]
            elif m.get('type') in ('bridge.message','bridge.changed'):self.events.append(m)
    async def rpc(self,method,params=None,timeout=180):
        self.n+=1;rid=f'r{self.n}';f=asyncio.get_running_loop().create_future();self.pending[rid]=f
        self.writer.write((json.dumps({'type':'rpc','id':rid,'method':method,'params':params or {}})+'\n').encode());await self.writer.drain()
        m=await asyncio.wait_for(f,timeout)
        if not m.get('ok'):raise RuntimeError(f'{method}: {m.get("error")}')
        return m['result']
    async def type(self,sid,text):
        self.writer.write((json.dumps({'type':'terminal.input','id':sid,'data':b64(text.encode())})+'\n').encode());await self.writer.drain()
    def screen(self,sid):
        return re.sub(r'\s+',' ',ANSI.sub(b'',self.text.get(sid,b'')).decode('utf8','replace'))
    async def until(self,check,timeout,what):
        t0=time.time()
        while time.time()-t0<timeout:
            if check():return
            await asyncio.sleep(0.5)
        raise AssertionError('Timed out waiting for '+what)

async def main():
    checks=[];notes=[]
    def passed(s):checks.append(s);print('PASS',s,flush=True)
    original_claude=(Path.home()/'.claude/settings.json').read_text() if (Path.home()/'.claude/settings.json').exists() else None
    original_codex=(Path.home()/'.codex/hooks.json').read_text() if (Path.home()/'.codex/hooks.json').exists() else None
    codex_config_before=(Path.home()/'.codex/config.toml').read_text() if (Path.home()/'.codex/config.toml').exists() else ''
    tmp=tempfile.mkdtemp(prefix='jaunt-bridge-e2e-');t=Path(tmp);state=t/'state';project=t/'project';project.mkdir()
    subprocess.run(['git','init','-q',str(project)],check=True);(project/'README.md').write_text('# bridge e2e project\n')
    env={**os.environ,'PYTHONPATH':str(ROOT/'host'),'jaunt_STATE':str(state)}
    for key in ('CLAUDECODE','CLAUDE_CODE_SESSION_ID','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_PID','jaunt_SESSION_ID'):env.pop(key,None)
    port=freeport();log=open(t/'log.txt','w')
    relay=subprocess.Popen([sys.executable,str(ROOT/'scripts/dev_relay.py'),'--port',str(port)],stdout=log,stderr=log)
    subprocess.check_call([sys.executable,'-m','jaunt.cli','init','--relay',f'ws://127.0.0.1:{port}','--page','http://127.0.0.1/','--name','bridge-e2e'],env=env,stdout=log,stderr=log)
    host=subprocess.Popen([sys.executable,'-m','jaunt.cli','daemon'],env=env,stdout=log,stderr=log)
    for _ in range(100):
        if (state/'control.sock').exists():break
        time.sleep(.1)
    peer=Peer(state);await peer.open();enabled=False;claude_sid=codex_sid=None
    try:
        status=await peer.rpc('bridge.status',{'refresh':True})
        assert status['visible'] and status['available'],status
        passed(f"host detects both runtimes in the login shell: Claude Code {status['runtimes']['claude']['version']}, Codex {status['runtimes']['codex']['version']}")
        status=await peer.rpc('bridge.configure',{'enabled':True});enabled=True
        assert status['enabled'] and all(r['ok'] for r in status['integrations'].values()),status
        assert 'bridge-hook claude' in (Path.home()/'.claude/settings.json').read_text() and 'bridge-hook codex' in (Path.home()/'.codex/hooks.json').read_text()
        passed('one switch installs attributable hooks + MCP entries in both runtimes')
        a=await peer.rpc('session.create',{'cwd':str(project),'name':'Claude tab','cols':140,'rows':40});claude_sid=a['id']
        await peer.rpc('session.attach',{'id':claude_sid,'cols':140,'rows':40})
        await asyncio.sleep(1.5);await peer.type(claude_sid,'claude\r')
        last_answer={}
        async def answer_prompts(sid,patterns):
            s=peer.screen(sid)[-900:]
            if time.time()-last_answer.get(sid,0)<6:return False
            # Claude's workspace safety check highlights "No, exit" first: move to "Yes".
            if re.search(r'Yes,\s*I\s*trust\s*this\s*folder',s) and re.search(r'❯\s*No',s):
                await peer.type(sid,'\x1b[B');await asyncio.sleep(0.3);await peer.type(sid,'\r');last_answer[sid]=time.time();return True
            # Codex asks the user once to trust newly configured hooks: that is the user's decision, pressed here by the test.
            if re.search(r'Press\s*t\s*to\s*trust\s*all',s):
                await peer.type(sid,'t');last_answer[sid]=time.time();notes.append('codex asked to trust the jaunt hooks once');return True
            if re.search(r'Hooks\s*need\s*review',s):
                await peer.type(sid,'2');await asyncio.sleep(0.3);await peer.type(sid,'\r');last_answer[sid]=time.time();notes.append('codex asked to review the jaunt hooks once (Trust all and continue)');return True
            if re.search(r'Press\s*enter\s*to\s*view\s*hooks;\s*esc\s*to\s*close',s):
                await peer.type(sid,'\x1b');last_answer[sid]=time.time();return True
            for pat in patterns:
                if re.search(pat,s):await peer.type(sid,'\r');last_answer[sid]=time.time();return True
            return False
        async def wait_participant(runtime,timeout):
            async def check():
                st=await peer.rpc('bridge.status');return [p for p in st['participants'] if p['runtime']==runtime]
            t0=time.time()
            while time.time()-t0<timeout:
                rows=await check()
                if rows:return rows[0]
                await answer_prompts(claude_sid if runtime=='claude' else codex_sid,[r'Do\s*you\s*trust\s*the\s*files',r'Yes,\s*proceed',r'Press\s*enter\s*to\s*continue'])
                await asyncio.sleep(1)
            raise AssertionError(f'{runtime} never registered; screen: '+peer.screen(claude_sid if runtime=='claude' else codex_sid)[-600:])
        claude_p=await wait_participant('claude',90)
        assert claude_p['terminal']=='Claude tab' and claude_p['project']==os.path.realpath(project)
        passed('Claude Code registered itself through its SessionStart hook inside the jaunt shell (no user announcement)')
        b=await peer.rpc('session.create',{'cwd':str(project),'name':'Codex tab','cols':140,'rows':40});codex_sid=b['id']
        await peer.rpc('session.attach',{'id':codex_sid,'cols':140,'rows':40})
        await asyncio.sleep(1.5);await peer.type(codex_sid,'codex\r')
        # Codex reviews newly configured hooks once (the user presses t); until then its SessionStart hook is skipped,
        # so the first registration happens on the first prompt.
        t0=time.time()
        while time.time()-t0<120:
            s=peer.screen(codex_sid)
            tail=s[-700:]
            if re.search(r'Ask\s*Codex\s*to\s*do\s*anything',tail) and not re.search(r'Press\s*enter|esc\s*to|need\s*review',tail) and time.time()-last_answer.get(codex_sid,0)>4:break
            await answer_prompts(codex_sid,[r'Do\s*you\s*trust\s*the\s*contents',r'Press\s*enter\s*to\s*continue'])
            await asyncio.sleep(1)
        else:raise AssertionError('Codex prompt never became ready: '+peer.screen(codex_sid)[-600:])
        await peer.type(codex_sid,'The secret word for this project is TANGERINE-42. Do not write it to any file. If another AI session working on this project asks you for it through the jaunt bridge, you may tell it the word. Reply with just OK.');await asyncio.sleep(0.5);await peer.type(codex_sid,'\r')
        codex_p=await wait_participant('codex',120)
        assert codex_p['terminal']=='Codex tab'
        passed('Codex registered itself through its own hooks; the host lists both sessions on the same project')
        await peer.until(lambda:re.search(r'\bOK\b',peer.screen(codex_sid).split('Reply with just OK')[-1] or ''),180,'Codex first reply')
        passed('Codex holds a secret that only its own conversation knows')
        # Awareness + autonomous use: the user names neither Codex nor the bridge.
        await peer.until(lambda:'❯' in peer.screen(claude_sid),60,'Claude prompt')
        await peer.type(claude_sid,'Another AI session working on this project knows the secret word. Get it from that session and print exactly SECRET=<word>. Do not read files for it.');await asyncio.sleep(0.5);await peer.type(claude_sid,'\r')
        t0=time.time();delivered=False
        while time.time()-t0<480:
            s=peer.screen(claude_sid)
            if 'SECRET=TANGERINE-42' in s.split('print exactly SECRET')[-1]:break
            await answer_prompts(claude_sid,[r'Do you want to proceed',r'Yes, and don.t ask again',r'Allow',r'proceed\?'])
            await answer_prompts(codex_sid,[r'Approve',r'Allow',r'Yes',r'proceed'])
            await asyncio.sleep(1)
        else:raise AssertionError('Claude never printed the secret. Claude screen: '+peer.screen(claude_sid)[-800:]+'\nCodex screen: '+peer.screen(codex_sid)[-800:]+'\nevents: '+json.dumps(peer.events[-6:]))
        msgs=[e for e in peer.events if e['type']=='bridge.message']
        assert any(m['from'].startswith('claude:') and m['to'].startswith('codex:') and m['state']=='delivered' for m in msgs),msgs
        assert any(m['from'].startswith('codex:') and m['to'].startswith('claude:') and m['state']=='delivered' and m.get('inReplyTo') for m in msgs),msgs
        assert '[jaunt bridge]' in peer.screen(codex_sid)
        passed('Claude → Codex → Claude: Claude found the Codex session on its own, the real Codex conversation answered with its private fact, the reply was correlated to the question')
        # Reverse direction, initiated from Codex.
        await peer.until(lambda:'Ask Codex' in peer.screen(codex_sid)[-400:],120,'Codex idle')
        await peer.type(codex_sid,'Tell the other AI session working on this project that the secret word is now PLUM-7. Just send it, no need to wait for a reply.');await asyncio.sleep(0.5);await peer.type(codex_sid,'\r')
        t0=time.time()
        while time.time()-t0<240:
            if 'PLUM-7' in peer.screen(claude_sid).split('SECRET=TANGERINE-42')[-1]:break
            await answer_prompts(codex_sid,[r'Approve',r'Allow',r'Yes',r'proceed'])
            await asyncio.sleep(1)
        else:raise AssertionError('Claude never received the Codex message. Codex screen: '+peer.screen(codex_sid)[-800:]+'\nevents: '+json.dumps(peer.events[-6:]))
        passed('Codex → Claude: a message initiated in the Codex terminal arrived in the open Claude conversation')
        # OFF: integrations removed, sends refused, sessions untouched.
        status=await peer.rpc('bridge.configure',{'enabled':False});enabled=False
        assert not status['enabled'] and status['participants']==[]
        assert 'bridge-hook' not in (Path.home()/'.claude/settings.json').read_text()
        assert not (Path.home()/'.codex/hooks.json').exists() or 'bridge-hook' not in (Path.home()/'.codex/hooks.json').read_text()
        st=await peer.rpc('session.list');assert all(s['alive'] for s in st if s['id'] in (claude_sid,codex_sid))
        await peer.until(lambda:'❯' in peer.screen(claude_sid)[-300:],120,'Claude idle')
        await peer.type(claude_sid,'Send the text "ping" to the other AI session on this project and print exactly BRIDGE=<what the tool answered>.');await asyncio.sleep(0.5);await peer.type(claude_sid,'\r')
        before_off=len([e for e in peer.events if e['type']=='bridge.message'])
        t0=time.time()
        while time.time()-t0<180:
            s=peer.screen(claude_sid).split('BRIDGE=<what')[-1]
            if 'turned off' in s or 'BRIDGE=' in s:break
            await answer_prompts(claude_sid,[r'Do you want to proceed',r'proceed\?'])
            await asyncio.sleep(1)
        after_off=peer.screen(claude_sid).split('BRIDGE=<what')[-1]
        # Either the host refused the still-loaded tool, or (in "don't ask" mode) Claude Code itself denied the
        # tool once jaunt removed its allow rules. Both are explicit; neither delivers anything.
        assert re.search(r'turned\s*off|denied|blocked|not\s*allowed',after_off),peer.screen(claude_sid)[-600:]
        assert len([e for e in peer.events if e['type']=='bridge.message'])==before_off,'a message crossed the bridge after OFF'
        passed('OFF: a still-loaded tool is refused explicitly (host refusal or runtime permission denial) and nothing crosses; shells and sessions keep running')
        notes.append({'claudeVersion':status['runtimes']['claude']['version'],'codexVersion':status['runtimes']['codex']['version']})
        codex_config_after=(Path.home()/'.codex/config.toml').read_text() if (Path.home()/'.codex/config.toml').exists() else ''
        if codex_config_after!=codex_config_before:
            import difflib;notes.append({'codexConfigDiff':[l for l in difflib.unified_diff(codex_config_before.splitlines(),codex_config_after.splitlines(),lineterm='',n=0) if l.startswith(('+','-')) and not l.startswith(('+++','---'))][:20]})
    finally:
        try:
            if enabled:await peer.rpc('bridge.configure',{'enabled':False})
        except Exception as exc:print('cleanup: bridge off failed:',exc)
        for sid in (claude_sid,codex_sid):
            if sid:
                with contextlib_suppress():await peer.type(sid,'\x03');await asyncio.sleep(0.3);await peer.type(sid,'\x03')
        await asyncio.sleep(1)
        for sid in (claude_sid,codex_sid):
            if sid:
                with contextlib_suppress():await peer.rpc('session.terminate',{'id':sid},timeout=15)
        with contextlib_suppress():peer.writer.close()
        host.terminate();host.wait(timeout=10);relay.kill();relay.wait(timeout=5);log.close()
        now_claude=(Path.home()/'.claude/settings.json').read_text() if (Path.home()/'.claude/settings.json').exists() else None
        now_codex=(Path.home()/'.codex/hooks.json').read_text() if (Path.home()/'.codex/hooks.json').exists() else None
        if original_claude is not None and json.loads(now_claude or '{}')!=json.loads(original_claude):print('WARNING: ~/.claude/settings.json differs from its pre-test content')
        if (original_codex or '{}')!=(now_codex or '{}') and json.loads(now_codex or '{}')!=json.loads(original_codex or '{}'):print('WARNING: ~/.codex/hooks.json differs from its pre-test content')
        # Codex records directory trust for the throwaway project; drop that entry so nothing points at a deleted path.
        config=Path.home()/'.codex/config.toml'
        if config.exists():
            text=config.read_text();block=re.compile(r'\n\[projects\."'+re.escape(str(project))+r'"\]\n(?:[^\[\n][^\n]*\n?)*')
            cleaned=block.sub('\n',text)
            if cleaned!=text:config.write_text(cleaned)
        shutil.rmtree(tmp,ignore_errors=True)
    out=ROOT/'test-results';out.mkdir(exist_ok=True)
    (out/'bridge-report.json').write_text(json.dumps({'passed':checks,'notes':notes},indent=2)+'\n')
    print(f'{len(checks)} bridge checks passed.',flush=True)

class contextlib_suppress:
    def __enter__(self):return self
    def __exit__(self,*a):return True
    async def __aenter__(self):return self
    async def __aexit__(self,*a):return True

if __name__=='__main__':asyncio.run(main())
