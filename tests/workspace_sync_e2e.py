#!/usr/bin/env python3
"""Shared open sessions: two clients of one host show the same tabs; × offers close or terminate;
'only displayed sessions exist' makes × terminate and hides the Sessions list."""
import asyncio,json
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,until
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   A=await (await b.new_context(viewport={'width':1300,'height':900})).new_page();await A.goto(h.pair()['url'])
   await expect(A.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   B=await (await b.new_context(viewport={'width':1300,'height':900})).new_page();await B.goto(h.pair()['url'])
   await expect(B.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   # A creates a shell; B does not show it (each device keeps its own open views).
   await A.locator('#new-session-folder').click();await A.get_by_label('Session name').fill('Shared one');await A.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
   await expect(A.locator('#tabs')).to_contain_text('Shared one')
   await B.locator('#list-sessions').click();await expect(B.locator('#modal')).to_contain_text('Shared one');await B.keyboard.press('Escape')
   # Sharing on from A: B adopts A's tabs.
   await A.locator('#settings-button').click();await A.get_by_label('Share open sessions with this host').check()
   await expect(B.locator('#tabs')).to_contain_text('Shared one',timeout=15000)
   print('PASS turning on shared open sessions makes the other client show the same tab')
   # B opens a second shell: A follows.
   await B.locator('[data-view="terminal"]').first.click();await B.locator('#new-session-tab').click()
   await until(lambda:len(json.loads(h.cli('status'))['sessions'])==2)
   await expect(A.locator('#tabs .session-tab')).to_have_count(2,timeout=15000)
   print('PASS a shell opened on one client appears on the other')
   # × on A offers the choice; closing the view keeps the shell alive and B follows.
   await A.locator('[data-view="terminal"]').first.click()
   await A.locator('.session-tab').filter(has_text='Shared one').locator('.tab-close').click()
   await expect(A.locator('.close-menu')).to_be_visible();await A.locator('.close-menu').get_by_role('button',name='Close view',exact=True).click()
   await expect(A.locator('#tabs')).not_to_contain_text('Shared one');await expect(B.locator('#tabs')).not_to_contain_text('Shared one',timeout=15000)
   assert all(s['alive'] for s in json.loads(h.cli('status'))['sessions'])
   print('PASS × offers close or terminate; a closed view keeps the shell and the other client follows')
   # Only displayed sessions exist: × terminates without a menu and the Sessions list disappears.
   await B.locator('#settings-button').click();await B.get_by_label('Only displayed sessions exist').check()
   await expect(A.locator('#list-sessions')).to_be_hidden(timeout=15000)
   await A.locator('.session-tab .tab-close').first.click()
   await expect(A.locator('.close-menu')).to_have_count(0)
   await until(lambda:len(json.loads(h.cli('status'))['sessions'])==1,timeout=20)
   print('PASS only displayed sessions exist: × terminates directly and the Sessions list is hidden')
   # Touch: a swipe over a tab scrolls the strip; a held press then a move reorders.
   m=await (await b.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)).new_page();await m.goto(h.pair()['url'])
   await expect(m.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   for i in range(5):
    await m.locator('#new-session-tab').click();await until(lambda:len(json.loads(h.cli('status'))['sessions'])==i+2)
   await expect(m.locator('#tabs .session-tab').nth(4)).to_be_visible(timeout=10000)
   cdp=await m.context.new_cdp_session(m)
   async def swipe(x,y,dx,hold=0):
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]});await asyncio.sleep(hold)
    for i in range(1,13):await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x+dx*i/12,'y':y}]});await asyncio.sleep(0.016)
    await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
   label=await m.locator('#tabs .session-tab .tab-label').first.bounding_box();first=await m.locator('#tabs .session-tab .tab-label').first.text_content()
   await swipe(label['x']+label['width']/2,label['y']+label['height']/2,-150);await asyncio.sleep(0.4)
   assert await m.evaluate("document.getElementById('tabs').scrollLeft")>50 and await m.locator('#tabs .session-tab .tab-label').first.text_content()==first
   await m.evaluate("document.getElementById('tabs').scrollLeft=0")
   await swipe(label['x']+label['width']/2,label['y']+label['height']/2,150,hold=0.6);await asyncio.sleep(0.4)
   assert await m.locator('#tabs .session-tab .tab-label').first.text_content()!=first
   print('PASS touch: a swipe over a tab scrolls the strip; a held press then a move reorders')
   await b.close();print('5 workspace sync checks passed.')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
