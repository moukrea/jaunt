#!/usr/bin/env python3
"""Real exec replacement retains shell PID, cwd, output, input and termination."""
import asyncio,json,sys
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,terminal_command,until
async def main():
 h=Harness()
 try:
  async with async_playwright() as pw:
   b=await pw.chromium.launch();p=await b.new_page();await p.goto(h.pair()['url'])
   await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   await p.locator('#new-session-folder').click();await p.get_by_label('Working directory').fill(str(h.work))
   await p.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
   await terminal_command(p,"export HANDOFF_VALUE=retained; printf before > proof.txt")
   await until(lambda:(h.work/'proof.txt').exists());before=json.loads(h.cli('status'));sid=before['sessions'][0]['id'];pid=before['sessions'][0]['pid']
   # The private socket command is intentionally local-only and never exposed
   # as an arbitrary executable-path RPC to remote clients.
   import subprocess
   subprocess.run([sys.executable,'-c',"from jaunt.cli import control;import sys;control('upgrade.exec',{'python':sys.executable})"],env=h.env,check=True)
   def replaced():
    try:return json.loads(h.cli('status'))['runtimeId']!=before['runtimeId']
    except (subprocess.SubprocessError,ValueError):return False
   await until(replaced,timeout=30)
   await expect(p.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
   after=json.loads(h.cli('status'));assert after['pid']==before['pid'] and (after['sessions'][0]['id'],after['sessions'][0]['pid'])==(sid,pid)
   await terminal_command(p,"printf '%s' \"$HANDOFF_VALUE\" >> proof.txt")
   await until(lambda:(h.work/'proof.txt').read_text()=='beforeretained')
   await p.locator('#list-sessions').click();await p.locator('#modal').get_by_role('button',name='Terminate',exact=True).click();await p.get_by_role('button',name='Terminate session',exact=True).click()
   await until(lambda:not json.loads(h.cli('status'))['sessions'])
   await b.close();print('PASS real in-place runtime exec: same daemon and PTY PID, environment/cwd preserved, browser reattaches and executes, inherited shell can be terminated')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
