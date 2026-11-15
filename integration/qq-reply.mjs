import {createHash} from 'node:crypto';
// The original QQ handler retains recipients, permissions, upload and send rules.
export function wrapQQTools(tools,host,call){return tools.map(tool=>tool.name==='qqbot_stream_message'?{...tool,handler:async(args,ctx)=>{let s;try{s=await call({action:'reply-settings'},ctx.signal);}catch{}if(['voice','both'].includes(s?.qq))return {failed:true,text:'当前QQ回复设置包含语音，请用qqbot_send_message提交完整文字；不会发送这段文字流。'};return tool.handler(args,ctx);}}:tool.name!=='qqbot_send_message'?tool:{...tool,desktopEcology:true,handler:(args,ctx)=>deliverQQReply({args,ctx,host:host(),call,send:value=>tool.handler(value,ctx)})});}
export async function deliverQQReply({args,ctx={},host,call,send}){
 if(typeof args.text!=='string'||!args.text.trim()||args.image||args.voice||args.keyboard||args.format==='markdown')return send(args);
 let settings;try{settings=await call({action:'reply-settings'},ctx.signal);}catch{return send(args);}
 if(settings.qq==='auto')return send(args);
 const events=host?.store.range({source:'qq-official'})||[],incoming=events.filter(e=>e.type==='qq-official.message'&&(!args.to||args.to===e.meta?.target?.kind+':'+e.meta?.target?.id)).at(-1);
 const key=createHash('sha256').update(JSON.stringify({to:args.to,reply_to:args.reply_to,cursor:incoming?.cursor||ctx.callId,text:args.text})).digest('hex');
 const claimed=await call({action:'reply-claim',key,senderKey:incoming?.senderKey},ctx.signal);
 if(claimed.duplicate)return {text:'此回复已有投递记录：'+claimed.delivery.status+'。未重复发送；结果不确定时不要重发。',failed:claimed.delivery.status!=='sent'};
 const d=claimed.delivery,parts=[];
 try{
  if(d.mode==='text'||d.mode==='both')parts.push({...args});
  if(d.mode==='voice'||d.mode==='both'){
   // Prepare all audio before any network send. Only generation failure can safely fall back to text.
   const chunks=[];let chunk='';for(const cp of args.text){if(chunk.length+cp.length>120){chunks.push(chunk);chunk='';}chunk+=cp;}if(chunk)chunks.push(chunk);
   for(const text of chunks){const audio=await call({action:'reply-render',id:d.id,text},ctx.signal);ctx.signal?.throwIfAborted();
    const event=await host.pushEvent({source:'windows-desktop',type:'windows-desktop.reply-audio',origin:'external',ts:new Date().toISOString(),text:'已准备本次QQ回复语音，尚未发送',blobs:[{bytes:Buffer.from(audio.audio,'base64'),mime:'audio/wav',name:'reply.wav',fallbackText:'本次QQ回复语音'}]},{deliver:false});
    const handle=event.blobs?.[0]?.handle;if(!handle)throw Error('语音附件没有保存成功');const {text:_text,...anchors}=args;parts.push({...anchors,voice:handle});
   }
  }
 }catch{
  // No send has happened. Preserve the complete text, never pretend voice was delivered.
  parts.splice(0,parts.length,{...args});
 }
 let result;
 for(let index=0;index<parts.length;index++){
  ctx.signal?.throwIfAborted();await call({action:'reply-report',id:d.id,index,status:'sending'});
  try{result=await send(parts[index]);}catch(error){await call({action:'reply-report',id:d.id,index,status:'uncertain'}).catch(()=>{});throw error;}
  if(typeof result==='object'&&result?.failed){await call({action:'reply-report',id:d.id,index,status:'uncertain'});return result;}
  await call({action:'reply-report',id:d.id,index,status:'sent'});
 }
 await call({action:'reply-report',id:d.id,index:parts.length,status:'complete'});
 return result;
}
