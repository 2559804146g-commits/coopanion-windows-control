import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {VoiceModels} from '../voice-models.mjs';
import {VoiceOutput} from '../voice-output.mjs';
import {synthesizeCloud} from '../cloud-voice.mjs';
import {loadBreezeVoices} from '../breeze-voice.mjs';
const config={type:'breezeblue',api_key:'brz_private_fixture',model:'breeze-tts-2',speaker:'',instructions:'自然、亲切地说话',guidance_scale:4};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-breeze-'));return {dir,models:new VoiceModels(dir),close(){assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('pet-breeze-'));fs.rmSync(dir,{recursive:true,force:true});}};}
function add(models){return models.invoke('add',{formData:{id:'breeze',modelName:'BreezeBlue',isEnabled:1,configJson:config}});}
const page=(voices,more=false,token=null)=>new Response(JSON.stringify({voices,has_more:more,next_page_token:token}),{headers:{'content-type':'application/json'}});
const row=(id,name)=>({voice_id:id,name,language_code:'zh'});
test('Breeze catalogue saves keys masked and chooses a real catalogue voice without changing the default on add',async()=>{
 const f=fixture();const voice=new VoiceOutput({dir:f.dir,state:{},save(){}},{generate:async()=>{}});
 try{add(voice.models);assert.equal(voice.models.active().id,'TTS_Local');assert.equal(voice.models.invoke('get',{id:'breeze'}).configJson.api_key,'********');assert.throws(()=>voice.models.invoke('default',{id:'breeze'}),/加载/);
  await voice.models.syncVoices('breeze',{fetchImpl:async()=>page([row('voc_1','小鱼'),row('voc_2','小鱼')])});
  const first=voice.models.data.voices[0],second=voice.models.data.voices[1];assert.notEqual(first.id,second.id);
  voice.modelInvoke('saveQuickVoices',{ttsModelId:'breeze',voiceIds:[first.id,second.id]});
  voice.modelInvoke('useVoice',{voiceId:second.id});assert.equal(voice.models.active().configJson.speaker,'voc_2');assert.equal(voice.snapshot().selectedVoiceKey,'catalog:'+second.id);assert.equal(voice.snapshot().voiceOptions.filter(v=>v.group==='BreezeBlue').length,2);assert.ok(!JSON.stringify(voice.snapshot()).includes(config.api_key));
  await voice.models.syncVoices('breeze',{fetchImpl:async()=>page([row('voc_2','更新名称')])});assert.equal(voice.models.data.voices[0].id,second.id);assert.equal(voice.snapshot().voices.at(-1).name,'更新名称');assert.equal(new VoiceModels(f.dir).active().configJson.speaker,'voc_2');
 }finally{voice.close();f.close();}
});
test('Breeze pagination authenticates only to official API and a failed refresh retains the whole previous catalogue',async()=>{
 const f=fixture();let count=0;
 try{add(f.models);await f.models.syncVoices('breeze',{fetchImpl:async(url,init)=>{assert.ok(url.startsWith('https://api.breeze.blue/v1/voices?'));assert.equal(init.headers['xi-api-key'],config.api_key);assert.equal(init.redirect,'error');count++;if(count===1)return page([row('voc_1','一')],true,'next');assert.equal(new URL(url).searchParams.get('next_page_token'),'next');return page([row('voc_2','二')]);}});
  const before=fs.readFileSync(f.models.file,'utf8');count=0;await assert.rejects(f.models.syncVoices('breeze',{fetchImpl:async()=>++count===1?page([row('voc_3','三')],true,'later'):new Response('private error '+config.api_key,{status:401})}),/密钥无效/);assert.equal(fs.readFileSync(f.models.file,'utf8'),before);
  await assert.rejects(loadBreezeVoices(config,{fetchImpl:async()=>page([],true,'repeat')}),/分页重复/);
 }finally{f.close();}
});
test('Breeze synthesis uses its own contract, validates PCM, honors speed and produces native WAV',async()=>{
 const f=fixture();const file=path.join(f.dir,'voice.wav'),pcm=Buffer.alloc(4800);for(let i=0;i<2400;i++)pcm.writeInt16LE(Math.sin(i/8)*8000,i*2);
 try{const result=await synthesizeCloud({config:{...config,speaker:'voc_1'},text:'你好。',file,speed:1.2,fetchImpl:async(url,init)=>{assert.equal(url,'https://api.breeze.blue/v1/text-to-speech/voc_1?output_format=pcm');assert.equal(init.headers['xi-api-key'],config.api_key);assert.deepEqual(JSON.parse(init.body),{text:'你好。',model_id:'breeze-tts-2',instructions:config.instructions,voice_settings:{speed:1.2,guidance_scale:4}});return new Response(pcm);}});assert.equal(result.duration,.1);assert.equal(result.engine,'breezeblue');assert.equal(result.sampleRate,24000);assert.ok(result.rms>.1);
  fs.unlinkSync(file);await assert.rejects(synthesizeCloud({config:{...config,speaker:'voc_1'},text:'你好',file,fetchImpl:async()=>new Response('x')}),/有效的声音/);assert.equal(fs.existsSync(file),false);
 }finally{f.close();}
});
test('Breeze abort discards late data and remote failures never reveal the key',async()=>{
 const f=fixture(),file=path.join(f.dir,'late.wav');
 try{const controller=new AbortController();await assert.rejects(synthesizeCloud({config:{...config,speaker:'voc_1'},text:'你好',file,signal:controller.signal,fetchImpl:async()=>{controller.abort();return new Response(Buffer.alloc(100));}}),/打断/);assert.equal(fs.existsSync(file),false);
  await assert.rejects(synthesizeCloud({config:{...config,speaker:'voc_1'},text:'你好',file,fetchImpl:async()=>new Response(config.api_key,{status:402})}),e=>e.message.includes('额度不足')&&!e.message.includes(config.api_key));
 }finally{f.close();}
});
test('Breeze refresh refuses stale credentials and invalid expression parameters leave saved data intact',async()=>{
 const f=fixture();try{add(f.models);const prior=JSON.stringify(f.models.data);assert.throws(()=>f.models.invoke('update',{id:'breeze',formData:{modelName:'BreezeBlue',isEnabled:1,configJson:{...config,guidance_scale:11}}}),/1至10/);assert.equal(JSON.stringify(f.models.data),prior);
  await assert.rejects(f.models.syncVoices('breeze',{fetchImpl:async()=>{f.models.data.models.find(m=>m.id==='breeze').configJson.api_key='changed';return page([row('voc_1','旧账号')]);}}),/配置已变化/);assert.equal(f.models.data.voices.length,0);
 }finally{f.close();}
});
test('Breeze language scopes retrieve Chinese by default and keep imported foreign voices when refreshing Chinese',async()=>{
 const f=fixture();try{add(f.models);
  await f.models.syncVoices('breeze',{language:'',fetchImpl:async(url)=>{assert.equal(new URL(url).searchParams.has('language_code'),false);return page([{...row('voc_en','English voice'),language_code:'en'},row('voc_zh','中文音色')]);}});
  const foreign=f.models.data.voices.find(v=>v.ttsVoice==='voc_en');
  await f.models.syncVoices('breeze',{fetchImpl:async(url)=>{assert.equal(new URL(url).searchParams.get('language_code'),'zh');return page([row('voc_new','新中文音色')]);}});
  assert.ok(f.models.data.voices.some(v=>v.id===foreign.id));assert.ok(!f.models.data.voices.some(v=>v.ttsVoice==='voc_zh'));assert.ok(f.models.data.voices.some(v=>v.ttsVoice==='voc_new'));
 }finally{f.close();}
});
