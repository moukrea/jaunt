#!/usr/bin/env python3
"""Build a wheel, manifest and checksums. Run from a clean release checkout."""
from __future__ import annotations
import hashlib,json,subprocess,sys,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    out=ROOT/'dist';out.mkdir(exist_ok=True)
    (ROOT/'host/jaunt/installer.sh').write_bytes((ROOT/'install.sh').read_bytes())
    subprocess.run([sys.executable,'-m','pip','wheel','--no-deps','--no-build-isolation','--wheel-dir',str(out),str(ROOT)],check=True)
    wheels=sorted(out.glob('jaunt_host-*.whl'),key=lambda x:x.stat().st_mtime)
    wheel=wheels[-1]
    manifest={'schema':1,'wheel':wheel.name,'sha256':hashlib.sha256(wheel.read_bytes()).hexdigest(),'requiresPython':'>=3.11,<3.15'}
    (out/'host-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (out/'SHA256SUMS').write_text('\n'.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}' for p in [wheel,out/'host-manifest.json'])+'\n')
    print(wheel.name)
if __name__=='__main__':main()
