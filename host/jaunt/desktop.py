"""Native renderer bridge. All local traffic stays on the account-private Unix socket."""
from __future__ import annotations
import asyncio
import sys
from .state import state_dir

async def bridge():
    reader, writer = await asyncio.open_unix_connection(str(state_dir() / 'control.sock'), limit=7_000_001)
    writer.write(b'{"method":"ui.connect"}\n')
    await writer.drain()
    incoming = asyncio.StreamReader(limit=200_001)
    transport, _ = await asyncio.get_running_loop().connect_read_pipe(lambda: asyncio.StreamReaderProtocol(incoming), sys.stdin.buffer)
    async def output():
        while line := await reader.readline():
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
    async def inputs():
        while line := await incoming.readline():
            if len(line) > 200_000:
                raise ValueError('Local UI frame too large')
            writer.write(line)
            await writer.drain()
    tasks = [asyncio.create_task(output()), asyncio.create_task(inputs())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        writer.close()
        await writer.wait_closed()
        transport.close()


def install_gui() -> 'Path':
    """Install the published desktop payload for this account, preserving app data."""
    import hashlib,json,os,platform,re,shutil,tarfile,tempfile,zipfile,subprocess,posixpath,stat
    from pathlib import Path
    from .updates import fetch,installation
    config=installation()
    page=config.get('page','https://moukrea.github.io/jaunt').rstrip('/')
    deployed=json.loads(fetch(page+'/config.json',65536))
    tag=deployed.get('desktopRelease','')
    if not re.fullmatch(r'desktop-v\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?',tag):
        raise ValueError('No desktop release is published for this deployment yet')
    system=platform.system()
    if system not in ('Linux','Darwin'):raise ValueError('Desktop host integration requires Linux or macOS')
    arch={'x86_64':'x64','aarch64':'arm64','arm64':'arm64'}.get(platform.machine())
    if not arch:raise ValueError('No desktop build is available for this CPU')
    # Ubuntu's restricted user namespaces cannot run an unprivileged Electron
    # archive. Install the verified distribution package so its scoped
    # AppArmor profile and sandbox helper are configured by the package manager.
    restricted=Path('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
    if system=='Linux' and restricted.exists() and restricted.read_text().strip()=='1':
        return install_linux_package(tag, arch)
    extension='tar.gz' if system=='Linux' else 'zip'
    name=f'jaunt-desktop-{tag.removeprefix("desktop-v")}-{arch}.{extension}'
    base=f'https://github.com/moukrea/jaunt/releases/download/{tag}'
    checks={row.split('  ',1)[1]:row.split('  ',1)[0] for row in fetch(base+'/SHA256SUMS',65536).decode().splitlines() if '  ' in row}
    digest=checks.get(name,'')
    if not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('Desktop checksum is missing')
    root=Path.home()/'.local/share/jaunt-desktop';root.mkdir(parents=True,exist_ok=True)
    destination=root/tag
    binary=Path('jaunt-desktop') if system=='Linux' else Path('jaunt.app/Contents/MacOS/jaunt')
    if not (destination/binary).is_file():
        print('jaunt: Downloading the verified desktop app…',flush=True)
        with tempfile.TemporaryDirectory(prefix='.install-',dir=root) as temp:
            stage=Path(temp);payload=fetch(base+'/'+name,350*1024*1024)
            if hashlib.sha256(payload).hexdigest()!=digest:raise ValueError('Desktop checksum mismatch')
            archive=stage/'desktop.tar.gz';archive.write_bytes(payload);del payload
            if system=='Linux':
                with tarfile.open(archive) as tar:
                    members=tar.getmembers()
                    if sum(m.size for m in members)>1024*1024*1024:raise ValueError('Desktop archive is too large')
                    tar.extractall(stage/'unpacked',filter='data')
                folders=list((stage/'unpacked').iterdir())
                if len(folders)!=1 or not (folders[0]/binary).is_file():raise ValueError('Desktop archive has an unexpected layout')
                extracted=folders[0]
            else:
                with zipfile.ZipFile(archive) as zipped:
                    if sum(m.file_size for m in zipped.infolist())>1024*1024*1024:raise ValueError('Desktop archive is too large')
                    for member in zipped.infolist():
                        name=Path(member.filename)
                        if name.is_absolute() or '..' in name.parts:raise ValueError('Unsafe desktop archive path')
                        if stat.S_ISLNK(member.external_attr >> 16):
                            target=zipped.read(member).decode()
                            resolved=posixpath.normpath(str(name.parent/target))
                            if '\0' in target or target.startswith('/') or resolved=='..' or resolved.startswith('../'):
                                raise ValueError('Unsafe desktop archive link')
                extracted=stage/'unpacked';extracted.mkdir()
                subprocess.run(['ditto','-x','-k',str(archive),str(extracted)],check=True)
                if not (extracted/binary).is_file():raise ValueError('Desktop archive has an unexpected layout')
            if destination.exists():raise ValueError('Desktop destination already exists but is incomplete')
            os.rename(extracted,destination)
    pointer=root/'current.new'
    pointer.unlink(missing_ok=True);pointer.symlink_to(destination);os.replace(pointer,root/'current')
    if system=='Darwin':
        applications=Path.home()/'Applications';applications.mkdir(exist_ok=True)
        shortcut=applications/'jaunt.app'
        if shortcut.is_symlink():shortcut.unlink()
        if not shortcut.exists():shortcut.symlink_to(root/'current/jaunt.app')
        print('jaunt: Desktop app installed in Applications.',flush=True)
        return root/'current'/binary
    icon=root/'icon.png'
    # This is the original supplied artwork, shipped separately from the asar.
    shutil.copyfile(destination/'resources/jaunt.png',icon)
    icon.chmod(0o644)
    applications=Path.home()/'.local/share/applications';applications.mkdir(parents=True,exist_ok=True)
    exe=root/'current/jaunt-desktop'
    quoted=str(exe).replace('%','%%').replace('\\','\\\\').replace('"','\\"').replace('`','\\`').replace('$','\\$')
    (applications/'dev.jaunt.desktop.desktop').write_text(f'[Desktop Entry]\nType=Application\nName=jaunt\nComment=Shared local and remote shells\nExec="{quoted}"\nIcon={icon}\nTerminal=false\nCategories=System;TerminalEmulator;\nStartupWMClass=jaunt\n')
    if shutil.which('update-desktop-database'):
        subprocess.run(['update-desktop-database',str(applications)],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print('jaunt: Desktop app installed. Open jaunt from your applications menu.',flush=True)
    return exe


def install_linux_package(tag: str, arch: str):
    """Use the system package on Linux hosts that restrict Chromium namespaces."""
    import hashlib, os, re, shutil, subprocess, tempfile
    from pathlib import Path
    from .updates import fetch
    apt=shutil.which('apt-get')
    if not apt:
        raise RuntimeError('This Linux security policy requires a system desktop package; no supported package manager was found.')
    name=f'jaunt-desktop-{tag.removeprefix("desktop-v")}-{"amd64" if arch=="x64" else "arm64"}.deb'
    base=f'https://github.com/moukrea/jaunt/releases/download/{tag}'
    checks=dict(row.split('  ',1)[::-1] for row in fetch(base+'/SHA256SUMS',65536).decode().splitlines() if '  ' in row)
    expected=checks.get(name,'')
    if not re.fullmatch('[0-9a-f]{64}',expected):raise ValueError('Desktop package checksum is missing')
    print('jaunt: Installing the Ubuntu desktop package with its sandbox support. Your system may ask for an administrator password.',flush=True)
    payload=fetch(base+'/'+name,350*1024*1024)
    if hashlib.sha256(payload).hexdigest()!=expected:raise ValueError('Desktop package checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='jaunt-desktop-',dir='/tmp') as folder:
        directory=Path(folder);directory.chmod(0o755)
        package=directory/name;package.write_bytes(payload);package.chmod(0o644)
        command=[apt,'install','-y',str(package)]
        if os.geteuid()!=0:
            elevate=shutil.which('pkexec') or shutil.which('sudo')
            if not elevate:raise RuntimeError('Installing the desktop sandbox requires pkexec or sudo.')
            command.insert(0,elevate)
        subprocess.run(command,check=True)
    # An older per-account archive entry would shadow the working system entry.
    shortcut=Path.home()/'.local/share/applications/dev.jaunt.desktop.desktop'
    if shortcut.is_file() and '.local/share/jaunt-desktop/' in shortcut.read_text():
        shortcut.unlink()
    return Path('/usr/bin/jaunt-desktop')
