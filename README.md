# Yudu Chat UI

A personal AI chat workspace with a Vite + React + TypeScript + shadcn/ui front end
and a Fastify + TypeScript + SQLite back end. Multi-provider (OpenAI-compatible and
Anthropic), SSE streaming, persistent conversations, tool calling for first-class
agent workflows, pluggable multi-agent orchestration, and a built-in mock provider
so you can try the UI before you bring your own API key.

## Layout

```
apps/
  server/          Fastify + better-sqlite3 + JSON agent profiles
    src/agents/    Seed agent profiles (general, researcher, coder, reviewer)
    src/tools/     Built-in tool registry (workspace, command, web, ...)
  web/             Vite + React 18 + shadcn/ui + Zustand + react-markdown
packages/
  shared/          Cross-package TypeScript types and SSE event union
```

## Quick start

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

The first time you run the app, conversations and settings are stored under
`apps/server/data/`. Open Settings, paste an API key for the provider you want
to use, and start chatting. Toggle "Run with tools" in the composer to let the
model call registered tools, or pick an agent profile from the header to apply
a different system prompt, temperature, model, or tool allowlist.

### Agent tools

The built-in registry now follows the same layered pattern used by mature agent
runtimes such as OpenClaw and Hermes:

- `list_directory`, `read_file`, `search_files` — read-only workspace tools,
  confined to `YUDU_WORKSPACE_ROOT`, with symlink escape checks and output caps.
- `write_file` — full-file writes inside the workspace; disabled until
  `YUDU_ENABLE_WRITE_TOOL=true`.
- `execute_command` — non-interactive process execution without a shell;
  disabled until `YUDU_ENABLE_COMMAND_TOOL=true` and requires
  `YUDU_COMMAND_ALLOW` with a comma-separated executable allowlist. Use `*`
  only inside an already isolated environment. Child processes do not inherit
  environment variables whose names look like credentials, tokens, passwords,
  secrets, cookies, authentication values, or API keys.
- `web_search` — Tavily-backed public web search, available only when
  `YUDU_TAVILY_API_KEY` is configured.
- `http_fetch`, `get_weather` — the existing allowlisted fetch and weather
  tools.

The global **Run with tools** toggle advertises only tools marked safe by
default. High-risk tools must be named in the selected agent profile *and*
enabled by the server operator. Default read tools also block common credential
paths (`.env`, `.ssh`, private keys, cloud credential files) and skip them while
searching.

## Providers

Out of the box:

- `openai` — OpenAI (default base URL `https://api.openai.com/v1`)
- `anthropic` — Anthropic Messages API
- `deepseek` — DeepSeek
- `ollama` — Local Ollama (`/v1`)
- `custom` — Any OpenAI-compatible endpoint
- `mock` — Offline provider that simulates tool calling (e.g. returns
  `get_weather` for Shanghai when asked), handy for UI development

Each provider advertises `supportsTools: true` via `GET /api/providers`. Add
new providers by registering a `ChatProvider` in
`apps/server/src/providers/registry.ts`.

## Features

- Streaming SSE chat (`POST /api/chat`) carrying `delta` / `usage` / `message` /
  `done` / `error` events plus tool and agent lifecycle events, with
  abort-to-stop from the UI
- **Tool calling (function calling)** — providers stream `tool_call` chunks;
  the server executes registered tools, persists the result as a `role: "tool"`
  message, and runs a follow-up round so the model can react. The UI surfaces
  inline tool chips above the assistant message, a compact result strip for
  each `role: "tool"` message, and a live Activity drawer on the side.
- **Multimodal attachments** — the composer accepts up to six images or
  documents per message. PNG/JPEG/GIF/WebP images are sent as provider-native
  vision parts; PDF, DOCX, Markdown, text, CSV, JSON, HTML, and XML files are
  extracted server-side and forwarded as named document context. Attachments
  remain in message history and conversation exports.
- **Image studio** — a dedicated `#/images` workspace supports OpenAI and
  custom OpenAI-compatible image endpoints plus an offline mock provider.
  Choose model, size, quality, style, count, format, background, moderation,
  and output compression; add
  reference images; cancel work; download results; reuse settings; and manage
  locally persisted generation history.
- **Multi-agent orchestration** — agent profiles live in
  `apps/server/src/agents/*.json` and are loaded on boot. Each profile
  overrides `systemPrompt`, `temperature`, `model`, `provider`, and a `tools`
  allowlist, and may `chain` into the next agent. The chat emits
  `agent_started` / `agent_finished` SSE; the UI offers an Agent dropdown in
  the header plus an attribution chip beneath the conversation title.
- Persistent conversations in SQLite; sidebar list, rename, delete
- Message-level actions: copy, delete, regenerate, edit-and-resubmit
- Per-conversation provider, model, system prompt, temperature, and `agentId`
- Markdown rendering with code highlighting (highlight.js)
- Light / dark / system theme
- i18n (English / 中文), auto-detected from `navigator.language`
- Provider + base URL settings persisted to `apps/server/data/settings.json`
- **Reasoning depth (low / medium / high / xhigh)** — per-conversation selector
  in the header. The server forwards the depth to the provider as
  `reasoning_effort` (OpenAI-compatible) or maps it onto a
  `thinking.budget_tokens` block (Anthropic). The mock provider emits a
  synthetic trace whose length scales with depth so the UI is exercisable
  without a real key.
- **Show thinking (default on)** — collapsible reasoning-trace block
  rendered above each assistant message when the conversation's
  `showThinking` flag is true. Reasoning deltas stream over SSE as
  `reasoning_delta` events, are persisted into a leading `reasoning`
  content part on the assistant message, and the SSE channel is the only
  thing gated by the toggle — flipping the UI off doesn't lose history.

## Built-in tools

Registered on server boot via `apps/server/src/tools/builtin.ts`.

- `get_weather(city: string)` — mock weather; the mock chat provider returns
  this when `useTools` is on and the user asks about a city.
- `http_fetch(url: string)` — minimal URL fetcher with an SSRF allowlist
  (`YUDU_HTTP_FETCH_ALLOW`, comma-separated host patterns, defaults to empty
  to keep local dev safe).

Add a tool by writing a module under `apps/server/src/tools/` that exports a
`ToolDefinition` plus a `run(args) => Promise<{ content, isError? }>` handler,
then register it in `builtin.ts`.

## Agent profiles

`apps/server/src/agents/{general,researcher,coder,reviewer}.json`. Example
(`general.json`):

```json
{
  "id": "general",
  "label": "General",
  "description": "Helpful general-purpose assistant with weather + fetch tools.",
  "systemPrompt": "You are Yudu, a helpful AI assistant. ...",
  "tools": ["get_weather", "http_fetch"],
  "temperature": 0.7
}
```

`researcher.json` adds a `chain` so its output flows into a follow-up turn:

```json
{ "id": "researcher", "chain": ["coder"] }
```

Drop a new file in `apps/server/src/agents/` (or call `loadAgents()` on the
server programmatically) and it becomes available at `GET /api/agents` and
in the Agent dropdown.

## v2 highlights (feat/ui-improvements)

Four self-contained UX additions layered on top of v1 — no new npm deps.

- **i18n (English / 中文)** — self-rolled minimal i18n in
  `apps/web/src/i18n/`. Auto-detects `navigator.language`, persisted in
  `localStorage`. Switch from the chat header or Settings.
- **Collapsible sidebar** — logo + per-conversation initials in collapsed
  mode; state persisted in `localStorage`. Tooltips everywhere.
- **Remote + manual model lists** —
  `GET /api/providers/:id/models?remote=1` hits the upstream OpenAI
  `/models` endpoint and merges defaults + manual + remote. Settings
  dialog has a "Fetch models" button plus a manual list (Enter to add,
  click ✕ to remove). Persisted in `data/settings.json`.
- **Yudu Chat branding** — inline SVG `<Logo />` + `<Wordmark />` used
  in the sidebar, empty state, and tab favicon.

## v3 highlights (tool calling + multi-agent orchestration)

Resolves issue #2 (function calling) and issue #3 (multi-agent). Server-side
orchestrator plus matching UI.

- **Provider layer** — `ProviderMessage` carries `toolCalls` and `parts` so
  providers can stream tool calls; `ChatProvider.supportsTools` declares
  native tool support. `openai-compatible` and `anthropic` parse
  `delta.tool_calls[]`; the mock provider simulates a weather lookup.
- **Tool registry** — `apps/server/src/tools/` with a typed `ToolDefinition`
  + async `run` signature. Built-in tools include `get_weather` and a
  SSRF-guarded `http_fetch`.
- **Agent orchestration loop** — `routes/chat.ts` runs `runAgentTurn`:
  dispatches the turn with the resolved agent profile, executes any tool
  calls, persists `role: "tool"` results, then runs a follow-up round so the
  model can react. Chain links stream `agent_started` / `agent_finished` SSE.
- **Persistence** — `conversations.agent_id` and `messages.tool_call_ids`
  are added via idempotent `ALTER TABLE` migrations on boot.
- **Web client** —
  - `api.ts` dispatches `tool_call` / `tool_result` / `agent_started` /
    `agent_finished` via a side-channel `StreamCallbacks` argument so the
    store can fan out into UI without re-matching event types.
  - Zustand store tracks `activeToolCalls` and `activeAgentEvents`; `select
    Conversation` resets them.
  - `agent-menu.tsx` — header dropdown to pick the conversation's agent
    (PATCHes `agentId`). Highlights the current selection and offers a
    "No agent" escape hatch.
  - `activity-drawer.tsx` — right-side drawer showing the agent + tool
    timeline for the current turn, with status icons and the tool call
    arguments / result preview.
  - `composer.tsx` — `Run with tools` switch passes `useTools: true` on
    the chat request.
  - `message.tsx` — renders `role: "tool"` as a compact result strip
    and inline `tool_call` chips above the assistant text.
  - `chat-page.tsx` — adds the Activity button with badge, and a
    "by &lt;agent&gt;" attribution chip under the conversation title.

## v4 highlights (reasoning depth + thinking trace)

Adds two related capabilities on top of v3:

- **Per-conversation reasoning depth** — `Conversation.reasoningEffort` is
  persisted to SQLite; the `EffortMenu` dropdown in the header writes it
  via `PATCH /api/conversations/:id`. Resolution order is per-turn
  override (`ChatRequest.reasoningEffort`) > `AgentProfile.reasoningEffort`
  > conversation setting > unset. Each provider maps the depth onto its
  native wire shape:
  - **OpenAI-compatible** — forwards `reasoning_effort` in the request
    body and captures `delta.reasoning_content` (DeepSeek),
    `delta.reasoning` (OpenAI o*/gpt-5), or `delta.reasoning_details[]`.
  - **Anthropic** — emits a `thinking: { type: "enabled",
    budget_tokens: <1024|4096|16384|32768> }` block, drops `temperature`
    when thinking is enabled (Anthropic requires it), and lifts
    `max_tokens` to `max(4096, budget*2)` so high/xhigh don't truncate.
    Captures `thinking_delta` events as reasoning deltas.
  - **Mock** — always emits a synthetic `reasoningDelta` scaled to depth
    so the UI path is testable without a real API key.
- **Show thinking trace** — a per-conversation `showThinking` flag
  (default true) controls a Composer switch and a header icon toggle.
  Reasoning deltas are accumulated across rounds, persisted into a
  leading `reasoning` content part on the assistant message, and only
  forwarded on the SSE channel when `showThinking` is true — so the
  toggle is presentation-only and doesn't lose history.
- **Web UI** —
  - `components/effort-menu.tsx` — header dropdown with five choices
    (Default / Low / Medium / High / X-High); `updateConversationSettings`
    patches the active conversation.
  - `components/composer.tsx` — `Show thinking` switch next to `Run with
    tools`; submit forwards `reasoningEffort` + `showThinking`.
  - `components/message.tsx` — `ReasoningBlock` renders any persisted
    reasoning parts as a collapsible `<details>` (Brain icon + chevron)
    above the assistant text. Honours the conversation's `showThinking`
    flag and respects React's rules of hooks.
  - `pages/chat-page.tsx` — mounts `EffortMenu` plus an icon toggle that
    flips `showThinking` from the header.
  - `store/chat.ts` — `sendMessage` accepts the new opts; live
    `reasoning_delta` events stage a streaming `reasoning` part on the
    placeholder so the trace is visible while the model is still
    thinking.
- **Persistence + migration** — `conversations.reasoning_effort` and
  `conversations.show_thinking` columns are added via idempotent
  `ALTER TABLE` on boot. Existing rows default to NULL, which the UI
  treats as "Default depth + show thinking on".
- **Bug fix bundled** — pre-existing bug where plain text-only replies
  left the assistant placeholder row empty is fixed: the new
  final-turn persist path emits `usage` / `message` / `agent_finished`
  / `done` and writes content even without tool calls.


## v5 highlights (conversation tabs · import/export · usage)

Layered on top of v4:

- **Conversation tabs** — the conversation title region in the header is
  now a horizontal tab strip that tracks the user's *recently opened*
  sessions. A conversation becomes a tab when the user focuses it via
  the sidebar, creates a new chat, or imports a conversation; the
  active tab is highlighted and auto-scrolled into view as new tabs
  are added or removed. Each tab has a hover-revealed `×` that calls
  `closeTab`, which only removes the tab from the header strip — the
  underlying conversation is **not** deleted from the DB and stays
  available in the sidebar. To actually delete a conversation, use
  the sidebar's delete menu. The sidebar remains the catalogue of
  every persisted conversation.
- **Import / export** — every tab exposes `JSON` / `MD` / `PNG` buttons
  next to the strip; the `Import` button in the header opens a file
  picker for `.json` exports. JSON is the canonical wire format and is
  the only import path; Markdown and PNG are derived client-side from
  the same payload so the export formats never go stale.
  - **Server** — `GET /api/conversations/:id/export` returns the
    canonical `ExportedConversation` (`schema: 1`); `POST
    /api/conversations/import` mints a fresh id for both the
    conversation row and every message row, and validates the role
    whitelist, so the import never collides with existing data.
  - **Client** — `apps/web/src/lib/exporter.ts` renders the same
    payload to Markdown (text + parts, with reasoning / tool calls
    quoted) and to a PNG via a fixed-width canvas with line wrap. Both
    writers are pure functions on `ExportedConversation`; the download
    trigger is `downloadBlob(blob, filename)`.
- **Usage report** — a new `GET /api/usage` endpoint aggregates
  prompt / completion token counts across all assistant messages,
  grouped by `provider` and by `(provider, model)`. The Activity drawer
  (which now lives behind a tab bar — see the next bullet) exposes a
  second tab called `Usage` that fetches the report on open, shows the
  totals, and renders the per-provider and per-model breakdowns as
  compact tables.
- **Activity drawer fix** — `DialogContent` was rendering Radix's
  default top-right close button on top of the in-header close button,
  producing two X buttons. `DialogContent` now accepts a
  `showCloseButton` prop (default `true`); the drawer opts out so the
  header is the only close affordance and the duplicate is gone. The
  drawer also picks up the new `Activity` / `Usage` tab bar from
  `components/ui/tabs.tsx`.

## Endpoints

- `GET /api/health`
- `GET /api/providers` — returns `supportsTools` per provider
- `GET /api/providers/:id/models[?remote=1]`
- `GET /api/agents`, `GET /api/agents/:id`
- `GET /api/conversations`, `POST /api/conversations` (accepts `agentId`)
- `GET /api/conversations/:id`, `PATCH /api/conversations/:id` (accepts `agentId`),
  `DELETE /api/conversations/:id`
- `DELETE /api/conversations/:id/messages/:messageId`
- `POST /api/chat` (SSE) — accepts `useTools?: boolean`,
  `reasoningEffort?: "low" | "medium" | "high" | "xhigh"`,
  `showThinking?: boolean`. Emits `delta`, `reasoning_delta`,
  `tool_call`, `tool_result`, `agent_started`, `agent_finished`,
  `usage`, `message`, `done`, `error`.
- `POST /api/conversations` / `PATCH /api/conversations/:id` — accept
  `reasoningEffort` and `showThinking` in addition to v3 fields.
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/conversations/:id/export` — JSON download (schema 1)
- `POST /api/conversations/import` — body is an ExportedConversation
- `GET /api/usage` — token totals + per-provider / per-model buckets

## Desktop (Tauri)

The project also ships a native desktop build via [Tauri](https://tauri.app). It
re-uses the existing `apps/web` and `apps/server` workspaces without forking them.

Layout (added):

```
apps/desktop/
  src-tauri/         Rust shell + Tauri config + capabilities
    src/lib.rs       starts/stops the sidecar, registers commands
    src/commands.rs  IPC commands (server_status, open_external, …)
    src/state.rs     sidecar child handle
    capabilities/    Tauri permission set
    icons/           placeholder icons (replace with your own)
    binaries/        yudu-server-<triple> sidecar binaries (gitignored output)
  scripts/
    bundle-server.mjs  esbuild + @yao-pkg/pkg pipeline
  src/              minimal Tauri entry (status panel) for dev-mode preview
```

### One-time setup

1. Install the Rust toolchain (`rustup` from <https://rustup.rs>) and on macOS,
   the Xcode Command Line Tools (`xcode-select --install`). Tauri 2 needs
   `rustc ≥ 1.77`.
2. `pnpm install` (from repo root) — pulls the Tauri CLI, plugins and esbuild.

### Develop (web UI hot-reload + native shell)

```bash
pnpm dev:desktop          # opens a Tauri window; vite + Fastify still run separately
pnpm dev:web              # terminal A — vite dev server
pnpm dev:server           # terminal B — Fastify on 127.0.0.1:8787
```

In `tauri dev` the Rust shell starts but **does not** auto-spawn the sidecar
(it expects you to run `pnpm dev:server` so you can edit server code with HMR).
The web UI inside the window talks to `http://127.0.0.1:8787/api`.

### Build a release app

```bash
pnpm build:desktop
```

This runs, in order:

1. `apps/web` build → `apps/web/dist`
2. `apps/server` build → esbuild CJS bundle → `@yao-pkg/pkg` SEA → `apps/desktop/src-tauri/binaries/yudu-server-<triple>`
3. `tauri build` → `apps/desktop/src-tauri/target/release/bundle/{dmg,msi,deb,…}` plus the launcher binary

The bundle embeds the sidecar and the SQLite native binding; user data
(conversations, providers, settings) lives in the OS-standard `app_data_dir`
(macOS: `~/Library/Application Support/com.yudu.chat/`).

### Cross-compiling

`bundle-server.mjs` reads `process.platform` + `process.arch`, so build on each
target host. For Linux→Windows or similar, run the same command inside a
Docker container or CI runner with the matching toolchain.

### How the sidecar finds `better-sqlite3`

`better-sqlite3` ships a native binding that can't be statically embedded into a
pkg/SEA binary. The bundler (1) copies the `.node` binding into
`apps/server/dist-server/native/` and (2) adds it as an `assets` entry so pkg
keeps it on disk. The bundle's banner detects `process.pkg`, extracts the
binding to `os.tmpdir()`, and rewrites `Module._resolveFilename` + `Fs.statSync`
so `require('bindings')('better_sqlite3.node')` resolves to that extracted file.
