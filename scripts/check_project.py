#!/usr/bin/env python3
"""Check local JS imports, static resources, syntax and release configuration."""
from pathlib import Path
import ast,json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[1];WEB=ROOT/'web'
errors=[]
for p in (ROOT/'host').rglob('*.py'):
    try:ast.parse(p.read_text())
    except SyntaxError as e:errors.append(str(e))
for p in WEB.rglob('*.mjs'):
    r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
    if r.returncode:errors.append(r.stderr)
    for imp in re.findall(r'(?:from\s+|import\s*\()([\'\"])(\.[^\'\"]+)\1',p.read_text()):
        target=(p.parent/imp[1]).resolve()
        if not target.exists():
            if target.name=='jsqr.mjs' and '--source' in sys.argv:continue
            errors.append(f'Missing import: {p.relative_to(ROOT)} -> {imp[1]} (run npm run prepare-web)')
for ref in re.findall(r'(?:src|href)="(\./[^"#?]+)"',(WEB/'index.html').read_text()):
    if not (WEB/ref).exists():errors.append(f'Missing page asset: {ref}')
for file in ['README.md','SECURITY.md','LICENSE','DEPLOY_AGENT_PROMPT.md','docs/VALIDATION.md','install.sh','web/manifest.webmanifest','web/sw.js','web/config.json']:
    if not (ROOT/file).exists():errors.append(f'Missing {file}')
json.loads((WEB/'config.json').read_text());json.loads((WEB/'manifest.webmanifest').read_text())
subprocess.run(['bash','-n',str(ROOT/'install.sh')],check=True)
if errors:print('\n'.join(errors));sys.exit(1)
print('Project checks passed'+(' (source mode: optional build-time QR vendor not required)' if '--source' in sys.argv else ''))
