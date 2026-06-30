# Yudu Chat UI

A personal AI chat workspace with a Vite + React + TypeScript + shadcn/ui front end
and a Fastify + TypeScript + SQLite back end. Multi-provider (OpenAI-compatible and
Anthropic), SSE streaming, persistent conversations, and a built-in mock provider
so you can try the UI before you bring your own API key.

## Layout

```
apps/
  server/          Fastify + Drizzle + SQLite (better-sqlite3)
  web/             Vite + React 18 + shadcn/ui + Zustand + react-markdown
packages/
  shared/          Cross-package TypeScript types
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
to use, and start chatting.

## Providers

Out of the box:

- `openai` — OpenAI (default base URL `https://api.openai.com/v1`)
- `anthropic` — Anthropic Messages API
- `deepseek` — DeepSeek
- `ollama` — Local Ollama (`/v1`)
- `custom` — Any OpenAI-compatible endpoint
- `mock` — Offline echo provider, handy for UI development

Add new providers by registering a `ChatProvider` in
`apps/server/src/providers/registry.ts`.

## Features

- Streaming SSE chat (`POST /api/chat`) with `delta` / `usage` / `message` / `done`
  events and abort-to-stop from the UI
- Persistent conversations in SQLite via Drizzle; sidebar list, rename, delete
- Message-level actions: copy, delete, regenerate, edit-and-resubmit
- Per-conversation provider, model, system prompt and temperature
- Markdown rendering with code highlighting (highlight.js)
- Light / dark / system theme
- Provider + base URL settings persisted to `apps/server/data/settings.json`

## Endpoints

- `GET /api/health`
- `GET /api/providers`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/:id`, `PATCH /api/conversations/:id`,
  `DELETE /api/conversations/:id`
- `DELETE /api/conversations/:id/messages/:messageId`
- `POST /api/chat` (SSE)
- `GET /api/settings`, `PUT /api/settings`
