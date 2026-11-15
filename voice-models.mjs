import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadBreezeVoices} from './breeze-voice.mjs';
const secret=k=>/token|api_key|secret|access_key/i.test(k);
const field=(key,label,type='string',value='')=>({key,label,type,default:value});
export const LOCAL_VOICES=[{id:1000,name:'中文女声 · 快速'},{id:3,name:'中文女声 1'},{id:4,name:'中文女声 2'},{id:5,name:'中文女声 3'},{id:58,name:'中文男声 1'}];
export const PROVIDERS=[
 {providerCode:'breezeblue',name:'BreezeBlue',fields:JSON.stringify([field('api_key','API 密钥','password'),field('model','模型名称','string','breeze-tts-2'),field('speaker','音色编号（可加载后选择）'),field('instructions','声音表达（可选）'),field('guidance_scale','表达强度（1—10）','number',4)])},
 {providerCode:'local',name:'本地离线语音',fields:JSON.stringify([field('voiceId','本地音色编号','number',1000)])},
 {providerCode:'huoshan_double_stream',name:'火山引擎双向流式',fields:JSON.stringify([field('appid','应用ID'),field('access_token','访问令牌','password'),field('resource_id','资源ID','string','volc.service_type.10029'),field('speaker','音色编号','string','zh_female_wanwanxiaohe_moon_bigtts')])},
 {providerCode:'openai',name:'OpenAI 兼容语音（含硅基流动）',fields:JSON.stringify([field('url','API 地址','string','https://api.siliconflow.cn/v1/audio/speech'),field('api_key','API 密钥','password'),field('model','模型名称','string','FunAudioLLM/CosyVoice2-0.5B'),field('voice','音色编号','string','FunAudioLLM/CosyVoice2-0.5B:anna')])}
];
export class VoiceModels{
 constructor(dir,localVoice=1000){this.file=path.join(dir,'voice-models.json');this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{models:[{id:'TTS_Local',modelType:'tts',modelCode:'local',modelName:'本地离线语音',isDefault:1,isEnabled:1,configJson:{type:'local',voiceId:localVoice},sort:0}],voices:[]};
  if(!Array.isArray(this.data.quickVoiceIds)){const current=this.currentVoice();this.data.quickVoiceIds=current?[current.id]:[];this.save();}
 }
 catalogue(modelId){const m=this.data.models.find(m=>m.id===modelId);return m?.configJson.type==='local'?LOCAL_VOICES.map((v,i)=>({id:'local:'+modelId+':'+v.id,ttsModelId:modelId,ttsVoice:String(v.id),name:v.name,languages:'中文',sort:i,builtIn:true})):this.data.voices.filter(v=>v.ttsModelId===modelId);}
 currentVoice(){const m=this.active(),code=m.configJson.voiceId??m.configJson.voice??m.configJson.speaker;return this.catalogue(m.id).find(v=>v.ttsVoice===String(code));}
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),{mode:0o600});fs.renameSync(tmp,this.file);}
 active(){return this.data.models.find(m=>m.isDefault===1&&m.isEnabled===1)||this.data.models[0];}
 publicModel(m){const c=structuredClone(m);for(const k of Object.keys(c.configJson))if(secret(k)&&c.configJson[k])c.configJson[k]='********';return c;}
 selectLocal(id){const m=this.data.models.find(m=>m.id==='TTS_Local');m.configJson.voiceId=id;for(const row of this.data.models)row.isDefault=+(row===m);m.isEnabled=1;this.save();}
 validateConfig(c,{requireVoice=true}={}){
  if(!PROVIDERS.some(p=>p.providerCode===c.type))throw Error('此语音供应器尚未接入');
  if(c.type==='local'&&![1000,3,4,5,58].includes(Number(c.voiceId)))throw Error('本地音色编号无效');
  if(c.type==='huoshan_double_stream'){
   for(const k of ['appid','access_token','resource_id','speaker'])if(typeof c[k]!=='string'||!c[k].trim())throw Error('请填写火山应用ID、访问令牌、资源ID和音色编号');
  }
  if(c.type==='openai'){
   let u;try{u=new URL(c.url);}catch{throw Error('API 地址格式不正确');}if(u.protocol!=='https:'||u.username||u.password)throw Error('API 地址必须使用 HTTPS，且不能包含账号密码');
   if(!c.api_key||!c.model||!c.voice)throw Error('请填写 API 密钥、模型名称和音色编号');
  }
  if(c.type==='breezeblue'){
   if(typeof c.api_key!=='string'||!c.api_key.trim()||/[\r\n]/.test(c.api_key))throw Error('请填写 BreezeBlue API 密钥');
   if(c.model&&typeof c.model!=='string')throw Error('BreezeBlue 模型名称无效');
   if(requireVoice&&(typeof c.speaker!=='string'||!c.speaker.trim()))throw Error('请先从账号加载并选用 BreezeBlue 音色');
   if(c.speaker&&typeof c.speaker!=='string')throw Error('BreezeBlue 音色编号无效');
   if(c.instructions!==undefined&&(typeof c.instructions!=='string'||c.instructions.length>2000))throw Error('声音表达请控制在2000字以内');
   if(c.guidance_scale!==undefined&&c.guidance_scale!==''&&(!Number.isFinite(Number(c.guidance_scale))||Number(c.guidance_scale)<1||Number(c.guidance_scale)>10))throw Error('BreezeBlue 表达强度范围为1至10');
  }
 }
 async syncVoices(id,options={}){
  const m=this.data.models.find(m=>m.id===id);if(m?.configJson.type!=='breezeblue')throw Error('当前厂商不支持从账号加载音色');
  this.validateConfig(m.configJson,{requireVoice:false});const config=structuredClone(m.configJson);
  const rows=await loadBreezeVoices(config,options);
  if(!this.data.models.includes(m)||JSON.stringify(config)!==JSON.stringify(m.configJson))throw Error('厂商配置已变化，请重新加载音色');
  const existing=this.data.voices.filter(v=>v.ttsModelId===id),codes=new Set(rows.map(v=>v.code));
  const fresh=rows.map((v,i)=>{const old=existing.find(e=>e.ttsVoice===v.code);return {...old,id:old?.id||randomUUID(),ttsModelId:id,ttsVoice:v.code,name:v.name.slice(0,100),languages:v.language==='zh'?'中文':v.language,remark:v.description.slice(0,1000),voiceDemo:old?.voiceDemo||'',sort:i,source:'breezeblue'};});
  // Replace only a fully fetched remote catalogue; keep manual voices and stable IDs.
  const language=options.language??'zh';
  this.data.voices=[...this.data.voices.filter(v=>v.ttsModelId!==id||(!codes.has(v.ttsVoice)&&(v.source!=='breezeblue'||(language==='zh'&&!['zh','中文'].includes(v.languages))))), ...fresh];
  m.voicesSyncedAt=new Date().toISOString();this.save();return {total:fresh.length};
 }
 invoke(method,args={}){
  const model=()=>{const m=this.data.models.find(m=>m.id===args.id);if(!m)throw Error('模型不存在');return m;};
  if(method==='providers')return PROVIDERS;
  if(method==='list'){const list=this.data.models.filter(m=>!args.modelName||m.modelName.includes(args.modelName)).sort((a,b)=>(a.sort||0)-(b.sort||0));const start=Math.max(0,((+args.page||1)-1)*(+args.limit||10));return {list:list.slice(start,start+(+args.limit||10)).map(m=>this.publicModel(m)),total:list.length};}
  if(method==='get')return this.publicModel(model());
  if(method==='syncVoices')return this.syncVoices(args.id,{language:args.language??'zh'});
  if(method==='add'||method==='update'){
   const f=args.formData||{},old=method==='update'?model():null;
   const source=old||this.data.models.find(m=>m.id===args.cloneFrom);
   const c=structuredClone(f.configJson||{});for(const k of Object.keys(c))if(secret(k)&&c[k]==='********'){if(!source)throw Error('请填写真实密钥');c[k]=source.configJson[k]||'';}
   c.type=args.provideCode||c.type;this.validateConfig(c,{requireVoice:!!old?.isDefault});
   const id=old?.id||f.id||'TTS_'+randomUUID().slice(0,8);if(!/^[\w-]{1,80}$/.test(id))throw Error('模型ID只能含字母、数字、下划线和连字符');
   if(!old&&this.data.models.some(m=>m.id===id))throw Error('模型ID已存在');
   if(!f.modelName?.trim())throw Error('请填写模型名称');
   const m={id,modelType:'tts',modelCode:String(f.modelCode||c.type).slice(0,120),modelName:f.modelName.slice(0,120),configJson:c,isEnabled:+!!f.isEnabled,isDefault:old?.isDefault||0,sort:Number(f.sort)||0,docLink:String(f.docLink||'').slice(0,500),remark:String(f.remark||'').slice(0,1000)};
   if(m.isDefault&&!m.isEnabled)throw Error('默认模型不能停用');if(old)Object.assign(old,m);else this.data.models.push(m);this.save();return this.publicModel(m);
  }
  if(method==='default'){const m=model();this.validateConfig(m.configJson);if(!m.isEnabled)throw Error('请先启用模型');for(const row of this.data.models)row.isDefault=+(row===m);this.save();return {};}
  if(method==='status'){const m=model();if(m.isDefault&&!args.status)throw Error('默认模型不能停用');m.isEnabled=+!!args.status;this.save();return {};}
  if(method==='delete'){const m=model();if(m.isDefault||m.id==='TTS_Local')throw Error('默认模型或内置本地模型不能删除');this.data.models=this.data.models.filter(x=>x!==m);this.data.voices=this.data.voices.filter(v=>v.ttsModelId!==m.id);this.save();return {};}
  if(method==='voices'){const current=this.currentVoice();const list=this.catalogue(args.ttsModelId).map(v=>({...v,quickSelected:this.data.quickVoiceIds.includes(v.id)||v.id===current?.id,isCurrent:v.id===current?.id}));return {list,total:list.length};}
  if(method==='saveQuickVoices'){
   if(!this.data.models.some(m=>m.id===args.ttsModelId))throw Error('厂商不存在');
   const rows=this.catalogue(args.ttsModelId),allowed=new Set(rows.map(v=>v.id));
   if(!Array.isArray(args.voiceIds)||args.voiceIds.some(id=>typeof id!=='string'||!allowed.has(id)))throw Error('常用音色已变化，请重新打开音色管理');
   const selected=new Set(args.voiceIds),current=this.currentVoice();if(current?.ttsModelId===args.ttsModelId)selected.add(current.id);
   this.data.quickVoiceIds=[...this.data.quickVoiceIds.filter(id=>!allowed.has(id)),...selected];this.save();return {voiceIds:[...selected],total:selected.size};
  }
  if(method==='saveVoice'||method==='updateVoice'){
   const old=this.data.voices.find(v=>v.id===args.id);if(method==='updateVoice'&&!old)throw Error('音色不存在');
   if(!this.data.models.some(m=>m.id===args.ttsModelId)||!args.voiceCode||!args.voiceName)throw Error('请填写音色编号、名称及模型');
   const v={id:old?.id||randomUUID(),ttsModelId:args.ttsModelId,ttsVoice:String(args.voiceCode).slice(0,200),name:String(args.voiceName).slice(0,100),languages:String(args.languageType||'中文').slice(0,80),remark:String(args.remark||'').slice(0,1000),voiceDemo:String(args.voiceDemo||'').slice(0,1000),sort:Number(args.sort)||0};
   if(v.voiceDemo&&!/^https:\/\//.test(v.voiceDemo))throw Error('试听链接需使用 HTTPS');if(old)Object.assign(old,v);else this.data.voices.push(v);this.save();return v;
  }
  if(method==='deleteVoice'){const ids=Array.isArray(args.ids)?args.ids:[args.id];this.data.voices=this.data.voices.filter(v=>!ids.includes(v.id));this.save();return {};}
  if(method==='useVoice'){
   const v=this.data.voices.find(v=>v.id===args.voiceId)||this.data.models.filter(m=>m.configJson.type==='local').flatMap(m=>this.catalogue(m.id)).find(v=>v.id===args.voiceId);if(!v)throw Error('音色不存在');const m=this.data.models.find(m=>m.id===v.ttsModelId);if(!m?.isEnabled)throw Error('请先启用模型');
   const c={...m.configJson};if(c.type==='local')c.voiceId=Number(v.ttsVoice);else c[c.type==='openai'?'voice':'speaker']=v.ttsVoice;this.validateConfig(c);
   m.configJson=c;m.voiceName=v.name;for(const row of this.data.models)row.isDefault=+(row===m);this.save();return {};
  }
  throw Error('不支持的模型配置操作');
 }
}
