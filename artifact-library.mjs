import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {revisionOf} from './execution-profile.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const types={'.wav':'audio/wav','.mp3':'audio/mpeg','.flac':'audio/flac','.ogg':'audio/ogg','.m4a':'audio/mp4','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.md':'text/markdown','.txt':'text/plain','.json':'application/json','.csv':'text/csv'};
export class ArtifactLibrary{
 constructor(store){this.store=store;this.root=path.join(store.workspace,'素材与作品');for(const name of ['原始素材','处理缓存','完成作品'])fs.mkdirSync(path.join(this.root,name),{recursive:true});store.state.artifacts||=[];}
 snapshot(){return this.store.state.artifacts.map(({relativePath,...a})=>({...a,url:'/api/artifacts/'+a.id}));}
 file(id){const a=this.store.state.artifacts.find(a=>a.id===id);if(!a)throw Error('素材不存在');const file=path.resolve(this.store.workspace,a.relativePath),root=fs.realpathSync(this.store.workspace);const real=fs.realpathSync(file);if(!real.startsWith(root+path.sep)||!fs.statSync(real).isFile())throw Error('素材位置无效');if(digest(fs.readFileSync(real))!==a.sha256)throw Error('文件内容已变化，不能冒充原版本');return {artifact:a,file:real};}
 import(name,bytes){const ext=path.extname(name).toLowerCase();if(!types[ext]||!bytes.length||bytes.length>20*1024*1024)throw Error('请选择20MB以内的音频、图片或文本素材');
  const sha=digest(bytes),old=this.store.state.artifacts.find(a=>a.stage==='source'&&a.sha256===sha);if(old){this.file(old.id);return {...old,duplicate:true};}
  const id=randomUUID(),title=path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100),relativePath=path.join('素材与作品','原始素材',id+ext);fs.writeFileSync(path.join(this.store.workspace,relativePath),bytes,{flag:'wx'});
  const a={id,title,stage:'source',mime:types[ext],bytes:bytes.length,sha256:sha,relativePath,sourceIds:[],createdAt:Date.now(),verified:true};this.store.state.artifacts.push(a);this.store.save();return a;
 }
 adoptResource(resourceId,{taskId,stepId,profile}={}){const {resource,file}=this.store.resourcePath(resourceId),bytes=fs.readFileSync(file);if(digest(bytes)!==resource.sha256)throw Error('作品文件与已核验内容不符');
  const old=this.store.state.artifacts.find(a=>a.resourceId===resourceId);if(old)return old;
  const a={id:randomUUID(),title:resource.title,stage:'finished',mime:'text/markdown',bytes:bytes.length,sha256:resource.sha256,relativePath:resource.relativePath,resourceId,taskId,stepId,profileRevision:profile?.revision||null,sourceIds:[],createdAt:Date.now(),verified:true};this.store.state.artifacts.push(a);this.store.save();return a;
 }
 // Internal worker output only; there is no API accepting an arbitrary output path.
 publishAudio(name,bytes,meta){
  if(!Buffer.isBuffer(bytes)||bytes.length<2000||bytes.length>40*1024*1024||path.extname(name)!=='.mp3')throw Error('成品音频无效');
  for(const id of meta.sourceIds)this.file(id);
  const id=randomUUID(),relativePath=path.join('素材与作品','完成作品',id+'.mp3');
  fs.writeFileSync(path.join(this.store.workspace,relativePath),bytes,{flag:'wx'});
  const a={...meta,id,title:path.basename(name),stage:'finished',mime:'audio/mpeg',bytes:bytes.length,sha256:digest(bytes),relativePath,createdAt:Date.now(),verified:true};
  this.store.state.artifacts.push(a);this.store.save();return a;
 }
 register({sourceIds,stage,recipe,profileRevision,fileResourceId},context){
  if(!['cache','finished'].includes(stage)||!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>12||typeof recipe!=='string'||!recipe.trim()||recipe.length>300)throw Error('需要实际来源、处理方式和产物');
  const sources=sourceIds.map(id=>this.file(id).artifact),{resource,file}=this.store.resourcePath(fileResourceId),bytes=fs.readFileSync(file);if(digest(bytes)!==resource.sha256)throw Error('产物内容已变化');
  const key=revisionOf({sources:sources.map(s=>s.sha256),stage,recipe,profileRevision});
  const old=this.store.state.artifacts.find(a=>a.cacheKey===key&&a.sha256===resource.sha256);if(old){this.file(old.id);return {...old,reused:true};}
  const a={id:randomUUID(),title:resource.title,stage,mime:types[path.extname(file)]||'application/octet-stream',bytes:bytes.length,sha256:resource.sha256,relativePath:resource.relativePath,resourceId:resource.id,sourceIds:[...sourceIds],recipe,profileRevision,cacheKey:key,taskId:context.task.id,stepId:context.step.id,createdAt:Date.now(),verified:true};this.store.state.artifacts.push(a);this.store.save();return a;
 }
 find({stage,query='',profileRevision}={}){return this.snapshot().filter(a=>(!stage||a.stage===stage)&&(!profileRevision||a.profileRevision===profileRevision)&&a.title.toLowerCase().includes(query.toLowerCase())).filter(a=>{try{this.file(a.id);return true;}catch{return false;}});}
}
