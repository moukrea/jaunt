"""Exercise the actual host authentication state machine, including QR races."""
import asyncio,time,json
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jaunt.daemon import Host,Peer
from jaunt.state import State
from jaunt.crypto import token,public_key,unb64,Channel,transcript,verify,proof

class Wire:
    def __init__(self):self.out={}
    async def route(self,peer,data):await self.out.setdefault(peer,asyncio.Queue()).put(data)
    async def send(self,data):pass
    async def receive(self,peer):return await asyncio.wait_for(self.out.setdefault(peer,asyncio.Queue()).get(),2)

async def begin(host,pair,device):
    route=token(12);peer=Peer(host,route);host.peers[route]=peer
    private=ec.generate_private_key(ec.SECP256R1())
    hello={'type':'hello','v':1,'auth':'pair','id':device,'pair':pair['p'],'nonce':token(),'pub':public_key(private)}
    await peer.queue.put(hello);first=await host.transport.receive(route)
    if first['type']=='error':return peer,None,first
    tx=transcript(host.state.data['room'],hello,first['nonce'],first['pub']);secret=unb64(pair['s'])
    assert verify(secret,'server',tx,first['mac'])
    channel=Channel(private,first['pub'],secret,tx,server=False)
    await peer.queue.put({'type':'proof','mac':proof(secret,'client',tx)})
    assert channel.open(await host.transport.receive(route))['type']=='pair.ready'
    return peer,channel,None

async def dispose(*peers):
    for peer in peers:
        peer.task.cancel()
    await asyncio.gather(*(peer.task for peer in peers),return_exceptions=True)

def new_pair(host):return json.loads(unb64(host.pair()['code'][7:]))

@pytest.mark.asyncio
async def test_pair_is_single_use(tmp_path):
    host=Host(State(tmp_path));host.transport=Wire();p=new_pair(host)
    first,c,_=await begin(host,p,token(16))
    try:
        await first.queue.put(c.seal({'type':'enroll','secret':token(),'name':'Test device'}))
        assert c.open(await host.transport.receive(first.routing_id))['type']=='welcome'
        second,c2,result=await begin(host,p,token(16))
        try:assert result['code']=='pair-expired';assert len(host.state.data['devices'])==1
        finally:await dispose(second)
    finally:await dispose(first)

@pytest.mark.asyncio
async def test_expired_pair_and_cap_limit(tmp_path):
    host=Host(State(tmp_path));host.transport=Wire();p=new_pair(host);host.state.data['pairs'][p['p']]['expires']=time.time()-1
    peer,_,result=await begin(host,p,token(16))
    try:assert result['code']=='pair-expired';assert not host.state.data['devices']
    finally:await dispose(peer)
    for _ in range(8):host.pair()
    assert len(host.state.data['pairs'])==5

@pytest.mark.asyncio
async def test_concurrent_pair_consumption(tmp_path):
    host=Host(State(tmp_path));host.transport=Wire();p=new_pair(host)
    a,ca,_=await begin(host,p,token(16));b,cb,_=await begin(host,p,token(16))
    try:
        await a.queue.put(ca.seal({'type':'enroll','secret':token(),'name':'A'}))
        await b.queue.put(cb.seal({'type':'enroll','secret':token(),'name':'B'}))
        results=[ca.open(await host.transport.receive(a.routing_id)),cb.open(await host.transport.receive(b.routing_id))]
        assert sorted(r['type'] for r in results)==['error','welcome']
        assert len(host.state.data['devices'])==1
    finally:await dispose(a,b)
