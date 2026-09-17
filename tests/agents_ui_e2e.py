#!/usr/bin/env python3
"""Agents and machines in the browser client: link a machine from Settings, answer an approval from the
modal (deny, then allow once), see the requester table, change its level, revoke everything."""
import asyncio,json,re,subprocess,sys,threading
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,until
from agents_e2e import Mcp
def ctl(h,method,params=None):
    return json.loads(subprocess.check_output([sys.executable,'-c','import json,sys;sys.path.insert(0,sys.argv[1]);from jaunt.cli import control;print(json.dumps(control(sys.argv[2],json.loads(sys.argv[3]))))',str(ROOT/'host'),method,json.dumps(params or {})],env=h.env))
async def main():
 A=Harness(name='laptop');B=Harness(name='homelab');mcp=None
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   pa=await (await b.new_context(viewport={'width':1300,'height':900})).new_page();await pa.goto(A.pair()['url']);await expect(pa.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await pa.locator('#new-session-tab').click();await expect(pa.locator('#tabs .session-tab').first).to_be_visible()
   sid=ctl(A,'status')['sessions'][0]['id']
   pb=await (await b.new_context(viewport={'width':1300,'height':900})).new_page();await pb.goto(B.pair()['url']);await expect(pb.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   # Switch on from both settings pages, link A → B with B's pairing code pasted in A's settings.
   for p in (pa,pb):
    await p.locator('#settings-button').click();await p.get_by_label('Agents and machines').check();await expect(p.locator('.agents-list').first).to_be_visible(timeout=15000)
   await pa.locator('input[placeholder*="Pairing code"]').fill(B.pair()['code']);await pa.get_by_role('button',name='Link',exact=True).click()
   await expect(pa.locator('.agents-link').filter(has_text='homelab')).to_contain_text('link online',timeout=30000)
   print('PASS the switch and the link are operated from Settings; the linked machine shows as online',flush=True)
   mcp=Mcp(A,sid);box={}
   def run(cmd):
    def go():box['r']=mcp.tool('jaunt_run',{'host':'homelab','command':cmd})
    t=threading.Thread(target=go,daemon=True);t.start();return t
   await pb.locator('[data-view="terminal"]').first.click()
   t=run('echo first');await expect(pb.locator('#modal')).to_be_visible(timeout=20000)
   await expect(pb.locator('#modal')).to_contain_text('host: laptop · Claude Code');await expect(pb.locator('.approval-command')).to_have_text('echo first')
   await pb.get_by_role('button',name='Deny',exact=True).click();t.join(30);assert 'Refused' in box['r'],box['r']
   print('PASS the approval modal shows requester and command; Deny refuses the session',flush=True)
   t=run('echo second');await expect(pb.locator('#modal')).to_be_visible(timeout=20000);await pb.get_by_role('button',name='Allow once',exact=True).click();t.join(30)
   assert 'second' in box['r'],box['r']
   print('PASS Allow once lets the command run on the target',flush=True)
   await pb.locator('#settings-button').click();await pb.get_by_role('button',name='Refresh',exact=True).click()
   row=pb.locator('.agents-table tbody tr').filter(has_text='host: laptop · Claude Code');await expect(row).to_be_visible(timeout=15000)
   await expect(row.locator('td').nth(2)).to_contain_text('asks');await expect(row.locator('td').nth(3)).to_contain_text('asks')
   await row.locator('input[type=checkbox]').check();await pb.get_by_role('button',name='Modify selection…',exact=True).click()
   await pb.get_by_label('Level').select_option('always');await pb.get_by_role('button',name='Apply',exact=True).click()
   await expect(row.locator('td').nth(2)).to_contain_text('trusted always',timeout=15000);await expect(row.locator('td').nth(3)).to_contain_text('asks')
   t=run('echo third');t.join(30);assert 'third' in box['r'] and not ctl(B,'agents.status')['pending']
   print('PASS the requester table shows one column per right; modifying the selection to trust always makes commands run without a prompt',flush=True)
   # An agent shell shows in Settings and can be killed from there.
   opened=json.loads(mcp.tool('jaunt_shell',{'host':'homelab','action':'open'}))
   await pb.get_by_role('button',name='Refresh',exact=True).click();await expect(pb.locator('.agents-row').filter(has_text='host: laptop · Claude Code').filter(has_text='lease ends')).to_be_visible(timeout=15000)
   await pb.get_by_role('button',name='Kill',exact=True).click();await expect(pb.locator('.agents-row').filter(has_text='lease ends')).to_have_count(0,timeout=15000)
   assert not ctl(B,'agents.status')['agentShells']
   print('PASS an agent shell is listed in Settings and can be killed from there',flush=True)
   await pb.get_by_role('button',name='Revoke all',exact=True).click();await pb.locator('#modal').get_by_role('button',name='Revoke all',exact=True).click()
   await expect(pb.locator('.agents-table tbody')).to_contain_text('No session has asked anything here yet',timeout=15000)
   await expect(pb.locator('.agents-log')).to_contain_text('echo third')
   print('PASS revoke all empties the table; the journal keeps the history',flush=True)
   await b.close();print('6 agents UI checks passed.')
 finally:
  if mcp:mcp.close()
  A.close();B.close()
if __name__=='__main__':asyncio.run(main())
