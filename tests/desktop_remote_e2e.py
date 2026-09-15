#!/usr/bin/env python3
"""Native desktop → project-owned public WSS relay → isolated fixture host.
Run explicitly: this check uses the deployed relay, not a user's host identity.
"""
import asyncio,json,os,shlex,subprocess,sys
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,port,terminal_command,until

async def main():
    h=Harness();electron=None
    try:
        h.host.terminate();h.host.wait(timeout=10)
        state=json.loads((h.state/'host.json').read_text())
        state.update(relay='wss://jaunt-relay.moukrea.workers.dev',page='https://moukrea.github.io/jaunt/')
        (h.state/'host.json').write_text(json.dumps(state))
        h.host=subprocess.Popen([sys.executable,'-m','jaunt.cli','daemon'],env=h.env,stdout=h.log,stderr=h.log)
        for _ in range(100):
            try:
                if json.loads(subprocess.check_output([sys.executable,'-m','jaunt.cli','status'],env=h.env,text=True,stderr=subprocess.DEVNULL))['connected']:break
            except subprocess.CalledProcessError:pass
            await asyncio.sleep(.1)
        else:raise AssertionError('Fixture host did not connect to the public relay')
        launcher=h.root/'jaunt';launcher.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' -m jaunt.cli "$@"\n');launcher.chmod(0o700)
        env={**h.env,'DISPLAY':os.environ.get('DISPLAY',':179'),'jaunt_host_executable':str(launcher)}
        if os.environ.get('XAUTHORITY'):env['XAUTHORITY']=os.environ['XAUTHORITY']
        env.pop('ELECTRON_RUN_AS_NODE',None);debug=port()
        electron=subprocess.Popen([str(ROOT/'node_modules/.bin/electron'),'.','--ozone-platform=x11','--disable-gpu',f'--user-data-dir={h.root}/desktop-profile','--no-sandbox',f'--remote-debugging-port={debug}'],cwd=ROOT,env=env,stdout=h.log,stderr=h.log)
        async with async_playwright() as pw:
            native=None
            for _ in range(100):
                try:native=await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{debug}');break
                except Exception:await asyncio.sleep(.1)
            assert native,'Desktop did not start'
            page=native.contexts[0].pages[0]
            await expect(page.locator('#connection span')).to_have_text('Local connection',timeout=15000)
            assert await page.evaluate('location.origin')=='jaunt://app'
            await page.locator('#add-machine').click();await page.get_by_label('Pairing code').fill(h.pair()['code'])
            await page.get_by_role('button',name='Pair machine',exact=True).click()
            await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=20000)
            await page.locator('#settings-button').click()
            await expect(page.get_by_role('button',name='Install service',exact=True)).to_have_count(0)
            await expect(page.get_by_label('Desktop notifications')).to_be_visible()
            await page.get_by_label('Friendly host name').fill('Remote fixture')
            await page.get_by_label('Friendly host name').press('Tab')
            await expect(page.locator('#machine-title')).to_have_text('Remote fixture')
            await page.locator('#machine-list .machine-item').filter(has_not_text='Remote fixture').click()
            await expect(page.get_by_role('button',name='Install service',exact=True)).to_be_visible()
            await expect(page.get_by_label('Friendly host name')).not_to_have_value('Remote fixture')
            await page.locator('#machine-list').get_by_role('button',name='Remote fixture').click()
            await expect(page.get_by_role('button',name='Install service',exact=True)).to_have_count(0)
            await expect(page.get_by_label('Friendly host name')).to_have_value('Remote fixture')
            await page.locator('[data-view=terminal]').first.click()
            await page.locator('#new-session-folder').click();await page.get_by_label('Session name').fill('Remote desktop fixture');await page.get_by_label('Working directory').fill(str(h.work))
            await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
            await terminal_command(page,"printf 'native-remote-proof' > native-remote.txt")
            await until(lambda:(h.work/'native-remote.txt').exists())
            assert (h.work/'native-remote.txt').read_text()=='native-remote-proof'
            assert not json.loads(h.cli('status'))['sessions'][0]['activeView'].startswith('local-')
            await page.locator('#list-sessions').click();await page.locator('#modal .settings-row').filter(has_text='Remote desktop fixture').get_by_role('button',name='Terminate',exact=True).click();await page.get_by_role('button',name='Terminate session',exact=True).click()
            await until(lambda:not json.loads(h.cli('status'))['sessions'])
            for device in json.loads(h.cli('devices')):h.cli('revoke','--',device['id'])
            await native.close()
        print('PASS native desktop authenticates through public WSS as a remote client, executes a proven shell command and terminates it; fixture authorizations revoked')
    finally:
        if electron:electron.terminate();electron.wait(timeout=10)
        h.close()

if __name__=='__main__':asyncio.run(main())
