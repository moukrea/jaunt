#!/usr/bin/env python3
"""Terminal scroll, native text selection, themes, and actual CLI startup screens."""
import asyncio,json,os,shlex,shutil
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,terminal_command,scrollback,until
async def main():
    h=Harness()
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch();page=await browser.new_page(viewport={'width':1100,'height':800})
            await page.goto(h.pair()['url']);await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
            await page.locator('#new-session-top').click();await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click();await expect(page.locator('#modal')).not_to_be_visible()
            fixture=h.work/'render.py';fixture.write_text("import sys,time\nfor i in range(150): print(f'line {i:03d} '+('wide-content '*10))\nfor i in range(12):\n sys.stdout.write('\\x1b[?2026h\\rprogress '+str(i)+'\\x1b[K\\x1b[?2026l');sys.stdout.flush();time.sleep(.03)\nprint('\\nLAST-ROW-PROVED')\n")
            await terminal_command(page,'python3 '+shlex.quote(str(fixture)))
            for _ in range(40):
                if 'LAST-ROW-PROVED' in await scrollback(page):break
                await asyncio.sleep(.1)
            else:raise AssertionError('Terminal did not render the final output')
            await page.locator('.terminal-container').hover();await page.mouse.wheel(0,-1600);await asyncio.sleep(.3)
            # Scroll must move the terminal viewport, while keeping the same shell alive.
            (ROOT/'test-results/scroll-dom.html').write_text(await page.locator('.xterm').evaluate('(n)=>n.outerHTML'))
            await page.screenshot(path=str(ROOT/'test-results/scroll-up.png'))
            first=await page.locator('.xterm-rows').inner_text()
            assert 'LAST-ROW-PROVED' not in first,'Wheel did not move away from the bottom'
            await page.locator('#scroll-bottom').click();await asyncio.sleep(.2)
            await expect(page.locator('.xterm-rows')).to_contain_text('LAST-ROW-PROVED')
            screen=await page.locator('.xterm-screen').bounding_box();container=await page.locator('.terminal-container').bounding_box()
            assert screen['y']+screen['height']<=container['y']+container['height']+1,'Last terminal row is clipped'
            assert screen['x']+screen['width']<=container['x']+container['width']+1,'Terminal columns overflow the visible pane'
            await page.locator('#select-terminal-text').click();assert 'LAST-ROW-PROVED' in await page.get_by_label('Select terminal text').input_value()
            await page.get_by_role('button',name='Back to terminal',exact=True).click()
            await page.locator('#settings-button').click();await page.get_by_label('Color theme').select_option('light');assert await page.locator('html').get_attribute('data-theme')=='light'
            # onchange persists asynchronously. Observe the actual committed vault
            # before navigating away; an immediate reload can abort its transaction.
            for _ in range(50):
                saved=await page.evaluate("async()=>{const {Vault}=await import('./js/vault.mjs');const v=new Vault();await v.load();return v.data.preferences.theme;}")
                if saved=='light':break
                await asyncio.sleep(.1)
            assert saved=='light', 'Theme was not committed to the local vault'
            await page.reload();await page.locator('#settings-button').click();await expect(page.get_by_label('Color theme')).to_have_value('light')
            await page.get_by_label('Color theme').select_option('dark');await page.locator('[data-view=terminal]').first.click()
            for name,setting in [('claude','CLAUDE_CONFIG_DIR'),('codex','CODEX_HOME')]:
                executable=shutil.which(name)
                if not executable:continue # Optional installed programs, core fixture is always required.
                await page.locator('#new-session-top').click();await page.get_by_label('Session name').fill(name+' fixture');await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click();await expect(page.locator('#modal')).not_to_be_visible()
                config=h.root/name;config.mkdir()
                env=['env','-i','HOME='+str(config),'PATH=/usr/local/bin:/usr/bin:/bin','TERM=xterm-256color',setting+'='+str(config),'DISABLE_AUTOUPDATER=1','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',executable]
                await terminal_command(page,shlex.join(env))
                await expect(page.locator('.terminal-container:not([hidden]) .xterm-rows')).to_contain_text('Claude Code' if name=='claude' else 'Welcome to Codex',timeout=20000)
                assert not await page.locator('#modal').is_visible(),await page.locator('#modal').inner_text()
                text=await scrollback(page)
                (ROOT/('test-results/'+name+'-startup.txt')).write_text(text)
                assert ('Claude Code' if name=='claude' else 'Welcome to Codex') in text,name+' startup screen not rendered'
                await page.set_viewport_size({'width':390,'height':700});await page.locator('.terminal-container:not([hidden])').click();await asyncio.sleep(.3)
                assert await page.evaluate("document.querySelector('.terminal-footer').getBoundingClientRect().bottom<=document.querySelector('.keybar').getBoundingClientRect().top+1")
                # Interrupt only this unconfigured fixture's CLI, never an authenticated user agent.
                await page.locator('#list-sessions').click();await page.locator('#modal .settings-row').filter(has_text=name+' fixture').get_by_role('button',name='Terminate',exact=True).click();await page.get_by_role('button',name='Terminate session',exact=True).click();await asyncio.sleep(.3)
                await page.set_viewport_size({'width':1100,'height':800})
                print('PASS actual '+name+' isolated startup and responsive terminal geometry (no authenticated model invocation)')
            await browser.close();print('PASS scrolling to latest row, natural text selection control, persistent themes and synchronized-output fixture')
    finally:h.close()
if __name__=='__main__':asyncio.run(main())
