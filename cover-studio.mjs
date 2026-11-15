import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {revisionOf} from './execution-profile.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const live=new Set(['queued','preparing','separating','converting','mixing','checking']);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const exists=file=>typeof file==='string'&&fs.existsSync(file);
export class CoverStudio {
 constructor(store,artifacts,{configFile=path.join(store.dir,'cover-engine.json'),runner}={}){
  this.store=store;this.artifacts=artifacts;this.runner=runner;this.configFile=configFile;this.closed=false;this.controllers=new Map();this.flight=null;
  store.state.covers||=[];
  for(const j of store.state.covers)if(live.has(j.status)){j.status='interrupted';j.reason='应用已重启，原制作已停止；可重新制作，已完成作品仍然保留';j.updatedAt=Date.now();}
  store.save();
 }
 config(){try{return JSON.parse(fs.readFileSync(this.configFile,'utf8'));}catch{return null;}}
 status(){const c=this.config(),missing=[];if(!c)missing.push('翻唱运行环境');else for(const [label,file]of [['Python',c.python],['FFmpeg',c.ffmpeg],['人声分离模型',c.separator],['RVC引擎',path.join(c.applio||'', 'rvc/infer/infer.py')],...(c.files||[]).map(f=>[path.basename(f.path),f.path])])if(!exists(file))missing.push(label);
  const voices=(c?.voices||[]).filter(v=>exists(v.model)&&(!v.index||exists(v.index))).map(({id,label,notice})=>({id,label,notice}));
  return {ready:!missing.length&&!!voices.length,missing,engine:c?'Applio RVC · CPU':null,voices,jobs:this.store.state.covers.map(j=>this.publicJob(j)),maxSourceMB:20,maxDuration:1200};
 }
 publicJob(j){const {cacheKey,engine,workDir,...value}=j;return structuredClone(value);}
 get(id){const j=this.store.state.covers.find(j=>j.id===id);if(!j)throw Error('制作任务不存在');return this.publicJob(j);}
 save(j,status,extra={}){Object.assign(j,extra,{status,updatedAt:Date.now()});this.store.save();}
 create({sourceId,voiceId,pitch=0,start=0,duration=null,arrangement='mixed',title},context={}){
  if(this.closed)throw Error('翻唱服务正在停止');const state=this.status(),engine=this.config();if(!state.ready)throw Error('翻唱环境尚未就绪：'+state.missing.join('、'));
  const {artifact}=this.artifacts.file(sourceId);if(artifact.stage!=='source'||!artifact.mime.startsWith('audio/'))throw Error('请选择已导入的原始音频');
  if(!state.voices.some(v=>v.id===voiceId))throw Error('请选择已安装的歌声音色');
  if(!Number.isInteger(pitch)||Math.abs(pitch)>12||!Number.isFinite(start)||start<0||start>1200||(duration!==null&&(!Number.isFinite(duration)||duration<1||duration>1200))||!['mixed','acappella'].includes(arrangement))throw Error('调音或片段范围无效');
  const profile=revisionOf({files:engine.files,voiceId,pitch,start,duration,version:1});
  const cacheKey=revisionOf({source:artifact.sha256,profile,arrangement});
  const prior=this.store.state.covers.find(j=>j.cacheKey===cacheKey&&(live.has(j.status)||j.status==='succeeded'&&this.validResult(j)));
  if(prior)return {...this.publicJob(prior),reused:true};
  if(this.store.state.covers.filter(j=>live.has(j.status)).length>=3)throw Error('已有3项制作排队，请先等待或停止其中一项');
  const j={id:randomUUID(),title:String(title||artifact.title).trim().slice(0,100),sourceId,sourceSha256:artifact.sha256,voiceId,voiceLabel:state.voices.find(v=>v.id===voiceId).label,pitch,start,duration,arrangement,profileRevision:profile,cacheKey,status:'queued',createdAt:Date.now(),updatedAt:Date.now(),...(context.taskId?{taskId:context.taskId,stepId:context.stepId}:{}),engine};
  this.store.state.covers.push(j);this.store.save();queueMicrotask(()=>this.pump());return this.publicJob(j);
 }
 validResult(j){try{return j.outputs?.length>0&&j.outputs.every(o=>!!this.artifacts.file(o.id));}catch{return false;}}
 cancel(id){const j=this.store.state.covers.find(j=>j.id===id);if(!j)throw Error('制作任务不存在');if(live.has(j.status)){this.save(j,'cancelled',{reason:'已停止制作'});this.controllers.get(id)?.abort();}return this.publicJob(j);}
 async run(exe,args,{cwd,signal,timeout=30*60*1000}={}){
  if(this.runner)return this.runner(exe,args,{cwd,signal,timeout});
  return new Promise((resolve,reject)=>{let text='',done=false;const child=spawn(exe,args,{cwd,windowsHide:true,signal,env:{...process.env,PYTHONPATH:'',PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',CUDA_VISIBLE_DEVICES:'-1',OMP_NUM_THREADS:'4',PATH:path.dirname(this.config().ffmpeg)+path.delimiter+process.env.PATH}});
   const timer=setTimeout(()=>{child.kill();},timeout);const finish=e=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(text);};
   for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{text=(text+b.toString()).slice(-24000);});
   child.once('error',finish);child.once('close',code=>finish(code===0?null:Object.assign(Error('音频处理失败：'+text.slice(-1800)),{processing:true})));
  });
 }
 async audioInfo(file,engine,signal){
  const result=await this.run(engine.ffmpeg,['-hide_banner','-protocol_whitelist','file,pipe','-i',file,'-af','volumedetect','-f','null','-'],{signal,timeout:120000});
  const d=/Duration:\s*(\d+):(\d+):([\d.]+)/.exec(result),v=/mean_volume:\s*([\d.\-]+) dB/.exec(result);const seconds=d?+d[1]*3600+ +d[2]*60+ +d[3]:NaN;
  if(!Number.isFinite(seconds)||seconds<=0||!v||+v[1]<-65)throw Error('音频无法解码、没有有效时长或过于安静');return {seconds,meanDb:+v[1]};
 }
 async execute(j,signal){
  const engine=j.engine,dir=path.join(engine.workRoot,j.id);fs.mkdirSync(dir,{recursive:true});j.workDir=dir;const jobFile=path.join(dir,'job.json');
  const {file}=this.artifacts.file(j.sourceId);if(hash(file)!==j.sourceSha256)throw Error('原曲已变化');
  fs.writeFileSync(jobFile,JSON.stringify(j));const ff=(args)=>this.run(engine.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe',...args],{signal});
  this.save(j,'preparing');const original=await this.audioInfo(file,engine,signal);const seconds=j.duration===null?original.seconds-j.start:j.duration;
  if(seconds<=0||seconds>1200||j.start+seconds>original.seconds+0.1)throw Error('片段超出原曲范围；整首最长20分钟，请明确选择片段');
  await ff(['-ss',String(j.start),'-i',file,'-t',String(seconds),'-ar','44100','-ac','2','-c:a','pcm_s16le',path.join(dir,'input.wav')]);
  const stemKey=revisionOf({source:j.sourceSha256,start:j.start,seconds,separator:engine.files.filter(f=>path.resolve(f.path).startsWith(path.resolve(path.dirname(engine.separator))+path.sep)),version:1}),cacheDir=path.join(engine.workRoot,'stems',stemKey),manifest=path.join(cacheDir,'stems.json');let stems;
  try{const cached=JSON.parse(fs.readFileSync(manifest,'utf8'));if(cached.files.every(f=>path.dirname(f.path)===cacheDir&&hash(f.path)===f.sha256))stems={vocals:cached.files[0].path,instrumental:cached.files[1].path};}catch{}
  if(!stems){this.save(j,'separating');await this.run(engine.python,['-I','-X','utf8',path.join(here,'cover-worker.py'),jobFile,'separate'],{cwd:dir,signal});stems=JSON.parse(fs.readFileSync(path.join(dir,'stems.json'),'utf8'));fs.mkdirSync(cacheDir,{recursive:true});const files=[];for(const name of ['vocals','instrumental']){const source=fs.realpathSync(stems[name]);if(!source.startsWith(fs.realpathSync(dir)+path.sep))throw Error('分离结果位置无效');const dest=path.join(cacheDir,name+'.wav');fs.copyFileSync(source,dest);files.push({path:dest,sha256:hash(dest)});}fs.writeFileSync(manifest,JSON.stringify({files}));stems={vocals:files[0].path,instrumental:files[1].path};}
  const vocal=path.join(dir,'vocal.wav');await ff(['-i',stems.vocals,'-ar','40000','-ac','1',vocal]);await this.audioInfo(vocal,engine,signal);
  this.save(j,'converting');await this.run(engine.python,['-I','-X','utf8',path.join(here,'cover-worker.py'),jobFile,'convert'],{cwd:engine.applio,signal});
  const receipt=JSON.parse(fs.readFileSync(path.join(dir,'conversion.json'),'utf8'));if(receipt.voiceId!==j.voiceId||receipt.modelSha256!==engine.files.find(f=>path.resolve(f.path)===path.resolve(engine.voices.find(v=>v.id===j.voiceId).model))?.sha256)throw Error('换声音色与所选模型不符');
  const converted=path.join(dir,'converted.wav'),info=await this.audioInfo(converted,engine,signal);if(Math.abs(info.seconds-seconds)>Math.max(1,seconds*.03))throw Error('换声时长偏差过大，保留诊断文件');
  this.save(j,'mixing');const dry=path.join(dir,'acappella.mp3'),mixed=path.join(dir,'mixed.mp3');
  await ff(['-i',converted,'-af',`apad,atrim=duration=${seconds},loudnorm=I=-16:TP=-1.5:LRA=9`,'-ar','44100','-ac','2','-b:a','192k',dry]);
  if(j.arrangement==='mixed')await ff(['-i',converted,'-i',stems.instrumental,'-filter_complex',`[0:a]apad,atrim=duration=${seconds}[v];[v][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=9[out]`,'-map','[out]','-ar','44100','-ac','2','-b:a','192k',mixed]);
  this.save(j,'checking');const outputs=[];
  for(const [kind,output]of [['acappella',dry],...(j.arrangement==='mixed'?[['mixed',mixed]]:[])]){const checked=await this.audioInfo(output,engine,signal);if(Math.abs(checked.seconds-seconds)>.5)throw Error('成品时长不符');const a=this.artifacts.publishAudio(j.title+(kind==='mixed'?' · 翻唱':' · 清唱')+'.mp3',fs.readFileSync(output),{sourceIds:[j.sourceId],profileRevision:j.profileRevision,recipe:'rvc-cpu-v1:'+kind,coverId:j.id,arrangement:kind,seconds:checked.seconds});outputs.push({id:a.id,kind,title:a.title,seconds:checked.seconds});}
  if(signal.aborted)throw Error('已停止制作');return {outputs,actualDuration:seconds,conversion:receipt};
 }
 async pump(){if(this.flight||this.closed)return;this.flight=(async()=>{for(const j of this.store.state.covers.filter(j=>j.status==='queued')){if(this.closed)break;if(j.status!=='queued')continue;const controller=new AbortController();this.controllers.set(j.id,controller);try{const result=await this.execute(j,controller.signal);this.save(j,'succeeded',{...result,finishedAt:Date.now(),reason:null});if(!j.taskId&&!this.store.state.songRequests?.some(r=>r.workId===j.id))this.store.event('cover-finished',`翻唱「${j.title}」制作完成，任务ID ${j.id}，实际${result.actualDuration.toFixed(1)}秒；成品已保存到素材与作品。只表示制作完成，尚未向QQ发送。`,{coverId:j.id});}catch(e){if(j.status!=='cancelled'&&j.status!=='interrupted'){let reason=e.message;if(e.processing){try{fs.writeFileSync(path.join(j.workDir,'error.log'),e.message);}catch{}reason=({preparing:'原曲检查失败，请重新导入可播放的音频。',separating:'人声分离未完成，可以选择较短片段重试。',converting:'歌声转换未完成，可以重新制作或换一段音频。',mixing:'混音未完成，可以重新制作。',checking:'成品核验未通过，诊断记录已保留。'}[j.status]||'音频处理未完成，诊断记录已保留。');}this.save(j,'failed',{reason});if(!j.taskId&&!this.store.state.songRequests?.some(r=>r.workId===j.id))this.store.event('cover-failed',`翻唱「${j.title}」未完成：${reason}。任务ID ${j.id}。不得用原曲冒充换声结果。`);}}finally{this.controllers.delete(j.id);}}})();try{await this.flight;}finally{this.flight=null;if(!this.closed&&this.store.state.covers.some(j=>j.status==='queued'))queueMicrotask(()=>this.pump());}}
 async close(){this.closed=true;for(const j of this.store.state.covers)if(live.has(j.status)){this.save(j,'interrupted',{reason:'服务停止，制作已中断，可重新制作'});this.controllers.get(j.id)?.abort();}await this.flight;}
}
