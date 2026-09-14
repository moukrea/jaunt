import fs from 'node:fs';
import {ephemeral, channel,unb64,b64,utf8,proof,verify} from '../web/js/crypto.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const e=await ephemeral(),ch=await channel(e.privateKey,input.public,unb64(input.secret),utf8(input.transcript));
const frame=await ch.seal(input.value);
const key=await crypto.subtle.exportKey('jwk',e.privateKey);
console.log(JSON.stringify({public:e.publicKey,key,frame,mac:await proof(unb64(input.secret),'client',utf8(input.transcript))}));
