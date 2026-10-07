# Connect existing tmux sessions

Run `node apps/agent-grid/server.js --tmux` to inspect existing panes. Real tmux mode is read-only by default. Add `--allow-input` to permit manual prompt delivery and current-turn interrupts. Add `--session-prefix` to scope the visible panes and their allowed actions.

```sh
node apps/agent-grid/server.js --tmux --session-prefix project
node apps/agent-grid/server.js --tmux --socket-name my-socket --session-prefix project --allow-input
```

No new agent is started. The existing tmux processes keep their working directories, environment, instruction files, and permission settings. Grid does not modify pane sizes, change branches, create worktrees, install providers, or read provider credentials.

Output comes from `capture-pane` as a plain text snapshot of the last 500 lines. It is refreshed approximately every two seconds. Grid sends a prompt with a unique literal paste buffer, bracketed paste when supported by the terminal, and one Enter. Input to each pane is serialized. It does not interpolate prompts into shell commands. Terminal control bytes are refused; multiline text and UTF-8 are supported.

An input-enabled shell is still a shell: the text you deliberately send is processed by that shell. Use an existing coding-agent pane when your intended input is a prompt. Interrupt sends Ctrl+C to the current pane; it does not close a session. The UI asks before interrupting.

By default, status is an estimate based on the process name (`idle` for a recognized shell and `running` otherwise). It is not an AI state detector. Your host can annotate panes with:

```sh
tmux set-option -p -t %7 @agent-grid-title 'Review checkout'
tmux set-option -p -t %7 @agent-grid-group 'commerce'
tmux set-option -p -t %7 @agent-grid-status 'waiting'
tmux set-option -p -t %7 @agent-grid-needs-you '1'
```

Use the actual pane id for your session. Allowed status values match the library's [adapter contract](integrating.md). No background monitor or model call is introduced.

The provided server binds to `127.0.0.1` and accepts only its own localhost origins. It is a local app, rather than a public multi-user control service. Apps embedding Grid on another origin should implement the adapter in their existing authenticated backend.
