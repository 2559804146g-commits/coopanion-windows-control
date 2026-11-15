import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAnchor, Embodiment, BODY } from '../spatial.mjs';
import { DesktopStore } from '../store.mjs';
const displays = [{ id: 'one', primary: true, workArea: { x: 0, y: 0, width: 1600, height: 1000 } }];
const window = (id, x = 100, y = 350, width = 800, height = 420) => ({ id, rect: { x, y, width, height }, minimized: false });
test('window anchors use the currently configured original body dimensions',()=>{
 const request={kind:'window',windowId:'a',edge:'auto'},target=window('a',100,130,800,400);
 const small=resolveAnchor(request,[target],displays,{width:70,height:80});assert.equal(small.edge,'top');assert.equal(small.y,130);
 const large=resolveAnchor(request,[target],displays,{width:160,height:220});assert.notEqual(large.edge,'top');
 const point=resolveAnchor({kind:'point',x:0,y:0},[],displays,{width:200,height:300});assert.ok(point.x>=108);assert.ok(point.y>=310);
});
test('safe visible window top is chosen and tracks the same moving window', () => {
  const request = { kind: 'window', windowId: 'a', edge: 'auto', posture: 'sit' };
  const first = resolveAnchor(request, [window('a')], displays);
  assert.equal(first.edge, 'top'); assert.equal(first.y, 350); assert.equal(first.windowId, 'a');
  const moved = resolveAnchor(request, [window('a', 250, 410)], displays);
  assert.equal(moved.x - first.x, 150); assert.equal(moved.y - first.y, 60);
});
test('occluded portions of a ledge are not selected', () => {
  const target = window('a', 100, 350, 1000);
  const cover = window('cover', 600, 150, 700, 450);
  const p = resolveAnchor({ kind: 'window', windowId: 'a' }, [cover, target], displays);
  assert.equal(p.edge, 'top'); assert.ok(p.x + BODY.width / 2 < cover.rect.x);
});
test('maximized, closed and minimized windows return a bounded desktop anchor', () => {
  for (const list of [[], [{ ...window('a'), minimized: true }], [window('a', 0, 0, 1600, 1000)]]) {
    const p = resolveAnchor({ kind: 'window', windowId: 'a' }, list, displays);
    assert.equal(p.kind, 'desktop'); assert.ok(p.fallback); assert.ok(p.x > 0 && p.x < 1600 && p.y <= 1000);
  }
});
test('DIP rectangles are used rather than unscaled physical pixels', () => {
  const w = window('a', 125, 437.5, 1000, 525); w.dipRect = { x: 100, y: 350, width: 800, height: 420 };
  const p = resolveAnchor({ kind: 'window', windowId: 'a' }, [w], displays); assert.equal(p.y, 350);
});
test('negative-coordinate secondary display is supported', () => {
  const d = [...displays, { id: 'left', primary: false, workArea: { x: -1280, y: 0, width: 1280, height: 900 } }];
  const p = resolveAnchor({ kind: 'window', windowId: 'a' }, [window('a', -1200, 320, 700, 400)], d);
  assert.equal(p.displayId, 'left'); assert.ok(p.x < 0); assert.equal(p.y, 320);
});
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spatial-test-'));
  try { fn(new DesktopStore(dir)); } finally { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('spatial-test-')); fs.rmSync(dir, { recursive: true, force: true }); }
}
test('movement is only verified by a current arrival near the actual anchor', () => fixture(store => {
  const body = new Embodiment(store), ws = [window('a')];
  const request = body.move({ windowId: 'a' }, ws, displays);
  assert.ok(request.submitted); assert.equal(body.state.arrivedRevision, null);
  body.report({ revision: request.revision, x: 2, y: 2, displayId: 'one', arrived: true }, ws, displays);
  assert.equal(body.state.arrivedRevision, null);
  const p = resolveAnchor(body.state.request, ws, displays);
  const receipt = body.report({ revision: request.revision, ...p, arrived: true }, ws, displays);
  assert.equal(receipt.kind, 'character.arrived'); assert.equal(receipt.verified, true);
  const next = body.move({ windowId: 'desktop' }, ws, displays);
  assert.notEqual(next.revision, request.revision);
  assert.equal(body.report({ revision: request.revision, ...p, arrived: true }, ws, displays).stale, true);
}));
test('QQ attention preserves the window target and the active plan', () => fixture(store => {
  const plan = store.startPlan({ title: '继续写自己的记录' }), body = new Embodiment(store);
  body.move({ windowId: 'a' }, [window('a')], displays);
  body.engage(); assert.equal(body.state.request.windowId, 'a'); body.sent();
  assert.equal(store.state.plans[0].id, plan.id); assert.equal(store.state.plans[0].status, 'active');
  body.state.engagement.until = Date.now() - 1;
  assert.equal(body.snapshot([window('a')], displays, null, false).engagement, null); assert.equal(body.state.request.windowId, 'a');
}));
test('hidden character stays hidden to model requests and manual drops stay in work area', () => fixture(store => {
  const body = new Embodiment(store); body.enable(false);
  assert.equal(body.move({ windowId: 'a' }, [window('a')], displays, 'model').ok, false);
  body.drag({ displayId: 'one', x: -999, y: 99999 }, displays);
  const p = body.snapshot([], displays, null, false).target;
  assert.ok(p.x >= BODY.width / 2); assert.ok(p.y < 1000);
}));
test('arrival evidence stays with the plan that requested the move', () => fixture(store => {
  const body = new Embodiment(store), ws = [window('a')];
  const first = store.startPlan({ title: '先去一个窗口旁边' });
  const request = body.move({ windowId: 'a' }, ws, displays);
  const second = store.startPlan({ title: '新的邀请' });
  const target = resolveAnchor(body.state.request, ws, displays);
  const receipt = body.report({ revision: request.revision, ...target, arrived: true }, ws, displays);
  assert.equal(receipt.planId, first.id);
  assert.throws(() => store.finishPlan(second.id, [receipt.id]));
}));
