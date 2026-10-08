# Design evidence and scope

Agent Grid extends the Fleet Grid idea originally implemented in our Agent Deck setup. Its small geometry and ordering algorithms are reused with Agent Deck's MIT notice. Its adapter boundary and dependency-free web component are new. No BridgeMind code, branding, footage, or artwork is included in the product.

## BridgeMind evidence

Primary source: [BridgeMind Code Mode documentation](https://docs.bridgemind.ai/docs/code-mode), accessed 2026-10-07. It describes a project workspace with terminal, thread, file, browser, and simulator panes; panes can be split, resized, and rearranged. It offers session presets with visible role/count information before starting agents. Supported agents are installed tools using their own runtimes.

Decision: keep the first release focused on agent-session panes and manual control; let host apps supply additional renderers and keep engine launching in the host.

Primary source: [BridgeSpace 3.4.17 release notes](https://www.bridgemind.ai/changelog/bridgespace/v3-4-17). The expanded workspace combines a sessions rail, a voice stage, and an interactive terminal for the focused agent, with adjustable dividers.

Decision: make focused-pane access and adjustable space first-class. The built-in Grid renderer remains honestly labelled as a snapshot; host apps can mount their real interactive terminal.

Primary source: [BridgeSpace 3.0.74 release notes](https://www.bridgemind.ai/changelog/bridgespace/v3-0-74). It documents focus-first scheduling under multi-agent output, correct streaming UTF-8 handling, and recovery behavior.

Decision: limit concurrent snapshot reads, keep output nodes stable, preserve user drafts, decode process output across chunk boundaries, and let the host own streaming and recovery.

Primary source: [BridgeSpace 3.1.7 release notes](https://www.bridgemind.ai/changelog/bridgespace/v3-1-7), checked 2026-10-08. It explicitly describes Rust terminal flushing and Tauri channel recovery. This confirms those backend technologies; it does not establish what percentage of the application is Rust.

Decision for v0.2: add the owner's requested all-session sidebar, explicit session selection, named saved grids, and top layout controls to the existing SDK. Keep native runtime and IPC ownership in the host adapter. Each saved grid owns its presentation state, and switching views preserves existing renderers and drafts.

## YouTube review status

The requested footage review is tracked separately from the verified documentation findings. Selected sources are [this BridgeMind demo](https://www.youtube.com/watch?v=K-AzrvFeNTQ) and the [officially linked recent stream](https://www.youtube.com/watch?v=EvCMaE94p1g). YouTube page retrieval was unavailable. The existing video watcher failed at its downloader; an available downloader then reached YouTube's sign-in/bot challenge. No video-specific observations or claims are asserted here. Revisit footage analysis when an accessible source or authorized access is available.

A short owner-supplied clip is now available for follow-up review. The v0.2 interactions follow the owner's description and the primary sources above; footage-specific observations remain unverified.

## CCC evidence

[CCC's contribution guide](https://github.com/amirfish1/claude-command-center/blob/main/CONTRIBUTING.md) asks for small changes and zero dependencies, and recommends a separate plugin repository for features needing a library. Its [current license](https://github.com/amirfish1/claude-command-center/blob/main/LICENSE) and [CLA](https://github.com/amirfish1/claude-command-center/blob/main/CLA.md) are distinct from this component's Apache license.

Decision: offer a separately licensed optional component with no orchestration rewrite. A license on our component does not replace CCC's license.
