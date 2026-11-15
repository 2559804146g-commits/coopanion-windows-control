import test from 'node:test';
import assert from 'node:assert/strict';
import { AppController } from '../app-control.mjs';
import { MusicController } from '../music.mjs';
import { parseSongs, exactSongMatch, explicitSongRequest, NeteaseSearch } from '../netease-search.mjs';

const appId='G:\\Music\\cloudmusic.exe';
test('explicit requested artist and title remain grounded in original text despite model spelling mistakes',async()=>{
 const store={state:{requests:[{id:'request',text:'请帮我播放马頔的《南山南》，原唱普通版'}]}};
 const search=new NeteaseSearch({store,apps:{access(){throw Error('不应到达应用');}}});
 assert.deepEqual(explicitSongRequest(store.state.requests[0].text),{artist:'马頔',title:'南山南'});
 const result=await search.search({title:'南山南',artist:'马顓'},{task:{requestId:'request'}});
 assert.equal(result.blocked,true);assert.equal(result.accepted,false);assert.match(result.reason,/马頔/);
 search.results.set('wrong',{title:'南山南',artist:'另一歌手'});
 assert.equal((await search.play({resultId:'wrong'},{task:{requestId:'request'}})).blocked,true);
 assert.equal(explicitSongRequest('想听点音乐'),null);
});
function fixture(mode='operate'){
 let now=0,tick=100,idle=60000;const calls=[];
 const store={state:{allowedApps:[appId],appAccess:{[appId]:mode},musicAppId:appId},save(){}};
 const nodes=[{id:'edit',role:42,name:'搜索',value:'旧内容',enabled:true,offscreen:false,readOnly:false,protectedValue:false},{id:'button',role:43,name:'搜索',enabled:true,offscreen:false}];
 const adapter={idleMs:()=>idle,lastInputTick:()=>tick,focus:()=>({ok:true})};
 const worker={request:async data=>{calls.push(data);if(data.action==='observe')return {ok:true,observation:{snapshotId:'frame',nodes,window:256,appPath:appId,capturedAt:new Date().toISOString()}};return {ok:true,accepted:true};},close(){}};
 const apps=new AppController({store,adapter,applications:()=>[{id:appId}],windows:()=>[{id:'100:1',app:'cloudmusic.exe'}],refresh(){},worker,clock:()=>now});
 return {apps,store,nodes,calls,setClock:n=>now=n,setTick:n=>tick=n,setIdle:n=>idle=n};
}
test('launch permission never silently becomes application content access',async()=>{const f=fixture('launch');await assert.rejects(f.apps.observe(appId),/观察/);assert.equal(f.calls.length,0);f.store.state.appAccess[appId]='observe';const o=await f.apps.observe(appId);assert.equal(o.contentTrust,'untrusted_application_content');assert.throws(()=>f.apps.frame(appId,o.snapshotId,'edit'),/操作/);f.apps.close();});
test('revocation and stale or foreign observations cannot trigger native input',async()=>{const f=fixture();const o=await f.apps.observe(appId);f.setClock(26000);await assert.rejects(f.apps.setText({appId,snapshotId:o.snapshotId,nodeId:'edit',text:'新内容'}),/过期/);f.setClock(0);f.store.state.allowedApps=[];await assert.rejects(f.apps.setText({appId,snapshotId:o.snapshotId,nodeId:'edit',text:'新内容'}),/获准/);assert.deepEqual(f.calls.map(x=>x.action),['observe']);f.apps.close();});
test('protected fields and sensitive controls are rejected before invocation',async()=>{const f=fixture();await f.apps.observe(appId);f.nodes[0].protectedValue=true;assert.throws(()=>f.apps.frame(appId,'frame','edit'),/受保护/);f.nodes[1].name='购买并支付';await assert.rejects(f.apps.invoke({appId,snapshotId:'frame',nodeId:'button',expectText:'已购买'}),/超出/);assert.equal(f.calls.length,1);f.apps.close();});
test('injected input does not look like user activity, while real new input interrupts',()=>{const f=fixture();f.apps.recordInput({beforeInputTick:100,afterInputTick:9100});f.setTick(9100);f.setIdle(30);assert.equal(f.apps.userIdleMs(),9030);f.setTick(9200);assert.equal(f.apps.userIdleMs(),30);assert.throws(()=>f.apps.focus({windowId:'100:1'}),/正在操作/);f.apps.close();});
test('read-only music permission permits observation but never changes playback',async()=>{let calls=[];const m=new MusicController({selection:()=>appId,isAllowed:()=>true,canControl:()=>false,launch(){throw Error('不应启动');},workerFactory:()=>({request:async command=>{calls.push(command);return {ok:true,state:{available:true,status:'Playing'}};},close(){}})});assert.equal((await m.run('status')).state.available,true);assert.equal((await m.run('pause')).ok,false);assert.deepEqual(calls,['status']);m.dispose();});

function songObservation(){return {snapshotId:'songs',appId,windowId:'100:1',nodes:[
 {id:'row',role:20,name:'01 南山南 jymaster Tag: 原唱 马頔 孤岛 like 05:25',enabled:true,offscreen:false,x:0,y:100,width:1000,height:100},
 {id:'titleBox',parentId:'row',role:20,name:'南山南',x:100,y:110,width:300,height:20},
 // Album link deliberately precedes and is shallower than performer link.
 {id:'album',parentId:'row',role:30,name:'孤岛',x:650,y:140},
 {id:'artistBox',parentId:'row',role:20,name:'马頔',x:100,y:135,width:300,height:25},
 {id:'title',parentId:'titleBox',role:41,name:'南山南',x:100,y:110,width:70,height:20,offscreen:false},
 {id:'artist',parentId:'artistBox',role:30,name:'马頔',x:100,y:140}
 ]};}
test('song metadata distinguishes performer from album despite tree ordering',()=>{const [song]=parseSongs(songObservation());assert.equal(song.title,'南山南');assert.equal(song.artist,'马頔');assert.equal(song.nodeId,'title');assert.equal(exactSongMatch(song,'南山南','马頔'),true);assert.equal(exactSongMatch({...song,title:'南山南 (原唱 马頔)',artist:'翻唱者'},'南山南','马頔'),false);});
test('a currently playing row remains selectable when its index becomes a pause icon',()=>{const o=songObservation();o.nodes.unshift({id:'grid',role:24,name:'grid'});o.nodes[1].parentId='grid';o.nodes[1].name=o.nodes[1].name.replace(/^01 /,'pause ');const song=parseSongs(o)[0];assert.equal(exactSongMatch(song,'南山南','马頔'),true);});
test('search chooses the highest-ranked exact version and does not claim playback',()=>{const f=fixture();const search=new NeteaseSearch({apps:f.apps,music:{},store:f.store});const found=search.remember(songObservation(),'南山南','马頔');assert.equal(found.bestMatch.artist,'马頔');assert.match(found.note,/尚未播放/);assert.equal(search.remember(songObservation(),'南山南','其他歌手').bestMatch,null);f.apps.close();});
test('a result lost across restart cannot be replayed, but actual playback can be reconciled',async()=>{const f=fixture();const search=new NeteaseSearch({apps:f.apps,music:{run:async()=>({state:{status:'Playing',title:'南山南',artist:'马頔'}})},store:f.store});const lost=await search.play({resultId:'old-result'},{step:{},interrupted:()=>false});assert.equal(lost.blocked,true);const recovered=await search.recoverPlay({targetSong:{title:'南山南',artist:'马頔'}});assert.equal(recovered.verified,true);assert.equal(f.calls.length,0);f.apps.close();});
