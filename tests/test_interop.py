import json,os,subprocess
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from jaunt.crypto import Channel,public_key,b64,verify
ROOT=Path(__file__).resolve().parents[1]
def test_webcrypto_to_python():
    key=ec.generate_private_key(ec.SECP256R1());secret=os.urandom(32);text='interop-transcript'
    value={'cmd':'printf','unicode':'été / 日本語 / 🐢','bytes':b64(os.urandom(2000))}
    p=subprocess.run(['node',str(ROOT/'tests/interop.mjs')],input=json.dumps({'public':public_key(key),'secret':b64(secret),'transcript':text,'value':value}),capture_output=True,text=True,check=True)
    result=json.loads(p.stdout)
    channel=Channel(key,result['public'],secret,text.encode(),server=True)
    assert channel.open(result['frame'])==value
    assert verify(secret,'client',text.encode(),result['mac'])
    # Return a host-encrypted frame and decrypt with the very same JS ephemeral key.
    frame=channel.seal({'answer':'host → browser','binary':b64(os.urandom(1000))})
    script="""
import fs from 'node:fs';import {channel,unb64,utf8} from './web/js/crypto.mjs';
const x=JSON.parse(fs.readFileSync(0,'utf8'));
const key=await crypto.subtle.importKey('jwk',x.key,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
const ch=await channel(key,x.public,unb64(x.secret),utf8(x.transcript));
console.log(JSON.stringify(await ch.open(x.frame)));
"""
    x={'key':result['key'],'public':public_key(key),'secret':b64(secret),'transcript':text,'frame':frame}
    p=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,input=json.dumps(x),capture_output=True,text=True,check=True)
    assert json.loads(p.stdout)['answer']=='host → browser'
