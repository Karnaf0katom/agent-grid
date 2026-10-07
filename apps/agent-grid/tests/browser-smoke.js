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
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/agent-grid-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('agent-grid')._columns === 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'artifacts/agent-grid-mobile.png', fullPage: true });

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
  assert.deepEqual(errors, []);
  console.log('PASS: browser layout, focus, drafts, hide/restore, pointer/keyboard ordering and resize/persistence, input isolation, read-only, mobile, escaping, connection recovery, empty state, and renderer cleanup.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
