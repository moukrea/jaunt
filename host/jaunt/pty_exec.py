"""Small fresh-process PTY bootstrap; never run Python callbacks after fork.

Launched by subprocess.Popen(start_new_session=True), with the PTY slave as
stdin/out/err. Acquiring the controlling terminal in this fresh interpreter keeps
PTY setup away from the daemon's threads (DNS/push workers).
"""
from __future__ import annotations
import fcntl
import os
import signal
import sys
import termios


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(64)
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGPIPE):
        signal.signal(sig, signal.SIG_DFL)
    try:
        os.execvp(sys.argv[1], sys.argv[1:])
    except OSError as exc:
        print(f'Cannot start shell: {exc}', file=sys.stderr)
        raise SystemExit(127)


if __name__ == '__main__':
    main()
