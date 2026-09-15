#!/usr/bin/env python3
"""Install a public release with a full /tmp or a curl write failure.

All storage failures are confined to disposable Docker containers. No personal
directory, host mount, or user service is modified.
"""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'jaunt-fedora-installer-storage-test'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--installer', type=Path, default=ROOT / 'install.sh')
    args = parser.parse_args()
    subprocess.run(['docker', 'build', '-t', IMAGE, '-'], input=(
        'FROM fedora:44\nRUN dnf -y install python3 && dnf clean all\n'),
        text=True, check=True, timeout=300)
    for scenario in ('full-tmp', 'curl-write-error'):
        command = r'''
set -euo pipefail
if [ "$1" = full-tmp ]; then
  dd if=/dev/zero of=/tmp/full bs=4096 count=1 status=none
else
  mkdir /wrappers
  printf '#!/bin/sh\nexec /usr/bin/curl "$@" > /dev/full\n' > /wrappers/curl
  chmod 755 /wrappers/curl
  export PATH="/wrappers:$PATH"
fi
bash /installer.sh
test "$(/root/.local/bin/jaunt --version)" = 0.1.0b5
/root/.local/bin/jaunt status > /var/tmp/jaunt-test-status.json
python3 - <<'PYVERIFY'
import json, pathlib
status=json.loads(pathlib.Path('/var/tmp/jaunt-test-status.json').read_text())
assert status['sessions'] == []
assert status['machine']['version'] == '0.1.0b5'
environment=pathlib.Path(f'/proc/{status["pid"]}/environ').read_bytes().split(b'\0')
assert not any(v.startswith(b'TMPDIR=') and b'.jaunt-install.' in v for v in environment)
assert not list((pathlib.Path.home()/'.local/share/jaunt').glob('.jaunt-install.*'))
PYVERIFY
/root/.local/bin/jaunt stop
echo "PASS: $1 public installation, live daemon, staging cleanup, no temporary environment leak"
'''
        subprocess.run([
            'docker', 'run', '--rm', '--tmpfs', '/tmp:rw,size=4096',
            '-v', f'{args.installer.resolve()}:/installer.sh:ro',
            '-e', 'JAUNT_NO_SERVICE=1', '-e', 'JAUNT_SKIP_PAIR=1',
            IMAGE, 'bash', '-c', command, 'test', scenario,
        ], check=True, timeout=600)


if __name__ == '__main__':
    main()
