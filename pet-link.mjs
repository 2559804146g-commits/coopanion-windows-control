import fs from 'node:fs';
import {createRequire} from 'node:module';
import runtimePaths from './runtime-paths.cjs';
const require=createRequire(runtimePaths.dependencyPackage);
const {WebSocketServer}=require('ws');
const ALLOWED=new Set(['character-report','drag-character','voice-report','voice-stop']);
export class PetLink {
  constructor({server,spatial,action,voice,store,changed=()=>{},measured=()=>{}}){
    Object.assign(this,{spatial,action,voice,store,changed,measured});this.clients=new Set();this.drawHistory=[];this.presentation={shown:false,sound:true,talk:true,volume:100};
    this.wss=new WebSocketServer({noServer:true,maxPayload:65536});
    this.upgrade=(req,socket,head)=>{
      if(req.url!=='/api/original-pet/socket'||req.headers.origin!=='http://127.0.0.1:7797'||!req.socket.remoteAddress?.endsWith('127.0.0.1')){socket.destroy();return;}
      this.wss.handleUpgrade(req,socket,head,ws=>this.wss.emit('connection',ws,req));
    };
    server.on('upgrade',this.upgrade);
    this.wss.on('connection',ws=>{
      // A single original native window owns presentation; previews never connect.
      for(const previous of this.clients)previous.close(1000,'native window replaced');this.clients.clear();this.clients.add(ws);this.presentation.shown=false;this.voice.stop();
      ws.on('message',async raw=>{
        try{
          const m=JSON.parse(String(raw));
          if(m.kind==='presentation'){
            if(!this.store.state.originalPetIntegrated){this.store.state.originalPetIntegrated=true;this.store.save();}
            const p=m.value||{};
            for(const k of ['shown','sound','talk'])if(typeof p[k]==='boolean')this.presentation[k]=p[k];
            if(Number.isFinite(p.volume))this.presentation.volume=Math.max(0,Math.min(100,p.volume));
            this.observation={at:Date.now(),layout:p.layout,skin:p.skin,scale:p.scale,bubbleSize:p.bubbleSize,fontSize:p.fontSize,bubbleSpeed:p.bubbleSpeed,theme:p.theme,roam:p.roam,hoverButtons:p.hoverButtons,clickThrough:p.clickThrough,performance:p.performance,draw:p.draw,voice:p.voice};
            this.measured(p);
            if(p.draw?.at&&p.draw.at!==this.drawHistory.at(-1)?.at){this.drawHistory.push(p.draw);this.drawHistory=this.drawHistory.slice(-40);}
            if(this.store.state.character.enabled!==this.presentation.shown){this.store.state.character.enabled=this.presentation.shown;this.store.save();this.changed();}
            if(!this.canSpeak())this.voice.stop();
          }else if(m.kind==='action'&&ALLOWED.has(m.value?.action)){
            const result=await this.action(m.value);if(ws.readyState===1&&m.id)ws.send(JSON.stringify({type:'result',id:m.id,result}));
          }
        }catch{if(ws.readyState===1)ws.send(JSON.stringify({type:'error',error:'扩展状态未能同步'}));}
      });
      ws.on('close',()=>{this.clients.delete(ws);if(!this.clients.size){this.presentation.shown=false;this.voice.stop();if(!this.closing){this.store.state.character.enabled=false;this.store.save();}this.changed();}});
      ws.on('error',()=>{});this.sendState();
    });
    this.timer=setInterval(()=>this.sendState(),350);
  }
  snapshot(){return {host:'original',connected:this.clients.size>0,shown:this.presentation.shown,...this.observation,drawHistory:this.drawHistory};}
  canSpeak(){return this.clients.size>0&&this.presentation.shown&&this.presentation.sound&&this.presentation.talk&&this.presentation.volume>0;}
  sendState(){if(this.clients.size)this.send({type:'state',value:this.spatial()});}
  send(value){for(const ws of this.clients)if(ws.readyState===1&&ws.bufferedAmount<4*1024*1024)ws.send(JSON.stringify(value));}
  audio(event){
    if(event.type==='audio'){
      const file=this.voice.files.get(event.id);if(!file||!this.canSpeak())return;
      this.send({...event,data:fs.readFileSync(file).toString('base64')});
    }else if(event.type==='stop')this.send(event);
  }
  close(){this.closing=true;clearInterval(this.timer);for(const ws of this.clients)ws.close();this.clients.clear();this.wss.close();}
}
