import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicController } from '../music.mjs';

function fixture({ allowed = true, available = true, verified = true, request } = {}) {
  const calls = [], launches = [];
  const f = { allowed, available };
  f.music = new MusicController({ selection: () => 'G:\\Music\\cloudmusic.exe', isAllowed: () => f.allowed, launch: async id => { launches.push(id); f.available = true; return { submitted: true }; }, delay: async () => {}, workerFactory: () => ({ close() {}, async request(command) { calls.push(command); if (request) return request(command, f); return { ok: true, verified, accepted: true, state: { available: f.available, reason: f.available ? null : 'no_netease_controls', status: command === 'pause' ? 'Paused' : 'Playing', title: '测试曲目' } }; } }) });
  return Object.assign(f, { calls, launches });
}
test('revoked music permission blocks observation, launch and playback', async () => {
  const f = fixture({ allowed: false }); const r = await f.music.run('play'); assert.equal(r.ok, false); assert.equal(r.state.allowed, false); assert.deepEqual(f.calls, []); assert.deepEqual(f.launches, []);
});
test('only play may start a closed player, and app launch alone is not success', async () => {
  const f = fixture({ available: false }); for (const c of ['status', 'pause', 'next', 'previous']) await f.music.run(c); assert.deepEqual(f.launches, []);
  const r = await f.music.run('play'); assert.equal(f.launches.length, 1); assert.equal(r.verified, true); assert.equal(f.calls.at(-1), 'play');
});
test('accepted but unverified playback is never reported as completed', async () => {
  const f = fixture({ verified: false }); const r = await f.music.run('next'); assert.equal(r.accepted, true); assert.equal(r.ok, false); assert.equal(r.verified, false);
});
test('an existing minimized window uses scoped controls without relaunch or focus', async () => {
  const f = fixture({ request: async command => ({ ok: true, verified: command !== 'status', state: command === 'status' ? { available: false, reason: 'no_netease_controls', windowCandidates: 1 } : { available: true, status: 'Playing' } }) });
  const r = await f.music.run('play'); assert.equal(r.ok, true); assert.deepEqual(f.launches, []); assert.deepEqual(f.calls, ['status', 'play']);
});
test('revocation during observation prevents the subsequent control', async () => {
  const f = fixture({ request: async (command, self) => { self.allowed = false; return { ok: true, state: { available: true } }; } }); const r = await f.music.run('play'); assert.equal(r.ok, false); assert.deepEqual(f.calls, ['status']);
});
test('simultaneous requests are serialized, unsupported commands never reach player', async () => {
  const f = fixture(); await Promise.all([f.music.run('pause'), f.music.run('play')]); assert.deepEqual(f.calls, ['status', 'pause', 'status', 'play']); await assert.rejects(f.music.run('purchase')); assert.equal(f.calls.length, 4);
});
