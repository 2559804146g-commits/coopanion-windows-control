import { randomUUID, createHash } from 'node:crypto';

const terminal = new Set(['succeeded', 'cancelled']);
const blocked = new Set(['blocked', 'uncertain', 'paused']);
const safeKey = key => !['__proto__', 'prototype', 'constructor'].includes(key);
const copy = value => JSON.parse(JSON.stringify(value));

export function validate(schema, value, name = '参数') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(name + '需要对象');
    for (const key of Object.keys(value)) if (!safeKey(key) || !Object.hasOwn(schema.properties, key)) throw new Error(name + '包含未知字段：' + key);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(name + '缺少：' + key);
    for (const key of Object.keys(value)) validate(schema.properties[key], value[key], name + '.' + key);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim() || value.length > (schema.maxLength || 20000)) throw new Error(name + '文字无效');
    if (schema.enum && !schema.enum.includes(value)) throw new Error(name + '不在支持范围');
  } else if (schema.type === 'boolean') { if (typeof value !== 'boolean') throw new Error(name + '需要开关值'); }
  else if (schema.type === 'number' || schema.type === 'integer') { if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || (schema.minimum != null && value < schema.minimum) || (schema.maximum != null && value > schema.maximum)) throw new Error(name + '数值无效'); }
  else if (schema.type === 'array') { if (!Array.isArray(value) || value.length < (schema.minItems || 0) || value.length > (schema.maxItems || 100)) throw new Error(name + '列表无效'); for (const item of value) validate(schema.items, item, name); }
  else throw new Error('不支持的能力参数类型');
}

function reference(task, expression) {
  const [id, ...keys] = expression.split('.');
  const step = task.steps.find(s => s.id === id && s.status === 'succeeded');
  if (!step || !keys.length || keys.some(k => !safeKey(k))) throw new Error('步骤结果引用无效：' + expression);
  let value = step.output;
  for (const key of keys) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('步骤结果不存在：' + expression); value = value[key]; }
  return copy(value);
}
export function resolveArguments(value, task) {
  if (typeof value === 'string') return value.replace(/\{\{([\w.-]+)\}\}/g, (_, expression) => { const result = reference(task, expression); if (typeof result === 'object') throw new Error('模板只接受文字结果'); return String(result); });
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && typeof value.$ref === 'string') return reference(task, value.$ref);
  if (Array.isArray(value)) return value.map(item => resolveArguments(item, task));
  const result = {}; for (const [key, item] of Object.entries(value)) { if (!safeKey(key)) throw new Error('不支持的参数字段'); result[key] = resolveArguments(item, task); } return result;
}

// Intent and decisions belong to the shared persona. This executor owns durable
// progress, permission checks, ordering, evidence and recovery, not freeform claims.
export class TaskRuntime {
  constructor({ store, capabilities, environment = () => ({}), changed = () => {}, clock = Date.now, performance = () => {}, profile=()=>null, artifact=()=>{} }) {
    Object.assign(this, { store, capabilities, environment, changed, clock, performance, profile, artifact });
    const s = store.state;
    s.tasks ||= []; s.requests ||= []; s.experiences ||= []; s.capabilityGaps ||= []; s.lastAutonomyAt ||= 0;
    for(const t of s.tasks)t.holds||=t.hold?[t.hold]:[];
    for (const gap of s.capabilityGaps) gap.status = gap.capabilityId ? (Object.hasOwn(capabilities, gap.capabilityId) ? 'available' : 'unimplemented') : 'needs_review';
    this.ready = false; this.stopped = false; this.flight = null;
  }
  save() { this.store.save(); this.changed(); }
  catalog() { return Object.entries(this.capabilities).map(([id, cap]) => ({ id, description: cap.description, arguments: cap.schema, interaction: cap.interaction || 'background', readOnly: !!cap.readOnly, verification: cap.verification, ...cap.availability?.() })); }
  syncCapabilities(version) {
    const catalog = this.catalog(), s = this.store.state;
    const revision = createHash('sha256').update(JSON.stringify({ version, catalog, allowedApps: [...s.allowedApps].sort(), appAccess: Object.entries(s.appAccess).sort(([a],[b]) => a.localeCompare(b)), musicAppId: s.musicAppId })).digest('hex').slice(0, 20);
    if (s.capabilityRevision !== revision) {
      s.capabilityRevision = revision;
      this.store.event('capabilities-changed', `桌面能力或授权已更新，版本${version}，修订${revision}。当前已注册：${catalog.map(c => c.id).join('、')}。旧对话或缺口记录不能代表当前能力；理解应用操作需求时先查询desktop_capabilities，再规划。此通知不是用户任务，不创建验收、不改变播放、不向QQ广播。`);
    }
    return revision;
  }
  summary(task) { const { steps, ...rest } = task; return { ...rest, steps: steps.map(({ output, resolved, args, ...s }) => s) }; }
  snapshot() { const pending = this.store.state.tasks.filter(t => !terminal.has(t.status)), recent = this.store.state.tasks.filter(t => terminal.has(t.status)).slice(-6); return { tasks: [...pending, ...recent].sort((a,b)=>a.createdAt-b.createdAt).map(t => this.summary(t)), requests: this.store.state.requests.slice(-10), experiences: this.store.state.experiences.slice(-15), capabilityGaps: this.store.state.capabilityGaps.slice(-15), busy: !!this.flight }; }
  request(text, source = 'desktop', externalId = null, testing = false, route = null) {
    const old = externalId && this.store.state.requests.find(r => r.source === source && r.externalId === externalId); if (old) return old;
    const r = { id: randomUUID(), text: String(text).slice(0, 1600), source, externalId, testing, route:route?copy(route):null, createdAt: this.clock(), taskId: null };
    this.store.state.requests.push(r); this.store.state.requests = this.store.state.requests.slice(-80); this.save(); return r;
  }
  gap({ description, requestId = null, capabilityId = null }) {
    const text = String(description || '').trim().slice(0, 500); if (!text) throw new Error('需要说明能力缺口');
    if (capabilityId != null && (typeof capabilityId !== 'string' || !/^[a-z][\w.-]{0,79}$/.test(capabilityId))) throw new Error('能力编号无效');
    const id = createHash('sha256').update(text + (capabilityId || '')).digest('hex').slice(0, 16);
    const old = this.store.state.capabilityGaps.find(g => g.id === id); if (old) return old;
    const item = { id, description: text, requestId, capabilityId, status: capabilityId ? (Object.hasOwn(this.capabilities, capabilityId) ? 'available' : 'unimplemented') : 'needs_review', createdAt: this.clock() }; this.store.state.capabilityGaps.push(item); this.store.state.capabilityGaps = this.store.state.capabilityGaps.slice(-60); this.save(); return item;
  }
  prepareSteps(steps, retained = []) {
    if (!Array.isArray(steps) || !steps.length || steps.length + retained.length > 12) throw new Error('任务需要1至12个明确步骤');
    const ids = new Set(retained.map(s => s.id));
    return steps.map((s, i) => {
      const id = String(s.id || 'step' + (i + retained.length + 1));
      if (!/^[a-zA-Z][\w-]{0,35}$/.test(id) || ids.has(id)) throw new Error('步骤编号无效或重复'); ids.add(id);
      if (!Object.hasOwn(this.capabilities, s.capability)) throw new Error('尚未实现能力：' + s.capability + '。请记录缺口，不能改称已完成。');
      const args = typeof s.args_json === 'string' ? JSON.parse(s.args_json) : (s.args || {});
      if (JSON.stringify(args).length > 24000) throw new Error('步骤参数过长');
      // Reference-containing values are validated after resolution as well.
      const check = value => { if (!value || typeof value !== 'object') return; for (const k of Object.keys(value)) { if (!safeKey(k)) throw new Error('参数字段无效'); check(value[k]); } }; check(args);
      const refs = [...JSON.stringify(args).matchAll(/(?:\{\{|"\$ref"\s*:\s*")([\w-]+)\./g)].map(m => m[1]);
      if (refs.some(ref => ref === id || !ids.has(ref))) throw new Error('只能引用前面步骤的结果');
      if (!refs.length) validate(this.capabilities[s.capability].schema, args);
      return { id, capability: s.capability, title: String(s.title || this.capabilities[s.capability].description).slice(0, 100), args: copy(args), status: 'pending', attempts: 0 };
    });
  }
  create(data, actor = 'model') {
    const title = String(data.title || '').trim().slice(0, 120); if (!title) throw new Error('需要实际目标');
    const request = data.requestId ? this.store.state.requests.find(r => r.id === data.requestId) : null;
    if (data.requestId && !request) throw new Error('原始请求不存在，请重新观察');
    if (request?.taskId) return { ok: true, duplicate: true, task: this.summary(this.get(request.taskId)) };
    if (this.store.state.tasks.filter(t => !terminal.has(t.status)).length >= 24) throw new Error('待处理任务过多，请先整理已有任务');
    const steps = this.prepareSteps(data.steps);
    const fingerprint=createHash('sha256').update(JSON.stringify({title,purpose:data.purpose||'user',actor,steps:steps.map(s=>({capability:s.capability,args:s.args}))})).digest('hex');
    if(!request&&!data.intentionId){const prior=this.store.state.tasks.find(t=>t.fingerprint===fingerprint&&!terminal.has(t.status));if(prior)return {ok:true,duplicate:true,task:this.summary(prior)};}
    const intention = data.intentionId && this.store.state.life?.intentions.find(i=>i.id===data.intentionId);
    if(data.intentionId&&(!intention||data.purpose!=='autonomy'||request?.testing||intention.taskId))throw new Error('打算只能关联一次真实自主任务；已有任务请先查看并接续');
    const t = { id: randomUUID(), title, requestId: request?.id || null, source: request?.source || (actor === 'user' ? 'desktop' : 'role'), purpose: request?.testing || data.purpose === 'test' ? 'test' : data.purpose === 'autonomy' ? 'autonomy' : data.purpose === 'compatibility' ? 'compatibility' : 'user', notify: data.notify !== false, status: 'queued', createdAt: this.clock(), updatedAt: this.clock(), steps, reason: null, manualPaused: false };
    Object.assign(t,{fingerprint,route:request?.route?copy(request.route):null,profile:copy(this.profile()),holds:[]});
    this.store.state.tasks.push(t); const done = this.store.state.tasks.filter(x => terminal.has(x.status)); if (done.length > 60) { const remove = new Set(done.slice(0, done.length - 60).map(x => x.id)); this.store.state.tasks = this.store.state.tasks.filter(x => !remove.has(x.id)); }
    if(intention){t.intentionId=intention.id;intention.taskId=t.id;intention.status='doing';}
    if (request) request.taskId = t.id;
    this.save(); void this.pump(); return { ok: true, submitted: true, task: this.summary(t) };
  }
  get(id) { const t = this.store.state.tasks.find(t => t.id === id); if (!t) throw new Error('任务不存在'); return t; }
  control(id, command) {
    const t = this.get(id); if (terminal.has(t.status)) return { ok: true, task: this.summary(t) };
    if (command === 'cancel') { t.status = 'cancelled'; t.reason = '任务已停止；已发生的操作和结果保留';for(const s of t.steps)if(s.status!=='succeeded')this.capabilities[s.capability]?.cancel?.(s,t); }
    else if (command === 'pause') { t.status = 'paused'; t.manualPaused = true; t.reason = '已暂停；当前已提交的操作核验后不执行下一步'; }
    else if (command === 'resume') {
      if(t.hold)throw Error('还有待回应的消息，处理完成后再接续；当前进度已保存');
      if (t.steps.some(s => s.status === 'uncertain')) throw new Error('有结果不确定的步骤，需要先核对；不能重新执行或重复切歌');
      for (const s of t.steps) if (s.status === 'blocked') s.status = 'pending';
      t.manualPaused = false; t.hold = null; t.status = 'queued'; t.reason = null;
    } else throw new Error('只支持暂停、继续和停止');
    if (t.status === 'queued' && t.steps.every(s => s.status === 'succeeded')) this.finish(t);
    t.updatedAt = this.clock(); this.save(); void this.pump(); return { ok: true, task: this.summary(t) };
  }
  revise(id, steps) {
    const t = this.get(id);
    if (terminal.has(t.status) || t.steps.some(s => ['running', 'uncertain'].includes(s.status))) throw new Error('正在执行或结果不确定，不能覆盖步骤');
    const retained = t.steps.filter(s => s.status === 'succeeded');
    t.steps = [...retained, ...this.prepareSteps(steps, retained)]; t.reason = null; t.status = t.manualPaused ? 'paused' : 'queued'; t.updatedAt = this.clock(); this.save(); void this.pump(); return { ok: true, task: this.summary(t) };
  }
  async recheck(id) {
    const t = this.get(id), s = t.steps.find(s => s.status !== 'succeeded');
    if (!s || s.status !== 'uncertain' || t.status === 'cancelled') throw new Error('没有需要核对的步骤');
    const cap = this.capabilities[s.capability];
    if (!cap?.recover) return { ok: false, taskId: id, reason: '这一步没有可靠的只读核对方法；保留未确认状态，不重复操作' };
    const denied = cap.check?.(s.resolved || s.args, t); if (denied) return { ok: false, taskId: id, reason: denied };
    let result; try { result = await cap.recover(s, t); } catch { }
    if (!result?.ok || !result.verified) return { ok: false, taskId: id, reason: '实际观察尚不能证明目标已经达到，保留原进度' };
    this.completeStep(t, s, result); t.status = t.manualPaused || t.hold ? 'paused' : 'queued'; t.reason = null;
    if (t.status === 'queued' && t.steps.every(s => s.status === 'succeeded')) this.finish(t);
    this.save(); void this.pump(); return { ok: true, verified: true, task: this.summary(t) };
  }
  interrupt(key, before = Infinity) {
    for (const t of this.store.state.tasks) if (t.createdAt <= before && !terminal.has(t.status) && !['blocked','uncertain'].includes(t.status)) {
      t.holds||=t.hold?[t.hold]:[];if(!t.holds.includes(key))t.holds.push(key);t.hold=t.holds[0];t.status='paused';t.reason='先回应消息，当前进度已保存';
      t.continuation={pausedAt:this.clock(),stepId:t.steps.find(s=>s.status!=='succeeded')?.id||null,completedSteps:t.steps.filter(s=>s.status==='succeeded').map(s=>s.id),reason:t.reason};
    }
    this.save();
  }
  release(key) { for (const t of this.store.state.tasks) {t.holds||=t.hold?[t.hold]:[];if(!t.holds.includes(key))continue;t.holds=t.holds.filter(k=>k!==key);t.hold=t.holds[0]||null;if(!t.hold&&!t.manualPaused&&t.status==='paused'){t.status='queued';t.reason=null;t.continuation={...t.continuation,resumedAt:this.clock()};}}this.save();this.tick(); }
  eligible(t) {
    if (!['queued', 'running', 'waiting'].includes(t.status) || t.manualPaused || t.hold) return false;
    const env = this.environment();
    if (t.purpose === 'autonomy' && (!env.autonomy || env.quiet || (env.idleMs ?? 0) < 45000)) return false;
    const s = t.steps.find(s => s.status !== 'succeeded'); if (!s || s.status === 'uncertain' || s.status === 'blocked') return false;
    if (s.waitingFor === 'idle' && (env.idleMs ?? 0) < 8000) return false;
    if (s.retryAt && this.clock() < s.retryAt) return false;
    return true;
  }
  async recover() {
    for (const t of this.store.state.tasks) {
      if (!terminal.has(t.status)) for (const s of t.steps.filter(s => s.status === 'succeeded' && !s.receiptId)) {
        const evidence = [...this.store.state.receipts].reverse().find(r => r.kind === 'task.step.verified' && r.taskId === t.id && r.stepId === s.id && r.verified);
        if (evidence) s.receiptId = evidence.id;
        else { s.status = 'uncertain'; t.status = 'uncertain'; t.reason = '步骤完成标记缺少对应证据，不能按完成接续'; }
      }
      for (const s of t.steps.filter(s => s.status === 'running')) {
        const cap = this.capabilities[s.capability];
        if (cap?.readOnly) { s.status = 'pending'; }
        else {
          let result; try { if (!cap?.check?.(s.resolved || s.args, t)) result = await cap?.recover?.(s, t); } catch { }
          if (result?.ok && result.verified) this.completeStep(t, s, result);
          else { s.status = 'uncertain'; t.status = 'uncertain'; t.reason = '重启前操作结果未确认，保留进度并停止重放'; }
        }
      }
      if (t.status === 'running') t.status = 'queued';
      // Legacy QQ-only holds had no request identity; retain other outstanding interruptions.
      if (t.hold === 'qq') {t.holds=(t.holds||[]).filter(k=>k!=='qq');t.hold=t.holds[0]||null;if(!t.hold&&!t.manualPaused&&t.status==='paused')t.status='queued';}
    }
    this.ready = true; this.save(); this.tick();
  }
  completeStep(t, s, result) {
    s.status = 'succeeded'; s.output = copy(result.output ?? result); s.completedAt = this.clock(); s.reason = null;
    const receipt = this.store.receipt('task.step.verified', { ok: true, verified: true, taskId: t.id, stepId: s.id, capability: s.capability, planId: null, note: s.title }, 'executor'); s.receiptId = receipt.id;
    if(t.hold&&t.continuation){t.continuation.completedSteps=t.steps.filter(s=>s.status==='succeeded').map(s=>s.id);t.continuation.stepId=t.steps.find(s=>s.status!=='succeeded')?.id||null;}
    if(s.capability==='notes.write'&&s.output?.resource?.id&&t.purpose!=='test'){try{this.artifact(s.output.resource.id,{taskId:t.id,stepId:s.id,profile:t.profile});}catch(error){s.artifactError=error.message;}}
  }
  finish(t) {
    t.status = 'succeeded'; t.completedAt = this.clock(); t.reason = null;
    if (t.purpose === 'autonomy' || (t.purpose === 'user' && t.requestId)) { this.store.state.experiences.push({ id: randomUUID(), taskId: t.id, title: t.title, source: t.source, at: t.completedAt, facts: t.steps.map(s => ({ capability: s.capability, receiptId: s.receiptId, title: s.output?.state?.title || s.output?.resource?.title || null })) }); this.store.state.experiences = this.store.state.experiences.slice(-120); }
    if (t.notify !== false) this.store.event('task-result', `任务「${t.title}」所有步骤已实际核验成功，任务ID ${t.id}，原请求${t.requestId||'无'}，来源${t.source}${t.route?.to?'，原会话'+t.route.to:''}。按这个原请求的渠道回复实际结果，不依据最新一条无关消息猜收件人；桌面发起用desktop_say；验收、自主活动和连接事件不向QQ发送消息。不要重做任务或把测试写成生活经历。`,{taskId:t.id,requestId:t.requestId,route:t.route,purpose:t.purpose});
  }
  async pump() {
    if (!this.ready || this.stopped || this.flight) return;
    if(!this.store.state.tasks.some(t=>this.eligible(t)))return;
    const run = async () => {
      for (let count = 0; count < 100 && !this.stopped; count++) {
        const t = this.store.state.tasks.filter(t => this.eligible(t)).sort((a,b) => (a.purpose === 'autonomy') - (b.purpose === 'autonomy') || a.createdAt - b.createdAt)[0];
        if (!t) break;
        const s = t.steps.find(s => s.status !== 'succeeded'), cap = this.capabilities[s.capability];
        t.status = 'running'; t.updatedAt = this.clock(); s.waitingFor = null; s.retryAt = null;
        let result, dispatched = false;
        try {
          if (!cap) throw new Error('该能力当前不可用');
          const args = resolveArguments(s.args, t); validate(cap.schema, args); s.resolved = copy(args);
          const denied = cap.check?.(args, t); if (denied) result = { ok: false, blocked: true, reason: denied };
          else if (cap.interaction === 'foreground' && (this.environment().idleMs ?? 0) < 8000) result = { ok: false, deferred: true, waitingFor: 'idle', reason: '用户正在操作电脑，等待空闲后接着做' };
          else {
            s.status = 'running'; s.startedAt = this.clock(); s.attempts++; this.save();
            dispatched = true;
            if(!cap.background)this.performance({phase:'start',task:t,step:s});
            result = await cap.execute(args, { task: t, step: s, interrupted: () => this.stopped || t.status === 'cancelled' || t.manualPaused || !!t.hold });
          }
        } catch (e) { result = { ok: false, blocked: !dispatched || !!cap?.readOnly || e.beforeDispatch === true, accepted: dispatched && !cap?.readOnly && e.beforeDispatch !== true, reason: e.message }; }
        if(!cap?.background)this.performance({phase:'finish',task:t,step:s,result});
        if (result?.ok === true && result?.verified === true) this.completeStep(t, s, result);
        else if(result?.pending===true&&cap?.background===true){s.status='pending';s.waitingFor='background';s.retryAt=this.clock()+5000;s.reason=result.reason;s.attempts=Math.max(0,s.attempts-1);if(t.status==='running')t.status='waiting';}
        else if (result?.deferred && s.attempts < 4) { s.status = 'pending'; s.waitingFor = result.waitingFor || 'idle'; s.retryAt = this.clock() + 3000; s.reason = result.reason; if (t.status === 'running') t.status = 'waiting'; }
        else {
          s.status = result?.blocked || result?.deferred || result?.accepted === false ? 'blocked' : 'uncertain'; s.output = copy(result || { ok: false }); s.reason = result?.reason || result?.note || result?.error || '操作结果未确认，不自动重试';
          if (!terminal.has(t.status)) {
            t.status = s.status; t.reason = s.reason;
            const notification = s.id + ':' + s.status + ':' + s.reason;
            if (t.notify !== false && t.attentionNotified !== notification) { t.attentionNotified = notification; this.store.event('task-attention', `任务「${t.title}」进度已保存，任务ID ${t.id}，步骤「${s.title}」${s.status === 'uncertain' ? '结果不确定' : '暂时受阻'}：${s.reason}。先查询实际任务与能力，能用已有能力解决就继续规划；不能重放结果不确定的动作，缺少能力记录缺口并如实说明，不要求用户设计方案。验收和自主活动不向QQ发消息。`); }
          }
        }
        if (!terminal.has(t.status) && !blocked.has(t.status) && t.steps.every(s => s.status === 'succeeded')) this.finish(t);
        else if (t.status === 'running') t.status = 'queued';
        t.updatedAt = this.clock(); this.save();
      }
    };
    this.flight = run(); try { await this.flight; } finally { this.flight = null; this.changed(); }
  }
  tick() { if (this.ready && !this.stopped) { for (const t of this.store.state.tasks) if (t.status === 'queued' && t.steps.every(s => s.status === 'succeeded')) this.finish(t); void this.pump(); } }
  opportunity(fingerprint) {
    return this.store.state.tasks.find(t => {
      if (t.purpose === 'test' || t.purpose === 'compatibility' || !['blocked','uncertain'].includes(t.status) || t.manualPaused || t.lastOpportunity === fingerprint) return false;
      const s=t.steps.find(s=>s.status!=='succeeded'),cap=this.capabilities[s?.capability];
      if (!cap || (!cap.readOnly && !cap.recover)) return false;
      try { return !cap.check?.(s.resolved || s.args, t); } catch { return false; }
    });
  }
  stop() { this.stopped = true; }
  async drain() { await this.flight; }
}
