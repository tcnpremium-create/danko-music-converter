# Security Policy

Danko Music Converter is **local-first**. Your audio files and library stay on
your machine; the app works fully offline for all local features.

## Design principles

- **No telemetry, no silent uploads.** Audio is never sent to a remote server
  without an explicit, user-initiated action.
- **No secrets in the repository.** The app needs no server credentials. The
  optional Spotify *metadata-only* import uses desktop OAuth with **PKCE**
  (public Client ID, **no client secret**). Any token obtained is stored
  encrypted via the OS keychain (Electron `safeStorage`) outside the repo.
- **Scoped automation.** The optional MCP server (see `mcp/`) exposes only
  audio/library tools. It is **not** a generic gateway to the computer: there
  is no "run arbitrary command", "read any file", or "delete any folder" tool,
  and destructive operations require explicit confirmation.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use
GitHub's **private vulnerability reporting** (Security → *Report a
vulnerability*) on this repository. We aim to acknowledge within 72 hours.

When reporting, include: affected version, platform, reproduction steps, and
impact. Please do not include real secrets or personal data in the report.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | ✅        |

## If you find a leaked secret

If you believe a credential was ever committed (historically or otherwise),
report it privately and **rotate/revoke** the credential immediately. This
project ships `.env.example` with variable *names only* — never real values.
