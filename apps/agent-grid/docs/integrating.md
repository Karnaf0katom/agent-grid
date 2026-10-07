# Embed Agent Grid

The library has no runtime dependencies. Import `@karnafkatom/agent-grid/element` to define or mount the component. Importing the JavaScript core in a server environment does not require a DOM.

## The host contract

```ts
interface Adapter {
  listSessions(options?: { signal?: AbortSignal }): Promise<Session[]>;
  readOutput?(id: string, options?: { signal?: AbortSignal }): Promise<{ text: string } | string>;
  sendPrompt?(id: string, text: string, options?: { signal?: AbortSignal }): Promise<unknown>;
  performAction?(id: string, action: 'interrupt', options?: { signal?: AbortSignal }): Promise<unknown>;
  openSession?(id: string): void;
  mountSession?(container: HTMLElement, session: Session, options: { signal?: AbortSignal }): void | (() => void);
  subscribe?(listener: () => void): () => void;
}
```

Only `listSessions` is required. Each session needs a unique string `id` and can supply `title`, `group`, `tool`, `status`, `needsYou`, `question`, `detail`, and `capabilities`. Supported statuses are `running`, `waiting`, `starting`, `error`, `queued`, `idle`, and `stopped`. A host should report its own status; Grid does not infer model activity.

Capabilities are `{ send?: boolean, interrupt?: boolean, open?: boolean }`. They default to false. Set `send: true` only when the host permits manual input to that specific session. The matching adapter method must also exist for a control to appear. The host must enforce permissions again when executing an action. `readonly` on the grid and `readOnly` on the HTTP adapter provide additional client-side restrictions.

## A complete minimal example

```html
<div id="agents"></div>
<script type="module">
  import { mountAgentGrid } from './sdk/element.js';
  import { createMemoryAdapter } from './sdk/index.js';

  const adapter = createMemoryAdapter([
    { id: 'review', title: 'Review the checkout flow', group: 'commerce',
      tool: 'Demo', status: 'waiting', needsYou: true,
      capabilities: { send: true } },
  ], { review: 'Ready for your next instruction.' });

  mountAgentGrid(document.querySelector('#agents'), { adapter });
</script>
```

This example uses the modules served at `/sdk/` by the standalone app. In a bundled app, use the package imports instead. The memory adapter simulates output and prompt delivery.

## HTTP adapter

`createHttpAdapter({ baseUrl: '/agent-control' })` calls:

| Method and path | Response/body |
| --- | --- |
| `GET /api/sessions` | `{ sessions: Session[] }` or `Session[]` |
| `GET /api/sessions/:id/output` | `{ text: string, mode: 'snapshot' }` |
| `POST /api/sessions/:id/input` | body `{ text: string }`; successful JSON response |
| `POST /api/sessions/:id/actions` | body `{ action: 'interrupt' }`; successful JSON response |

Paths are relative to `baseUrl`. IDs are URL-encoded. POSTs use JSON and `X-Agent-Grid: 1`. Errors return a non-2xx response with `{ error: string }`. Your own fetch implementation can be passed as `fetch` to add the host's existing authentication. Do not put credentials in browser URLs.

## React

```jsx
import { useEffect, useRef } from 'react';
import { mountAgentGrid } from '@karnafkatom/agent-grid/element';

export function Agents({ adapter, readOnly = false }) {
  const container = useRef(null);
  useEffect(() => {
    const grid = mountAgentGrid(container.current, {
      adapter, readOnly, storageKey: 'my-app-grid',
    });
    return () => grid.destroy();
  }, [adapter, readOnly]);
  return <div ref={container} />;
}
```

Keep the adapter reference stable across renders. Call `destroy()` on teardown. Vue and other frameworks use the same mount/destroy pair from their lifecycle hooks.

## Your own renderer

If your app already has a terminal, chat, or tool-event renderer, implement `mountSession(container, session, { signal })`. Mount it once and return its cleanup function. Grid keeps the same container through focus, hide/restore, resize, and reorder. Removed sessions, adapter changes, and component destruction abort the signal and invoke cleanup.

The custom renderer remains part of the host. It must honor the host's permissions and any read-only policy independently. Grid's composer gate cannot secure a separately mounted interactive terminal. Custom renderers should watch their container size with `ResizeObserver` and keep any terminal sizing policy in the host.

When `mountSession` is supplied, Grid does not poll `readOutput`. The host owns streaming, backpressure, and terminal input. Otherwise Grid polls snapshots, prioritizes the visible focused pane, limits concurrent output reads to four, avoids rewriting unchanged output, and pauses scheduled polls when the document is hidden.

## Persistence, theming, and events

Set a distinct `storageKey` for each app/account. Only workspace selection, visibility, order, and sizes are saved to localStorage; prompts and terminal output are not. If storage is unavailable, the grid still works. Layouts persist per workspace, session set, and column count.

Host CSS can override `--ag-bg`, `--ag-panel`, `--ag-line`, `--ag-text`, `--ag-muted`, `--ag-accent`, `--ag-alert`, and `--ag-danger` on the element. Styles are scoped to its shadow root.

`agent-grid-action` reports `{ sessionId, action }` after successful manual actions. `agent-grid-error` reports `{ message }`. Events bubble across the shadow boundary and do not include prompt contents. The package sends no telemetry.
