/** Touch scrolling for xterm's virtual viewport, including Android WebView. */
export function bindTouchScroll(node, term) {
  let gesture=null, frame=0, remainder=0;
  const lineHeight=()=>Math.max(1,node.querySelector('.xterm-screen')?.getBoundingClientRect().height/term.rows || 17);
  function move(pixels) {
    if(term.buffer.active.type==='alternate') {
      node.querySelector('.xterm-screen')?.dispatchEvent(new WheelEvent('wheel',{deltaY:pixels,deltaMode:0,bubbles:true,cancelable:true}));
      return;
    }
    remainder+=pixels/lineHeight();
    const lines=Math.trunc(remainder);remainder-=lines;
    if(lines)term.scrollLines(lines);
  }
  node.addEventListener('touchstart',event=>{
    cancelAnimationFrame(frame);remainder=0;
    if(event.touches.length!==1){gesture=null;return;}
    const p=event.touches[0];gesture={x:p.clientX,y:p.clientY,startY:p.clientY,time:performance.now(),velocity:0,dragging:false};
  },{passive:true,capture:true});
  node.addEventListener('touchmove',event=>{
    if(!gesture || event.touches.length!==1)return;
    const p=event.touches[0], now=performance.now();
    if(!gesture.dragging){
      if(Math.abs(p.clientY-gesture.startY)<6)return;
      if(Math.abs(p.clientX-gesture.x)>Math.abs(p.clientY-gesture.startY)){gesture=null;return;}
      gesture.dragging=true;
    }
    event.preventDefault();event.stopImmediatePropagation();
    const delta=gesture.y-p.clientY, elapsed=Math.max(1,now-gesture.time);
    gesture.velocity=.6*gesture.velocity+.4*delta/elapsed;
    move(delta);gesture.y=p.clientY;gesture.time=now;
  },{passive:false,capture:true});
  node.addEventListener('touchend',event=>{
    const g=gesture;gesture=null;
    if(!g?.dragging)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(term.buffer.active.type!=='normal')return;
    let velocity=performance.now()-g.time<100?g.velocity:0, previous=performance.now();
    const coast=now=>{
      const elapsed=Math.min(32,now-previous);previous=now;
      move(velocity*elapsed);velocity*=Math.exp(-elapsed/140);
      if(Math.abs(velocity)>.015)frame=requestAnimationFrame(coast);
    };
    frame=requestAnimationFrame(coast);
  },{passive:false,capture:true});
  node.addEventListener('touchcancel',()=>{gesture=null;cancelAnimationFrame(frame);},{passive:true});
}
