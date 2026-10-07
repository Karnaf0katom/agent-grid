// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

export class AdapterError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validatePrompt(text) {
  if (typeof text !== 'string' || !text.trim()) throw new AdapterError('Enter a nonempty prompt.');
  if (Buffer.byteLength(text, 'utf8') > 16000) throw new AdapterError('Prompts are limited to 16,000 UTF-8 bytes.', 413);
  const normalized = text.replace(/\r\n/g, '\n');
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(normalized)) throw new AdapterError('Prompts cannot contain terminal control characters.');
  return normalized;
}

function execute(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '', size = 0;
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new AdapterError('tmux did not respond in time.', 504)); }, 4000);
    child.on('error', error => {
      clearTimeout(timeout);
      reject(new AdapterError(error.code === 'ENOENT' ? 'Install tmux before using the tmux adapter.' : 'Could not contact tmux.', 503));
    });
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 1024 * 1024) { child.kill('SIGKILL'); reject(new AdapterError('Terminal output exceeded the snapshot limit.', 413)); }
      else stdout += outDecoder.write(data);
    });
    child.stderr.on('data', data => { if (stderr.length < 4096) stderr += errDecoder.write(data); });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout + outDecoder.end());
      else reject(new AdapterError(/no server running|failed to connect|error connecting/.test(stderr) ? 'No tmux server is running on this socket.' : 'tmux rejected the operation.', 503));
    });
    child.stdin.end(input);
  });
}

export function createTmuxAdapter({ allowInput = false, socketName, sessionPrefix = '', run = execute } = {}) {
  if (socketName && !/^[a-zA-Z0-9_-]{1,80}$/.test(socketName)) throw new AdapterError('Use a simple tmux socket name (letters, digits, underscore, hyphen).');
  const prefix = socketName ? ['-L', socketName] : [];
  const queues = new Map();
  const invoke = (args, input) => run([...prefix, ...args], input);
  async function listSessions() {
    let output;
    try {
      output = await invoke(['list-panes', '-a', '-F', '#{pane_id}\t#{session_name}\t#{window_name}\t#{pane_current_command}\t#{pane_current_path}\t#{@agent-grid-status}\t#{@agent-grid-needs-you}\t#{@agent-grid-title}\t#{@agent-grid-group}']);
    } catch (error) {
      if (error.message === 'No tmux server is running on this socket.') return [];
      throw error;
    }
    return output.trim().split('\n').filter(Boolean).flatMap(line => {
      const [id, name, window, command, cwd, reportedStatus, needsYou, title, group] = line.split('\t');
      if (!/^%[0-9]+$/.test(id) || !name.startsWith(sessionPrefix)) return [];
      const known = ['running', 'waiting', 'starting', 'error', 'queued', 'idle', 'stopped'];
      const status = known.includes(reportedStatus) ? reportedStatus : ['bash', 'zsh', 'sh', 'fish'].includes(command) ? 'idle' : 'running';
      return [{
        id, title: title || `${name} / ${window}`, group: group || name, tool: command || 'terminal',
        status, needsYou: needsYou === '1', detail: cwd?.split('/').filter(Boolean).at(-1) || '',
        capabilities: { send: allowInput, interrupt: allowInput && ['running', 'waiting', 'starting'].includes(status) },
      }];
    });
  }
  async function requireSession(id, action) {
    if (!/^%[0-9]+$/.test(id)) throw new AdapterError('Invalid pane id.', 404);
    const session = (await listSessions()).find(item => item.id === id);
    if (!session) throw new AdapterError('This pane is no longer available in the selected sessions.', 404);
    if (action && (!allowInput || !session.capabilities[action])) throw new AdapterError('The host does not permit this action.', 403);
    return session;
  }
  function serial(id, operation) {
    const previous = queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(id, next);
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  }
  return {
    listSessions,
    async readOutput(id) {
      await requireSession(id);
      return { text: await invoke(['capture-pane', '-p', '-t', id, '-S', '-500']), mode: 'snapshot' };
    },
    sendPrompt(id, value) {
      const text = validatePrompt(value);
      return serial(id, async () => {
        await requireSession(id, 'send');
        const buffer = `agent-grid-${randomUUID()}`;
        try {
          await invoke(['load-buffer', '-b', buffer, '-'], text);
          await invoke(['paste-buffer', '-b', buffer, '-d', '-p', '-t', id]);
          await invoke(['send-keys', '-t', id, 'Enter']);
          return { ok: true };
        } finally {
          try { await invoke(['delete-buffer', '-b', buffer]); } catch { /* paste-buffer -d normally removed it. */ }
        }
      });
    },
    performAction(id, action) {
      if (action !== 'interrupt') throw new AdapterError('Only an explicit current-turn interrupt is supported.');
      return serial(id, async () => {
        await requireSession(id, 'interrupt');
        await invoke(['send-keys', '-t', id, 'C-c']);
        return { ok: true };
      });
    },
  };
}
