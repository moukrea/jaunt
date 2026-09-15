"""Real PTY output must survive failures at the WebSocket send boundary."""
import asyncio
import json

import pytest
from websockets.exceptions import ConnectionClosedError

from jaunt.crypto import unb64
from jaunt.sessions import Sessions
from jaunt.transport import Transport


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [ConnectionClosedError(None, None), TimeoutError()])
async def test_interrupted_send_preserves_pty_output_and_replay(tmp_path, monkeypatch, failure):
    monkeypatch.setenv('SHELL', '/bin/sh')
    for name in ('ENV', 'BASH_ENV'):
        monkeypatch.delenv(name, raising=False)
    events = []
    failed = asyncio.Event()

    class Socket:
        armed = False
        closed = False

        async def send(self, raw):
            if self.armed:
                self.armed = False
                failed.set()
                raise failure
            events.append(json.loads(raw))

        async def close(self):
            self.closed = True

    async def noop(*_):
        pass

    transport = Transport({}, noop, noop)
    socket = Socket()
    transport.ws = socket
    transport.ready.set()

    async def send(peer, value):
        await transport.send(value)

    sessions = Sessions(send, noop, tmp_path)
    try:
        info = await sessions.create({'cwd': str(tmp_path)})
        sid = info['id']
        await sessions.attach('before', {'id': sid})
        socket.armed = True
        await sessions.write(sid, b"printf 'LOST_%s\\n' 'OUTPUT'\r")
        await asyncio.wait_for(failed.wait(), 5)
        await asyncio.sleep(.1)
        assert socket.closed and not transport.ready.is_set()
        assert not sessions.get(sid).pump.done()
        assert sessions.get(sid).alive

        sessions.detach('before')
        transport.ws = Socket()
        transport.ready.set()
        await sessions.attach('after', {'id': sid, 'after': 0})
        await sessions.write(sid, b"printf 'NEW_%s\\n' 'OUTPUT'\r")
        for _ in range(100):
            output = b''.join(unb64(e['data']) for e in events if e['type'] == 'terminal.output')
            if b'LOST_OUTPUT' in output and b'NEW_OUTPUT' in output:
                break
            await asyncio.sleep(.03)
        assert b'LOST_OUTPUT' in output and b'NEW_OUTPUT' in output
        assert sessions.get(sid).pid == info['pid']
        assert not sessions.get(sid).pump.done()
    finally:
        await sessions.shutdown()


@pytest.mark.asyncio
async def test_close_does_not_signal_exited_child_with_stale_alive_flag(tmp_path, monkeypatch):
    from jaunt.sessions import Session

    class ExitedChild:
        returncode = 0
        def poll(self):
            return self.returncode
        def wait(self, timeout=None):
            return self.returncode

    async def noop(*_):
        pass

    sessions = Sessions(noop, noop, tmp_path)
    session = Session('stale_child', 'exited', str(tmp_path), 987654, -1, 80, 24,
                      process=ExitedChild(), alive=True)
    sessions.items[session.id] = session

    def forbidden_signal(*_):
        raise AssertionError('An exited child process group must not be signalled')

    monkeypatch.setattr('os.killpg', forbidden_signal)
    await sessions.close(session.id)
    assert session.id not in sessions.items
