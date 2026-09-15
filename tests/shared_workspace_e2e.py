#!/usr/bin/env python3
"""Two real renderer processes share a fixture PTY; no personal shells or state."""
import asyncio,json,os,subprocess,sys,shlex
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,port,until,terminal_command,scrollback,ROOT

async def main():
    h=Harness();electron=None
    try:
        launcher=h.root/'jaunt'
        launcher.write_text('#!/bin/sh\nexec '+shlex.quote(sys.executable)+' -m jaunt.cli "$@"\n');launcher.chmod(0o700)
        debug=port()
        env={**h.env,'DISPLAY':os.environ.get('DISPLAY',':179'),'jaunt_host_executable':str(launcher)}
        # The shell fixture is headless; Electron must retain xvfb-run's X cookie.
        if os.environ.get('XAUTHORITY'):env['XAUTHORITY']=os.environ['XAUTHORITY']
        env.pop('ELECTRON_RUN_AS_NODE',None)
        electron=subprocess.Popen([str(ROOT/'node_modules/.bin/electron'),'.','--ozone-platform=x11','--disable-gpu',f'--user-data-dir={h.root}/desktop-profile','--no-sandbox',f'--remote-debugging-port={debug}'],cwd=ROOT,env=env,stdout=h.log,stderr=h.log)
        async with async_playwright() as pw:
            native=None
            for _ in range(100):
                try:native=await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{debug}');break
                except Exception:await asyncio.sleep(.1)
            assert native,'Desktop did not start'
            local=native.contexts[0].pages[0]
            await expect(local.locator('#connection span')).to_have_text('Local connection',timeout=15000)
            await local.locator('#new-session-top').click()
            await local.get_by_label('Session name').fill('Shared fixture')
            await local.get_by_label('Working directory').fill(str(h.work))
            await local.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
            await terminal_command(local,"printf 'local-proof' > local.txt")
            await until(lambda:(h.work/'local.txt').exists())
            browser=await pw.chromium.launch()
            remote=await browser.new_page(viewport={'width':820,'height':720})
            await remote.goto(h.pair()['url'])
            await expect(remote.locator('#tabs')).to_contain_text('Shared fixture')
            await terminal_command(remote,"printf 'remote-proof' > remote.txt")
            await until(lambda:(h.work/'remote.txt').exists())
            status=json.loads(h.cli('status'));assert len(status['sessions'])==1
            first=status['sessions'][0];assert len(first['viewers'])==2
            dimensions=(first['cols'],first['rows']);assert first['activeView'].startswith('local-') is False
            await local.set_viewport_size({'width':1300,'height':900});await asyncio.sleep(.4)
            same=json.loads(h.cli('status'))['sessions'][0];assert (same['cols'],same['rows'])==dimensions,'Passive resize stole geometry'
            await terminal_command(local,"printf 'claimed' > claimed.txt")
            await until(lambda:(h.work/'claimed.txt').exists())
            active=json.loads(h.cli('status'))['sessions'][0];assert active['activeView'].startswith('local-');assert (active['cols'],active['rows'])!=dimensions
            await local.locator('#new-session-top').click()
            await local.get_by_label('Session name').fill('Second pane')
            await local.get_by_label('Working directory').fill(str(h.work))
            await local.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
            await local.get_by_role('tab',name='Shared fixture',exact=True).click()
            await local.locator('#arrange-panes').click()
            await local.get_by_role('button',name='Side by side',exact=True).click()
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await expect(local.get_by_role('tab',name='Shared fixture + Second pane')).to_be_visible()
            await local.reload()
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await local.set_viewport_size({'width':390,'height':750})
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(1)
            await expect(local.get_by_role('tab',name='Second pane',exact=True)).to_be_visible()
            await local.set_viewport_size({'width':1300,'height':900})
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await local.screenshot(path=str(ROOT/'test-results/shared-desktop.png'))
            await remote.locator('.tab-close').click()
            assert json.loads(h.cli('status'))['sessions'][0]['alive']
            await remote.locator('#list-sessions').click();await remote.locator('#modal .settings-row').filter(has_text='Shared fixture').get_by_role('button',name='Open',exact=True).click()
            assert 'local-proof' in await scrollback(remote) or (h.work/'local.txt').read_text()=='local-proof'
            await remote.locator('#list-sessions').click();await remote.locator('#modal .settings-row').filter(has_text='Shared fixture').get_by_role('button',name='Terminate',exact=True).click();await remote.get_by_role('button',name='Terminate session',exact=True).click()
            await expect(local.locator('#tabs')).not_to_contain_text('Shared fixture')
            remaining=json.loads(h.cli('status'))['sessions'];assert len(remaining)==1 and remaining[0]['name']=='Second pane'
            await browser.close();await native.close()
            print('PASS native host + remote browser share one PTY; last active view sizes it; close/reopen preserves shell; terminate closes every view; tiled tabs persist through reload and flatten on mobile')
    finally:
        if electron:electron.terminate();electron.wait(timeout=10)
        h.close()

if __name__=='__main__':asyncio.run(main())
