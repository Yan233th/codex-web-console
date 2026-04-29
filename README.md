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

## Release

CI runs on every push to `main` and every pull request:

```sh
bun run check
bun run build
```

CD uses `semantic-release` on `main` to publish to npm and create a GitHub release.
Versioning follows Conventional Commits:

- `feat:` -> minor release
- `fix:` -> patch release
- `perf:` and `refactor:` -> patch release
- `feat!:` / `fix!:` / `BREAKING CHANGE:` -> major release

Automatic releases on `main` use `semantic-release` plus npm trusted publishing (OIDC) when configured on npm.
Manual `workflow_dispatch` runs do not use commit analysis. They publish the current `package.json` version directly to npm.
For manual runs, you can choose:

- `oidc`: publish via npm trusted publishing
- `npm-token`: publish via the `NPM_TOKEN` GitHub secret as a fallback

Manual runs also accept an `npm_tag` input such as `latest` or `next`.
Make sure you bump `package.json` first, because the workflow will fail if that version already exists on npm.

Before enabling manual token-based publishing, add this GitHub Actions secret:

```text
NPM_TOKEN
```

The npm token needs publish permission for the `codex-web-console` package.

## Requirements

- Bun must be available in `PATH`
- Codex must be available in `PATH`
- The UI starts and talks to a single local `codex app-server`
- The configured token is required outside development

## Notes

- Threads are listed via the app-server with `modelProviders: []`, so the sidebar includes threads across providers.
- Some reasoning content is available live but not fully restored by `thread/read`; the UI preserves it during the current browser session for continuity.
- The current version focuses on the single-machine path and keeps the architecture thin on purpose.
