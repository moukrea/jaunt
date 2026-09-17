"""Bootstrap regressions: simulate network failures, never touch a real host."""
import os
from pathlib import Path
import re
import subprocess
import http.server
import threading

ROOT = Path(__file__).resolve().parents[1]


def run_installer(tmp_path, curl_body):
    fake_bin = tmp_path / 'bin'
    fake_bin.mkdir()
    curl = fake_bin / 'curl'
    curl.write_text('#!/bin/bash\n' + curl_body)
    curl.chmod(0o755)
    env = {k: v for k, v in os.environ.items() if not k.startswith('jaunt_')}
    env.update(PATH=f'{fake_bin}:{os.environ["PATH"]}',
               jaunt_PREFIX=str(tmp_path / 'runtime'),
               jaunt_BIN_DIR=str(tmp_path / 'installed-bin'),
               jaunt_STATE=str(tmp_path / 'state'))
    result = subprocess.run(['bash', str(ROOT / 'install.sh')], env=env,
                            capture_output=True, text=True, timeout=10)
    assert not (tmp_path / 'runtime').exists()
    assert not (tmp_path / 'state').exists()
    return result


def test_network_failure_is_visible_and_retried_over_ipv4(tmp_path):
    result = run_installer(tmp_path, 'echo "CURL_CALL $*" >&2\nexit 7\n')
    assert result.returncode == 7
    assert 'Starting installation' in result.stdout
    assert 'retrying over IPv4' in result.stderr
    assert '--ipv4' in result.stderr
    assert result.stderr.count('CURL_CALL') == 2
    assert 'Installation failed during' in result.stderr


def test_http_failure_is_not_retried_or_reported_as_success(tmp_path):
    result = run_installer(tmp_path, 'echo CURL_CALL >&2\nexit 22\n')
    assert result.returncode == 22
    assert result.stderr.count('CURL_CALL') == 1
    assert 'Installation failed during' in result.stderr


def test_official_command_propagates_download_failure(tmp_path):
    # With the previous `curl ... | bash`, this returns 0: bash accepts empty stdin.
    command = re.search(r'<code id="install-command">([^<]+)</code>',
                        (ROOT / 'web/index.html').read_text()).group(1)
    assert command in (ROOT / 'README.md').read_text()
    curl = tmp_path / 'curl'
    curl.write_text('#!/bin/sh\necho "HTTP download failed" >&2\nexit 22\n')
    curl.chmod(0o755)
    result = subprocess.run(['bash', '-c', command],
                            env={**os.environ, 'PATH': f'{tmp_path}:{os.environ["PATH"]}'},
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 22
    assert 'HTTP download failed' in result.stderr


def test_official_command_ignores_curlrc_output_redirection(tmp_path):
    # A real curl configuration can swallow the script instead of feeding bash.
    # Exercise real curl and bash against a loopback HTTP fixture, not the network.
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = b'echo jaunt_BOOTSTRAP_EXECUTED\n'
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    redirected = tmp_path / 'swallowed-script'
    (tmp_path / '.curlrc').write_text(f'output = "{redirected}"\n')
    command = re.search(r'<code id="install-command">([^<]+)</code>',
                        (ROOT / 'web/index.html').read_text()).group(1)
    command = command.replace('https://moukrea.github.io/jaunt/install.sh',
                              f'http://127.0.0.1:{server.server_port}/install.sh')
    try:
        result = subprocess.run(['bash', '-c', command],
                                env={**os.environ, 'CURL_HOME': str(tmp_path),
                                     'NO_PROXY': '127.0.0.1', 'no_proxy': '127.0.0.1'},
                                capture_output=True, text=True, timeout=10)
        assert result.returncode == 0
        assert 'jaunt_BOOTSTRAP_EXECUTED' in result.stdout
        assert not redirected.exists()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

def test_prune_keeps_the_runtime_the_live_daemon_executes(tmp_path):
    """A failed handoff leaves the daemon on an older runtime; pruning must never remove it."""
    import re,subprocess,os,json,time,sys
    from pathlib import Path
    src=(Path(__file__).resolve().parents[1]/'install.sh').read_text()
    snippet=re.search(r"<<'PYPRUNE' \|\| true\n(.*?)PYPRUNE",src,re.S).group(1)
    prefix=tmp_path/'runtime';state=tmp_path/'state';state.mkdir()
    for i,tag in enumerate(['v1-old','v2-running','v3-prev','v4-current']):
        d=prefix/'versions'/tag;(d/'bin').mkdir(parents=True);(d/'bin/python').write_text('');os.utime(d,(time.time()-100+i*10,)*2)
    (prefix/'current').symlink_to(prefix/'versions'/'v4-current')
    (state/'runtime.json').write_text(json.dumps({'pid':os.getpid(),'runtime':str(prefix/'versions/v2-running/bin/python')}))
    subprocess.run([sys.executable,'-',str(prefix),str(state)],input=snippet,text=True,check=True)
    assert sorted(p.name for p in (prefix/'versions').iterdir())==['v2-running','v3-prev','v4-current']
    # A dead daemon's record does not pin anything.
    (state/'runtime.json').write_text(json.dumps({'pid':2**22-1,'runtime':str(prefix/'versions/v2-running/bin/python')}))
    subprocess.run([sys.executable,'-',str(prefix),str(state)],input=snippet,text=True,check=True)
    assert sorted(p.name for p in (prefix/'versions').iterdir())==['v3-prev','v4-current']
