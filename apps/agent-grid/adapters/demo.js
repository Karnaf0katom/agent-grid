// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
import { createMemoryAdapter } from '../../../packages/agent-grid/src/index.js';

export function createDemoAdapter({ readOnly = false } = {}) {
  const writable = { send: !readOnly, interrupt: !readOnly };
  const sessions = [
    { id: 'checkout', title: 'Review checkout edge cases', tool: 'Codex', group: 'commerce', status: 'waiting', needsYou: true, question: 'Should a payment retry reuse the original idempotency key?', detail: 'review', capabilities: writable },
    { id: 'inventory', title: 'Build the inventory view', tool: 'Codex', group: 'commerce', status: 'running', detail: 'implementation', capabilities: writable },
    { id: 'accessibility', title: 'Run accessibility checks', tool: 'Shell', group: 'studio', status: 'running', detail: 'verification', capabilities: writable },
    { id: 'webhooks', title: 'Investigate webhook retries', tool: 'Custom agent', group: 'services', status: 'error', needsYou: true, question: 'The staging endpoint is unavailable. Reconnect before retrying.', detail: 'investigation', capabilities: writable },
    { id: 'palette', title: 'Refactor the command palette', tool: 'Gemini CLI', group: 'studio', status: 'running', detail: 'implementation', capabilities: writable },
    { id: 'changelog', title: 'Draft API changelog', tool: 'Codex', group: 'platform', status: 'idle', detail: 'documentation', capabilities: { send: !readOnly, interrupt: false } },
  ];
  return createMemoryAdapter(sessions, {
    checkout: '› Review the payment retry behavior.\n\nRead checkout/retry.ts\nRead checkout/idempotency.ts\n\nThe retry path creates a new key for every attempt.\nThat can double-charge a request after a timeout.\n\nI need one product decision before changing this:\nreuse the original key, or create a new payment?',
    inventory: '› Build the inventory view from the existing API.\n\n✓ Reused the stock-level query\n✓ Added search and warehouse filters\n✓ Kept the existing permissions\n\nChecking pagination and the empty state…\n\n  inventory-table.test.ts   12 passed\n  inventory-query.test.ts    7 passed',
    accessibility: '$ npm run check:a11y\n\nScanning the component preview…\n\n✓ All controls have accessible names\n✓ Dialog focus returns to its trigger\n✓ Reduced motion is respected\n\nChecking keyboard navigation through the palette…',
    webhooks: '› Trace the delayed delivery reports.\n\n✓ Found the retry queue entry\n✓ Verified the event signature\n\nConnectionError: staging endpoint is unavailable\n\nThe failed request remains in the retry queue.\nNo production configuration has changed.',
    palette: '› Refactor the command palette without changing shortcuts.\n\nRead src/commands/registry.ts\nRead src/components/command-palette.ts\n\nUsing the existing registry as the source of truth.\n\n✓ Removed duplicated command metadata\n✓ Preserved shortcut bindings\n\nReviewing the diff…',
    changelog: '› Draft the API changelog from the merged changes.\n\nDraft ready:\n\n• Inventory filters accept warehouse ids\n• Retry responses include a request id\n• Empty result pages return a stable cursor\n\nWaiting for the release owner.',
  });
}
