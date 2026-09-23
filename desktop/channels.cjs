// The update-channel contract as the desktop applies it (docs/UPDATES.md#update-channels).
// A reimplementation of scripts/update_channels.py; tests/desktop_updates.test.cjs proves it agrees with tests/fixtures/update_channels.json.
const OFFICIAL=Object.freeze({page:'https://moukrea.github.io/jaunt/',repository:'moukrea/jaunt'});
const PREFIX={host:'v',desktop:'desktop-v',android:'android-v'};
const RESERVED=new Set(['main','beta']);
const DEV='[a-z][a-z0-9]{0,31}',COUNT='[1-9][0-9]{0,5}';
const NAME=new RegExp(`^${DEV}(?:_${COUNT})?$`);
const PRODUCTION=/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
const CANDIDATE=new RegExp(`^(\\d+)\\.(\\d+)\\.(\\d+)-(alpha|beta|rc)\\.(\\d+)\\.ch\\.(${DEV})\\.(${COUNT})\\.(${COUNT})$`);
const STAGE={alpha:0,beta:1,rc:2,undefined:3};
const SOURCE=/^[0-9a-f]{40}$/;
const DOCUMENT={host:'release',desktop:'desktopRelease',android:'androidRelease'};
class NotComparable extends Error {}
const validName=name=>typeof name==='string'&&NAME.test(name);
// Only a per-PR sub-channel of a non-reserved developer may be published.
const publishable=name=>validName(name)&&name.includes('_')&&!RESERVED.has(name.split('_')[0]);
function parse(tag){
  for(const [component,prefix] of Object.entries(PREFIX)){
    if(typeof tag!=='string'||!tag.startsWith(prefix))continue;
    const rest=tag.slice(prefix.length);
    let m=PRODUCTION.exec(rest);
    if(m)return {component,key:[+m[1],+m[2],+m[3],STAGE[m[4]],+(m[5]||0)],base:tag,channel:null,n:0};
    m=CANDIDATE.exec(rest);
    if(m&&!RESERVED.has(m[6]))return {component,key:[+m[1],+m[2],+m[3],STAGE[m[4]],+m[5]],base:`${prefix}${m[1]}.${m[2]}.${m[3]}-${m[4]}.${m[5]}`,channel:`${m[6]}_${m[7]}`,n:+m[8]};
    break;
  }
  throw new Error('Unsupported release version');
}
// -1, 0 or 1; throws NotComparable across components or between two channels.
function compare(a,b){
  const x=parse(a),y=parse(b);
  if(x.component!==y.component||(x.channel&&y.channel&&x.channel!==y.channel))throw new NotComparable(`${a} and ${b} are not ordered`);
  const left=[...x.key,x.channel?1:0,x.n],right=[...y.key,y.channel?1:0,y.n];
  for(let i=0;i<left.length;i++)if(left[i]!==right[i])return left[i]<right[i]?-1:1;
  return 0;
}
// Whether an unattended check on `channel` may install `target` over `current`; only an explicit channel change installs anything else.
function automatic(channel,current,target){
  const x=parse(current),y=parse(target);
  if(x.component!==y.component)return false;
  if(channel==='main')return y.channel===null&&compare(current,target)<0;
  return x.channel===channel&&y.channel===channel&&compare(current,target)<0;
}
function validateDocument(document,name,page=OFFICIAL.page,repository=OFFICIAL.repository){
  if(!publishable(name))throw new Error('Reserved or invalid channel name has no channel document');
  if(!document||typeof document!=='object'||document.version!==1||document.channel!==name)throw new Error('Channel document does not describe the requested channel');
  if(document.page!==page||document.repository!==repository)throw new Error('Channel document is not from the official Page and repository');
  if(typeof document.releaseSource!=='string'||!SOURCE.test(document.releaseSource))throw new Error('Channel document has no verified release source');
  const counts=new Set();
  for(const [component,field] of Object.entries(DOCUMENT)){
    const info=parse(document[field]);
    if(info.component!==component||info.channel!==name)throw new Error(`${field} is not a ${component} candidate of ${name}`);
    counts.add(info.n);
  }
  if(counts.size!==1)throw new Error('Channel components come from different candidates');
  return document;
}
module.exports={OFFICIAL,NotComparable,validName,publishable,parse,compare,automatic,validateDocument};
