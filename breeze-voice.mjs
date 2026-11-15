const API='https://api.breeze.blue/v1';
export function breezeError(status){
 if(status===401||status===403)return 'BreezeBlue 密钥无效或权限不足，请检查 API 密钥';
 if(status===402)return 'BreezeBlue 额度不足，请检查账号余额';
 if(status===404)return 'BreezeBlue 音色不存在或当前账号无法使用，请重新加载音色';
 if(status===429)return 'BreezeBlue 请求过于频繁或并发已满，请稍后重试';
 return 'BreezeBlue 请求失败（HTTP '+status+'），请检查账号配置或稍后重试';
}
export async function breezeRequest(route,{api_key,signal,body,fetchImpl=fetch}={}){
 try{
  const r=await fetchImpl(API+route,{method:body?'POST':'GET',headers:{'xi-api-key':api_key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal});
  if(!r.ok){await r.body?.cancel();throw Error(breezeError(r.status));}return r;
 }catch(e){if(signal?.aborted)throw Error('BreezeBlue 请求已取消或超时');if(e.message.startsWith('BreezeBlue '))throw e;throw Error('无法连接 BreezeBlue，请检查网络后重试');}
}
export async function loadBreezeVoices(config,{fetchImpl=fetch,language='zh',signal=AbortSignal.timeout(language==='zh'?60000:180000)}={}){
 if(!['zh',''].includes(language))throw Error('请选择中文或全部语言');
 const voices=new Map(),tokens=new Set();let token='';
 for(let page=1;page<=250;page++){
  const q=new URLSearchParams({page_size:'100',page:String(page)});if(token)q.set('next_page_token',token);
  if(language)q.set('language_code',language);
  const r=await breezeRequest('/voices?'+q,{api_key:config.api_key,signal,fetchImpl});
  let data;try{data=await r.json();}catch{throw Error('BreezeBlue 音色目录格式无效，请稍后重试');}
  if(!Array.isArray(data.voices))throw Error('BreezeBlue 未返回有效音色目录');
  for(const v of data.voices){if(typeof v.voice_id!=='string'||!v.voice_id||typeof v.name!=='string')throw Error('BreezeBlue 音色信息不完整');voices.set(v.voice_id,{code:v.voice_id,name:v.name,language:v.language_code||'',description:typeof v.description==='string'?v.description:''});}
  if(!data.has_more)return [...voices.values()];
  if(data.next_page_token){if(tokens.has(data.next_page_token))throw Error('BreezeBlue 音色分页重复，请重新加载');tokens.add(data.next_page_token);token=data.next_page_token;}
 }
 throw Error('BreezeBlue 音色目录过大，本次未保存，请稍后重试');
}
export async function synthesizeBreeze(config,text,speed,{signal,fetchImpl=fetch}={}){
 if(!config.speaker?.trim())throw Error('请先从 BreezeBlue 账号加载并选用音色');
 const r=await breezeRequest('/text-to-speech/'+encodeURIComponent(config.speaker)+'?output_format=pcm',{
  api_key:config.api_key,signal,fetchImpl,body:{text,model_id:config.model||'breeze-tts-2',...(config.instructions?.trim()?{instructions:config.instructions.trim()}:{}),voice_settings:{speed,guidance_scale:Number(config.guidance_scale||4)}}
 });
 const chunks=[];let n=0;const reader=r.body.getReader();
 try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>24*1024*1024)throw Error('BreezeBlue 单段声音过长');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});if(signal?.aborted)throw Error('语音已打断');throw Error(e.message.startsWith('BreezeBlue ')?e.message:'BreezeBlue 音频传输中断，请重试');}
 return Buffer.concat(chunks);
}
