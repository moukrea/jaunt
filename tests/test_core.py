from __future__ import annotations
import asyncio, hashlib, json, os, subprocess, sys, time
from pathlib import Path
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidTag
from jaunt.crypto import Channel,b64,unb64,public_key,proof,verify,token
from jaunt.files import Files,CHUNK,basename
from jaunt.state import State,atomic_json
from jaunt.sessions import Sessions,dimensions
from jaunt.transport import relay_url


def channels(secret=None,transcript=b'test-transcript'):
    a,b=ec.generate_private_key(ec.SECP256R1()),ec.generate_private_key(ec.SECP256R1())
    secret=secret or os.urandom(32)
    return Channel(a,public_key(b),secret,transcript,server=False),Channel(b,public_key(a),secret,transcript,server=True)

@pytest.mark.parametrize('value',[{}, {'unicode':'été 日本語 🐢'}, {'binary':b64(bytes(range(256)))},['x',1,False]])
def test_crypto_roundtrip(value):
    a,b=channels();assert b.open(a.seal(value))==value;assert a.open(b.seal(value))==value

def test_crypto_replay_reorder_tamper():
    a,b=channels();f=a.seal({'secret':'not plaintext'});assert 'not plaintext' not in json.dumps(f)
    with pytest.raises(ValueError):b.open({**f,'n':2})
    bad={**f,'ct':b64(bytes([unb64(f['ct'])[0]^1])+unb64(f['ct'])[1:])}
    with pytest.raises(InvalidTag):b.open(bad)
    assert b.open(f)=={'secret':'not plaintext'}
    with pytest.raises(ValueError):b.open(f)
    with pytest.raises(ValueError):b.open({**a.seal({}),'type':'plaintext'})

def test_crypto_wrong_secret():
    a,b=ec.generate_private_key(ec.SECP256R1()),ec.generate_private_key(ec.SECP256R1())
    client=Channel(a,public_key(b),b'A'*32,b'T',server=False)
    server=Channel(b,public_key(a),b'B'*32,b'T',server=True)
    with pytest.raises(InvalidTag):server.open(client.seal({'secret':'x'}))

def test_proofs_and_encoding():
    key=os.urandom(32);p=proof(key,'server',b'transcript')
    assert verify(key,'server',b'transcript',p)
    assert not verify(key,'client',b'transcript',p)
    assert not verify(key,'server',b'different',p)
    assert not verify(key,'server',b'transcript','!invalid')
    assert unb64(b64(bytes(range(256))))==bytes(range(256))
    assert len(token())==43
    with pytest.raises(ValueError):unb64('!')

@pytest.fixture
def files(tmp_path):
    (tmp_path/'attachments').mkdir();f=Files(tmp_path)
    yield f
    f.cleanup(all_files=True)

def upload(f,root,raw,name='日本語 image.bin',owner='alice',uid='abcdefgh12345'):
    params={'id':uid,'path':str(root),'name':name,'size':len(raw)}
    f.begin_upload(owner,params)
    for n in range(0,len(raw),CHUNK):f.upload_chunk(owner,{'id':uid,'offset':n,'data':b64(raw[n:n+CHUNK])})
    result=f.finish_upload(owner,{'id':uid,'sha256':hashlib.sha256(raw).hexdigest()})
    return result,params

@pytest.mark.parametrize('size',[0,1,49152,49153,250000])
def test_file_roundtrip(files,tmp_path,size):
    raw=bytes((i%251 for i in range(size)));done,p=upload(files,tmp_path,raw)
    assert Path(done['path']).read_bytes()==raw
    assert files.begin_upload('alice',p)['complete']
    d=files.begin_download('alice',{'path':done['path']});out=bytearray()
    while True:
        block=files.download_chunk('alice',{'id':d['id'],'offset':len(out)});out.extend(unb64(block['data']))
        if block['done']:break
    assert bytes(out)==raw
    files.close_download('alice',{'id':d['id']});assert not files.downloads

def test_upload_resume_owner_offsets_checksum(files,tmp_path):
    p={'id':'abcdefgh_123','path':str(tmp_path),'name':'a.txt','size':6}
    assert files.begin_upload('a',p)['offset']==0
    assert files.upload_chunk('a',{'id':p['id'],'offset':0,'data':b64(b'abc')})['offset']==3
    assert files.begin_upload('a',p)['offset']==3
    assert files.upload_chunk('a',{'id':p['id'],'offset':0,'data':b64(b'abc')})['retry']
    with pytest.raises(ValueError):files.begin_upload('b',p)
    with pytest.raises(ValueError):files.upload_chunk('b',{'id':p['id'],'offset':3,'data':b64(b'def')})
    with pytest.raises(ValueError):files.finish_upload('a',{'id':p['id']})
    files.upload_chunk('a',{'id':p['id'],'offset':3,'data':b64(b'def')})
    with pytest.raises(ValueError):files.finish_upload('a',{'id':p['id'],'sha256':'0'*64})
    assert not (tmp_path/'a.txt').exists()
    r=files.finish_upload('a',{'id':p['id'],'sha256':hashlib.sha256(b'abcdef').hexdigest()})
    assert files.finish_upload('a',{'id':p['id']})==r

def test_upload_atomic_no_clobber(files,tmp_path):
    p={'id':'abcdefgh_123','path':str(tmp_path),'name':'a.txt','size':0}
    files.begin_upload('a',p);(tmp_path/'a.txt').write_text('another process wrote this')
    with pytest.raises(FileExistsError):files.finish_upload('a',{'id':p['id']})
    assert (tmp_path/'a.txt').read_text()=='another process wrote this'
    assert not list(tmp_path.glob('.jaunt-upload-*'))

def test_attachment_cancel_cleanup(files,tmp_path):
    p={'id':'abcdefgh_123','name':'shot.png','size':100,'attachment':True}
    files.begin_upload('a',p)
    assert not (tmp_path/'attachments'/'abcdefgh_123-shot.png').exists()
    files.cancel_upload('a',{'id':p['id']});assert not list((tmp_path/'attachments').iterdir())
    files.begin_upload('a',p);files.uploads[p['id']].touched=0;files.cleanup();assert not files.uploads

@pytest.mark.parametrize('name',['..','.','../x','a/b','a\\b','x\x00y',''])
def test_bad_names(name):
    with pytest.raises(ValueError):basename(name)

def test_files_pagination_and_nonrecursive(files,tmp_path):
    for i in range(220):(tmp_path/f'{i:03}.txt').write_text('x')
    (tmp_path/'.hidden').write_text('x')
    data=files.listing({'path':str(tmp_path),'limit':100});assert len(data['entries'])==100;assert data['next']==100
    second=files.listing({'path':str(tmp_path),'offset':100});assert len(second['entries'])==100
    assert '.hidden' not in [e['name'] for e in data['entries']]
    with pytest.raises(OSError):files.remove({'path':str(tmp_path)})
    files.mkdir({'path':str(tmp_path),'name':'empty'})
    files.rename({'path':str(tmp_path/'empty'),'name':'renamed'})
    files.remove({'path':str(tmp_path/'renamed')})

def test_download_modified_and_fifo(files,tmp_path):
    file=tmp_path/'read.txt';file.write_bytes(b'abc');d=files.begin_download('a',{'path':str(file)})
    with pytest.raises(ValueError):files.download_chunk('b',{'id':d['id'],'offset':0})
    file.write_bytes(b'abcd')
    with pytest.raises(ValueError):files.download_chunk('a',{'id':d['id'],'offset':0})
    fifo=tmp_path/'pipe';os.mkfifo(fifo)
    with pytest.raises(ValueError):files.begin_download('a',{'path':str(fifo)})

def test_state_permissions_identity(tmp_path):
    s=State(tmp_path/'state');room=s.data['room'];s.data['devices']['example']={'secret':'private'};s.save()
    assert State(s.root).data['room']==room
    assert s.root.stat().st_mode & 0o777==0o700
    assert s.path.stat().st_mode & 0o777==0o600
    assert not list(s.root.glob('.state-*'))
    assert 'private' in s.path.read_text()

def test_relay_urls():
    assert relay_url('wss://relay.example','x'*24)=='wss://relay.example/v1/room/'+'x'*24
    assert relay_url('ws://127.0.0.1:8787','x'*24).startswith('ws://127.0.0.1')
    for url in ['ws://internet.example','https://relay.example','wss://user:pass@relay.example']:
        with pytest.raises(ValueError):relay_url(url,'x'*24)

def test_dimensions():
    assert dimensions({'cols':-1,'rows':999999})==(10,200)

@pytest.mark.asyncio
async def test_real_pty_replay_lifecycle(tmp_path):
    events=[]
    async def send(peer,value):events.append((peer,value))
    async def changed():pass
    sessions=Sessions(send,changed,tmp_path)
    try:
        first=await sessions.create({'id':'test_pty_123','name':'first','cwd':str(tmp_path)})
        assert (await sessions.create({'id':'test_pty_123'}))['pid']==first['pid']
        await sessions.attach('one',{'id':first['id']})
        # Marker is not present contiguously in the echoed command.
        await sessions.write(first['id'],b"printf 'jaunt_%s\\n' 'ACTUAL_RESULT'\r")
        for _ in range(100):
            raw=b''.join(unb64(v['data']) for _,v in events if v.get('type')=='terminal.output')
            if b'jaunt_ACTUAL_RESULT' in raw:break
            await asyncio.sleep(.03)
        assert b'jaunt_ACTUAL_RESULT' in raw
        sid=first['id'];sessions.detach('one');assert sessions.get(sid).alive
        before=sessions.get(sid).offset
        await sessions.write(sid,b"printf 'OFFLINE_%s\\n' 'CONTINUES'\r")
        await asyncio.sleep(.3)
        await sessions.attach('two',{'id':sid,'after':before})
        raw=b''.join(unb64(v['data']) for peer,v in events if peer=='two' and v.get('type')=='terminal.output')
        assert b'OFFLINE_CONTINUES' in raw
        sessions.resize(sid,{'cols':42,'rows':17});assert sessions.get(sid).cols==42
        await sessions.rename(sid,'renamed');assert sessions.get(sid).name=='renamed'
        second=await sessions.create({'id':'test_pty_456','cwd':str(tmp_path)})
        await sessions.close(sid);assert sid not in sessions.items
        assert sessions.get(second['id']).alive
    finally:await sessions.shutdown()

@pytest.mark.asyncio
async def test_upgrade_refuses_active_pty_and_closes_admission(tmp_path, monkeypatch):
    from jaunt.daemon import Host
    monkeypatch.setenv('SHELL', '/bin/sh')
    host = Host(State(tmp_path))
    try:
        info = await host.sessions.create({'cwd': str(tmp_path)})
        session = host.sessions.get(info['id'])
        for approval in (False, 'true', 1):
            with pytest.raises(ValueError, match='plain shells are running'):
                host.stop_for_upgrade(approval)
            assert not host.stopping.is_set()
            assert session.process.poll() is None
        await host.sessions.write(info['id'], b"printf 'still-alive' > upgrade-proof.txt\n")
        for _ in range(100):
            if (tmp_path / 'upgrade-proof.txt').exists(): break
            await asyncio.sleep(.02)
        assert (tmp_path / 'upgrade-proof.txt').read_text() == 'still-alive'
        assert host.stop_for_upgrade(True)['stopping']
        with pytest.raises(ValueError, match='stopping for an upgrade'):
            await host.sessions.create({'cwd': str(tmp_path)})
    finally:
        await host.sessions.shutdown()
    assert session.process.poll() is not None

@pytest.mark.asyncio
async def test_idle_upgrade_closes_shell_admission(tmp_path):
    from jaunt.daemon import Host
    host = Host(State(tmp_path))
    assert host.stop_for_upgrade()['stopping']
    with pytest.raises(ValueError, match='stopping for an upgrade'):
        await host.sessions.create({'cwd': str(tmp_path)})
