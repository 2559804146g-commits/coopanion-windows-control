import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
export class AppWorker {
  constructor(){this.sequence=0;this.pending=new Map();}
  start(){
    if(this.child)return;
    const child=spawn('powershell.exe',['-MTA','-NoProfile','-NonInteractive','-File',path.join(root,'app-worker.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
    child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    createInterface({input:child.stdout}).on('line',line=>{try{const data=JSON.parse(line.replace(/^\uFEFF/,''));const p=this.pending.get(data.id);if(p){clearTimeout(p.timer);this.pending.delete(data.id);p.resolve(data.result);}}catch{}});
    const failed=()=>{if(this.child!==child)return;this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('应用连接已断开，请重新观察'));}this.pending.clear();};child.once('error',failed);child.once('exit',failed);
  }
  request(data){
    if(!['observe','setText','invoke','enter','activateText'].includes(data.action))return Promise.reject(new Error('不支持这个应用操作'));
    this.start();const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('应用操作尚未确认，请先重新观察'));this.close();},45000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...data,id})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});});
  }
  close(){const child=this.child;this.child=null;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('应用连接已停止'));}this.pending.clear();if(child){child.stdin.end();child.kill();}}
}
