import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {VoiceModels} from '../voice-models.mjs';import {VoiceOutput} from '../voice-output.mjs';
const config={type:'breezeblue',api_key:'private-fixture',model:'breeze-tts-2',speaker:''};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-shortlist-'));const voice=new VoiceOutput({dir,state:{voiceOutput:{enabled:true,voiceId:1000,speed:1,volume:.85}},save(){}},{generate:async()=>{}});return {dir,voice,models:voice.models,close(){voice.close();assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('pet-shortlist-'));fs.rmSync(dir,{recursive:true,force:true});}};}
function add(m,id){m.invoke('add',{formData:{id,modelName:id,isEnabled:1,configJson:config}});return ['A','B','C'].map(name=>m.invoke('saveVoice',{ttsModelId:id,voiceCode:id+name,voiceName:name}));}
test('migration keeps only the existing current voice without changing provider, speaker, credentials or the full catalogue',()=>{
 const f=fixture();try{const rows=add(f.models,'one');f.models.invoke('useVoice',{voiceId:rows[1].id});const old=structuredClone(f.models.data);delete old.quickVoiceIds;fs.writeFileSync(f.models.file,JSON.stringify(old));
  const migrated=new VoiceModels(f.dir);assert.deepEqual(migrated.data.models,old.models);assert.deepEqual(migrated.data.voices,old.voices);assert.deepEqual(migrated.data.quickVoiceIds,[rows[1].id]);assert.equal(migrated.invoke('voices',{ttsModelId:'one'}).list.filter(v=>v.quickSelected).length,1);
 }finally{f.close();}
});
test('shortlist saves only the explicit selection, scopes updates by provider, persists and rejects foreign IDs atomically',()=>{
 const f=fixture();try{const one=add(f.models,'one'),two=add(f.models,'two');const initial=f.voice.snapshot();assert.equal(initial.voiceOptions.length,1);
  f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'one',voiceIds:[one[0].id,one[2].id]});f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'two',voiceIds:[two[1].id]});
  assert.deepEqual(f.voice.snapshot().voiceOptions.filter(v=>v.group==='one').map(v=>v.name),['A','C']);assert.equal(f.models.active().id,'TTS_Local');assert.deepEqual(new VoiceModels(f.dir).data.quickVoiceIds,f.models.data.quickVoiceIds);
  const before=JSON.stringify(f.models.data);assert.throws(()=>f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'one',voiceIds:[two[0].id]}),/已变化/);assert.equal(JSON.stringify(f.models.data),before);
  f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'one',voiceIds:[]});assert.equal(f.voice.snapshot().voiceOptions.filter(v=>v.group==='one').length,0);assert.equal(f.voice.snapshot().voiceOptions.filter(v=>v.group==='two').length,1);assert.equal(f.models.invoke('voices',{ttsModelId:'one'}).total,3);
 }finally{f.close();}
});
test('the current voice stays available when clearing a provider shortlist and local voices use the same saved selection flow',()=>{
 const f=fixture();try{const rows=add(f.models,'one');f.voice.modelInvoke('useVoice',{voiceId:rows[1].id});f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'one',voiceIds:[]});assert.deepEqual(f.models.invoke('voices',{ttsModelId:'one'}).list.filter(v=>v.quickSelected).map(v=>v.id),[rows[1].id]);
  const locals=f.models.invoke('voices',{ttsModelId:'TTS_Local'}).list;assert.equal(locals.length,5);const chosen=locals.find(v=>v.ttsVoice==='58');f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'TTS_Local',voiceIds:[chosen.id]});assert.ok(f.voice.snapshot().voiceOptions.some(v=>v.key==='58'));
  f.voice.modelInvoke('useVoice',{voiceId:chosen.id});assert.equal(f.voice.snapshot().selectedVoiceKey,'58');assert.equal(f.models.active().configJson.voiceId,58);assert.equal(new VoiceModels(f.dir).active().configJson.voiceId,58);
 }finally{f.close();}
});
test('refreshing a provider preserves saved IDs while newly discovered voices remain outside the quick dropdown',async()=>{
 const f=fixture();const page=voices=>new Response(JSON.stringify({voices,has_more:false}));try{add(f.models,'one');const remote=(id,name)=>({voice_id:id,name,language_code:'zh'});
  await f.models.syncVoices('one',{fetchImpl:async()=>page([remote('v1','已有')])});const existing=f.models.data.voices.find(v=>v.ttsVoice==='v1');f.voice.modelInvoke('saveQuickVoices',{ttsModelId:'one',voiceIds:[existing.id]});
  await f.models.syncVoices('one',{fetchImpl:async()=>page([remote('v1','已有（更新）'),remote('v2','新发现')])});assert.equal(f.models.data.voices.find(v=>v.ttsVoice==='v1').id,existing.id);assert.deepEqual(f.voice.snapshot().voiceOptions.filter(v=>v.group==='one').map(v=>v.name),['已有（更新）']);
 }finally{f.close();}
});
