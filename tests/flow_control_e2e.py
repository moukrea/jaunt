#!/usr/bin/env python3
"""Only visible terminals receive the stream; a viewer on a slow link is never buried under output
(bounded in-flight window, acknowledged as rendered); a hidden terminal catches up quickly when shown;
notifications from hidden terminals still arrive. Uses Chrome's network throttling on the WebSocket."""
import asyncio,json,re,time
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,until,terminal_command
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch();p=await (await b.new_context(viewport={'width':1300,'height':844})).new_page()
   url=h.pair()['url'];base,_,frag=url.partition('#');await p.goto(base+'?debug=1#'+frag)
   await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   names=['quiet','chatty','ringer']
   for name in names:
    await p.locator('#new-session-folder').click();await p.get_by_label('Session name').fill(name);await p.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
    await expect(p.locator('#tabs')).to_contain_text(name)
   status=lambda:{s['name']:s for s in json.loads(h.cli('status'))['sessions']}
   ids={n:status()[n]['id'] for n in names}
   # 'ringer' is selected last, so it is the only one this device views on the host.
   await until(lambda:[n for n,s in status().items() if s['viewers']]==['ringer'])
   print('PASS only the displayed terminal is a viewer on the host; hidden tabs are detached')
   # Start a producer well above the throttled link (about 400 KB/s) in the hidden 'chatty' tab, and a bell in 'ringer'.
   await p.get_by_role('tab',name='chatty',exact=True).click();await until(lambda:status()['chatty']['viewers'])
   await terminal_command(p,"i=0; while :; do i=$((i+1)); printf '\\033[H\\033[2JCOUNTER %d\\n' $i; head -c 4000 /dev/zero | tr '\\0' .; sleep 0.01; done")
   async def counter():
    for _ in range(50):
     m=re.search(r'COUNTER (\d+)',await p.evaluate('window.jauntScreen()'))
     if m:return int(m.group(1))
     await asyncio.sleep(.1)
    await p.screenshot(path='test-results/flow-control-failure.png');raise AssertionError('no counter on screen')
   assert await counter()>0
   await p.get_by_role('tab',name='ringer',exact=True).click();await until(lambda:not status()['chatty']['viewers'])
   cdp=await p.context.new_cdp_session(p);await cdp.send('Network.enable')
   await cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':120,'downloadThroughput':200*1024,'uploadThroughput':200*1024})
   await asyncio.sleep(3)
   rtt=await p.evaluate('window.jauntPing()');assert rtt<1500,f'a hidden chatty tab must not load the link (rtt {rtt} ms)'
   print(f'PASS a hidden chatty terminal costs nothing on the link (rpc round trip {rtt} ms on a 200 KB/s link)')
   # Show the chatty tab on the throttled link: bounded catch-up, then live and responsive.
   t0=time.time();await p.get_by_role('tab',name='chatty',exact=True).click()
   await expect(p.locator('.terminal-container:not([hidden])')).not_to_have_class(re.compile('terminal-restoring'),timeout=15000)
   c1=await counter();print(f'  restored in {time.time()-t0:.1f}s at COUNTER {c1}')
   # The window collapses and the stream converges within a few seconds; slow CI runners take longer.
   c2=c1
   for i in range(15):
    await asyncio.sleep(1);st=status()['chatty'];m=re.search(r'COUNTER (\d+)',await p.evaluate('window.jauntScreen()'))
    print(f'  t+{i+1}s screen {m.group(1) if m else None} host offset {st["offset"]} flow {list(st["flow"].values())}')
    if m:c2=max(c2,int(m.group(1)))
    if c2>c1+20:break
   rtt=await p.evaluate('window.jauntPing()')
   assert c2>c1+20,f'the visible chatty terminal must stay live on a slow link ({c1} -> {c2})'
   assert rtt<4000,f'output must not bury control traffic on a slow link (rtt {rtt} ms)'
   print(f'PASS a chatty terminal on a 200 KB/s link stays live (COUNTER {c1} -> {c2}) with a bounded backlog (rtc {rtt} ms)')
   # A bell from the hidden 'ringer' terminal still notifies.
   await p.get_by_role('tab',name='quiet',exact=True).click();await until(lambda:not status()['ringer']['viewers'])
   await p.get_by_role('tab',name='ringer',exact=True).click();await until(lambda:status()['ringer']['viewers']);await terminal_command(p,"sleep 1; printf '\\a'")
   await p.get_by_role('tab',name='quiet',exact=True).click();await until(lambda:not status()['ringer']['viewers'])
   await expect(p.locator('#toasts .toast').filter(has_text='ringer')).to_be_visible(timeout=15000)
   print('PASS a bell from a hidden terminal still notifies')
   await cdp.send('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
   await b.close();print('4 flow control checks passed.')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
