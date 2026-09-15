"""Foreground icons follow real PTY jobs, not user labels or command arguments."""
import asyncio
import shlex
import shutil

import pytest

from jaunt.sessions import Sessions, classify_program


@pytest.mark.parametrize(('command', 'expected'), [
    ('/usr/local/bin/claude', 'claude'),
    ('/opt/codex/bin/codex --resume', 'codex'),
    ('node /opt/@anthropic-ai/claude-code/cli.js', 'claude'),
    ('node /opt/@openai/codex/bin/codex.js', 'codex'),
    ('echo claude', ''), ('vim codex', ''), ('sh -c claude', ''),
    ('node unrelated.js claude', ''), ('sleep 20', ''),
])
def test_classification(command, expected):
    assert classify_program(command) == expected


@pytest.mark.asyncio
async def test_foreground_job_and_return_to_shell(tmp_path, monkeypatch):
    monkeypatch.setenv('SHELL', '/bin/sh')
    async def noop(*args): pass
    sessions = Sessions(noop, noop, tmp_path)
    try:
        row = await sessions.create({'cwd': str(tmp_path), 'name': 'claude'})
        session = sessions.get(row['id'])
        await sessions.refresh_programs()
        assert session.program == ''  # A friendly name is not a running program.
        for name in ('claude', 'codex'):
            executable = tmp_path / name
            shutil.copy2(shutil.which('sleep'), executable)
            await sessions.write(session.id, (shlex.quote(str(executable)) + ' 30\n').encode())
            for _ in range(50):
                await sessions.refresh_programs()
                if session.program == name: break
                await asyncio.sleep(.05)
            assert session.info()['program'] == name
            await sessions.write(session.id, b'\x03')
            for _ in range(50):
                await sessions.refresh_programs()
                if session.program == '': break
                await asyncio.sleep(.05)
            assert session.program == ''
            assert session.alive
    finally:
        await sessions.shutdown()
