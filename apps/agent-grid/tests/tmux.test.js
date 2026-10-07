import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTmuxAdapter, validatePrompt } from '../adapters/tmux.js';
const execute = promisify(execFile);

test('tmux input is serialized with independent literal paste buffers and no shell invocation', async () => {
  const calls = [];
  const row = '%7\tagents\tmain\tcodex\t/tmp/work\trunning\t0\tCoder\tproject';
  const run = async (args, input) => { calls.push({ args, input }); return args.includes('list-panes') ? `${row}\n` : ''; };
  const adapter = createTmuxAdapter({ allowInput: true, socketName: 'grid-test', sessionPrefix: 'agents', run });
  await Promise.all([adapter.sendPrompt('%7', 'one\n$(echo literal)'), adapter.sendPrompt('%7', 'two')]);
  const writes = calls.filter(call => call.args.includes('load-buffer'));
  assert.deepEqual(writes.map(call => call.input), ['one\n$(echo literal)', 'two']);
  assert.notEqual(writes[0].args[4], writes[1].args[4]);
  const operations = calls.filter(call => !call.args.includes('delete-buffer') && !call.args.includes('list-panes')).map(call => call.args[2]);
  assert.deepEqual(operations, ['load-buffer', 'paste-buffer', 'send-keys', 'load-buffer', 'paste-buffer', 'send-keys']);
  assert.ok(calls.every(call => call.args[0] === '-L' && call.args[1] === 'grid-test'));
  await adapter.performAction('%7', 'interrupt');
  assert.ok(calls.at(-1).args.includes('C-c'));
});

test('tmux read-only and session filters cannot be bypassed by direct adapter calls', async () => {
  const calls = [];
  const run = async args => { calls.push(args); return '%7\tother\tmain\tcodex\t/tmp\trunning\t0\t\t\n'; };
  const restricted = createTmuxAdapter({ sessionPrefix: 'allowed', allowInput: true, run });
  await assert.rejects(restricted.sendPrompt('%7', 'hello'), /no longer available/);
  const readOnly = createTmuxAdapter({ run });
  await assert.rejects(readOnly.sendPrompt('%7', 'hello'), /does not permit/);
  await assert.rejects(readOnly.readOutput('-t; injection'), /Invalid pane/);
  assert.ok(calls.every(args => args.includes('list-panes')));
  assert.throws(() => createTmuxAdapter({ socketName: '../../bad' }), /simple/);
  assert.throws(() => validatePrompt('bad\x00prompt'), /control/);
  assert.equal(validatePrompt('one\r\ntwo'), 'one\ntwo');
});

test('real tmux uses a private socket and delivers multiline UTF-8 literally', { timeout: 15000 }, async t => {
  try { await execute('tmux', ['-V']); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('tmux is not installed'); return; } throw error; }
  const socketName = `agent-grid-test-${randomUUID().slice(0, 8)}`;
  const directory = await mkdtemp(join(tmpdir(), 'agent-grid-'));
  const script = join(directory, 'receiver.py');
  const sentinel = join(directory, 'must-not-exist');
  await writeFile(script, 'import json,sys\nprint("READY",flush=True)\nfor line in sys.stdin:\n print("RECEIVED:"+json.dumps(line.rstrip("\\n"),ensure_ascii=False),flush=True)\n');
  const tmux = (...args) => execute('tmux', ['-L', socketName, '-f', '/dev/null', ...args]);
  let created = false;
  const adapter = createTmuxAdapter({ socketName, allowInput: true, sessionPrefix: 'grid-smoke' });
  try {
    await tmux('new-session', '-d', '-s', 'grid-smoke', '-x', '180', '-y', '40', 'python3', '-u', script);
    created = true;
    const sessions = await adapter.listSessions();
    assert.equal(sessions.length, 1);
    const id = sessions[0].id;
    const waitFor = async pattern => {
      for (let count = 0; count < 80; count++) {
        const output = (await adapter.readOutput(id)).text;
        if (pattern.test(output)) return output;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.fail(`Expected ${pattern} in the isolated pane.`);
    };
    await waitFor(/READY/);
    await adapter.sendPrompt(id, `first line\nliteral $(touch ${sentinel})\nשלום 🦏 last line`);
    const output = await waitFor(/RECEIVED:.*last line/);
    assert.match(output, /RECEIVED:"first line"/);
    assert.match(output, /RECEIVED:"literal \$\(touch /);
    assert.match(output, /שלום 🦏 last line/);
    await assert.rejects(access(sentinel));
    const readonly = createTmuxAdapter({ socketName });
    await assert.rejects(readonly.sendPrompt(id, 'blocked'), /does not permit/);
  } finally {
    if (created) await tmux('kill-session', '-t', 'grid-smoke');
    await rm(directory, { recursive: true, force: true });
  }
});
