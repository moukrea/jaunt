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

@pytest.mark.asyncio
async def test_shared_workspace_follows_the_host_and_prunes_dead_sessions(tmp_path):
    from jaunt.daemon import Host
    from jaunt.state import State
    host=Host(State(tmp_path));sent=[]
    async def broadcast(v):sent.append(v)
    host.broadcast=broadcast
    class S:
        def __init__(s,id):s.id=id
    host.sessions.items={'aaa':S('aaa'),'bbb':S('bbb')}
    class P:routing_id='peer-1'
    assert host.workspace()['sync'] is False
    w=await host.workspace_configure(P(),{'sync':True,'openSessions':['aaa','bbb','zzz'],'layouts':[{'axis':'y','ratio':0.3,'first':{'id':'aaa'},'second':{'id':'bbb'}},{'id':'zzz'}],'tabOrder':['bbb','aaa'],'active':'bbb'})
    assert w['sync'] and w['openSessions']==['aaa','bbb'] and w['layouts']==[{'axis':'y','ratio':0.3,'first':{'id':'aaa'},'second':{'id':'bbb'}}] and w['tabOrder']==['bbb','aaa'] and w['active']=='bbb' and w['revision']==1
    assert sent[-1]['type']=='workspace.changed' and sent[-1]['from']=='peer-1'
    # An identical update is a no-op; a real one bumps the revision and is broadcast.
    assert (await host.workspace_update(P(),w))['revision']==1
    w2=await host.workspace_update(P(),{**w,'active':'aaa'});assert w2['revision']==2 and w2['active']=='aaa'
    # A client working from an older revision gets the current state back instead of overwriting it.
    stale=await host.workspace_update(P(),{**w,'openSessions':['aaa'],'revision':1});assert stale['stale'] and stale['openSessions']==['aaa','bbb'] and host.workspace()['revision']==2
    # displayedOnly needs sync; turning sync off drops it.
    assert (await host.workspace_configure(P(),{'displayedOnly':True}))['displayedOnly'] is True
    # A session that ended leaves the shared workspace and a split collapses to its survivor.
    del host.sessions.items['bbb'];await host.workspace_prune()
    w3=host.workspace();assert w3['openSessions']==['aaa'] and w3['layouts']==[{'id':'aaa'}] and w3['tabOrder']==['aaa'] and sent[-1]['from']==''
    off=await host.workspace_configure(P(),{'sync':False});assert off['sync'] is False and off['displayedOnly'] is False
    with pytest.raises(ValueError,match='synchronization is off'):
        await host.workspace_update(P(),w)

CANDIDATE_SOURCE = '0123456789abcdef0123456789abcdef01234567'

def channel_document(n=1, base=41, name='moukrea_9', **patch):
    dev, pr = name.split('_')
    suffix = f'.ch.{dev}.{pr}.{n}'
    return {'version': 1, 'channel': name, 'relay': 'wss://relay.example.test', 'page': 'https://example.test/jaunt/',
            'repository': 'moukrea/jaunt', 'release': f'v0.1.0-beta.{base}{suffix}',
            'androidRelease': f'android-v0.1.0-beta.31{suffix}', 'desktopRelease': f'desktop-v0.1.0-beta.33{suffix}',
            'releaseSource': CANDIDATE_SOURCE, **patch}

@pytest.fixture
def channel_release(tmp_path, monkeypatch):
    """A host on channel moukrea_9 whose Page serves production and one channel document."""
    import urllib.error
    monkeypatch.setenv('jaunt_STATE', str(tmp_path))
    atomic_json(tmp_path / 'installation.json', {'page': 'https://example.test/jaunt', 'repository': 'moukrea/jaunt', 'tag': 'v0.1.0-beta.41',
                                                 'automatic': True, 'channel': 'moukrea_9', 'prefix': str(tmp_path/'runtime'), 'bin': str(tmp_path/'bin')})
    content = io.BytesIO()
    with zipfile.ZipFile(content, 'w') as z: z.writestr('jaunt/installer.sh', '#!/bin/sh\nexit 0\n')
    served = {'/config.json': {'release': 'v0.1.0-beta.42'}, '/ch/moukrea_9/config.json': channel_document(2)}
    requested = []
    def fetch(url, maximum, **_):
        requested.append(url)
        path = url.removeprefix('https://example.test/jaunt')
        if path in served:
            if served[path] is None: raise urllib.error.HTTPError(url, 404, 'Not Found', {}, None)
            return json.dumps(served[path]).encode()
        tag = url.split('/releases/download/')[1].split('/')[0]
        wheel = content.getvalue(); name = f'jaunt_host-{updates.channels.python_version(tag)}-py3-none-any.whl'
        return wheel if url.endswith('.whl') else json.dumps({'schema': 1, 'wheel': name, 'sha256': hashlib.sha256(wheel).hexdigest()}).encode()
    monkeypatch.setattr(updates, 'fetch', fetch)
    monkeypatch.setattr('jaunt.cli.control', lambda method: {'sessions': []})
    installed = []
    monkeypatch.setattr(updates.subprocess, 'run', lambda args, **k: (installed.append(k['env']['jaunt_VERSION']) or type('Result', (), {'returncode': 0})()))
    return tmp_path, served, requested, installed

def set_tag(root, tag):
    atomic_json(root/'installation.json', {**updates.installation(root), 'tag': tag})

def test_channel_installs_a_newer_candidate_of_its_own_channel_only(channel_release):
    root, served, requested, installed = channel_release
    set_tag(root, 'v0.1.0-beta.41.ch.moukrea.9.1')
    assert updates.update(automatic=True)['state'] == 'installed'
    assert requested[0] == 'https://example.test/jaunt/ch/moukrea_9/config.json' and installed == ['v0.1.0-beta.41.ch.moukrea.9.2']
    assert (root/'updates/jaunt_host-0.1.0b41+ch.moukrea.9.2-py3-none-any.whl').exists()
    # A newer production release never reaches a host on a channel, automatic or manual.
    set_tag(root, 'v0.1.0-beta.41.ch.moukrea.9.2'); served['/ch/moukrea_9/config.json'] = channel_document(1)
    assert updates.update()['state'] == 'current' and updates.update(automatic=True)['state'] == 'current'
    assert len(installed) == 1

def test_production_host_does_not_follow_a_channel_without_a_switch(channel_release):
    root, _, _, installed = channel_release
    assert updates.update()['state'] == 'current' and not installed

def test_explicit_switch_installs_an_older_target_and_only_on_a_person_s_request(channel_release):
    root, served, _, installed = channel_release
    set_tag(root, 'v0.1.0-beta.42')
    served['/ch/moukrea_9/config.json'] = channel_document(1)
    assert updates.update(automatic=True, switch='moukrea_9')['state'] == 'current'
    assert updates.update(switch='other_1')['state'] == 'current'
    assert not installed
    result = updates.update(switch='moukrea_9')
    assert result['state'] == 'installed' and 'switch' not in result and installed == ['v0.1.0-beta.41.ch.moukrea.9.1']
    # Returning to main reinstalls production even when it sorts below the candidate.
    updates.configure(name='main'); set_tag(root, 'v0.1.0-beta.42.ch.moukrea.9.1')
    assert updates.update()['state'] == 'current'
    assert updates.update(switch='main')['state'] == 'installed' and installed[-1] == 'v0.1.0-beta.42'

def test_a_deferred_switch_keeps_its_switch_for_the_resume(channel_release, monkeypatch):
    root, _, _, installed = channel_release
    set_tag(root, 'v0.1.0-beta.42')
    monkeypatch.setattr('jaunt.cli.control', lambda method: {'sessions': [], 'activeTransfers': 1})
    result = updates.update(switch='moukrea_9')
    assert result['state'] == 'deferred' and result['switch'] == 'moukrea_9' and updates.status()['switch'] == 'moukrea_9'
    assert updates.update(automatic=True)['state'] == 'current' and 'switch' not in updates.status()

@pytest.mark.parametrize('patch', [{'page': 'https://evil.test/jaunt/'}, {'repository': 'evil/jaunt'}, {'channel': 'moukrea_12'},
                                   {'release': 'v0.1.0-beta.43'}, {'androidRelease': 'android-v0.1.0-beta.31.ch.moukrea.9.1'}])
def test_rejected_channel_document_downloads_nothing(channel_release, patch):
    root, served, requested, installed = channel_release
    served['/ch/moukrea_9/config.json'] = channel_document(2, **patch)
    set_tag(root, 'v0.1.0-beta.41.ch.moukrea.9.1')
    assert updates.update(switch='moukrea_9')['state'] == 'error'
    assert requested == ['https://example.test/jaunt/ch/moukrea_9/config.json'] and not installed

def test_removed_channel_keeps_the_installed_version(channel_release):
    root, served, _, installed = channel_release
    set_tag(root, 'v0.1.0-beta.41.ch.moukrea.9.2'); served['/ch/moukrea_9/config.json'] = None
    result = updates.update(switch='moukrea_9')
    assert result['state'] == 'channel-missing' and result['version'] == 'v0.1.0-beta.41.ch.moukrea.9.2' and not installed
    assert updates.installation(root)['channel'] == 'moukrea_9'
    served['/config.json'] = None; updates.configure(name='main')
    assert updates.update()['state'] == 'error'

def test_channel_setting_accepts_only_main_or_a_publishable_name(channel_release):
    for name in ('https://evil.test/', 'beta', 'main_9', 'moukrea', 'Moukrea_9', '../main', 7):
        with pytest.raises(ValueError):
            updates.configure(name=name)
    assert updates.configure(name='dev2_123456')['channel'] == 'dev2_123456'
    assert updates.configure(False)['channel'] == 'dev2_123456' and updates.status()['automatic'] is False
    assert updates.configure(name='main')['channel'] == 'main'

def test_existing_installations_are_on_main(release):
    assert updates.status()['channel'] == 'main'

@pytest.mark.asyncio
async def test_daemon_passes_a_switch_only_to_a_person_s_update(tmp_path, monkeypatch):
    from jaunt.daemon import Host
    from jaunt.state import State
    host = Host(State(tmp_path)); launched = []
    atomic_json(tmp_path/'installation.json', {'page': 'https://example.test', 'repository': 'moukrea/jaunt', 'tag': 'v0.1.0-beta.4', 'prefix': '', 'bin': ''})
    class Process:
        def poll(self): return 0
    monkeypatch.setattr('jaunt.daemon.subprocess.Popen', lambda args, **k: (launched.append(args) or Process()))
    host.launch_update(switch='moukrea_9'); host.launch_update(automatic=True, switch='moukrea_9')
    assert launched[0][-2:] == ['--switch', 'moukrea_9'] and '--switch' not in launched[1]
