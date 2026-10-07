// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
// Ordering and track resizing adapted from Agent Deck's Fleet Grid (MIT).
// Original project: Copyright (c) 2025 Ashesh Goplani. See THIRD_PARTY_NOTICES.md.

const STATUS_RANK = { error: 5, waiting: 4, running: 3, starting: 3, queued: 2, idle: 2, stopped: 1 };
export const ACTIVE_STATUSES = new Set(['running', 'waiting', 'starting', 'error', 'queued']);

export function attentionRank(session) {
  return session.needsYou ? 100 : (STATUS_RANK[session.status] ?? 0);
}

export function mergeTileOrder(sessions, savedIds = []) {
  const ranked = [...sessions].sort((a, b) => attentionRank(b) - attentionRank(a) || a.title.localeCompare(b.title));
  if (!savedIds.length) return ranked;
  const byId = new Map(ranked.map(session => [session.id, session]));
  const seen = new Set();
  const known = savedIds.flatMap(id => {
    const session = byId.get(id);
    if (!session || seen.has(id)) return [];
    seen.add(id);
    return [session];
  });
  const added = ranked.filter(session => !seen.has(session.id));
  const urgent = added.filter(session => session.needsYou || ['error', 'waiting'].includes(session.status));
  const normal = added.filter(session => !urgent.includes(session));
  return [...urgent, ...known, ...normal];
}

export function insertTileOrder(ids, sourceId, targetId, position = 'before') {
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return ids;
  const next = ids.filter(id => id !== sourceId);
  next.splice(next.indexOf(targetId) + (position === 'after' ? 1 : 0), 0, sourceId);
  return next;
}

export function resizeGridTracks(tracks, index, deltaPx, beforePx, afterPx, minPx = 220) {
  if (!Array.isArray(tracks) || index < 0 || index + 1 >= tracks.length) return tracks;
  const pairPx = beforePx + afterPx;
  if (!Number.isFinite(pairPx) || pairPx <= 0 || !Number.isFinite(deltaPx)) return tracks;
  const floor = Math.min(minPx, pairPx / 2);
  const nextBeforePx = Math.max(floor, Math.min(pairPx - floor, beforePx + deltaPx));
  const pairWeight = tracks[index] + tracks[index + 1];
  const next = [...tracks];
  next[index] = pairWeight * nextBeforePx / pairPx;
  next[index + 1] = pairWeight - next[index];
  return next;
}

export function tileColumns(count, width = Infinity, minWidth = 330) {
  const ideal = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const available = Number.isFinite(width) ? Math.max(1, Math.floor((width + 10) / (minWidth + 10))) : 4;
  return Math.max(1, Math.min(ideal, available));
}

export function layoutKey(group, ids, columns) {
  return `${encodeURIComponent(group)}:${columns}:${[...ids].sort().map(encodeURIComponent).join(',')}`;
}

export function validTracks(value, count) {
  return Array.isArray(value) && value.length === count && value.every(n => Number.isFinite(n) && n > 0);
}

export function createLayoutStore(storage, namespace = 'agent-grid') {
  const key = `${namespace}:v1`;
  return {
    read() {
      try {
        const value = JSON.parse(storage?.getItem(key) || 'null');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch { return {}; }
    },
    write(value) {
      try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Layouts also work without storage. */ }
    },
  };
}
