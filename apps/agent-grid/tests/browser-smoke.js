import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createGridServer } from '../server.js';

const server = createGridServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const grid = page.locator('agent-grid');
const tiles = () => grid.locator('.tile:visible');
const ids = () => tiles().evaluateAll(elements => elements.map(element => element.dataset.sessionId));
const waitCount = async count => { await page.waitForFunction(expected => [...document.querySelector('agent-grid').shadowRoot.querySelectorAll('.tile')].filter(tile => !tile.hidden).length === expected, count); };
const checkPaneControls = async () => {
  const clipped = await tiles().evaluateAll(elements => elements.flatMap(tile => {
    const bounds = tile.getBoundingClientRect();
    return ['.tile-header button', '.composer', '.composer textarea', '.composer .send', '.tile-footer', '.tile-footer button'].flatMap(selector => [...tile.querySelectorAll(selector)].flatMap(control => {
      if (!control.getClientRects().length) return [];
      const rect = control.getBoundingClientRect();
      return rect.bottom > bounds.bottom + 1 || rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ? [`${tile.dataset.sessionId}: ${selector}`] : [];
    }));
  }));
  assert.deepEqual(clipped, [], 'All visible pane controls must fit inside their pane.');
};

try {
  await page.goto(origin);
  await waitCount(5);
  await grid.locator('[data-session-id="checkout"] .snapshot').filter({ hasText: 'Read checkout/retry.ts' }).waitFor();
  assert.equal((await ids())[0], 'webhooks');
  assert.match(await page.locator('#mode').textContent(), /SIMULATED/);
  await page.locator('#embed-toggle').click();
  assert.equal(await page.locator('#embed-guide').isVisible(), true);
  await page.locator('#embed-toggle').click();

  const inventory = grid.locator('[data-session-id="inventory"]');
  const input = inventory.locator('textarea');
  await input.fill('Draft survives focus and layout changes.');
  await inventory.getByRole('button', { name: 'Focus Build the inventory view', exact: true }).click();
  await waitCount(1);
  await grid.getByRole('button', { name: 'Exit focused session', exact: true }).click();
  await waitCount(5);
  assert.equal(await input.inputValue(), 'Draft survives focus and layout changes.');
  await inventory.getByRole('button', { name: 'Hide Build the inventory view', exact: true }).click();
  await waitCount(4);
  await grid.getByRole('button', { name: 'Restore hidden sessions', exact: true }).click();
  await waitCount(5);
  assert.equal(await input.inputValue(), 'Draft survives focus and layout changes.');

  const beforeDrag = await ids();
  await grid.locator(`[data-session-id="${beforeDrag.at(-1)}"] .grip`).dragTo(grid.locator(`[data-session-id="${beforeDrag[0]}"]`), { targetPosition: { x: 12, y: 12 } });
  assert.equal((await ids())[0], beforeDrag.at(-1));
  const beforeOrder = await ids();
  const first = grid.locator(`[data-session-id="${beforeOrder[0]}"] .grip`);
  await first.focus(); await page.keyboard.press('ArrowRight');
  const afterOrder = await ids();
  assert.equal(afterOrder[1], beforeOrder[0]);
  const divider = grid.getByRole('separator', { name: 'Resize columns 1 and 2' });
  const beforeSize = await divider.getAttribute('aria-valuenow');
  await divider.focus(); await page.keyboard.press('ArrowRight');
  assert.notEqual(await divider.getAttribute('aria-valuenow'), beforeSize);
  const afterKeyboardSize = await divider.getAttribute('aria-valuenow');
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + 20);
  await page.mouse.up();
  assert.notEqual(await divider.getAttribute('aria-valuenow'), afterKeyboardSize);
  const savedSize = await divider.getAttribute('aria-valuenow');
  await page.reload(); await waitCount(5);
  assert.deepEqual(await ids(), afterOrder);
  assert.equal(await grid.getByRole('separator', { name: 'Resize columns 1 and 2' }).getAttribute('aria-valuenow'), savedSize);

  await grid.getByRole('combobox', { name: 'Filter workspace' }).selectOption('commerce');
  await waitCount(2);
  await input.fill('First line\nSecond line');
  await inventory.getByRole('button', { name: 'Send ↵', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('agent-grid').shadowRoot.querySelector('[data-session-id="inventory"] .snapshot').textContent.includes('[Demo] Prompt delivered'));
  assert.equal(await input.inputValue(), '');
  const checkoutText = await grid.locator('[data-session-id="checkout"] .snapshot').textContent();
  assert.ok(!checkoutText.includes('First line'));
  await page.evaluate(() => { document.querySelector('agent-grid').readOnly = true; });
  assert.equal(await grid.locator('.composer:visible').count(), 0);
  await page.evaluate(() => { document.querySelector('agent-grid').readOnly = false; });
  await grid.getByRole('combobox', { name: 'Filter workspace' }).selectOption('*');
  await waitCount(5);
  await grid.getByRole('button', { name: 'Include idle and stopped sessions', exact: true }).click();
  await waitCount(6);
  await grid.getByRole('button', { name: 'Include idle and stopped sessions', exact: true }).click();
  await waitCount(5);
  await grid.getByRole('button', { name: 'Reset pane order and sizes for this workspace', exact: true }).click();

  // The catalog searches every host session without filtering the current canvas.
  const catalog = grid.locator('.session-list');
  const search = grid.getByRole('searchbox', { name: 'Search sessions' });
  const inventoryChoice = grid.getByRole('checkbox', { name: 'Show Build the inventory view in this grid', exact: true });
  const changelogChoice = grid.getByRole('checkbox', { name: 'Show Draft API changelog in this grid', exact: true });
  assert.equal(await catalog.locator('.session-item:visible').count(), 6);
  await search.fill('commerce');
  assert.equal(await catalog.locator('.session-item:visible').count(), 2);
  assert.equal((await ids()).length, 5);
  await search.fill('no matching session');
  assert.equal(await catalog.locator('.session-item:visible').count(), 0);
  assert.match(await grid.locator('.sidebar-empty').textContent(), /No matching sessions/);
  await search.fill('');
  await input.fill('Draft survives grid selection.');
  await inventoryChoice.uncheck(); await waitCount(4);
  await inventoryChoice.check(); await waitCount(5);
  assert.equal(await input.inputValue(), 'Draft survives grid selection.');
  await changelogChoice.check(); await waitCount(6);
  await grid.getByRole('button', { name: 'Include idle and stopped sessions', exact: true }).click();
  await waitCount(5);
  const saveNamed = async name => {
    await grid.getByRole('button', { name: 'Save current sessions as a named grid', exact: true }).click();
    await grid.getByRole('textbox', { name: 'New grid name' }).fill(name);
    await grid.getByRole('button', { name: 'Save', exact: true }).click();
  };
  const gridPicker = grid.getByRole('combobox', { name: 'Choose saved grid' });
  const columns = grid.getByRole('combobox', { name: 'Grid columns' });
  await grid.getByRole('combobox', { name: 'Filter workspace' }).selectOption('commerce');
  await waitCount(2);
  await grid.locator('[data-session-id="inventory"] .grip').focus();
  await page.keyboard.press('ArrowLeft');
  const commerceOrder = await ids();
  const commerceDivider = grid.getByRole('separator', { name: 'Resize columns 1 and 2' });
  await commerceDivider.focus(); await page.keyboard.press('ArrowRight');
  const commerceSize = await commerceDivider.getAttribute('aria-valuenow');
  await saveNamed('Commerce');
  assert.deepEqual(await ids(), commerceOrder);
  assert.equal(await commerceDivider.getAttribute('aria-valuenow'), commerceSize);
  await columns.selectOption('1');
  await saveNamed('Review');
  await inventoryChoice.uncheck(); await waitCount(1);
  await columns.selectOption('4');
  await grid.getByRole('button', { name: 'View saved grid Commerce', exact: true }).click();
  await waitCount(2);
  assert.equal(await columns.inputValue(), '1');
  assert.equal(await input.inputValue(), 'Draft survives grid selection.');
  await gridPicker.selectOption('all'); await waitCount(2);
  assert.equal(await grid.getByRole('combobox', { name: 'Filter workspace' }).inputValue(), 'commerce');
  assert.equal(await columns.inputValue(), '0');
  await grid.getByRole('combobox', { name: 'Filter workspace' }).selectOption('*');
  await waitCount(5);
  await gridPicker.selectOption({ label: 'Review' }); await waitCount(1);
  await page.reload(); await waitCount(1);
  assert.equal(await columns.inputValue(), '4');
  assert.equal(await page.evaluate(() => document.querySelector('agent-grid')._columns), 1);
  assert.equal(await grid.locator('.grid-link[aria-pressed=true]').textContent(), 'Review1');
  page.once('dialog', dialog => dialog.accept());
  await grid.getByRole('button', { name: 'Delete this saved grid', exact: true }).click();
  await waitCount(5);
  assert.equal(await grid.getByRole('button', { name: 'View saved grid Review', exact: true }).count(), 0);
  await grid.getByRole('button', { name: 'Toggle session sidebar', exact: true }).click();
  assert.equal(await grid.locator('.sidebar').isVisible(), false);
  await page.reload(); await waitCount(5);
  assert.equal(await grid.locator('.sidebar').isVisible(), false);
  await grid.getByRole('button', { name: 'Toggle session sidebar', exact: true }).click();
  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await grid.getByRole('button', { name: 'Enter fullscreen grid', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement === document.querySelector('agent-grid'));
    await grid.getByRole('button', { name: 'Exit fullscreen grid', exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
  }
  await checkPaneControls();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/agent-grid-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('agent-grid')._columns === 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await checkPaneControls();
  await page.screenshot({ path: 'artifacts/agent-grid-mobile.png', fullPage: true });

  // Embedded SDK panels adapt to their own width inside a wide desktop viewport.
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForFunction(() => document.querySelector('agent-grid')._columns > 1);
  await grid.evaluate(element => { element.style.width = '480px'; });
  await page.waitForFunction(() => document.querySelector('agent-grid')._columns === 1);
  const embedded = await grid.evaluate(element => ({
    host: element.getBoundingClientRect().width,
    canvas: element.shadowRoot.querySelector('.canvas').getBoundingClientRect().width,
  }));
  assert.ok(Math.abs(embedded.host - embedded.canvas) < 2, 'A narrow embedded grid must stack its sidebar even in a wide viewport.');
  await checkPaneControls();
  await grid.screenshot({ path: 'artifacts/agent-grid-embedded.png' });
  await grid.evaluate(element => { element.style.width = ''; });
  await page.waitForFunction(() => document.querySelector('agent-grid')._columns > 1);
  await checkPaneControls();

  // A host-supplied renderer mounts once and cleans up when the element is removed.
  await page.evaluate(async () => {
    const { mountAgentGrid } = await import('/sdk/element.js');
    window.rendererCounts = { mounted: 0, cleaned: 0 };
    window.rendererState = { offline: false, rows: [{ id: 'custom', title: '<img src=x onerror=alert(1)>', status: 'running' }] };
    const handle = mountAgentGrid(document.body, { storageKey: 'renderer-test', adapter: {
      listSessions: async () => {
        if (window.rendererState.offline) throw new Error('Host offline');
        return window.rendererState.rows;
      },
      mountSession(container) { window.rendererCounts.mounted++; container.textContent = 'Custom host renderer'; return () => { window.rendererCounts.cleaned++; }; },
    } });
    window.rendererHandle = handle;
  });
  await page.waitForFunction(() => window.rendererCounts.mounted === 1);
  const custom = page.locator('agent-grid').last();
  assert.equal(await custom.locator('img').count(), 0);
  assert.match(await custom.locator('.title').textContent(), /<img/);
  await custom.getByRole('button', { name: /Focus <img/ }).click();
  await page.evaluate(async () => { window.rendererState.offline = true; await window.rendererHandle.element.refresh(); });
  await custom.locator('.banner').filter({ hasText: 'Host offline' }).waitFor();
  assert.equal(await custom.locator('.tile:visible').count(), 1);
  await page.evaluate(async () => { window.rendererState.offline = false; window.rendererState.rows = []; await window.rendererHandle.element.refresh(); });
  await custom.locator('.state').filter({ hasText: 'Your grid is ready' }).waitFor();
  assert.equal(await custom.locator('.tile').count(), 0);
  await page.evaluate(() => window.rendererHandle.destroy());
  assert.deepEqual(await page.evaluate(() => window.rendererCounts), { mounted: 1, cleaned: 1 });

  // Switching saved grids preserves mounted host renderers; missing sessions may return.
  await page.evaluate(async () => {
    const { mountAgentGrid } = await import('/sdk/element.js');
    window.viewRendererCounts = { mounted: 0, cleaned: 0 };
    window.viewRows = [
      { id: 'a', title: 'Alpha', status: 'running' },
      { id: 'b', title: 'Beta', status: 'idle' },
      { id: 'c', title: 'Gamma', status: 'running' },
    ];
    window.viewHandle = mountAgentGrid(document.body, { storageKey: 'view-renderer-test', adapter: {
      listSessions: async () => window.viewRows,
      mountSession(container, session) {
        window.viewRendererCounts.mounted++;
        container.textContent = `Host renderer for ${session.title}`;
        return () => { window.viewRendererCounts.cleaned++; };
      },
    } });
  });
  await page.waitForFunction(() => window.viewRendererCounts.mounted === 2);
  await page.evaluate(() => { window.pairGrid = window.viewHandle.element.saveGrid('Pair', ['a', 'b']); });
  await page.waitForFunction(() => window.viewRendererCounts.mounted === 3);
  await page.evaluate(() => { window.viewHandle.element.selectGrid('all'); window.viewHandle.element.selectGrid(window.pairGrid); });
  assert.deepEqual(await page.evaluate(() => window.viewRendererCounts), { mounted: 3, cleaned: 0 });
  await page.evaluate(async () => { window.viewRows = window.viewRows.filter(row => row.id !== 'b'); await window.viewHandle.element.refresh(); });
  await page.waitForFunction(() => window.viewRendererCounts.cleaned === 1);
  assert.deepEqual(await page.evaluate(() => window.viewHandle.element.savedGrids[0].sessionIds), ['a', 'b']);
  await page.evaluate(async () => { window.viewRows.push({ id: 'b', title: 'Beta', status: 'idle' }); await window.viewHandle.element.refresh(); });
  await page.waitForFunction(() => window.viewRendererCounts.mounted === 4);
  const viewGrid = page.locator('agent-grid').last();
  assert.equal(await viewGrid.locator('.tile:visible').count(), 2);
  await viewGrid.getByRole('button', { name: 'Remove all sessions from this grid', exact: true }).click();
  await viewGrid.locator('.state').filter({ hasText: 'No sessions in this grid' }).waitFor();
  assert.equal(await viewGrid.getByRole('button', { name: 'Restore hidden sessions', exact: true }).isVisible(), false);
  await viewGrid.getByRole('checkbox', { name: 'Show Beta in this grid', exact: true }).check();
  assert.equal(await viewGrid.locator('.tile:visible').count(), 1);
  await page.evaluate(() => window.viewHandle.destroy());
  assert.deepEqual(await page.evaluate(() => window.viewRendererCounts), { mounted: 4, cleaned: 4 });
  assert.deepEqual(errors, []);
  console.log('PASS: browser layout, focus, drafts, hide/restore, pointer/keyboard ordering and resize/persistence, input isolation, read-only, session catalog/search/selection, independent saved grids, fullscreen, mobile, narrow desktop embeds, escaping, connection recovery, empty state, returning sessions, and renderer cleanup.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
