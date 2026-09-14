#!/usr/bin/env python3
"""Loopback-only reference relay for integration tests and local development.

Production uses relay/worker.mjs. This process deliberately has no public bind
option, no TLS, and does not persist routing identities across restarts.
"""
import asyncio
import hashlib
import json
import secrets
from aiohttp import web, WSMsgType

rooms = {}


async def health(request):
    return web.json_response({"ok": True, "service": "jaunt-relay-dev", "protocol": 1})


async def room(request):
    rid = request.match_info['room']
    entry = rooms.setdefault(rid, {"host": None, "clients": {}, "auth": None})
    ws = web.WebSocketResponse(max_msg_size=132000, heartbeat=30)
    await ws.prepare(request)
    role, cid = "pending", secrets.token_hex(16)
    async def emit(target, value):
        if target is not None and not target.closed:
            await target.send_json(value)
    try:
        message = await asyncio.wait_for(ws.receive(), 20)
        m = json.loads(message.data)
        if m.get('type') != 'auth':
            await ws.close(code=1008)
            return ws
        hashed = hashlib.sha256(m.get('token', '').encode()).hexdigest()
        if m.get('role') == 'host':
            client_hash = hashlib.sha256(m.get('clientToken', '').encode()).hexdigest()
            auth = (hashed, client_hash)
            if entry['auth'] and entry['auth'] != auth:
                await ws.close(code=1008)
                return ws
            entry['auth'] = auth
            if entry['host'] is not None:
                await entry['host'].close(code=4001)
            entry['host'] = ws
            role = 'host'
            await emit(ws, {"type": "ready"})
            for key, client in tuple(entry['clients'].items()):
                await emit(ws, {"type": "peer.joined", "peer": key})
                await emit(client, {"type": "host.online"})
        elif m.get('role') == 'client' and entry['auth'] and entry['auth'][1] == hashed:
            role = 'client'
            entry['clients'][cid] = ws
            await emit(ws, {"type": "ready", "peer": cid, "hostOnline": entry['host'] is not None})
            await emit(entry['host'], {"type": "peer.joined", "peer": cid})
        else:
            await ws.close(code=1008)
            return ws
        async for message in ws:
            if message.type != WSMsgType.TEXT:
                continue
            if message.data == 'ping':
                await ws.send_str('pong')
                continue
            m = json.loads(message.data)
            if m.get('type') == 'route':
                if role == 'host':
                    await emit(entry['clients'].get(m.get('to')), {"type": "route", "data": m.get('data')})
                elif entry['host'] is not None:
                    await emit(entry['host'], {"type": "route", "from": cid, "data": m.get('data')})
                else:
                    await emit(ws, {"type": "host.offline"})
            elif m.get('type') == 'disconnect' and role == 'host':
                client = entry['clients'].get(m.get('to'))
                if client is not None:
                    await client.close(code=4002)
    finally:
        if role == 'host' and entry['host'] is ws:
            entry['host'] = None
            for client in tuple(entry['clients'].values()):
                await emit(client, {"type": "host.offline"})
        elif role == 'client':
            entry['clients'].pop(cid, None)
            await emit(entry['host'], {"type": "peer.left", "peer": cid})
    return ws


app = web.Application()
app.router.add_get('/health', health)
app.router.add_get('/v1/room/{room}', room)
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=8787)
    web.run_app(app, host='127.0.0.1', port=parser.parse_args().port, print=None)
