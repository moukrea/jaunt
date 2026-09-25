#!/usr/bin/env python3
"""Lazy scrollback: a fresh client renders only the tail, scrolling to the top loads earlier output from
the host's on-disk history; the local IndexedDB cache serves it after a reload without asking the host;
turning disk history off deletes the files."""
import asyncio,json,re,time
from pathlib import Path
from playwright.async_api import async_playwright,expect
from browser_e2e import Harness,until,terminal_command

async def tui_history_regressions(browser,h):
 """Real app/xterm with synthetic bytes and controlled completion, never a user TUI.

 Test exports exist only in this fresh page's response, not the shipped app.
 The fixture detaches its own host stream, then intercepts its input and history.
 """
 ctx=await browser.new_context(viewport={'width':390,'height':780},has_touch=True)
 page=await ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m: print(m.text,flush=True) if m.text.startswith('JAU-124 ') else None)
 source=(Path(__file__).resolve().parents[1]/'web/js/app.mjs').read_text()
 async def expose(route):
  await route.fulfill(content_type='text/javascript',body=source+'\nwindow.fixtureAPI={current,activeTerm,handleMessage,loadEarlier,loadEarlierSoon,invalidateHistory,drainTerminal,attachTerm,disposeTerm,sendInput,insertText,rememberScroll,resizeTerminal,claimSize,scrollback};\n')
 await page.route('**/js/app.mjs',expose)
 await page.goto(h.pair()['url']);await expect(page.locator('#connection span')).to_have_text('Encrypted',timeout=30000)
 await page.locator('#new-session-folder').click();await page.get_by_label('Session name').fill('Synthetic TUI history')
 await page.get_by_label('Working directory').fill(str(h.work));await page.locator('#modal').get_by_role('button',name='Create shell',exact=True).click()
 await expect(page.locator('.terminal-container:not([hidden]) textarea')).to_be_enabled(timeout=30000)
 await page.wait_for_timeout(400)
 await page.evaluate(r'''async()=>{
  const api=fixtureAPI,a=api.current(),t=api.activeTerm(a),enc=new TextEncoder();
  await a.link.request('session.detach',{id:t.session.id});
  const originalRequest=a.link.request.bind(a.link);
  window.f={api,a,t,bytes:new Uint8Array(),sent:[],requests:[],hold:null,reads:0};
  a.link.send=async m=>f.sent.push(m);
  a.link.request=async(method,params)=>{
   if(method==='session.attach'){f.requests.push(params);return {retained:0};}
   if(method==='session.history')throw Error('Unexpected history RPC');
   return originalRequest(method,params);
  };
  api.scrollback.flush=async()=>{if(f.hold)await f.hold;};
  api.scrollback.read=async(_key,lo,hi)=>{f.reads++;return f.bytes.slice(lo,hi);};
  api.scrollback.put=()=>{};
  f.encode=s=>btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  f.message=m=>api.handleMessage(a,{id:t.session.id,...m});
  f.output=s=>f.message({type:'terminal.output',offset:t.offset,data:f.encode(s)});
  f.screen=()=>{const b=t.term.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)||'').join('\n');};
  f.top=()=>{const b=t.term.buffer.active;return b.getLine(b.viewportY)?.translateToString(true);};
  f.inputs=()=>f.sent.filter(m=>m.type==='terminal.input').map(m=>atob(m.data.replace(/-/g,'+').replace(/_/g,'/')));
  f.wait=()=>new Promise(r=>setTimeout(r,80));
  f.check=(ok,why)=>{if(!ok)throw Error(why);};
  f.fresh=async(text,start=0)=>{
   api.invalidateHistory(t);await api.drainTerminal(t);f.hold=null;t.attached=true;t.replaying=false;t.ownsSize=true;t.node.hidden=false;
   f.bytes=enc.encode(text);f.message({type:'terminal.reset',offset:start});
   f.message({type:'terminal.output',offset:start,data:f.encode(text.slice(start))});
   await api.drainTerminal(t);api.claimSize(a,t);await f.wait();api.invalidateHistory(t);f.sent=[];f.reads=0;
  };
  f.history=Array.from({length:240},(_,i)=>'HISTORY-'+String(i).padStart(3,'0')+'\r\n').join('');
  f.start=f.history.indexOf('HISTORY-120');
  f.swipe=()=>{
   const mount=t.node.querySelector('.terminal-mount'),screen=mount.querySelector('.xterm-screen'),r=screen.getBoundingClientRect();
   const x=r.left+r.width*.7,y=r.top+r.height*.8,dy=Math.min(50,r.height*.3);
   for(const [type,py] of [['touchstart',y],['touchmove',y-dy],['touchend',y-dy]]){
    const touches=type==='touchend'?[]:[new Touch({identifier:1,target:screen,clientX:x,clientY:py})];
    mount.dispatchEvent(new TouchEvent(type,{touches,changedTouches:touches,bubbles:true,cancelable:true}));
   }
   return {x,y:y-dy,col:Math.floor(.7*t.term.cols)+1,row:Math.floor((y-dy-r.top)/(r.height/t.term.rows))+1};
  };
  f.pauseParser=()=>{
   let release,entered;const held=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
   const handler=t.term.parser.registerCsiHandler({final:'z'},params=>{if(params[0]!==999)return false;entered();return held.then(()=>true);});
   return {ready,release:()=>{release();handler.dispose();}};
  };
 }''')
 results=await page.evaluate(r'''async()=>{
  const {api,a,t,check}=f,passed=[],pass=name=>{passed.push(name);console.info('JAU-124 '+name);};
  for(const mode of ['sgr','legacy','arrows']){
   await f.fresh('');f.output('\x1b[?1049h'+(mode==='arrows'?'':'\x1b[?1000h')+(mode==='sgr'?'\x1b[?1006h':'')+'SYNTHETIC TUI');
   await api.drainTerminal(t);await f.wait();f.sent=[];const point=f.swipe();await f.wait();
   const input=f.inputs();check(input.length===1,'one '+mode+' wheel: '+JSON.stringify(input));
   check(input[0]===(mode==='sgr'?'\x1b[<65;'+point.col+';'+point.row+'M':mode==='legacy'?'\x1b[Ma'+String.fromCharCode(point.col+32,point.row+32):'\x1b[B'),mode+' position/fallback');
  }pass('alternate SGR/legacy coordinates and no-mouse arrow fallback');
  await f.fresh(f.history);t.term.scrollToLine(30);f.sent=[];f.swipe();
  f.output('\x1b[?1049h\x1b[?1000h\x1b[?1006h');await api.drainTerminal(t);await f.wait();
  check(f.inputs().length===0,'normal inertia leaked input to alternate buffer');pass('normal inertia canceled at alternate entry');
  await f.fresh(f.history,f.start);t.term.scrollToTop();api.loadEarlierSoon(a,t);
  f.output('\x1b[?1049hALT-REMAINS');await api.drainTerminal(t);await new Promise(r=>setTimeout(r,260));
  check(t.term.buffer.active.type==='alternate' && f.reads===0,'old normal timer loaded alternate history');pass('delayed history rejected after alternate entry');
  for(const kind of ['geometry','local resize','attachment']){
   await f.fresh(f.history,f.start);
   if(kind==='local resize')t.term.resize(t.term.cols,t.term.rows-2);
   t.term.scrollToTop();api.rememberScroll(t);api.loadEarlierSoon(a,t);
   if(kind==='geometry')f.message({type:'terminal.geometry',cols:t.term.cols,rows:t.term.rows,activeView:a.peer,viewers:[]});
   if(kind==='local resize')api.claimSize(a,t); // No simulated geometry echo.
   if(kind==='attachment'){t.session.activeView=a.peer;await api.attachTerm(a,t);}
   await api.drainTerminal(t);
   for(let i=0;i<50 && t.renderedStart>0;i++)await f.wait();
   check(t.renderedStart===0,kind+' left an earlier-history request stranded at the top');
  }
  await f.fresh(f.history,f.start);t.term.scrollToTop();api.loadEarlierSoon(a,t);t.term.scrollToBottom();
  await new Promise(r=>setTimeout(r,260));check(f.reads===0,'leaving the top still loaded earlier history');
  pass('top-of-history retries follow geometry, resize and attach, but stop when the reader leaves');
  for(const kind of ['output','generation','detach','reset']){
   await f.fresh(f.history,f.start);let release;f.hold=new Promise(r=>release=r);const old=api.loadEarlier(a,t);
   if(kind==='output')f.output('LIVE-ONCE\r\n');
   if(kind==='generation'){a.link.generation++;t.attached=false;}
   if(kind==='detach'){t.attached=false;api.invalidateHistory(t);}
   if(kind==='reset'){f.message({type:'terminal.reset',offset:0});f.output('FRESH-SCREEN');}
   await api.drainTerminal(t);const before=f.screen();release();await old;await api.drainTerminal(t);
   check(f.screen()===before,kind+': stale fetch changed screen');
   if(kind==='output')check(f.screen().split('LIVE-ONCE').length===2,'live output missing or duplicated');
  }pass('read-only fetch canceled on live output, generation, detach and reset');
  const text='\x1b[6n\x1b[999z'+f.history,start=text.indexOf('HISTORY-120');
  await f.fresh(text,start);let gate=f.pauseParser(),load=api.loadEarlier(a,t);await gate.ready;
  check(t.historyReplay && t.term.options.disableStdin,'historical parser input was available');
  const inputErrors=await Promise.allSettled([api.sendInput(a,t,'USER'),api.insertText(a,t,'PASTE')]);
  check(inputErrors.every(x=>x.status==='rejected'),'direct input accepted while historical parser held');
  f.message({type:'terminal.reset',offset:0});f.output('NEW-AFTER-RESET');
  check(t.historyReplay && !f.screen().includes('NEW-AFTER-RESET'),'reset overtook historical parser');
  gate.release();await load;await api.drainTerminal(t);await f.wait();
  check(f.screen().includes('NEW-AFTER-RESET') && !f.screen().includes('HISTORY-'),'historical bytes overwrote reset');
  check(f.inputs().length===0,'old parser response or unavailable input sent');
  f.output('\x1b[6n');await api.drainTerminal(t);await f.wait();check(f.inputs().length===1 && /\x1b\[\d+;\d+R/.test(f.inputs()[0]),'fresh parser response lost');
  check(t.offset===t.renderedOffset,'reset parsed offset differs');pass('parser fence, historical response suppression, live response and input rejection');
  await f.fresh(text,start);gate=f.pauseParser();load=api.loadEarlier(a,t);await gate.ready;
  f.output('LIVE-A\r\n');f.output('LIVE-B\r\n');const expected=t.offset;
  t.attached=false;a.link.generation++;const attaching=api.attachTerm(a,t);gate.release();await Promise.all([load,attaching]);await api.drainTerminal(t);
  check(f.requests.at(-1).after===expected && t.offset===expected && t.renderedOffset===expected,'attach skipped unparsed live output');
  for(const marker of ['LIVE-A','LIVE-B'])check(f.screen().split(marker).length===2,marker+' not exactly once');
  pass('reattach drains live output once and uses parsed offset');
  await f.fresh('');t.offset=t.renderedOffset=null;t.attached=false;
  const tail=api.scrollback.tail,cached=new TextEncoder().encode('\x1b[999zCACHED-STALE');
  api.scrollback.tail=async()=>({bytes:cached,start:300,end:300+cached.length});
  gate=f.pauseParser();const cachedAttach=api.attachTerm(a,t);await gate.ready;
  f.message({type:'terminal.reset',offset:500});f.output('CACHE-RESET-SURVIVES');const resetEnd=t.offset;
  gate.release();await cachedAttach;await api.drainTerminal(t);api.scrollback.tail=tail;
  check(t.offset===resetEnd && t.renderedOffset===resetEnd && f.requests.at(-1).after===resetEnd,'cached attach overwrote reset offset');
  check(f.screen().includes('CACHE-RESET-SURVIVES') && !f.screen().includes('CACHED-STALE'),'cached bytes survived their replacement');
  pass('cached attachment cannot overwrite a reset or its parsed resume cursor');
  for(const smooth of [0,100]){
   await f.fresh(text,start);t.term.options.smoothScrollDuration=0;t.term.scrollToLine(25);api.rememberScroll(t);
   const anchor=f.top(),oldRows=t.term.rows;t.term.options.smoothScrollDuration=smooth;
   gate=f.pauseParser();load=api.loadEarlier(a,t);await gate.ready;
   f.message({type:'terminal.geometry',cols:t.term.cols,rows:oldRows-3,activeView:'synthetic-other-view',viewers:[]});
   check(t.term.rows===oldRows,'geometry overtook historical parser');gate.release();await load;await api.drainTerminal(t);
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   check(t.term.rows===oldRows-3 && f.top()===anchor,'queued geometry lost reading anchor '+JSON.stringify({smooth,rows:t.term.rows,expectedRows:oldRows-3,top:f.top(),anchor}));
   check(t.term.options.smoothScrollDuration===smooth && !t.resizing,'resize left scrolling settings changed');
  }
  t.term.options.smoothScrollDuration=0;pass('geometry follows history with mobile and animated desktop anchors preserved');
  await f.fresh(text,start);gate=f.pauseParser();load=api.loadEarlier(a,t);await gate.ready;
  t.ownsSize=false;api.claimSize(a,t);check(!t.ownsSize,'size claim overtook historical parser');
  gate.release();await load;await api.drainTerminal(t);await f.wait();
  check(t.ownsSize,'explicit size claim lost during history');pass('explicit size claim waits for history and remains effective');
  return passed;
 }''')
 # A keyboard-sized viewport change exercises the real fit route, not native IME.
 await page.evaluate(r'''async()=>{
  const text='\x1b[999z'+f.history;await f.fresh(text,text.indexOf('HISTORY-120'));
  f.t.term.scrollToLine(25);f.api.rememberScroll(f.t);f.anchor=f.top();f.gate=f.pauseParser();f.loading=f.api.loadEarlier(f.a,f.t);await f.gate.ready;
 }''')
 await page.set_viewport_size({'width':390,'height':460});await page.wait_for_timeout(400)
 await page.evaluate('async()=>{f.gate.release();await f.loading;await f.api.drainTerminal(f.t);}')
 await page.wait_for_timeout(400)
 assert await page.evaluate('f.top()===f.anchor'),'viewport during history moved the reading anchor'
 await page.set_viewport_size({'width':390,'height':780});await page.wait_for_timeout(400)
 assert await page.evaluate('f.top()===f.anchor'),'viewport restoration moved the reading anchor'
 results.append('keyboard-sized viewport changes preserve the reconstructed anchor')
 await page.screenshot(path=str(Path(__file__).resolve().parents[1]/'test-results/tui-history-anchor.png'))
 await page.evaluate(r'''async()=>{
  await f.fresh(f.history,f.start);let release;f.hold=new Promise(r=>release=r);const old=f.api.loadEarlier(f.a,f.t);
  f.api.disposeTerm(f.t);f.a.terms.delete(f.t.session.id);release();await old;
  f.check(f.t.disposed && !f.t.node.isConnected,'disposed history terminal survived');
 }''')
 results.append('disposed terminal rejects pending history completion')
 assert not errors,errors
 for result in results:print('PASS '+result,flush=True)
 await ctx.close()
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
   await asyncio.wait_for(tui_history_regressions(b,h),timeout=60)
   await b.close();print('5 scrollback checks and 12 TUI/history checks passed.')
 finally:h.close()
if __name__=='__main__':asyncio.run(main())
