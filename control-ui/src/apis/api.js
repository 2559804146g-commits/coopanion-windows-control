import {Message} from 'element-ui';
let serial=0;const pending=new Map();
window.addEventListener('message',e=>{
 if(e.source!==parent||e.origin!=='http://127.0.0.1:17788'||e.data?.channel!=='ecology-voice-result')return;
 const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);clearTimeout(p.timer);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result);
});
export function invoke(method,value={}){
 return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('配置服务未响应，请重新打开此页'));},value.method==='syncVoices'?(value.args?.language===''?190000:70000):15000);pending.set(id,{resolve,reject,timer});parent.postMessage({channel:'ecology-voice-request',id,method,value},'http://127.0.0.1:17788');});
}
async function call(method,args,callback,shape='wrapped'){
 let data;try{data={code:0,data:await invoke('models',{method,args})};}catch(e){data={code:1,msg:e.message};Message.error(e.message);}
 callback(shape==='providers'?(data.data||[]):shape==='plain'?data:{data});
}
export default {
 model:{
  getModelList:(p,cb)=>call('list',p,cb),getModelProviders:(_type,cb)=>call('providers',{},cb,'providers'),getModelConfig:(id,cb)=>call('get',{id},cb),
  addModel:(p,cb)=>call('add',p,cb),updateModel:(p,cb)=>call('update',p,cb),deleteModel:(id,cb)=>call('delete',{id},cb),updateModelStatus:(id,status,cb)=>call('status',{id,status},cb),setDefaultModel:(id,cb)=>call('default',{id},cb)
 },
 timbre:{getVoiceList:(p,cb)=>call('voices',p,cb,'plain'),saveVoice:(p,cb)=>call('saveVoice',p,cb,'plain'),updateVoice:(p,cb)=>call('updateVoice',p,cb,'plain'),deleteVoice:(ids,cb)=>call('deleteVoice',{ids},cb)},
 async useVoice(id){await invoke('models',{method:'useVoice',args:{voiceId:id}});},
 async saveQuickVoices(ttsModelId,voiceIds){return invoke('models',{method:'saveQuickVoices',args:{ttsModelId,voiceIds}});},
 async syncVoices(id,language='zh'){return invoke('models',{method:'syncVoices',args:{id,language}});},
 async preview(modelId,voice){const r=await invoke('previewModel',{modelId,voice});Message.info('正在准备试听，声音由桌宠播放');
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,700));const s=await invoke('state');if(s.voice.status==='error')throw Error(s.voice.detail||s.voice.error);if(s.voice.lastPlayed===r.id){Message.success('试听完成');return;}}
  throw Error('试听未收到完成回执，请检查桌宠是否显示、声音是否开启');
 }
};
