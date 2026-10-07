// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
import { normalizeSessions } from './adapters.js';
import { ACTIVE_STATUSES, mergeTileOrder, insertTileOrder, resizeGridTracks, tileColumns, layoutKey, validTracks, createLayoutStore } from './layout.js';
import { styles } from './styles.js';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, label, handler, className = '') {
  const element = node('button', className, text);
  element.type = 'button';
  element.setAttribute('aria-label', label);
  element.title = label;
  element.addEventListener('click', handler);
  return element;
}
function dictionary(value, accept) {
  const result = Object.create(null);
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (accept(entry)) result[key] = entry;
  }
  return result;
}

// Importing the element entry in Node is harmless. Registering/mounting needs a browser.
const ElementBase = globalThis.HTMLElement || class {};
export class AgentGridElement extends ElementBase {
  static observedAttributes = ['readonly'];

  constructor() {
    super();
    this._adapter = null;
    this._sessions = [];
    this._tiles = new Map();
    this._group = '*';
    this._showAll = false;
    this._hidden = new Set();
    this._focused = null;
    this._orders = Object.create(null);
    this._layouts = Object.create(null);
    this._epoch = 0;
    this._busy = false;
    this._ready = false;
    this._loadState = 'loading';
    this._timer = null;
    this._unsubscribe = null;
    this._controller = null;
    this._store = null;
    this.attachShadow({ mode: 'open' });
    const style = node('style');
    style.textContent = styles;
    this._shell = node('div', 'shell');
    this._toolbar = node('div', 'toolbar');
    this._filters = node('div', 'filters');
    const label = node('label', 'label', 'Workspace ');
    this._groupSelect = node('select');
    this._groupSelect.setAttribute('aria-label', 'Filter workspace');
    this._groupSelect.addEventListener('change', () => {
      this._group = this._groupSelect.value;
      this._focused = null;
      this._persist();
      this._render();
      void this.refresh();
    });
    label.append(this._groupSelect);
    this._allButton = button('Live', 'Include idle and stopped sessions', () => {
      this._showAll = !this._showAll;
      this._persist();
      this._render();
      void this.refresh();
    });
    this._filters.append(label, this._allButton);
    this._restoreFocus = button('← All panes', 'Exit focused session', () => this._focus(null));
    this._restoreHidden = button('Show hidden', 'Restore hidden sessions', () => {
      this._hidden.clear(); this._persist(); this._render(); void this.refresh();
    });
    this._reset = button('Reset layout', 'Reset pane order and sizes for this workspace', () => {
      delete this._orders[this._group];
      for (const key of Object.keys(this._layouts)) if (key.startsWith(`${encodeURIComponent(this._group)}:`)) delete this._layouts[key];
      this._persist(); this._render();
    });
    this._meta = node('span', 'meta');
    this._toolbar.append(this._filters, node('span', 'spacer'), this._restoreFocus, this._restoreHidden, this._reset, this._meta);
    this._banner = node('div', 'banner');
    this._banner.setAttribute('role', 'alert');
    this._errorText = node('span', 'message');
    this._banner.append(this._errorText, button('Retry', 'Retry connecting to the host', () => { void this.refresh(); }));
    this._banner.hidden = true;
    this._empty = node('div', 'state');
    this._stage = node('div', 'stage');
    this._stage.setAttribute('aria-label', 'Agent sessions');
    this._announcer = node('div', 'sr-only');
    this._announcer.setAttribute('role', 'status');
    this._announcer.setAttribute('aria-live', 'polite');
    this._shell.append(this._toolbar, this._banner, this._empty, this._stage, this._announcer);
    this.shadowRoot.append(style, this._shell);
    this.shadowRoot.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this._focused) { event.preventDefault(); this._focus(null); }
    });
  }

  get adapter() { return this._adapter; }
  set adapter(value) {
    if (value !== null && typeof value?.listSessions !== 'function') throw new TypeError('An adapter needs listSessions().');
    this._stop();
    this._adapter = value;
    this._sessions = [];
    this._loadState = 'loading';
    this._banner.hidden = true;
    if (this.isConnected) { this._start(); this._render(); }
  }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(value) { this.toggleAttribute('readonly', !!value); }
  attributeChangedCallback() { if (this._ready) this._render(); }

  connectedCallback() {
    this._ready = true;
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Embedded browsers can forbid storage. */ }
    this._store = createLayoutStore(storage, this.getAttribute('storage-key') || 'agent-grid');
    const saved = this._store.read();
    this._group = typeof saved.group === 'string' ? saved.group : '*';
    this._showAll = saved.showAll === true;
    this._hidden = new Set(Array.isArray(saved.hidden) ? saved.hidden.filter(id => typeof id === 'string') : []);
    this._orders = dictionary(saved.orders, value => Array.isArray(value) && value.every(id => typeof id === 'string'));
    this._layouts = dictionary(saved.layouts, value => value && typeof value === 'object');
    this._observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const width = this.getBoundingClientRect().width;
      if (Math.abs(width - (this._width || 0)) > 2) { this._width = width; this._render(); }
    }) : null;
    this._observer?.observe(this);
    this._start();
    this._render();
  }
  disconnectedCallback() { this._observer?.disconnect(); this._stop(); this._ready = false; }

  _start() {
    if (!this._adapter) return;
    this._controller = new AbortController();
    this._epoch++;
    this._busy = false;
    if (typeof this._adapter.subscribe === 'function') this._unsubscribe = this._adapter.subscribe(() => { void this.refresh(); });
    const interval = Math.max(300, Math.min(60000, Number(this.getAttribute('poll-interval')) || 2000));
    this._timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, interval);
    void this.refresh();
  }
  _stop() {
    this._epoch++;
    this._controller?.abort();
    clearInterval(this._timer);
    this._timer = null;
    this._unsubscribe?.(); this._unsubscribe = null;
    this._cancelResize?.();
    for (const tile of this._tiles.values()) this._disposeTile(tile);
    this._tiles.clear();
    this._stage?.replaceChildren();
    this._busy = false;
  }
  _persist() {
    this._store?.write({ group: this._group, showAll: this._showAll, hidden: [...this._hidden], orders: this._orders, layouts: this._layouts });
  }
  _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }
  _fail(error) {
    if (error?.name === 'AbortError') return;
    this._errorText.textContent = error?.message || 'The host could not be reached.';
    this._banner.hidden = false;
    this._emit('agent-grid-error', { message: this._errorText.textContent });
  }

  async refresh() {
    if (!this.isConnected || !this._adapter || !this._controller) return;
    if (this._busy) { this._refreshAgain = true; return; }
    this._busy = true;
    const epoch = this._epoch;
    const adapter = this._adapter;
    const signal = this._controller.signal;
    try {
      const sessions = normalizeSessions(await adapter.listSessions({ signal }));
      if (epoch !== this._epoch || signal.aborted) return;
      this._sessions = sessions;
      this._loadState = 'connected';
      this._banner.hidden = true;
      this._render();
      if (typeof adapter.readOutput === 'function' && typeof adapter.mountSession !== 'function') {
        const shown = this._shown;
        // Four concurrent output reads maximum, without overlapping poll cycles.
        for (let start = 0; start < shown.length; start += 4) {
          await Promise.all(shown.slice(start, start + 4).map(async session => {
            const tile = this._tiles.get(session.id);
            if (!tile) return;
            try {
              const result = await adapter.readOutput(session.id, { signal });
              if (epoch !== this._epoch || signal.aborted || this._tiles.get(session.id) !== tile) return;
              const text = typeof result === 'string' ? result : result?.text;
              if (typeof text !== 'string') throw new Error('The host returned invalid session output.');
              const atEnd = tile.output.scrollHeight - tile.output.scrollTop - tile.output.clientHeight < 32;
              if (tile.pre.textContent !== text) tile.pre.textContent = text || 'Waiting for session output…';
              if (atEnd) tile.output.scrollTop = tile.output.scrollHeight;
              tile.error.hidden = true;
            } catch (error) {
              if (epoch !== this._epoch || signal.aborted) return;
              tile.error.textContent = error.message || 'Session output is unavailable.';
              tile.error.hidden = false;
            }
          }));
        }
      }
    } catch (error) {
      if (epoch === this._epoch && !signal.aborted) { this._loadState = 'error'; this._fail(error); this._render(); }
    } finally {
      if (epoch === this._epoch) {
        this._busy = false;
        if (this._refreshAgain) { this._refreshAgain = false; queueMicrotask(() => { void this.refresh(); }); }
      }
    }
  }

  _focus(id) { this._focused = id; this._render(); void this.refresh(); }
  _visibleSessions() {
    return mergeTileOrder(this._sessions.filter(session =>
      (this._showAll || ACTIVE_STATUSES.has(session.status)) &&
      (this._group === '*' || session.group === this._group) && !this._hidden.has(session.id)), this._orders[this._group] || []);
  }
  _render() {
    if (!this._ready) return;
    const groups = [...new Set(this._sessions.map(session => session.group).filter(Boolean))].sort();
    if (this._loadState === 'connected' && this._group !== '*' && !groups.includes(this._group)) this._group = '*';
    const options = [node('option', '', `All workspaces (${this._sessions.length})`), ...groups.map(group => node('option', '', group))];
    options[0].value = '*';
    groups.forEach((group, index) => { options[index + 1].value = group; });
    this._groupSelect.replaceChildren(...options);
    this._groupSelect.value = this._group;
    this._allButton.textContent = this._showAll ? 'All sessions' : 'Live';
    this._allButton.setAttribute('aria-pressed', String(this._showAll));
    const visible = this._visibleSessions();
    if (this._focused && !visible.some(session => session.id === this._focused)) this._focused = null;
    this._shown = this._focused ? visible.filter(session => session.id === this._focused) : visible;
    this._restoreFocus.hidden = !this._focused;
    this._restoreHidden.hidden = this._hidden.size === 0;
    this._restoreHidden.textContent = `Show hidden (${this._hidden.size})`;
    this._reset.hidden = visible.length < 2;
    const attention = this._sessions.filter(session => session.needsYou || session.status === 'waiting' || session.status === 'error').length;
    this._meta.textContent = `${visible.length} visible · ${attention} need you${this.readOnly ? ' · read-only' : ''}`;
    const validIds = new Set(this._sessions.map(session => session.id));
    for (const [id, tile] of this._tiles) {
      if (!validIds.has(id)) { this._disposeTile(tile); this._tiles.delete(id); }
    }
    const shownIds = new Set(this._shown.map(session => session.id));
    for (const [id, tile] of this._tiles) tile.root.hidden = !shownIds.has(id);
    this._columns = this._focused ? 1 : tileColumns(this._shown.length, this._width || this.getBoundingClientRect().width);
    this._rows = Math.max(1, Math.ceil(this._shown.length / this._columns));
    this._layoutKey = layoutKey(this._group, this._shown.map(session => session.id), this._columns);
    const saved = this._layouts[this._layoutKey];
    this._colTracks = !this._focused && validTracks(saved?.cols, this._columns) ? saved.cols : Array(this._columns).fill(1);
    this._rowTracks = !this._focused && validTracks(saved?.rows, this._rows) ? saved.rows : Array(this._rows).fill(1);
    this._applyTracks();
    this._shown.forEach((session, index) => {
      let tile = this._tiles.get(session.id);
      if (!tile) { tile = this._createTile(session); this._tiles.set(session.id, tile); this._stage.append(tile.root); }
      this._updateTile(tile, session, index);
      tile.root.hidden = false;
      tile.root.style.gridColumn = String((index % this._columns) * 2 + 1);
      tile.root.style.gridRow = String(Math.floor(index / this._columns) * 2 + 1);
      // Move existing nodes, preserving composers and host-mounted renderers.
      const previous = this._shown[index - 1] && this._tiles.get(this._shown[index - 1].id)?.root;
      if (previous) { if (previous.nextElementSibling !== tile.root) previous.after(tile.root); }
      else if (this._stage.firstElementChild !== tile.root) this._stage.prepend(tile.root);
    });
    for (const divider of this._stage.querySelectorAll('.separator')) divider.remove();
    if (!this._focused && this._shown.length) {
      for (let index = 0; index < this._columns - 1; index++) this._stage.append(this._separator('column', index));
      for (let index = 0; index < this._rows - 1; index++) this._stage.append(this._separator('row', index));
    }
    this._stage.hidden = this._shown.length === 0;
    this._empty.hidden = this._shown.length > 0;
    if (!this._shown.length) {
      this._empty.replaceChildren();
      const loading = this._loadState === 'loading';
      const title = loading ? (this._adapter ? 'Connecting to your agents…' : 'Connect a host adapter') : this._loadState === 'error' ? 'Connection unavailable' : this._sessions.length ? 'No sessions in this view' : 'Your grid is ready';
      this._empty.append(node('strong', '', title), node('span', '', loading ? 'The host supplies sessions and permissions.' : 'Start agents in your host app, then return here.'));
      if (this._sessions.length) this._empty.append(button('Show everything', 'Show all sessions and restore hidden panes', () => {
        this._group = '*'; this._showAll = true; this._hidden.clear(); this._persist(); this._render(); void this.refresh();
      }));
    }
  }

  _createTile(session) {
    const root = node('section', 'tile');
    root.dataset.sessionId = session.id;
    const header = node('header', 'tile-header');
    const grip = button('⠿', `Reorder ${session.title}`, () => {}, 'grip');
    grip.draggable = true;
    grip.addEventListener('dragstart', event => {
      this._dragId = session.id;
      event.dataTransfer.setData('text/plain', session.id);
      event.dataTransfer.effectAllowed = 'move';
    });
    grip.addEventListener('dragend', () => { this._dragId = null; for (const tile of this._tiles.values()) tile.root.classList.remove('drag-target'); });
    grip.addEventListener('keydown', event => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this._columns, ArrowDown: this._columns }[event.key];
      if (!step || this._focused) return;
      event.preventDefault();
      const ids = this._visibleSessions().map(item => item.id);
      const index = ids.indexOf(session.id);
      const target = Math.max(0, Math.min(ids.length - 1, index + step));
      this._reorder(session.id, ids[target], target > index ? 'after' : 'before');
      grip.focus();
    });
    root.addEventListener('dragover', event => {
      if (!this._dragId || this._dragId === session.id || this._focused) return;
      event.preventDefault(); root.classList.add('drag-target');
    });
    root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) root.classList.remove('drag-target'); });
    root.addEventListener('drop', event => {
      event.preventDefault(); root.classList.remove('drag-target');
      if (!this._dragId || this._focused) return;
      const rect = root.getBoundingClientRect();
      const ids = this._shown.map(item => item.id);
      const sameRow = Math.floor(ids.indexOf(this._dragId) / this._columns) === Math.floor(ids.indexOf(session.id) / this._columns);
      const after = sameRow ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
      this._reorder(this._dragId, session.id, after ? 'after' : 'before');
      this._dragId = null;
    });
    const titleBlock = node('div', 'title-block');
    const title = node('div', 'title');
    const identity = node('div', 'identity');
    titleBlock.append(title, identity);
    const status = node('span', 'status');
    const statusText = node('span');
    status.append(node('span', 'dot'), statusText);
    const tools = node('div', 'tools');
    const focus = button('↗', `Focus ${session.title}`, () => this._focus(this._focused === session.id ? null : session.id));
    tools.append(focus, button('×', `Hide ${session.title}`, () => {
      this._hidden.add(session.id); if (this._focused === session.id) this._focused = null;
      this._persist(); this._render();
    }));
    header.append(grip, titleBlock, status, tools);
    const question = node('div', 'question');
    const output = node('div', 'output');
    const pre = node('pre', 'snapshot', 'Waiting for session output…');
    const error = node('div', 'tile-error');
    error.setAttribute('role', 'status'); error.hidden = true;
    const composer = node('form', 'composer');
    const input = node('textarea');
    input.rows = 1;
    input.placeholder = 'Give this agent a prompt…';
    input.setAttribute('aria-label', `Prompt for ${session.title}`);
    const send = node('button', 'send', 'Send ↵');
    send.type = 'submit';
    const footer = node('div', 'tile-footer');
    const mode = node('span', '', typeof this._adapter.mountSession === 'function' ? 'Host renderer' : 'Output snapshot');
    const permission = node('span');
    const interrupt = button('Interrupt', `Interrupt current turn in ${session.title}`, () => { void this._mutate(session.id, 'interrupt', tile); }, 'interrupt');
    const open = button('Open in host ↗', `Open ${session.title} in host`, () => this._adapter.openSession?.(session.id));
    footer.append(mode, permission, open, interrupt);
    composer.append(input, send);
    root.append(header, question, output, error, composer, footer);
    const tile = { root, title, identity, statusText, grip, focus, question, output, pre, error, composer, input, send, permission, interrupt, open, pending: false, controller: new AbortController() };
    if (typeof this._adapter.mountSession === 'function') {
      try {
        const cleanup = this._adapter.mountSession(output, session, { signal: tile.controller.signal });
        if (typeof cleanup === 'function') tile.cleanup = cleanup;
      } catch (error) { tile.error.textContent = error.message; tile.error.hidden = false; }
    } else output.append(pre);
    composer.addEventListener('submit', event => { event.preventDefault(); void this._mutate(session.id, 'send', tile); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); composer.requestSubmit(); }
    });
    return tile;
  }

  _updateTile(tile, session, index) {
    tile.root.className = `tile status-${session.status}${session.needsYou ? ' attention' : ''}${this._focused === session.id ? ' focused' : ''}`;
    tile.root.setAttribute('aria-label', session.title);
    tile.title.textContent = session.title; tile.title.title = session.title;
    tile.identity.textContent = [session.tool, session.group, session.detail].filter(Boolean).join(' / ');
    tile.statusText.textContent = session.needsYou ? 'needs you' : session.status;
    tile.grip.setAttribute('aria-label', `Reorder ${session.title}. Position ${index + 1} of ${this._shown.length}. Use arrow keys.`);
    tile.grip.disabled = !!this._focused || this._shown.length < 2;
    tile.focus.setAttribute('aria-pressed', String(this._focused === session.id));
    tile.focus.setAttribute('aria-label', this._focused === session.id ? `Restore grid from ${session.title}` : `Focus ${session.title}`);
    tile.question.hidden = !session.needsYou;
    tile.question.textContent = session.question || 'This agent needs your attention.';
    const canSend = !this.readOnly && session.capabilities.send && typeof this._adapter.sendPrompt === 'function';
    tile.composer.hidden = !canSend;
    tile.input.disabled = !canSend || tile.pending;
    tile.send.disabled = !canSend || tile.pending;
    tile.send.textContent = tile.pending ? 'Sending…' : 'Send ↵';
    tile.permission.textContent = canSend ? '· input enabled' : '· read-only';
    tile.interrupt.hidden = this.readOnly || !session.capabilities.interrupt || typeof this._adapter.performAction !== 'function';
    tile.interrupt.disabled = tile.pending;
    tile.open.hidden = !session.capabilities.open || typeof this._adapter.openSession !== 'function';
  }
  _disposeTile(tile) {
    tile.controller.abort();
    try { tile.cleanup?.(); } catch { /* Host renderer cleanup cannot prevent disconnection. */ }
    tile.root.remove();
  }
  async _mutate(id, action, tile) {
    const session = this._sessions.find(item => item.id === id);
    if (this.readOnly || !session || tile.pending || !session.capabilities[action]) return;
    const text = tile.input.value;
    if (action === 'send' && !text.trim()) { tile.input.focus(); return; }
    if (action === 'interrupt' && !globalThis.confirm(`Interrupt the current turn in “${session.title}”? The session will remain open.`)) return;
    const epoch = this._epoch;
    const adapter = this._adapter;
    tile.pending = true;
    this._updateTile(tile, session, this._shown.findIndex(item => item.id === id));
    try {
      if (action === 'send') await adapter.sendPrompt(id, text, { signal: tile.controller.signal });
      else await adapter.performAction(id, action, { signal: tile.controller.signal });
      if (epoch !== this._epoch || tile.controller.signal.aborted) return;
      if (action === 'send' && tile.input.value === text) tile.input.value = '';
      tile.error.hidden = true;
      this._announcer.textContent = action === 'send' ? `Prompt delivered to ${session.title}` : `Interrupted ${session.title}`;
      this._emit('agent-grid-action', { sessionId: id, action });
      void this.refresh();
    } catch (error) {
      if (epoch !== this._epoch || tile.controller.signal.aborted) return;
      tile.error.textContent = error.message || 'The host rejected this action.'; tile.error.hidden = false;
      this._emit('agent-grid-error', { message: tile.error.textContent });
    } finally {
      tile.pending = false;
      if (epoch === this._epoch) this._render();
    }
  }

  _reorder(source, target, position) {
    const ids = this._visibleSessions().map(session => session.id);
    this._orders[this._group] = insertTileOrder(ids, source, target, position);
    this._persist(); this._render();
    this._announcer.textContent = `Pane moved to position ${this._orders[this._group].indexOf(source) + 1}.`;
  }
  _applyTracks() {
    const template = tracks => tracks.map((weight, index) => `${index ? '10px ' : ''}minmax(0,${weight}fr)`).join(' ');
    this._stage.style.gridTemplateColumns = template(this._colTracks);
    this._stage.style.gridTemplateRows = this._focused ? 'minmax(65vh,1fr)' : this._rowTracks.map((weight, index) => `${index ? '10px ' : ''}minmax(300px,${weight}fr)`).join(' ');
    this._stage.style.height = this._focused ? '' : `${this._rows * 360 + (this._rows - 1) * 10}px`;
  }
  _separator(axis, index) {
    const handle = node('div', `separator ${axis}`);
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', axis === 'column' ? 'vertical' : 'horizontal');
    handle.setAttribute('aria-label', `Resize ${axis}s ${index + 1} and ${index + 2}`);
    handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
    const updateAria = () => {
      const tracks = axis === 'column' ? this._colTracks : this._rowTracks;
      handle.setAttribute('aria-valuenow', String(Math.round(100 * tracks[index] / (tracks[index] + tracks[index + 1]))));
    };
    updateAria();
    if (axis === 'column') { handle.style.gridColumn = String(index * 2 + 2); handle.style.gridRow = `1 / ${this._rows * 2}`; }
    else { handle.style.gridRow = String(index * 2 + 2); handle.style.gridColumn = `1 / ${this._columns * 2}`; }
    const snapshot = () => {
      const tracks = [...(axis === 'column' ? this._colTracks : this._rowTracks)];
      const available = axis === 'column' ? this._stage.clientWidth - (this._columns - 1) * 10 : this._stage.clientHeight - (this._rows - 1) * 10;
      const total = tracks.reduce((a, b) => a + b, 0);
      return { tracks, before: available * tracks[index] / total, after: available * tracks[index + 1] / total };
    };
    const apply = (saved, delta) => {
      const next = resizeGridTracks(saved.tracks, index, delta, saved.before, saved.after, axis === 'column' ? 220 : 300);
      if (axis === 'column') this._colTracks = next; else this._rowTracks = next;
      this._layouts[this._layoutKey] = { cols: this._colTracks, rows: this._rowTracks };
      this._persist(); this._applyTracks(); updateAria();
    };
    handle.addEventListener('keydown', event => {
      const step = axis === 'column' ? { ArrowLeft: -24, ArrowRight: 24 } : { ArrowUp: -24, ArrowDown: 24 };
      if (!step[event.key]) return;
      event.preventDefault(); apply(snapshot(), step[event.key]);
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); this._cancelResize?.();
      handle.focus();
      const saved = snapshot();
      const start = axis === 'column' ? event.clientX : event.clientY;
      const move = next => apply(saved, (axis === 'column' ? next.clientX : next.clientY) - start);
      const stop = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); document.removeEventListener('pointercancel', stop);
        this._cancelResize = null;
      };
      this._cancelResize = stop;
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', stop, { once: true }); document.addEventListener('pointercancel', stop, { once: true });
    });
    return handle;
  }
}

export function defineAgentGrid(tagName = 'agent-grid') {
  if (!globalThis.customElements) throw new Error('Agent Grid needs a browser with Custom Elements support.');
  if (!customElements.get(tagName)) customElements.define(tagName, tagName === 'agent-grid' ? AgentGridElement : class extends AgentGridElement {});
}
export function mountAgentGrid(container, { adapter, readOnly = false, storageKey, pollInterval } = {}) {
  defineAgentGrid();
  const element = document.createElement('agent-grid');
  if (storageKey) element.setAttribute('storage-key', storageKey);
  if (pollInterval) element.setAttribute('poll-interval', String(pollInterval));
  element.readOnly = readOnly;
  if (adapter) element.adapter = adapter;
  container.append(element);
  return { element, destroy() { element.remove(); } };
}
