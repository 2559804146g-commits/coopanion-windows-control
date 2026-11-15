const $ = id => document.getElementById(id);
const svg = id => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS(el.namespaceURI, 'use'); use.setAttribute('href', '#i-' + id); el.append(use); return el; };
const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
let state, view = 'today', loading = false, toastTimer, signatures = {}, readingId, musicBusy = false, currentTask = null, taskBusy = false;
const conversation=document.querySelector('.conversation-column'),conversationHome=conversation.parentNode;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
async function act(data, quiet = false) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await r.json(); if (!r.ok) throw new Error(result.error || '操作未完成');
    if (!quiet && result.deferred) toast(result.reason);
    await refresh(); return result;
  } catch (e) { if (!quiet) toast(e.message); return null; }
}
async function refresh() {
  if (loading) return; loading = true;
  try { const r = await fetch('/api/state'); if (!r.ok) throw new Error(); state = await r.json(); render(); }
  catch { $('role-status').textContent = '连接中断'; $('live-state').textContent = '正在等待恢复'; }
  finally { loading = false; }
}
function go(next) {
  if(!['today','windows','apps','files','chat'].includes(next))return;
  view = next; for (const name of ['today', 'windows', 'apps', 'files','chat']) $('view-' + name).hidden = name !== next;
  for (const el of document.querySelectorAll('[data-view]')) el.classList.toggle('active', el.dataset.view === next);
  (next==='chat'?$('chat-content'):conversationHome).append(conversation);
  conversation.classList.toggle('chat-conversation',next==='chat');render();
  if(next==='chat'){document.querySelector('main').scrollTop=0;requestAnimationFrame(()=>$('invitation').focus({preventScroll:true}));}
}
function empty(text) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = text; return p; }
function stable(key, value, target, build) { const text = JSON.stringify(value); if (signatures[key] !== text) { signatures[key] = text; target.replaceChildren(...build(value)); } }
function fileButton(r) {
  const b = document.createElement('button'); b.className = 'file-item';
  const info = document.createElement('span'); info.className = 'file-info'; const title = document.createElement('strong'), sub = document.createElement('small');
  title.textContent = r.title; sub.textContent = `${r.category} · ${new Date(r.createdAt).toLocaleDateString('zh-CN')} · 已保存`;
  info.append(title, sub); b.append(svg('file'), info, svg('arrow')); b.onclick = () => read(r.id); return b;
}
async function read(id) { const result = await act({ action: 'read-note', id }); if (!result) return; readingId = id; go('files'); $('reader-title').textContent = result.resource.title; $('reader-content').textContent = result.content; $('reader').hidden = false; $('reader').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'nearest' }); }
function render() {
  if(state.voiceOutput){const v=state.voiceOutput;$('voice-enabled').checked=v.enabled;stable('voices',v.voices||[],$('voice-style'),list=>list.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.name;return o;}));$('voice-style').value=String(v.voiceId);$('voice-preview').disabled=!v.enabled;$('voice-feedback').textContent=v.error||(v.status==='generating'?'正在准备她的声音…':v.status==='playing'?'她正在说话':v.enabled?'会朗读新的桌面回复':'已静音');}
  if (!state) return;
  const connected = state.runtime.bridgeOnline;
  $('status-dot').classList.toggle('online', connected); $('role-status').textContent = connected ? '同一个她，已连接' : state.runtime.coreOnline ? '等待角色接入' : '等待角色核心';
  $('live-state').textContent = state.runtime.phase === 'idle' ? '桌面已连接' : connected ? '她正在处理事情' : '连接中';
  $('window-count').textContent = state.desktop.windows.length; $('app-count').textContent = state.runtime.appsReady ? state.apps.length : '…';
  $('autonomy').checked = state.autonomy; $('quiet').checked = state.quiet;
  const music = state.music || {};
  $('music-track').textContent = music.available && music.title ? `${music.title}${music.artist ? ' · ' + music.artist : ''}` : '继续播放网易云当前队列';
  $('music-status').textContent = musicBusy ? '正在操作，等待播放器确认…' : !music.canObserve ? '请先在应用中允许她观察或操作网易云音乐' : music.available ? (({ Playing: '正在播放', Paused: '已暂停', Stopped: '已停止' }[music.status] || '正在读取播放状态') + (music.allowed ? '' : ' · 仅可观察')) : '尚未连接播放控件';
  for (const b of document.querySelectorAll('[data-music]')) b.disabled = musicBusy || !(b.dataset.music==='status'?music.canObserve:music.allowed);
  $('character-enabled').checked = state.character?.enabled !== false;
  const targetWindow = state.desktop.windows.find(w => w.id === state.character?.target?.windowId);
  $('character-location').textContent = state.character?.enabled === false ? '桌面角色已收起' : !state.character?.connected ? '桌面角色正在连接' : targetWindow ? `她在「${targetWindow.title}」${state.character.target.edge === 'top' ? '的上沿' : '旁边'}` : '她在桌面边缘';
  $('windows-status').textContent = state.runtime.nativeError || `${state.desktop.windows.length} 个实际窗口 · 实时更新`;
  $('apps-status').textContent = state.runtime.appsError || (state.runtime.appsReady ? `${state.apps.length} 个本机应用入口` : '正在读取开始菜单…');
  $('core-status').textContent = connected ? '与 QQ 共用角色和记忆' : '聊天核心连接中';
  const pending = (state.activity?.tasks || []).filter(t => !['succeeded','cancelled'].includes(t.status));
  currentTask = pending.find(t => t.status === 'running') || pending.find(t => t.purpose !== 'test') || pending[0] || null;
  const taskLabels = { queued: '准备继续', running: '正在做', waiting: '等你空闲', paused: '已暂停', blocked: '暂时受阻', uncertain: '结果待核对', succeeded: '已核验', pending: '待进行' };
  const plan = state.plans.find(p => p.status === 'active');
  const intention=state.life?.intentions?.find(i=>['ready','doing','waiting'].includes(i.status));
  $('plan-title').textContent = currentTask?.title || plan?.title || intention?.title || '现在没有待办，安静陪着你';
  $('plan-reason').textContent = currentTask ? currentTask.reason || (currentTask.purpose === 'test' ? '系统验收，结果不会写成生活经历。' : currentTask.purpose === 'autonomy' ? '她自己的打算，等你空闲时接着做。' : '正在按你的目的处理，每一步都保存实际进度。') : plan?.reason || intention?.reason || '直接说你想做什么。她也会在空闲时继续有缘由的小事，保留自己的打算。';
  $('plan-status').textContent = currentTask ? taskLabels[currentTask.status] : plan ? '旧计划待续' : '没有进行中的任务';
  stable('evidence', currentTask?.steps || [], $('plan-evidence'), steps => steps.length ? [(() => { const list=document.createElement('ol');list.className='task-progress';for(const step of steps){const item=document.createElement('li'),label=document.createElement('span'),status=document.createElement('span');label.textContent=step.title;status.textContent=taskLabels[step.status]||step.status;item.dataset.state=step.status;item.append(label,status);list.append(item);}return list;})()] : []);
  $('task-controls').hidden = !currentTask;
  $('task-pause').disabled = taskBusy || !currentTask || ['paused','blocked','uncertain'].includes(currentTask.status);
  $('task-resume').disabled = taskBusy || !currentTask || !['paused','blocked'].includes(currentTask.status);
  $('task-cancel').disabled = taskBusy || !currentTask;
  $('task-recheck').hidden = currentTask?.status !== 'uncertain'; $('task-recheck').disabled = taskBusy;
  $('other-tasks').textContent = pending.length > 1 ? `另有 ${pending.length-1} 件待办，进度已保留` : '';
  stable('recent', state.resources.slice(-3).reverse(), $('recent-files'), list => list.length ? list.map(fileButton) : [empty('她留下的日记和记录会出现在这里。')]);
  const descriptions = { 'character.move.requested': () => '她准备换个地方待着', 'character.arrived': r => r.windowId ? '她已经来到实际窗口旁边' : '她已经回到桌面边缘', 'resource.written': r => `保存了「${r.title}」`, 'resource.read': r => `读到了「${r.title}」`, 'resource.open.requested': r => `请记事本打开「${r.title}」`, 'app.launch.requested': r => r.deferred ? '你正在使用电脑，她等一会儿再打开应用' : `已请求打开 ${r.appName}`, 'app.window.observed': () => '已看到实际的记事本窗口', 'resource.window.observed': () => '已核验记录在真实记事本中打开', 'window.verification.pending': () => '启动结果仍待窗口核验', 'window.focus': r => r.ok ? '切换到了实际窗口' : r.reason, 'qq.received': () => 'QQ 收到消息，原来的计划保留', 'qq.sent': () => 'QQ 平台确认回复已发送' };
  for (const [command, label] of Object.entries({ play: '播放', pause: '暂停', next: '下一首', previous: '上一首' })) descriptions['music.' + command] = r => r.ok && r.verified ? `${label}已确认${r.state?.title ? ' · ' + r.state.title : ''}` : `${label}尚未确认${r.reason ? ' · ' + r.reason : ''}`;
  descriptions['task.step.verified'] = r => `已核验：${r.note}`;
  stable('receipts', state.receipts.slice(-8).reverse(), $('receipts'), list => list.length ? list.map(r => { const li = document.createElement('li'), t = document.createElement('time'), text = document.createElement('span'); t.textContent = time(r.at); text.textContent = descriptions[r.kind]?.(r) || r.kind; if (r.ok && !r.submitted) text.className = 'success'; li.append(t, text); return li; }) : [empty('真实操作发生后，会在这里留下结果。')]);
  $('speech').hidden = !state.speech; if (state.speech) { $('speech-text').textContent = state.speech.text; $('speech-time').textContent = time(state.speech.at); }
  if (view === 'windows') stable('windows', state.desktop.windows, $('windows-list'), list => list.length ? list.map(w => {
    const row = document.createElement('div'); row.className = 'window-row'; const button = document.createElement('button'); button.className = 'row-main';
    const text = document.createElement('span'); text.className = 'row-text'; const title = document.createElement('strong'), sub = document.createElement('small'); title.textContent = w.title; sub.textContent = `${w.app || 'Windows 应用'} · ${Math.round(w.rect.width)} × ${Math.round(w.rect.height)}`; text.append(title, sub); button.append(svg('windows'), text); button.onclick = async () => { const result = await act({ action: 'focus-window', id: w.id }); if (result) toast(result.reason); };
    const tag = document.createElement('span'); tag.className = 'window-state' + (w.active ? ' active' : ''); tag.textContent = w.active ? '正在使用' : w.minimized ? '已最小化' : '已打开';
    const come = document.createElement('button'); come.className = 'come-here'; come.textContent = '请她过来'; come.disabled = w.minimized; come.onclick = async () => { const r = await act({ action: 'place-character', windowId: w.id, edge: 'auto', posture: 'sit', reason: '用户邀请来到这个真实窗口旁' }); if (r?.submitted) toast('她正在过来，原来的计划会保留。'); else if (r?.reason) toast(r.reason); };
    row.append(button, tag, come); return row;
  }) : [empty(state.runtime.nativeError || '当前没有其他可见窗口。')]);
  if (view === 'apps') {
    const query = $('app-search').value.trim().toLocaleLowerCase(); const apps = state.apps.filter(a => a.name.toLocaleLowerCase().includes(query));
    stable('apps', apps, $('apps-list'), list => list.length ? list.map(a => {
      const row = document.createElement('div'); row.className = 'app-row'; const button = document.createElement('button'); button.className = 'row-main';
      const initial = document.createElement('span'); initial.className = 'app-initial'; initial.textContent = [...a.name].slice(0, 2).join('');
      const text = document.createElement('span'); text.className = 'row-text'; const name = document.createElement('strong'); name.textContent = a.name; text.append(name); button.append(initial, text); button.onclick = async () => { const result = await act({ action: 'open-app', id: a.id }); if (result?.submitted) toast(`已把打开「${a.name}」的请求交给 Windows。`); };
      const select=document.createElement('select');select.className='app-scope';select.setAttribute('aria-label',`她可以怎样使用${a.name}`);
      for(const [value,label] of Object.entries({off:'不允许',launch:'可打开',observe:'可观察',operate:'可操作'})){const option=document.createElement('option');option.value=value;option.textContent=label;option.disabled=!a.contentSupported&&['observe','operate'].includes(value);select.append(option);}
      select.value=a.access|| (a.allowed?'launch':'off');select.onchange=async()=>{select.disabled=true;const r=await act({action:'set-app-access',id:a.id,mode:select.value});if(!r)select.value=a.access||'off';select.disabled=false;};
      row.append(button,select);return row;
    }) : [empty(state.runtime.appsReady ? '没有找到这个应用。' : '正在读取本机应用…')]);
  }
  if (view === 'files') stable('files', state.resources.slice().reverse(), $('file-list'), list => list.length ? list.map(fileButton) : [empty('还没有文件。等她完成一件事情，记录会留在这里。')]);
}
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => go(button.dataset.view);
for (const button of document.querySelectorAll('[data-go]')) button.onclick = () => go(button.dataset.go);
$('app-search').oninput = render;
for (const [id,command] of Object.entries({'task-pause':'pause','task-resume':'resume','task-cancel':'cancel'})) $(id).onclick=async()=>{if(!currentTask||taskBusy)return;taskBusy=true;render();await act({action:'task-control',id:currentTask.id,command});taskBusy=false;render();};
$('task-recheck').onclick=async()=>{if(!currentTask||taskBusy)return;taskBusy=true;render();const r=await act({action:'task-recheck',id:currentTask.id});taskBusy=false;render();if(r&&!r.ok)toast(r.reason);};
for (const b of document.querySelectorAll('[data-music]')) b.onclick = async () => {
  if (musicBusy) return; musicBusy = true; render();
  const command = b.dataset.music;
  const result = await act(command === 'status' ? { action: 'music-status' } : { action: 'music-control', command });
  musicBusy = false; render();
  if (result && !result.ok) toast(result.reason || result.note || '播放器尚未确认，请刷新状态');
};
$('invite-form').onsubmit = async e => { e.preventDefault(); const text = $('invitation').value.trim(); if (!text) return; const button = e.currentTarget.querySelector('button'); button.disabled = true; const result = await act({ action: 'invite', text }); button.disabled = false; if (result) { $('invitation').value = ''; $('invite-status').textContent = '已交给她，处理结果会留在这里。'; } };
$('voice-enabled').onchange=e=>act({action:'voice-configure',enabled:e.target.checked});$('voice-style').onchange=e=>act({action:'voice-configure',voiceId:Number(e.target.value)});$('voice-preview').onclick=()=>act({action:'voice-preview'});$('voice-stop').onclick=()=>act({action:'voice-stop'});
$('autonomy').onchange = e => act({ action: 'autonomy', enabled: e.target.checked }); $('quiet').onchange = e => act({ action: 'quiet', enabled: e.target.checked });
$('character-enabled').onchange = e => act({ action: 'show-character', enabled: e.target.checked });
for (const id of ['open-folder', 'files-folder']) $(id).onclick = async () => { const r = await act({ action: 'open-app', id: 'builtin:workspace' }); if (r?.submitted) toast('已请求 Windows 打开她的文件夹。'); };
$('refresh-windows').onclick = () => act({ action: 'observe' }); $('refresh-apps').onclick = async () => { $('refresh-apps').disabled = true; await act({ action: 'refresh-apps' }); $('refresh-apps').disabled = false; };
$('reader-close').onclick = () => $('reader').hidden = true; $('reader-open').onclick = () => act({ action: 'open-resource', id: readingId });
$('close').onclick = () => { if (window.desktopShell) window.desktopShell.window('close'); else toast('这是浏览器入口，可以直接关闭标签页。'); };
$('minimize').onclick = () => window.desktopShell?.window('minimize');
const updates = new EventSource('/api/updates'); updates.onmessage = () => void refresh(); updates.onerror = () => { $('live-state').textContent = '正在恢复桌面连接'; };
await refresh(); setInterval(refresh, 10000);
window.desktopDebug = { get state() { return state; }, go, act };
window.desktopShell?.onNavigate(go);
if(location.hash==='#chat')go('chat');
