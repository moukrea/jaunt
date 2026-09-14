#!/usr/bin/env python3
"""Real browser → encrypted WebSocket → real host → real POSIX PTY/files.

No production services, no mocks of the host or terminal. Temporary loopback
servers/state and files are cleaned up. Never edits browser security policies.
"""
from __future__ import annotations
import asyncio,base64,functools,http.server,json,os,signal,socket,struct,subprocess,sys,tempfile,threading,time,zlib
import qrcode
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
PNG=(ROOT/'web/assets/favicon.png').read_bytes()

def qr_png(value):
    qr=qrcode.QRCode(border=4);qr.add_data(value);qr.make(fit=True)
    matrix=qr.get_matrix();scale=6;size=len(matrix)*scale
    raw=b''.join((b'\0'+bytes(0 if cell else 255 for cell in row for _ in range(scale)))*scale for row in matrix)
    def chunk(kind, data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,0,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')

def port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]

class Harness:
    def __init__(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='jaunt-browser-');self.root=Path(self.tmp.name)
        self.state=self.root/'state';self.work=self.root/'workspace';self.work.mkdir()
        self.rport=port();self.env={**os.environ,'PYTHONPATH':str(ROOT/'host'),'JAUNT_STATE':str(self.state)}
        # Exercise the headless fallback without accessing the user's desktop clipboard
        # or sourcing personal login scripts in our real PTYs.
        for key in ('DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'BASH_ENV', 'ENV'):
            self.env.pop(key, None)
        shell=self.root/'test-shell'
        shell.write_text('#!/bin/sh\nexec /bin/bash --noprofile --norc -i\n');shell.chmod(0o700)
        self.env['SHELL']=str(shell)
        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self,*_):pass
            def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
        site=self.root/'site';site.mkdir();(site/'jaunt').symlink_to(ROOT/'web', target_is_directory=True)
        self.http=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(site)))
        self.url=f'http://127.0.0.1:{self.http.server_port}/jaunt/';threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.log=open(self.root/'host.log','w');self.relay=None;self.host=None;self.restart_relay()
        self.cli('init','--relay',f'ws://127.0.0.1:{self.rport}','--page',self.url,'--name','Jaunt workstation')
        self.host=subprocess.Popen([sys.executable,'-m','jaunt.cli','daemon'],env=self.env,stdout=self.log,stderr=self.log)
        for _ in range(100):
            if (self.state/'control.sock').exists():break
            time.sleep(.05)
    def cli(self,*args,input=None):
        return subprocess.check_output([sys.executable,'-m','jaunt.cli',*args],env=self.env,input=input,text=True,timeout=30)
    def pair(self):return json.loads(self.cli('pair','--json'))
    def kill_relay(self):
        if self.relay:
            # Miniflare owns a workerd child. Kill only this harness's dedicated
            # process group so the test interrupts real sockets, not just Node.
            try:os.killpg(self.relay.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            self.relay.wait(timeout=5)
    def restart_relay(self):
        self.kill_relay()
        if os.environ.get('JAUNT_E2E_RELAY') == 'workerd':
            command=['node',str(ROOT/'scripts/test_worker.mjs'),str(self.rport),self.url.removesuffix('/jaunt/'),str(self.root/'worker-state')]
        else:
            command=[sys.executable,str(ROOT/'scripts/dev_relay.py'),'--port',str(self.rport)]
        self.relay=subprocess.Popen(command,stdout=self.log,stderr=self.log,start_new_session=True)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1',self.rport),timeout=.1):return
            except OSError:time.sleep(.05)
        raise RuntimeError('Test relay did not listen')
    def close(self):
        self.kill_relay()
        for p in [self.host]:
            if p and p.poll() is None:
                p.terminate()
                try:p.wait(timeout=10)
                except subprocess.TimeoutExpired:p.kill();p.wait()
        self.http.shutdown();self.log.close();self.tmp.cleanup()

async def until(check,timeout=15):
    for _ in range(int(timeout/.1)):
        if check():return
        await asyncio.sleep(.1)
    raise AssertionError('Filesystem assertion timed out')

async def scrollback(page):
    await page.locator('#copy-button').click();await page.get_by_role('button',name='Select / search / copy as text',exact=True).click()
    text=await page.get_by_label('Terminal scrollback').input_value();await page.locator('#modal-close').click();return text

async def terminal_command(page,text):
    await expect(page.locator('.terminal-container:not([hidden]) textarea')).to_be_enabled(timeout=30000)
    await page.locator('.terminal-container:not([hidden]) textarea').focus();await page.keyboard.type(text);await page.keyboard.press('Enter')

async def main():
    h=Harness();checks=[];errors=[]
    def passed(name):checks.append(name);print('PASS',name,flush=True)
    try:
      async with async_playwright() as pw:
        executable=os.environ.get('JAUNT_BROWSER_EXECUTABLE')
        browser=await pw.chromium.launch(**({'executable_path':executable} if executable else {}),args=['--no-sandbox'])
        ctx=await browser.new_context(viewport={'width':1440,'height':950},accept_downloads=True)
        page=await ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto(h.url);await expect(page.locator('#pair-submit')).to_be_visible()
        await page.screenshot(path=str(OUT/'desktop-welcome.png'))
        await page.locator('#pair-code').fill('invalid');await page.locator('#pair-submit').click()
        await expect(page.locator('#toasts')).to_contain_text('not a valid');passed('invalid pairing rejected by UI')
        pair=h.pair();await page.goto(pair['url']);await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
        assert '#pair' not in page.url;passed('URL pairing, encrypted authentication, secret removed from URL')
        original=json.loads(h.cli('status'))['pid']
        await page.locator('#new-session-top').click();await page.get_by_label('Session name').fill('Workspace')
        await page.get_by_label('Working directory').fill(str(h.work))
        await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
        await expect(page.locator('#tabs')).to_contain_text('Workspace');await page.wait_for_timeout(400)
        await terminal_command(page,"printf 'JAUNT_%s\\n' 'EXECUTED' > proof.txt; cat proof.txt")
        await until(lambda:(h.work/'proof.txt').exists());await page.wait_for_timeout(300)
        assert (h.work/'proof.txt').read_text()=='JAUNT_EXECUTED\n'
        # File creation precedes network delivery and xterm's asynchronous rendering.
        # Poll the actual UI output, keeping the terminal assertion mandatory.
        for _ in range(50):
            if 'JAUNT_EXECUTED' in await scrollback(page):break
            await asyncio.sleep(.1)
        else:raise AssertionError('Executed command result never reached terminal scrollback')
        passed('real PTY command executed; result proven from file and terminal')
        await page.locator('#new-session-top').click();await page.get_by_label('Session name').fill('Builds');await page.get_by_label('Working directory').fill(str(h.work))
        await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click();await expect(page.locator('#tabs')).to_contain_text('Builds')
        assert len(json.loads(h.cli('status'))['sessions'])==2;passed('multiple arbitrary shell sessions')
        await page.locator('#tabs').get_by_role('tab',name='Workspace',exact=False).click()
        await page.reload();await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
        await expect(page.locator('#tabs')).to_contain_text('Workspace');assert json.loads(h.cli('status'))['pid']==original
        passed('reload uses remembered identity and preserves sessions')
        # Suspend only our isolated host: the relay still answers WebSocket pings.
        # The UI must detect missing authenticated host replies, not trust relay pongs.
        h.host.send_signal(signal.SIGSTOP)
        try:
            await expect(page.locator('#connection span')).not_to_have_text('Encrypted',timeout=90000)
        finally:
            h.host.send_signal(signal.SIGCONT)
        await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=45000)
        assert json.loads(h.cli('status'))['pid']==original
        await terminal_command(page,"printf 'HOST_RESUMED\\n' > host-resumed.txt")
        await until(lambda:(h.work/'host-resumed.txt').exists())
        assert (h.work/'host-resumed.txt').read_text()=='HOST_RESUMED\n'
        passed('host silence detected despite live relay pongs; remembered session resumes')
        # Drop the relay process: real TCP/WebSocket connections close, not merely
        # a browser offline indicator. Host stays alive and re-registers its room.
        h.kill_relay()
        await expect(page.locator('#connection span')).not_to_have_text('Encrypted',timeout=10000)
        h.restart_relay();await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=20000)
        assert json.loads(h.cli('status'))['pid']==original
        await page.wait_for_timeout(300)
        await terminal_command(page,"printf 'RECONNECTED_%s\\n' 'SAME_SHELL' > reconnect.txt")
        await until(lambda:(h.work/'reconnect.txt').exists());passed('relay loss/restart → automatic fresh encrypted channel, no new QR, same PTY')
        await page.locator('[data-view="files"]').first.click();await page.get_by_label('Directory path').fill(str(h.work));await page.get_by_label('Directory path').press('Enter')
        await expect(page.locator('#file-list')).to_contain_text('proof.txt')
        target=h.work/'navigation-target';target.mkdir();(target/'navigation-proof.txt').write_text('fixture')
        await page.evaluate("""async () => {
          const {Link} = await import('./js/link.mjs');
          const original = Link.prototype.request;
          window.__restoreFileRequests = () => { Link.prototype.request = original; window.__fileObserver.disconnect(); };
          // Delay delivery of a REAL encrypted RPC reply; do not mock its result.
          Link.prototype.request = async function(method, ...args) {
            const result = await original.call(this, method, ...args);
            if (method === 'files.list') await new Promise(resolve => setTimeout(resolve, 250));
            return result;
          };
          window.__fileRenders = 0;
          window.__fileObserver = new MutationObserver(() => window.__fileRenders++);
          window.__fileObserver.observe(document.querySelector('#file-list'), {childList: true});
        }""")
        try:
            await page.get_by_label('Directory path').fill(str(target))
            # A refresh dispatched AFTER typing must also preserve the draft.
            await page.locator('#file-refresh').click()
            await page.wait_for_function('() => window.__fileRenders > 0')
            await expect(page.get_by_label('Directory path')).to_have_value(str(target))
            await page.get_by_label('Directory path').press('Enter')
            # Refresh while navigation is awaiting its reply must use the new path.
            await page.locator('#file-refresh').click()
            await expect(page.locator('#file-list')).to_contain_text('navigation-proof.txt')
            await expect(page.get_by_label('Directory path')).to_have_value(str(target))
        finally:
            await page.evaluate('window.__restoreFileRequests()')
        await page.get_by_label('Directory path').fill(str(h.work));await page.get_by_label('Directory path').press('Enter')
        await expect(page.locator('#file-list')).to_contain_text('proof.txt')
        passed('late file refresh preserves path draft and pending navigation intent')
        payload=('é日本語\n'*200000).encode()+bytes(range(256));filename='épreuve fichier.bin'
        async with page.expect_file_chooser() as chooser:await page.locator('#file-upload').click()
        await (await chooser.value).set_files({'name':filename,'mimeType':'application/octet-stream','buffer':payload})
        await until(lambda:any(p.stat().st_size>49152 for p in h.work.glob('.jaunt-upload-*')))
        h.kill_relay()
        await expect(page.locator('#connection span')).not_to_have_text('Encrypted',timeout=10000)
        h.restart_relay();await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=20000)
        await until(lambda:(h.work/filename).exists());assert (h.work/filename).read_bytes()==payload
        passed('in-flight upload resumes after abrupt relay loss, final bytes verified')
        await expect(page.locator('#file-list')).to_contain_text(filename);passed('multi-chunk binary/Unicode upload with exact byte comparison')
        await page.get_by_label('Actions for '+filename,exact=True).click()
        async with page.expect_download(timeout=15000) as capture:await page.locator('#modal').get_by_role('button',name='Download',exact=True).click()
        received=await capture.value;assert Path(await received.path()).read_bytes()==payload;passed('download bytes identical to uploaded file')
        await page.locator('#file-mkdir').click();await page.get_by_label('Name',exact=True).fill('New folder');await page.locator('#modal').get_by_role('button',name='Create folder',exact=True).click()
        await until(lambda:(h.work/'New folder').exists());await expect(page.locator('#modal')).not_to_be_visible();passed('remote directory creation')
        await page.screenshot(path=str(OUT/'desktop-files.png'))
        await page.locator('[data-view="terminal"]').first.click();await page.wait_for_timeout(200)
        async with page.expect_file_chooser() as chooser:await page.locator('#attach-button').click()
        await (await chooser.value).set_files({'name':'screenshot.png','mimeType':'image/png','buffer':PNG})
        await expect(page.get_by_role('button',name='Native image paste',exact=True)).to_be_disabled()
        await page.get_by_role('button',name='Upload & insert path',exact=True).click()
        await until(lambda:bool(list((h.state/'attachments').glob('*.png'))));await page.wait_for_timeout(300)
        await expect(page.locator('#toasts')).to_contain_text('Its path was inserted',timeout=30000)
        for _ in range(50):
            if 'screenshot.png' in await scrollback(page):break
            await asyncio.sleep(.1)
        else:raise AssertionError('Uploaded image path never reached terminal scrollback')
        passed('PNG conversion/upload and quoted-path insertion, native clipboard truthfully unavailable')
        # Ctrl+C clears the unsubmitted image path; it must not execute on upload.
        await expect(page.locator('.terminal-container:not([hidden]) textarea')).to_be_enabled(timeout=30000)
        await page.locator('.terminal-container:not([hidden]) textarea').focus();await page.keyboard.press('Control+c')
        # Chromium's real clipboard API, scoped to this isolated browser context.
        await ctx.grant_permissions(['clipboard-read','clipboard-write'])
        await page.evaluate('''async value => {
          const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
          await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);
        }''',base64.b64encode(PNG).decode())
        await page.locator('#paste-button').click()
        await expect(page.get_by_role('button',name='Native image paste',exact=True)).to_be_disabled()
        await page.get_by_role('button',name='Upload & insert path',exact=True).click()
        await until(lambda:bool(list((h.state/'attachments').glob('*clipboard-*.png'))))
        await expect(page.locator('#toasts')).to_contain_text('Its path was inserted',timeout=30000)
        await page.locator('.terminal-container:not([hidden]) textarea').focus();await page.keyboard.press('Control+c')
        passed('real browser image clipboard reaches headless upload/path fallback')
        # Reproduce an empty async clipboard result, then deliver an image through
        # the rich paste event. Only clipboard ingress is simulated, not the host.
        await page.evaluate('''() => {
          window.__clipboardRead=navigator.clipboard.read;
          navigator.clipboard.read=async()=>[{types:['text/plain'],getType:async()=>new Blob([''],{type:'text/plain'})}];
        }''')
        await page.locator('#paste-button').click()
        await expect(page.get_by_role('textbox',name='Paste text or image',exact=True)).to_be_visible()
        await page.get_by_role('textbox',name='Paste text or image',exact=True).evaluate('''(node,value) => {
          const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],'fallback-capture.png',{type:'image/png'}));
          node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
        }''',base64.b64encode(PNG).decode())
        await expect(page.get_by_role('button',name='Native image paste',exact=True)).to_be_disabled()
        await page.get_by_role('button',name='Upload & insert path',exact=True).click()
        await until(lambda:bool(list((h.state/'attachments').glob('*fallback-capture.png'))))
        await expect(page.locator('#toasts')).to_contain_text('Its path was inserted',timeout=30000)
        await page.evaluate('''() => {navigator.clipboard.read=window.__clipboardRead;delete window.__clipboardRead;}''')
        assert await page.locator('#sidebar [data-view="transfers"]').count()==0
        assert await page.locator('#mobile-nav [data-view="transfers"]').count()==0
        await page.locator('[data-view="files"]').first.click()
        await expect(page.locator('#file-transfers')).to_be_visible()
        await page.locator('#file-transfers').click();await expect(page.locator('#transfer-list')).to_contain_text('fallback-capture.png')
        await page.locator('[data-view="terminal"]').first.click()
        await page.locator('.terminal-container:not([hidden]) textarea').focus();await page.keyboard.press('Control+c')
        passed('empty clipboard opens rich image paste fallback; transfer activity remains accessible from Files')
        h.cli('clip',input='Shared remote clipboard\n'+('abcé'*20000))
        await page.locator('#copy-button').click();await page.get_by_role('button',name='Read remote clipboard',exact=True).click()
        await expect(page.locator('#modal')).to_contain_text('Remote clipboard')
        values=await page.locator('#modal textarea').input_value();assert values.startswith('Shared remote clipboard\n');assert len(values)>65536
        await page.locator('#modal-close').click();passed('chunked remote clipboard >64 KiB')
        await page.locator('#settings-button').click();await page.get_by_role('button',name='Set passphrase / PIN').click()
        await page.get_by_label('New passphrase or PIN',exact=True).fill('correct horse portable shell');await page.get_by_label('Repeat it',exact=True).fill('correct horse portable shell')
        await page.get_by_role('button',name='Save protection',exact=True).click();await page.locator('#lock-button').click()
        await expect(page.locator('#lock-screen')).to_be_visible();await page.get_by_label('Passphrase or PIN',exact=True).fill('incorrect');await page.get_by_role('button',name='Unlock workspace').click()
        await expect(page.locator('#unlock-error')).to_contain_text('Incorrect')
        await page.get_by_label('Passphrase or PIN',exact=True).fill('correct horse portable shell');await page.get_by_role('button',name='Unlock workspace').click()
        await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000);passed('encrypted local vault, lock, bad password rejected, unlock and reconnect')
        await page.locator('[data-view="terminal"]').first.click();await page.wait_for_timeout(500)
        await terminal_command(page, "PS1='jaunt $ '; printf '\\033c'; printf 'Jaunt workstation\\n\\n'; uname -s; printf '\\n'; ls -1; printf '\\n'")
        await page.wait_for_timeout(1000)
        await page.screenshot(path=str(OUT/'desktop-terminal.png'))
        # Pair another independent browser/device to the same real host.
        mobile=await browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True,accept_downloads=True)
        await mobile.add_init_script('delete window.BarcodeDetector')
        mp=await mobile.new_page();mp.on('pageerror',lambda e:errors.append(str(e)))
        await mp.goto(h.url);await expect(mp.locator('#pair-submit')).to_be_visible();await mp.screenshot(path=str(OUT/'mobile-welcome.png'),full_page=True)
        await mp.locator('#scan-welcome').click()
        await mp.get_by_label('Scan QR from an image').set_input_files({'name':'pairing.png','mimeType':'image/png','buffer':qr_png(h.pair()['code'])})
        await expect(mp.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
        passed('local jsQR fallback scans generated QR image; no physical camera claimed')
        await expect(mp.locator('#tabs')).to_contain_text('Workspace');await mp.wait_for_timeout(500)
        for width,height in [(390,844),(360,780),(844,390),(390,450)]:
            await mp.set_viewport_size({'width':width,'height':height});await mp.wait_for_timeout(150)
            assert await mp.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Overflow at {width}x{height}'
        passed('independent mobile pairing, shared sessions, 360px/390px/landscape/keyboard-height layout')
        await mp.set_viewport_size({'width':390,'height':844});await mp.wait_for_timeout(300)
        await terminal_command(mp, "PS1='jaunt $ '; printf '\\033c'; printf 'Jaunt workstation\\n\\n'; uname -s; printf '\\n'; ls -1; printf '\\n'")
        await mp.wait_for_timeout(7000)
        await mp.screenshot(path=str(OUT/'mobile-terminal.png'))
        devices=json.loads(h.cli('devices'));mobile_id=next(d['id'] for d in devices if d['id']!=devices[0]['id'])
        h.cli('revoke',mobile_id);await expect(mp.locator('#connection span')).not_to_have_text('Encrypted',timeout=10000)
        assert len(json.loads(h.cli('status'))['sessions'])==2;passed('revoked device disconnected; shell sessions retained')
        # Check all precached resources at the actual project subpath.
        import re
        assets=json.loads(re.search(r'const STATIC = (\[.*?\]);',(ROOT/'web/sw.js').read_text()).group(1))
        for asset in [*assets,'./vendor/LICENSE-jsQR.txt','./install.sh','./config.json']:
            response=await ctx.request.get(h.url+asset.removeprefix('./'))
            assert response.status==200,asset
        passed('all precached resources, jsQR license and installer served beneath /jaunt/')
        assert not errors,errors;passed('no uncaught browser exceptions')
        await mobile.close();await ctx.close();await browser.close()
    finally:
        (OUT/'browser-report.json').write_text(json.dumps({'passed':checks,'uncaughtErrors':errors,'tested':'Chromium desktop and emulated mobile; not a physical handset','relay':os.environ.get('JAUNT_E2E_RELAY','python-reference')},indent=2)+'\n')
        h.close()
    print(f'{len(checks)} browser scenarios passed.',flush=True)
if __name__=='__main__':asyncio.run(main())
