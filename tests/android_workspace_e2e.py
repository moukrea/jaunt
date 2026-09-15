#!/usr/bin/env python3
"""Authorized Android emulator + isolated host identity on the project-owned relay.
No physical phone is claimed. Pairing material remains in memory/private fixtures.
"""
import asyncio,json,os,subprocess,sys,time,re,xml.etree.ElementTree as ET
from pathlib import Path
from browser_e2e import Harness,port,ROOT,terminal_command,until
from playwright.async_api import async_playwright,expect
ADB=[str(Path.home()/'Android/Sdk/platform-tools/adb'),'-s','emulator-5580']
def adb(*args):return subprocess.check_output([*ADB,*args],text=True)
async def main():
    h=Harness();browser=None
    try:
        h.host.terminate();h.host.wait(timeout=10)
        state=json.loads((h.state/'host.json').read_text());state['relay']='wss://jaunt-relay.moukrea.workers.dev';state['page']='https://moukrea.github.io/jaunt/'
        (h.state/'host.json').write_text(json.dumps(state))
        h.host=subprocess.Popen([sys.executable,'-m','jaunt.cli','daemon'],env=h.env,stdout=h.log,stderr=h.log)
        for _ in range(100):
            try:
                if json.loads(h.cli('status'))['connected']:break
            except Exception:pass
            await asyncio.sleep(.1)
        else:raise AssertionError('Fixture host did not connect')
        adb('install','-r',str(ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'))
        adb('shell','pm','clear','dev.jaunt.android.debug')
        adb('shell','pm','grant','dev.jaunt.android.debug','android.permission.POST_NOTIFICATIONS')
        adb('shell','settings','put','secure','show_ime_with_hard_keyboard','1')
        adb('shell','settings','put','system','accelerometer_rotation','0')
        adb('shell','settings','put','system','user_rotation','0')
        adb('shell','input','keyevent','224');adb('shell','wm','dismiss-keyguard')
        adb('shell','am','start','-n','dev.jaunt.android.debug/dev.jaunt.android.MainActivity')
        await asyncio.sleep(3)
        pid=adb('shell','pidof','dev.jaunt.android.debug').strip();debug=port()
        adb('forward',f'tcp:{debug}',f'localabstract:webview_devtools_remote_{pid}')
        async with async_playwright() as pw:
            browser=await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{debug}',no_defaults=True)
            page=browser.contexts[0].pages[0];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            await expect(page.locator('#pair-code')).to_be_visible()
            await page.locator('#pair-code').fill(h.pair()['code']);await page.locator('#pair-submit').click()
            await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=20000)
            await page.locator('#new-session-top').click();await page.get_by_label('Session name').fill('Android fixture');await page.get_by_label('Working directory').fill(str(h.work))
            await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
            await terminal_command(page,"printf 'android-native-proof' > android.txt")
            await until(lambda:(h.work/'android.txt').exists())
            assert (h.work/'android.txt').read_text()=='android-native-proof'
            adb('shell','input','keyevent','4');await asyncio.sleep(.5)
            before=await page.evaluate('innerHeight')
            # Tap the actual Android screen: CDP focus alone is not an IME interaction.
            adb('shell','uiautomator','dump','/sdcard/jaunt-ui.xml')
            nodes=ET.fromstring(adb('shell','cat','/sdcard/jaunt-ui.xml'))
            bounds=None
            for node in nodes.iter('node'):
                if node.get('class')=='android.webkit.WebView':bounds=list(map(int,re.findall(r'\d+',node.get('bounds'))));break
            assert bounds and bounds[1]>0,'WebView overlaps Android status bar'
            button=await page.locator('#keyboard-button').bounding_box();ratio=await page.evaluate('devicePixelRatio')
            adb('shell','input','tap',str(int(bounds[0]+(button['x']+button['width']/2)*ratio)),str(int(bounds[1]+(button['y']+button['height']/2)*ratio)))
            for _ in range(40):
                if await page.evaluate('window.jauntKeyboardVisible===true'):break
                await asyncio.sleep(.25)
            else:raise AssertionError('The Android keyboard did not open after tapping its UI button')
            after=await page.evaluate('innerHeight');assert after<before-100,(before,after)
            assert await page.evaluate("document.querySelector('#terminal-stage').getBoundingClientRect().bottom<=document.querySelector('.terminal-footer').getBoundingClientRect().top+1")
            assert await page.evaluate("document.querySelector('.actionbar').getBoundingClientRect().bottom<=innerHeight+1")
            await page.screenshot(path=str(ROOT/'test-results/android-keyboard.png'))
            adb('shell','input','keyevent','4');await asyncio.sleep(.5)
            adb('shell','settings','put','system','user_rotation','1');await asyncio.sleep(1)
            assert await page.evaluate('innerWidth>innerHeight')
            assert await page.evaluate("document.querySelector('.actionbar').getBoundingClientRect().bottom<=innerHeight+1")
            adb('shell','settings','put','system','user_rotation','0');await asyncio.sleep(.5)
            await page.locator('[data-view=settings]').last.click()
            await page.get_by_role('button',name='Enable',exact=True).click()
            await expect(page.get_by_role('button',name='Disable',exact=True)).to_be_visible(timeout=10000)
            for _ in range(40):
                if '1 / 1 hosts connected' in adb('shell','dumpsys','notification','--noredact'):break
                await asyncio.sleep(.25)
            else:raise AssertionError('Notification channel did not authenticate')
            sid=json.loads(h.cli('status'))['sessions'][0]['id']
            adb('shell','input','keyevent','3');adb('shell','input','keyevent','223')
            # A real terminal BEL, not a manually injected notification event.
            import socket
            with socket.socket(socket.AF_UNIX) as sock:
                sock.connect(str(h.state/'control.sock'));sock.sendall(b'{"method":"ui.connect"}\n');sock.recv(65536)
                frame={'type':'terminal.input','id':sid,'data':__import__('base64').urlsafe_b64encode(b"printf '\\a'\n").decode().rstrip('=')}
                sock.sendall((json.dumps(frame)+'\n').encode());await asyncio.sleep(.3)
            for _ in range(40):
                if 'needs your attention.' in adb('shell','dumpsys','notification','--noredact'):break
                await asyncio.sleep(.25)
            else:raise AssertionError('Terminal bell did not produce a screen-off Android notification')
            assert not errors,errors
            print('PASS Android emulator: native APK shell, status/gesture bar bounds, actual IME resize, rotation, terminal-bell OS notification with screen off; physical phone not tested')
    finally:
        if browser:await browser.close()
        adb('shell','am','force-stop','dev.jaunt.android.debug')
        h.close()
if __name__=='__main__':asyncio.run(main())
