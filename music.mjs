import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = path.dirname(fileURLToPath(import.meta.url));
const commands = new Set(['status', 'play', 'pause', 'next', 'previous']);

// A single hidden helper retains accessible controls; no shell or global media keys.
export class MediaWorker {
  constructor(playerPath) { this.playerPath = playerPath; this.sequence = 0; this.pending = new Map(); }
  start() {
    if (this.child) return;
    const child = spawn('powershell.exe', ['-MTA', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'media-worker.ps1'), '-PlayerPath', this.playerPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdin.on('error', () => {});
    child.stderr.on('data', () => {});
    createInterface({ input: child.stdout }).on('line', line => {
      try { const data = JSON.parse(line.replace(/^\uFEFF/, '')); const item = this.pending.get(data.id); if (item) { clearTimeout(item.timer); this.pending.delete(data.id); item.resolve(data.result); } } catch { /* Only protocol responses are consumed. */ }
    });
    const failed = () => { if (this.child !== child) return; this.child = null; for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('音乐连接已断开，请重新查询状态')); } this.pending.clear(); };
    child.once('error', failed); child.once('exit', failed);
  }
  request(command) {
    if (!commands.has(command)) return Promise.reject(new Error('不支持这个音乐操作'));
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('尚未确认音乐操作结果，请先查询状态，不要重复切歌')); this.close(); }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, action: command }) + '\n', error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }
  close() { const child = this.child; this.child = null; for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('音乐连接已结束')); } this.pending.clear(); if (child) { child.stdin.end(); child.kill(); } }
}

export class MusicController {
  constructor({ selection, isAllowed, canControl = isAllowed, launch, workerFactory = id => new MediaWorker(id), delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { selection, isAllowed, canControl, launch, workerFactory, delay });
    this.cached = { available: false, status: 'Unknown', reason: 'not_observed' }; this.queue = Promise.resolve();
  }
  snapshot() { const appId = this.selection(); const canObserve = !!appId && this.isAllowed(appId), allowed = canObserve && this.canControl(appId); return { ...this.cached, player: 'netease', playerName: '网易云音乐', appId, allowed, canObserve, ...(!canObserve ? { available: false, status: 'Unknown', reason: appId ? 'permission_denied' : 'not_selected' } : {}) }; }
  run(command = 'status') {
    if (this.disposed) return Promise.resolve({ ok: false, verified: false, reason: '音乐连接已停止' });
    if (!commands.has(command)) return Promise.reject(new Error('音乐操作只能是播放、暂停、上一首或下一首'));
    const result = this.queue.then(() => this.execute(command)); this.queue = result.catch(() => {}); return result;
  }
  async execute(command) {
    if (this.disposed) return { ok: false, verified: false, reason: '音乐连接已停止' };
    const appId = this.selection();
    if (!appId || !this.isAllowed(appId)) { this.close(); return { ok: false, verified: false, reason: appId ? '尚未允许她使用网易云音乐' : '尚未选择音乐播放器', state: this.snapshot() }; }
    if (command !== 'status' && !this.canControl(appId)) return { ok: false, verified: false, reason: '当前只允许观察网易云，尚未允许操作', state: this.snapshot() };
    if (this.workerId !== appId || !this.worker) { this.close(); this.worker = this.workerFactory(appId); this.workerId = appId; }
    try {
      let result = await this.worker.request('status');
      this.cached = result.state || { available: false, reason: 'status_unavailable' };
      // Only explicit play may start the selected app; status/pause/skip never launch it.
      if (!this.cached.available && command === 'play' && this.cached.reason === 'no_netease_controls' && !(this.cached.windowCandidates > 0)) {
        if (this.selection() !== appId || !this.isAllowed(appId)) return { ok: false, verified: false, reason: '音乐使用权限已关闭', state: this.snapshot() };
        const opened = await this.launch(appId);
        if (!opened.submitted) return { ...opened, ok: false, verified: false, state: this.snapshot() };
        const deadline = Date.now() + 18000;
        for (let attempt = 0; attempt < 10 && !this.cached.available && Date.now() < deadline; attempt++) { await this.delay(800); result = await this.worker.request('status'); this.cached = result.state || this.cached; }
      }
      // Permissions may have changed while the helper was observing/starting.
      if (this.selection() !== appId || !this.isAllowed(appId) || (command !== 'status' && !this.canControl(appId))) { this.close(); return { ok: false, verified: false, reason: '音乐使用权限已关闭', state: this.snapshot() }; }
      if (command === 'status') return { ok: true, state: this.snapshot() };
      if (!this.cached.available && !(this.cached.windowCandidates > 0)) return { ok: false, verified: false, reason: '没有找到网易云的播放控件，请检查播放器是否可用', state: this.snapshot() };
      result = await this.worker.request(command); this.cached = result.state || this.cached;
      return { ...result, ok: result.ok === true && result.verified === true, state: this.snapshot(), note: result.ok && result.verified ? '已读取网易云实际控件核验结果' : '未核验成功；不能据此声称已播放或已切歌' };
    } catch (error) { this.cached = { ...this.cached, available: false, status: 'Unknown', reason: error.message }; return { ok: false, verified: false, reason: error.message, state: this.snapshot() }; }
  }
  close() { this.worker?.close(); this.worker = null; this.workerId = null; }
  dispose() { this.disposed = true; this.close(); }
}
