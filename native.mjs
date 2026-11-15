import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const root = path.dirname(fileURLToPath(import.meta.url));
import runtimePaths from './runtime-paths.cjs';
const require = createRequire(runtimePaths.dependencyPackage);
const exec = promisify(execFile);

// Kept independent of the character renderer: these are real Windows resources.
export class WindowsAdapter {
  constructor({ excludePids = [] } = {}) {
    const koffi = require('koffi'); this.koffi = koffi; this.excludePids = new Set([process.pid, ...excludePids]);
    const u = koffi.load('user32.dll'), k = koffi.load('kernel32.dll'), d = koffi.load('dwmapi.dll');
    const R = koffi.struct('EcoRect', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const L = koffi.struct('EcoLastInput', { cbSize: 'uint32_t', dwTime: 'uint32_t' });
    const cb = koffi.proto('bool __stdcall EcoEnumWindow(void *hwnd, intptr_t data)');
    this.api = {
      enumerate: u.func('bool __stdcall EnumWindows(EcoEnumWindow *callback, intptr_t data)'),
      visible: u.func('bool __stdcall IsWindowVisible(void *hwnd)'), iconic: u.func('bool __stdcall IsIconic(void *hwnd)'),
      text: u.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16_t *text, int max)'),
      rect: u.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ EcoRect *rect)'),
      style: u.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)'),
      pid: u.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)'),
      foreground: u.func('void * __stdcall GetForegroundWindow()'),
      focus: u.func('bool __stdcall SetForegroundWindow(void *hwnd)'),
      show: u.func('bool __stdcall ShowWindow(void *hwnd, int command)'),
      lastInput: u.func('bool __stdcall GetLastInputInfo(_Inout_ EcoLastInput *info)'),
      tick: k.func('uint32_t __stdcall GetTickCount()'),
      cloaked: d.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ int *value, uint32_t size)'),
      frame: d.func('long __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t attr, _Out_ EcoRect *value, uint32_t size)'),
      openProcess: k.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      processPath: k.func('bool __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)'),
      closeHandle: k.func('bool __stdcall CloseHandle(void *handle)'),
    };
    this.rectSize = koffi.sizeof(R); this.inputSize = koffi.sizeof(L); this.known = new Map(); this.apps = new Map(); this.processCache = new Map();
  }
  idleMs() { const info = { cbSize: this.inputSize, dwTime: 0 }; return this.api.lastInput(info) ? (this.api.tick() - info.dwTime) >>> 0 : null; }
  lastInputTick() { const info = { cbSize: this.inputSize, dwTime: 0 }; return this.api.lastInput(info) ? info.dwTime : null; }
  restoreInactive(id) { this.snapshot(); const w=this.known.get(id); if(!w)throw new Error('窗口已经关闭'); if(this.api.iconic(w.hwnd))this.api.show(w.hwnd,4); return {ok:true}; }
  processName(pid) {
    if (this.processCache.has(pid)) return this.processCache.get(pid);
    let result = ''; const handle = this.api.openProcess(0x1000, false, pid);
    if (handle) { try { const buf = new Uint16Array(2048), size = [buf.length]; if (this.api.processPath(handle, 0, buf, size)) result = path.basename(String.fromCharCode(...buf.subarray(0, size[0]))); } finally { this.api.closeHandle(handle); } }
    if (this.processCache.size > 300) this.processCache.clear(); this.processCache.set(pid, result); return result;
  }
  snapshot() {
    const { api, koffi } = this; const fg = koffi.address(api.foreground()); const list = []; this.known.clear();
    api.enumerate(hwnd => {
      if (!api.visible(hwnd) || (Number(api.style(hwnd, -20)) & 0x80)) return true;
      const cloaked = [0]; if (api.cloaked(hwnd, 14, cloaked, 4) === 0 && cloaked[0]) return true;
      const buf = new Uint16Array(512), n = api.text(hwnd, buf, buf.length); if (n <= 0) return true;
      const processId = [0]; api.pid(hwnd, processId); const internal = this.excludePids.has(processId[0]);
      const title = String.fromCharCode(...buf.subarray(0, n)); if (title === 'Program Manager') return true;
      const r = { left: 0, top: 0, right: 0, bottom: 0 };
      if (api.frame(hwnd, 9, r, this.rectSize) !== 0) api.rect(hwnd, r);
      const address = koffi.address(hwnd), id = `${address.toString(16)}:${processId[0]}`;
      if (!internal) this.known.set(id, { hwnd, title, pid: processId[0] });
      list.push({ id, title, pid: processId[0], internal, app: this.processName(processId[0]), active: address === fg, minimized: api.iconic(hwnd), rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } });
      return list.length < 80;
    }, 0);
    return { observedAt: Date.now(), idleMs: this.idleMs(), windows: list.filter(w => !w.internal), sceneWindows: list };
  }
  focus(id, actor = 'user') {
    if (actor === 'model' && (this.idleMs() ?? 0) < 8000) return { ok: false, deferred: true, reason: '用户正在操作，暂不切换窗口' };
    this.snapshot(); const target = this.known.get(id); if (!target) throw new Error('窗口已经关闭，请重新观察桌面');
    if (this.api.iconic(target.hwnd)) this.api.show(target.hwnd, 9);
    this.api.focus(target.hwnd);
    const ok = this.koffi.address(this.api.foreground()) === this.koffi.address(target.hwnd);
    return { ok, windowId: id, reason: ok ? '目标窗口已在前台' : 'Windows 未允许切换前台，窗口保持原状' };
  }
  async loadApps() {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 25000, maxBuffer: 3e6, encoding: 'utf8' });
    const parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    this.apps.clear();
    for (const a of Array.isArray(parsed) ? parsed : [parsed]) if (typeof a.AppID === 'string' && typeof a.Name === 'string') this.apps.set(a.AppID, { id: a.AppID, name: a.Name });
    return [...this.apps.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  async launch(id, { actor = 'user', allowed = [], workspace } = {}) {
    if (actor === 'model' && !allowed.includes(id)) throw new Error('这个应用尚未加入可自主使用的列表');
    if (actor === 'model' && (this.idleMs() ?? 0) < 8000) return { ok: false, deferred: true, reason: '用户正在操作，稍后再打开应用' };
    let program, args;
    if (id === 'builtin:notepad') { program = 'notepad.exe'; args = []; }
    else if (id === 'builtin:workspace') { if (!workspace) throw new Error('生活目录未配置'); program = 'explorer.exe'; args = [workspace]; }
    else { if (!this.apps.has(id)) throw new Error('应用未在本机目录中，请刷新应用列表'); if (path.isAbsolute(id) && /\.exe$/i.test(id) && fs.existsSync(id)) { program = id; args = []; } else { program = 'explorer.exe'; args = [`shell:AppsFolder\\${id}`]; } }
    const before = new Set(this.snapshot().windows.map(w => w.id));
    const child = spawn(program, args, { windowsHide: false, detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); }); child.unref();
    return { ok: true, submitted: true, pid: child.pid, appId: id, beforeWindowIds: [...before], note: '启动请求已交给 Windows；窗口是否出现需后续核验' };
  }
}
