const $ = id => document.getElementById(id);
for (const id of ['today', 'files', 'apps', 'windows','chat']) $(id).onclick = () => window.desktopShell?.navigate(id);
$('activity').onclick = () => window.desktopShell?.navigate('today'); $('hide').onclick = () => window.desktopShell?.window('close');
let busy = false;
async function refresh() { if (busy) return; busy = true; try { const r = await fetch('/api/state'); const s = await r.json(); const p = [...s.plans].reverse().find(p => p.status === 'active') || s.plans.at(-1); $('connection').textContent = s.runtime.bridgeOnline ? '与她连接着' : '等待她连接'; $('plan').textContent = p?.title || '还没有新的打算'; $('files-count').textContent = s.resources.length || ''; $('windows-count').textContent = s.desktop.windows.length; } catch { $('connection').textContent = '桌面连接暂时中断'; } finally { busy = false; } }
const events = new EventSource('/api/updates'); events.onmessage = refresh; await refresh(); setInterval(refresh, 10000);
