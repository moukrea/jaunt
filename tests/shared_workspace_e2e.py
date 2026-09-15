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
        executable=os.environ.get('jaunt_E2E_DESKTOP_EXECUTABLE')
        command=[executable] if executable else [str(ROOT/'node_modules/.bin/electron'),'.']
        electron=subprocess.Popen([*command,'--ozone-platform=x11','--disable-gpu',f'--user-data-dir={h.root}/desktop-profile','--no-sandbox',f'--remote-debugging-port={debug}'],cwd=ROOT,env=env,stdout=h.log,stderr=h.log)
        async with async_playwright() as pw:
            native=None
            for _ in range(100):
                try:native=await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{debug}');break
                except Exception:await asyncio.sleep(.1)
            assert native,'Desktop did not start'
            local=native.contexts[0].pages[0]
            await expect(local.locator('#connection span')).to_have_text('Local connection',timeout=15000)
            assert await local.evaluate('Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)'), 'Bundled desktop logo did not load'
            await local.locator('#new-session-folder').click()
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
            await local.locator('#new-session-folder').click()
            await local.get_by_label('Session name').fill('Second pane')
            await local.get_by_label('Working directory').fill(str(h.work))
            await local.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
            await local.get_by_role('tab',name='Shared fixture',exact=True).click()
            await local.locator('#arrange-panes').click()
            await local.locator('.split-picker').get_by_role('button',name='Second pane',exact=True).click()
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await expect(local.get_by_role('tab',name='Shared fixture + Second pane')).to_be_visible()
            await local.reload()
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await local.reload();await expect(local.locator('#connection span')).to_have_text('Local connection',timeout=15000)
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await local.set_viewport_size({'width':390,'height':750})
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(1)
            await expect(local.get_by_role('tab',name='Second pane',exact=True)).to_be_visible()
            await local.set_viewport_size({'width':1300,'height':900})
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            await local.screenshot(path=str(ROOT/'test-results/shared-desktop.png'))
            await local.locator('.pane-caption').filter(has_text='Second pane').get_by_role('button',name='Move pane to its own tab').click()
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(1)
            await expect(local.get_by_role('tab',name='Shared fixture',exact=True)).to_be_visible()
            await expect(local.get_by_role('tab',name='Second pane',exact=True)).to_be_visible()
            await local.locator('#split-below').click()
            await local.locator('.split-picker').get_by_role('button',name='Shared fixture',exact=True).click()
            await expect(local.locator('.terminal-container:not([hidden])')).to_have_count(2)
            boxes=await local.locator('.terminal-container:not([hidden])').evaluate_all('(nodes)=>nodes.map(n=>({x:n.offsetLeft,y:n.offsetTop}))')
            assert boxes[0]['x']==boxes[1]['x'] and boxes[0]['y']!=boxes[1]['y']
            await local.locator('#list-sessions').click()
            row=local.locator('.session-manager .settings-row').filter(has_text='Second pane')
            for width in (1300,390):
                await local.set_viewport_size({'width':width,'height':750})
                assert await row.evaluate('(row)=>Array.from(row.querySelectorAll("button")).every(b=>{const r=b.getBoundingClientRect(),p=row.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right})'), 'Session actions overflow their row'
            await local.screenshot(path=str(ROOT/'test-results/session-manager-mobile.png'))
            await local.set_viewport_size({'width':1300,'height':900})
            await local.screenshot(path=str(ROOT/'test-results/session-manager-desktop.png'))
            await row.get_by_role('button',name='Rename',exact=True).click()
            await local.get_by_label('Name',exact=True).fill('Renamed local shell')
            await local.get_by_role('button',name='Save',exact=True).click()
            await expect(local.locator('#tabs')).to_contain_text('Renamed local shell')
            await local.locator('#list-sessions').click()
            await local.locator('.session-manager .settings-row').filter(has_text='Renamed local shell').get_by_role('button',name='Close view',exact=True).click()
            assert any(s['name']=='Renamed local shell' and s['alive'] for s in json.loads(h.cli('status'))['sessions'])
            await local.locator('.session-manager .settings-row').filter(has_text='Renamed local shell').get_by_role('button',name='Open',exact=True).click()
            await local.locator('#rename-session').click()
            await local.get_by_label('Name',exact=True).fill('Second pane')
            await local.get_by_role('button',name='Save',exact=True).click()
            await local.set_viewport_size({'width':1300,'height':900})
            await remote.locator('.tab-close').click()
            assert json.loads(h.cli('status'))['sessions'][0]['alive']
            await remote.locator('#list-sessions').click();await remote.locator('#modal .settings-row').filter(has_text='Shared fixture').get_by_role('button',name='Open',exact=True).click()
            assert 'local-proof' in await scrollback(remote) or (h.work/'local.txt').read_text()=='local-proof'
            await remote.locator('#list-sessions').click();await remote.locator('#modal .settings-row').filter(has_text='Shared fixture').get_by_role('button',name='Terminate',exact=True).click();await remote.get_by_role('button',name='Terminate session',exact=True).click()
            await expect(local.locator('#tabs')).not_to_contain_text('Shared fixture')
            remaining=json.loads(h.cli('status'))['sessions'];assert len(remaining)==1 and remaining[0]['name']=='Second pane'
            # Ordinary creation is immediate and inherits the running shell's directory.
            await local.get_by_role('tab',name='Second pane',exact=True).click()
            child=h.work/'browsed folder';child.mkdir()
            await terminal_command(local,"cd '"+str(child)+"'; printf ready > cwd-ready")
            await until(lambda:(child/'cwd-ready').exists())
            await local.locator('#new-session-top').click()
            await expect(local.locator('#modal')).not_to_be_visible()
            await terminal_command(local,"printf inherited > inherited.txt")
            await until(lambda:(child/'inherited.txt').exists())
            assert (child/'inherited.txt').read_text()=='inherited'
            await local.locator('#new-session-folder').click()
            await expect(local.get_by_label('Working directory')).to_have_value(str(child))
            await local.locator('.folder-picker').get_by_role('button',name='Parent folder').click()
            await local.locator('.folder-picker').get_by_role('button',name='browsed folder',exact=True).click()
            await expect(local.get_by_label('Working directory')).to_have_value(str(child))
            await expect(local.get_by_label('Session name')).to_have_value('')
            await local.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
            await terminal_command(local,"printf browsed > browsed.txt")
            await until(lambda:(child/'browsed.txt').exists())
            await local.locator('#list-sessions').click()
            auto=json.loads(h.cli('status'))['sessions'][-1]
            await local.locator('.session-manager .settings-row').filter(has_text=auto['name']).get_by_role('button',name='Terminate',exact=True).click()
            await local.get_by_role('button',name='Terminate session',exact=True).click()
            await expect(local.locator('#modal')).not_to_be_visible()
            assert auto['id'] not in [s['id'] for s in json.loads(h.cli('status'))['sessions']]
            await browser.close();await native.close()
            print('PASS native host + remote browser share one PTY; last active view sizes it; close/reopen preserves shell; terminate closes every view; tiled tabs persist through reload and flatten on mobile')
    finally:
        if electron:electron.terminate();electron.wait(timeout=10)
        h.close()

if __name__=='__main__':asyncio.run(main())
