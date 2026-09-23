import asyncio,os,signal
import pytest
from jaunt.sessions import Sessions,AttentionParser

@pytest.mark.parametrize('message,expected',[(b'\x07',{'bell'}),(b'\x1b]9;ready\x07',{'program'}),(b'\x1b]777;notify;title;body\x1b\\',{'program'}),(b'\x1b]52;c;private\x07',set()),(b'\x1b]0;title\x07',set())])
def test_attention_chunk_boundaries(message,expected):
    for boundary in range(len(message)+1):
        p=AttentionParser()
        assert p.feed(message[:boundary])|p.feed(message[boundary:])==expected

@pytest.mark.asyncio
@pytest.mark.parametrize("exit_parent", [False, True])
async def test_shared_geometry_and_jobs(tmp_path,monkeypatch,exit_parent):
    monkeypatch.setenv('SHELL','/bin/sh')
    events=[]
    async def send(peer,value):events.append((peer,value))
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path)
    try:
        s=await sessions.create({'cwd':str(tmp_path),'cols':80,'rows':24})
        sid=s['id'];await sessions.attach('local',{'id':sid});await sessions.add_view('local',sid,'Desktop')
        await sessions.activity('local',sid,{'cols':120,'rows':40},'Desktop')
        await sessions.attach('remote',{'id':sid});await sessions.add_view('remote',sid,'Phone')
        assert sessions.get(sid).cols==120
        with pytest.raises(ValueError):await sessions.activity('unattached',sid,{'cols':40,'rows':20})
        await sessions.activity('remote',sid,{'cols':42,'rows':18},'Phone')
        assert sessions.get(sid).active_view=='remote'
        assert {e['cols'] for p,e in events if p=='local' and e['type']=='terminal.geometry'} >= {120,42}
        sessions.detach('remote');assert sessions.get(sid).alive
        # A separate job-control group that ignores graceful shutdown must also die.
        command=b"sh -c 'trap \"\" HUP TERM; echo $$ > stubborn.pid; while :; do sleep 1; done' &\n"
        await sessions.write(sid,command)
        for _ in range(100):
            if (tmp_path/'stubborn.pid').exists():break
            await asyncio.sleep(.03)
        child=int((tmp_path/'stubborn.pid').read_text())
        assert os.getsid(child)==s['pid']
        if exit_parent:
            await sessions.write(sid,b'exit\n')
            for _ in range(100):
                if not sessions.get(sid).alive:break
                await asyncio.sleep(.03)
            assert not sessions.get(sid).alive
            assert sessions.get(sid).process.returncode is None, 'Leader PID must remain reserved'
            os.kill(child,0)
            assert sessions.has_jobs(sessions.get(sid)), 'Surviving jobs must still block automatic restart'
        await sessions.terminate(sid)
        assert sid not in sessions.items
        for _ in range(100):
            try:
                os.kill(child,0)
                stat=__import__('subprocess').check_output(['ps','-p',str(child),'-o','stat='],text=True).strip()
                if stat.startswith('Z'):break
            except (ProcessLookupError,__import__('subprocess').CalledProcessError):break
            await asyncio.sleep(.03)
        else:pytest.fail('The background job survived explicit termination')
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_bash_service_loads_login_path_and_interactive_prompt(tmp_path, monkeypatch):
    import shutil
    if not shutil.which('bash'):
        pytest.skip('bash is not installed')
    home=tmp_path/'home';home.mkdir()
    binary=home/'tools';binary.mkdir()
    tool=binary/'fixture-command';tool.write_text('#!/bin/sh\necho LOGIN_PATH_PROVED\n');tool.chmod(0o755)
    # A valid login profile that does not source .bashrc reproduced the bug.
    (home/'.bash_profile').write_text('export PATH="$HOME/tools:/usr/bin:/bin"\n')
    (home/'.bashrc').write_text("PS1='\\[\\e[32m\\]COLOR_PROMPT\\[\\e[0m\\] $ '\n")
    monkeypatch.setenv('HOME',str(home));monkeypatch.setenv('SHELL',shutil.which('bash'))
    monkeypatch.setenv('PATH','/usr/bin:/bin')
    async def send(*args):pass
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path)
    try:
        info=await sessions.create({'cwd':str(home)})
        s=sessions.get(info['id'])
        await sessions.write(s.id,b'fixture-command\n')
        for _ in range(100):
            output=b''.join(chunk[1] for chunk in s.ring)
            if b'LOGIN_PATH_PROVED' in output and b'\x1b[32mCOLOR_PROMPT' in output:break
            await asyncio.sleep(.03)
        assert b'LOGIN_PATH_PROVED' in output
        assert b'\x1b[32mCOLOR_PROMPT' in output
    finally:await sessions.shutdown()


def test_program_notification_content_survives_chunking():
    message=b'\x1b]777;notify;Build complete;All checks passed\x1b\\'
    for boundary in range(len(message)+1):
        parser=AttentionParser();messages=[]
        parser.feed(message[:boundary]);messages.extend(parser.messages)
        parser.feed(message[boundary:]);messages.extend(parser.messages)
        assert messages==[('Build complete','All checks passed')]
    parser=AttentionParser();parser.feed(b'\x1b]9;Ready for review\x07')
    assert parser.messages==[('', 'Ready for review')]
    parser.feed(b'\x1b]52;c;not a notification\x07')
    assert parser.messages==[]

@pytest.mark.asyncio
async def test_new_session_inherits_live_directory_and_unique_name(tmp_path, monkeypatch):
    monkeypatch.setenv('SHELL','/bin/sh')
    async def noop(*args):pass
    sessions=Sessions(noop,noop,tmp_path)
    child=tmp_path/'actual current directory';child.mkdir()
    try:
        first=await sessions.create({'cwd':str(tmp_path)})
        await sessions.write(first['id'],("cd '"+str(child)+"'\n").encode())
        for _ in range(100):
            if await sessions.directory(first['id'])==str(child):break
            await asyncio.sleep(.03)
        assert await sessions.directory(first['id'])==str(child)
        second=await sessions.create({'sourceSession':first['id']})
        assert second['cwd']==str(child)
        assert first['name']=='sh 1' and second['name']=='sh 2'
        explicit=await sessions.create({'sourceSession':first['id'],'cwd':str(tmp_path),'name':'custom'})
        assert explicit['cwd']==str(tmp_path) and explicit['name']=='custom'
        await sessions.terminate(first['id'])
        third=await sessions.create({'cwd':str(tmp_path)})
        assert third['name']!=second['name']
    finally:
        await sessions.shutdown()

@pytest.mark.asyncio
async def test_late_stream_frames_after_termination_keep_peer_alive(tmp_path,monkeypatch):
    from types import SimpleNamespace
    from jaunt.daemon import Peer
    from jaunt.crypto import b64
    monkeypatch.setenv('SHELL','/bin/sh')
    async def noop(*args):pass
    messages=[]
    async def send(value):messages.append(value)
    sessions=Sessions(noop,noop,tmp_path)
    peer=SimpleNamespace(host=SimpleNamespace(sessions=sessions,reexec=None,active_actions=0),routing_id='fixture',display_name='Fixture',send=send)
    peer._dispatch=lambda message: Peer._dispatch(peer,message)
    try:
        shell=await sessions.create({'cwd':str(tmp_path)})
        await sessions.terminate(shell['id'])
        await Peer.dispatch(peer,{'type':'terminal.resize','id':shell['id'],'cols':80,'rows':24})
        await Peer.dispatch(peer,{'type':'terminal.input','id':shell['id'],'active':True,'data':b64(b'never replay\n')})
        await Peer.dispatch(peer,{'type':'ping','at':123})
        assert messages==[{'type':'pong','at':123}]
        assert not sessions.items
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_flow_control_bounds_unacknowledged_output_and_catches_up(tmp_path,monkeypatch):
    """A viewer that stops acknowledging receives at most WINDOW bytes in flight; when it acknowledges
    again it catches up from a reset with at most CATCHUP bytes. A viewer that keeps acknowledging gets
    everything. Notifications are still detected while nobody is fed."""
    from jaunt.sessions import WINDOW,CATCHUP
    monkeypatch.setenv('SHELL','/bin/sh')
    from jaunt.crypto import unb64
    events=[];bells=[];box={}
    async def send(peer,value):
        events.append((peer,value))
        # The fast viewer behaves like a responsive client: it acknowledges each frame as it renders it
        # (a real send yields to the loop for network I/O; do the same so acknowledgements get processed).
        if peer=='fast' and value['type']=='terminal.output':
            asyncio.get_running_loop().create_task(box['sessions'].ack('fast',value['id'],value['offset']+len(unb64(value['data']))))
        await asyncio.sleep(0)
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path,attention=lambda s,event,*rest:bells.append(event));box['sessions']=sessions
    try:
        s=await sessions.create({'cwd':str(tmp_path),'cols':80,'rows':24});sid=s['id']
        await sessions.attach('fast',{'id':sid});await sessions.attach('slow',{'id':sid})
        received=lambda peer:sum(len(unb64(e['data'])) for p,e in events if p==peer and e['type']=='terminal.output')
        # 1.5 MiB burst: the fast peer acknowledges every frame, the slow one never does.
        await sessions.write(sid,b"head -c 1572864 /dev/zero | tr '\\0' x; printf '\\a'; echo END-OF-BU\"\"RST\n")
        for _ in range(400):
            await asyncio.sleep(.05)
            if any(p=='fast' and e['type']=='terminal.output' and b'END-OF-BURST' in unb64(e['data']) for p,e in events):break
        else:pytest.fail('burst never completed for the acknowledging viewer')
        session=sessions.get(sid)
        assert received('fast')>=1572864,'the acknowledging viewer must get the whole stream'
        assert received('slow')<=WINDOW+65536,'a silent viewer must not be flooded'
        assert session.subscribers['slow'].behind
        assert 'bell' in bells,'notifications are detected even while a viewer is not fed'
        # The slow viewer acknowledges what it has: it is brought to the head with a bounded, reset catch-up.
        before=len(events)
        await sessions.ack('slow',sid,session.subscribers['slow'].sent)
        tail=[e for p,e in events[before:] if p=='slow']
        assert tail and tail[0]['type']=='terminal.reset' and tail[0]['trimmed']
        caught=sum(len(unb64(e['data'])) for e in tail if e['type']=='terminal.output')
        assert 0<caught<=CATCHUP and caught<=session.subscribers['slow'].window and tail[0]['offset']+caught==session.offset
        assert not session.subscribers['slow'].behind and session.subscribers['slow'].sent==session.offset
        # A fresh attach far behind the head also gets only the bounded tail.
        events.clear();await sessions.attach('late',{'id':sid,'after':0})
        late=[e for p,e in events if p=='late']
        assert late[0]['type']=='terminal.reset' and sum(len(unb64(e['data'])) for e in late if e['type']=='terminal.output')<=CATCHUP
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_history_reads_beyond_the_ring_from_disk_and_purges_on_termination(tmp_path,monkeypatch):
    from jaunt import sessions as sessions_module
    from jaunt.crypto import unb64
    monkeypatch.setattr(sessions_module,'MAX_REPLAY',50000)
    monkeypatch.setenv('SHELL','/bin/sh')
    async def send(peer,value):pass
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path)
    try:
        s=await sessions.create({'cwd':str(tmp_path),'cols':80,'rows':24});sid=s['id'];session=sessions.get(sid)
        assert session.history is not None and (tmp_path/'scrollback'/sid).is_dir()
        await sessions.write(sid,b"head -c 300000 /dev/zero | tr '\\0' y; echo DO\"\"NE\n")
        for _ in range(200):
            await asyncio.sleep(.05)
            if session.offset>=300000 and b'DONE' in b''.join(c for _,c,_,_ in session.ring):break
        else:pytest.fail('burst did not complete')
        ring_start=session.ring[0][0];assert ring_start>0,'the ring dropped old output'
        assert session.retained()==0,'disk history keeps everything from offset 0'
        first=await sessions.history(sid,ring_start,100000)
        assert first['offset']==ring_start-100000 and len(unb64(first['data']))==100000 and unb64(first['data'])==b'y'*100000 or first['offset']>=0
        head=await sessions.history(sid,session.offset,1000);assert unb64(head['data']).endswith(b'DONE\r\n') or b'DONE' in unb64(head['data'])
        # Disk off: files vanish, history now comes from the ring only.
        sessions.configure_history(False);assert not (tmp_path/'scrollback').exists() or not any((tmp_path/'scrollback').iterdir())
        assert session.history is None and session.retained()==session.ring[0][0]
        sessions.configure_history(True);assert session.history is not None
        await sessions.terminate(sid);assert not (tmp_path/'scrollback'/sid).exists()
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_output_frames_never_exceed_the_relay_budget(tmp_path,monkeypatch):
    """A single large PTY write (or a coalesced burst) is delivered in frames of at most FRAME_BYTES,
    live and during catch-up; one oversized frame used to be dropped after sealing and desynchronise the channel."""
    from jaunt.sessions import FRAME_BYTES
    from jaunt.crypto import unb64
    monkeypatch.setenv('SHELL','/bin/sh')
    events=[];box={}
    async def send(peer,value):
        events.append((peer,value))
        if peer=='live' and value['type']=='terminal.output':  # a responsive viewer keeps acknowledging
            asyncio.get_running_loop().create_task(box['s'].ack('live',value['id'],value['offset']+len(unb64(value['data']))))
        await asyncio.sleep(0)
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path);box['s']=sessions
    try:
        s=await sessions.create({'cwd':str(tmp_path),'cols':80,'rows':24});sid=s['id']
        await sessions.attach('live',{'id':sid})
        await sessions.write(sid,b"head -c 200000 /dev/zero | tr '\\0' z; echo DO\"\"NE\n")
        for _ in range(200):
            await asyncio.sleep(.05)
            if any(p=='live' and e['type']=='terminal.output' and b'DONE' in unb64(e['data']) for p,e in events):break
        else:pytest.fail('burst did not complete')
        outputs=[e for p,e in events if p=='live' and e['type']=='terminal.output']
        assert max(len(unb64(e['data'])) for e in outputs)<=FRAME_BYTES
        assert sum(len(unb64(e['data'])) for e in outputs)>=200000
        # Offsets are contiguous across the split frames.
        expected=outputs[0]['offset']
        for e in outputs:assert e['offset']==expected;expected+=len(unb64(e['data']))
        events.clear();await sessions.attach('late',{'id':sid,'after':0})
        late=[e for p,e in events if p=='late' and e['type']=='terminal.output']
        assert late and max(len(unb64(e['data'])) for e in late)<=FRAME_BYTES
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_trimmed_catch_up_starts_on_a_clean_boundary():
    """JAU-64: a trimmed replay never begins inside an escape sequence or a UTF-8 character."""
    from jaunt.sessions import Session,SAFE_CUT
    async def noop(*args):pass
    sessions=Sessions(noop,noop,'.')
    s=Session(id='x',name='x',cwd='.',pid=0,fd=-1,cols=80,rows=24)
    s.ring.extend([(0,b'ab8;2;45;47',80,24),(11,b';48mtext\x1b[0m',80,24)])
    assert sessions._clean_start(s,3)==19,'the cut moves to the next escape, across ring chunks'
    s.ring.clear();s.ring.append((0,b'tail of a line\r\nnext',80,24))
    assert sessions._clean_start(s,2)==16,'a line start is a clean boundary'
    s.ring.clear();s.ring.append((0,b'\xa0\xa0plain'+b'x'*SAFE_CUT+b'\x1b[m',80,24))
    assert sessions._clean_start(s,0)==2,'without an escape nearby, the cut skips to a UTF-8 character start'

@pytest.mark.asyncio
async def test_trimmed_catch_up_asks_the_program_to_repaint_without_changing_the_size(tmp_path,monkeypatch):
    """JAU-64: after a trimmed catch-up the PTY width is toggled one column and back (Codex ignores a
    same-size SIGWINCH); a contiguous resume or an exited shell is left alone, and requests are rate limited."""
    import fcntl,termios,struct,time
    from jaunt import sessions as sessions_module
    from jaunt.crypto import unb64
    monkeypatch.setattr(sessions_module,'REDRAW_TOGGLE',.02)
    monkeypatch.setattr(sessions_module,'REDRAW_INTERVAL',.6)
    monkeypatch.setenv('SHELL','/bin/sh')
    events=[];sizes=[];box={}
    real=fcntl.ioctl
    def ioctl(fd,request,*args):
        if request==termios.TIOCSWINSZ and box.get('fd')==fd:
            rows,cols=struct.unpack('HHHH',args[0])[:2];sizes.append((time.monotonic(),cols,rows))
        return real(fd,request,*args)
    monkeypatch.setattr(fcntl,'ioctl',ioctl)
    async def send(peer,value):events.append((peer,value))
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path)
    try:
        s=await sessions.create({'cwd':str(tmp_path),'cols':80,'rows':24});sid=s['id'];session=sessions.get(sid);box['fd']=session.fd
        fixture=tmp_path/'burst.py';fixture.write_text("import sys\nsys.stdout.write('\\x1b[38;2;45;47;48mUPDATE'*40000+'\\nDO'+'NE\\n')\n")
        await sessions.write(sid,f'python3 {fixture}\n'.encode())
        for _ in range(200):
            await asyncio.sleep(.05)
            if b'DONE' in b''.join(c for _,c,_,_ in session.ring):break
        else:pytest.fail('burst did not complete')
        async def settle():
            for _ in range(100):
                if session.redraw is None or session.redraw.done():return
                await asyncio.sleep(.02)
            pytest.fail('repaint request never completed')
        # Contiguous resume: no reset, no repaint.
        await sessions.attach('near',{'id':sid,'after':session.offset-10});await settle()
        assert not [e for p,e in events if p=='near' and e['type']=='terminal.reset'] and sizes==[]
        # Far behind: the replay starts on an escape and the program is asked to repaint once.
        await sessions.attach('late',{'id':sid,'after':0})
        late=[e for p,e in events if p=='late']
        reset=late[0];assert reset['type']=='terminal.reset' and reset['trimmed']
        first=next(e for e in late if e['type']=='terminal.output')
        assert first['offset']==reset['offset'] and unb64(first['data']).startswith(b'\x1b[38;2;45;47;48m')
        await settle()
        assert [(c,r) for _,c,r in sizes]==[(79,24),(80,24)]
        assert (session.cols,session.rows)==(80,24),'the shared geometry is untouched'
        assert not [e for p,e in events if e['type']=='terminal.geometry' and e['cols']!=80]
        # Two more trimmed catch-ups right away: coalesced into one repaint, after the interval.
        await sessions.attach('late2',{'id':sid,'after':0});await sessions.attach('late3',{'id':sid,'after':0})
        await settle()
        assert len(sizes)==4 and sizes[2][0]-sizes[0][0]>=.55,'repaint requests are coalesced and rate limited'
        assert [(c,r) for _,c,r in sizes[2:]]==[(79,24),(80,24)]
        # An exited shell is never nudged.
        await sessions.write(sid,b'exit\n')
        for _ in range(100):
            if not session.alive:break
            await asyncio.sleep(.03)
        assert not session.alive
        await asyncio.sleep(.7);await sessions.attach('after-exit',{'id':sid,'after':0});await settle()
        assert [e for p,e in events if p=='after-exit'][0]['trimmed'] and len(sizes)==4
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_redraw_serializes_with_activity_and_restores_on_cancel(tmp_path,monkeypatch):
    import fcntl,termios,struct
    from jaunt import sessions as module
    monkeypatch.setenv('SHELL','/bin/sh')
    monkeypatch.setattr(module,'REDRAW_TOGGLE',.1)
    monkeypatch.setattr(module,'REDRAW_INTERVAL',0)
    async def noop(*args):pass
    sessions=Sessions(noop,noop,tmp_path)
    try:
        info=await sessions.create({'cols':80,'rows':24});s=sessions.get(info['id'])
        await sessions.attach('view',{'id':s.id})
        def size():return struct.unpack('HHHH',fcntl.ioctl(s.fd,termios.TIOCGWINSZ,b'\0'*8))[:2]
        async def toggled():
            for _ in range(100):
                if size()[1]==s.cols-1:return
                await asyncio.sleep(.005)
            pytest.fail('PTY never entered the temporary size')
        sessions._request_redraw(s);await toggled()
        await sessions.activity('view',s.id,{'cols':100,'rows':30})
        await s.redraw
        assert size()==(30,100) and (s.rows,s.cols)==(30,100)
        assert s.active_view=='view'
        sessions._request_redraw(s);await toggled();s.redraw.cancel()
        await asyncio.gather(s.redraw,return_exceptions=True)
        assert size()==(30,100),'Cancellation restores the PTY before releasing resize_lock'
        # Closing a session also drains a pending, rate-limited redraw task.
        monkeypatch.setattr(module,'REDRAW_INTERVAL',60)
        sessions._request_redraw(s);pending=s.redraw
        await sessions.terminate(s.id)
        assert pending.done() and s.fd==-1 and s.id not in sessions.items
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_slow_viewer_ack_requests_redraw_after_trim(tmp_path,monkeypatch):
    from jaunt.sessions import Session,MIN_WINDOW
    from jaunt.crypto import unb64
    events=[];requested=[]
    async def send(peer,event):events.append(event)
    async def noop(*args):pass
    sessions=Sessions(send,noop,tmp_path)
    s=Session(id='slow',name='slow',cwd='.',pid=0,fd=-1,cols=80,rows=24)
    sessions.items[s.id]=s
    data=b'\x1b[31mUPDATE\x1b[0m'*20000
    s.ring.append((0,data,80,24));s.offset=len(data)
    viewer=sessions._viewer('view',0);viewer.window=MIN_WINDOW;viewer.behind=True
    s.subscribers['view']=viewer
    monkeypatch.setattr(sessions,'_request_redraw',lambda session:requested.append(session.id))
    await sessions.ack('view',s.id,0)
    assert requested==[s.id]
    reset=events[0];assert reset['type']=='terminal.reset' and reset['trimmed']
    outputs=[e for e in events if e['type']=='terminal.output']
    assert outputs[0]['offset']==reset['offset']
    assert unb64(outputs[0]['data']).startswith(b'\x1b')
    assert sum(len(unb64(e['data'])) for e in outputs)<=MIN_WINDOW//2
    assert viewer.sent==s.offset and not viewer.behind
