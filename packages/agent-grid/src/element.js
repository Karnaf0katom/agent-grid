// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
import { normalizeSessions } from './adapters.js';
import { ACTIVE_STATUSES, mergeTileOrder, insertTileOrder, resizeGridTracks, tileColumns, layoutKey, validTracks, createLayoutStore } from './layout.js';
import { normalizeGridState, restoreGridViews } from './views.js';
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
    this._defaultGridState = normalizeGridState();
    this._grids = new Map();
    this._activeGridId = 'all';
    this._selection = null;
    this._columnPreference = 0;
    this._sidebarOpen = true;
    this._search = '';
    this._sessionRows = new Map();
    this._gridButtons = new Map();
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
    this._sidebarToggle = button('Sessions', 'Toggle session sidebar', () => {
      this._sidebarOpen = !this._sidebarOpen; this._persist(); this._render();
    });
    this._sidebarToggle.setAttribute('aria-controls', 'session-sidebar');
    const gridLabel = node('label', 'label', 'Grid ');
    this._gridSelect = node('select');
    this._gridSelect.setAttribute('aria-label', 'Choose saved grid');
    this._gridSelect.addEventListener('change', () => this.selectGrid(this._gridSelect.value));
    gridLabel.append(this._gridSelect);
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
    const layoutLabel = node('label', 'label', 'Layout ');
    this._layoutSelect = node('select');
    this._layoutSelect.setAttribute('aria-label', 'Grid columns');
    for (let count = 0; count <= 4; count++) {
      const option = node('option', '', count ? `${count} column${count === 1 ? '' : 's'}` : 'Auto');
      option.value = String(count); this._layoutSelect.append(option);
    }
    this._layoutSelect.addEventListener('change', () => {
      this._columnPreference = Number(this._layoutSelect.value); this._persist(); this._render();
    });
    layoutLabel.append(this._layoutSelect);
    this._filters.append(this._sidebarToggle, gridLabel, label, this._allButton, layoutLabel);
    this._saveGridButton = button('Save grid', 'Save current sessions as a named grid', () => this._openSaveGrid());
    this._deleteGridButton = button('Delete grid', 'Delete this saved grid', () => {
      const grid = this._grids.get(this._activeGridId);
      if (grid && globalThis.confirm(`Delete the saved grid “${grid.name}”? Your sessions will remain open.`)) this.deleteGrid(grid.id);
    });
    this._fullscreenButton = button('Fullscreen', 'Enter fullscreen grid', () => { void this._toggleFullscreen(); });
    this._fullscreenButton.hidden = typeof this.requestFullscreen !== 'function';
    this._onFullscreenChange = () => {
      const active = document.fullscreenElement === this;
      this._fullscreenButton.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
      this._fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen grid' : 'Enter fullscreen grid');
      this._fullscreenButton.setAttribute('aria-pressed', String(active));
    };
    this._restoreFocus = button('← All panes', 'Exit focused session', () => this._focus(null));
    this._restoreHidden = button('Show hidden', 'Restore hidden sessions', () => {
      this._hidden.clear(); this._persist(); this._render(); void this.refresh();
    });
    this._reset = button('Reset layout', 'Reset pane order and sizes for this workspace', () => {
      delete this._orders[this._group];
      for (const key of Object.keys(this._layouts)) if (key.startsWith(`${encodeURIComponent(this._group)}:`)) delete this._layouts[key];
      this._columnPreference = 0;
      this._persist(); this._render();
    });
    this._meta = node('span', 'meta');
    this._toolbar.append(this._filters, node('span', 'spacer'), this._saveGridButton, this._deleteGridButton, this._restoreFocus, this._restoreHidden, this._reset, this._fullscreenButton, this._meta);
    this._workbench = node('div', 'workbench');
    this._sidebar = node('aside', 'sidebar');
    this._sidebar.id = 'session-sidebar';
    this._sidebar.setAttribute('aria-label', 'Sessions and saved grids');
    const gridsHeading = node('div', 'sidebar-heading');
    gridsHeading.append(node('span', 'label', 'Grids'), button('+', 'Save current selection as a grid', () => this._openSaveGrid()));
    this._gridList = node('nav', 'grid-list');
    this._gridList.setAttribute('aria-label', 'Saved grids');
    this._saveForm = node('form', 'save-grid-form');
    this._saveForm.hidden = true;
    this._nameInput = node('input');
    this._nameInput.type = 'text'; this._nameInput.required = true; this._nameInput.maxLength = 80;
    this._nameInput.placeholder = 'Name this grid…';
    this._nameInput.setAttribute('aria-label', 'New grid name');
    const save = node('button', '', 'Save'); save.type = 'submit';
    this._saveError = node('span', 'tile-error'); this._saveError.hidden = true; this._saveError.setAttribute('role', 'alert');
    this._saveForm.append(this._nameInput, save, button('Cancel', 'Cancel saving grid', () => {
      this._saveForm.hidden = true; this._saveGridButton.focus();
    }), this._saveError);
    this._saveForm.addEventListener('submit', event => {
      event.preventDefault();
      try {
        this.saveGrid(this._nameInput.value);
        this._nameInput.value = ''; this._saveForm.hidden = true; this._saveError.hidden = true;
        this._gridSelect.focus();
      } catch (error) { this._saveError.textContent = error.message; this._saveError.hidden = false; }
    });
    this._sessionSearch = node('input', 'session-search');
    this._sessionSearch.type = 'search'; this._sessionSearch.placeholder = 'Search all sessions…';
    this._sessionSearch.setAttribute('aria-label', 'Search sessions');
    this._sessionSearch.addEventListener('input', () => { this._search = this._sessionSearch.value; this._renderSidebar(); });
    const selectionTools = node('div', 'selection-tools');
    this._selectionCount = node('span', 'selection-count');
    selectionTools.append(this._selectionCount, button('All', 'Include all sessions in this grid', () => this._selectAllSessions(true)), button('None', 'Remove all sessions from this grid', () => this._selectAllSessions(false)));
    this._sessionList = node('div', 'session-list');
    this._sidebarEmpty = node('p', 'sidebar-empty');
    this._sidebar.append(gridsHeading, this._gridList, this._saveForm, node('div', 'sidebar-heading label', 'All host sessions'), this._sessionSearch, selectionTools, this._sessionList, this._sidebarEmpty);
    this._canvas = node('div', 'canvas');
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
    this._canvas.append(this._banner, this._empty, this._stage);
    this._workbench.append(this._sidebar, this._canvas);
    this._shell.append(this._toolbar, this._workbench, this._announcer);
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
  get activeGrid() { return this._activeGridId; }
  get savedGrids() { return [...this._grids.values()].map(grid => ({ id: grid.id, name: grid.name, sessionIds: [...grid.sessionIds] })); }
  attributeChangedCallback() { if (this._ready) this._render(); }

  connectedCallback() {
    this._ready = true;
    let storage;
    try { storage = globalThis.localStorage; } catch { /* Embedded browsers can forbid storage. */ }
    this._store = createLayoutStore(storage, this.getAttribute('storage-key') || 'agent-grid');
    const saved = restoreGridViews(this._store.read());
    this._defaultGridState = saved.defaultGrid;
    this._grids = new Map(saved.grids.map(grid => [grid.id, grid]));
    this._sidebarOpen = saved.sidebarOpen;
    this._applyGrid(saved.activeGrid);
    this._observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const width = this._canvas.getBoundingClientRect().width;
      if (Math.abs(width - (this._width || 0)) > 2) { this._width = width; this._render(); }
    }) : null;
    this._observer?.observe(this);
    this._observer?.observe(this._canvas);
    document.addEventListener('fullscreenchange', this._onFullscreenChange);
    this._onFullscreenChange();
    this._start();
    this._render();
  }
  disconnectedCallback() {
    this._observer?.disconnect(); document.removeEventListener('fullscreenchange', this._onFullscreenChange);
    this._stop(); this._ready = false;
  }

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
    const state = this._captureGridState();
    const active = this._grids.get(this._activeGridId);
    if (active) this._grids.set(active.id, { ...state, id: active.id, name: active.name, sessionIds: [...this._selection] });
    else this._defaultGridState = state;
    this._store?.write({ ...this._defaultGridState, grids: [...this._grids.values()], activeGrid: this._activeGridId, sidebarOpen: this._sidebarOpen });
  }
  _captureGridState() {
    return normalizeGridState({ group: this._group, showAll: this._showAll, hidden: [...this._hidden], orders: this._orders, layouts: this._layouts, columns: this._columnPreference });
  }
  _applyGrid(id) {
    const grid = this._grids.get(id);
    const state = normalizeGridState(grid || this._defaultGridState);
    this._activeGridId = grid ? id : 'all';
    this._selection = grid ? new Set(grid.sessionIds) : null;
    this._group = state.group; this._showAll = state.showAll;
    this._hidden = new Set(state.hidden); this._orders = state.orders; this._layouts = state.layouts;
    this._columnPreference = state.columns; this._focused = null;
  }
  selectGrid(id) {
    if (id !== 'all' && !this._grids.has(id)) throw new RangeError('That saved grid does not exist.');
    this._persist(); this._applyGrid(id); this._persist(); this._render(); void this.refresh();
    this._emit('agent-grid-view-change', { gridId: this._activeGridId, sessionIds: this._selection ? [...this._selection] : null });
  }
  saveGrid(name, sessionIds = this._visibleSessions().map(session => session.id)) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new TypeError('Give the grid a name of 1–80 characters.');
    if (!Array.isArray(sessionIds) || sessionIds.some(id => typeof id !== 'string' || !id)) throw new TypeError('Session ids must be nonempty strings.');
    this._persist();
    let id;
    do { id = `grid-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`; } while (this._grids.has(id));
    const ids = [...new Set(sessionIds)];
    const state = this._captureGridState();
    state.orders['*'] = [...ids];
    // Membership replaces the workspace filter; carry the current tracks to that scope.
    const prefix = `${encodeURIComponent(this._group)}:`;
    for (const [key, tracks] of Object.entries(state.layouts)) if (key.startsWith(prefix)) state.layouts[`*:${key.slice(prefix.length)}`] = { cols: [...tracks.cols], rows: [...tracks.rows] };
    this._grids.set(id, { ...state, id, name: name.trim(), sessionIds: ids, group: '*', showAll: true, hidden: [] });
    this.selectGrid(id);
    this._announcer.textContent = `Saved grid ${name.trim()}.`;
    return id;
  }
  deleteGrid(id) {
    if (!this._grids.has(id)) throw new RangeError('That saved grid does not exist.');
    if (this._activeGridId === id) this.selectGrid('all');
    this._grids.delete(id); this._persist(); this._render();
  }
  _openSaveGrid() {
    this._sidebarOpen = true; this._saveForm.hidden = false; this._saveError.hidden = true;
    this._persist(); this._render(); this._nameInput.focus();
  }
  async _toggleFullscreen() {
    try {
      if (document.fullscreenElement === this) await document.exitFullscreen();
      else await this.requestFullscreen();
    } catch (error) { this._fail(new Error(error.message || 'Fullscreen is unavailable in this host.')); }
  }
  _setSessionIncluded(id, included) {
    const session = this._sessions.find(item => item.id === id);
    if (!session) return;
    if (included) {
      this._selection?.add(id); this._hidden.delete(id);
      if (!ACTIVE_STATUSES.has(session.status)) this._showAll = true;
      if (this._group !== '*' && session.group !== this._group) this._group = '*';
    } else {
      if (this._selection) { this._selection.delete(id); this._hidden.delete(id); }
      else this._hidden.add(id);
      if (this._focused === id) this._focused = null;
    }
    this._persist(); this._render(); void this.refresh();
  }
  _selectAllSessions(included) {
    this._group = '*'; this._showAll = true; this._focused = null;
    if (this._selection) this._selection = new Set(included ? this._sessions.map(session => session.id) : []);
    this._hidden = new Set(included || this._selection ? [] : this._sessions.map(session => session.id));
    this._persist(); this._render(); void this.refresh();
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
      (!this._selection || this._selection.has(session.id)) &&
      (this._showAll || ACTIVE_STATUSES.has(session.status)) &&
      (this._group === '*' || session.group === this._group) && !this._hidden.has(session.id)), this._orders[this._group] || []);
  }
  _renderGrids() {
    const grids = [{ id: 'all', name: 'All sessions', sessionIds: null }, ...this._grids.values()];
    const signature = JSON.stringify(grids.map(grid => [grid.id, grid.name]));
    if (signature !== this._gridOptionsSignature) {
      this._gridOptionsSignature = signature;
      this._gridSelect.replaceChildren(...grids.map(grid => {
        const option = node('option', '', grid.name); option.value = grid.id; return option;
      }));
    }
    this._gridSelect.value = this._activeGridId;
    const known = new Set(grids.map(grid => grid.id));
    for (const [id, entry] of this._gridButtons) if (!known.has(id)) { entry.root.remove(); this._gridButtons.delete(id); }
    let previous = null;
    for (const grid of grids) {
      let entry = this._gridButtons.get(grid.id);
      if (!entry) {
        const root = button('', '', () => this.selectGrid(grid.id), 'grid-link');
        root.dataset.gridId = grid.id;
        const name = node('span', 'grid-name'); const count = node('span', 'grid-count');
        root.append(name, count); entry = { root, name, count }; this._gridButtons.set(grid.id, entry);
      }
      entry.name.textContent = grid.name; entry.name.title = grid.name;
      entry.count.textContent = String(grid.sessionIds ? grid.sessionIds.length : this._sessions.length);
      entry.root.setAttribute('aria-label', grid.id === 'all' ? 'View all sessions' : `View saved grid ${grid.name}`);
      entry.root.setAttribute('aria-pressed', String(grid.id === this._activeGridId));
      if (previous) { if (previous.nextElementSibling !== entry.root) previous.after(entry.root); }
      else if (this._gridList.firstElementChild !== entry.root) this._gridList.prepend(entry.root);
      previous = entry.root;
    }
    this._deleteGridButton.hidden = this._activeGridId === 'all';
  }
  _renderSidebar(visibleIds = new Set(this._visibleSessions().map(session => session.id))) {
    this._selectionCount.textContent = `${visibleIds.size} in grid`;
    const query = this._search.trim().toLocaleLowerCase();
    const validIds = new Set(this._sessions.map(session => session.id));
    for (const [id, row] of this._sessionRows) if (!validIds.has(id)) { row.root.remove(); this._sessionRows.delete(id); }
    let previous = null, matches = 0;
    for (const session of [...this._sessions].sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.title.localeCompare(b.title))) {
      let row = this._sessionRows.get(session.id);
      if (!row) {
        const root = node('div', 'session-item'); root.dataset.catalogSessionId = session.id;
        const label = node('label', 'session-choice');
        const checkbox = node('input'); checkbox.type = 'checkbox';
        checkbox.addEventListener('change', () => this._setSessionIncluded(session.id, checkbox.checked));
        const text = node('span', 'session-info');
        const title = node('span', 'session-title'); const identity = node('span', 'session-identity');
        text.append(title, identity); label.append(checkbox, text);
        const focus = button('↗', '', () => { this._setSessionIncluded(session.id, true); this._focus(session.id); }, 'session-focus');
        root.append(label, focus); row = { root, checkbox, title, identity, focus }; this._sessionRows.set(session.id, row);
      }
      row.title.textContent = session.title; row.title.title = session.title;
      row.identity.textContent = [session.group, session.tool, session.needsYou ? 'needs you' : session.status].filter(Boolean).join(' · ');
      row.checkbox.checked = visibleIds.has(session.id);
      row.checkbox.setAttribute('aria-label', `Show ${session.title} in this grid`);
      row.focus.setAttribute('aria-label', `Focus session ${session.title}`); row.focus.title = `Focus ${session.title}`;
      row.root.classList.toggle('included', row.checkbox.checked);
      row.root.classList.toggle('attention', session.needsYou || ['waiting', 'error'].includes(session.status));
      row.root.classList.toggle('in-focus', session.id === this._focused);
      const searchText = [session.id, session.title, session.group, session.tool, session.status].filter(Boolean).join(' ').toLocaleLowerCase();
      row.root.hidden = !!query && !searchText.includes(query);
      if (!row.root.hidden) matches++;
      if (previous) { if (previous.nextElementSibling !== row.root) previous.after(row.root); }
      else if (this._sessionList.firstElementChild !== row.root) this._sessionList.prepend(row.root);
      previous = row.root;
    }
    this._sidebarEmpty.hidden = matches > 0;
    this._sidebarEmpty.textContent = query ? 'No matching sessions.' : this._loadState === 'loading' ? 'Loading sessions…' : this._loadState === 'error' ? 'Session list unavailable. Retry the connection.' : 'Your host has no sessions yet.';
  }
  _render() {
    if (!this._ready) return;
    const hostWidth = this.getBoundingClientRect().width;
    this._shell.classList.toggle('compact', hostWidth <= 820);
    this._shell.classList.toggle('small', hostWidth <= 600);
    this._sidebar.hidden = !this._sidebarOpen;
    this._workbench.classList.toggle('with-sidebar', this._sidebarOpen);
    this._sidebarToggle.setAttribute('aria-expanded', String(this._sidebarOpen));
    this._sidebarToggle.setAttribute('aria-pressed', String(this._sidebarOpen));
    this._renderGrids();
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
    this._renderSidebar(new Set(visible.map(session => session.id)));
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
    const width = this._canvas.getBoundingClientRect().width || this.getBoundingClientRect().width;
    this._columns = this._focused ? 1 : this._columnPreference ? Math.max(1, Math.min(this._columnPreference, this._shown.length, tileColumns(30, width))) : tileColumns(this._shown.length, width);
    this._layoutSelect.value = String(this._columnPreference);
    this._layoutSelect.disabled = !!this._focused;
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
      const named = this._activeGridId !== 'all';
      this._empty.append(node('strong', '', !loading && this._loadState !== 'error' && named ? 'No sessions in this grid' : title), node('span', '', loading ? 'The host supplies sessions and permissions.' : named ? 'Choose sessions in the sidebar, or switch to another grid.' : 'Start agents in your host app, then return here.'));
      if (named) this._empty.append(button('Choose sessions', 'Choose sessions for this grid', () => {
        this._sidebarOpen = true; this._persist(); this._render(); this._sessionSearch.focus();
      }));
      else if (this._sessions.length) this._empty.append(button('Show everything', 'Show all sessions and restore hidden panes', () => {
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
