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
   await p.goto(h.pair()['url']);await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
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
   await p.locator('#settings-button').click();await expect(p.get_by_label('Friendly host name')).to_be_visible()
   for width in [1280,1000,780,390]:
    await p.set_viewport_size({'width':width,'height':840});await asyncio.sleep(.2)
    bounds=await p.get_by_label('Friendly host name').evaluate("n=>{const row=n.closest('.settings-row'),label=row.querySelector('.settings-label'),r=row.getBoundingClientRect(),l=label.getBoundingClientRect(),i=n.getBoundingClientRect();return {label:l.width,description:label.querySelector('p').getBoundingClientRect().height,overflow:i.right>r.right+1};}")
    assert bounds['label']>=150 and bounds['description']<90 and not bounds['overflow'],bounds
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
