import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function validateInstallation(dir){
 const companionDir=path.resolve(dir),app=path.join(companionDir,'resources/app');
 const pkg=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));
 if(pkg.name!=='coopanion'||pkg.version!=='0.2.19')throw Error('此版本仅适配 Coopanion 0.2.19，请勿套用到其他版本。');
 for(const relative of ['Coopanion.exe','resources/app/node_modules/cortico-world-desktop-pet/web/pet-app.js'])if(!fs.existsSync(path.join(companionDir,relative)))throw Error('Coopanion 文件不完整：'+relative);
 return companionDir;
}
async function main(){
 if(process.platform!=='win32')throw Error('应用控制当前仅支持 Windows。');
 const i=process.argv.indexOf('--companion');if(i<0||!process.argv[i+1])throw Error('请使用 node scripts/setup.mjs --companion "Coopanion 所在文件夹"');
 const companionDir=validateInstallation(process.argv[i+1]);
 if(!fs.existsSync(path.join(root,'node_modules/electron/dist/electron.exe')))throw Error('请先在本目录执行 npm ci 安装运行依赖。');
 if(!fs.existsSync(path.join(root,'bridge/control-ui/index.html')))throw Error('请先执行 npm --prefix control-ui ci，然后 npm run build:voice。');
 if(process.argv.includes('--check')){console.log('文件与版本检查通过，未修改 Coopanion。');return;}
 fs.mkdirSync(path.join(root,'config'),{recursive:true});fs.writeFileSync(path.join(root,'config/runtime.json'),JSON.stringify({companionDir},null,2)+'\n');
 const {installIntegration}=await import('../install-integration.mjs');installIntegration();
 const endpoint='http://127.0.0.1:17788';
 const ready=async()=>{try{return (await fetch(endpoint+'/api/status',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}};
 if(!await ready()){const child=spawn(path.join(companionDir,'Coopanion.exe'),[],{cwd:companionDir,windowsHide:true,detached:true,stdio:'ignore'});child.on('error',e=>console.error(e.message));child.unref();}
 const deadline=Date.now()+60000;while(!await ready()){if(Date.now()>deadline)throw Error('请启动所选 Coopanion，并确认其内核端口为17788后重试。');await new Promise(r=>setTimeout(r,500));}
 // A local junction keeps the World entry anchored to the full extension source.
 const linkRoot=path.join(os.homedir(),'.coopanion-windows-control'),link=path.join(linkRoot,'bridge');fs.mkdirSync(linkRoot,{recursive:true});
 if(fs.existsSync(link)){if(fs.realpathSync(link)!==fs.realpathSync(path.join(root,'bridge')))throw Error('另一份桌面控制扩展已占用安装入口，请先从原管理页卸载它。');}
 else fs.symlinkSync(path.join(root,'bridge'),link,'junction');
 const response=await fetch(endpoint+'/api/extensions/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:link}),signal:AbortSignal.timeout(120000)}),result=await response.json();if(!response.ok)throw Error(result.error||'扩展安装未完成');
 console.log('扩展已注册。请在原管理页「World 扩展」启用 Windows 桌面生态，然后重启运行。所有应用权限均由你自己选择。');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
