#!/usr/bin/env python3
"""Run a complete local workspace: real PTYs, loopback relay, static web app.

python scripts/dev.py --no-browser
Never expose this development HTTP server to a public interface.
"""
from __future__ import annotations
import argparse, functools, http.server, json, os, subprocess, sys, threading, time, webbrowser
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--relay-port', type=int, default=8787)
    parser.add_argument('--state', type=Path, default=ROOT / '.dev-state')
    args = parser.parse_args(); args.state.mkdir(mode=0o700, parents=True, exist_ok=True)
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'host'), 'jaunt_STATE': str(args.state.resolve())}
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_): pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store'); self.send_header('X-Content-Type-Options', 'nosniff'); super().end_headers()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(Handler, directory=str(ROOT / 'web')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log = (args.state / 'development.log').open('a')
    relay = subprocess.Popen([sys.executable, str(ROOT / 'scripts/dev_relay.py'), '--port', str(args.relay_port)], env=env, stdout=log, stderr=log)
    def cli(*values, capture=False):
        return subprocess.run([sys.executable, '-m', 'jaunt.cli', *values], env=env, check=True, text=True, capture_output=capture, cwd=ROOT)
    host = None
    try:
        cli('init', '--relay', f'ws://127.0.0.1:{args.relay_port}', '--page', f'http://127.0.0.1:{args.port}/', '--name', 'jaunt · local development', capture=True)
        host = subprocess.Popen([sys.executable, '-m', 'jaunt.cli', 'daemon'], env=env, stdout=log, stderr=log, cwd=ROOT)
        for _ in range(100):
            if (args.state / 'control.sock').exists(): break
            if host.poll() is not None: raise RuntimeError('Host exited; read development.log')
            time.sleep(.1)
        result = json.loads(cli('pair', '--json', capture=True).stdout)
        print(f'\njaunt development workspace: http://127.0.0.1:{args.port}/\n', flush=True)
        print('Pairing link (one use, ten minutes; do not publish):\n' + result['url'], flush=True)
        print('\nCtrl+C stops the development host and its plain shells.\n', flush=True)
        if not args.no_browser: webbrowser.open(result['url'])
        while host.poll() is None and relay.poll() is None: time.sleep(1)
    except KeyboardInterrupt: pass
    finally:
        for proc in [host, relay]:
            if proc and proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()
        server.shutdown(); log.close()
if __name__ == '__main__': main()
