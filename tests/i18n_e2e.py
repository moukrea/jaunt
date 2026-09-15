#!/usr/bin/env python3
"""System locale, explicit override and literal user content in real browsers."""
import asyncio,json,os,subprocess,tempfile,sys
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   for lang in ['en','fr','es','it','pt','de']:
    catalog=json.loads((ROOT/'host/jaunt/locales'/f'{lang}.json').read_text())
    context=await b.new_context(locale=lang+'-'+{'en':'US','fr':'FR','es':'ES','it':'IT','pt':'PT','de':'DE'}[lang]);p=await context.new_page();await p.goto(h.url)
    await expect(p.locator('html')).to_have_attribute('lang',lang)
    await expect(p.locator('#open-workspace')).to_have_text(catalog['Open workspace'])
    await p.locator('#open-workspace').click();await p.locator('#settings-button').click()
    await expect(p.locator('#app-language')).to_have_value('system')
    result=await p.evaluate("async()=>{const {t}=await import('./js/i18n.mjs');return t('Terminal {0}','MY_UNTRANSLATED_SHELL');}")
    assert 'MY_UNTRANSLATED_SHELL' in result
    await p.locator('#app-language').select_option('en' if lang!='en' else 'fr')
    await expect(p.locator('html')).to_have_attribute('lang','en' if lang!='en' else 'fr')
    await context.close()
   await b.close()
  with tempfile.TemporaryDirectory(prefix='jaunt-language-test-') as tmp:
   env={**os.environ,'PYTHONPATH':str(ROOT/'host'),'jaunt_STATE':tmp,'LANG':'fr_FR.UTF-8','LC_ALL':'fr_FR.UTF-8'}
   def cli(*args):return subprocess.check_output([sys.executable,'-m','jaunt.cli',*args],env=env,text=True)
   for lang in ['en','fr','es','it','pt','de']:
    text=cli('--language',lang,'--help');assert '--language' in text and '--help' in text and 'desktop-bridge' in text
   cli('language','de');assert json.loads((Path(tmp)/'language.json').read_text())['language']=='de'
   assert 'Einstellungen' not in cli('--language','en','--help')
  print('PASS six browser system locales, persistent overrides, literal user content and six CLI help languages with unchanged arguments')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
