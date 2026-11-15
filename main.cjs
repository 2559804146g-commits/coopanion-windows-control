// The original Coopanion settings window is the only management surface.
const {app,globalShortcut}=require('electron');
const path=require('node:path');const {spawn}=require('node:child_process');
app.setName('她的桌面');app.setPath('userData',path.join(require('./runtime-paths.cjs').dataDir,'electron'));
const single=app.requestSingleInstanceLock();if(!single)app.quit();
let service,quitting=false;
const show=()=>service?.action({action:'original-settings'},'user').catch(e=>console.error(e.message));
app.on('window-all-closed',()=>{});
app.on('second-instance',(_event,argv)=>{if(!argv.includes('--background'))show();});
if(single)app.whenReady().then(async()=>{
 const {installIntegration}=await import('./install-integration.mjs');const installed=installIntegration();
 try{const {installQQIntegration}=await import('./install-qq-integration.mjs');installQQIntegration();}catch(e){console.error('QQ回复方式适配未更新：'+e.message);}
 const {startDesktop}=await import('./server.mjs');const {screen}=require('electron');
 const displays=()=>screen.getAllDisplays().map(d=>({id:String(d.id),primary:d.id===screen.getPrimaryDisplay().id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}));
 const toDipRect=r=>screen.screenToDipRect(null,{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)});
 service=await startDesktop({hooks:{displays,toDipRect}});
 const chat=show;
 const openFile=file=>new Promise((resolve,reject)=>{const child=spawn('notepad.exe',[file],{windowsHide:false,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
 service.setHooks({openFile,show,chat,quit:()=>app.quit()});
 // The original native pet is the only body. Reload its web assets after an integration update.
 const pet=async method=>{const r=await fetch('http://127.0.0.1:17788/api/webui/providers/world%3Adesktop-pet/panels/pet/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"args":[]}'});if(!r.ok)throw Error('原版桌宠未连接');return r.json();};
 if(installed.changed||!service.store.state.originalPetIntegrated){try{const s=await pet('state');if(s.window?.phase==='running'){await pet('closeWindow');await pet('openWindow');}}catch(e){console.error(e.message);}}
 globalShortcut.register('CommandOrControl+Alt+D',()=>void show());globalShortcut.register('CommandOrControl+Alt+P',()=>void service.action({action:'show-character',enabled:!service.embodiment.state.enabled},'user'));
 if(!process.argv.includes('--background'))await show();
}).catch(e=>{console.error(e);app.quit();});
app.on('before-quit',e=>{if(quitting)return;e.preventDefault();quitting=true;globalShortcut.unregisterAll();Promise.resolve(service?.close()).finally(()=>app.quit());});
