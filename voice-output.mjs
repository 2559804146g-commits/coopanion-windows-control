import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {VoiceModels,LOCAL_VOICES} from './voice-models.mjs';
import {synthesizeCloud} from './cloud-voice.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
export const VOICES=LOCAL_VOICES;
export function spokenText(text){return String(text||'').replace(/```[\s\S]*?```/g,'代码内容请看屏幕。').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,'链接请看屏幕').replace(/[*#`_]+/g,'').trim().slice(0,1200);}
// Start a short opening first and prepare later clauses during playback.
export function speechSegments(text){
  const segments=[];let part='';
  for(const char of Array.from(text)){
    part+=char;const first=segments.length===0,size=Array.from(part).length;
    if(/[。！？!?；;\n]/u.test(char)||(/[，,：:]/u.test(char)&&size>=4)||size>=(first?18:24)){
      if(part.trim())segments.push(part.trim());part='';
    }
  }
  if(part.trim())segments.push(part.trim());return segments;
}
export class VoiceOutput {
  constructor(store,{emit=()=>{},generate=null,quiet=()=>false}={}){
    Object.assign(this,{store,emit,quiet});this.customGenerate=generate;
    store.state.voiceOutput||={enabled:true,voiceId:3,speed:1,volume:.85};
    this.models=new VoiceModels(store.dir,store.state.voiceOutput.voiceId);
    this.state={status:'idle',error:null};this.queue=[];this.seen=new Set();this.files=new Map();this.pending=new Map();this.counter=0;this.epoch=0;
    this.preparedHistory=new Map();
    this.cache=path.join(store.dir,'voice-cache');fs.mkdirSync(this.cache,{recursive:true});
  }
  snapshot(){
    const m=this.models.active(),cloud=m.configJson.type!=='local',code=m.configJson.speaker||m.configJson.voice;
    const voiceOptions=[];
    for(const model of this.models.data.models.filter(m=>m.isEnabled)){
      for(const v of this.models.catalogue(model.id).filter(v=>this.models.data.quickVoiceIds.includes(v.id)))voiceOptions.push({key:model.configJson.type==='local'?v.ttsVoice:'catalog:'+v.id,name:v.name,group:model.modelName});
    }
    const chosen=cloud?this.models.data.voices.find(v=>v.ttsModelId===m.id&&v.ttsVoice===code):null;
    const selectedVoiceKey=cloud?(chosen?'catalog:'+chosen.id:'active:'+m.id):String(this.store.state.voiceOutput.voiceId);
    if(!voiceOptions.some(v=>v.key===selectedVoiceKey))voiceOptions.push({key:selectedVoiceKey,name:cloud?(chosen?.name||m.voiceName||code||m.modelName):(VOICES.find(v=>v.id===this.store.state.voiceOutput.voiceId)?.name||'当前声音'),group:m.modelName});
    return {...this.store.state.voiceOutput,...this.state,voiceId:cloud?2000:this.store.state.voiceOutput.voiceId,engineReady:!!this.engineReady,engine:this.engine,activeModel:{id:m.id,name:m.modelName,type:m.configJson.type},voices:[...VOICES,...(cloud?[{id:2000,name:chosen?.name||m.voiceName||m.modelName}]:[])],voiceOptions,selectedVoiceKey};
  }
  modelInvoke(method,args){
    const before=JSON.stringify(this.models.active());const result=this.models.invoke(method,args);
    if(before!==JSON.stringify(this.models.active())){this.stop();this.engineReady=false;if(this.models.active().configJson.type==='local'){this.store.state.voiceOutput.voiceId=Number(this.models.active().configJson.voiceId);this.store.save();}void this.warm();}
    return result;
  }
  configure(data){
    const c={...this.store.state.voiceOutput};
    if(data.enabled!==undefined){if(typeof data.enabled!=='boolean')throw Error('声音开关无效');c.enabled=data.enabled;}
    if(data.voiceId!==undefined){if(!VOICES.some(v=>v.id===data.voiceId)&&!(data.voiceId===2000&&this.models.active().configJson.type!=='local'))throw Error('音色无效');if(data.voiceId!==2000)c.voiceId=data.voiceId;}
    if(data.speed!==undefined){if(!Number.isFinite(data.speed)||data.speed<.7||data.speed>1.4)throw Error('语速范围为0.7至1.4');c.speed=data.speed;}
    if(c.voiceId!==this.store.state.voiceOutput.voiceId)this.engineReady=false;
    if(data.volume!==undefined){if(!Number.isFinite(data.volume)||data.volume<0||data.volume>1)throw Error('音量范围为0至1');c.volume=data.volume;}
    if(data.voiceId!==undefined&&data.voiceId!==2000)this.models.selectLocal(c.voiceId);
    this.store.state.voiceOutput=c;this.stop();this.store.save();if(c.enabled)void this.warm();return this.snapshot();
  }
  previewModel({modelId,voice}){
    const m=this.models.data.models.find(m=>m.id===modelId);if(!m)throw Error('模型不存在');
    const config=structuredClone(m.configJson);if(voice!==undefined)config[config.type==='local'?'voiceId':config.type==='openai'?'voice':'speaker']=config.type==='local'?Number(voice):String(voice);
    this.models.validateConfig(config);this.stop();const id=this.speak('你好，我是你的桌面伙伴。现在听到的是你选择的声音。','preview:'+Date.now(),config);if(!id)throw Error('请先开启朗读，并显示桌宠、关闭安静模式');return {ok:true,id};
  }
  speak(text,key=randomUUID(),config=null){
    const value=spokenText(text),hash=createHash('sha256').update(value).digest('hex');
    if(this.closed||!value||!this.store.state.voiceOutput.enabled||this.quiet()||this.seen.has(key))return null;
    if(this.lastHash===hash&&Date.now()-this.lastAt<60000)return null;
    this.lastHash=hash;this.lastAt=Date.now();this.seen.add(key);if(this.seen.size>100)this.seen.delete(this.seen.values().next().value);
    const job={id:randomUUID(),key,text:value,startedAt:Date.now(),config};this.queue.push(job);this.queue=this.queue.slice(-4);void this.pump();return job.id;
  }
  worker(){
    if(this.child)return this.child;
    const child=this.child=spawn('node',[path.join(root,'tts-worker.cjs')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    readline.createInterface({input:child.stdout}).on('line',line=>{
      let value;try{value=JSON.parse(line);}catch{return;}
      const p=this.pending.get(value.id);if(!p)return;
      clearTimeout(p.timer);this.pending.delete(value.id);value.ok?p.resolve(value):p.reject(Error(value.error));
    });
    const failed=()=>{
      if(this.child!==child)return;this.child=null;this.engineReady=false;
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('语音连接已停止'));}this.pending.clear();
    };
    child.on('error',failed);child.on('exit',failed);return child;
  }
  playPrepared({file,duration,rms,key}){
    if(this.closed||this.quiet())throw Error('桌宠当前已隐藏或静音，请先打开原桌宠声音');
    if(!fs.existsSync(file)||!Number.isFinite(duration)||duration<=0||!Number.isFinite(rms)||rms<=.00001)throw Error('成品声音无效');
    this.stop();const id=randomUUID();this.preparedHistory.set(id,'queued');while(this.preparedHistory.size>100)this.preparedHistory.delete(this.preparedHistory.keys().next().value);this.queue.push({id,key,text:'',startedAt:Date.now(),prepared:{file,duration,rms}});void this.pump();return {ok:true,submitted:true,id};
  }
  request(data){
    const child=this.worker(),id=++this.counter;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('语音生成超时'));if(this.child===child){this.engineReady=false;child.kill();}},90000);
      this.pending.set(id,{resolve,reject,timer,op:data.op});child.stdin.write(JSON.stringify({...data,id})+'\n');
    });
  }
  async warm(){
    if(this.models.active().configJson.type!=='local'){this.engineReady=false;this.engine=this.models.active().configJson.type;return;}
    for(let attempt=0;attempt<3;attempt++){
      if(this.customGenerate||this.closed||!this.store.state.voiceOutput.enabled||this.engineReady)return;
      if(!this.warming){
        const voiceId=this.warmingVoiceId=this.store.state.voiceOutput.voiceId;
        this.warming=this.request({op:'warm',voiceId}).then(v=>{this.engineReady=voiceId===this.store.state.voiceOutput.voiceId;this.engine=v.engine;}).catch(()=>{this.engineReady=false;}).finally(()=>{this.warming=null;});
      }
      const requested=this.warmingVoiceId;await this.warming;
      if(requested===this.store.state.voiceOutput.voiceId)return;
    }
  }
  generate(job,file){
    if(this.customGenerate)return this.customGenerate(job,file);
    const config=job.config||this.models.active().configJson;
    if(config.type!=='local'){
      const controller=new AbortController();this.cloudRequests??=new Set();this.cloudRequests.add(controller);
      return synthesizeCloud({config,text:job.text,file,speed:this.store.state.voiceOutput.speed,signal:controller.signal}).then(v=>{this.engineReady=true;this.engine=v.engine;return v;}).finally(()=>this.cloudRequests.delete(controller));
    }
    return this.request({op:'generate',text:job.text,file,voiceId:Number(config.voiceId),speed:this.store.state.voiceOutput.speed}).then(v=>{this.engineReady=true;this.engine=v.engine;return v;});
  }
  cancelGeneration(){
    for(const controller of this.cloudRequests||[])controller.abort();
    const ids=[];
    for(const [id,p] of this.pending){if(p.op==='warm')continue;ids.push(id);clearTimeout(p.timer);p.reject(Error('语音已打断'));this.pending.delete(id);}
    if(ids.length&&this.child)this.child.stdin.write(JSON.stringify({op:'cancel',ids})+'\n');
  }
  async pump(){
    if(this.flight||this.closed)return;this.flight=true;
    try{while(this.queue.length&&!this.closed){
      const reply=this.queue.shift(),epoch=this.epoch;if((!this.store.state.voiceOutput.enabled&&!reply.prepared)||this.quiet())break;
      reply.config||=structuredClone(this.models.active().configJson);
      const parts=reply.prepared?['']:speechSegments(reply.text);let completed=false;
      const prepare=index=>{
        const job={...reply,id:index===0?reply.id:randomUUID(),replyId:reply.id,text:parts[index],segment:index+1,segments:parts.length};
        const file=reply.prepared?.file||path.join(this.cache,job.id+'.wav'),at=Date.now();
        return Promise.resolve().then(()=>{if(epoch!==this.epoch)throw Error('语音已打断');return reply.prepared||this.generate(job,file);})
          .then(result=>({job,file,result,generationMs:Date.now()-at}),error=>({error}));
      };
      let next=prepare(0);
      try{for(let index=0;index<parts.length;index++){
        this.state={status:'generating',replyId:reply.id,key:reply.key,segment:index+1,segments:parts.length,error:null};this.emit({type:'state'});
        const prepared=await next;if(epoch!==this.epoch)break;if(prepared.error)throw prepared.error;
        const {job,file,result,generationMs}=prepared;
        if(!fs.existsSync(file)||!Number.isFinite(result.duration)||result.duration<=0||!Number.isFinite(result.rms)||result.rms<=.00001)throw Error('语音未生成有效声音');
        this.files.set(job.id,file);this.current=job;
        this.state={...this.state,status:'ready',id:job.id,duration:result.duration,generationMs,startedAt:reply.startedAt,error:null};
        next=index+1<parts.length?prepare(index+1):null;
        if(index===0&&parts.length>1&&result.duration<1&&this.store.state.voiceOutput.voiceId===1000){
          await Promise.race([next,new Promise(resolve=>setTimeout(resolve,600))]);
          if(epoch!==this.epoch)break;
        }
        await new Promise(resolve=>{
          this.finishPlayback=resolve;
          this.playbackTimer=setTimeout(()=>{this.state={...this.state,status:'error',error:'声音未确认播放，请重试'};resolve();},(result.duration+12)*1000);
          this.emit({type:'audio',id:job.id,replyId:reply.id,key:job.key,segment:job.segment,segments:job.segments,url:'/api/voice-audio/'+job.id+'.wav',volume:this.store.state.voiceOutput.volume,duration:result.duration});
        });
        clearTimeout(this.playbackTimer);this.finishPlayback=null;
        if(epoch!==this.epoch)break;if(this.state.status==='error')throw Error(this.state.error);
        this.current=null;completed=index===parts.length-1;this.clean();
      }}catch(e){if(epoch===this.epoch){if(reply.prepared)this.preparedHistory.set(reply.id,'error');this.cancelGeneration();this.state={...this.state,status:'error',error:'声音暂时未能完成，请重试',detail:e.message};}}
      if(epoch===this.epoch){if(completed)this.state={status:'idle',error:null,lastPlayed:reply.id,firstAudioMs:this.firstAudioMs};this.current=null;this.emit({type:'state'});}
    }}finally{this.flight=false;}
  }
  report({id,status}){
    if(id!==this.current?.id)return {ok:false,stale:true};
    if(this.current.prepared&&['playing','ended','error'].includes(status))this.preparedHistory.set(id,status);
    if(status==='playing'){
      if(this.current.segment===1)this.firstAudioMs=Date.now()-this.current.startedAt;
      this.state={...this.state,status:'playing',firstAudioMs:this.firstAudioMs};
    }else if(status==='ended'){this.state={...this.state,status:'between'};this.finishPlayback?.();}
    else if(status==='error'){this.state={...this.state,status:'error',error:'声音播放失败，请检查输出设备'};this.finishPlayback?.();}
    else throw Error('播放状态无效');return {ok:true};
  }
  stop(){
    if(this.current?.prepared&&!['ended','error'].includes(this.preparedHistory.get(this.current.id)))this.preparedHistory.set(this.current.id,'interrupted');for(const j of this.queue)if(j.prepared)this.preparedHistory.set(j.id,'interrupted');
    this.epoch++;this.queue=[];this.current=null;this.lastHash=null;clearTimeout(this.playbackTimer);
    this.finishPlayback?.();this.finishPlayback=null;this.emit({type:'stop'});this.state={status:'idle',error:null};
    // Keep the loaded model across conversations; discard cancelled audio instead.
    this.cancelGeneration();
  }
  clean(){while(this.files.size>12){const [id,file]=this.files.entries().next().value;this.files.delete(id);if(path.dirname(file)===this.cache)try{fs.unlinkSync(file);}catch{}}}
  close(){
    this.closed=true;this.stop();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('语音已关闭'));}this.pending.clear();
    if(this.child){const child=this.child;this.child=null;child.stdin.end();child.kill();}this.engineReady=false;
  }
}
