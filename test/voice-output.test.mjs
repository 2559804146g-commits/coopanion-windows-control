import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {VoiceOutput,spokenText,speechSegments} from '../voice-output.mjs';
function fixture(options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-voice-')),store={dir,state:{},save(){}},events=[];const voice=new VoiceOutput(store,{generate:async(_job,file)=>{fs.writeFileSync(file,Buffer.alloc(100));return {duration:.1,rms:.1};},emit:e=>events.push(e),...options});return {voice,store,events,close(){voice.close();assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('pet-voice-'));fs.rmSync(dir,{recursive:true,force:true});}};}
const settle=async voice=>{for(let i=0;i<100&&voice.flight;i++)await new Promise(r=>setTimeout(r,5));assert.equal(voice.flight,false);};
test('spoken replies keep prose and remove markup, code blocks and long addresses',()=>{const t=spokenText('**你好**，[说明](https://example.com)\n```js\nconsole.log(1)\n```');assert.equal(t.includes('https:'),false);assert.equal(t.includes('console.log'),false);assert.match(t,/你好/);assert.match(t,/说明/);assert.ok(spokenText('文'.repeat(5000)).length<=1200);});
test('audio is complete only after matching renderer playback reports, not after synthesis',async()=>{const f=fixture();try{const id=f.voice.speak('你好','reply');await new Promise(r=>setTimeout(r,10));assert.equal(f.voice.state.status,'ready');assert.equal(f.voice.report({id:'foreign',status:'ended'}).stale,true);assert.equal(f.voice.state.status,'ready');f.voice.report({id,status:'playing'});assert.equal(f.voice.state.status,'playing');f.voice.report({id,status:'ended'});await settle(f.voice);assert.equal(f.voice.state.lastPlayed,id);assert.equal(f.voice.speak('你好','reply'),null);}finally{f.close();}});
test('muting, quiet mode and invalid settings cannot enqueue or partially change preferences',()=>{const f=fixture();try{assert.throws(()=>f.voice.configure({enabled:false,voiceId:999}));assert.equal(f.store.state.voiceOutput.enabled,true);f.voice.configure({enabled:false});assert.equal(f.voice.speak('不要读'),null);f.voice.configure({enabled:true});f.voice.quiet=()=>true;assert.equal(f.voice.speak('安静时不读'),null);assert.equal(f.events.some(e=>e.type==='audio'),false);}finally{f.close();}});
test('new user input interrupts generation and late audio cannot play or report completion',async()=>{let release;const gate=new Promise(r=>release=r),f=fixture({generate:async(_job,file)=>{await gate;fs.writeFileSync(file,Buffer.alloc(100));return {duration:.1,rms:.1};}});try{const id=f.voice.speak('旧的回复','old');f.voice.stop();release();await settle(f.voice);assert.equal(f.events.some(e=>e.type==='audio'),false);assert.equal(f.voice.report({id,status:'ended'}).stale,true);assert.equal(f.voice.state.status,'idle');}finally{f.close();}});
const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert.ok(predicate());};
test('long replies keep all content and begin with a bounded natural opening',()=>{
 const text='我在呢。你可以把想做的事情告诉我，我会先看一看当前桌面，再陪你一起慢慢完成。';
 const parts=speechSegments(text);assert.equal(parts[0],'我在呢。');assert.equal(parts.join(''),text);
 const unbroken='鲸🐳'.repeat(100),long=speechSegments(unbroken);assert.equal(long.join(''),unbroken);assert.ok(Array.from(long[0]).length<=24);assert.ok(long.every(x=>Array.from(x).length<=40));
});
test('next clause is synthesized during playback, in order, with completion only after the whole reply',async()=>{
 const generated=[],f=fixture({generate:async(job,file)=>{generated.push(job.text);fs.writeFileSync(file,Buffer.alloc(100));return {duration:.1,rms:.1};}});
 try{
  const reply=f.voice.speak('我在呢。我们一起完成。','pipeline');
  await until(()=>f.events.filter(e=>e.type==='audio').length===1&&generated.length===2);
  const first=f.events.find(e=>e.type==='audio');assert.equal(first.id,reply);assert.equal(f.voice.state.lastPlayed,undefined);
  f.voice.report({id:first.id,status:'playing'});f.voice.report({id:first.id,status:'ended'});
  await until(()=>f.events.filter(e=>e.type==='audio').length===2);
  const second=f.events.filter(e=>e.type==='audio')[1];assert.equal(second.replyId,reply);assert.equal(f.voice.state.lastPlayed,undefined);
  assert.equal(f.voice.report({id:first.id,status:'ended'}).stale,true);
  f.voice.report({id:second.id,status:'playing'});f.voice.report({id:second.id,status:'ended'});await settle(f.voice);
  assert.equal(f.voice.state.lastPlayed,reply);assert.deepEqual(generated,['我在呢。','我们一起完成。']);
 }finally{f.close();}
});
test('barge-in drops prefetched clauses while retaining the loaded worker for the next reply',async()=>{
 let release,generated=0,kills=0;const gate=new Promise(r=>release=r);
 const f=fixture({generate:async(_job,file)=>{if(++generated===2)await gate;fs.writeFileSync(file,Buffer.alloc(100));return {duration:.1,rms:.1};}});
 try{
  const worker={stdin:{write(){},end(){}},kill(){kills++;}};f.voice.child=worker;f.voice.engineReady=true;
  f.voice.speak('第一句。取消这一句。');await until(()=>generated===2);
  f.voice.stop();assert.equal(f.voice.child,worker);assert.equal(f.voice.engineReady,true);assert.equal(kills,0);
  release();await settle(f.voice);assert.equal(f.events.filter(e=>e.type==='audio').length,1);
  const id=f.voice.speak('新回复。');await until(()=>f.voice.current?.id===id);f.voice.report({id,status:'ended'});await settle(f.voice);assert.equal(f.voice.state.lastPlayed,id);
 }finally{f.close();}
});
test('cancelling the short opening buffer cannot leak audio from a cancelled reply',async()=>{
 let generated=0,release;const gate=new Promise(r=>release=r),f=fixture({generate:async(_job,file)=>{if(++generated===2)await gate;fs.writeFileSync(file,Buffer.alloc(100));return {duration:.1,rms:.1};}});
 try{f.voice.configure({voiceId:1000});f.voice.speak('开头。后续内容。');await until(()=>generated===2);f.voice.stop();release();await settle(f.voice);assert.equal(f.events.some(e=>e.type==='audio'),false);}finally{f.close();}
});
test('changing voice while a model warms waits for the selected model instead of reporting the old one ready',async()=>{
 const f=fixture(),releases=new Map();f.voice.customGenerate=null;f.voice.request=({voiceId})=>new Promise(resolve=>releases.set(voiceId,resolve));
 try{const warming=f.voice.warm();f.voice.configure({voiceId:1000});releases.get(3)({engine:'kokoro'});await until(()=>releases.has(1000));assert.equal(f.voice.engineReady,false);releases.get(1000)({engine:'melo'});await warming;assert.equal(f.voice.engineReady,true);assert.equal(f.voice.engine,'melo');}finally{f.close();}
});
