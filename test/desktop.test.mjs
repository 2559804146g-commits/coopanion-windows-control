import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DesktopStore } from '../store.mjs';
import { startDesktop } from '../server.mjs';

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'windows-desktop-test-')); }
function cleanup(dir) { const resolved = path.resolve(dir); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('windows-desktop-test-')); fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
test('real note creates a verified file that can be read after restart', () => {
  const dir = temporary(); try {
    const s = new DesktopStore(dir); const p = s.startPlan({ title: '写一份记录' });
    const note = s.writeNote({ title: '验收：文件读写', body: '这是一条标记为测试的真实写入记录。', category: '验收' });
    assert.ok(fs.existsSync(note.path)); assert.equal(note.receipt.planId, p.id); assert.ok(note.receipt.verified);
    const restored = new DesktopStore(dir); const result = restored.readNote(note.resource.id);
    assert.ok(result.content.includes('标记为测试')); assert.equal(result.resource.sha256, note.resource.sha256);
    assert.equal(restored.state.plans[0].status, 'active');
  } finally { cleanup(dir); }
});
test('submitted, failed, stale and fabricated evidence cannot finish a plan', () => {
  const dir = temporary(); try {
    const s = new DesktopStore(dir), old = s.startPlan({ title: '旧计划' });
    const oldReceipt = s.receipt('resource.read', { ok: true, verified: true });
    const p = s.startPlan({ title: '新计划' }); assert.equal(old.status, 'paused');
    const requested = s.receipt('app.launch.requested', { ok: true, submitted: true });
    const failed = s.receipt('window.focus', { ok: false });
    for (const id of [oldReceipt.id, requested.id, failed.id, 'nonexistent']) assert.throws(() => s.finishPlan(p.id, [id]));
    const note = s.writeNote({ title: '新记录', body: '本计划内实际写入', category: '验收' });
    assert.equal(s.finishPlan(p.id, [note.receipt.id]).status, 'completed');
    assert.throws(() => s.finishPlan(p.id, [note.receipt.id]));
  } finally { cleanup(dir); }
});
test('a new activity preserves the old plan, which can resume', () => {
  const dir = temporary(); try { const s = new DesktopStore(dir), a = s.startPlan({ title: '先做的事' }), b = s.startPlan({ title: '被邀请做的事' }); assert.equal(a.status, 'paused'); s.resumePlan(a.id); assert.equal(a.status, 'active'); assert.equal(b.status, 'paused'); } finally { cleanup(dir); }
});
test('file identities and canonical paths restrict reads to her workspace', () => {
  const dir = temporary(); try {
    const s = new DesktopStore(dir), note = s.writeNote({ title: '../../outside', body: '只能写在自己的空间' });
    assert.equal(path.dirname(note.path), path.join(s.workspace, '日记'));
    assert.throws(() => s.readNote('../../elsewhere'));
    note.resource.relativePath = '../../outside.txt'; assert.throws(() => s.readNote(note.resource.id));
    assert.throws(() => s.writeNote({ title: 'empty', body: '' }));
  } finally { cleanup(dir); }
});
test('corrupt primary storage recovers from the previous valid snapshot', () => {
  const dir = temporary(); try { const s = new DesktopStore(dir); s.startPlan({ title: '保留的计划' }); s.save(); fs.writeFileSync(s.file, '{broken'); const loaded = new DesktopStore(dir); assert.equal(loaded.state.plans[0].title, '保留的计划'); } finally { cleanup(dir); }
});
test('loopback API rejects cross-origin mutations and model permission changes', async () => {
  const dir = temporary();
  const fake = { snapshot: () => ({ observedAt: Date.now(), idleMs: 0, windows: [] }), idleMs: () => 0, loadApps: async () => [{ id: 'test:app', name: '测试应用' }], launch: async () => ({ ok: false, deferred: true }), focus: () => ({ ok: false }) };
  const d = await startDesktop({ port: 17839, dataDir: dir, adapter: fake, core: false });
  const base = 'http://127.0.0.1:17839';
  const post = (data, headers) => fetch(base + '/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    assert.equal((await post({ action: 'autonomy', enabled: false }, { Origin: 'https://example.org' })).status, 403);
    assert.equal((await post({ action: 'autonomy', enabled: false }, {})).status, 403);
    assert.equal((await post({ action: 'allow-app', id: 'test:app', allowed: true }, { 'x-desktop-token': d.token })).status, 400);
    assert.equal((await post({ action: 'select-music-player', id: 'test:app' }, { 'x-desktop-token': d.token })).status, 400);
    assert.equal((await post({ action: 'set-app-access', id: 'test:app', mode:'operate' }, { 'x-desktop-token': d.token })).status, 400);
    assert.equal((await post({ action: 'music-control', command: 'purchase' }, { 'x-desktop-token': d.token })).status, 400);
    assert.equal((await post({ action: 'allow-app', id: 'test:app', allowed: true }, { Origin: base })).status, 200);
    assert.ok(d.store.state.allowedApps.includes('test:app'));
    assert.equal((await fetch(base + '/api/bridge/events')).status, 403);
    assert.equal((await fetch(base + '/data/bridge-token')).status, 404);
    const bridge = await fetch(base + '/api/bridge/events', { headers: { 'x-desktop-token': d.token } }); assert.equal(bridge.status, 200);
    assert.equal((await bridge.json()).events[0].kind, 'connected');
    const result = await post({ action: 'write-note', title: '接口验收', body: '仅为自动检查', category: '验收' }, { 'x-desktop-token': d.token }); assert.equal(result.status, 200); assert.equal((await result.json()).receipt.verified, true);
  } finally { await d.close(); cleanup(dir); }
});
