// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.

const STATUSES = new Set(['running', 'waiting', 'starting', 'error', 'queued', 'idle', 'stopped']);
const string = value => typeof value === 'string' ? value : '';

export function normalizeSessions(value) {
  const rows = Array.isArray(value) ? value : value?.sessions;
  if (!Array.isArray(rows)) throw new TypeError('The adapter must return an array of sessions.');
  const ids = new Set();
  return rows.map(row => {
    if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 256 || ids.has(row.id)) {
      throw new TypeError('Each session needs a unique, nonempty string id (at most 256 characters).');
    }
    ids.add(row.id);
    const capabilities = {};
    for (const action of ['send', 'interrupt', 'open']) capabilities[action] = row.capabilities?.[action] === true;
    return {
      id: row.id, title: string(row.title) || row.id, group: string(row.group), tool: string(row.tool) || 'agent',
      status: STATUSES.has(row.status) ? row.status : 'idle', needsYou: row.needsYou === true,
      question: string(row.question), detail: string(row.detail), capabilities,
    };
  });
}

export function createHttpAdapter({ baseUrl = '', fetch: request = globalThis.fetch, readOnly = false } = {}) {
  const base = baseUrl.replace(/\/$/, '');
  async function json(path, options = {}) {
    const response = await request(`${base}${path}`, { credentials: 'same-origin', ...options });
    let body;
    try { body = await response.json(); } catch { throw new Error(`Adapter returned invalid JSON (${response.status}).`); }
    if (!response.ok) throw new Error(body.error || `Adapter request failed (${response.status}).`);
    return body;
  }
  return {
    async listSessions({ signal } = {}) {
      const sessions = normalizeSessions(await json('/api/sessions', { signal }));
      if (readOnly) for (const session of sessions) session.capabilities = { send: false, interrupt: false, open: session.capabilities.open };
      return sessions;
    },
    readOutput(id, { signal } = {}) {
      return json(`/api/sessions/${encodeURIComponent(id)}/output`, { signal });
    },
    sendPrompt(id, text, { signal } = {}) {
      if (readOnly) throw new Error('This adapter is read-only.');
      return json(`/api/sessions/${encodeURIComponent(id)}/input`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Agent-Grid': '1' }, body: JSON.stringify({ text }),
      });
    },
    performAction(id, action, { signal } = {}) {
      if (readOnly) throw new Error('This adapter is read-only.');
      return json(`/api/sessions/${encodeURIComponent(id)}/actions`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Agent-Grid': '1' }, body: JSON.stringify({ action }),
      });
    },
  };
}

export function createMemoryAdapter(initialSessions, initialOutput = {}) {
  let sessions = normalizeSessions(initialSessions);
  const output = new Map(Object.entries(initialOutput));
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const find = id => {
    const session = sessions.find(item => item.id === id);
    if (!session) throw new Error('Session no longer exists.');
    return session;
  };
  return {
    async listSessions() { return normalizeSessions(sessions); },
    async readOutput(id) { find(id); return { text: output.get(id) || '', mode: 'snapshot' }; },
    async sendPrompt(id, text) {
      const session = find(id);
      if (!session.capabilities.send) throw new Error('The host does not permit input for this session.');
      if (typeof text !== 'string' || !text.trim()) throw new Error('Enter a prompt.');
      output.set(id, `${output.get(id) || ''}\n\n› ${text}\n\n[Demo] Prompt delivered to this simulated session.`);
      session.needsYou = false;
      session.status = 'running';
      notify();
      return { ok: true };
    },
    async performAction(id, action) {
      const session = find(id);
      if (action !== 'interrupt' || !session.capabilities.interrupt) throw new Error('This action is unavailable.');
      session.status = 'idle';
      output.set(id, `${output.get(id) || ''}\n\n[Demo] Current turn interrupted.`);
      notify();
      return { ok: true };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    update(nextSessions) { sessions = normalizeSessions(nextSessions); notify(); },
    setOutput(id, text) { find(id); output.set(id, text); notify(); },
  };
}
