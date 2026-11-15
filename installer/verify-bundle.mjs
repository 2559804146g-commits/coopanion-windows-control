import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
const root=path.resolve(process.argv[2]||''),scratch=path.resolve(process.argv[3]||'');
assert.ok(fs.existsSync(path.join(root,'Control/bundle-manifest.json')),'bundle manifest required');assert.notEqual(root,scratch);fs.mkdirSync(scratch,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'Control/bundle-manifest.json'))),report={version:manifest.version,files:0,hashes:true,offlineVoice:[],offlineRecognition:null};
for(const [name,v]of Object.entries(manifest.files)){assert.ok(!name.startsWith('data/')&&!name.includes('/home/companion/'),'private deployment found');const b=fs.readFileSync(path.join(root,name));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),v.sha256,name);report.files++;}
assert.ok(!fs.existsSync(path.join(root,'Coopanion/resources/app/node_modules/cortico-world-desktop-pet/web/whale')),'restricted artwork was bundled');
process.env.PATH=path.join(root,'Runtime')+path.delimiter+path.join(process.env.SystemRoot||'C:/Windows','System32');process.env.PET_TTS_MODEL='int8';process.env.DESKTOP_CONTROL_DATA=path.join(scratch,'desktop');
const node=path.join(root,'Runtime/node.exe');
async function voice(voiceId){
 const file=path.join(scratch,'voice-'+voiceId+'.wav'),child=spawn(node,[path.join(root,'Control/tts-worker.cjs')],{cwd:path.join(root,'Control'),env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});let text='',errors='';
 child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>errors+=b);
 const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('offline voice timed out '+errors.slice(-250)));},120000);const done=()=>{try{const v=JSON.parse(text.trim().split('\n').at(-1));clearTimeout(timeout);resolve(v);}catch{reject(Error('offline voice failed '+text+errors.slice(-250)));}};child.once('error',reject);child.stdout.on('data',()=>{if(text.includes('\n')){child.kill();done();}});child.stdin.write(JSON.stringify({id:1,voiceId,text:'你好，我已经准备好了。',speed:1,file})+'\n');});
 assert.ok(result.ok,JSON.stringify(result));assert.ok(result.duration>1&&result.rms>.001);assert.ok(fs.statSync(file).size>10000);return {...result,voiceId,file};
}
for(const id of [1000,3])report.offlineVoice.push(await voice(id));
const req=createRequire(path.join(root,'Coopanion/resources/app/package.json')),sherpa=req('sherpa-onnx-node'),asr=path.join(root,'Models/asr/whisper-small-int8-2024-07-13');
const recognizer=await sherpa.OfflineRecognizer.createAsync({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{tokens:path.join(asr,'small-tokens.txt'),numThreads:2,provider:'cpu',whisper:{encoder:path.join(asr,'small-encoder.int8.onnx'),decoder:path.join(asr,'small-decoder.int8.onnx'),language:'zh',task:'transcribe'}},decodingMethod:'greedy_search'});
const wave=fs.readFileSync(report.offlineVoice[0].file),samples=new Float32Array((wave.length-44)/2);for(let i=0;i<samples.length;i++)samples[i]=wave.readInt16LE(44+i*2)/32768;
const stream=recognizer.createStream();stream.acceptWaveform({sampleRate:wave.readUInt32LE(24),samples});const result=await recognizer.decodeAsync(stream);assert.ok(result.text&&/[你我好准备]/.test(result.text),'offline recognition returned no matching speech');report.offlineRecognition=result.text;
fs.writeFileSync(path.join(scratch,'bundle-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
