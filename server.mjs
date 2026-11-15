import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DesktopStore } from './store.mjs';
import { WindowsAdapter } from './native.mjs';
import { Embodiment } from './spatial.mjs';
import { MusicController } from './music.mjs';
import { TaskRuntime } from './tasks.mjs';
import { desktopCapabilities } from './capabilities.mjs';
import { AppController } from './app-control.mjs';
import { NeteaseSearch } from './netease-search.mjs';
import { PerformanceDirector } from './performance.mjs';
import { LifeRuntime } from './life.mjs';
import { OriginalInteraction } from './original-interaction.mjs';
import { VoiceOutput } from './voice-output.mjs';
import { PetLink } from './pet-link.mjs';
import {executionProfile} from './execution-profile.mjs';
import {ReplyPolicy} from './reply-policy.mjs';
import {ArtifactLibrary} from './artifact-library.mjs';
import {CoverStudio} from './cover-studio.mjs';
import {SongLibrary} from './song-library.mjs';
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
import runtimePaths from './runtime-paths.cjs';
const FIGURES = runtimePaths.petWeb;
export async function startDesktop({ port = 17830, dataDir = path.join(ROOT, 'data'), adapter = new WindowsAdapter(), hooks = {}, core = true } = {}) {
  const store = new DesktopStore(dataDir), tokenFile = path.join(dataDir, 'bridge-token');
  const replies=new ReplyPolicy(store),artifacts=new ArtifactLibrary(store),replyAudio=new Map();
  const covers=new CoverStudio(store,artifacts);
  const embodiment = new Embodiment(store);
  const life = new LifeRuntime(store), performanceClients = new Set();
  const original = new OriginalInteraction();
  let petLink=null;
  const voiceClients=new Set(),voiceOutput=new VoiceOutput(store,{quiet:()=>store.state.quiet||(core&&!petLink?.canSpeak()),emit:e=>{petLink?.audio(e);for(const c of voiceClients)c.write('data: '+JSON.stringify(e)+'\n\n');}});
  const songs=new SongLibrary(store,artifacts,covers,{voice:voiceOutput});
  const profile=()=>executionProfile({voice:voiceOutput.snapshot(),reply:{desktop:store.state.replyPolicy.desktop,qq:store.state.replyPolicy.qq},capabilities:store.state.capabilityRevision});
  let lastPet=store.state.lastPetCursor??null;
  const performance = new PerformanceDirector({changed:event=>{petLink?.sendState();for(const client of performanceClients)client.write('data: '+JSON.stringify(event)+'\n\n');}});
  const perform = (kind,details,operation) => performance.perform(kind,{...details,...(details.point&&hooks.toDipRect?{point:hooks.toDipRect({x:details.point.x,y:details.point.y,width:1,height:1})}:{})},operation);
  // The user already selected and authorized NetEase use. Preserve that choice;
  // other previously allowed apps retain their original launch-only scope.
  if (store.state.musicAppId && !store.state.appAccess[store.state.musicAppId]) { store.state.appAccess[store.state.musicAppId]='operate'; store.save(); }
  const music = new MusicController({ selection: () => store.state.musicAppId, isAllowed: id => store.state.allowedApps.includes(id) && ['observe','operate'].includes(store.state.appAccess[id]), canControl: id => store.state.appAccess[id]==='operate', launch: id => adapter.launch(id, { actor: 'user', allowed: store.state.allowedApps, workspace: store.workspace }) });
  if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  let desktop = { windows: [], observedAt: null, idleMs: null }, sceneWindows = [], apps = [], stopped = false, busy = false, hello = false, coreBusy = false, lastQq = store.state.lastQqCursor ?? null;
  let qqStatusAt = 0;
  const runtime = { windowsReady: false, appsReady: false, nativeError: null, appsError: null, coreOnline: false, bridgeSeenAt: 0, qqOnline: null, phase: 'idle' };
  const clients = new Set(), verifications = new Set();
  let tasks, appControl;
  const builtinApps = [{ id: 'builtin:notepad', name: '记事本' }, { id: 'builtin:workspace', name: '她的文件夹' }];
  const allApps = () => [...builtinApps, ...apps.filter(a => !a.name.match(/^uninstall|卸载|^(记事本|notepad)$/i))];
  const displays = () => hooks.displays?.() || [];
  const spatialState = () => ({...embodiment.snapshot(sceneWindows, displays(), store.state.speech, store.state.quiet,performance.snapshot()),voiceOutput:voiceOutput.snapshot(),originalVoice:original.snapshot(),performance:performance.snapshot(),ambient:{musicPlaying:music.snapshot().available&&music.snapshot().status==='Playing',quiet:store.state.quiet}});
  const publicState = () => ({ ...store.state, covers: covers.status(), tasks: undefined, requests: undefined, experiences: undefined, capabilityGaps: undefined, voiceOutput:voiceOutput.snapshot(), activity: tasks?.snapshot(), capabilities: tasks?.catalog(), observations: { windows: { source: 'Win32', observedAt: desktop.observedAt, freshness: runtime.windowsReady && Date.now() - desktop.observedAt < 3000 ? 'fresh' : 'unknown' }, music: { source: 'player-controls', observedAt: music.snapshot().observedAt, freshness: music.snapshot().observedAt && Date.now() - Date.parse(music.snapshot().observedAt) < 20000 ? 'fresh' : 'stale' } }, music: music.snapshot(), character: spatialState(), desktop: { ...desktop, idleMs: appControl ? appControl.userIdleMs() : desktop.idleMs }, apps: allApps().map(a => ({ ...a, allowed: store.state.allowedApps.includes(a.id), access: store.state.allowedApps.includes(a.id) ? store.state.appAccess[a.id] || 'launch' : 'off', contentSupported: path.isAbsolute(a.id) && /\.exe$/i.test(a.id) })), workspace: store.workspace, runtime: { ...runtime, taskExecuting: !!tasks?.flight, bridgeOnline: Date.now() - runtime.bridgeSeenAt < 12000 }, now: Date.now() });
  const broadcast = () => { for (const res of clients) res.write('data: update\n\n'); };
  function verifyWindow({ kind, match, linkedReceipt }) {
    let tries = 0;
    const timer = setInterval(() => {
      if (stopped) { clearInterval(timer); verifications.delete(timer); return; }
      refreshWindows(); const found = desktop.windows.find(match);
      if (found) { const prior = store.state.receipts.find(r => r.id === linkedReceipt); store.receipt(kind, { ok: true, verified: true, windowId: found.id, app: found.app, linkedReceipt, planId: prior?.planId ?? null, note: '已在实际 Windows 窗口中核验' }); clearInterval(timer); verifications.delete(timer); broadcast(); }
      else if (++tries >= 12) { store.receipt('window.verification.pending', { ok: false, linkedReceipt, note: '尚未观察到对应窗口，启动结果保持未确认' }); clearInterval(timer); verifications.delete(timer); broadcast(); }
    }, 650);
    verifications.add(timer);
  }
  function refreshWindows() { try { const observed = adapter.snapshot(); const map = w => ({ ...w, dipRect: hooks.toDipRect ? hooks.toDipRect(w.rect) : w.rect }); const { sceneWindows: rawScene, ...visible } = observed; desktop = { ...visible, windows: observed.windows.map(map) }; sceneWindows = (rawScene || observed.windows).map(map); runtime.windowsReady = true; runtime.nativeError = null; hooks.spatial?.(spatialState()); } catch { runtime.windowsReady = false; runtime.nativeError = 'Windows 窗口连接暂时不可用'; } }
  async function refreshApps() { try { apps = await adapter.loadApps(); runtime.appsReady = true; runtime.appsError = null; broadcast(); } catch { runtime.appsError = '应用目录读取失败，可以刷新重试'; } }
  async function action(data, actor) {
    switch (data.action) {
      case 'voice-status': return voiceOutput.snapshot();
      case 'reply-settings': return replies.snapshot();
      case 'reply-configure': if(actor!=='user')throw Error('回复方式由用户选择');return replies.configure(data);
      case 'reply-claim': if(actor!=='model')throw Error('仅供原QQ投递通道使用');return replies.claim({...data,profile:profile()});
      case 'reply-report': {if(actor!=='model')throw Error('仅供原QQ投递通道使用');const result=replies.report(data),d=store.state.deliveries.find(d=>d.id===data.id);if(result.status==='sent'&&data.status==='complete'&&d?.senderKey)tasks.release('qq:'+d.senderKey);return result;}
      case 'reply-render': {
        if(actor!=='model')throw Error('仅供原QQ投递通道使用');
        const d=store.state.deliveries.find(d=>d.id===data.id);if(!d||d.status!=='preparing')throw Error('回复任务已结束或结果待核对，不重复合成');
        if(d.profile.revision!==profile().revision)throw Error('声音设置已变化，本次保留文字回复，请重新发起新回复');
        const text=String(data.text||'');if(!text.trim()||text.length>1200)throw Error('单条语音长度无效');
        const id=randomBytes(16).toString('hex'),file=path.join(voiceOutput.cache,'qq-'+id+'.wav');
        const result=await voiceOutput.generate({text,config:structuredClone(voiceOutput.models.active().configJson)},file);
        replyAudio.set(id,{file,at:Date.now()});while(replyAudio.size>12){const [old,value]=replyAudio.entries().next().value;replyAudio.delete(old);try{fs.unlinkSync(value.file);}catch{}}
        return {id,audio:fs.readFileSync(file).toString('base64'),mime:'audio/wav',duration:result.duration};
      }
      case 'artifact-list': return {items:artifacts.find(data),profile:profile()};
      case 'cover-status': return covers.status();
      case 'song-hot': return songs.hot(data);
      case 'song-library': return songs.list(data);
      case 'song-search': return songs.search(data);
      case 'song-request': return songs.request(data);
      case 'song-request-status': return songs.get(data.id);
      case 'song-cancel': return songs.cancel(data.id);
      case 'song-play': return songs.play(data.workId,data.arrangement);
      case 'cover-create': return covers.create(data);
      case 'cover-cancel': return covers.cancel(data.id);
      case 'voice-models': if(actor!=='user')throw Error('语音模型配置只能由用户调整');return voiceOutput.modelInvoke(data.method,data.args||{});
      case 'voice-model-preview': if(actor!=='user')throw Error('只能由用户试听');return voiceOutput.previewModel(data);
      case 'voice-configure': if(actor!=='user')throw Error('声音设置只能由用户调整');return voiceOutput.configure(data);
      case 'voice-preview': if(actor!=='user')throw Error('只能由用户试听');return {ok:true,id:voiceOutput.speak('你好，我现在可以开口回复你了。','preview:'+Date.now())};
      case 'voice-stop': if(actor!=='user')throw Error('只能由用户停止朗读');voiceOutput.stop();return {ok:true};
      case 'voice-report': {
        if(actor!=='user')throw Error('播放状态仅由声音窗口回报');const result=voiceOutput.report(data);
        if(result.ok&&data.status==='playing'&&store.state.speech?.key===voiceOutput.state.key){store.state.speech.until=Date.now()+(voiceOutput.state.duration+4)*1000;store.save();}return result;
      }
      case 'original-text': if(actor!=='user')throw Error('只能由用户发送聊天');voiceOutput.stop();return original.text(data.text);
      case 'original-voice': if(actor!=='user')throw Error('麦克风只能由用户开启或关闭');return original.enable(data.enabled);
      case 'original-settings': if(actor!=='user')throw Error('设置只能由用户打开');return original.settings();
      case 'set-app-access': {
        if(actor!=='user')throw new Error('应用内容使用范围由用户调整');
        if(!allApps().some(a=>a.id===data.id)||!['off','launch','observe','operate'].includes(data.mode))throw new Error('应用或使用范围无效');
        if(data.mode!=='off'&&data.mode!=='launch'&&(!path.isAbsolute(data.id)||!/\.exe$/i.test(data.id)))throw new Error('此应用暂时只支持打开，尚未接入内容识别');
        store.state.appAccess[data.id]=data.mode==='off'?'launch':data.mode;store.setAllowed(data.id,data.mode!=='off');
        if(data.id===store.state.musicAppId)music.close();return {ok:true};
      }
      case 'app-inspect': return {ok:true,observation:await appControl.session(api=>api.observe(data.appId,data.windowId))};
      case 'capabilities': return { capabilities: tasks.catalog() };
      case 'task-create': return tasks.create(data, actor);
      case 'task-status': return { ok: true, task: data.id ? tasks.get(data.id) : null, activity: data.id ? undefined : tasks.snapshot() };
      case 'task-control': return tasks.control(data.id, data.command);
      case 'task-revise': return tasks.revise(data.id, data.steps);
      case 'task-recheck': return tasks.recheck(data.id);
      case 'record-gap': return tasks.gap(data);
      case 'life-intend': return life.intend(data,actor);
      case 'life-status': return life.snapshot();
      case 'execute-capability': {
        const created = tasks.create({ title: data.title || tasks.capabilities[data.capability]?.description || data.capability, purpose: data.args?.category === '验收' ? 'test' : 'compatibility', notify: false, steps: [{ id: 'operation', capability: data.capability, args: data.args || {} }] }, actor);
        const id = created.task.id, deadline = Date.now() + 80000;
        let t = tasks.get(id);
        while (['queued','running'].includes(t.status) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 150)); t = tasks.get(id); }
        const step = t.steps[0];
        return t.status === 'succeeded' ? { ...step.output, ok: true, verified: true, id: step.receiptId, taskId: id } : { ok: false, verified: false, taskId: id, status: t.status, deferred: t.status === 'waiting', submitted: ['queued','running'].includes(t.status), reason: t.reason || step.reason || '任务已保留，等待执行或核对结果' };
      }
      case 'select-music-player': {
        if (actor !== 'user') throw new Error('播放器由用户选择');
        const app = allApps().find(a => a.id === data.id);
        if (!app || !/cloudmusic\.exe$/i.test(app.id) || !path.isAbsolute(app.id)) throw new Error('目前只支持本机网易云音乐');
        store.state.musicAppId = app.id; store.state.appAccess[app.id]='operate'; store.setAllowed(app.id, true); music.close(); return { ok: true, player: 'netease' };
      }
      case 'music-status': return music.run('status');
      case 'music-control': {
        if (!['play', 'pause', 'next', 'previous'].includes(data.command)) throw new Error('不支持这个音乐操作');
        const result = await music.run(data.command);
        return store.receipt('music.' + data.command, { ...result, verified: result.verified === true }, actor);
      }
      case 'place-character': return embodiment.move(data, sceneWindows, displays(), actor);
      case 'character-report': if (actor !== 'user') throw new Error('仅接受桌面角色回报'); return embodiment.report(data, sceneWindows, displays());
      case 'drag-character': if (actor !== 'user') throw new Error('仅接受用户拖动'); return embodiment.drag(data, displays());
      case 'show-character': if (actor !== 'user') throw new Error('角色显示由用户调整');if(core)await original.pet(data.enabled?'openWindow':'hideWindow');embodiment.enable(data.enabled); hooks.spatial?.(spatialState()); return { ok: true };
      case 'character-act': return embodiment.act(data.word);
      case 'touch-character': if (actor !== 'user') throw new Error('无效触碰'); return store.event('touch', '用户在真实 Windows 桌面上轻轻点了你。可参考当前窗口位置和原计划，通过 desktop_say 自然回应，不用重复介绍功能。');
      case 'observe': refreshWindows(); return publicState();
      case 'write-note': return store.writeNote({ ...data, actor });
      case 'read-note': return store.readNote(data.id, actor);
      case 'open-resource': {
        const { file, resource } = store.resourcePath(data.id);
        if (actor === 'model' && (adapter.idleMs() ?? 0) < 8000) return { ok: false, deferred: true, reason: '用户正在操作，文件已保存，稍后再打开' };
        if (!hooks.openFile) throw new Error('桌面窗口未连接');
        await hooks.openFile(file);
        const receipt = store.receipt('resource.open.requested', { ok: true, submitted: true, resourceId: resource.id, title: resource.title, note: '已请求 Windows 用记事本打开；不代表已完成阅读' }, actor);
        verifyWindow({ kind: 'resource.window.observed', match: w => /notepad\.exe/i.test(w.app) && w.title.includes(path.basename(file, '.md')), linkedReceipt: receipt.id });
        return receipt;
      }
      case 'open-app': {
        const app = allApps().find(a => a.id === data.id); if (!app) throw new Error('应用不在本机目录中');
        const result = await adapter.launch(data.id, { actor, allowed: store.state.allowedApps, workspace: store.workspace });
        const receipt = store.receipt('app.launch.requested', { ...result, appName: app.name }, actor);
        if (result.submitted && data.id === 'builtin:notepad') verifyWindow({ kind: 'app.window.observed', match: w => /notepad\.exe/i.test(w.app), linkedReceipt: receipt.id });
        return receipt;
      }
      case 'focus-window': { const result = adapter.focus(data.id, actor); return store.receipt('window.focus', result, actor); }
      case 'start-plan': return store.startPlan({ title: data.title, reason: data.reason, actor });
      case 'finish-plan': return store.finishPlan(data.id, data.receipts);
      case 'resume-plan': return store.resumePlan(data.id);
      case 'say': { const text = String(data.text || '').trim().slice(0, 250); if (!text) throw new Error('需要说话内容'); const at=Date.now(),key='desktop:'+at;store.state.speech = { text,key,at, until: at + Math.max(9000, text.length * 140) }; store.save();if(replies.desktopSpeech())voiceOutput.speak(text,key);tasks.release('pet'); return { ok: true }; }
      case 'invite': {
        if (actor !== 'user') throw new Error('只有用户可以发起邀请');
        voiceOutput.stop();
        const text = String(data.text || '').trim().slice(0, 1200); if (!text) throw new Error('请写下想一起做的事情');
        const request = tasks.request(text, 'desktop', null, data.testing === true);
        return store.event('invitation', `用户从真实 Windows 桌面邀请你：${text}。原始请求ID：${request.id}。先观察环境和能力，把需要实际操作的目标用desktop_submit_task拆为能力步骤，requestId引用本请求；系统执行、核验、保存进度。纯聊天直接回应。回复桌面用desktop_say，未经要求不向QQ广播。`);
      }
      case 'allow-app': {
        if (actor !== 'user') throw new Error('应用使用范围由用户调整');
        if (!allApps().some(a => a.id === data.id)) throw new Error('应用不存在');
        store.setAllowed(data.id, data.allowed === true); if (data.id === store.state.musicAppId && !data.allowed) music.close(); return { ok: true };
      }
      case 'autonomy': if (actor !== 'user') throw new Error('只有用户可以调整自主活动'); store.state.autonomy = data.enabled === true; store.save(); return { ok: true };
      case 'quiet': if (actor !== 'user') throw new Error('只有用户可以调整安静模式'); store.state.quiet = data.enabled === true;if(store.state.quiet)voiceOutput.stop(); store.save(); return { ok: true };
      case 'refresh-apps': if (actor !== 'user') throw new Error('请稍后重试'); await refreshApps(); return { ok: runtime.appsReady };
      case 'ack': if (actor !== 'model') throw new Error('无效连接'); store.ack(data.id); return { ok: true };
      default: throw new Error('没有这个操作');
    }
  }
  appControl = new AppController({store,adapter,applications:allApps,windows:()=>desktop.windows,refresh:refreshWindows,perform});
  const songSearch = new NeteaseSearch({apps:appControl,music,store});
  tasks = new TaskRuntime({ store, profile,artifact:(id,ctx)=>artifacts.adoptResource(id,ctx),performance:event=>performance.task(event), capabilities: desktopCapabilities({ store, adapter, music, appControl, songSearch, artifacts,covers,songs,perform, observe: () => { refreshWindows(); return publicState(); }, applications: allApps, openFile: () => hooks.openFile, embodiment, windows: () => desktop.windows, displays }), environment: () => ({ autonomy: store.state.autonomy, quiet: store.state.quiet, idleMs: appControl.userIdleMs() }), changed: broadcast });
  const origin = `http://127.0.0.1:${port}`;
  const server = http.createServer(async (req, res) => {
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, origin);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const supplied = req.headers['x-desktop-token'];
    const trusted = typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
    try {
      if (url.pathname === '/api/state' && req.method === 'GET') return json(publicState());
      if(url.pathname==='/api/artifacts'&&req.method==='GET')return json({items:artifacts.snapshot()});
      if(url.pathname.startsWith('/api/artifacts/')&&req.method==='GET'){const {artifact,file}=artifacts.file(url.pathname.slice('/api/artifacts/'.length));res.writeHead(200,{'Content-Type':artifact.mime,'Content-Length':artifact.bytes,'Content-Disposition':'inline'});fs.createReadStream(file).pipe(res);return;}
      if(url.pathname==='/api/artifact-import'&&req.method==='POST'){
        if(trusted||req.headers.origin!==origin)return json({error:'素材导入只能由本机用户操作'},403);
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>20*1024*1024)return json({error:'素材超过20MB'},413);chunks.push(chunk);}
        const a=artifacts.import(url.searchParams.get('name')||'',Buffer.concat(chunks));broadcast();return json({ok:true,id:a.id,duplicate:!!a.duplicate});
      }
      if(url.pathname==='/avatar.html'&&req.method==='GET'){res.writeHead(302,{Location:'http://127.0.0.1:7797/pet'});res.end();return;}
      if (url.pathname === '/api/spatial' && req.method === 'GET') return json(spatialState());
      if (url.pathname === '/api/voice-state' && req.method === 'GET') return json(voiceOutput.snapshot());
      if(url.pathname==='/api/pet-link'&&req.method==='GET')return json(petLink?.snapshot()||{host:'original',connected:false});
      if (url.pathname === '/api/voice-events' && req.method === 'GET'){res.writeHead(200,{'Content-Type':'text/event-stream',Connection:'keep-alive'});res.write('data: {"type":"connected"}\n\n');voiceClients.add(res);req.on('close',()=>voiceClients.delete(res));return;}
      if(url.pathname.startsWith('/api/voice-audio/')&&req.method==='GET'){const id=url.pathname.slice('/api/voice-audio/'.length).replace(/\.wav$/,'');const file=voiceOutput.files.get(id);if(!file||!fs.existsSync(file))return json({error:'声音已过期'},404);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(res);return;}
      if (url.pathname === '/api/performance' && req.method === 'GET') {res.writeHead(200,{'Content-Type':'text/event-stream',Connection:'keep-alive'});res.write('data: '+JSON.stringify(performance.snapshot())+'\n\n');performanceClients.add(res);req.on('close',()=>performanceClients.delete(res));return;}
      if (url.pathname === '/api/updates' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
      if (url.pathname === '/api/bridge/events' && req.method === 'GET') {
        if (!trusted) return json({ error: '连接凭据无效' }, 403);
        runtime.bridgeSeenAt = Date.now();
        if (!hello) {
          hello = true;
          if (!store.state.initialized) {
            store.state.initialized = true; store.save();
            store.event('connected', '真实Windows桌面已接入。此前家具模拟场景已停用。需要时观察环境和能力，理解用户目的并组织持久任务。没有真实需求时安静等待，不自行制造验收、日记或生活经历，不向QQ广播。');
          } else store.event('reconnected', '真实Windows桌面重新连接。先观察activity任务及恢复状态，执行器会接续可安全执行的待办；不重复提交已存在的任务，不重放结果不确定的步骤，不创建验收文件，不广播启动消息。');
        }
        const capabilityRevision = tasks.syncCapabilities(VERSION);
        return json({ events: store.state.events, capabilityRevision });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        if (!trusted && req.headers.origin !== origin) return json({ error: '仅接受本机桌面操作' }, 403);
        if (!String(req.headers['content-type']).startsWith('application/json')) return json({ error: '需要 JSON 内容' }, 415);
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 50000) return json({ error: '内容过长' }, 413); }
        const data = JSON.parse(text || '{}'), actor = trusted ? 'model' : 'user';
        if (url.pathname === '/api/action') { const result = await action(data, actor); broadcast(); return json(result); }
        if (url.pathname === '/api/bridge/phase') { if (!trusted) return json({ error: '连接凭据无效' }, 403); runtime.phase = String(data.state || 'idle'); if(runtime.phase==='model'&&!performance.context)performance.cue('thinking',{},15000); broadcast(); return json({ ok: true }); }
        if (url.pathname === '/api/window') { if (actor !== 'user') return json({ error: '该操作仅面向用户' }, 403); hooks[data.action]?.(); return json({ ok: true }); }
        return json({ error: '操作不存在' }, 404);
      }
      if (req.method !== 'GET') return json({ error: '不支持这个请求' }, 405);
      const decoded = decodeURIComponent(url.pathname),voiceUi=decoded.startsWith('/voice-models/'),base = voiceUi?path.join(ROOT,'bridge/control-ui'):decoded.startsWith('/figure-assets/') ? FIGURES : path.join(ROOT, 'web');
      const file = path.resolve(base, voiceUi?(decoded.slice('/voice-models/'.length)||'index.html'):decoded.startsWith('/figure-assets/') ? decoded.slice('/figure-assets/'.length) : decoded === '/' ? 'index.html' : '.' + decoded);
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json({ error: '文件不存在' }, 404);
      if (path.extname(file) === '.html') res.setHeader('Content-Security-Policy',voiceUi?"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' https: blob:; connect-src 'self'; object-src 'none'; frame-ancestors http://127.0.0.1:17788; base-uri 'none'":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
    } catch (e) { json({ error: e.message || '操作失败' }, 400); }
  });
  petLink=new PetLink({server,spatial:spatialState,action:data=>action(data,'user'),voice:voiceOutput,store,changed:broadcast,measured:p=>{const b=p.layout?.box;if(b&&Number.isFinite(b.w)&&Number.isFinite(b.h)&&b.w>0&&b.h>0)embodiment.body={width:Math.max(24,Math.min(4096,b.w)),height:Math.max(24,Math.min(4096,b.h)),scale:p.scale,source:'original'};}});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  void voiceOutput.warm();
  refreshWindows(); void refreshApps();
  void tasks.recover();
  let lastBroadcast = 0;
  const windowsTimer = setInterval(() => { refreshWindows(); if (Date.now() - lastBroadcast > 2400) { lastBroadcast = Date.now(); broadcast(); } }, 400);
  const pulse = setInterval(() => {
    tasks.tick();
    life.settle(store.state.tasks);
    const contextKey = JSON.stringify({ allowed: store.state.allowedApps, windows: desktop.windows.map(w=>[w.id,w.minimized]), appAccess: store.state.appAccess, music: [music.snapshot().status,music.snapshot().title], files: store.state.resources.map(r=>r.id) });
    const opportunity = tasks.opportunity(contextKey);
    if (opportunity && store.state.autonomy && !store.state.quiet && runtime.phase === 'idle' && !tasks.flight && Date.now() - runtime.bridgeSeenAt < 12000 && (desktop.idleMs || 0) > 45000 && Date.now() - store.state.lastAutonomyAt > 1800000) {
      store.state.lastAutonomyAt = Date.now(); opportunity.lastOpportunity = contextKey; store.save(); store.event('autonomy', `用户暂时空闲，环境变化后有可检查的实际待办「${opportunity.title}」，任务ID ${opportunity.id}。观察任务和能力，尝试只读核对或接续已恢复条件的目标；没有可靠进展就安静等待，不随机打开应用，不反复写日记，不重复结果不确定的操作。`); broadcast();
    }
    const ownOpportunity=life.opportunity({autonomy:store.state.autonomy,quiet:store.state.quiet,idleMs:appControl.userIdleMs(),connected:runtime.coreOnline&&Date.now()-runtime.bridgeSeenAt<12000,busy:runtime.phase!=='idle'||!!tasks.flight,tasks:store.state.tasks,music:music.snapshot(),resources:store.state.resources});
    if(ownOpportunity)store.event('life-opportunity',`现在有一段不打扰用户的空闲。${ownOpportunity.intention?`你保留的打算是「${ownOpportunity.intention.title}」，缘由：${ownOpportunity.intention.reason}，意图ID：${ownOpportunity.intention.id}。`:'可以认识当前真实桌面、正在听的音乐，或接着自己的真实兴趣。'}先用desktop_life_status查看打算，再观察事实与能力。可以用desktop_intend形成一件有缘由的小事，接着用purpose=autonomy的任务执行；intentionId绑定自己的打算。先做短小的真实观察/阅读/自己的整理，不改用户正在听的音乐、不替用户发送消息、不操作未授权内容。不把旧验收当日常、不虚构偏好，不为交差重复写日记。没有值得做的事可以安静；不要把这条系统机会当用户需求或向QQ广播。`);
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 5000);
  async function pollCore() {
    if (coreBusy || stopped) return; coreBusy = true;
    try {
      const r = await fetch('http://127.0.0.1:17788/api/status', { signal: AbortSignal.timeout(2200) }); if (!r.ok) throw new Error(); await r.json(); const reconnected = !runtime.coreOnline; runtime.coreOnline = true; if (reconnected) hooks.coreOnline?.();
      if (Date.now() - qqStatusAt > 30000) {
        qqStatusAt = Date.now();
        try {
          const response = await fetch('http://127.0.0.1:17788/api/webui/providers/world%3Aqq-official/panels/connection/state', { method: 'POST', headers: {'Content-Type':'application/json'}, body:'{"args":[]}', signal: AbortSignal.timeout(2200) });
          if (!response.ok) throw new Error();
          const connection = await response.json(); runtime.qqOnline = connection.enabled === true && connection.status === 'online';
        } catch { runtime.qqOnline = null; }
      }
      const q = await fetch('http://127.0.0.1:17788/api/events?source=qq-official&archive=1&limit=30', { signal: AbortSignal.timeout(2200) });
      const data = await q.json(); const events = (data.events || []).sort((a, b) => a.cursor - b.cursor);
      if (lastQq !== null) for (const e of events.filter(e => e.cursor > lastQq)) {
        if (e.type === 'qq-official.message') {const target=e.meta?.target,to=target&&typeof target.kind==='string'&&typeof target.id==='string'?target.kind+':'+target.id:null;tasks.interrupt('qq:'+e.senderKey,Number.isFinite(Date.parse(e.ts))?Date.parse(e.ts):Date.now()-5000);tasks.request(e.text||'QQ新消息（正文由QQ上下文提供）','qq',String(e.cursor),false,{to,senderKey:e.senderKey,messageId:e.meta?.messageId||e.meta?.id||null});if(!store.state.quiet)embodiment.engage();store.receipt('qq.received',{ok:true,note:'QQ新消息进入同一核心，原任务进度保留'});}
        if (e.type === 'qq-official.sent') {
          runtime.qqOnline = true; embodiment.sent(); store.receipt('qq.sent', { ok: true, verified: true, note: 'QQ 平台确认回复发送成功' });
          tasks.release('qq');
          if(!store.state.deliveries.some(d=>d.senderKey===e.senderKey&&['preparing','sending','partial'].includes(d.status)))tasks.release('qq:'+e.senderKey);
          const plan = store.state.plans.find(p => p.status === 'active');
          if (plan && store.state.autonomy && !store.state.quiet) store.event('continuation', `QQ 平台已确认这次回复发送成功。你原来的桌面计划「${plan.title}」仍未完成，位置和已有结果已保留。请先观察实际状态，再继续原计划；如果现在不适合执行就保持待续。不要重复发送刚才的 QQ 回复，也不需要广播恢复通知。`);
        }
      }
      lastQq = Math.max(lastQq || 0, ...events.map(e => e.cursor));
      if (store.state.lastQqCursor !== lastQq) { store.state.lastQqCursor = lastQq; store.save(); }
    } catch { runtime.coreOnline = false; runtime.qqOnline = null; } finally { coreBusy = false; }
  }
  let petBusy=false;
  async function pollPet(){
    if(petBusy||stopped)return;petBusy=true;
    try{
      const petResponse=await fetch('http://127.0.0.1:17788/api/events?source=desktop-pet&archive=1&limit=30',{signal:AbortSignal.timeout(2200)});
      if(!petResponse.ok)return;
      const petEvents=((await petResponse.json()).events||[]).sort((a,b)=>a.cursor-b.cursor);
      if(lastPet!==null)for(const e of petEvents.filter(e=>e.cursor>lastPet)){
        if(['desktop-pet.message','desktop-pet.speech'].includes(e.type)){tasks.interrupt('pet',Date.parse(e.ts)||Date.now()-5000);tasks.request(e.meta?.text||e.text||'原版桌面新消息','pet',String(e.cursor));}
        if(e.meta?.kind==='say'&&e.text){const key='pet:'+e.cursor;store.state.speech={text:String(e.text).slice(0,1000),key,at:Date.now(),until:Date.now()+Math.max(12000,String(e.text).length*140)};tasks.release('pet');store.save();if(replies.desktopSpeech())voiceOutput.speak(e.text,key);}
      }
      lastPet=Math.max(lastPet||0,...petEvents.map(e=>e.cursor));if(store.state.lastPetCursor!==lastPet){store.state.lastPetCursor=lastPet;store.save();}
    }catch{}finally{petBusy=false;}
  }
  const coreTimer = core ? setInterval(pollCore, 4000) : null; if (core) void pollCore();
  const petTimer=core?setInterval(pollPet,750):null;if(core)void pollPet();
  let originalRefreshAt=0,wasListening=false;
  const originalTimer=setInterval(()=>{if(Date.now()-originalRefreshAt<(voiceOutput.state.status==='playing'?500:3000))return;originalRefreshAt=Date.now();void original.refresh().then(v=>{if(v.gateOpen&&!wasListening)voiceOutput.stop();wasListening=v.gateOpen;});},500);void original.refresh();
  const closeVoice=()=>{voiceOutput.close();petLink.close();for(const c of voiceClients)c.end();voiceClients.clear();};
  server.on('close',()=>{clearInterval(originalTimer);clearInterval(petTimer);original.close();});
  const musicTimer = setInterval(() => { if (!stopped && !busy && (music.snapshot().canObserve || music.snapshot().allowed)) { busy = true; void music.run('status').finally(() => { busy = false; broadcast(); }); } }, 12000);
  return { server, adapter, store, embodiment, tasks, performance, perform, life, voiceOutput, covers, songs, token, publicState, spatialState, action, refreshWindows, setHooks(value) { hooks = { ...hooks, ...value }; refreshWindows(); }, async close() { stopped = true; songs.close(); closeVoice(); tasks.stop(); await covers.close(); clearInterval(windowsTimer); clearInterval(pulse); clearInterval(coreTimer); clearInterval(musicTimer); appControl.close(); music.dispose(); await tasks.drain(); for (const timer of verifications) clearInterval(timer); store.save(); for (const res of clients) res.end(); for(const res of performanceClients)res.end(); await new Promise(resolve => server.close(resolve)); } };
}
