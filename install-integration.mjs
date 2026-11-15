import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import runtimePaths from './runtime-paths.cjs';
const root=path.dirname(fileURLToPath(import.meta.url)),web=runtimePaths.petWeb;
const backup=path.join(root,'integration-backups/Coopanion-0.2.19'),marker='// desktop-ecology integration 0.8.0';
const replace=(s,a,b)=>{if(!s.includes(a))throw Error('原版接口发生变化，已保留原文件：'+a.slice(0,40));return s.replace(a,b);};
export function installIntegration(){
 fs.mkdirSync(backup,{recursive:true});const manifest=[],writes=[];let changed=false;
 const patch=(relative,edit)=>{
  const file=path.resolve(web,relative),saved=path.join(backup,relative.startsWith('../')?relative.slice(3):relative),current=fs.readFileSync(file,'utf8');
  if(!file.startsWith(path.dirname(web)+path.sep)||!saved.startsWith(backup+path.sep))throw Error('集成文件路径越界');
  if(!fs.existsSync(saved)){if(current.includes(marker))throw Error('缺少原版备份，停止修改');fs.mkdirSync(path.dirname(saved),{recursive:true});fs.writeFileSync(saved,current);}
  const original=fs.readFileSync(saved,'utf8');
  if(current!==original&&!current.includes(marker))throw Error('检测到原版文件已有其他修改，停止覆盖：'+relative);
  const next=marker+'\n'+edit(original);if(next!==current){writes.push({file,next,current});changed=true;}
  manifest.push({file:relative,originalSha256:createHash('sha256').update(original).digest('hex'),patchedSha256:createHash('sha256').update(next).digest('hex')});
 };
 patch('pet-app.js',s=>{
  s=replace(s,"import { runFrames } from './frame-loop.js';","import { runFrames } from './frame-loop.js';\nimport { createDesktopEcology } from './desktop-ecology.js';\nlet ecology = null;");
  s=replace(s,'sfx.setShown(shown); reportVisibility();','sfx.setShown(shown); ecology?.shown(shown); reportVisibility();');
  s=replace(s,'function applyPrefs(p) {','function applyPrefs(p) {\n  ecology?.prefs(p);');
  s=replace(s,'sfx.set(p.sound);','sfx.set(p.sound && !ecology?.quiet);');
  s=replace(s,'body?.set({ roam: p.roam });',"body?.set({ roam: ecology?.quiet ? 'off' : p.roam });");
  s=replace(s,'kinds: p.sounds, snoreSeconds:','kinds: ecology?.soundKinds(p.sounds) ?? p.sounds, snoreSeconds:');
  s=replace(s,'speech.configure(p.speech);','speech.configure({ ...p.speech, enabled: p.speech.enabled === true && !ecology?.readoutEnabled });');
  s=replace(s,'function onOrder(m) {','function onOrder(m) {\n  ecology?.order(m);');
  s=replace(s,"    case 'hide': host?.hide?.(); break;","    case 'hide': host?.hide?.(); break;\n    case 'show': host?.show?.(); break;");
  s=replace(s,'function onBody(kind, d) {','function onBody(kind, d) {\n  ecology?.bodyEvent(kind,d);');
  s=replace(s,'    steps.forEach((dt, i) => {','    ecology?.tick();\n    steps.forEach((dt, i) => {');
  return s+'\nif(host) ecology=createDesktopEcology({body:()=>body,prefs:()=>prefs,skin:()=>skin,order:onOrder,audioPolicy:policy=>{sfx.set(policy.sound);sfx.configure({kinds:policy.kinds});speech.configure({enabled:policy.speech});body?.set({roam:policy.roam});}});\n';
 });
 patch('figure-frame.js',s=>{
  s=replace(s,"import * as kit from './kit/body.js';","import * as kit from './kit/body.js';\nlet ecologyTarget=null;\nconst ecologyKit={...kit,createBody:(host,opts)=>kit.createBody(host,{...opts,ground:'free',moves:{...opts.moves,desktopEcologyAnchor:()=>ecologyTarget}})};");
  s=replace(s,'scheme: m.scheme, kit, loadImage','scheme: m.scheme, kit: ecologyKit, loadImage');
  return replace(s,'      body.set?.(m.state);','      if(m.state?.ecologyTarget)ecologyTarget=m.state.ecologyTarget;\n      body.set?.(m.state);');
 });
 if(fs.existsSync(path.join(web,'whale/figure.js')))patch('whale/figure.js',s=>replace(s,'  return opts.kit.createBody(opts.host, { figure: await createWhaleFigure(base, opts) });',"  const {createIntegratedWhaleBody}=await import('../desktop-ecology-figure.js');\n  return createIntegratedWhaleBody(createWhaleFigure,base,opts);"));
 patch('../src/world.ts',s=>{
  s=replace(s,'  openWindow(): void {\n    if (!this.windowHost',"  openWindow(): void {\n    if(this.server.petInWindow){this.server.sendPet({t:'show'});return;}\n    if (!this.windowHost");
  return replace(s,"        case 'state': return this.petState();","        case 'state': return this.petState();\n        case 'openSettings': this.opts.controls?.openSettings?.(); return {ok:true};\n        case 'quitApplication': this.opts.controls?.quit?.(); return {ok:true};");
 });
 patch('../host/preload.cjs',s=>replace(s,"  hide: () => ipcRenderer.send('pet:hide'),","  hide: () => ipcRenderer.send('pet:hide'),\n  show: () => ipcRenderer.send('pet:show'),"));
 patch('../host/electron-main.cjs',s=>replace(s,"  onPet('pet:hide', () => { releaseAutoHidden(); if (win) win.hide(); });","  onPet('pet:hide', () => { releaseAutoHidden(); if (win) win.hide(); });\n  onPet('pet:show', () => { releaseAutoHidden(); if(win)win.showInactive(); });"));
 for(const [source,dest] of [['pet-client.js','desktop-ecology.js'],['figure-client.js','desktop-ecology-figure.js']]){
  const content=fs.readFileSync(path.join(root,'integration',source),'utf8'),file=path.join(web,dest);
  const current=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
  if(current!==content){writes.push({file,next:content,current});changed=true;}
 }
 // Reuse the already allowed original pet origin for the transplanted settings assets.
 const copyUi=(src,dest)=>{fs.mkdirSync(dest,{recursive:true});for(const entry of fs.readdirSync(src,{withFileTypes:true})){const from=path.join(src,entry.name),file=path.join(dest,entry.name);if(entry.isDirectory())copyUi(from,file);else{const next=fs.readFileSync(from),current=fs.existsSync(file)?fs.readFileSync(file):null;if(!current||!current.equals(next)){writes.push({file,next,current});changed=true;}}}};
 copyUi(path.join(root,'bridge/control-ui'),path.join(web,'desktop-voice-ui'));
 // Validate the entire pinned base before applying any hook; restore prior files if a write fails.
 const written=[];try{for(const item of writes){fs.writeFileSync(item.file,item.next);written.push(item);}}catch(error){for(const item of written.reverse())try{if(item.current!==null)fs.writeFileSync(item.file,item.current);else fs.unlinkSync(item.file);}catch{}throw error;}
 fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({version:'0.8.0',files:manifest},null,2));return {changed,files:manifest.length};
}
