import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {createRequire} from 'node:module';
import {PetLink} from '../pet-link.mjs';
import runtimePaths from '../runtime-paths.cjs';
const require=createRequire(runtimePaths.dependencyPackage),WebSocket=require('ws');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('only the original origin connects; rendering cannot invoke application capabilities or arbitrary file access',async()=>{
 const server=http.createServer(),actions=[],voice={stop(){},files:new Map()},store={state:{character:{enabled:true}},save(){}};
 const link=new PetLink({server,spatial:()=>({revision:'one'}),action:async v=>actions.push(v),voice,store});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='ws://127.0.0.1:'+server.address().port+'/api/original-pet/socket';
 let good;
 try{
  const denied=await new Promise(resolve=>{const ws=new WebSocket(url,{origin:'https://example.com'});ws.on('error',()=>resolve(true));ws.on('open',()=>{ws.close();resolve(false);});});assert.equal(denied,true);
  good=new WebSocket(url,{origin:'http://127.0.0.1:7797'});await new Promise((resolve,reject)=>{good.on('open',resolve);good.on('error',reject);});
  good.send(JSON.stringify({kind:'action',value:{action:'open-app',id:'untrusted.exe'}}));good.send(JSON.stringify({kind:'action',value:{action:'voice-report',id:'audio',status:'ended'}}));await wait(40);
  assert.deepEqual(actions,[{action:'voice-report',id:'audio',status:'ended'}]);
 }finally{good?.close();link.close();await new Promise(r=>server.close(r));}
});
test('the original visibility and master sound switches govern the extended voice without changing its saved voice preference',async()=>{
 const server=http.createServer(),voice={stops:0,stop(){this.stops++;},files:new Map()},store={state:{character:{enabled:true},voiceOutput:{enabled:true,voiceId:1000}},save(){}};
 const link=new PetLink({server,spatial:()=>({}),action:async()=>({}),voice,store});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/api/original-pet/socket',{origin:'http://127.0.0.1:7797'});await new Promise(r=>ws.on('open',r));
 const prefs=async value=>{ws.send(JSON.stringify({kind:'presentation',value}));await wait(25);};
 try{await prefs({shown:true,sound:true,talk:true,volume:50});assert.equal(link.canSpeak(),true);await prefs({sound:false});assert.equal(link.canSpeak(),false);await prefs({sound:true,shown:false});assert.equal(link.canSpeak(),false);assert.equal(store.state.character.enabled,false);assert.equal(store.state.voiceOutput.enabled,true);assert.equal(store.state.voiceOutput.voiceId,1000);}finally{ws.close();link.close();await new Promise(r=>server.close(r));}
});
