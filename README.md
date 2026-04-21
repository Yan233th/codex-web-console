# codex-web-console

Minimal local-first web console for Codex.

## Development

```sh
bun install
bun run dev
```

## Auth

Set a single access token before starting, or copy `.env.example` into your own env setup:

```sh
export CODEX_WEB_CONSOLE_TOKEN=your-token
```

The landing page accepts exactly one token and stores a signed-in cookie locally.

In development, if the variable is missing, a fallback token is enabled:

```text
codex-web-console
```

## Build

```sh
bun run build
```

## Notes

- Initial version is local-only
- Codex must be available in `PATH`
- The UI talks to a single local `codex app-server`
