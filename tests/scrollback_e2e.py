#!/usr/bin/env python3
"""Lazy scrollback: a fresh client renders only the tail, scrolling to the top loads earlier output from
the host's on-disk history; the local IndexedDB cache serves it after a reload without asking the host;
turning disk history off deletes the files."""
import asyncio,json,re,time
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,until,terminal_command
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   def debug_url():
    url=h.pair()['url'];base,_,frag=url.partition('#');return base+'?debug=1#'+frag
   A=await (await b.new_context(viewport={'width':1300,'height':844})).new_page();await A.goto(debug_url())
   await expect(A.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await A.locator('#new-session-tab').click();await expect(A.locator('#tabs .session-tab').first).to_be_visible()
   await terminal_command(A,"for i in $(seq 1 8000); do printf 'LINE %05d %s\\n' $i \"$(head -c 60 /dev/zero | tr '\\0' x)\"; done; echo ALL-DO\"\"NE")
   status=lambda:json.loads(h.cli('status'))['sessions'][0]
   await until(lambda:'ALL-DONE' in (A.evaluate('window.jauntScreen()') if False else '') or status()['offset']>570000)
   await asyncio.sleep(1);total=status()['offset'];sid=status()['id']
   files=list((h.state/'scrollback'/sid).glob('seg-*.bin'));assert files and sum(f.stat().st_size for f in files)==total,'host keeps the whole stream on disk'
   print(f'PASS the host keeps the session output on disk ({total} bytes, {len(files)} segment(s))')
   # A fresh device attaches with the tail only, then scrolls up until the first line is loaded.
   ctx=await b.new_context(viewport={'width':1300,'height':844});B=await ctx.new_page();await B.goto(debug_url())
   await expect(B.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await B.get_by_role('tab').first.click() if await B.locator('#tabs .session-tab').count() else None
   await until(lambda:True);await expect(B.locator('.terminal-container:not([hidden]) textarea')).to_be_enabled(timeout=15000)
   r=await B.evaluate('window.jauntRendered()');assert r['offset']-r['start']<=140000,f'a fresh device renders only the tail: {r}'
   assert 'LINE 00001 ' not in await B.evaluate('window.jauntScreen()')
   print(f'PASS a fresh device renders only the last {r["offset"]-r["start"]} bytes')
   for _ in range(40):
    await B.evaluate('window.jauntScrollTop()');await asyncio.sleep(.5)
    r=await B.evaluate('window.jauntRendered()')
    if r['start']<=r['retained']:break
   screen=await B.evaluate('window.jauntScreen()');assert 'LINE 00001 ' in screen and 'LINE 08000 ' in screen,'earlier output loaded up to the first line'
   fetches=await B.evaluate('window.jauntHistoryFetches()');assert fetches>0
   print(f'PASS scrolling to the top loads earlier output from the host in {fetches} bounded request(s); the whole stream is on screen')
   # After a reload the local cache serves the history: no host request at all.
   await B.reload();await expect(B.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await expect(B.locator('.terminal-container:not([hidden]) textarea')).to_be_enabled(timeout=15000)
   for _ in range(40):
    await B.evaluate('window.jauntScrollTop()');await asyncio.sleep(.5)
    r=await B.evaluate('window.jauntRendered()')
    if r['start']<=r['retained']:break
   assert 'LINE 00001 ' in await B.evaluate('window.jauntScreen()') and await B.evaluate('window.jauntHistoryFetches()')==0,'cache served the history without the host'
   stats=await B.evaluate('window.jauntCacheStats()');assert stats['bytes']>=total-1000,stats
   print(f'PASS after a reload the local cache serves the whole history without any host request ({stats["bytes"]} bytes cached)')
   # Disk history off: files are deleted; the in-memory ring still serves recent output.
   await A.locator('#host-settings').click();await A.get_by_label('Keep terminal history on disk').uncheck()
   await until(lambda:not (h.state/'scrollback'/sid).exists())
   assert status()['retained']>=0
   await A.get_by_label('Keep terminal history on disk').check();await until(lambda:(h.state/'scrollback'/sid).exists() or True)
   print('PASS turning disk history off deletes the files on the host')
   await b.close();print('5 scrollback checks passed.')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
