#!/usr/bin/env python3
"""A client drives a real host self-update end to end, through the real updater.

Installs the current wheel with install.sh (explicit offline dev mirror), opens
a shell from the browser, publishes a strictly newer release on the mirror and
clicks "Check for updates" in Settings. The host must download, verify, install
and replace its runtime in place while the browser follows every pushed state,
keeps the same shell (same PIDs) and can run a command afterwards. A second
check reports "Up to date". A broken newer release must fail with the
installer's own reason, keep the previous runtime serving and leave the shell
untouched. This test never touches a real user host: everything lives in a
temporary directory with its own state, relay and service-manager sentinels.
"""
from __future__ import annotations
import asyncio,functools,hashlib,http.server,io,json,os,re,shutil,socket,subprocess,sys,tempfile,threading,time,tomllib,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def freeport():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def bumped_wheel(source:Path,old:str,new:str,*,broken:bool=False)->bytes:
    """Repack the built wheel under a higher version so the updater sees a real upgrade."""
    out=io.BytesIO()
    with zipfile.ZipFile(source) as src,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data=src.read(item)
            name=item.filename.replace(f'jaunt_host-{old}.dist-info',f'jaunt_host-{new}.dist-info')
            if name.endswith('.dist-info/METADATA'):data=data.replace(f'Version: {old}'.encode(),f'Version: {new}'.encode())
            if name=='jaunt/__init__.py':data=data.replace(f'__version__ = "{old}"'.encode(),f'__version__ = "{new}"'.encode())
            if name.endswith('.dist-info/RECORD'):data=data.replace(f'jaunt_host-{old}.dist-info'.encode(),f'jaunt_host-{new}.dist-info'.encode())
            if broken and name=='jaunt/handoff.py':continue  # The installer's runtime check must refuse it.
            dst.writestr(name,data)
    return out.getvalue()

def publish(mirror:Path,config:dict,tag:str,wheel_name:str,wheel:bytes):
    (mirror/wheel_name).write_bytes(wheel)
    digest=hashlib.sha256(wheel).hexdigest()
    (mirror/'host-manifest.json').write_text(json.dumps({'schema':1,'wheel':wheel_name,'sha256':digest}))
    (mirror/'SHA256SUMS').write_text(f'{digest}  {wheel_name}\n')
    config['release']=tag;(mirror/'config.json').write_text(json.dumps(config))

async def main():
    from playwright.async_api import async_playwright,expect
    checks=[]
    def passed(s):checks.append(s);print('PASS',s,flush=True)
    version=tomllib.loads((ROOT/'pyproject.toml').read_text())['project']['version']
    tag='v'+version.replace('b','-beta.')
    manifest=json.loads((ROOT/'dist/host-manifest.json').read_text());assert manifest['wheel']==f'jaunt_host-{version}-py3-none-any.whl','Run scripts/build_release.py first'
    with tempfile.TemporaryDirectory(prefix='jaunt-client-update-') as tmp:
        t=Path(tmp);mirror=t/'mirror';mirror.mkdir();relayport=freeport()
        shutil.copytree(ROOT/'web',mirror,dirs_exist_ok=True)
        for name in ('host-manifest.json','SHA256SUMS',manifest['wheel']):shutil.copy2(ROOT/'dist'/name,mirror/name)
        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self,*_):pass
            def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(mirror)))
        threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
        config={'version':1,'relay':f'ws://127.0.0.1:{relayport}','release':tag,'page':url+'/'}
        (mirror/'config.json').write_text(json.dumps(config))
        env={**os.environ,'jaunt_DEV_INSTALL':'1','jaunt_TEST_SYSTEM_SITE':'1','jaunt_PIP_NO_DEPS':'1',
             'jaunt_PREFIX':str(t/'runtime'),'jaunt_BIN_DIR':str(t/'bin'),'jaunt_STATE':str(t/'state'),
             'jaunt_DESKTOP_ROOT':str(t/'desktop'),'jaunt_PAGE_URL':url,'jaunt_RELEASE_BASE':url,'jaunt_NO_SERVICE':'1','jaunt_SKIP_PAIR':'1',
             'PIP_NO_INDEX':'1','PIP_DISABLE_PIP_VERSION_CHECK':'1','HOME':str(t/'home')}
        (t/'home').mkdir()
        for key in ('DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','BASH_ENV','ENV'):env.pop(key,None)
        shell=t/'test-shell';shell.write_text('#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n');shell.chmod(0o700);env['SHELL']=str(shell)
        sentinels=t/'sentinels';sentinels.mkdir();service_calls=t/'unexpected-service-manager-call'
        for binary in ('systemctl','launchctl'):
            script=sentinels/binary;script.write_text('#!/bin/sh\nprintf called >> '+str(service_calls)+'\nexit 99\n');script.chmod(0o700)
        env['PATH']=str(sentinels)+os.pathsep+env['PATH'];env.pop('PYTHONPATH',None)
        import websockets,cryptography,qrcode
        env['PYTHONPATH']=os.pathsep.join(sorted({str(Path(m.__file__).resolve().parents[1]) for m in (websockets,cryptography,qrcode)}))
        log=(t/'relay.log').open('w')
        relay=subprocess.Popen([sys.executable,str(ROOT/'scripts/dev_relay.py'),'--port',str(relayport)],stdout=log,stderr=log)
        exe=t/'bin/jaunt'
        def cli(*args):return subprocess.check_output([str(exe),*args],env=env,text=True,timeout=30)
        def status_file():
            try:return json.loads((t/'state/update-status.json').read_text())
            except (OSError,ValueError):return {}
        browser=None
        try:
            result=subprocess.run(['bash',str(ROOT/'install.sh')],env=env,capture_output=True,text=True,timeout=300)
            assert result.returncode==0,result.stdout+result.stderr
            installed=json.loads((t/'state/installation.json').read_text());assert installed['tag']==tag and installed['dev']['releaseBase']==url
            for _ in range(100):
                if json.loads(cli('status'))['connected']:break
                time.sleep(.1)
            passed('current release installed through install.sh with a private dev mirror recorded for self-updates')
            async with async_playwright() as pw:
                browser=await pw.chromium.launch(args=['--no-sandbox']);context=await browser.new_context(locale='en-US');page=await context.new_page()
                await page.goto(json.loads(cli('pair','--json'))['url'])
                await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
                await page.locator('#new-session-folder').click();await page.get_by_label('Working directory').fill(str(t))
                await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
                area=page.locator('.terminal-container:not([hidden]) textarea')
                await expect(area).to_be_enabled(timeout=30000);await area.focus()
                await page.keyboard.type('export UPDATE_PROOF=kept; printf before > update-proof.txt');await page.keyboard.press('Enter')
                for _ in range(100):
                    if (t/'update-proof.txt').exists():break
                    await asyncio.sleep(.1)
                assert (t/'update-proof.txt').read_text()=='before'
                before=json.loads(cli('status'));pointer=(t/'runtime/current').resolve()
                # 1. Up to date: the published release equals the running one.
                await page.locator('#settings-button').click()
                await page.get_by_role('button',name='Check for updates',exact=True).click()
                row=page.locator('#activity .activity-row').first
                await expect(row.locator('[role=status]')).to_contain_text('Up to date',timeout=30000)
                assert status_file()['state']=='current' and status_file()['version']==tag
                passed('manual check against the same published release reports "Up to date" in the activity row')
                # 2. A strictly newer release: the client follows pushed progress across the runtime handoff.
                newer='v'+version.replace('b','-beta.').rsplit('.',1)[0]+'.'+str(int(version.rsplit('b',1)[1])+1)
                newer_pep=newer[1:].replace('-beta.','b')
                publish(mirror,config,newer,f'jaunt_host-{newer_pep}-py3-none-any.whl',bumped_wheel(ROOT/'dist'/manifest['wheel'],version,newer_pep))
                await page.get_by_role('button',name='Check for updates',exact=True).click()
                row=page.locator('#activity .activity-row').first
                seen=set();deadline=time.time()+240
                while time.time()<deadline:
                    text=await row.locator('[role=status]').text_content()
                    seen.add(text.split(' · ')[0])
                    if 'Update installed' in text:break
                    if 'Update failed' in text or 'Cancelled' in text:raise AssertionError('Update failed in the UI: '+text+'\n'+(t/'state/update.log').read_text(errors='replace')[-3000:])
                    await asyncio.sleep(.25)
                else:raise AssertionError('Update never completed. Seen: %r; status=%r; log tail:\n%s'%(seen,status_file(),(t/'state/update.log').read_text(errors='replace')[-3000:]))
                assert status_file()['state']=='installed' and status_file()['version']==newer,status_file()
                assert {'Checking published version…','Update installed'}<=seen or 'Update installed' in ' '.join(seen),seen
                progress_states={s for s in seen if s.startswith(('Downloading','Verifying','Installing','Preparing','Replacing','Restarting','Updating the host service'))}
                assert progress_states,'No intermediate state was pushed to the client: %r'%seen
                await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
                after=json.loads(cli('status'))
                assert after['pid']==before['pid'] and after['sessions'][0]['pid']==before['sessions'][0]['pid'] and after['sessions'][0]['alive']
                assert after['machine']['version']==newer_pep and (t/'runtime/current').resolve()!=pointer
                assert cli('--version').strip()==newer_pep
                assert json.loads((t/'state/installation.json').read_text())['tag']==newer
                assert len(list((t/'state/updates').glob('*.whl')))<=1,'stale staged wheels were not pruned'
                await expect(page.get_by_text(newer_pep).first).to_be_visible(timeout=15000)
                await page.locator('.sidebar [data-view=terminal]').first.click()
                area=page.locator('.terminal-container:not([hidden]) textarea')
                await expect(area).to_be_enabled(timeout=30000);await area.focus()
                await page.keyboard.type('printf "%s" "$UPDATE_PROOF" >> update-proof.txt');await page.keyboard.press('Enter')
                for _ in range(100):
                    if (t/'update-proof.txt').read_text()=='beforekept':break
                    await asyncio.sleep(.1)
                assert (t/'update-proof.txt').read_text()=='beforekept'
                passed(f'client-driven update {tag} → {newer}: progress pushed ({sorted(progress_states)}), runtime replaced in place, same daemon and shell PID, environment kept, command runs after reconnect')
                # 3. Checking again is idempotent and quick.
                await page.locator('#settings-button').click()
                await page.get_by_role('button',name='Check for updates',exact=True).click()
                row=page.locator('#activity .activity-row').first
                await expect(row.locator('[role=status]')).to_contain_text('Up to date',timeout=30000)
                passed('second check after the update reports "Up to date" for the new version')
                # 4. A broken newer release must be refused with its reason; the host keeps serving.
                broken=newer.rsplit('.',1)[0]+'.'+str(int(newer.rsplit('.',1)[1])+1);broken_pep=broken[1:].replace('-beta.','b')
                publish(mirror,config,broken,f'jaunt_host-{broken_pep}-py3-none-any.whl',bumped_wheel(ROOT/'dist'/manifest['wheel'],version,broken_pep,broken=True))
                pointer=(t/'runtime/current').resolve();before=json.loads(cli('status'))
                await page.get_by_role('button',name='Check for updates',exact=True).click()
                row=page.locator('#activity .activity-row').first
                await expect(row.locator('[role=status]')).to_contain_text('cannot retain active sessions',timeout=240000)
                final=status_file();assert final['state']=='error' and final['retryable'] and 'exit' not in final['message'],final
                after=json.loads(cli('status'))
                assert after['pid']==before['pid'] and after['sessions'][0]['pid']==before['sessions'][0]['pid'] and after['sessions'][0]['alive']
                assert after['machine']['version']==newer_pep and (t/'runtime/current').resolve()==pointer and cli('--version').strip()==newer_pep
                assert json.loads((t/'state/installation.json').read_text())['tag']==newer
                await expect(page.get_by_role('button',name='Try again',exact=True)).to_be_visible()
                passed('broken newer release: the installer refuses it, the client shows the real reason with "Try again", the previous runtime and shell keep running and the pointer is unchanged')
                assert not service_calls.exists(),'No-service installation invoked the account service manager'
                await browser.close();browser=None
        finally:
            if browser:await browser.close()
            if exe.exists():subprocess.run([str(exe),'stop'],env=env,capture_output=True,timeout=15)
            relay.kill();relay.wait(timeout=5);server.shutdown();log.close()
    out=ROOT/'test-results';out.mkdir(exist_ok=True)
    (out/'client-update-report.json').write_text(json.dumps({'passed':checks},indent=2)+'\n')
    print(f'{len(checks)} client update checks passed.',flush=True)

if __name__=='__main__':asyncio.run(main())
