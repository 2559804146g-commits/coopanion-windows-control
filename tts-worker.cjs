const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{createRequire}=require('node:module');
const requireApp=createRequire(require('./runtime-paths.cjs').appPackage),sherpa=requireApp('sherpa-onnx-node');
const quantized=process.env.PET_TTS_MODEL==='int8'&&fs.existsSync(path.join(__dirname,'data/voices/kokoro-int8-multi-lang-v1_1/model.int8.onnx'));
const engines=new Map();
const cancelled=new Set(),send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const numThreads=[1,2,4].includes(Number(process.env.PET_TTS_THREADS))?Number(process.env.PET_TTS_THREADS):4;
function load(voiceId){
 const fast=voiceId===1000||process.env.PET_TTS_MODEL==='melo',variant=fast?'vits-melo-tts-zh_en':quantized?'kokoro-int8-multi-lang-v1_1':'kokoro-multi-lang-v1_1';
 process.chdir(path.join(__dirname,'data/voices',variant));
 if(!engines.has(variant)){
  const model=fast?{vits:{model:'model.onnx',tokens:'tokens.txt',lexicon:'lexicon.txt',dictDir:'dict'}}:{kokoro:{model:quantized?'model.int8.onnx':'model.onnx',voices:'voices.bin',tokens:'tokens.txt',dataDir:'espeak-ng-data',dictDir:'dict',lexicon:'lexicon-us-en.txt,lexicon-zh.txt'}};
  engines.set(variant,sherpa.OfflineTts.createAsync({model:{...model,numThreads,provider:'cpu',debug:0},ruleFsts:fast?'date.fst,number.fst,phone.fst':'date-zh.fst,number-zh.fst,phone-zh.fst',maxNumSentences:1}).catch(e=>{engines.delete(variant);throw e;}));
 }
 return engines.get(variant).then(tts=>({tts,variant,fast}));
}
function writeWave(file,audio){
 const data=Buffer.alloc(44+audio.samples.length*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(audio.sampleRate,24);data.writeUInt32LE(audio.sampleRate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);
 let energy=0;for(let i=0;i<audio.samples.length;i++){if(!Number.isFinite(audio.samples[i]))throw Error('语音样本无效');const v=Math.max(-1,Math.min(1,audio.samples[i]));data.writeInt16LE(Math.round(v*32767),44+i*2);energy+=v*v;}
 fs.writeFileSync(file,data);return {duration:audio.samples.length/audio.sampleRate,rms:Math.sqrt(energy/audio.samples.length),sampleRate:audio.sampleRate};
}
let queue=Promise.resolve();
readline.createInterface({input:process.stdin}).on('line',line=>{
 let req;try{req=JSON.parse(line);}catch{return;}
 if(req.op==='cancel'){for(const id of req.ids||[])cancelled.add(id);return;}
 queue=queue.then(async()=>{
  try{
   if(cancelled.has(req.id))throw Error('语音已打断');const at=Date.now(),{tts,variant,fast}=await load(req.voiceId);
   if(req.op==='warm'){send({id:req.id,ok:true,engine:variant,loadMs:Date.now()-at});return;}
   if(cancelled.has(req.id))throw Error('语音已打断');
   const audio=await tts.generateAsync({text:req.text,sid:fast?0:req.voiceId,speed:req.speed,onProgress:()=>!cancelled.has(req.id)});
   if(cancelled.has(req.id))throw Error('语音已打断');
   const result=writeWave(req.file,audio);send({id:req.id,ok:true,...result,engine:variant,generationMs:Date.now()-at});
  }catch(e){send({id:req.id,ok:false,error:e.message});}finally{cancelled.delete(req.id);}
 });
});
