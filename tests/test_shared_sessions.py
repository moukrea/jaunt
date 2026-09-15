import asyncio,os,signal
import pytest
from jaunt.sessions import Sessions,AttentionParser

@pytest.mark.parametrize('message,expected',[(b'\x07',{'bell'}),(b'\x1b]9;ready\x07',{'program'}),(b'\x1b]777;notify;title;body\x1b\\',{'program'}),(b'\x1b]52;c;private\x07',set()),(b'\x1b]0;title\x07',set())])
def test_attention_chunk_boundaries(message,expected):
    for boundary in range(len(message)+1):
        p=AttentionParser()
        assert p.feed(message[:boundary])|p.feed(message[boundary:])==expected

@pytest.mark.asyncio
async def test_shared_geometry_and_jobs(tmp_path,monkeypatch):
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
