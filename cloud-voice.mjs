import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {synthesizeBreeze} from './breeze-voice.mjs';
import runtimePaths from './runtime-paths.cjs';
const require=createRequire(runtimePaths.dependencyPackage);
const {WebSocket}=require('ws');
const integer=v=>{const b=Buffer.alloc(4);b.writeUInt32BE(v);return b;};
export function encodeEvent(event,payload={},session=''){
 const data=Buffer.from(JSON.stringify(payload)),sid=Buffer.from(session);
 return Buffer.concat([Buffer.from([0x11,0x14,0x10,0]),integer(event),...(session?[integer(sid.length),sid]:[]),integer(data.length),data]);
}
export function decodeEvent(raw){
 const b=Buffer.from(raw);if(b.length<8)throw Error('语音服务返回了不完整的数据');let off=(b[0]&15)*4;
 const type=b[1]>>4,flags=b[1]&15,compression=b[2]&15;
 const number=()=>{if(off+4>b.length)throw Error('语音数据长度无效');const n=b.readUInt32BE(off);off+=4;return n;};
 const content=()=>{const n=number();if(n>16*1024*1024||off+n>b.length)throw Error('语音数据长度无效');const p=b.subarray(off,off+n);off+=n;return p;};
 if(type===15){const code=number();throw Error('火山语音请求失败，错误码 '+code+'；请检查音色权限和资源配置');}
 if(flags&1)number();const event=flags&4?number():0;
 let session='';if(event>=100||[50,51,52].includes(event))session=content().toString();
 let payload=content();if(compression===1)payload=gunzipSync(payload,{maxOutputLength:16*1024*1024});
 return {type,event,session,payload};
}
export function pcmWave(pcm,rate=24000){
 if(!pcm.length||pcm.length%2)throw Error('云端没有返回有效的声音');
 const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
export function waveInfo(b){
 if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('语音服务未返回 WAV 音频，请核对接口支持的格式');
 let rate,channels,bits,format,pcm;
 for(let o=12;o+8<=b.length;){const size=b.readUInt32LE(o+4),name=b.toString('ascii',o,o+4);if(o+8+size>b.length)throw Error('语音文件不完整');if(name==='fmt '&&size>=16){format=b.readUInt16LE(o+8);channels=b.readUInt16LE(o+10);rate=b.readUInt32LE(o+12);bits=b.readUInt16LE(o+22);}if(name==='data')pcm=b.subarray(o+8,o+8+size);o+=8+size+(size%2);}
 if(format!==1||bits!==16||!rate||!channels||!pcm?.length)throw Error('当前接口需输出16位 PCM WAV 音频');let power=0;for(let i=0;i+1<pcm.length;i+=2)power+=(pcm.readInt16LE(i)/32768)**2;
 return {duration:pcm.length/(rate*channels*2),rms:Math.sqrt(power/(pcm.length/2)),sampleRate:rate};
}
export async function synthesizeCloud({config,text,file,speed=1,signal,WebSocketImpl=WebSocket,fetchImpl=fetch}){
 let wave;
 if(config.type==='huoshan_double_stream'){
  const pcm=await new Promise((resolve,reject)=>{
   const sid=randomUUID(),chunks=[];let size=0,finished=false;
   const ws=new WebSocketImpl('wss://openspeech.bytedance.com/api/v3/tts/bidirection',{headers:{'X-Api-App-Key':config.appid,'X-Api-Access-Key':config.access_token,'X-Api-Resource-Id':config.resource_id,'X-Api-Connect-Id':randomUUID()},handshakeTimeout:10000,maxPayload:16*1024*1024});
   const timer=setTimeout(()=>done(Error('火山语音合成超时，请检查网络')),30000);
   const abort=()=>{try{if(ws.readyState===1)ws.send(encodeEvent(101,{},sid));}catch{}done(Error('语音已打断'));};
   function done(error){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ws.on('error',()=>{});ws.terminate();error?reject(error):resolve(Buffer.concat(chunks));}
   const params={speaker:config.speaker,audio_params:{format:'pcm',sample_rate:24000,speech_rate:Math.round((speed-1)*100)}};
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
   ws.on('open',()=>ws.send(encodeEvent(1)));
   ws.on('unexpected-response',(_req,res)=>{res.resume();done(Error('火山语音连接失败（HTTP '+res.statusCode+'），请检查应用ID、令牌和资源权限'));});
   ws.on('error',()=>done(Error('火山语音连接中断，请检查网络与配置')));
   ws.on('close',()=>{if(!finished)done(Error('火山语音提前断开，声音未完成'));});
   ws.on('message',raw=>{if(finished)return;try{
    const m=decodeEvent(raw);
    if([51,153].includes(m.event))throw Error('火山语音拒绝请求，请检查资源ID、音色权限和余额');
    if(m.event===50)ws.send(encodeEvent(100,{event:100,user:{uid:'desktop-companion'},namespace:'BidirectionalTTS',req_params:params},sid));
    if(m.event===150){ws.send(encodeEvent(200,{event:200,user:{uid:'desktop-companion'},namespace:'BidirectionalTTS',req_params:{...params,text}},sid));ws.send(encodeEvent(102,{},sid));}
    if(m.type===11){size+=m.payload.length;if(size>24*1024*1024)throw Error('单段声音过长');chunks.push(m.payload);}
    if(m.event===152)done();
   }catch(e){done(e);}});
  });
  wave=pcmWave(pcm);
 }else if(config.type==='breezeblue'){
  const timeout=AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(30000)]);
  wave=pcmWave(await synthesizeBreeze(config,text,speed,{signal:timeout,fetchImpl}));
 }else if(config.type==='openai'){
  const r=await fetch(config.url,{method:'POST',headers:{Authorization:'Bearer '+config.api_key,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,voice:config.voice,input:text,response_format:'wav',speed}),signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(30000)])});
  if(!r.ok){await r.body?.cancel();throw Error('云端语音请求失败（HTTP '+r.status+'），请检查接口、密钥和模型');}
  const reader=r.body.getReader(),chunks=[];let n=0;for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>24*1024*1024){await reader.cancel();throw Error('单段声音过长');}chunks.push(value);}wave=Buffer.concat(chunks);
 }else throw Error('不支持的云端语音供应器');
 if(signal?.aborted)throw Error('语音已打断');const info=waveInfo(wave);fs.writeFileSync(file,wave);return {...info,engine:config.type};
}
