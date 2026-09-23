#!/usr/bin/env python3
"""The bridged sessions list in Settings: it sits inside its own section and its chevron folds it.

The bridge switch is the real one (real host, real bridge.configure). Only the two runtimes are
stand-ins: scripts named claude and codex that report a supported version and accept the
`mcp add/remove` calls, so the integrations land in the harness's temporary HOME."""
import asyncio,os,tempfile
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness
STUB='#!/bin/sh\ncase "$1" in --version) echo "{0}";; esac\nexit 0\n'
async def main():
 bin=tempfile.TemporaryDirectory(prefix='jaunt-bridge-ui-')
 for name,version in (('claude','2.1.300 (Claude Code)'),('codex','codex-cli 0.160.0')):
  f=Path(bin.name)/name;f.write_text(STUB.replace('{0}',version));f.chmod(0o755)
 h=Harness(extra_env={'PATH':bin.name+os.pathsep+os.environ.get('PATH','')})
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   p=await (await b.new_context(locale='en-US',viewport={'width':1300,'height':900})).new_page();await p.goto(h.pair()['url'])
   await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await p.locator('#host-settings').click()
   switch=p.get_by_label('Claude Code ↔ Codex bridge',exact=True)
   await expect(switch).to_be_enabled(timeout=30000);await switch.check()
   section=p.locator('.settings-section').filter(has_text='Bridged sessions')
   # The list belongs to its header: both sit in one .settings-section, not in the section below.
   await expect(section.locator('.bridge-list')).to_be_visible(timeout=60000)
   await expect(section.locator('.bridge-row')).to_contain_text('No Claude Code or Codex session is running')
   await expect(p.locator('.bridge-list')).to_have_count(1)
   print('PASS the bridged sessions list sits inside its own section',flush=True)
   # The chevron folds the list away and brings it back; the header stays.
   await section.get_by_role('button',name='Collapse Bridged sessions',exact=True).click()
   await expect(section.locator('.bridge-list')).to_have_count(0)
   await expect(section.get_by_role('button',name='Expand Bridged sessions',exact=True)).to_have_attribute('aria-expanded','false')
   # Folded survives the re-renders Settings goes through (the bridge status refresh re-renders it).
   await p.locator('[data-view="terminal"]').first.click();await p.locator('#host-settings').click()
   await expect(section.get_by_role('button',name='Expand Bridged sessions',exact=True)).to_be_visible(timeout=15000)
   await expect(section.locator('.bridge-list')).to_have_count(0)
   await section.get_by_role('button',name='Expand Bridged sessions',exact=True).click()
   await expect(section.locator('.bridge-list')).to_be_visible()
   await expect(section.get_by_role('button',name='Collapse Bridged sessions',exact=True)).to_have_attribute('aria-expanded','true')
   print('PASS the chevron folds and unfolds the bridged sessions list, and the fold survives reopening Settings',flush=True)
   await b.close();print('2 bridge UI checks passed.')
 finally:
  h.close();bin.cleanup()
if __name__=='__main__':asyncio.run(main())
