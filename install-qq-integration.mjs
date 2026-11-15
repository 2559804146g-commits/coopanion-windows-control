import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import runtimePaths from './runtime-paths.cjs';
const root=path.dirname(fileURLToPath(import.meta.url)),pkg=path.join(runtimePaths.companionDir,'data/extensions/node_modules/cortico-world-qqbot'),backup=path.join(root,'integration-backups/qqbot-0.4.2');
export function installQQIntegration(){
 if(!fs.existsSync(pkg))return {available:false};if(JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8')).version!=='0.4.2')throw Error('QQ模块版本已变化，保留原文件并重新核对适配');
 const file=path.join(pkg,'src/world.ts'),helper=path.join(pkg,'src/desktop-ecology-reply.mjs'),saved=path.join(backup,'world.ts');fs.mkdirSync(backup,{recursive:true});const current=fs.readFileSync(file,'utf8'),marker='// desktop-ecology QQ delivery 0.9.0';
 if(!fs.existsSync(saved)){if(current.includes(marker))throw Error('QQ钩子缺少原版备份');fs.writeFileSync(saved,current);}
 const originalRaw=fs.readFileSync(saved,'utf8'),original=originalRaw.replace(/\r\n/g,'\n');const source="    return qqOfficialTools(this.language, (action, args, signal) => this.enqueue(async () => {";
 const end="    }));\n  }\n\n  /** Model-facing arguments";
 if(!original.includes(source)||!original.includes(end))throw Error('QQ模块工具接口变化，未写入');
 const adapter=`\nimport {readFileSync} from 'node:fs';\nconst bridgeRoot=${JSON.stringify(root)};\nasync function call(data,signal){const r=await fetch('http://127.0.0.1:17830/api/action',{method:'POST',headers:{'Content-Type':'application/json','x-desktop-token':readFileSync(bridgeRoot+'/data/bridge-token','utf8').trim()},body:JSON.stringify(data),signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(data.action==='reply-render'?90000:10000)])});const v=await r.json();if(!r.ok)throw Error(v.error);return v;}\nexport const wrap=(tools,host)=>wrapQQTools(tools,host,call);\n`;
 const body=fs.readFileSync(path.join(root,'integration/qq-reply.mjs'),'utf8')+adapter;
 const next=marker+"\nimport {wrap as wrapDesktopReplies} from './desktop-ecology-reply.mjs';\n"+original.replace(source,source.replace('return qqOfficialTools','const baseTools = qqOfficialTools')).replace(end,"    }));\n    return wrapDesktopReplies(baseTools,()=>this.host);\n  }\n\n  /** Model-facing arguments");
 const manifestFile=path.join(backup,'manifest.json');if(current!==originalRaw&&current!==next){const known=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')).patchedSha256:null;if(createHash('sha256').update(current).digest('hex')!==known)throw Error('QQ模块有其它修改，停止覆盖');}
 fs.writeFileSync(helper,body);fs.writeFileSync(file,next);fs.writeFileSync(manifestFile,JSON.stringify({originalSha256:createHash('sha256').update(original).digest('hex'),patchedSha256:createHash('sha256').update(next).digest('hex')},null,2));return {available:true,changed:current!==next};
}
