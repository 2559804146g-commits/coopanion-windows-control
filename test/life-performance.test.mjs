import test from 'node:test';
import assert from 'node:assert/strict';
import {PerformanceDirector} from '../performance.mjs';
import {LifeRuntime} from '../life.mjs';
import {TaskRuntime} from '../tasks.mjs';

test('actual operation is bracketed by anticipation, dispatch and verification without leaking typed text',async()=>{
 let now=100,called=false;const events=[],p=new PerformanceDirector({clock:()=>now,changed:e=>events.push({...e}),delay:async ms=>{now+=ms;assert.equal(called,false);}});
 const result=await p.perform('typing',{count:7,windowId:'real'},async()=>{called=true;assert.equal(p.snapshot().phase,'act');return 'observed';});
 assert.equal(result,'observed');assert.deepEqual(events.map(e=>[e.kind,e.phase]),[['typing','prepare'],['typing','act'],['verify','act']]);assert.equal(events[0].id,events[1].id);assert.equal(JSON.stringify(events).includes('text'),false);now+=2000;assert.equal(p.snapshot(),null);
});
test('a failed action becomes blocked and cannot create a success gesture',async()=>{const p=new PerformanceDirector({delay:async()=>{}});await assert.rejects(p.perform('click',{},async()=>{throw Error('not dispatched');}));assert.equal(p.snapshot().kind,'blocked');assert.equal(p.history.some(e=>e.kind==='success'),false);});
function fixture(){let now=1800000000000;const store={state:{allowedApps:[],appAccess:{},tasks:[],requests:[],receipts:[]},save(){},event(){},receipt(){return {id:'receipt'};}};const life=new LifeRuntime(store,{clock:()=>now});const env={autonomy:true,quiet:false,idleMs:60000,connected:true,busy:false,tasks:[],music:{available:true,title:'实际歌曲',artist:'歌手',status:'Playing'},resources:[]};return {store,life,env,advance:ms=>now+=ms};}
test('personal opportunities respect quiet, user activity, connection and existing work',()=>{for(const [key,value] of [['autonomy',false],['quiet',true],['idleMs',0],['connected',false],['busy',true],['tasks',[{status:'paused'}]]]){const f=fixture();assert.equal(f.life.opportunity({...f.env,[key]:value}),null);assert.equal(f.store.state.life.lastOpportunity,0);}});
test('same real environment never causes a periodic random activity loop; test files do not create novelty',()=>{const f=fixture();assert.ok(f.life.opportunity(f.env));f.advance(1200001);assert.equal(f.life.opportunity({...f.env,resources:[{id:'test',category:'验收'}]}),null);assert.ok(f.life.opportunity({...f.env,music:{...f.env.music,title:'另一首真实歌曲'}}));});
test('personal intentions deduplicate, persist their reason and complete only from linked execution',async()=>{
 const f=fixture(),i=f.life.intend({title:'看看正在听的歌',reason:'桌面里现在有实际播放状态'});assert.equal(f.life.intend({title:i.title,reason:'另一种说法'}).id,i.id);
 const tasks=new TaskRuntime({store:f.store,capabilities:{read:{description:'实际观察',schema:{type:'object',properties:{}},readOnly:true,execute:async()=>({ok:true,verified:true,output:{observed:true}})}},environment:()=>({autonomy:true,idleMs:60000})});
 const created=tasks.create({title:i.title,purpose:'autonomy',intentionId:i.id,steps:[{id:'read',capability:'read',args:{}}]});assert.equal(i.taskId,created.task.id);assert.throws(()=>tasks.create({title:i.title,purpose:'autonomy',intentionId:i.id,steps:[{id:'read',capability:'read',args:{}}]}));
 f.life.settle(f.store.state.tasks);assert.notEqual(i.status,'done');await tasks.recover();await tasks.flight;f.life.settle(f.store.state.tasks);assert.equal(i.status,'done');assert.equal(f.store.state.experiences.length,1);tasks.stop();
});
