/** Touch scrolling for xterm's virtual viewport, including Android WebView. */
export function bindTouchScroll(node, term, context=()=>true) {
  let gesture=null, frame=0, remainder=0, epoch=0;
  const controller=new AbortController(), signal=controller.signal;
  const cancel=()=>{gesture=null;cancelAnimationFrame(frame);frame=0;remainder=0;epoch++;};
  const bufferChange=term.buffer.onBufferChange(cancel);
  const valid=g=>g && g.epoch===epoch && g.context!=null && g.context!==false &&
    node.isConnected && !document.hidden && context()===g.context && term.buffer.active===g.buffer;
  const lineHeight=()=>Math.max(1,node.querySelector('.xterm-screen')?.getBoundingClientRect().height/term.rows || 17);
  function move(pixels, point) {
    if(term.buffer.active.type==='alternate') {
      node.querySelector('.xterm-screen')?.dispatchEvent(new WheelEvent('wheel',{deltaY:pixels,deltaMode:0,clientX:point.clientX,clientY:point.clientY,bubbles:true,cancelable:true}));
      return;
    }
    remainder+=pixels/lineHeight();
    const lines=Math.trunc(remainder);remainder-=lines;
    if(lines)term.scrollLines(lines);
  }
  node.addEventListener('touchstart',event=>{
    cancel();
    if(event.touches.length!==1){gesture=null;return;}
    const p=event.touches[0];gesture={x:p.clientX,y:p.clientY,startY:p.clientY,time:performance.now(),velocity:0,dragging:false,buffer:term.buffer.active,context:context(),epoch};
  },{passive:true,capture:true,signal});
  node.addEventListener('touchmove',event=>{
    if(!valid(gesture) || event.touches.length!==1){cancel();return;}
    const p=event.touches[0], now=performance.now();
    if(!gesture.dragging){
      if(Math.abs(p.clientY-gesture.startY)<6)return;
      if(Math.abs(p.clientX-gesture.x)>Math.abs(p.clientY-gesture.startY)){gesture=null;return;}
      gesture.dragging=true;
    }
    event.preventDefault();event.stopImmediatePropagation();
    const delta=gesture.y-p.clientY, elapsed=Math.max(1,now-gesture.time);
    gesture.velocity=.6*gesture.velocity+.4*delta/elapsed;
    gesture.y=p.clientY;gesture.time=now;
    // Wheel handling can synchronously resize the terminal and cancel this gesture.
    move(delta,p);
  },{passive:false,capture:true,signal});
  node.addEventListener('touchend',event=>{
    const g=gesture;gesture=null;
    if(!valid(g) || !g.dragging)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(term.buffer.active.type!=='normal')return;
    let velocity=performance.now()-g.time<100?g.velocity:0, previous=performance.now();
    const coast=now=>{
      if(!valid(g) || g.buffer.type!=='normal'){cancel();return;}
      const elapsed=Math.min(32,now-previous);previous=now;
      move(velocity*elapsed,{clientX:g.x,clientY:g.y});velocity*=Math.exp(-elapsed/140);
      if(valid(g) && Math.abs(velocity)>.015)frame=requestAnimationFrame(coast);
    };
    frame=requestAnimationFrame(coast);
  },{passive:false,capture:true,signal});
  node.addEventListener('touchcancel',cancel,{passive:true,signal});
  return {cancel,dispose:()=>{cancel();bufferChange.dispose();controller.abort();}};
}
