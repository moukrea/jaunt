import hashlib
import io
import json
import zipfile

import pytest
from jaunt import updates
from jaunt.state import atomic_json

@pytest.fixture
def release(tmp_path, monkeypatch):
    monkeypatch.setenv('jaunt_STATE', str(tmp_path))
    atomic_json(tmp_path / 'installation.json', {'page': 'https://example.test/jaunt', 'repository': 'moukrea/jaunt', 'tag': 'v0.1.0-beta.4', 'automatic': True, 'prefix': str(tmp_path/'runtime'), 'bin': str(tmp_path/'bin')})
    content=io.BytesIO()
    with zipfile.ZipFile(content,'w') as z:z.writestr('jaunt/installer.sh', '#!/bin/sh\nexit 0\n')
    wheel=content.getvalue();name='jaunt_host-0.1.0b5-py3-none-any.whl'
    responses={'config.json':json.dumps({'release':'v0.1.0-beta.5'}).encode(), 'host-manifest.json':json.dumps({'schema':1,'wheel':name,'sha256':hashlib.sha256(wheel).hexdigest()}).encode(),name:wheel}
    monkeypatch.setattr(updates,'fetch',lambda url,maximum,**_: responses[url.rsplit('/',1)[1]])
    return tmp_path,responses

def test_automatic_update_stages_but_never_kills_active_shell(release,monkeypatch):
    root,_=release
    monkeypatch.setenv('jaunt_ALLOW_RESTART','1')
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[{'alive':True,'tmux':False}]})
    monkeypatch.setattr(updates.subprocess,'run',lambda *a,**k:pytest.fail('An active ordinary shell must prevent automatic installation'))
    result=updates.update(automatic=True,allow_restart=True)
    assert result['state']=='deferred' and result['activeShells']==1
    assert (root/'updates/jaunt_host-0.1.0b5-py3-none-any.whl').exists()

def test_tampered_release_does_not_reach_shutdown_or_installer(release,monkeypatch):
    root,responses=release;responses['jaunt_host-0.1.0b5-py3-none-any.whl']+=b'tampered'
    monkeypatch.setattr('jaunt.cli.control',lambda *a:pytest.fail('Unverified bytes must not reach the host control socket'))
    result=updates.update(automatic=True)
    assert result['state']=='error' and 'checksum mismatch' in result['message']
    assert not list((root/'updates').glob('*.whl'))

@pytest.mark.parametrize("legacy", [False, True])
def test_idle_update_strips_inherited_restart_and_development_overrides(release,monkeypatch,legacy):
    prefix="jaunt_".upper() if legacy else "jaunt_"
    monkeypatch.setenv(prefix+'ALLOW_RESTART','1');monkeypatch.setenv(prefix+'DEV_INSTALL','1')
    monkeypatch.setenv(prefix+'RELEASE_BASE','https://attacker.invalid')
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[]})
    observed=[]
    def run(args,**kwargs):
        observed.append(kwargs['env']);return type('Result',(),{'returncode':0})()
    monkeypatch.setattr(updates.subprocess,'run',run)
    assert updates.update(automatic=True)['state']=='installed'
    assert len(observed)==1
    assert not {'jaunt_allow_restart','jaunt_dev_install','jaunt_release_base'} & {key.lower() for key in observed[0]}
    assert observed[0]['jaunt_SKIP_PAIR']=='1'
    assert observed[0]['jaunt_NO_GUI']=='1'

def test_explicit_restart_is_distinct_from_automatic_update(release,monkeypatch):
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[{'alive':True,'tmux':False}]})
    observed=[]
    monkeypatch.setattr(updates.subprocess,'run',lambda args,**k:(observed.append(k['env']) or type('Result',(),{'returncode':0})()))
    assert updates.update(allow_restart=True)['state']=='installed'
    assert observed[0]['jaunt_ALLOW_RESTART']=='1'

def test_updates_do_not_downgrade_or_jump_to_unvalidated_tag(release,monkeypatch):
    _,responses=release
    monkeypatch.setattr('jaunt.cli.control',lambda *a:pytest.fail('No downgrade'))
    responses['config.json']=b'{"release":"v0.1.0-beta.3"}'
    assert updates.update()['state']=='current'
    responses['config.json']=b'{"release":"../../bad"}'
    assert updates.update()['state']=='error'

def test_disable_persists_and_performs_no_network_request(release,monkeypatch):
    updates.configure(False)
    monkeypatch.setattr(updates,'fetch',lambda *a:pytest.fail('Automatic updates are disabled'))
    assert updates.update(automatic=True)['state']=='disabled'
    assert updates.status()['automatic'] is False

def test_automatic_update_waits_for_file_transfers(release,monkeypatch):
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[],'activeTransfers':1})
    monkeypatch.setattr(updates.subprocess,'run',lambda *a,**k:pytest.fail('An automatic update must not interrupt a transfer'))
    assert updates.update(automatic=True)['state']=='deferred'

@pytest.mark.asyncio
async def test_host_atomically_refuses_restart_during_a_transfer(tmp_path):
    from jaunt.daemon import Host
    from jaunt.state import State
    host=Host(State(tmp_path))
    upload=host.files.begin_upload('test-owner', {'path':str(tmp_path),'name':'transfer.bin','size':4})
    with pytest.raises(ValueError,match='File transfers'):
        host.stop_for_upgrade()
    assert not host.stopping.is_set() and host.sessions.accepting
    from jaunt.crypto import b64
    host.files.upload_chunk('test-owner', {'id':upload['id'],'offset':0,'data':b64(b'data')})
    host.files.finish_upload('test-owner', {'id':upload['id'],'sha256':hashlib.sha256(b'data').hexdigest()})
    assert (tmp_path/'transfer.bin').read_bytes()==b'data'
    assert host.stop_for_upgrade()['stopping']

def test_installer_failure_is_reported_as_failure_not_waiting(release,monkeypatch):
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[]})
    monkeypatch.setattr(updates.subprocess,'run',lambda *a,**k:type('Result',(),{'returncode':23})())
    result=updates.update()
    assert result['state']=='error' and '23' in result['message']

def test_update_progress_preserves_the_requested_operation(release,monkeypatch):
    root,responses=release;observed=[]
    monkeypatch.setenv('jaunt_UPDATE_ID','fixture-operation')
    original=updates.atomic_json
    def record(path,value):
        if path.name=='update-status.json':observed.append(value.copy())
        return original(path,value)
    monkeypatch.setattr(updates,'atomic_json',record)
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[]})
    monkeypatch.setattr(updates.subprocess,'run',lambda *a,**k:type('Result',(),{'returncode':0})())
    assert updates.update()['state']=='installed'
    assert [r['state'] for r in observed]==['checking','downloading','verifying','installing','installed']
    assert all(r['operation']=='fixture-operation' for r in observed)

def test_running_daemon_version_wins_over_a_stale_installation_pointer(release,monkeypatch):
    # An interrupted handoff can leave installation.json ahead of the daemon. The
    # published release must then still install instead of reporting "current".
    root,_=release
    atomic_json(root/'installation.json',{**updates.installation(root),'tag':'v0.1.0-beta.5'})
    import os
    atomic_json(root/'runtime.json',{'version':'0.1.0b4','pid':os.getpid()})
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[]})
    monkeypatch.setattr(updates.subprocess,'run',lambda *a,**k:type('Result',(),{'returncode':0})())
    assert updates.update()['state']=='installed'
    # A record from a daemon that no longer exists is ignored.
    atomic_json(root/'runtime.json',{'version':'0.1.0b3','pid':2**22-1})
    assert updates.running_tag(root)==''
    assert updates.tag_from_version('0.1.0b11')=='v0.1.0-beta.11' and updates.tag_from_version('1.2.3')=='v1.2.3'

def test_installer_failure_surfaces_its_own_reason(release,monkeypatch):
    root,_=release
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[]})
    def run(args,**kwargs):
        (root/'update.log').write_text('pip output line\njaunt: Dependency installation failed (network or package problem). The previous version was retained.\n')
        return type('Result',(),{'returncode':1})()
    monkeypatch.setattr(updates.subprocess,'run',run)
    result=updates.update()
    assert result['state']=='error' and result['retryable'] and 'Dependency installation failed' in result['message'] and 'pip output' not in result['message']

def test_network_failures_are_reported_as_retryable_not_generic(release,monkeypatch):
    import urllib.error
    def fetch(url,maximum,**_):raise urllib.error.URLError('unreachable')
    monkeypatch.setattr(updates,'fetch',fetch)
    result=updates.update()
    assert result['state']=='error' and result['retryable'] and 'internet connection' in result['message']

def test_deferred_state_names_its_reason(release,monkeypatch):
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[],'activeTransfers':2,'machine':{'seamlessUpdates':True}})
    monkeypatch.setattr(updates.subprocess,'run',lambda *a,**k:pytest.fail('must defer'))
    result=updates.update()
    assert result['state']=='deferred' and result['reason']=='transfers' and result['manual'] is True

@pytest.mark.asyncio
async def test_exec_for_upgrade_waits_for_inflight_actions_and_announces(tmp_path):
    import asyncio,sys
    from pathlib import Path
    from jaunt.daemon import Host
    from jaunt.state import State
    host=Host(State(tmp_path))
    sent=[]
    async def broadcast(value):sent.append(value)
    host.broadcast=broadcast
    host.active_actions=1
    async def release_later():
        await asyncio.sleep(0.3);host.active_actions=0
    asyncio.create_task(release_later())
    result=await host.exec_for_upgrade(Path(sys.executable))
    assert result=={'replacing':True,'preservesShells':True} and host.reexec==sys.executable and not host.sessions.accepting
    assert sent and sent[-1]['type']=='host.restarting' and sent[-1]['preservesShells']
    await asyncio.sleep(0.4);assert host.stopping.is_set()

@pytest.mark.asyncio
async def test_exec_for_upgrade_refuses_a_stuck_action_and_reopens_admission(tmp_path,monkeypatch):
    import asyncio,sys
    from pathlib import Path
    from jaunt.daemon import Host
    from jaunt.state import State
    host=Host(State(tmp_path));host.active_actions=1
    real=asyncio.sleep
    monkeypatch.setattr('jaunt.daemon.time.monotonic',(lambda base=[0]:(lambda:(base.__setitem__(0,base[0]+11) or base[0])))())
    with pytest.raises(ValueError,match='still finishing'):
        await host.exec_for_upgrade(Path(sys.executable))
    assert host.sessions.accepting and host.reexec is None

@pytest.mark.asyncio
async def test_update_status_changes_are_pushed_once_per_change(tmp_path):
    from jaunt.daemon import Host
    from jaunt.state import State
    host=Host(State(tmp_path));sent=[]
    async def broadcast(value):sent.append(value)
    host.broadcast=broadcast;host.peers={'p':object()}
    atomic_json(tmp_path/'installation.json',{'page':'https://example.test','repository':'moukrea/jaunt','tag':'v0.1.0-beta.4','prefix':'','bin':''})
    atomic_json(tmp_path/'update-status.json',{'state':'downloading','version':'v0.1.0-beta.5'})
    await host.push_update_status();await host.push_update_status()
    assert len(sent)==1 and sent[0]['type']=='update.progress' and sent[0]['state']=='downloading' and sent[0]['supported']
    atomic_json(tmp_path/'update-status.json',{'state':'installed','version':'v0.1.0-beta.5'})
    await host.push_update_status()
    assert len(sent)==2 and sent[1]['state']=='installed'
