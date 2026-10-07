// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Karnaf Katom.
import { createHttpAdapter } from '/sdk/index.js';
import { defineAgentGrid } from '/sdk/element.js';

defineAgentGrid();
const grid = document.querySelector('agent-grid');
const error = document.querySelector('#app-error');
const mode = document.querySelector('#mode');
try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Could not read host configuration.');
  const config = await response.json();
  mode.textContent = config.mode === 'demo' ? 'DEMO · SIMULATED AGENTS' : `TMUX · ${config.readOnly ? 'READ-ONLY' : 'INPUT ENABLED'}`;
  grid.readOnly = config.readOnly;
  grid.adapter = createHttpAdapter({ readOnly: config.readOnly });
} catch (failure) { error.textContent = failure.message; error.hidden = false; mode.textContent = 'CONNECTION UNAVAILABLE'; }

const toggle = document.querySelector('#embed-toggle');
toggle.addEventListener('click', () => {
  const guide = document.querySelector('#embed-guide');
  guide.hidden = !guide.hidden;
  toggle.setAttribute('aria-expanded', String(!guide.hidden));
});
