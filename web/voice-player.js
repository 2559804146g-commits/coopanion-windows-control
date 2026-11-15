export function createVoicePlayer({report}){
 let audio=null,context=null,source=null,analyser=null,buffer=null,current=null;
 const debug={playing:false,lastPlayed:null,ended:null,error:null,energy:0,duration:0};
 function stop(){const old=audio;audio=null;current=null;debug.playing=false;debug.energy=0;if(old){old.pause();old.removeAttribute('src');old.load();}source?.disconnect();analyser?.disconnect();context?.close().catch(()=>{});source=analyser=context=null;}
 async function play(event){
  stop();current=event;const item=audio=new Audio(event.url);item.volume=event.volume??.85;debug.error=null;debug.lastPlayed=event.id;debug.ended=null;
  item.onplaying=()=>{if(item!==audio)return;debug.playing=true;debug.duration=item.duration;void report({action:'voice-report',id:event.id,status:'playing'});};
  item.onended=()=>{if(item!==audio)return;debug.playing=false;debug.ended=event.id;debug.energy=0;void report({action:'voice-report',id:event.id,status:'ended'});};
  item.onerror=()=>{if(item!==audio)return;debug.playing=false;debug.error='声音播放失败';void report({action:'voice-report',id:event.id,status:'error'});};
  try{context=new AudioContext();source=context.createMediaElementSource(item);analyser=context.createAnalyser();analyser.fftSize=256;buffer=new Uint8Array(analyser.fftSize);source.connect(analyser);analyser.connect(context.destination);await context.resume();await item.play();}
  catch(e){if(item!==audio)return;debug.error=e.message;debug.playing=false;void report({action:'voice-report',id:event.id,status:'error'});}
 }
 const events=new EventSource('/api/voice-events');events.onmessage=e=>{try{const event=JSON.parse(e.data);if(event.type==='audio')void play(event);if(event.type==='stop')stop();}catch{}};events.onerror=()=>stop();
 return {debug,stop,energy(){if(!debug.playing||!analyser)return 0;analyser.getByteTimeDomainData(buffer);let sum=0;for(const v of buffer)sum+=((v-128)/128)**2;return debug.energy=Math.sqrt(sum/buffer.length);},get current(){return current;}};
}
