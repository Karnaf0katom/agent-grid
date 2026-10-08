import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGridState, restoreGridViews } from '../src/views.js';

test('v0.1 layouts survive migration and saved grids keep independent state', () => {
  const saved = { group: 'commerce', showAll: true, hidden: ['a'], orders: { commerce: ['b', 'a'] }, layouts: { pair: { cols: [1, 2], rows: [1] } } };
  const restored = restoreGridViews(saved);
  assert.equal(restored.activeGrid, 'all');
  assert.equal(restored.defaultGrid.group, 'commerce');
  assert.deepEqual(restored.defaultGrid.hidden, ['a']);
  const copy = normalizeGridState(restored.defaultGrid);
  copy.orders.commerce.reverse();
  copy.layouts.pair.cols[0] = 9;
  assert.deepEqual(saved.orders.commerce, ['b', 'a']);
  assert.deepEqual(restored.defaultGrid.layouts.pair.cols, [1, 2]);
});

test('saved selection retains absent sessions and rejects corrupt or duplicate grids', () => {
  const restored = restoreGridViews({ activeGrid: 'review', grids: [
    { id: 'review', name: '  Review  ', sessionIds: ['live', 'absent', 'live', null], columns: 2 },
    { id: 'review', name: 'Duplicate', sessionIds: [] },
    { id: 'all', name: 'Replace default', sessionIds: [] },
    { id: 'bad/name', name: 'Invalid identity', sessionIds: [] },
    { id: 'no-name', name: '  ', sessionIds: [] },
    { id: 'empty', name: 'Empty grid', sessionIds: [] },
  ] });
  assert.equal(restored.activeGrid, 'review');
  assert.equal(restored.grids.length, 2);
  assert.equal(restored.grids[0].name, 'Review');
  assert.deepEqual(restored.grids[0].sessionIds, ['live', 'absent']);
  assert.equal(restored.grids[0].columns, 2);
  assert.deepEqual(restored.grids[1].sessionIds, []);
  assert.equal(restoreGridViews({ activeGrid: 'gone' }).activeGrid, 'all');
  assert.doesNotThrow(() => restoreGridViews(null));
  const invalid = normalizeGridState({ columns: 99, layouts: { broken: { cols: [NaN], rows: [1] } } });
  assert.equal(invalid.columns, 0);
  assert.deepEqual(Object.keys(invalid.layouts), []);
});
