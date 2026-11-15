const fs=require('node:fs'),path=require('node:path');
function resolvePaths(root=__dirname,env=process.env){
 const file=path.join(root,'config/runtime.json');let config={};
 if(fs.existsSync(file)){config=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof config.companionDir!=='string')throw Error('请重新运行安装脚本，选择 Coopanion 文件夹');}
 const companionDir=path.resolve(root,env.COOPANION_DIR||config.companionDir||'../Coopanion-0.2.19');
 const candidates=[path.join(root,'node_modules/electron/dist/electron.exe'),path.resolve(root,'../生活空间/node_modules/electron/dist/electron.exe')];
 const appPackage=path.join(companionDir,'resources/app/package.json');
 return {companionDir,appPackage,dependencyPackage:fs.existsSync(appPackage)?appPackage:path.join(root,'package.json'),petWeb:path.join(companionDir,'resources/app/node_modules/cortico-world-desktop-pet/web'),electron:candidates.find(p=>fs.existsSync(p))||candidates[0]};
}
module.exports={...resolvePaths(),resolvePaths};
