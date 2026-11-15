import { randomUUID } from 'node:crypto';

export const BODY = { width: 138, height: 172, scale: .68 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rect = w => w.dipRect || w.rect;
const area = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
function safePoint(display, x, y, BODY_SIZE = BODY) {
  const a = display.workArea;
  return { displayId: String(display.id), x: clamp(x, a.x + BODY_SIZE.width / 2 + 8, a.x + a.width - BODY_SIZE.width / 2 - 8), y: clamp(y, a.y + BODY_SIZE.height + 10, a.y + a.height - 10) };
}
function subtract(segments, left, right) {
  return segments.flatMap(([a, b]) => right <= a || left >= b ? [[a, b]] : [[a, Math.min(b, left)], [Math.max(a, right), b]].filter(([x, y]) => y > x));
}
export function resolveAnchor(request, windows, displays, geometry = BODY) {
  const BODY = geometry;
  if (!displays?.length) return null;
  const primary = displays.find(d => d.primary) || displays[0];
  const requestedDisplay = displays.find(d => String(d.id) === String(request.displayId)) || primary;
  const fallback = reason => ({ ...safePoint(requestedDisplay, requestedDisplay.workArea.x + requestedDisplay.workArea.width - 160, requestedDisplay.workArea.y + requestedDisplay.workArea.height - 12,BODY), kind: 'desktop', edge: 'floor', posture: 'stand', fallback: reason || null });
  if (request.kind === 'point') return { ...safePoint(requestedDisplay, request.x, request.y,BODY), kind: 'point', edge: 'free', posture: request.posture || 'stand', fallback: null };
  if (request.kind !== 'window') return { ...fallback(), posture: request.posture || 'stand' };
  const index = windows.findIndex(w => w.id === request.windowId && !w.minimized);
  if (index < 0) return fallback('目标窗口已关闭或最小化');
  const w = windows[index], r = rect(w);
  const display = [...displays].sort((a, b) => area(r, b.workArea) - area(r, a.workArea))[0];
  if (!display || area(r, display.workArea) <= 0) return fallback('目标窗口已移出可用屏幕');
  const a = display.workArea, above = windows.slice(0, index).filter(o => !o.minimized).map(rect);
  const edge = request.edge || 'auto';
  if ((edge === 'auto' || edge === 'top') && r.y >= a.y + BODY.height + 10) {
    let segments = [[Math.max(r.x + 12, a.x + 10), Math.min(r.x + r.width - 12, a.x + a.width - 10)]];
    for (const o of above) if (o.y < r.y + 4 && o.y + o.height > r.y - BODY.height) segments = subtract(segments, o.x - 8, o.x + o.width + 8);
    const viable = segments.filter(([l, h]) => h - l >= BODY.width);
    if (viable.length) {
      const preferred = r.x + r.width * .72;
      const chosen = viable.sort((x, y) => Math.abs((x[0] + x[1]) / 2 - preferred) - Math.abs((y[0] + y[1]) / 2 - preferred))[0];
      return { ...safePoint(display, clamp(preferred, chosen[0] + BODY.width / 2, chosen[1] - BODY.width / 2), r.y,BODY), kind: 'window', windowId: w.id, edge: 'top', posture: request.posture || 'sit', fallback: null };
    }
  }
  const sideY = clamp(r.y + r.height * .7, a.y + BODY.height + 12, a.y + a.height - 12);
  const sides = edge === 'left' ? ['left', 'right'] : ['right', 'left'];
  for (const side of sides) {
    const x = side === 'left' ? r.x - BODY.width / 2 - 14 : r.x + r.width + BODY.width / 2 + 14;
    if (x - BODY.width / 2 < a.x || x + BODY.width / 2 > a.x + a.width) continue;
    const b = { x: x - BODY.width / 2, y: sideY - BODY.height, width: BODY.width, height: BODY.height };
    if (above.some(o => area(o, b) > BODY.width * BODY.height * .18)) continue;
    return { ...safePoint(display, x, sideY,BODY), kind: 'window', windowId: w.id, edge: side, posture: 'stand', fallback: null };
  }
  const result = fallback('窗口边缘没有足够的可见空间，暂留桌面边缘');
  return { ...result, ...safePoint(display, a.x + a.width - 160, a.y + a.height - 12,BODY) };
}

export class Embodiment {
  constructor(store) {
    this.store = store;
    this.body=BODY;
    const previous = store.state.character;
    this.state = store.state.character = {
      enabled: previous?.enabled !== false,
      revision: randomUUID(),
      request: previous?.request?.kind === 'point' && Number.isFinite(previous.request.x) && Number.isFinite(previous.request.y) ? previous.request : { kind: 'desktop', posture: 'stand' },
      position: previous?.position || null, arrivedRevision: null, engagement: null, gesture: null,
    };
    this.connectedAt = 0; this.lastSaved = 0; this.lastFallback = null; this.store.save();
  }
  snapshot(windows, displays, speech, quiet, performance = null) {
    if (this.state.engagement && Date.now() > this.state.engagement.until) this.state.engagement = null;
    const approach=performance?.windowId&&performance.until>Date.now()&&this.state.enabled&&this.state.request.kind!=='point'&&!this.state.engagement&&Date.now()>(this.manualUntil||0);
    const target = resolveAnchor(approach?{kind:'window',windowId:performance.windowId,edge:'auto',posture:'stand'}:this.state.request, windows, displays,this.body);
    return { ...this.state, target, displays, body:this.body, connected: Date.now() - this.connectedAt < 5000, speech: quiet ? null : speech, now: Date.now() };
  }
  move(data, windows, displays, actor = 'model') {
    if (!this.state.enabled && actor === 'model') return { ok: false, reason: '用户收起了桌面角色，保留当前位置' };
    if (data.windowId && data.windowId !== 'desktop') {
      const w = data.windowId === 'active' ? windows.find(w => w.active && !w.minimized && !w.internal) : windows.find(w => w.id === data.windowId && !w.minimized && !w.internal);
      if (!w) throw new Error('目标窗口已经关闭或最小化，请重新观察');
      this.state.request = { kind: 'window', windowId: w.id, edge: ['auto', 'top', 'left', 'right'].includes(data.edge) ? data.edge : 'auto', posture: data.posture === 'stand' ? 'stand' : 'sit' };
    } else this.state.request = { kind: 'desktop', posture: data.posture === 'sit' ? 'sit' : 'stand' };
    this.state.revision = randomUUID(); this.state.arrivedRevision = null; this.state.movePlanId = this.store.state.plans.find(p => p.status === 'active')?.id || null; this.store.save();
    const target = resolveAnchor(this.state.request, windows, displays,this.body);
    return this.store.receipt('character.move.requested', { ok: true, submitted: true, revision: this.state.revision, windowId: this.state.request.windowId || null, target: target ? { x: target.x, y: target.y, displayId: target.displayId, edge: target.edge, fallback: target.fallback } : null, reason: String(data.reason || '').slice(0, 140), note: '已交给角色移动，抵达后另行回报' }, actor);
  }
  report(data, windows, displays) {
    if (data.revision !== this.state.revision || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return { ok: false, stale: true };
    this.connectedAt = Date.now();
    const target = resolveAnchor(this.state.request, windows, displays,this.body);
    if (!displays.some(d => String(d.id) === String(data.displayId))) return { ok: false, stale: true };
    this.state.position = { x: data.x, y: data.y, displayId: String(data.displayId) };
    if (data.arrived && target && String(target.displayId) === String(data.displayId) && Math.hypot(target.x - data.x, target.y - data.y) < 22 && this.state.arrivedRevision !== this.state.revision) {
      this.state.arrivedRevision = this.state.revision;
      return this.store.receipt('character.arrived', { ok: true, verified: true, revision: this.state.revision, windowId: target.windowId || null, edge: target.edge, fallback: target.fallback, planId: this.state.movePlanId || null }, 'renderer');
    }
    if (Date.now() - this.lastSaved > 5000) { this.lastSaved = Date.now(); this.store.save(); }
    return { ok: true };
  }
  drag(data, displays) {
    this.manualUntil=Date.now()+15000;
    const display = displays.find(d => String(d.id) === String(data.displayId));
    if (!display || !Number.isFinite(data.x) || !Number.isFinite(data.y)) throw new Error('角色位置无效');
    const position = safePoint(display, data.x, data.y,this.body);
    this.state.position = position; this.state.request = { kind: 'point', ...position, posture: 'stand' }; this.state.revision = randomUUID(); this.state.arrivedRevision = this.state.revision; this.store.save();
    return { ok: true };
  }
  enable(enabled) { this.state.enabled = enabled === true; this.store.save(); }
  act(word) {
    if (!['wave', 'nod', 'happy', 'thinking', 'sit', 'stand', 'sleep', 'look'].includes(word)) throw new Error('不支持这个动作');
    this.state.gesture = { id: randomUUID(), word, until: Date.now() + 4000 }; return { ok: true };
  }
  engage() { this.state.engagement = { kind: 'qq', since: Date.now(), until: Date.now() + 90000 }; }
  sent() { if (this.state.engagement) { this.state.engagement.kind = 'qq-sent'; this.state.engagement.until = Date.now() + 3500; } }
}
