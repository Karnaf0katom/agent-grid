# Contributing

Keep Grid small and host-neutral. It is a presentation component and a local app, rather than an agent engine. Propose a substantial feature in an issue before implementing it.

Use Node.js 20 or newer. Run `npm test`. For UI changes, install the development dependencies, run `npx playwright install chromium`, and run `npm run test:browser`.

Core tests cover the extracted Fleet Grid behavior. HTTP tests check permission and origin enforcement. The tmux test uses a private socket and closes only the session it creates. Browser checks use simulated sessions, including read-only behavior and renderer cleanup.

Keep adapters explicit about capabilities. Preserve host rules, session ownership, working directories, provider authentication, and authorization. Do not add automatic agent spawning, instruction-file mutation, or telemetry as side effects of displaying a grid.

Contributions are offered under Apache 2.0. Keep third-party notices intact and identify any imported source. A pull request should say what changes, why it is needed, and how it was verified. There is no copyright assignment or separate contributor agreement for this project.
