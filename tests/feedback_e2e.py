#!/usr/bin/env python3
"""Real interrupted handshakes/RPCs, bounded feedback and stable operation controls."""
import asyncio,re,json,signal
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,terminal_command,until,ROOT
async def main():
 h=Harness();other=Harness(name='machine X');stopped=False
 try:
  async with async_playwright() as pw:
   browser=await pw.chromium.launch();page=await browser.new_page(viewport={'width':1100,'height':800})
   await page.add_init_script("""(()=>{const send=WebSocket.prototype.send;let failures=3;
    WebSocket.prototype.send=function(data){const result=send.call(this,data);try{const frame=JSON.parse(data);if(failures>0&&frame.type==='route'&&frame.data?.type==='hello'){failures--;setTimeout(()=>this.close(),0);}}catch{}return result;};})();""")
   await page.goto(h.pair()['url']);await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await expect(page.locator('#toasts .error')).to_have_count(0)
   await page.locator('#new-session-folder').click();await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
   await terminal_command(page,"printf 'before' > feedback-proof.txt");await until(lambda:(h.work/'feedback-proof.txt').exists())
   before=json.loads(h.cli('status'))['sessions'][0]
   await page.locator('[data-view=files]').first.click();await page.get_by_label('Directory path').fill(str(h.work));await page.get_by_label('Directory path').press('Enter');await expect(page.locator('#file-list')).to_contain_text('feedback-proof.txt')
   h.host.send_signal(signal.SIGSTOP);stopped=True
   await page.evaluate("()=>{for(let i=0;i<5;i++)document.querySelector('#file-refresh').click();}")
   await asyncio.sleep(.2);h.kill_relay()
   await expect(page.locator('#connection span')).not_to_have_text('Encrypted',timeout=10000)
   await expect(page.locator('#connection-banner')).to_be_visible()
   await expect(page.locator('#toasts .error')).to_have_count(0)
   assert await page.locator('#feedback .feedback-error').count()<=1,'One outage produced multiple error panels'
   h.host.send_signal(signal.SIGCONT);stopped=False;h.restart_relay()
   await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=20000)
   await expect(page.locator('#connection-banner')).not_to_be_visible()
   await expect(page.locator('#toasts .error')).to_have_count(0)
   await page.locator('[data-view=terminal]').first.click();await terminal_command(page,"printf 'after' >> feedback-proof.txt")
   await until(lambda:(h.work/'feedback-proof.txt').read_text()=='beforeafter')
   after=json.loads(h.cli('status'))['sessions'][0];assert (before['id'],before['pid'])==(after['id'],after['pid'])
   # Component boundary: repeated reports of one failure occupy one persistent
   # place; a failed modal action stays inside the dialog rather than a toast.
   await page.evaluate("async()=>{const ui=await import('./js/ui.mjs');for(let i=0;i<5;i++)ui.reportError(new Error('Permission denied. Choose another directory.'));}")
   await expect(page.locator('#feedback .feedback-error')).to_have_count(1)
   await expect(page.locator('#feedback')).to_contain_text('Permission denied')
   await page.locator('#feedback').get_by_role('button',name='Dismiss').click()
   await page.evaluate("async()=>{const {modal,el,button}=await import('./js/ui.mjs');modal('Operation fixture',el('div',{},button('Try operation',async()=>{throw new Error('The destination is read-only.');})));}")
   await page.get_by_role('button',name='Try operation',exact=True).click();await expect(page.locator('#modal-error')).to_contain_text('read-only')
   await expect(page.locator('#toasts .error')).to_have_count(0);await page.locator('#modal-close').click()
   await page.evaluate("async()=>{const {activity}=await import('./js/activity.mjs');window.job=activity('fixture','Image transfer');window.retryCalls=0;job.update({action:{label:'Cancel fixture',run:()=>{window.retryCalls++;job.finish('Cancelled by user');}}});window.progressTimer=setInterval(()=>job.update({status:'Uploading image…',percent:20}),30);}")
   await page.get_by_role('button',name='Cancel fixture',exact=True).click()
   await page.evaluate('clearInterval(window.progressTimer)');assert await page.evaluate('window.retryCalls')==1
   await expect(page.locator('#activity')).to_contain_text('Cancelled by user')
   await page.evaluate("async()=>{const {activity}=await import('./js/activity.mjs');for(let i=0;i<8;i++)activity('completed-'+i,'Completed transfer '+i).finish('Uploaded and verified');}")
   await expect(page.locator('#activity .activity-row:visible')).to_have_count(1)
   await expect(page.locator('#activity')).to_have_attribute('data-tone','done')
   # A failed and a running operation: the strip shows only the most important one, tinted accordingly; never a stack.
   await page.evaluate("async()=>{const {activity}=await import('./js/activity.mjs');activity('running-x','Running thing').update({status:'Uploading…',percent:40});activity('failed-x','Failed thing').fail(new Error('disk full'));}")
   await expect(page.locator('#activity')).to_have_attribute('data-tone','error');await expect(page.locator('#activity .activity-row:visible')).to_have_count(1);await expect(page.locator('#activity .activity-row:visible')).to_contain_text('Failed thing')
   await page.evaluate("async()=>{const {activity}=await import('./js/activity.mjs');activity('failed-x','Failed thing').finish('ok');}")
   await expect(page.locator('#activity')).to_have_attribute('data-tone','running');await expect(page.locator('#activity .activity-row:visible')).to_contain_text('Running thing')
   await page.evaluate("async()=>{const {activity}=await import('./js/activity.mjs');activity('running-x','Running thing').finish('ok');}")
   await page.get_by_role('button',name='Show history (11)',exact=True).click();await expect(page.locator('#activity .activity-row:visible')).to_have_count(11)
   await page.get_by_role('button',name='Hide history',exact=True).click()
   await page.set_viewport_size({'width':390,'height':460});await asyncio.sleep(.4)
   assert await page.evaluate("document.querySelector('#terminal-stage').getBoundingClientRect().bottom<=document.querySelector('.terminal-footer').getBoundingClientRect().top+1")
   await page.screenshot(path=str(ROOT/'test-results/feedback-mobile.png'))
   # Two real hosts in one vault: switching while Settings stays open must
   # replace both the displayed identity and every host-bound action.
   await page.set_viewport_size({'width':1100,'height':800})
   await page.locator('#add-machine').click()
   await page.get_by_label('Pairing code',exact=True).fill(other.pair()['url'])
   await page.locator('#modal').get_by_role('button',name='Pair machine',exact=True).click()
   await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await page.locator('#settings-button').click()
   await expect(page.get_by_label('Friendly host name')).to_have_value('machine X')
   await page.locator('#machine-list').get_by_role('button',name='jaunt workstation').click()
   await expect(page.get_by_label('Friendly host name')).to_have_value('jaunt workstation')
   await page.get_by_label('Friendly host name').fill('machine Y')
   await page.get_by_label('Friendly host name').press('Tab')
   await expect(page.locator('#machine-title')).to_have_text('machine Y')
   # The host name in the top bar opens a switcher listing the paired hosts; a remote online host shows a green globe.
   await expect(page.locator('#host-symbol svg')).to_have_attribute('data-icon-name','globe');await expect(page.locator('#host-symbol')).to_have_class(re.compile('online'))
   await page.locator('#host-switch').click();await expect(page.locator('.host-menu .host-menu-item')).to_have_count(2)
   await page.locator('.host-menu').get_by_role('menuitem',name=re.compile('machine X')).click()
   await expect(page.locator('#machine-title')).to_have_text('machine X');await expect(page.locator('.host-menu')).to_have_count(0)
   print('PASS the top bar host name switches hosts from a menu; host symbol shows type and state',flush=True)
   # Operations are scoped to their host: X's failed job is not shown while Y is selected, but Y's sidebar entry for X carries a badge.
   room_x=json.loads(other.cli('status'))['machine']['room']
   await page.evaluate("async r=>{const {activity}=await import('./js/activity.mjs');activity('x-job','X only job',r).fail(new Error('boom'));}",room_x)
   await expect(page.locator('#activity')).to_contain_text('X only job')
   await page.locator('#host-switch').click();await page.locator('.host-menu').get_by_role('menuitem',name=re.compile('machine Y')).click()
   await expect(page.locator('#machine-title')).to_have_text('machine Y');await expect(page.locator('#activity')).not_to_contain_text('X only job')
   await expect(page.locator('#machine-list').get_by_role('button',name='machine X').locator('.notif-badge')).to_have_text('1')
   await page.locator('#machine-list').get_by_role('button',name='machine X').click();await expect(page.locator('#activity')).to_contain_text('X only job')
   print('PASS activity is scoped to the selected host; other hosts show a badge',flush=True)
   # A host notification toast names its host.
   other.cli('notify','Hello from X')
   await expect(page.locator('#toasts .toast').filter(has_text='Hello from X').locator('.toast-host')).to_contain_text('machine X',timeout=15000)
   print('PASS toasts name the host they are about',flush=True)
   await expect(page.get_by_label('Friendly host name')).to_have_value('machine X')
   # Forget must target X, not the previously rendered Y. Y's live shell remains.
   await page.locator('#settings-content').get_by_role('button',name='Forget',exact=True).click()
   await page.locator('#modal').get_by_role('button',name='Forget',exact=True).click()
   await expect(page.locator('#machine-list .machine-item')).to_have_count(1)
   await expect(page.get_by_label('Friendly host name')).to_have_value('machine Y')
   assert json.loads(h.cli('status'))['sessions'][0]['pid']==before['pid']
   print('PASS Settings switches between two real paired hosts; rename and forget target the selected host; other host PTY preserved',flush=True)
   await browser.close()
   print('PASS three interrupted real handshakes; five interrupted RPCs share one connection state with no error toasts; same PTY resumes; contextual errors; clickable progress controls; compact retained results; mobile terminal bounds')
 finally:
  if stopped:h.host.send_signal(signal.SIGCONT)
  h.close();other.close()
if __name__=='__main__':asyncio.run(main())
