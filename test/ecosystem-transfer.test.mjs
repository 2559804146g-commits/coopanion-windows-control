import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DesktopStore} from '../store.mjs';import {TaskRuntime} from '../tasks.mjs';import {ReplyPolicy,formatReplyItems} from '../reply-policy.mjs';import {executionProfile,revisionOf} from '../execution-profile.mjs';import {ArtifactLibrary} from '../artifact-library.mjs';import {deliverQQReply,wrapQQTools} from '../integration/qq-reply.mjs';
import {startDesktop} from '../server.mjs';
const schema={type:'object',properties:{}};
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pet-ecosystem-'));return {dir,store:new DesktopStore(dir),close(){assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('pet-ecosystem-'));fs.rmSync(dir,{recursive:true,force:true});}};}
const cap=execute=>({description:'真实读取',schema,readOnly:true,execute});
test('task profile is frozen and overlapping QQ and desktop interruptions resume only after both replies',async()=>{
 const f=fixture();let release,count=0;const gate=new Promise(r=>release=r),settings={revision:'saved',voice:'one'};
 const rt=new TaskRuntime({store:f.store,profile:()=>settings,capabilities:{read:cap(async()=>{if(++count===1)await gate;return {ok:true,verified:true,output:{count}};})}});
 try{await rt.recover();const req=rt.request('读两步','qq','cursor',false,{to:'c2c:owner',senderKey:'qq.owner'}),a=rt.create({title:'持续阅读',requestId:req.id,steps:[{id:'a',capability:'read'},{id:'b',capability:'read'}]});settings.voice='two';rt.interrupt('qq:owner');rt.interrupt('pet');release();await rt.flight;assert.equal(count,1);rt.release('qq:owner');await rt.flight;assert.equal(count,1);assert.equal(rt.get(a.task.id).status,'paused');assert.throws(()=>rt.control(a.task.id,'resume'),/待回应/);rt.release('pet');await rt.flight;assert.equal(count,2);const t=rt.get(a.task.id);assert.equal(t.profile.voice,'one');assert.equal(t.status,'succeeded');assert.ok(t.continuation.resumedAt);assert.equal(f.store.state.events.at(-1).meta.route.to,'c2c:owner');assert.equal(f.store.state.events.at(-1).meta.requestId,req.id);
 }finally{rt.stop();f.close();}
});
test('the same in-flight task cannot execute twice even through calls without a request ID',async()=>{
 const f=fixture();let release,count=0;const gate=new Promise(r=>release=r);const rt=new TaskRuntime({store:f.store,capabilities:{read:cap(async()=>{count++;await gate;return {ok:true,verified:true};})}});
 try{await rt.recover();const args={title:'同一个实际目标',steps:[{id:'a',capability:'read'}]},a=rt.create(args),b=rt.create(args);assert.equal(a.task.id,b.task.id);assert.equal(b.duplicate,true);release();await rt.flight;assert.equal(count,1);}finally{rt.stop();f.close();}
});
test('execution profile revisions are stable, reflect effective settings, and contain no provider credentials',()=>{
 const voice={activeModel:{id:'provider',type:'breezeblue'},selectedVoiceKey:'voice:1',speed:1,volume:.8,api_key:'never-save-this'},p=executionProfile({voice,reply:{qq:'both'}});assert.equal(JSON.stringify(p).includes(voice.api_key),false);assert.equal(revisionOf({b:2,a:1}),revisionOf({a:1,b:2}));assert.notEqual(p.revision,executionProfile({voice:{...voice,speed:1.1},reply:{qq:'both'}}).revision);
});
test('reply formatting preserves attachments and surrogate pairs without dropping long text',()=>{
 const text='你好🙂'.repeat(600),image={kind:'image',value:'original'};const result=formatReplyItems([{kind:'text',value:text,quote:'same'},image],'both');assert.equal(result[0].value,text);assert.equal(result.filter(r=>r.kind==='voice').map(r=>r.value).join(''),text);assert.ok(result.filter(r=>r.kind==='voice').every(r=>!/[\uD800-\uDBFF]$/.test(r.value)));assert.equal(result.at(-1),image);assert.equal(formatReplyItems([{kind:'voice',value:text}],'text')[0].kind,'text');
});
test('delivery ledger keeps partial sends incomplete and refuses replay after an uncertain result',()=>{
 const f=fixture();try{const p=new ReplyPolicy(f.store);p.configure({channel:'qq',mode:'both'});const d=p.claim({key:'one'}).delivery;assert.throws(()=>p.report({id:d.id,index:0,status:'complete'}),/未确认/);p.report({id:d.id,index:0,status:'sending'});p.report({id:d.id,index:0,status:'sent'});assert.equal(d.status,'partial');assert.equal(p.claim({key:'one'}).duplicate,true);const recovered=new ReplyPolicy(f.store);assert.equal(d.status,'uncertain');p.report({id:d.id,index:1,status:'uncertain'});assert.throws(()=>recovered.report({id:d.id,index:1,status:'sending'}),/不能自动重发/);assert.equal(p.configure({channel:'desktop',mode:'text'}).qq,'both');}finally{f.close();}
});
function qqFixture(mode,{generationError=false,sendError=false}={}){
 const f=fixture(),policy=new ReplyPolicy(f.store),sent=[],archived=[];policy.configure({channel:'qq',mode});
 const host={store:{range:()=>[{cursor:10,type:'qq-official.message',senderKey:'qq.owner',meta:{target:{kind:'c2c',id:'owner'}}}]},pushEvent:async e=>{archived.push(e);return {blobs:[{handle:'log:generated-audio'}]};}};
 const call=async data=>{if(data.action==='reply-settings')return policy.snapshot();if(data.action==='reply-claim')return policy.claim(data);if(data.action==='reply-report')return policy.report(data);if(data.action==='reply-render'){if(generationError)throw Error('no generation');return {audio:Buffer.from('test PCM').toString('base64')};}throw Error('unexpected');};
 const send=async a=>{sent.push(a);return sendError?{failed:true,text:'unknown send result'}:{text:'platform confirmed'};};return {...f,policy,sent,archived,host,call,send};
}
test('QQ both mode routes through the original sender with original recipients and archives actual audio',async()=>{
 const f=qqFixture('both');try{const args={to:'c2c:owner',reply_to:'#3',text:'你好，今天也陪着你。'};await deliverQQReply({...f,args});assert.equal(f.sent.length,2);assert.deepEqual(f.sent[0],args);assert.equal(f.sent[1].to,args.to);assert.equal(f.sent[1].reply_to,args.reply_to);assert.equal(f.sent[1].voice,'log:generated-audio');assert.equal(f.sent[1].text,undefined);assert.equal(f.archived.length,1);assert.equal(f.store.state.deliveries[0].status,'sent');await deliverQQReply({...f,args});assert.equal(f.sent.length,2);}finally{f.close();}
});
test('generation failure falls back once before sending, while uncertain sends never trigger a text resend',async()=>{
 for(const generationError of [true,false]){const f=qqFixture('voice',{generationError,sendError:!generationError});try{const args={to:'c2c:owner',text:'一条回复'};await deliverQQReply({...f,args});assert.equal(f.sent.length,1);assert.equal(!!f.sent[0].text,generationError);if(!generationError){assert.equal(f.store.state.deliveries[0].status,'uncertain');await deliverQQReply({...f,args});assert.equal(f.sent.length,1);}}finally{f.close();}}
});
test('reply settings leave explicit media untouched and prevent text-stream bypass of voice mode',async()=>{
 const f=qqFixture('voice');try{const tools=wrapQQTools([{name:'qqbot_stream_message',handler:f.send},{name:'qqbot_send_message',handler:f.send}],()=>f.host,f.call);assert.equal((await tools[0].handler({text:'stream'},{})).failed,true);assert.equal(f.sent.length,0);await tools[1].handler({image:'log:existing',text:'caption'},{});assert.equal(f.sent.length,1);assert.equal(f.sent[0].image,'log:existing');}finally{f.close();}
});
test('artifact imports deduplicate by content and derived cache keys bind sources, settings and actual files',()=>{
 const f=fixture();try{const lib=new ArtifactLibrary(f.store),source=lib.import('source.txt',Buffer.from('original source'));assert.equal(lib.import('other-name.txt',Buffer.from('original source')).id,source.id);assert.equal(lib.snapshot().length,1);
  const written=f.store.writeNote({title:'真实作品',body:'实际生成内容'}),args={sourceIds:[source.id],stage:'cache',recipe:'summarize-v1',profileRevision:'voice-one',fileResourceId:written.resource.id},ctx={task:{id:'task'},step:{id:'step'}};const cached=lib.register(args,ctx);assert.equal(lib.register(args,ctx).reused,true);assert.notEqual(lib.register({...args,profileRevision:'voice-two'},ctx).id,cached.id);assert.equal(lib.find({stage:'source'}).length,1);assert.equal(lib.find({stage:'cache',profileRevision:'voice-one'}).length,1);fs.writeFileSync(lib.file(source.id).file,'changed');assert.throws(()=>lib.file(source.id),/内容已变化/);assert.equal(lib.find({stage:'source'}).length,0);assert.throws(()=>lib.import('unsafe.exe',Buffer.from('not executable')),/请选择/);
 }finally{f.close();}
});
test('local APIs restrict policy changes and imports to the user while real imported bytes are indexed and readable',async()=>{
 const f=fixture(),port=17846,base='http://127.0.0.1:'+port,adapter={snapshot:()=>({observedAt:Date.now(),idleMs:60000,windows:[]}),loadApps:async()=>[],idleMs:()=>60000};const d=await startDesktop({port,dataDir:f.dir,adapter,core:false});
 try{const post=(value,model=false)=>fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',...(model?{'x-desktop-token':d.token}:{Origin:base})},body:JSON.stringify(value)});
  assert.equal((await post({action:'reply-configure',channel:'qq',mode:'voice'},true)).status,400);assert.equal((await post({action:'reply-claim',key:'outside'})).status,400);
  assert.equal((await post({action:'reply-configure',channel:'desktop',mode:'text'})).status,200);assert.equal(d.store.state.replyPolicy.qq,'auto');
  assert.equal((await fetch(base+'/api/artifact-import?name=test.txt',{method:'POST',headers:{'x-desktop-token':d.token},body:'source'})).status,403);
  const imported=await fetch(base+'/api/artifact-import?name=test.txt',{method:'POST',headers:{Origin:base,'Content-Type':'application/octet-stream'},body:'actual imported bytes'}).then(r=>r.json());assert.equal(imported.ok,true);const content=await fetch(base+'/api/artifacts/'+imported.id).then(r=>r.text());assert.equal(content,'actual imported bytes');
  const found=await post({action:'artifact-list',stage:'source',query:'test'},true).then(r=>r.json());assert.equal(found.items.length,1);assert.equal(found.profile.voice.provider,'local');
  const created=await post({action:'task-create',title:'验收素材处理闭环',purpose:'test',steps:[{id:'read',capability:'assets.read_text',args:{id:imported.id}},{id:'write',capability:'notes.write',args:{title:'验收产物',body:{$ref:'read.content'},category:'验收'}},{id:'register',capability:'assets.register',args:{sourceIds:[imported.id],stage:'cache',recipe:'verified-copy',fileResourceId:{$ref:'write.resource.id'}}}]},true).then(r=>r.json());await d.tasks.flight;const task=d.tasks.get(created.task.id);assert.equal(task.status,'succeeded');assert.equal(task.steps[0].output.content,'actual imported bytes');assert.equal(task.steps[2].output.artifact.sourceIds[0],imported.id);assert.equal(task.steps[2].output.artifact.profileRevision,task.profile.revision);assert.equal(d.store.state.experiences.length,0);
 }finally{await d.close();f.close();}
});
