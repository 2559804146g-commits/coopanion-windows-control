import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import runtime from '../runtime-paths.cjs';
if(process.platform!=='win32')throw Error('当前只支持 Windows。');
if(!fs.existsSync(runtime.appPackage))throw Error('请先按 README 安装并选择 Coopanion。');
const url='http://127.0.0.1:17788/api/webui/providers/world%3Adesktop-pet/panels/pet/openSettings';
const open=async()=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"args":[]}',signal:AbortSignal.timeout(2000)});return r.ok;};
try{if(!await open())throw Error('尚未就绪');}
catch{const child=spawn(path.join(runtime.companionDir,'Coopanion.exe'),[],{cwd:runtime.companionDir,windowsHide:true,detached:true,stdio:'ignore'});child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.unref();const deadline=Date.now()+45000;let opened=false;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,500));try{if(await open()){opened=true;break;}}catch{}}if(!opened)throw Error('请从 Coopanion 托盘打开设置，确认安装扩展后重启过原程序。');}
