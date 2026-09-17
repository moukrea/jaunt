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
