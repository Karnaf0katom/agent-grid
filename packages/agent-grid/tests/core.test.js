import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attentionRank, mergeTileOrder, insertTileOrder, resizeGridTracks, tileColumns, layoutKey, createLayoutStore, normalizeSessions, createHttpAdapter, createMemoryAdapter } from '../src/index.js';

const session = (id, extra = {}) => ({ id, title: id, status: 'running', ...extra });

test('attention sort and saved order preserve the Fleet Grid behavior', () => {
  const current = [session('normal'), session('urgent', { needsYou: true }), session('waiting', { status: 'waiting' })];
  assert.deepEqual(mergeTileOrder(current).map(row => row.id), ['urgent', 'waiting', 'normal']);
  assert.deepEqual(mergeTileOrder(current, ['missing', 'normal', 'normal']).map(row => row.id), ['urgent', 'waiting', 'normal']);
  assert.ok(attentionRank(current[1]) > attentionRank(current[2]));
  assert.deepEqual(mergeTileOrder([session('b'), session('d'), session('new')], ['a', 'b', 'b', 'c', 'd']).map(row => row.id), ['b', 'd', 'new']);
});

test('reordering is immutable and handles stale or repeated drag targets', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(insertTileOrder(ids, 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(insertTileOrder(ids, 'a', 'c', 'after'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  assert.equal(insertTileOrder(ids, 'x', 'a'), ids);
  assert.equal(insertTileOrder(ids, 'a', 'a'), ids);
});

test('resize conserves total weight and enforces usable adjacent widths', () => {
  for (const delta of [-10000, -240, 0, 240, 10000]) {
    const tracks = [1, 2, 3];
    const resized = resizeGridTracks(tracks, 0, delta, 300, 600, 220);
    assert.equal(resized[2], 3);
    assert.ok(Math.abs(resized[0] + resized[1] - 3) < 1e-10);
    assert.ok(resized[0] / 3 * 900 >= 220 - 1e-8);
    assert.ok(resized[1] / 3 * 900 >= 220 - 1e-8);
    assert.deepEqual(tracks, [1, 2, 3]);
  }
  assert.deepEqual(resizeGridTracks([1, 1], 0, 400, 100, 100, 220), [1, 1]);
  assert.deepEqual(resizeGridTracks([1, 1], 0, NaN, 100, 100), [1, 1]);
  assert.equal(tileColumns(9, 390), 1);
  assert.equal(tileColumns(4, 1440), 2);
  assert.equal(tileColumns(30, 1900), 4);
});

test('layout identity avoids reorder changes, namespace collisions, and storage failures', () => {
  assert.equal(layoutKey('group / one', ['b', 'a'], 2), layoutKey('group / one', ['a', 'b'], 2));
  assert.notEqual(layoutKey('group', ['a,b', 'c'], 2), layoutKey('group', ['a', 'b,c'], 2));
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  const store = createLayoutStore(throwing);
  assert.deepEqual(store.read(), {});
  assert.doesNotThrow(() => store.write({ orders: ['a'] }));
  assert.deepEqual(createLayoutStore({ getItem: () => '[]' }).read(), {});
});

test('session normalization makes permissions opt-in and rejects ambiguous identities', () => {
  const rows = normalizeSessions([session('a', { capabilities: { send: 'true', interrupt: true }, unknown: 'private' })]);
  assert.equal(rows[0].capabilities.send, false);
  assert.equal(rows[0].capabilities.interrupt, true);
  assert.ok(!('unknown' in rows[0]));
  assert.throws(() => normalizeSessions([session('a'), session('a')]), /unique/);
  assert.throws(() => normalizeSessions([{ id: '' }]), /unique/);
  assert.throws(() => normalizeSessions({ nope: [] }), /array/);
});

test('read-only HTTP adapter cannot send even when the host advertises input', async () => {
  const calls = [];
  const adapter = createHttpAdapter({ readOnly: true, fetch: async (url, options) => {
    calls.push([url, options]);
    return { ok: true, status: 200, json: async () => ({ sessions: [session('a', { capabilities: { send: true, interrupt: true } })] }) };
  } });
  assert.equal((await adapter.listSessions())[0].capabilities.send, false);
  assert.throws(() => adapter.sendPrompt('a', 'hello'), /read-only/);
  assert.throws(() => adapter.performAction('a', 'interrupt'), /read-only/);
  assert.equal(calls.length, 1);
});

test('HTTP ids are encoded and failed JSON or permissions are surfaced', async () => {
  let seen;
  const adapter = createHttpAdapter({ baseUrl: '/host/', fetch: async url => {
    seen = url; return { ok: false, status: 403, json: async () => ({ error: 'Permission denied by host.' }) };
  } });
  await assert.rejects(adapter.readOutput('a/b?#'), /Permission denied by host/);
  assert.equal(seen, '/host/api/sessions/a%2Fb%3F%23/output');
  const invalid = createHttpAdapter({ fetch: async () => ({ status: 502, json: async () => { throw new Error(); } }) });
  await assert.rejects(invalid.listSessions(), /invalid JSON/);
});

test('the demo delivers to one session only and capability revocation is enforced', async () => {
  const adapter = createMemoryAdapter([session('a', { capabilities: { send: true } }), session('b')], { a: 'alpha', b: 'beta' });
  let notices = 0;
  const unsubscribe = adapter.subscribe(() => notices++);
  await adapter.sendPrompt('a', 'one\ntwo');
  assert.match((await adapter.readOutput('a')).text, /one\ntwo/);
  assert.equal((await adapter.readOutput('b')).text, 'beta');
  await assert.rejects(adapter.sendPrompt('b', 'hello'), /does not permit/);
  adapter.update([session('a')]);
  await assert.rejects(adapter.sendPrompt('a', 'revoked'), /does not permit/);
  await assert.rejects(adapter.readOutput('b'), /no longer exists/);
  unsubscribe();
  assert.equal(notices, 2);
});
