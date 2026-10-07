import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createGridServer, parseOptions } from '../server.js';
import { createMemoryAdapter } from '../../../packages/agent-grid/src/index.js';

async function withServer(options, run) {
  const server = createGridServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run(origin); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Grid': '1', ...extra }, body: JSON.stringify(body) });
function rawGet(origin, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL('/api/sessions', origin), { headers }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

test('demo works without installing or starting an agent runtime', async () => {
  await withServer({}, async origin => {
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.equal(config.mode, 'demo');
    const { sessions } = await (await fetch(`${origin}/api/sessions`)).json();
    assert.equal(sessions.length, 6);
    assert.ok(sessions.find(row => row.needsYou));
    const sent = await fetch(`${origin}/api/sessions/inventory/input`, post({ text: 'Keep the existing permissions.\nVerify the empty state.' }));
    assert.equal(sent.status, 200);
    const output = await (await fetch(`${origin}/api/sessions/inventory/output`)).json();
    assert.match(output.text, /Keep the existing permissions/);
    const interrupted = await fetch(`${origin}/api/sessions/inventory/actions`, post({ action: 'interrupt' }));
    assert.equal(interrupted.status, 200);
    assert.equal((await fetch(`${origin}/sdk/element.js`)).status, 200);
  });
});

test('server rejects cross-origin, DNS rebinding, cross-site, and simple-form input', async () => {
  await withServer({}, async origin => {
    assert.equal((await fetch(`${origin}/api/sessions`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    // fetch can normalize Host. The raw HTTP client exercises the actual wire header.
    assert.equal(await rawGet(origin, { Host: 'rebind.example' }), 403);
    assert.equal((await fetch(`${origin}/api/sessions`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"text":"untrusted"}' })).status, 403);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, { ...post({ text: 'hello' }), headers: { 'Content-Type': 'application/json' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, post({ text: 'hello' }, { Origin: 'https://untrusted.example' }))).status, 403);
  });
});

test('read-only is enforced on the server independently of client UI and adapter claims', async () => {
  const adapter = createMemoryAdapter([{ id: 'a', title: 'a', status: 'running', capabilities: { send: true, interrupt: true } }], { a: 'unchanged' });
  await withServer({ readOnly: true, adapter }, async origin => {
    const { sessions } = await (await fetch(`${origin}/api/sessions`)).json();
    assert.equal(sessions[0].capabilities.send, false);
    assert.equal((await fetch(`${origin}/api/sessions/a/input`, post({ text: 'attempt' }))).status, 403);
    assert.equal((await fetch(`${origin}/api/sessions/a/actions`, post({ action: 'interrupt' }))).status, 403);
    assert.equal((await adapter.readOutput('a')).text, 'unchanged');
  });
});

test('permissions, malformed payloads, path ids, and unsupported actions are rejected', async () => {
  await withServer({}, async origin => {
    assert.equal((await fetch(`${origin}/api/sessions/changelog/actions`, post({ action: 'interrupt' }))).status, 403);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/actions`, post({ action: 'spawn' }))).status, 400);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, post({ text: '\x1b[31m' }))).status, 400);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, post({ text: 'x'.repeat(16001) }))).status, 413);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, post({ text: 'x'.repeat(21000) }))).status, 413);
    assert.equal((await fetch(`${origin}/api/sessions/%zz/output`)).status, 400);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, { ...post({}), body: '{broken' })).status, 400);
    assert.equal((await fetch(`${origin}/api/sessions/inventory/input`, post([]))).status, 400);
    assert.equal((await fetch(`${origin}/private/credentials`)).status, 404);
    assert.equal((await fetch(`${origin}/sdk/../../package.json`)).status, 404);
  });
});

test('CLI defaults to read-only tmux and cannot accept unknown options or conflicting policy', () => {
  assert.equal(parseOptions(['--tmux']).readOnly, true);
  assert.equal(parseOptions([]).mode, 'demo');
  assert.equal(parseOptions(['--tmux', '--allow-input']).readOnly, false);
  assert.equal(parseOptions(['--read-only']).readOnly, true);
  assert.throws(() => parseOptions(['--host', '0.0.0.0']), /Unknown option/);
  assert.throws(() => parseOptions(['--port', '-1']), /Port/);
  assert.throws(() => parseOptions(['--port']), /Missing/);
  assert.throws(() => parseOptions(['--read-only', '--allow-input']), /Choose either/);
});
