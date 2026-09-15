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
