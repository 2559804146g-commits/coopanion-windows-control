import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskRuntime } from '../tasks.mjs';
import { DesktopStore } from '../store.mjs';
import { startDesktop } from '../server.mjs';

const empty = { type: 'object', properties: {}, required: [] };
const cap = (execute, extra = {}) => ({ description: '实际操作', schema: empty, verification: '读取实际结果', execute, ...extra });
const done = output => ({ ok: true, verified: true, output });
const step = (id = 'a', capability = 'act', args = {}) => ({ id, capability, args });
function fixture(caps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tasks-'));
  const store = new DesktopStore(dir), env = { idleMs: 60000, autonomy: true, quiet: false };
  const runtime = new TaskRuntime({ store, capabilities: caps, environment: () => env });
  const cleanup = () => { runtime.stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('desktop-tasks-')); fs.rmSync(dir, { recursive: true, force: true }); };
  return { dir, store, env, runtime, cleanup };
}

test('one request creates one execution and test results never become daily experiences', async () => {
  let count = 0; const f = fixture({ act: cap(async () => done({ actual: ++count })) });
  try { await f.runtime.recover(); const r = f.runtime.request('系统验收', 'desktop', null, true); const a = f.runtime.create({ title: '真实操作', requestId: r.id, steps: [step()] }); const b = f.runtime.create({ title: '重复消息', requestId: r.id, steps: [step()] }); await f.runtime.flight; assert.equal(a.task.id, b.task.id); assert.equal(count, 1); assert.equal(f.runtime.get(a.task.id).status, 'succeeded'); assert.equal(f.store.state.experiences.length, 0); } finally { f.cleanup(); }
});
test('an empty execution tick stays idle so genuine autonomous opportunities are not suppressed',async()=>{const f=fixture({act:cap(async()=>done({}))});try{await f.runtime.recover();f.runtime.tick();assert.equal(f.runtime.flight,null);assert.equal(f.runtime.snapshot().busy,false);}finally{f.cleanup();}});

test('a long background render leaves other tasks usable and cancellation stops its own worker',async()=>{
 let ready=false,other=0,cancelled=0;const f=fixture({render:cap(async()=>ready?done({file:'verified'}):{ok:false,pending:true,reason:'后台制作中'},{background:true,cancel:()=>cancelled++}),other:cap(async()=>done({actual:++other}))});
 try{await f.runtime.recover();const a=f.runtime.create({title:'长时间翻唱',purpose:'test',notify:false,steps:[step('render','render')]});await f.runtime.flight;assert.equal(f.runtime.get(a.task.id).status,'waiting');const b=f.runtime.create({title:'同时处理新要求',purpose:'test',notify:false,steps:[step('other','other')]});await f.runtime.flight;assert.equal(other,1);assert.equal(f.runtime.get(b.task.id).status,'succeeded');assert.equal(f.runtime.get(a.task.id).status,'waiting');ready=true;f.runtime.get(a.task.id).steps[0].retryAt=0;f.runtime.tick();await f.runtime.flight;assert.equal(f.runtime.get(a.task.id).status,'succeeded');ready=false;const c=f.runtime.create({title:'停止后台制作',purpose:'test',notify:false,steps:[step('cancel','render')]});await f.runtime.flight;f.runtime.control(c.task.id,'cancel');assert.equal(cancelled,1);assert.equal(f.runtime.get(c.task.id).status,'cancelled');assert.equal(f.store.state.experiences.length,0);}finally{f.cleanup();}
});
test('capability changes notify once and historical opinions cannot override registered capabilities',()=>{
  const f=fixture({act:cap(async()=>done({}))});
  try {
    const a=f.runtime.syncCapabilities('0.5.0'); assert.equal(f.store.state.events.length,1);
    assert.equal(f.runtime.syncCapabilities('0.5.0'),a); assert.equal(f.store.state.events.length,1);
    f.store.state.appAccess['test.exe']='observe'; assert.notEqual(f.runtime.syncCapabilities('0.5.0'),a); assert.equal(f.store.state.events.length,2);
    assert.equal(f.runtime.gap({description:'旧聊天说不能做',capabilityId:'act'}).status,'available');
    assert.equal(f.runtime.gap({description:'自由描述'}).status,'needs_review');
    assert.equal(f.runtime.gap({description:'确实没注册',capabilityId:'missing.action'}).status,'unimplemented');
    const next=new TaskRuntime({store:f.store,capabilities:{act:f.runtime.capabilities.act,'missing.action':cap(async()=>done({}))}});
    assert.equal(f.store.state.capabilityGaps.at(-1).status,'available'); next.stop();
  }finally{f.cleanup();}
});
test('references only consume verified preceding results and invalid fields never execute', async () => {
  let received;
  const f = fixture({ act: cap(async () => done({ resource: { id: 'real-id' } })), read: cap(async args => { received = args; return done({ text: 'read' }); }, { schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }) });
  try { await f.runtime.recover(); const a = f.runtime.create({ title: '连续任务', steps: [step(), step('b', 'read', { id: { $ref: 'a.resource.id' } })] }); await f.runtime.flight; assert.equal(received.id, 'real-id'); assert.equal(f.runtime.get(a.task.id).status, 'succeeded'); assert.throws(() => f.runtime.create({ title: '未知参数', steps: [step('x', 'read', { id: 'a', command: 'arbitrary' })] })); assert.throws(() => f.runtime.create({ title: '先引用未来', steps: [step('a','read',{id:'{{future.resource.id}}'}),step('future')] })); } finally { f.cleanup(); }
});
test('pause and QQ interruption preserve a completed step and resume only remaining work', async () => {
  let release, count = 0; const gate = new Promise(resolve => release = resolve);
  const f = fixture({ first: cap(async () => { await gate; return done({ actual: ++count }); }), act: cap(async () => done({ actual: ++count })) });
  try { await f.runtime.recover(); const a = f.runtime.create({ title:'可中断',steps:[step('a','first'),step('b')] }); f.runtime.interrupt('qq'); release(); await f.runtime.flight; const t=f.runtime.get(a.task.id); assert.equal(t.status,'paused'); assert.equal(t.steps[0].status,'succeeded'); assert.equal(count,1); f.runtime.control(t.id,'pause'); f.runtime.release('qq'); await f.runtime.flight; assert.equal(count,1); f.runtime.control(t.id,'resume'); await f.runtime.flight; assert.equal(count,2); assert.equal(t.status,'succeeded'); } finally {f.cleanup();}
});
test('cancel during an operation retains its evidence and never starts the next step', async () => {
  let release, count=0; const gate = new Promise(resolve => release=resolve); const f=fixture({ act:cap(async()=>{count++;await gate;return done({actual:true});}) });
  try {await f.runtime.recover(); const a=f.runtime.create({title:'停止',steps:[step(),step('b')]});f.runtime.control(a.task.id,'cancel');release();await f.runtime.flight;const t=f.runtime.get(a.task.id);assert.equal(count,1);assert.equal(t.status,'cancelled');assert.equal(t.steps[0].status,'succeeded');assert.equal(t.steps[1].status,'pending');assert.equal(f.store.state.experiences.length,0);}finally{f.cleanup();}
});
test('uncertain side effects and exceptions cannot be automatically replayed', async () => {
  let count=0; const f=fixture({act:cap(async()=>{count++;return {ok:false,accepted:true,verified:false};}),throws:cap(async()=>{throw new Error('结果丢失');})});
  try{await f.runtime.recover();const a=f.runtime.create({title:'切歌结果不明',steps:[step()]});await f.runtime.flight;assert.equal(f.runtime.get(a.task.id).status,'uncertain');assert.throws(()=>f.runtime.control(a.task.id,'resume'));assert.throws(()=>f.runtime.revise(a.task.id,[step('new')]));f.runtime.tick();await f.runtime.flight;assert.equal(count,1);const b=f.runtime.create({title:'调用后断开',steps:[step('x','throws')]});await f.runtime.flight;assert.equal(f.runtime.get(b.task.id).status,'uncertain');}finally{f.cleanup();}
});
test('a proven foreground precondition failure is blocked rather than an unknown side effect',async()=>{const f=fixture({act:cap(async()=>{throw Object.assign(new Error('Windows未允许切换'),{beforeDispatch:true});})});try{await f.runtime.recover();const a=f.runtime.create({title:'等待应用可操作',steps:[step()]});await f.runtime.flight;assert.equal(f.runtime.get(a.task.id).status,'blocked');assert.equal(f.runtime.get(a.task.id).steps[0].output.accepted,false);}finally{f.cleanup();}});
test('permissions are checked again for every step, and resuming does not repeat success', async()=>{
  let allowed=true,count=0;const f=fixture({first:cap(async()=>{count++;allowed=false;return done({actual:true});}),act:cap(async()=>{count++;return done({actual:true});},{check:()=>allowed?null:'权限已撤销'})});
  try{await f.runtime.recover();const a=f.runtime.create({title:'权限改变',steps:[step('a','first'),step('b')]});await f.runtime.flight;assert.equal(count,1);assert.equal(f.runtime.get(a.task.id).status,'blocked');allowed=true;f.runtime.control(a.task.id,'resume');await f.runtime.flight;assert.equal(count,2);assert.equal(f.runtime.get(a.task.id).status,'succeeded');}finally{f.cleanup();}
});
test('autonomy obeys idle, quiet and disable controls rather than forcing an activity',async()=>{
  let count=0;const f=fixture({act:cap(async()=>done({actual:++count}))});
  try{await f.runtime.recover();f.env.autonomy=false;const a=f.runtime.create({title:'自己的待办',purpose:'autonomy',steps:[step()]});await f.runtime.flight;assert.equal(count,0);f.env.autonomy=true;f.env.quiet=true;f.runtime.tick();await f.runtime.flight;assert.equal(count,0);f.env.quiet=false;f.env.idleMs=0;f.runtime.tick();await f.runtime.flight;assert.equal(count,0);f.env.idleMs=60000;f.runtime.tick();await f.runtime.flight;assert.equal(count,1);assert.equal(f.runtime.get(a.task.id).status,'succeeded');}finally{f.cleanup();}
});
test('restart rechecks committed evidence and never replays an unknown non-idempotent step',async()=>{
  let count=0;const f=fixture({safe:cap(async()=>done({actual:++count}),{readOnly:true}),act:cap(async()=>done({actual:++count})),committed:cap(async()=>done({actual:++count}),{recover:async()=>done({recovered:true})})});
  try{const a=f.runtime.create({title:'重启',steps:[step('a','committed'),step('b','safe')]});const t=f.runtime.get(a.task.id);t.status='running';t.steps[0].status='running';const b=f.runtime.create({title:'切歌中重启',steps:[step()]});const u=f.runtime.get(b.task.id);u.status='running';u.steps[0].status='running';f.store.save();const store=new DesktopStore(f.dir);const next=new TaskRuntime({store,capabilities:f.runtime.capabilities,environment:()=>f.env});await next.recover();await next.flight;assert.equal(next.get(t.id).status,'succeeded');assert.equal(next.get(u.id).status,'uncertain');assert.equal(count,1);next.stop();}finally{f.cleanup();}
});
test('unknown capabilities and untrusted prototype fields cannot become executable steps',()=>{
  const f=fixture({act:cap(async()=>done({}))});try{assert.throws(()=>f.runtime.create({title:'不存在',steps:[step('a','shell.exec')]}));assert.throws(()=>f.runtime.create({title:'注入',steps:[{id:'a',capability:'act',args_json:'{"__proto__":{"polluted":true}}'}]}));assert.equal({}.polluted,undefined);const a=f.runtime.gap({description:'尚不能按歌名搜索'}),b=f.runtime.gap({description:'尚不能按歌名搜索'});assert.equal(a.id,b.id);}finally{f.cleanup();}
});
test('an uncertain effect can be reconciled by observation, never by executing again',async()=>{
  let count=0,permission=true;const f=fixture({act:cap(async()=>{count++;return {ok:false,accepted:true};},{check:()=>permission?null:'权限已关闭',recover:async()=>done({actual:'observed'})})});
  try{await f.runtime.recover();const a=f.runtime.create({title:'先核对',steps:[step()]});await f.runtime.flight;permission=false;assert.equal((await f.runtime.recheck(a.task.id)).ok,false);assert.equal(count,1);permission=true;assert.equal((await f.runtime.recheck(a.task.id)).verified,true);assert.equal(f.runtime.get(a.task.id).status,'succeeded');assert.equal(count,1);}finally{f.cleanup();}
});
test('message interruptions never hold a new task created to handle that message',async()=>{
  const f=fixture({act:cap(async()=>done({actual:true}))});try{const old=f.runtime.create({title:'原任务',steps:[step()]}),cutoff=Date.now();const next=f.runtime.create({title:'新消息任务',steps:[step()]});f.runtime.get(next.task.id).createdAt=cutoff+1;f.runtime.interrupt('qq',cutoff);assert.equal(f.runtime.get(old.task.id).status,'paused');assert.equal(f.runtime.get(next.task.id).status,'queued');}finally{f.cleanup();}
});
test('compatibility operations return evidence without duplicate notifications or invented memories',async()=>{
  const f=fixture({act:cap(async()=>done({actual:true}))});try{await f.runtime.recover();const a=f.runtime.create({title:'旧入口调用',purpose:'compatibility',notify:false,steps:[step()]});await f.runtime.flight;assert.equal(f.runtime.get(a.task.id).status,'succeeded');assert.equal(f.store.state.experiences.length,0);assert.equal(f.store.state.events.length,0);}finally{f.cleanup();}
});
test('autonomous rechecks require recoverable work, restored permission and a changed environment',()=>{
  let allowed=false;const f=fixture({act:cap(async()=>done({}),{readOnly:true,check:()=>allowed?null:'未授权'})});try{const a=f.runtime.create({title:'待核对',steps:[step()]});const t=f.runtime.get(a.task.id);t.status='blocked';t.steps[0].status='blocked';assert.equal(f.runtime.opportunity('one'),undefined);allowed=true;assert.equal(f.runtime.opportunity('one').id,t.id);t.lastOpportunity='one';assert.equal(f.runtime.opportunity('one'),undefined);assert.equal(f.runtime.opportunity('two').id,t.id);t.manualPaused=true;assert.equal(f.runtime.opportunity('two'),undefined);}finally{f.cleanup();}
});
test('restart repairs an interrupted receipt link without repeating a verified step',async()=>{
  let count=0;const f=fixture({act:cap(async()=>done({actual:++count}))});try{const a=f.runtime.create({title:'回执链接恢复',steps:[step()]});const t=f.runtime.get(a.task.id);t.status='running';t.steps[0].status='succeeded';t.steps[0].output={actual:true};const r=f.store.receipt('task.step.verified',{ok:true,verified:true,taskId:t.id,stepId:'a',planId:null});await f.runtime.recover();await f.runtime.flight;assert.equal(t.status,'succeeded');assert.equal(t.steps[0].receiptId,r.id);assert.equal(count,0);}finally{f.cleanup();}
});
test('real API performs write -> referenced read with durable per-step evidence',async()=>{
  const f=fixture({});const fake={snapshot:()=>({observedAt:Date.now(),idleMs:60000,windows:[]}),loadApps:async()=>[],idleMs:()=>60000};const d=await startDesktop({port:17840,dataDir:f.dir,adapter:fake,core:false});
  try{const r=await d.action({action:'task-create',title:'系统连续步骤验收',purpose:'test',steps:[step('save','notes.write',{title:'连续任务验收',body:'实际写入并读回，不是生活记忆',category:'验收'}),step('read','notes.read',{id:{$ref:'save.resource.id'}})]},'model');await d.tasks.flight;const t=d.tasks.get(r.task.id);assert.equal(t.status,'succeeded');assert.match(t.steps[1].output.content,/实际写入并读回/);assert.equal(t.steps[0].output.receipt.planId,null);assert.equal(t.steps[0].output.receipt.taskId,t.id);assert.equal(d.store.state.experiences.length,0);const reloaded=new DesktopStore(f.dir);assert.equal(reloaded.state.tasks.find(x=>x.id===t.id).status,'succeeded');}finally{await d.close();f.cleanup();}
});
