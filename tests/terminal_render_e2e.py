#!/usr/bin/env python3
"""Terminal scroll, native text selection, themes, and actual CLI startup screens."""
import asyncio,json,os,re,shlex,shutil
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,terminal_command,scrollback,until
# A diff-rendering TUI (like Codex/ratatui): it paints the whole screen once, repaints it only when
# the size it reads changes, and otherwise writes truecolor updates to one row.
DIFF_TUI=r'''
import os,sys,signal,time,pathlib,select,tty
go,pidf,done=map(pathlib.Path,sys.argv[1:4])
out=sys.stdout.buffer;C=b'\x1b[38;2;45;47;48m';R=b'\x1b[0m';size=None;winch=False;large=len(sys.argv)>4
if large:tty.setcbreak(0)
def full():
    global size
    size=os.get_terminal_size(1);cols,rows=size
    s=b'\x1b[0m\x1b[H\x1b[2J'+C+b'HEADER-PROOF'+R
    if go.exists():s+=b' REPAINT-PROOF'
    for r in range(2,rows):s+=b'\x1b[%d;1H'%r+C+b'body row %02d'%r+R
    if large:
        # A styled full screen exceeds the slow viewer's 16 KiB catch-up even on mobile.
        s=b'\x1b[0m\x1b[H\x1b[2J'
        for row in range(1,rows+1):s+=b'\x1b[%d;1H'%row+(C+bytes([65+row%26]))*(cols-1)
        # Let the host observe more than one PTY read during the repaint.
        out.write(s[:1024]);out.flush();time.sleep(.04);out.write(s[1024:]+R);out.flush()
        with pidf.with_suffix('.sizes').open('a') as f:f.write(f'{cols}x{rows}\n')
    else:out.write(s+b'\x1b[%d;1H'%rows+C+b'FOOTER-PROOF'+R+b'\x1b[%d;1H'%(rows//2));out.flush()
def onwinch(*_):
    global winch;winch=True
signal.signal(signal.SIGWINCH,onwinch)
pidf.write_text(str(os.getpid()));full()
def idle():
    global winch
    if large and select.select([0],[],[],0)[0]:
        os.read(0,1);out.write(b'\x1b[H\x1b[2JINPUT-PROOF');out.flush();pidf.with_suffix('.input').touch()
    if winch:
        winch=False
        if os.get_terminal_size(1)!=size:full()
while not go.exists():time.sleep(.02);idle()
total=i=0
while total<400*1024:
    s=b'\x1b[%d;1H'%(size[1]//2)+b''.join(C+bytes([c]) for c in b'UPDATE-%06d'%i)+R+b'\x1b[K'
    out.write(s);out.flush();total+=len(s);i+=1
done.write_text(str(total))
while True:time.sleep(.02);idle()
'''
async def hidden_burst_repaints(page,h):
    """JAU-64: a hidden (detached) tab whose diff-rendering program wrote more than the catch-up
    budget comes back with its full screen at the same size, no stray escape fragment, same process."""
    async def new_shell(name):
        await page.locator('#new-session-folder').click();await page.get_by_label('Session name').fill(name);await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click();await expect(page.locator('#modal')).not_to_be_visible()
        await expect(page.locator('#tabs')).to_contain_text(name)
    await new_shell('Diff TUI')
    fixture=h.work/'diff_tui.py';fixture.write_text(DIFF_TUI);go,pidf,done=h.work/'go',h.work/'tui.pid',h.work/'tui.done'
    await terminal_command(page,'python3 '+' '.join(shlex.quote(str(p)) for p in (fixture,go,pidf,done)))
    rows=page.locator('.terminal-container:not([hidden]) .xterm-rows')
    await expect(rows).to_contain_text('FOOTER-PROOF',timeout=15000)
    session=lambda:next(s for s in json.loads(h.cli('status'))['sessions'] if s['name']=='Diff TUI')
    size,pid=(session()['cols'],session()['rows']),int(pidf.read_text())
    await new_shell('Other tab');await asyncio.sleep(.8)
    go.write_text('1');await until(lambda:done.exists(),timeout=60)
    await page.locator('#tabs').get_by_role('tab',name='Diff TUI',exact=False).click()
    await expect(page.locator('#terminal-meta')).to_contain_text('older output trimmed')
    await expect(rows).to_contain_text('REPAINT-PROOF',timeout=10000)
    await expect(rows).to_contain_text('HEADER-PROOF');await expect(rows).to_contain_text('FOOTER-PROOF')
    text=await rows.inner_text()
    await page.screenshot(path=str(ROOT/'test-results/hidden-burst-repaint.png'))
    assert not re.search(r'(?<![A-Za-z])\d+(?:;\d+)*m',text),('Replay began inside an escape sequence',text)
    assert (session()['cols'],session()['rows'])==size and int(pidf.read_text())==pid,'Same size, same process'
    os.kill(pid,0)
    for name in ('Diff TUI','Other tab'):
        await page.locator('#list-sessions').click();await page.locator('#modal .settings-row').filter(has_text=name).get_by_role('button',name='Terminate',exact=True).click();await page.get_by_role('button',name='Terminate session',exact=True).click();await asyncio.sleep(.3)
    print('PASS hidden diff-rendering tab repaints after a trimmed catch-up, without resize or stray escape text')

async def slow_repaint_is_stable(browser):
    """A phone's delayed ACK must not resize a quiet TUI every two seconds (JAU-64)."""
    h=Harness();errors=[]
    try:
        context=await browser.new_context(viewport={'width':390,'height':780},is_mobile=True,has_touch=True)
        try:
            page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
            await page.goto(h.pair()['url']);await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
            await page.evaluate("""async()=>{
                const {Link}=await import('./js/link.mjs');
                const send=Link.prototype.send,dispatch=Link.prototype.dispatchEvent;
                const timers=new Map(),latest=new Map();window.redrawProbe={acks:0,resets:0};
                Link.prototype.send=function(value){
                    if(value.type!=='terminal.ack')return send.call(this,value);
                    if(value.id===window.redrawProbe.id)window.redrawProbe.acks++;
                    latest.set(value.id,value);
                    if(!timers.has(value.id))timers.set(value.id,setTimeout(()=>{
                        timers.delete(value.id);send.call(this,latest.get(value.id)).catch(()=>{});
                    },350));
                    return Promise.resolve();
                };
                Link.prototype.dispatchEvent=function(event){
                    if(event.detail?.type==='terminal.reset'&&event.detail.id===window.redrawProbe.id)window.redrawProbe.resets++;
                    return dispatch.call(this,event);
                };
            }""")
            async def shell(name):
                await page.locator('#new-session-folder').click();await page.get_by_label('Session name').fill(name)
                await page.get_by_label('Working directory').fill(str(h.work))
                await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
                await expect(page.locator('#modal')).not_to_be_visible()
            await shell('Slow redraw')
            session=lambda:next(s for s in json.loads(h.cli('status'))['sessions'] if s['name']=='Slow redraw')
            initial=session();await page.evaluate('(id)=>window.redrawProbe.id=id',initial['id'])
            fixture=h.work/'large_tui.py';fixture.write_text(DIFF_TUI)
            go,pidf,done=h.work/'large.go',h.work/'large.pid',h.work/'large.done';sizes_file=pidf.with_suffix('.sizes')
            await terminal_command(page,'python3 '+shlex.join([str(fixture),str(go),str(pidf),str(done),'large']))
            await until(lambda:sizes_file.exists());await asyncio.sleep(.5)
            initial=session();pid=int(pidf.read_text())
            await shell('Other');await asyncio.sleep(.5)
            go.touch();await until(lambda:done.exists());await asyncio.sleep(.2)
            await page.locator('#tabs').get_by_role('tab',name='Slow redraw',exact=False).click()
            states=[]
            for _ in range(12):
                await asyncio.sleep(1);current=session()
                states.append({'offset':current['offset'],'resets':await page.evaluate('window.redrawProbe.resets')})
            sizes=sizes_file.read_text().splitlines();probe=await page.evaluate('window.redrawProbe')
            rows=page.locator('.terminal-container:not([hidden]) .xterm-rows')
            report={'viewport':[390,780],'ackDelayMs':350,'programSizes':sizes,'states':states,
                    'probe':probe,'pageErrors':errors,'renderedRows':await rows.inner_text()}
            (ROOT/'test-results/slow-viewer-redraw.json').write_text(json.dumps(report,indent=2))
            await page.screenshot(path=str(ROOT/'test-results/slow-viewer-stable.png'))
            cols,lines=initial['cols'],initial['rows']
            assert sizes==[f'{cols}x{lines}',f'{cols-1}x{lines}',f'{cols}x{lines}'],('Repeated real PTY resize',report)
            assert probe['resets']>=2 and probe['acks']>2,'Exercise attach and ACK-driven trimmed replay'
            assert all(state==states[2] for state in states[2:]),('Quiet TUI kept producing output or resetting',report)
            assert not errors and current['id']==initial['id'] and int(pidf.read_text())==pid
            os.kill(pid,0)
            # Missing rows after the bounded replay remain JAU-118; assert stability here,
            # and independently prove that real keyboard input still reaches the same TUI.
            await page.locator('.terminal-container:not([hidden]) textarea').focus();await page.keyboard.type('x')
            await until(lambda:pidf.with_suffix('.input').exists())
            await expect(rows).to_contain_text('INPUT-PROOF',timeout=10000)
            await page.screenshot(path=str(ROOT/'test-results/slow-viewer-input.png'))
            print('PASS slow mobile viewer settles after one attach redraw, with no ACK/resize loop and working input')
        finally:await context.close()
    finally:h.close()
async def main():
    h=Harness()
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch();page=await browser.new_page(viewport={'width':1100,'height':800})
            await page.goto(h.pair()['url']);await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=15000)
            await page.locator('#new-session-folder').click();await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click();await expect(page.locator('#modal')).not_to_be_visible()
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
            # Resizing for the keyboard must preserve the reader's anchor, including
            # when browsing older output; no jump to the first or newest row.
            await page.set_viewport_size({'width':390,'height':780});await asyncio.sleep(.5)
            await page.locator('#scroll-bottom').click()
            await page.locator('.terminal-container').hover();await page.mouse.wheel(0,-900);await asyncio.sleep(.4)
            anchor=(await page.locator('.xterm-rows > div').first.inner_text()).strip()
            assert anchor and 'LAST-ROW-PROVED' not in await page.locator('.xterm-rows').inner_text()
            await page.set_viewport_size({'width':390,'height':460});await asyncio.sleep(.5)
            assert (await page.locator('.xterm-rows > div').first.inner_text()).strip()==anchor, ('Keyboard resize moved the reading anchor',anchor,(await page.locator('.xterm-rows > div').first.inner_text()).strip())
            await page.set_viewport_size({'width':390,'height':780});await asyncio.sleep(.5)
            assert (await page.locator('.xterm-rows > div').first.inner_text()).strip()==anchor, 'Keyboard dismissal moved the reading anchor'
            await page.locator('#scroll-bottom').click();await asyncio.sleep(.2)
            await page.set_viewport_size({'width':390,'height':460});await asyncio.sleep(.5)
            await expect(page.locator('.xterm-rows')).to_contain_text('LAST-ROW-PROVED')
            await page.set_viewport_size({'width':1100,'height':800});await asyncio.sleep(.4)
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
            await hidden_burst_repaints(page,h)
            await slow_repaint_is_stable(browser)
            for name,setting in [('claude','CLAUDE_CONFIG_DIR'),('codex','CODEX_HOME')]:
                executable=shutil.which(name)
                if not executable:continue # Optional installed programs, core fixture is always required.
                await page.locator('#new-session-folder').click();await page.get_by_label('Session name').fill(name+' fixture');await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click();await expect(page.locator('#modal')).not_to_be_visible()
                config=h.root/name;config.mkdir()
                env=['env','-i','HOME='+str(config),'PATH=/usr/local/bin:/usr/bin:/bin','TERM=xterm-256color',setting+'='+str(config),'DISABLE_AUTOUPDATER=1','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',executable]
                await terminal_command(page,shlex.join(env))
                await expect(page.locator('.terminal-container:not([hidden]) .xterm-rows')).to_contain_text('Choose the text style' if name=='claude' else 'Welcome to Codex',timeout=20000)
                brand='claude' if name=='claude' else 'openai'
                await expect(page.locator('.session-tab.active .tab-symbol svg')).to_have_attribute('data-icon-name',brand,timeout=10000)
                await expect(page.locator('.terminal-container:not([hidden]) .pane-symbol svg')).to_have_attribute('data-icon-name',brand)
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
