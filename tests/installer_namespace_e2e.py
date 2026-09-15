#!/usr/bin/env python3
"""Real public installation with curl in a separate filesystem namespace.

Requires Docker on Linux. Only curl runs in the Fedora container; Bash, Python
and the private installation live in a host temporary directory that curl cannot
see. No host directory or Docker socket is mounted into that container.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--installer', type=Path, default=ROOT / 'install.sh')
    args = parser.parse_args()
    docker = shutil.which('docker')
    assert docker, 'This real integration test requires Docker.'
    with tempfile.TemporaryDirectory(prefix='jaunt-confined-curl-') as temporary:
        root = Path(temporary)
        wrappers = root / 'wrappers'
        wrappers.mkdir()
        curl = wrappers / 'curl'
        curl.write_text('#!/bin/sh\nexec ' + shlex.quote(docker) +
                        ' run --rm --network host fedora:44 curl "$@"\n')
        curl.chmod(0o755)
        env = {k: v for k, v in os.environ.items()
               if not k.startswith('jaunt_') and k != 'PYTHONPATH'}
        env.update(PATH=f'{wrappers}:{os.environ["PATH"]}',
                   jaunt_PREFIX=str(root / 'runtime'),
                   jaunt_BIN_DIR=str(root / 'bin'),
                   jaunt_STATE=str(root / 'state'),
                   jaunt_NO_SERVICE='1', jaunt_SKIP_PAIR='1')
        executable = root / 'bin/jaunt'
        try:
            result = subprocess.run(['bash', str(args.installer)], env=env,
                                    timeout=600)
            assert result.returncode == 0, f'Installer exited {result.returncode}'
            status = json.loads(subprocess.check_output(
                [str(executable), 'status'], env=env, text=True, timeout=15))
            assert status['sessions'] == []
            python = root / 'runtime/current/bin/python'
            origin = subprocess.check_output(
                [str(python), '-c', 'import jaunt; print(jaunt.__file__)'],
                env=env, text=True, timeout=15).strip()
            assert Path(origin).resolve().is_relative_to(root / 'runtime/versions')
            installation = json.loads((root / 'state/installation.json').read_text())
            assert installation['automatic'] is True
            assert (root / 'state/host.json').is_file()
            subprocess.run([str(executable), '--version'], env=env, check=True)
            print('PASS: public wheel installed and daemon started while curl '
                  'cannot access the installer temporary directory.', flush=True)
        finally:
            if executable.exists():
                subprocess.run([str(executable), 'stop'], env=env,
                               capture_output=True, timeout=20)


if __name__ == '__main__':
    main()
