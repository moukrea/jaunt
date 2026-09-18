#!/usr/bin/env python3
"""Real hosts: stable tab order, pointer reordering, rename, layout and scroll."""
import asyncio,json
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,terminal_command,until
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch();p=await b.new_page(viewport={'width':1280,'height':840})
   await p.goto(h.url);await expect(p.locator('#site-home')).to_be_visible();await expect(p.locator('#app')).not_to_be_visible()
   await p.locator('#open-workspace').click();await expect(p.locator('#pair-submit')).to_be_visible()
   url=h.pair()['url'];url=url.replace('#','?debug=1#',1) if '#' in url else url+'?debug=1'
   await p.goto(url);await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   for name in ['one','two','three']:
    await p.locator('#new-session-folder').click();await p.get_by_label('Session name').fill(name);await p.get_by_label('Working directory').fill(str(h.work));await p.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
    await expect(p.get_by_role('tab',name=name,exact=True)).to_be_visible()
   names=lambda:p.locator('#tabs [role=tab]').all_text_contents()
   assert await names()==['one','two','three']
   for name in ['one','three','two','one']:
    await p.get_by_role('tab',name=name,exact=True).click();assert await names()==['one','two','three']
   source=await p.get_by_role('tab',name='three',exact=True).bounding_box();target=await p.get_by_role('tab',name='one',exact=True).bounding_box()
   await p.mouse.move(source['x']+source['width']/2,source['y']+15);await p.mouse.down();await p.mouse.move(target['x']+10,target['y']+15,steps=12);await p.mouse.up()
   await expect(p.locator('#tabs [role=tab]').first).to_have_text('three')
   await p.get_by_role('tab',name='two',exact=True).hover();await p.mouse.down();await asyncio.sleep(2.1);await p.mouse.up();await expect(p.locator('#modal')).not_to_be_visible()
   await p.get_by_role('tab',name='two',exact=True).dblclick();await expect(p.locator('#modal')).to_be_visible();await p.get_by_label('Name',exact=True).fill('renamed');await p.locator('#modal').get_by_role('button',name='Save',exact=True).click()
   await expect(p.get_by_role('tab',name='renamed',exact=True)).to_be_visible()
   # Enter saves the rename; Escape cancels it.
   await p.get_by_role('tab',name='renamed',exact=True).dblclick();await p.get_by_label('Name',exact=True).fill('entered');await p.keyboard.press('Enter')
   await expect(p.get_by_role('tab',name='entered',exact=True)).to_be_visible();await expect(p.locator('#modal')).to_be_hidden()
   await p.get_by_role('tab',name='entered',exact=True).dblclick();await p.get_by_label('Name',exact=True).fill('discarded');await p.keyboard.press('Escape')
   await expect(p.locator('#modal')).to_be_hidden();await expect(p.get_by_role('tab',name='entered',exact=True)).to_be_visible()
   await p.get_by_role('tab',name='entered',exact=True).dblclick();await p.get_by_label('Name',exact=True).fill('renamed');await p.keyboard.press('Enter');await expect(p.get_by_role('tab',name='renamed',exact=True)).to_be_visible()
   await p.locator('#settings-button').click();await expect(p.get_by_label('Friendly host name')).to_be_visible()
   for width in [1280,1000,780,390]:
    await p.set_viewport_size({'width':width,'height':840});await asyncio.sleep(.2)
    bounds=await p.evaluate("()=>{const n=document.querySelector('.machine-row input[aria-label]');const row=n.closest('.settings-row'),label=row.querySelector('.settings-label'),r=row.getBoundingClientRect(),l=label.getBoundingClientRect(),i=n.getBoundingClientRect();return {label:l.width,description:label.querySelector('p').getBoundingClientRect().height,overflow:i.right>r.right+1};}")
    assert bounds['label']>=150 and bounds['description']<90 and not bounds['overflow'],bounds
   # The key bar is a touch aid: absent with a real keyboard, present at phone width.
   await p.set_viewport_size({'width':1280,'height':840});await asyncio.sleep(.2)
   assert not await p.locator('#keybar').is_visible(),'the key row has no place on a desktop window'
   await p.set_viewport_size({'width':390,'height':840});await asyncio.sleep(.3)
   await p.locator('.mobile-nav [data-view=terminal]').click();await asyncio.sleep(.3)
   assert await p.locator('#keybar').is_visible(),'the key row is there on a phone'
   await p.set_viewport_size({'width':1280,'height':840});await asyncio.sleep(.2)
   # Two settings scopes: the app's own in the sidebar, the machine's from the gear in its bar.
   await p.locator('#settings-button').click()
   await expect(p.locator('#settings-content')).to_contain_text('YOUR MACHINES')
   await expect(p.locator('#settings-content')).not_to_contain_text('AGENTS AND MACHINES')
   await p.locator('#host-settings').click()
   await expect(p.locator('#settings-title')).to_contain_text('settings')
   await expect(p.locator('#settings-content')).to_contain_text('THIS MACHINE')
   await expect(p.locator('#settings-content')).not_to_contain_text('YOUR MACHINES')
   print('PASS the app settings keep the machines you name; each machine has its own settings behind the gear of its bar',flush=True)
   # An operation that ends quietly leaves the strip; one that fails is kept, badged, and dismissable.
   await p.evaluate("jauntActivityKeep(400)")
   await p.evaluate("jauntActivity('probe-ok','Quiet operation','done')")
   await expect(p.locator('#activity')).to_contain_text('Quiet operation')
   await expect(p.locator('#activity')).not_to_contain_text('Quiet operation',timeout=15000)
   assert await p.locator('#host-notifications-badge').is_hidden()
   await p.evaluate("jauntActivity('probe-bad','Failed operation','fail')")
   await expect(p.locator('#host-notifications-badge')).to_have_text('1',timeout=15000)
   await expect(p.locator('#activity')).not_to_contain_text('Failed operation')
   await p.locator('#host-notifications').click()
   await expect(p.locator('#modal')).to_contain_text('Failed operation')
   await p.locator('#modal').get_by_role('button',name='Dismiss',exact=True).first.click()
   await expect(p.locator('#host-notifications-badge')).to_be_hidden()
   await p.keyboard.press('Escape');await p.evaluate("jauntActivityKeep(60000)")
   print('PASS a quiet operation leaves the strip by itself; a failed one is kept in the host notifications and can be dismissed',flush=True)
   await p.set_viewport_size({'width':1280,'height':840});await p.locator('#sidebar-toggle').click();await expect(p.locator('body')).to_have_class('sidebar-collapsed')
   assert (await p.locator('#sidebar').bounding_box())['width']<100
   await p.reload();await expect(p.locator('body')).to_have_class('sidebar-collapsed');await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   assert await names()==['three','one','renamed']
   await p.get_by_role('tab',name='one',exact=True).click()
   await terminal_command(p,"for i in $(seq 1 200); do printf 'HISTORY-%03d\\n' \"$i\"; done; echo HISTORY-END")
   await expect(p.locator('.terminal-container:not([hidden]) .xterm-rows')).to_contain_text('HISTORY-END')
   await p.set_viewport_size({'width':390,'height':740});await asyncio.sleep(.5)
   await p.locator('.terminal-container:not([hidden])').hover();await p.mouse.wheel(0,-1000);await asyncio.sleep(.3)
   first=(await p.locator('.terminal-container:not([hidden]) .xterm-rows>div').first.inner_text()).strip();assert first.startswith('HISTORY-'),first
   await p.get_by_role('tab',name='three',exact=True).click();await p.get_by_role('tab',name='one',exact=True).click();await asyncio.sleep(.4)
   assert (await p.locator('.terminal-container:not([hidden]) .xterm-rows>div').first.inner_text()).strip()==first
   await p.locator('.terminal-container:not([hidden])').click(position={'x':50,'y':100});await asyncio.sleep(.4)
   assert (await p.locator('.terminal-container:not([hidden]) .xterm-rows>div').first.inner_text()).strip()==first
   await p.evaluate("async()=>{const {toast}=await import('./js/ui.mjs');toast('A completed operation with a long result that must wrap naturally without squeezing its close button.',false,{label:'Open',run:()=>{}});}")
   row=await p.locator('.toast').evaluate("n=>{const p=n.querySelector('p').getBoundingClientRect(),b=n.querySelector('.icon-button').getBoundingClientRect(),r=n.getBoundingClientRect();return {text:p.width,button:b.width,overlap:p.right>b.left+1,overflow:r.right>innerWidth};}")
   assert row['text']>150 and row['button']>=28 and not row['overlap'] and not row['overflow'],row
   await p.screenshot(path=str(ROOT/'test-results/usability-mobile.png'))
   await b.close();print('PASS web presentation; stable session tabs; pointer reorder and reload persistence; double-click rename; Settings layout; collapsed sidebar persistence; mobile history anchor across activation; notification wrapping')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
