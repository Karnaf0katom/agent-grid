# Optional Agent Grid integration for CCC

Agent Grid is a browser-native, dependency-free presentation component. CCC can use it to display several existing conversations or terminals in one adjustable grid. It forwards user actions through callbacks owned by the host.

## Proposed integration

1. Add an optional Grid view; keep CCC's existing views as the default.
2. Load the five SDK JavaScript modules as static files. No npm dependency, bundler, Python package, or server restart is needed for a frontend-only embedding.
3. Implement `listSessions`, `readOutput` or `mountSession`, and optional `sendPrompt`/`openSession` by calling the same CCC functions that the existing UI already uses.
4. Set each session's capabilities from CCC's existing permissions. Call the existing manual-send path, preserving its checks. A terminal or chat renderer keeps its existing session id, working directory, and rules.
5. Keep the Apache license, Grid's `NOTICE`, and the preserved MIT notice with CCC's third-party acknowledgements.

No current CCC source is bundled here. The component has no provider integrations, hooks, repository-writing logic, scheduling, or automatic agent spawning. CCC's current project license stays in place. Paid distribution of CCC using Grid is permitted by Grid's license.

## Integration acceptance check

With CCC's own session fixtures, display two sessions, reorder and resize them, focus one, and restore the mosaic. A manual prompt must reach exactly the selected existing session through the existing send handler. A read-only or otherwise restricted session must not expose input. Removing the Grid view must clean up listeners/renderers and leave sessions running.

The public release includes a working app, SDK archive, tests, and an adapter guide. An upstream implementation can be small and optional. Per CCC's [contribution guide](https://github.com/amirfish1/claude-command-center/blob/main/CONTRIBUTING.md), begin with a concrete adoption offer before sending a library-sized PR.

## Offer text

> I extracted the Fleet Grid idea into Agent Grid, a standalone app and dependency-free embeddable component: https://github.com/Karnaf0katom/agent-grid.
>
> It can be an optional CCC view with attention ordering, focus, filtering, reorder, resizing, and per-session composers. CCC supplies the session/output/rendering/send callbacks and keeps its existing rules and permissions. It does not replace CCC's orchestration or add provider integrations.
>
> New code is Apache 2.0, with credit to Karnaf Katom in NOTICE and the original Agent Deck MIT notice preserved. You can use, modify, distribute, and sell a product using it; your application's license stays yours. Required notices are sufficient, with no UI watermark or revenue claim.
>
> Would a small optional Grid integration be useful? The repository has an integration guide and a release SDK so you can try it independently first.
