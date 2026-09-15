#!/usr/bin/env python3
"""Exercise install.sh against a real local release mirror and real relay.

The explicit OFFLINE_TEST flag reuses installed runtime dependencies. The normal
installer downloads them from PyPI. This test does not validate external networks
or a real systemd/launchd service manager.
"""
from __future__ import annotations
import functools,http.server,json,os,shutil,socket,subprocess,sys,tempfile,threading,time,tomllib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def freeport():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def main():
    checks=[]
    version=tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['version']
    tag='v'+version.replace('b','-beta.')
    def passed(s):checks.append(s);print('PASS',s,flush=True)
    with tempfile.TemporaryDirectory(prefix='jaunt-install-test-') as tmp:
        t=Path(tmp);mirror=t/'mirror';mirror.mkdir();relayport=freeport()
        shutil.copytree(ROOT/'web',mirror,dirs_exist_ok=True)
        release=json.loads((ROOT/'dist/host-manifest.json').read_text())
        for name in ('host-manifest.json','SHA256SUMS',release['wheel']):shutil.copy2(ROOT/'dist'/name,mirror/name)
        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self,*_):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(mirror)))
        threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
        config={'version':1,'relay':f'ws://127.0.0.1:{relayport}','release':tag,'page':url+'/'}
        (mirror/'config.json').write_text(json.dumps(config))
        env={**os.environ,'jaunt_DEV_INSTALL':'1','jaunt_TEST_SYSTEM_SITE':'1','jaunt_PIP_NO_DEPS':'1',
             'jaunt_PREFIX':str(t/'runtime'),'jaunt_BIN_DIR':str(t/'bin'),'jaunt_STATE':str(t/'state'),
             'jaunt_PAGE_URL':url,'jaunt_RELEASE_BASE':url,'jaunt_NO_SERVICE':'1','jaunt_SKIP_PAIR':'1',
             'PIP_NO_INDEX':'1','PIP_DISABLE_PIP_VERSION_CHECK':'1'}
        sentinels=t/'service-manager-sentinels';sentinels.mkdir()
        service_calls=t/'unexpected-service-manager-call'
        for binary in ('systemctl','launchctl'):
            script=sentinels/binary
            script.write_text('#!/bin/sh\nprintf called >> '+str(service_calls)+'\nexit 99\n')
            script.chmod(0o700)
        env['PATH']=str(sentinels)+os.pathsep+env['PATH']
        env.pop('PYTHONPATH',None) # The wheel, not the source tree, must be imported.
        # This tool environment itself is a venv; nested --system-site-packages
        # inherits its base interpreter rather than the outer venv dependencies.
        # Share dependency directories only, never ROOT/host; verify wheel origin below.
        import websockets, cryptography, qrcode
        env['PYTHONPATH']=os.pathsep.join(sorted({str(Path(m.__file__).resolve().parents[1]) for m in (websockets,cryptography,qrcode)}))
        online=os.environ.get('jaunt_INSTALLER_ONLINE')=='1'
        if online:
            for key in ('jaunt_TEST_SYSTEM_SITE','jaunt_PIP_NO_DEPS','PIP_NO_INDEX','PYTHONPATH'):
                env.pop(key,None)
        log=(t/'relay.log').open('w')
        relay=subprocess.Popen([sys.executable,str(ROOT/'scripts/dev_relay.py'),'--port',str(relayport)],stdout=log,stderr=log)
        exe=t/'bin/jaunt'
        def install(extra=None):return subprocess.run(['bash',str(ROOT/'install.sh')],env={**env,**(extra or {})},capture_output=True,text=True,timeout=180)
        def cli(*args):return subprocess.check_output([str(exe),*args],env=env,text=True,timeout=30)
        try:
            # Checksum failure must precede any runtime switch or host modification.
            manifest=json.loads((mirror/'host-manifest.json').read_text());correct=manifest['sha256'];manifest['sha256']='0'*64
            (mirror/'host-manifest.json').write_text(json.dumps(manifest));bad=install()
            assert bad.returncode and 'checksum mismatch' in bad.stderr.lower(),bad.stdout+bad.stderr
            assert not exe.exists();passed('tampered release checksum rejected before installing')
            manifest['sha256']=correct;(mirror/'host-manifest.json').write_text(json.dumps(manifest))
            result=install();assert result.returncode==0,result.stdout+result.stderr
            deadline=time.time()+10
            while time.time()<deadline:
                status=json.loads(cli('status'))
                if status['connected']:break
                time.sleep(.1)
            assert status['connected'];room=status['machine']['room'];pid=status['pid']
            assert cli('--version').strip()==version;passed('wheel installed in private runtime; actual daemon connects to relay')
            py=t/'runtime/current/bin/python'
            origin=subprocess.check_output([str(py),'-c','import jaunt;print(jaunt.__file__)'],env=env,text=True).strip()
            assert Path(origin).resolve().is_relative_to(t/'runtime/versions') and '/site-packages/' in origin
            passed('installed wheel imported, not editable project source')
            pairing=json.loads(cli('pair','--json'));assert pairing['code'].startswith('jaunt1.')
            passed('installer host produces usable pairing capability')
            # Populate a remembered device; no shell is running, so upgrade is safe.
            cli('stop');time.sleep(.7)
            state=t/'state/host.json';data=json.loads(state.read_text());data['devices']['installation-test']={'name':'fixture','secret':'not-a-real-test-secret','created':1,'lastSeen':1};state.write_text(json.dumps(data));state.chmod(0o600)
            cli('start');result=install();assert result.returncode==0,result.stdout+result.stderr
            now=json.loads(cli('status'));assert now['machine']['room']==room
            assert 'installation-test' in json.loads(state.read_text())['devices']
            passed('upgrade preserves host identity and remembered device records')
            assert json.loads(cli('doctor'))['running'];passed('doctor reads installed runtime state')
            from playwright.sync_api import sync_playwright, expect
            with sync_playwright() as pw:
                browser=pw.chromium.launch(args=['--no-sandbox'])
                page=browser.new_page()
                page.goto(json.loads(cli('pair','--json'))['url'])
                expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
                page.locator('#new-session-folder').click()
                page.get_by_label('Working directory').fill(str(t))
                page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
                expect(page.get_by_role('tab')).to_have_count(1)
                created=json.loads(cli('status'))['sessions'][0]
                expect(page.get_by_role('tab')).to_have_text(created['name'])
                assert created['name'].endswith(' 1')
                before=json.loads(cli('status'));pointer=(t/'runtime/current').resolve()
                assert before['sessions'][0]['alive']
                refused=install()
                assert refused.returncode and 'plain shells are running' in refused.stderr
                after=json.loads(cli('status'))
                assert after['pid']==before['pid'] and after['sessions'][0]['pid']==before['sessions'][0]['pid']
                assert after['sessions'][0]['alive'] and (t/'runtime/current').resolve()==pointer
                passed('installer refuses upgrade with active real shell, preserving daemon and runtime')
                devices=set(json.loads((t/'state/host.json').read_text())['devices'])
                approved=install({'jaunt_ALLOW_RESTART':'1'})
                assert approved.returncode==0,approved.stdout+approved.stderr
                after=json.loads(cli('status'))
                assert after['pid']!=before['pid'] and after['sessions']==[]
                assert after['machine']['room']==room
                assert set(json.loads((t/'state/host.json').read_text())['devices'])==devices
                expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=20000)
                passed('explicit restart ends plain shell, preserves identity/devices and reconnects browser')
                assert not service_calls.exists(), 'No-service installation invoked the account service manager'
                passed('no-service installation never calls systemctl or launchctl')
                browser.close()
        finally:
            if exe.exists():subprocess.run([str(exe),'stop'],env=env,capture_output=True,timeout=15)
            relay.kill();relay.wait(timeout=5);server.shutdown();log.close()
    out=ROOT/'test-results';out.mkdir(exist_ok=True)
    (out/'installer-report.json').write_text(json.dumps({'passed':checks,'mode':('Local mirror, fresh PyPI dependencies, no service manager' if online else 'Offline local mirror, runtime dependencies inherited for test only; no service manager')},indent=2)+'\n')
    print(f'{len(checks)} installer checks passed.',flush=True)
if __name__=='__main__':main()
