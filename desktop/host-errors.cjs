/** Only the actual failure belongs in UI feedback, never subprocess progress logs. */
function hostError(error){
 const text=String(error.stderr||error.message||'').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
 if(/plain shells are running|active ordinary shells/i.test(text))return 'The update is waiting for active shells. Your sessions are still running.';
 if(/File transfers are active/i.test(text))return 'The update is waiting for file transfers to finish.';
 if(error.code==='ENOENT')return 'The local host executable could not be found.';
 if(error.killed)return 'The local host action did not finish within the expected time.';
 const lines=text.split(/[\r\n]+/).map(s=>s.trim()).filter(s=>/^jaunt: /i.test(s)&&!s.includes('Installation failed during'));
 const cause=lines.at(-1)?.replace(/^jaunt: /i,'');
 return cause&&cause.length<=300?cause:'The local host action failed. Check the host connection and try again.';
}
module.exports={hostError};
