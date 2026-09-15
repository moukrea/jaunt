const fs=require('node:fs');
const {join}=require('node:path');
const languages=new Set(['en','fr','es','it','pt','de']);
function language(app){
  let value='system';
  try{value=JSON.parse(fs.readFileSync(join(app.getPath('userData'),'language.json'),'utf8')).language;}catch{}
  if(value==='system')value=app.getLocale().split(/[-_]/)[0];
  return languages.has(value)?value:'en';
}
module.exports={language};
