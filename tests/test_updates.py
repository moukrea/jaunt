import hashlib
import io
import json
import zipfile

import pytest
from jaunt import updates
from jaunt.state import atomic_json

@pytest.fixture
def release(tmp_path, monkeypatch):
    monkeypatch.setenv('JAUNT_STATE', str(tmp_path))
    atomic_json(tmp_path / 'installation.json', {'page': 'https://example.test/jaunt', 'repository': 'moukrea/jaunt', 'tag': 'v0.1.0-beta.4', 'automatic': True, 'prefix': str(tmp_path/'runtime'), 'bin': str(tmp_path/'bin')})
    content=io.BytesIO()
    with zipfile.ZipFile(content,'w') as z:z.writestr('jaunt/installer.sh', '#!/bin/sh\nexit 0\n')
    wheel=content.getvalue();name='jaunt_host-0.1.0b5-py3-none-any.whl'
    responses={'config.json':json.dumps({'release':'v0.1.0-beta.5'}).encode(), 'host-manifest.json':json.dumps({'schema':1,'wheel':name,'sha256':hashlib.sha256(wheel).hexdigest()}).encode(),name:wheel}
    monkeypatch.setattr(updates,'fetch',lambda url,maximum: responses[url.rsplit('/',1)[1]])
    return tmp_path,responses

def test_automatic_update_stages_but_never_kills_active_shell(release,monkeypatch):
    root,_=release
    monkeypatch.setenv('JAUNT_ALLOW_RESTART','1')
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

def test_idle_update_strips_inherited_restart_and_development_overrides(release,monkeypatch):
    monkeypatch.setenv('JAUNT_ALLOW_RESTART','1');monkeypatch.setenv('JAUNT_DEV_INSTALL','1')
    monkeypatch.setenv('JAUNT_RELEASE_BASE','https://attacker.invalid')
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[]})
    observed=[]
    def run(args,**kwargs):
        observed.append(kwargs['env']);return type('Result',(),{'returncode':0})()
    monkeypatch.setattr(updates.subprocess,'run',run)
    assert updates.update(automatic=True)['state']=='installed'
    assert len(observed)==1
    assert not {'JAUNT_ALLOW_RESTART','JAUNT_DEV_INSTALL','JAUNT_RELEASE_BASE'} & observed[0].keys()
    assert observed[0]['JAUNT_SKIP_PAIR']=='1'

def test_explicit_restart_is_distinct_from_automatic_update(release,monkeypatch):
    monkeypatch.setattr('jaunt.cli.control',lambda method:{'sessions':[{'alive':True,'tmux':False}]})
    observed=[]
    monkeypatch.setattr(updates.subprocess,'run',lambda args,**k:(observed.append(k['env']) or type('Result',(),{'returncode':0})()))
    assert updates.update(allow_restart=True)['state']=='installed'
    assert observed[0]['JAUNT_ALLOW_RESTART']=='1'

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
