#!/usr/bin/env python3
"""Agents and machines in the browser client: link a machine from Settings, answer an approval from the
modal (deny, then allow once), see the requester table, change its level, revoke everything."""
import asyncio,json,re,subprocess,sys,threading
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,ROOT,until
from agents_e2e import Mcp
def ctl(h,method,params=None):
    return json.loads(subprocess.check_output([sys.executable,'-c','import json,sys;sys.path.insert(0,sys.argv[1]);from jaunt.cli import control;print(json.dumps(control(sys.argv[2],json.loads(sys.argv[3]))))',str(ROOT/'host'),method,json.dumps(params or {})],env=h.env))
async def enable(p):
 # The capabilities this run needs: commands on linked machines (requester and target) and typing across machines.
 for label in ('Commands and background shells on linked machines','Typing into shells across machines'):
  await p.get_by_label(label).check();await expect(p.get_by_label(label)).to_be_enabled(timeout=30000)
async def main():
 A=Harness(name='laptop');B=Harness(name='homelab');mcp=None
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch()
   pa=await (await b.new_context(viewport={'width':1300,'height':900})).new_page();await pa.goto(A.pair()['url']);await expect(pa.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await pa.locator('#new-session-tab').click();await expect(pa.locator('#tabs .session-tab').first).to_be_visible()
   sid=ctl(A,'status')['sessions'][0]['id']
   pb=await (await b.new_context(viewport={'width':1300,'height':900})).new_page();await pb.goto(B.pair()['url']);await expect(pb.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   # Page A pairs the second host too (the device now holds both pairings) and names the first one; with the
   # feature on, the hosts get linked by themselves, with no code to copy, under the names used on this device.
   await pa.locator('#settings-button').click();row=pa.locator('.machine-row').filter(has_text='laptop');await row.get_by_label('Friendly host name').fill('my-laptop');await row.get_by_label('Friendly host name').press('Enter')
   await pa.locator('#add-machine').click();await pa.locator('#modal textarea').fill(B.pair()['code']);await pa.locator('#modal').get_by_role('button',name='Pair machine',exact=True).click()
   await expect(pa.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await pa.locator('#host-settings').click();await enable(pa);await expect(pa.locator('.agents-list').first).to_be_visible(timeout=15000)
   await expect(pa.locator('.agents-link').filter(has_text='laptop')).to_contain_text('link online',timeout=30000)
   await expect(pa.locator('.agents-link').filter(has_text='laptop')).not_to_contain_text('Remove')
   # The list belongs to its own header: both sit in one .settings-section, so the separator no
   # longer falls between them and the list cannot read as part of the next section.
   section=pa.locator('.settings-section').filter(has_text='Reachable machines')
   await expect(section.locator('.agents-list')).to_be_visible()
   # The code field is the exception, not the default path: it is reachable, never shown outright.
   await expect(pa.get_by_role('button',name='Pair a new machine',exact=True)).to_be_visible()
   assert not await pa.locator('input[placeholder*="Pairing code"]').is_visible(),'the code field stays behind the pairing modal'
   await pa.get_by_role('button',name='Pair a new machine',exact=True).click()
   await expect(pa.locator('#modal input[placeholder*="Pairing code"]')).to_be_visible()
   await pa.locator('#modal-close').click();await expect(pa.locator('#modal')).not_to_be_visible()
   # The chevron folds the list away and brings it back; nothing else in the section moves.
   await section.get_by_role('button',name='Collapse Reachable machines',exact=True).click()
   await expect(section.locator('.agents-list')).to_have_count(0)
   await section.get_by_role('button',name='Expand Reachable machines',exact=True).click()
   await expect(section.locator('.agents-list')).to_be_visible()
   # B is the machine selected now on page A; go back to A (the first machine) and switch the feature on there.
   await pa.locator('#host-switch').click();await pa.locator('.host-menu').get_by_text('my-laptop').click()
   await pa.locator('#host-settings').click();await enable(pa);await expect(pa.locator('.agents-list').first).to_be_visible(timeout=15000)
   await expect(pa.locator('.agents-link').filter(has_text='homelab')).to_contain_text('link online',timeout=30000)
   assert [l['label'] for l in ctl(B,'agents.status')['links']]==['my-laptop'] and ctl(A,'agents.status')['links'][0]['label']=='homelab'
   print('PASS pairing a second host on the device links the hosts both ways by itself, with no code to copy',flush=True)
   await pb.locator('#host-settings').click();await enable(pb);await expect(pb.locator('.agents-list').first).to_be_visible(timeout=15000)
   mcp=Mcp(A,sid);box={}
   def run(cmd):
    def go():box['r']=mcp.tool('jaunt_run',{'host':'homelab','command':cmd})
    t=threading.Thread(target=go,daemon=True);t.start();return t
   await pb.locator('[data-view="terminal"]').first.click()
   t=run('echo first');await expect(pb.locator('#modal')).to_be_visible(timeout=20000)
   await expect(pb.locator('#modal')).to_contain_text('host: my-laptop · Claude Code');await expect(pb.locator('.approval-command')).to_have_text('echo first')
   await pb.get_by_role('button',name='Deny',exact=True).click();t.join(30);assert 'Refused' in box['r'],box['r']
   print('PASS the approval modal shows requester and command; Deny refuses the session',flush=True)
   t=run('echo second');await expect(pb.locator('#modal')).to_be_visible(timeout=20000);await pb.get_by_role('button',name='Allow once',exact=True).click();t.join(30)
   assert 'second' in box['r'],box['r']
   print('PASS Allow once lets the command run on the target',flush=True)
   # Phase 4: "Always allow this command" from the modal, then the rule is listed and removed from the table.
   t=run('echo rule-me');await expect(pb.locator('#modal')).to_be_visible(timeout=20000);await pb.get_by_role('button',name='Always allow this command',exact=True).click();t.join(30);assert 'rule-me' in box['r'],box['r']
   t=run('echo rule-me');t.join(30);assert 'rule-me' in box['r'] and not ctl(B,'agents.status')['pending'],box['r']
   print('PASS "always allow this command" makes the same command run again without a prompt',flush=True)
   await pb.locator('#host-settings').click();await pb.get_by_role('button',name='Refresh',exact=True).click()
   await pb.locator('.agents-table').get_by_role('button',name='1 rule(s)',exact=True).click();await expect(pb.locator('#modal .rules-list')).to_contain_text('echo rule-me')
   await pb.locator('#modal .rules-list').get_by_role('button',name='Remove',exact=True).click();await expect(pb.locator('#modal .rules-list')).to_contain_text('No rule yet',timeout=15000)
   await pb.locator('#modal input[aria-label="Rule"]').fill('echo pat-*');await pb.locator('#modal').get_by_role('button',name='Add',exact=True).click();await expect(pb.locator('#modal .rules-list')).to_contain_text('echo pat-*',timeout=15000)
   t=run('echo pat-ok');t.join(30);assert 'pat-ok' in box['r'] and not ctl(B,'agents.status')['pending'],box['r']
   await pb.locator('#modal-close').click();await expect(pb.locator('#modal')).to_be_hidden(timeout=15000)
   print('PASS rules are listed, removed and added from the requester table, and a * pattern pre-approves matching commands',flush=True)
   await pb.locator('#host-settings').click();await pb.get_by_role('button',name='Refresh',exact=True).click()
   row=pb.locator('.agents-table tbody tr').filter(has_text='host: my-laptop · Claude Code');await expect(row).to_be_visible(timeout=15000)
   await expect(row.locator('td').nth(2)).to_contain_text('asks');await expect(row.locator('td').nth(3)).to_contain_text('asks')
   await row.locator('input[type=checkbox]').check();await pb.get_by_role('button',name='Modify selection…',exact=True).click()
   await expect(pb.locator('#modal')).to_be_visible(timeout=15000);await pb.get_by_label('Level').select_option('always');await pb.get_by_role('button',name='Apply',exact=True).click()
   await expect(row.locator('td').nth(2)).to_contain_text('trusted always',timeout=15000);await expect(row.locator('td').nth(3)).to_contain_text('asks')
   t=run('echo third');t.join(30);assert 'third' in box['r'] and not ctl(B,'agents.status')['pending']
   print('PASS the requester table shows one column per right; modifying the selection to trust always makes commands run without a prompt',flush=True)

   # An agent shell shows in Settings and can be killed from there.
   opened=json.loads(mcp.tool('jaunt_shell',{'host':'homelab','action':'open'}))
   await pb.get_by_role('button',name='Refresh',exact=True).click();await expect(pb.locator('.agents-row').filter(has_text='host: my-laptop · Claude Code').filter(has_text='lease ends')).to_be_visible(timeout=15000)
   await pb.get_by_role('button',name='Kill',exact=True).click();await expect(pb.locator('.agents-row').filter(has_text='lease ends')).to_have_count(0,timeout=15000)
   assert not ctl(B,'agents.status')['agentShells']
   print('PASS an agent shell is listed in Settings and can be killed from there',flush=True)
   # Phase 3: an agent types into one of B's own shells; the tab shows it; the owner cuts it off from the tab.
   await pb.locator('[data-view="terminal"]').first.click();await pb.locator('#new-session-tab').click();await expect(pb.locator('#tabs .session-tab').first).to_be_visible()
   sidB=ctl(B,'status')['sessions'][0]['id']
   def type_(text):
    def go():box['r']=mcp.tool('jaunt_type',{'host':'homelab','session':sidB,'input':text})
    t=threading.Thread(target=go,daemon=True);t.start();return t
   t=type_('echo from-agent');await expect(pb.locator('#modal')).to_be_visible(timeout=20000)
   await expect(pb.locator('#modal')).to_contain_text('asks to type this into the shell');await expect(pb.locator('.approval-command')).to_have_text('echo from-agent')
   await pb.get_by_role('button',name='Allow for this shell',exact=True).click();t.join(30);assert 'Typed' in box['r'],box['r']
   await expect(pb.locator('#tabs .tab-agent')).to_be_visible(timeout=15000)
   await expect(pb.locator('.xterm-rows')).to_contain_text('from-agent',timeout=15000)
   print('PASS the typing request names the shell and shows the text; once allowed, the tab carries the agent badge and the input lands in the terminal',flush=True)
   await pb.locator('#tabs .tab-agent').click();await pb.locator('#modal').get_by_role('button',name='Cut off',exact=True).click()
   await expect(pb.locator('#tabs .tab-agent')).to_have_count(0,timeout=15000);await expect(pb.locator('#modal')).to_be_hidden(timeout=15000)
   t=type_('echo again');await expect(pb.locator('#modal')).to_be_visible(timeout=20000);await pb.get_by_role('button',name='Deny',exact=True).click();t.join(30);assert 'Refused' in box['r']
   print('PASS cutting from the tab removes the badge; the agent must ask again',flush=True)
   await pb.locator('#host-settings').click()
   await pb.get_by_role('button',name='Revoke all',exact=True).click();await pb.locator('#modal').get_by_role('button',name='Revoke all',exact=True).click()
   await expect(pb.locator('.agents-table tbody')).to_contain_text('No session has asked anything here yet',timeout=15000)
   await expect(pb.locator('.agents-log')).to_contain_text('echo third')
   print('PASS revoke all empties the table; the journal keeps the history',flush=True)
   await b.close();print('10 agents UI checks passed.')
 finally:
  if mcp:mcp.close()
  A.close();B.close()
if __name__=='__main__':asyncio.run(main())
