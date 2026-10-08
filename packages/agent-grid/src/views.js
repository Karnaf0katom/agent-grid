// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.

const strings = value => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item.length))] : [];
const weights = value => Array.isArray(value) && value.length && value.every(item => Number.isFinite(item) && item > 0);

// Each view receives its own copies: resizing or filtering one grid cannot alter another.
export function normalizeGridState(value = {}) {
  const orders = Object.create(null);
  const layouts = Object.create(null);
  if (value?.orders && typeof value.orders === 'object') {
    for (const [group, ids] of Object.entries(value.orders)) if (Array.isArray(ids)) orders[group] = strings(ids);
  }
  if (value?.layouts && typeof value.layouts === 'object') {
    for (const [key, tracks] of Object.entries(value.layouts)) {
      if (weights(tracks?.cols) && weights(tracks?.rows)) layouts[key] = { cols: [...tracks.cols], rows: [...tracks.rows] };
    }
  }
  return {
    group: typeof value?.group === 'string' ? value.group : '*',
    showAll: value?.showAll === true,
    hidden: strings(value?.hidden),
    orders,
    layouts,
    columns: Number.isInteger(value?.columns) && value.columns >= 1 && value.columns <= 4 ? value.columns : 0,
  };
}

export function restoreGridViews(value = {}) {
  const grids = [];
  const seen = new Set(['all']);
  for (const candidate of Array.isArray(value?.grids) ? value.grids : []) {
    if (!candidate || typeof candidate.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(candidate.id) || seen.has(candidate.id)) continue;
    if (typeof candidate.name !== 'string' || !candidate.name.trim() || !Array.isArray(candidate.sessionIds)) continue;
    seen.add(candidate.id);
    grids.push({ ...normalizeGridState(candidate), id: candidate.id, name: candidate.name.trim().slice(0, 80), sessionIds: strings(candidate.sessionIds) });
  }
  return {
    // v0.1 stored the default grid at the top level. Keep that storage format readable.
    defaultGrid: normalizeGridState(value),
    grids,
    activeGrid: seen.has(value?.activeGrid) ? value.activeGrid : 'all',
    sidebarOpen: value?.sidebarOpen !== false,
  };
}
