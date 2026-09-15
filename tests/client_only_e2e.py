#!/usr/bin/env python3
"""The actual Electron client pairs remotely without invoking a local CLI."""
import asyncio,json,os,subprocess
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,port,until,terminal_command
async def main():
 h=Harness(relay_url='wss://jaunt-relay.moukrea.workers.dev');electron=None
 try:
  desktop_root=h.root/'desktop';desktop_root.mkdir();(desktop_root/'mode.json').write_text('{"clientOnly":true}')
  marker=h.root/'unexpected-local-cli';launcher=h.root/'local-cli'
  launcher.write_text('#!/bin/sh\ntouch '+str(marker)+'\nexit 97\n');launcher.chmod(0o700)
  debug=port();env={**h.env,'DISPLAY':os.environ.get('DISPLAY',':179'),'jaunt_host_executable':str(launcher),'jaunt_DESKTOP_ROOT':str(desktop_root)};env.pop('ELECTRON_RUN_AS_NODE',None)
  if os.environ.get('XAUTHORITY'):env['XAUTHORITY']=os.environ['XAUTHORITY']
  electron=subprocess.Popen([str(ROOT/'node_modules/.bin/electron'),'.','--lang=en-US','--ozone-platform=x11','--disable-gpu','--no-sandbox',f'--user-data-dir={h.root}/client-profile',f'--remote-debugging-port={debug}'],cwd=ROOT,env=env,stdout=h.log,stderr=h.log)
  async with async_playwright() as pw:
   native=None
   for _ in range(100):
    try:native=await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{debug}');break
    except Exception:await asyncio.sleep(.1)
   assert native;p=native.contexts[0].pages[0]
   await expect(p.locator('#pair-submit')).to_be_visible(timeout=20000);assert await p.title()=='jaunt'
   assert await p.evaluate('window.jauntDesktop.capabilities()')=={'localHost':False}
   await expect(p.locator('#machine-list .machine-item')).to_have_count(0);await expect(p.locator('#site-home')).not_to_be_visible()
   await p.locator('#settings-button').click();await expect(p.locator('#settings-content')).not_to_contain_text('LOCAL HOST ON THIS COMPUTER');await expect(p.locator('#settings-content')).not_to_contain_text('Install host and desktop app')
   await p.locator('#app-language').select_option('fr');await expect(p.locator('html')).to_have_attribute('lang','fr')
   await p.locator('#settings-button').click();await p.locator('#app-language').select_option('en');await expect(p.locator('html')).to_have_attribute('lang','en')
   await p.locator('#pair-code').fill(h.pair()['code']);await p.locator('#pair-submit').click();await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await p.locator('#new-session-folder').click();await p.get_by_label('Working directory').fill(str(h.work));await p.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
   await terminal_command(p,"printf client-only > client-proof.txt");await until(lambda:(h.work/'client-proof.txt').exists());assert (h.work/'client-proof.txt').read_text()=='client-only'
   assert not marker.exists(),'Client-only desktop attempted to run a local host CLI'
   await native.close()
  print('PASS actual client-only Electron: no local CLI calls or host controls, remote pairing and shell execution, native locale override and jaunt title')
 finally:
  if electron and electron.poll() is None:electron.terminate();electron.wait(timeout=15)
  h.close()
if __name__=='__main__':asyncio.run(main())
