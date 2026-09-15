// Release permissions must not depend on a maintainer's private umask.
const fs=require('node:fs/promises');
const path=require('node:path');
module.exports=async({appOutDir})=>{
  async function walk(file){
    const info=await fs.lstat(file);
    if(info.isSymbolicLink())return;
    if(info.isDirectory()){
      await fs.chmod(file,0o755);
      for(const entry of await fs.readdir(file))await walk(path.join(file,entry));
    }else if(info.isFile())await fs.chmod(file,info.mode&0o111?0o755:0o644);
  }
  await walk(appOutDir);
};
