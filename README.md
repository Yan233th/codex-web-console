# codex-web-console

[English](README.md) | [简体中文](README.zh-CN.md)

Minimal local-first web console for Codex.

Published package: https://www.npmjs.com/package/codex-web-console

## Current Scope

- Local-only: talks to a single local `codex app-server`
- Single-token auth: one login field, one access token
- Thread list across all local providers
- URL-addressable threads: `/` opens a new thread, `/?thread=<id>` opens an existing one
- Live timeline updates over SSE
- Workspace browser for choosing a local directory
- Approval handling for command, file-change, and permissions prompts
- Turn controls: stop the current turn, jump to previous/next historical turn

This project is intentionally narrow. It does not implement users, remotes, or a second session system on top of Codex threads.

## Development

```sh
bun install
bun run dev
```

## Quick Start

Start the console with npx:

```sh
npx codex-web-console
```

Options:

```sh
npx codex-web-console --host 127.0.0.1 --port 3000 --no-open
```

For local testing from this repository:

```sh
bun run build
npx . --no-open
```

## Auth

Set a single access token before starting, or copy `.env.example` to `.env`:

```sh
export CODEX_WEB_CONSOLE_TOKEN=your-token
```

SvelteKit loads `.env` automatically in development. A value exported in your
shell takes precedence over the same key in `.env`.

The landing page accepts exactly one token and stores a signed-in cookie locally.

In development, if the variable is missing, a fallback token is enabled:

```text
codex-web-console
```

## Build

```sh
bun run build
```

## Requirements

- Bun must be available in `PATH`
- Codex must be available in `PATH`
- The UI starts and talks to a single local `codex app-server`
- The configured token is required outside development

## Notes

- Threads are listed via the app-server with `modelProviders: []`, so the sidebar includes threads across providers.
- Some reasoning content is available live but not fully restored by `thread/read`; the UI preserves it during the current browser session for continuity.
- The current version focuses on the single-machine path and keeps the architecture thin on purpose.
