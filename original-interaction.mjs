import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import runtimePaths from './runtime-paths.cjs';
const require=createRequire(runtimePaths.dependencyPackage);
const WebSocket=require('ws');
// Reuse the original pet protocol as an ordinary observer. Never take over its
// authenticated window connection or create a second microphone capture.
export class OriginalInteraction {
  constructor(){this.cached={connected:false,enabled:false,ready:false,detail:'正在连接原版语音'};this.busy=false;this.sockets=new Set();}
  snapshot(){return this.cached;}
  async pet(method,args=[]){const r=await fetch('http://127.0.0.1:17788/api/webui/providers/world%3Adesktop-pet/panels/pet/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('原版桌宠暂时不可用');return r.json();}
  async invoke(method,args=[]){const r=await fetch('http://127.0.0.1:17788/api/webui/providers/world%3Adesktop-pet/panels/voice/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('原版语音通道暂时不可用');return r.json();}
  readState(v){return this.cached={connected:true,enabled:v.enabled===true,ready:['running','ready'].includes(v.server?.phase),engine:v.engine,phase:v.server?.phase,modelPhase:v.model?.phase,done:v.model?.done,total:v.model?.total||v.model?.bytes,mic:v.mic?.state,gateOpen:v.input?.open===true,mode:v.input?.mode,hint:v.input?.hint||'',hotkey:v.input?.hotkeyLabel||'',level:v.level,detail:v.model?.phase==='working'?v.model.detail:v.server?.detail||v.mic?.detail||null};}
  async refresh(){if(this.busy)return this.cached;this.busy=true;try{return this.readState(await this.invoke('state'));}catch{this.cached={...this.cached,connected:false,ready:false,detail:'原版语音连接暂时中断'};return this.cached;}finally{this.busy=false;}}
  async enable(enabled){if(typeof enabled!=='boolean')throw Error('需要明确的语音开关');return this.readState(await this.invoke('setEnabled',[enabled]));}
  send(message){
    return new Promise((resolve,reject)=>{const ws=new WebSocket('ws://127.0.0.1:7797/socket?role=pet');this.sockets.add(ws);let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);this.sockets.delete(ws);ws.close();error?reject(error):resolve({ok:true,accepted:true});};
      const timer=setTimeout(()=>finish(Error('原版聊天连接超时，请检查连接后再发送')),5000);
      ws.once('error',()=>finish(Error('原版聊天暂时不可用，文字已保留')));
      ws.once('open',()=>ws.send(JSON.stringify(message),error=>finish(error)));
      ws.once('close',()=>{if(!settled)finish(Error('原版聊天连接已断开'));});
    });
  }
  text(text){text=String(text||'').trim();if(!text||text.length>500)throw Error('请输入1至500字');return this.send({t:'text',text});}
  settings(){return this.pet('openSettings');}
  close(){for(const ws of this.sockets)ws.close();this.sockets.clear();}
}
