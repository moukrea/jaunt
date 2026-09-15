"""Install and launch an actual PWA in an isolated browser and XDG profile."""
import sys,asyncio,tempfile,os
from pathlib import Path
from browser_e2e import Harness, ROOT
from playwright.async_api import async_playwright,expect
async def main():
 h=Harness()
 try:
  with tempfile.TemporaryDirectory(prefix='jaunt-pwa-profile-') as profile:
   async with async_playwright() as pw:
    context=await pw.chromium.launch_persistent_context(profile,headless=False,env={**os.environ,'XDG_DATA_HOME':profile+'/data','XDG_CONFIG_HOME':profile+'/config'},args=['--enable-features=WebAppEnableInstallDialog'])
    p=await context.new_page();await p.goto(h.url)
    await p.wait_for_function("'serviceWorker' in navigator")
    await p.evaluate('navigator.serviceWorker.ready')
    tab=await context.new_cdp_session(p)
    info=await tab.send('Page.getAppManifest')
    assert not (await tab.send('Page.getInstallabilityErrors'))['installabilityErrors']
    cdp=await context.browser.new_browser_cdp_session()
    manifest=info['manifest']['id']
    await cdp.send('PWA.install',{'manifestId':manifest,'installUrlOrBundleUrl':h.url})
    state=await cdp.send('PWA.getOsAppState',{'manifestId':manifest})
    assert state['badgeCount']==0,state
    await cdp.send('PWA.changeAppUserSettings',{'manifestId':manifest,'displayMode':'standalone'})
    await p.close()
    launched=await cdp.send('PWA.launch',{'manifestId':manifest})
    await asyncio.sleep(2)
    pages=context.pages
    app=next(x for x in pages if '?app=1' in x.url)
    await expect(app.locator('#site-home')).not_to_be_visible()
    await expect(app).to_have_title('jaunt (PWA)')
    await app.screenshot(path=str(ROOT/'test-results/pwa-installed.png'))
    await cdp.send('PWA.uninstall',{'manifestId':manifest})
    await context.close()
    print('PASS real isolated PWA installation, workspace launch and jaunt (PWA) title',state)
 finally:h.close()
asyncio.run(main())
