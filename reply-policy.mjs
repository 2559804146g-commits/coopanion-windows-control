import {randomUUID} from 'node:crypto';
import {revisionOf} from './execution-profile.mjs';
// Adapted from dsh-dafeiyu-deploy assets/voice-controls/index.mjs (CC0).
export const REPLY_MODES=['auto','text','voice','both'];
export function formatReplyItems(items,mode){
 if(mode==='auto'||!REPLY_MODES.includes(mode))return items;
 return items.flatMap(item=>{
  if(!['text','voice'].includes(item.kind))return [item];
  if(mode==='text')return [{...item,kind:'text'}];
  const value=String(item.value??'');if(!value.trim())return [];
  const chunks=[];let chunk='';for(const cp of value){if(chunk.length+cp.length>400){chunks.push(chunk);chunk='';}chunk+=cp;}if(chunk)chunks.push(chunk);
  const audio=chunks.map(value=>({...item,kind:'voice',value}));return mode==='voice'?audio:[{...item,kind:'text'},...audio];
 });
}
export class ReplyPolicy{
 constructor(store){this.store=store;store.state.replyPolicy||={desktop:'auto',qq:'auto'};store.state.deliveries||=[];for(const d of store.state.deliveries)if(['sending','partial'].includes(d.status))d.status='uncertain';}
 snapshot(){return {...this.store.state.replyPolicy,recent:this.store.state.deliveries.slice(-12).map(({key,...d})=>d)};}
 configure({channel,mode}){if(!['desktop','qq'].includes(channel)||!REPLY_MODES.includes(mode)||(channel==='desktop'&&mode==='voice'))throw Error('此渠道不支持该回复方式');this.store.state.replyPolicy[channel]=mode;this.store.save();return this.snapshot();}
 desktopSpeech(){return this.store.state.replyPolicy.desktop!=='text';}
 claim({channel='qq',key,requestId=null,profile=null,senderKey=null}){
  if(channel!=='qq'||typeof key!=='string'||!key||key.length>500)throw Error('回复标识无效');
  const hash=revisionOf({channel,key}),old=this.store.state.deliveries.find(d=>d.key===hash);if(old)return {duplicate:true,delivery:old};
  const delivery={id:randomUUID(),key:hash,channel,requestId,profile,senderKey,mode:this.store.state.replyPolicy[channel],status:'preparing',createdAt:Date.now(),parts:[]};
  this.store.state.deliveries.push(delivery);this.store.state.deliveries=this.store.state.deliveries.slice(-100);this.store.save();return {duplicate:false,delivery};
 }
 report({id,index,status,receipt=null}){
  const d=this.store.state.deliveries.find(d=>d.id===id);if(!d||!Number.isInteger(index)||index<0||!['sending','sent','failed','uncertain','complete'].includes(status))throw Error('回复回执无效');
  const previous=d.parts.find(p=>p.index===index);
  if(previous?.status==='sent'&&status==='sending')throw Error('该段回复已经发送，不能重发');
  if(previous?.status==='uncertain'&&status==='sending')throw Error('该段发送结果不明，不能自动重发');
  if(status==='complete'){if(!d.parts.length||d.parts.some(p=>p.status!=='sent'))throw Error('仍有未确认的回复片段，不能报为完成');d.status='sent';d.completedAt=Date.now();}
  else{const part={index,status,...(receipt?{receipt:String(receipt).slice(0,120)}:{})};if(previous)Object.assign(previous,part);else d.parts.push(part);d.status=status==='sent'?'partial':status;}
  this.store.save();return {ok:true,status:d.status};
 }
}
