#!/usr/bin/env python3
"""Latency tiers: ≥2 s recolours the top bar with a bold warning; ≥15 s covers the terminals until the
link settles or the user chooses to go on anyway. Latency is injected through the ?debug hook."""
import asyncio,os,re
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness
SHOTS=os.environ.get('jaunt_SHOTS','')
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   for width,name in [(1300,'desktop'),(390,'mobile')]:
    p=await (await b.new_context(viewport={'width':width,'height':844})).new_page()
    url=h.pair()['url'];base,_,frag=url.partition('#');await p.goto(base+('&' if '?' in base else '?')+'debug=1'+('#'+frag if frag else ''))
    await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
    await p.locator('#new-session-tab').click();await expect(p.locator('#tabs .session-tab').first).to_be_visible()
    sim=lambda ms:p.evaluate(f'window.jauntSimulateLatency({ms})')
    for ms in (800,86,120,90):   # repeated normal renders must never flip the warning on (toggle with a non-boolean did)
     await sim(ms);assert not await p.locator('#latency').evaluate("e=>e.classList.contains('high')") and await p.locator('#latency-overlay').is_hidden(),f'warning shown at {ms} ms'
    await sim(2500);await expect(p.locator('#latency')).to_have_class(re.compile("high"));await expect(p.locator('#latency')).to_be_visible();await expect(p.locator('#latency strong')).to_have_text('High latency, expect slowness');await expect(p.locator('#latency')).to_contain_text('2500 ms')
    assert await p.locator('#latency-overlay').is_hidden()
    if SHOTS:await p.screenshot(path=f'{SHOTS}/latency-high-{name}.png')
    await sim(1700);await expect(p.locator('#latency')).to_have_class(re.compile("high"))   # hysteresis: still high under 2 s
    await sim(1200);await expect(p.locator('#latency')).not_to_have_class(re.compile("high"))
    print(f'PASS {name}: ≥2 s shows the bold warning and the figure in the accent colour; hysteresis avoids flicker')
    await sim(20000);await expect(p.locator('#latency-overlay')).to_be_visible();await expect(p.locator('#latency-overlay')).to_contain_text('20 seconds');await expect(p.locator('#latency')).to_have_class(re.compile("high"))
    if SHOTS:await p.screenshot(path=f'{SHOTS}/latency-extreme-{name}.png')
    await sim(12000);await expect(p.locator('#latency-overlay')).to_be_visible()   # not settled yet
    await p.locator('#latency-override').click();await expect(p.locator('#latency-overlay')).to_be_hidden()
    await sim(18000);await expect(p.locator('#latency-overlay')).to_be_hidden()   # the choice holds while the spike lasts
    await sim(4000);await sim(19000);await expect(p.locator('#latency-overlay')).to_be_visible()   # recovered then spiked again: asked again
    await sim(900);await expect(p.locator('#latency-overlay')).to_be_hidden();await expect(p.locator('#latency')).not_to_have_class(re.compile("high"))
    print(f'PASS {name}: ≥15 s covers the terminals until the link settles; "Use anyway" holds for the current spike only')
   await b.close();print('4 latency checks passed.')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
