import path from 'node:path';
import { AppWorker } from './native-worker.mjs';

const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const forbidden=/(?:删除|清空|购买|支付|付款|订阅|发送|发布|上传|下载|收藏|点赞|授权|密码|验证码|退出登录|delete|purchase|payment|subscribe|\bsend\b|publish|upload|download|\blike\b|\bcollect\b|password|sign.?out)/i;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export class AppController {
  constructor({store,adapter,applications,windows,refresh,worker=new AppWorker(),clock=Date.now,perform=(_kind,_details,operation)=>operation()}){Object.assign(this,{store,adapter,applications,windows,refresh,worker,clock,perform});this.frames=new Map();this.queue=Promise.resolve();}
  access(appId,operate=false){
    if(!this.store.state.allowedApps.includes(appId))throw new Error('这个应用尚未获准使用');
    const access=this.store.state.appAccess?.[appId]||'launch';
    if(!['observe','operate'].includes(access)||(operate&&access!=='operate'))throw new Error(operate?'尚未允许她操作这个应用的内容':'尚未允许她观察这个应用的内容');
    const app=this.applications().find(a=>a.id===appId);
    if(!app||!path.isAbsolute(appId)||!(/\.exe$/i.test(appId)))throw new Error('尚未接入此应用的可执行文件身份识别');
    return app;
  }
  target(appId,windowId){
    this.access(appId);this.refresh();const processName=path.basename(appId).toLowerCase();
    const candidates=this.windows().filter(w=>w.app.toLowerCase()===processName&&(!windowId||w.id===windowId));
    if(candidates.length!==1)throw new Error(candidates.length?'应用有多个窗口，请根据刚观察的窗口ID选择':'没有找到此应用的实际窗口');
    const w=candidates[0];const [hex,pid]=w.id.split(':');const hwnd=Number.parseInt(hex,16);
    if(!Number.isSafeInteger(hwnd)||!Number.isSafeInteger(Number(pid)))throw new Error('窗口身份无效');
    return {...w,hwnd};
  }
  session(fn){const result=this.queue.then(()=>{if(this.closed)throw new Error('应用连接已停止');return fn(this);});this.queue=result.catch(()=>{});return result;}
  readyForInput(){if(this.closed)throw Object.assign(new Error('应用连接已经停止，未提交新的操作'),{beforeDispatch:true});if((this.userIdleMs()??0)<8000)throw Object.assign(new Error('用户正在操作电脑，保留进度并等待'),{beforeDispatch:true});}
  async observe(appId,windowId){
    const target=this.target(appId,windowId);const result=await this.perform('observe',{windowId:target.id},()=>this.worker.request({action:'observe',window:target.hwnd,appPath:appId}));
    if(!result.ok)throw new Error(result.error||'应用观察失败');
    const available=result.observation.nodes.some(n=>[41,42,43,37,30].includes(n.role));
    const observation={...result.observation,appId,windowId:target.id,source:'Windows accessibility',scope:'visible_application_content',contentTrust:'untrusted_application_content',available,reason:available?null:result.observation.minimized?'应用已最小化，尚未观察到控件':'该应用当前未提供可识别控件，需要后续适配'};
    if(this.frames.size>=8)this.frames.clear();this.frames.set(observation.snapshotId,{appId,windowId:target.id,observation,at:this.clock()});
    return observation;
  }
  frame(appId,snapshotId,nodeId,operate=true){
    this.access(appId,operate);const frame=this.frames.get(snapshotId);
    if(!frame||frame.appId!==appId||this.clock()-frame.at>25000)throw new Error('观察已过期，请重新观察应用');
    const node=frame.observation.nodes.find(n=>n.id===nodeId);if(!node)throw new Error('控件不属于本次观察');
    if(node.protectedValue)throw new Error('不读取或填写受保护的输入框');
    if(!node.enabled||node.offscreen)throw new Error('这个控件当前不可用');
    if(operate&&node.role!==41&&forbidden.test((node.name||'')+' '+(node.action||'')))throw new Error('此操作超出当前通用控件能力，不能通过普通点击执行');
    this.target(appId,frame.windowId);
    return {frame,node};
  }
  focus(frame){
    const blocked=message=>Object.assign(new Error(message),{beforeDispatch:true});
    if((this.userIdleMs()??0)<8000)throw blocked('用户正在操作电脑，请稍后继续');
    const result=this.adapter.focus(frame.windowId,this.adapter.lastInputTick?.()===this.ownInputTick?'user':'model');if(!result.ok)throw blocked(result.reason||'未能进入目标应用');
  }
  recordInput(result){if(result.afterInputTick){if(result.beforeInputTick!==this.ownInputTick)this.physicalInputTick=result.beforeInputTick;this.ownInputTick=result.afterInputTick;}}
  userIdleMs(){const idle=this.adapter.idleMs();const tick=this.adapter.lastInputTick?.();return this.ownInputTick&&tick===this.ownInputTick&&this.physicalInputTick!=null?Math.min(0xffffffff,(idle??0)+((this.ownInputTick-this.physicalInputTick)>>>0)):idle;}
  async setText({appId,snapshotId,nodeId,text}){
    const {frame,node}=this.frame(appId,snapshotId,nodeId);if(node.role!==42||node.readOnly)throw new Error('目标不是可填写的输入框');
    const result=await this.perform('typing',{windowId:frame.windowId,count:[...text].length,point:{x:node.x+node.width/2,y:node.y+node.height/2}},()=>{this.readyForInput();this.frame(appId,snapshotId,nodeId);return this.worker.request({action:'setText',appPath:appId,snapshotId,nodeId,text});});this.frames.delete(snapshotId);
    this.recordInput(result);
    const observation=await this.observe(appId,frame.windowId);
    const fields=observation.nodes.filter(n=>n.role===42&&!n.protectedValue);
    const observed=fields.length===1?fields[0]:fields.find(n=>n.name===node.name&&n.x===node.x&&n.y===node.y&&n.width===node.width);
    const confirmed=observed?.value===text;
    return {ok:confirmed,verified:confirmed,accepted:result.accepted===true,observation,reason:confirmed?null:result.error||'尚未核验输入结果'};
  }
  hasText(observation,text){return observation.nodes.some(n=>n.role!==42&&!n.offscreen&&normalize(n.name)===normalize(text));}
  async invoke({appId,snapshotId,nodeId,expectText,enter=false}){
    const {frame,node}=this.frame(appId,snapshotId,nodeId);
    if(!expectText?.trim())throw new Error('需要明确的界面结果用于核验');
    if(this.hasText(frame.observation,expectText))return {ok:true,verified:true,alreadySatisfied:true,observation:frame.observation};
    if(enter&&node.role!==42)throw new Error('确认输入只用于当前输入框');
    if(enter)this.focus(frame);
    const result=await this.perform('click',{windowId:frame.windowId,point:{x:node.x+node.width/2,y:node.y+node.height/2}},()=>{this.readyForInput();this.frame(appId,snapshotId,nodeId);return this.worker.request({action:enter?'enter':'invoke',appPath:appId,snapshotId,nodeId});});this.frames.delete(snapshotId);
    this.recordInput(result);
    let observation;
    for(let i=0;i<3;i++){await pause(250);observation=await this.observe(appId,frame.windowId);if(this.hasText(observation,expectText))return {ok:true,verified:true,accepted:result.accepted,observation};if(result.error)break;}
    return {ok:false,verified:false,accepted:result.accepted===true,observation,reason:result.error||'应用尚未出现预期结果，不重复操作'};
  }
  async ensureWindow(appId,ctx={interrupted:()=>false}){
    this.access(appId,true);this.refresh();let found=this.windows().filter(w=>w.app.toLowerCase()===path.basename(appId).toLowerCase());
    if(!found.length){const launched=await this.adapter.launch(appId,{actor:'model',allowed:this.store.state.allowedApps,workspace:this.store.workspace});if(!launched.submitted)throw new Error(launched.reason||'尚未启动播放器');for(let i=0;i<20&&!found.length;i++){if(ctx.interrupted())throw new Error('任务已被打断');await pause(500);this.refresh();found=this.windows().filter(w=>w.app.toLowerCase()===path.basename(appId).toLowerCase());}}
    if(found.length!==1)throw new Error('无法确定唯一应用窗口');
    const windowId=found[0].id;if(found[0].minimized)this.adapter.restoreInactive?.(windowId);return windowId;
  }
  async activateSong(target){
    const {frame}=this.frame(target.appId,target.snapshotId,target.nodeId);
    const request={action:'activateText',appPath:target.appId,snapshotId:target.snapshotId,nodeId:target.nodeId,rowName:target.rowName};
    let result=await this.perform('click',{windowId:frame.windowId,point:{x:this.frame(target.appId,target.snapshotId,target.nodeId).node.x,y:this.frame(target.appId,target.snapshotId,target.nodeId).node.y}},()=>{this.readyForInput();this.frame(target.appId,target.snapshotId,target.nodeId);return this.worker.request(request);});
    if(result.error?.includes('foreground_required')&&!result.accepted){this.focus(frame);result=await this.worker.request(request);}
    this.recordInput(result);this.frames.delete(target.snapshotId);return result;
  }
  close(){this.closed=true;this.worker.close();this.frames.clear();}
}

export {normalize as normalizeUiText};
