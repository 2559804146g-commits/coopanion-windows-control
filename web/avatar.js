import { createBody } from '/figure-assets/kit/body.js';
import { createActingFigure } from './acting-figure.js';
import {ICONS} from '/figure-assets/ui.js';
import {createVoicePlayer} from './voice-player.js';
const native = window.desktopShell, stageEl = document.getElementById('stage'), speech = document.getElementById('speech');
const voicePlayer=native?createVoicePlayer({report:data=>action(data)}):null;
const chatOpener=document.getElementById('chat-opener');
const hoverTools=document.getElementById('hover-tools'),voiceOpener=document.getElementById('voice-opener'),voiceHint=document.getElementById('voice-hint');
const soundOpener=document.getElementById('sound-opener');
soundOpener.onclick=()=>action({action:'voice-configure',enabled:state?.voiceOutput?.enabled!==true});
chatOpener.innerHTML=ICONS.chat;chatOpener.onclick=()=>native?native.talk({x:body.layout().bubble.x,y:body.layout().bubble.y}):location.assign('/#chat');
let toolsUntil=0,voiceBusy=false,hoverPoint=null;
voiceOpener.onclick=async()=>{if(voiceBusy)return;voiceBusy=true;voiceOpener.disabled=true;const result=await action({action:'original-voice',enabled:state?.originalVoice?.enabled!==true});if(result)state.originalVoice=result;voiceBusy=false;voiceOpener.disabled=false;toolsUntil=Date.now()+3500;};
let state, display, body, fetching = false, dragging = null, pendingDrop = false, walking = false, arrived = false;
let revision, anchorKind, commanded, pose, gesture, lastPoll = 0, lastRegion = 0, lastReport = 0, previous = performance.now(), offline = false;
let speechKey = null, speechText = '', speechIndex = 0, lastType = 0, reportBusy = false;
let livePerformance=null, lastSequence=0, manualUntil=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const performanceNow=()=>!offline&&!dragging&&Date.now()>manualUntil&&state?.enabled&&state.engagement?.kind!=='qq'?(livePerformance?.until>Date.now()?livePerformance:state?.performance?.until>Date.now()?state.performance:state?.ambient?.musicPlaying&&!state.ambient.quiet?{kind:'listening',phase:'act',at:0,until:Number.MAX_SAFE_INTEGER}:null):null;
const actionStream=new EventSource('/api/performance');
actionStream.onmessage=e=>{try{const value=JSON.parse(e.data);if(!value){livePerformance=null;return;}if(value.sequence>lastSequence){lastSequence=value.sequence;livePerformance=value;}}catch{}};
actionStream.onerror=()=>{livePerformance=null;};
const origin = () => display?.workArea || { x: 0, y: 0, width: innerWidth, height: innerHeight };
const local = target => ({ x: target.x - origin().x, y: target.y - origin().y });
const globalPoint = p => ({ x: p.x + origin().x, y: (p.y || innerHeight - 10) + origin().y, displayId: String(display?.id || state.target?.displayId) });
async function action(data) {
  try { const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const value = await r.json(); if (!r.ok) throw new Error(value.error); return value; }
  catch { return null; }
}
async function report(isArrived = false) {
  if (reportBusy || !body || !state || dragging || pendingDrop) return;
  reportBusy = true;
  try { await action({ action: 'character-report', ...globalPoint(body.layout()), revision: state.revision, arrived: isArrived }); }
  finally { reportBusy = false; }
}
function navigate() {
  if (!body || !state?.target || dragging || pendingDrop || String(display?.id) !== String(state.target.displayId) || !state.enabled) return;
  const t = local(state.target), l = body.layout(), kind = `${state.target.kind}:${state.target.windowId||''}:${state.target.edge}`;
  if (revision !== state.revision || anchorKind !== kind) { revision = state.revision; anchorKind = kind; walking = false; arrived = false; commanded = null; pose = null; }
  if (arrived) return;
  const distance = Math.hypot(l.x - t.x, (l.y || innerHeight - 10) - t.y);
  if(reduced.matches&&distance>=5){body.stopWalk();body.place(t.x,l.facing,t.y);walking=false;arrived=true;commanded=null;void report(true);return;}
  if (distance < 5) { walking = false; arrived = true; commanded = null; void report(true); return; }
  if (!commanded || Math.hypot(commanded.x - t.x, commanded.y - t.y) > 10) {
    body.do('stand'); pose = 'moving'; walking = true; commanded = t;
    body.move({ to: 'windowAnchor' }, `${state.revision}:walk`);
  }
}
async function poll() {
  if (fetching) return; fetching = true;
  try {
    const r = await fetch('/api/spatial'); if (!r.ok) throw new Error();
    state = await r.json(); offline = false;
    if (!display) display = state.displays.find(d => String(d.id) === String(state.target?.displayId)) || state.displays[0];
    if (body) {
      navigate();
      const event = state.gesture;
      if (event && event.id !== gesture && event.until > state.now) { gesture = event.id; body.do(event.word); pose = `gesture:${event.id}`; }
      body.set({ thinking: state.engagement?.kind === 'qq',listening:state.originalVoice?.enabled&&state.originalVoice?.gateOpen });
    }
  } catch { offline = true; body?.stopWalk(); commanded = null; walking = false; arrived = false; }
  finally { fetching = false; }
}
try {
  await poll();
  if (native) display = await native.stage();
  if (!state?.target || !display) throw new Error('显示器未就绪');
  const figure = await createActingFigure(performanceNow,{reduced:()=>reduced.matches});
  const saved = state.position && String(state.position.displayId) === String(display.id) ? local(state.position) : local(state.target);
  body = createBody({ root: stageEl, bounds: () => ({ W: innerWidth, H: innerHeight, floorY: innerHeight - 10, S: state?.body.scale || .68 }), start: { x: saved.x, y: saved.y, facing: -1 }, sound: () => {}, emit: (kind, details) => {
    if (kind === 'arrived' && details.walkId?.startsWith(state?.revision)) { walking = false; arrived = true; commanded = null; pose = null; void report(true); }
  } }, { figure, ground: 'free', roam: 'off', moves: { windowAnchor: () => local(state.target) } });
  body.set({ roam: 'off' }); navigate(); native?.avatarReady();
  native?.onStage(value => { display = value; body.resize(); const target = state?.target; if (target && String(value.id) === String(target.displayId)) { const p = local(target); body.place(p.x, -1, p.y); } revision = null; pose = null; arrived = false; commanded = null; });
} catch (e) { document.getElementById('error').hidden = false; console.error('桌面角色加载失败', e); }
window.addEventListener('resize', () => body?.resize());
function applyPose(now) {
  if (!arrived || dragging || pendingDrop || !state) return;
  if (state.gesture?.until > now) return;
  let next = state.target.posture || 'stand';
  if (state.engagement?.kind === 'qq') next = 'thinking';
  if (state.engagement?.kind === 'qq-sent') next = 'happy';
  const acting=performanceNow();
  if(acting){next=({typing:'determined',click:'determined',observe:'look',verify:'thinking',thinking:'thinking',waiting:'look',success:'happy',blocked:'confused',listening:'content'})[acting.kind]||next;}
  if (next !== pose) { body.do(next); pose = next; }
}
function drawSpeech(now, layout) {
  const value = state?.speech;
  const visible = value && value.until > now && state.enabled;
  speech.hidden = !visible;
  if (!visible) { speechKey = null; return; }
  if (speechKey !== value.at) { speechKey = value.at; speechText = value.text; speechIndex = 0; speech.textContent = ''; lastType = now; }
  if (speechIndex < speechText.length && now - lastType > 35) { speechIndex += Math.max(1, Math.floor((now - lastType) / 35)); lastType = now; speech.textContent = speechText.slice(0, speechIndex); if(!state.voiceOutput?.enabled)body.talk(); }
  const top = Math.max(speech.getBoundingClientRect().height + 8, Math.min(innerHeight - 15, layout.bubble.y - 14));
  speech.style.left = `${Math.max(165, Math.min(innerWidth - 165, layout.bubble.x))}px`; speech.style.top = `${top}px`;
}
function drawChat(layout){
  const p=hoverPoint,b=layout.box,r=hoverTools.getBoundingClientRect();
  if(p&&((p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h)||(!hoverTools.hidden&&p.x>=r.left-6&&p.x<=r.right+6&&p.y>=r.top-6&&p.y<=r.bottom+6)))toolsUntil=Date.now()+1400;
  hoverTools.hidden=!state?.enabled||!!dragging||pendingDrop||Date.now()>toolsUntil;
  if(hoverTools.hidden)return;
  const width=hoverTools.offsetWidth,right=layout.box.x+layout.box.w+10,left=right+width+8<innerWidth?right:layout.box.x-width-10;
  hoverTools.style.left=`${Math.max(8,Math.min(innerWidth-width-8,left))}px`;
  hoverTools.style.top=`${Math.max(8,Math.min(innerHeight-90,layout.box.y+layout.box.h*.34))}px`;
  const voice=state?.originalVoice||{},signature=[voice.enabled,voice.ready,voice.phase,voice.modelPhase].join(':');
  if(voiceOpener.dataset.signature!==signature){voiceOpener.dataset.signature=signature;voiceOpener.innerHTML=voice.enabled?ICONS.mic:ICONS.micOff;voiceOpener.classList.toggle('on',!!voice.enabled);voiceOpener.classList.toggle('waiting',voice.enabled&&!voice.ready);}
  const micProblem=['error','denied'].includes(voice.mic);
  voiceOpener.title=!voice.enabled?'语音输入已关闭，点击开启':micProblem?(voice.detail||'麦克风不可用，请检查原版语音设置'):!voice.ready?(voice.detail||'正在启动语音识别'):voice.hint||'语音输入已开启，点击关闭';
  voiceHint.textContent=voice.enabled?(micProblem?'麦克风不可用':voice.ready?(voice.gateOpen?'正在听…':voice.hotkey||'语音已开启'):'准备中…'):'语音';
  const sound=state?.voiceOutput||{};if(soundOpener.dataset.enabled!==String(sound.enabled)){soundOpener.dataset.enabled=String(sound.enabled);soundOpener.innerHTML=sound.enabled?ICONS.sound:ICONS.soundOff;soundOpener.classList.toggle('on',!!sound.enabled);}soundOpener.title=sound.enabled?'声音回复已开启，点击静音':'声音回复已关闭，点击开启';
}
function frame(ts) {
  const dt = Math.min(.05, (ts - previous) / 1000); previous = ts;
  if (ts - lastPoll > 400) { lastPoll = ts; void poll(); }
  if (body && state) {
    if (arrived && !dragging && !pendingDrop && !offline && state.target && String(state.target.displayId) === String(display?.id)) {
      const t = local(state.target), l = body.layout();
      const k = 1 - Math.exp(-dt * 16);
      body.place(l.x + (t.x - l.x) * k, l.facing, (l.y || t.y) + (t.y - (l.y || t.y)) * k);
    }
    body.step(dt, state.enabled);
    if(voicePlayer?.energy()>.012)body.talk();
    const l = body.layout(), now = Date.now();
    if (pendingDrop && !['drag', 'air', 'land'].includes(l.mode)) {
      pendingDrop = false; dragging = null;
      void action({ action: 'drag-character', ...globalPoint(l) }).then(() => { revision = null; arrived = false; commanded = null; void poll(); });
    }
    applyPose(now); drawSpeech(now, l);drawChat(l);
    if (ts - lastRegion > 100) { lastRegion = ts; const regions=[{ x: l.box.x, y: l.box.y, w: l.box.w, h: l.box.h }];if(!hoverTools.hidden){const b=hoverTools.getBoundingClientRect();regions.push({x:b.x,y:b.y,w:b.width,h:b.height});}native?.regions(regions); }
    if (ts - lastReport > 900) { lastReport = ts; void report(arrived); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const point = e => ({ x: e.clientX, y: e.clientY, t: performance.now() });
document.addEventListener('pointerdown', e => {
  if(e.target.closest('#hover-tools'))return;
  if (!body || e.button !== 0) return;
  const p = point(e), box = body.layout().box;
  if (p.x < box.x || p.y < box.y || p.x > box.x + box.w || p.y > box.y + box.h) return;
  manualUntil=Date.now()+15000;dragging = { x: p.x, y: p.y, moved: false }; body.stopWalk(); body.pointer('down', p); document.documentElement.setPointerCapture(e.pointerId); native?.holding(true);
});
document.addEventListener('pointermove', e => { if (!body) return; const p = point(e);hoverPoint=p;if (dragging) dragging.moved ||= Math.hypot(p.x - dragging.x, p.y - dragging.y) > 6; body.pointer('move', p); });
document.documentElement.addEventListener('pointerleave',()=>{hoverPoint=null;});
function release(e) {
  if (!body || !dragging) return;
  const moved = dragging.moved; native?.holding(false);
  if (moved) { body.drop(point(e)); pendingDrop = true; }
  else { body.pointer('up', point(e)); dragging = null; void action({ action: 'touch-character' }); revision = null; commanded = null; arrived = false; }
}
document.addEventListener('pointerup', release); document.addEventListener('pointercancel', release);
document.addEventListener('contextmenu', e => { e.preventDefault(); native?.avatarMenu(); });
window.addEventListener('blur', () => native?.holding(false));
window.avatarDebug = { get state() { return state; }, get body() { return body; }, get display() { return display; }, get arrived() { return arrived; },get voice(){return voicePlayer?.debug;}, poll };
