import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export class DesktopStore {
  constructor(dir) {
    this.dir = path.resolve(dir); this.workspace = path.join(this.dir, '她的空间'); this.file = path.join(this.dir, 'desktop.json');
    fs.mkdirSync(path.join(this.workspace, '日记'), { recursive: true });
    const base = { version: 1, createdAt: Date.now(), autonomy: true, quiet: false, musicAppId: null, allowedApps: ['builtin:notepad', 'builtin:workspace'], plans: [], resources: [], receipts: [], events: [], nextEvent: 1, speech: null };
    try { this.state = { ...base, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
    catch { try { this.state = { ...base, ...JSON.parse(fs.readFileSync(this.file + '.bak', 'utf8')) }; } catch { this.state = base; } }
    this.state.appAccess ||= {};
    this.save();
  }
  save() {
    const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(tmp, this.file);
  }
  receipt(kind, result, actor = 'system') {
    const planId = Object.hasOwn(result, 'planId') ? result.planId : this.state.plans.find(p => p.status === 'active')?.id ?? null;
    const item = { ...result, id: randomUUID(), at: Date.now(), kind, actor, planId };
    this.state.receipts.push(item); this.state.receipts = this.state.receipts.slice(-150); this.save(); return item;
  }
  event(kind, text, meta = {}) {
    const e = { id: this.state.nextEvent++, at: Date.now(), kind, text, meta }; this.state.events.push(e); this.state.events = this.state.events.slice(-40); this.save(); return e;
  }
  ack(id) { if (!Number.isSafeInteger(id)) throw new Error('事件编号无效'); this.state.events = this.state.events.filter(e => e.id > id); this.save(); }
  startPlan({ title, reason = '', actor = 'model' }) {
    const name = String(title || '').trim().slice(0, 80); if (!name) throw new Error('需要说明打算做什么');
    const active = this.state.plans.find(p => p.status === 'active');
    if (active) { active.status = 'paused'; active.updatedAt = Date.now(); }
    const p = { id: randomUUID(), title: name, reason: String(reason).slice(0, 240), actor, createdAt: Date.now(), updatedAt: Date.now(), status: 'active', evidence: [] };
    this.state.plans.push(p); this.state.plans = this.state.plans.slice(-40); this.save(); return p;
  }
  finishPlan(id, receiptIds) {
    const p = this.state.plans.find(p => p.id === id); if (!p || p.status !== 'active') throw new Error('这项计划没有在进行');
    const evidence = (Array.isArray(receiptIds) ? receiptIds : []).map(id => this.state.receipts.find(r => r.id === id)).filter(Boolean);
    if (!evidence.length || evidence.some(e => e.planId !== p.id || !e.ok || e.submitted)) throw new Error('需要本次计划内已核验成功的结果，启动请求不能作为完成证明');
    p.status = 'completed'; p.evidence = evidence.map(r => r.id); p.updatedAt = Date.now(); this.save(); return p;
  }
  resumePlan(id) {
    const p = this.state.plans.find(p => p.id === id); if (!p || p.status !== 'paused') throw new Error('这项计划不能恢复');
    const active = this.state.plans.find(p => p.status === 'active'); if (active) active.status = 'paused';
    p.status = 'active'; p.updatedAt = Date.now(); this.save(); return p;
  }
  resourcePath(id) {
    const r = this.state.resources.find(r => r.id === id); if (!r) throw new Error('找不到这份文件');
    const candidate = path.resolve(this.workspace, r.relativePath);
    if (!candidate.startsWith(this.workspace + path.sep)) throw new Error('文件不在她的空间内');
    const real = fs.realpathSync(candidate), base = fs.realpathSync(this.workspace);
    if (!real.startsWith(base + path.sep) || !fs.statSync(real).isFile()) throw new Error('文件位置发生变化，不能继续操作');
    return { resource: r, file: real };
  }
  writeNote({ title, body, category = '日记', actor = 'model', ...links }) {
    if (typeof body !== 'string' || !body.trim() || body.length > 20000) throw new Error('正文需要 1 至 20000 字');
    const name = String(title || '桌面记录').trim().slice(0, 80);
    const id = randomUUID(); const date = new Date().toLocaleDateString('sv-SE');
    const filename = `${date}_${name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 45) || '桌面记录'}_${id.slice(0, 6)}.md`;
    const relativePath = path.join('日记', filename), target = path.join(this.workspace, relativePath);
    const text = `# ${name}\n\n${body.trim()}\n`;
    fs.writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' });
    const actual = fs.readFileSync(target, 'utf8'); if (actual !== text) throw new Error('写入结果不一致');
    const resource = { id, title: name, relativePath, category: category === '验收' ? '验收' : '日记', createdAt: Date.now(), sha256: createHash('sha256').update(actual).digest('hex'), bytes: Buffer.byteLength(actual) };
    this.state.resources.push(resource); this.save();
    const receipt = this.receipt('resource.written', { ok: true, resourceId: id, title: name, bytes: resource.bytes, verified: true, ...(['taskId','stepId','planId'].reduce((out,key) => Object.hasOwn(links,key) ? {...out,[key]:links[key]} : out, {})) }, actor);
    return { resource, receipt, path: target };
  }
  readNote(id, actor = 'model', links = {}) {
    const { file, resource } = this.resourcePath(id); if (fs.statSync(file).size > 100000) throw new Error('文件过大，暂不读取');
    const content = fs.readFileSync(file, 'utf8');
    const receipt = this.receipt('resource.read', { ok: true, resourceId: id, title: resource.title, verified: true, ...links }, actor);
    return { resource, content, receipt };
  }
  setAllowed(id, allowed) {
    const items = new Set(this.state.allowedApps); allowed ? items.add(id) : items.delete(id); this.state.allowedApps = [...items]; this.save();
  }
}
