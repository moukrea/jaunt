"""In-place runtime replacement: keep child ownership and open PTY masters.

The snapshot lives in an unlinked private file descriptor, never a published or
persistent terminal log. exec preserves the daemon PID and its shell children.
"""
from __future__ import annotations
import asyncio,json,os,stat,tempfile,time
from collections import deque
from .crypto import b64,unb64
from .sessions import Session

class InheritedChild:
    def __init__(self,pid):self.pid=pid;self.returncode=None
    def poll(self):
        if self.returncode is None:
            try:pid,status=os.waitpid(self.pid,os.WNOHANG)
            except ChildProcessError:return self.returncode
            if pid:self.returncode=os.waitstatus_to_exitcode(status)
        return self.returncode
    def wait(self,timeout=None):
        deadline=time.monotonic()+(timeout or 3600)
        while self.returncode is None:
            pid,status=os.waitpid(self.pid,os.WNOHANG)
            if pid:self.returncode=os.waitstatus_to_exitcode(status);break
            if time.monotonic()>=deadline:raise TimeoutError('Shell did not exit')
            time.sleep(.02)
        return self.returncode

async def snapshot(sessions,lockfd,extra=None):
    rows=[];reapers=[]
    for s in sessions.items.values():
        sessions._pause_reader(s);s.resizing=True
        if s.reaper and not s.reaper.done():
            s.reaper.cancel()
            reapers.append(s.reaper)
    # Stop watcher reads too; unread trailing output stays in the inherited PTY.
    await asyncio.gather(*reapers,return_exceptions=True)
    for s in sessions.items.values():
        await asyncio.wait_for(s.queue.join(),15)
    # Capture descriptors only after every asynchronous drain has completed.
    for s in sessions.items.values():
        row=s.info();row.update(fd=s.fd,offset=s.offset,
            ring=[[n,b64(data),cols,height] for n,data,cols,height in s.ring],
            parser={'state':s.attention.state,'payload':b64(s.attention.payload),'overflow':s.attention.overflow})
        rows.append(row)
    out=tempfile.TemporaryFile(mode='w+b',dir=sessions.root)
    out.write(json.dumps({'schema':1,'pid':os.getpid(),'lockfd':lockfd,'sessions':rows,**(extra or {})}).encode());out.flush()
    if out.tell()>100*1024*1024:
        out.close();raise ValueError('Runtime snapshot exceeds its size limit')
    out.seek(0)
    for s in sessions.items.values():
        if s.fd>=0:os.set_inheritable(s.fd,True)
    os.set_inheritable(lockfd,True);os.set_inheritable(out.fileno(),True)
    return out

def restore(sessions,fd):
    with os.fdopen(fd,'rb') as stream:
        if os.fstat(fd).st_uid!=os.getuid():raise ValueError('Invalid runtime handoff owner')
        data=json.loads(stream.read(100*1024*1024))
    if data.get('schema')!=1 or data.get('pid')!=os.getpid() or len(data['sessions'])>32:
        raise ValueError('Invalid runtime handoff')
    lockfd=data['lockfd'];os.set_inheritable(lockfd,False)
    for row in data['sessions']:
        fd=row['fd']
        if fd>=0:
            if not stat.S_ISCHR(os.fstat(fd).st_mode) or not os.isatty(fd):raise ValueError('Invalid inherited terminal')
            os.set_inheritable(fd,False)
        s=Session(row['id'],row['name'],row['cwd'],row['pid'],fd,row['cols'],row['rows'],tmux=row['tmux'],process=InheritedChild(row['pid']))
        s.program=row.get('program','') if row.get('program') in ('claude','codex') else ''
        s.created=row['created'];s.alive=row['alive'];s.exit_code=row['exitCode'];s.offset=row['offset']
        s.ring=deque((n,unb64(payload),cols,height) for n,payload,cols,height in row['ring']);s.ring_bytes=sum(len(r[1]) for r in s.ring)
        parser=row['parser'];s.attention.state=parser['state'];s.attention.payload=bytearray(unb64(parser['payload']));s.attention.overflow=parser['overflow']
        sessions.items[s.id]=s;sessions.open_history(s);s.pump=asyncio.create_task(sessions._pump(s))
        if s.alive:sessions._resume_reader(s)
        s.reaper=asyncio.create_task(sessions._reap(s,announce=s.alive))
    return os.fdopen(lockfd,'a+'),{k:v for k,v in data.items() if k not in ('schema','pid','lockfd','sessions')}
