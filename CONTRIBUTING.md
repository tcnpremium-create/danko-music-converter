# Contributing to Danko Music Converter

Thanks for your interest in improving Danko Music Converter! Contributions of
all kinds are welcome — bug reports, features, docs, and tests.

## Getting started

```bash
git clone https://github.com/tcnpremium-create/danko-music-converter.git
cd danko-music-converter
npm install
npm run dev        # launch the app in development
```

Requirements: **Node.js 20+** and npm. FFmpeg is fetched/bundled automatically
for packaging; for local dev the app looks for FFmpeg on your PATH or the
`DANKO_FFMPEG` env var.

## Development workflow

Before opening a pull request, make sure the full gate passes:

```bash
npm run typecheck   # TypeScript, no emit
npm test            # Vitest unit + integration
npm run build       # main + preload + renderer
npm run e2e         # headless Electron smoke
```

- Keep changes focused; one logical change per PR.
- Match the existing code style (TypeScript, 2-space indent, Spanish inline
  comments are fine — the codebase mixes EN/ES).
- Add or update tests for behavior changes.
- Never commit secrets or a real `.env`. Use `.env.example` for new variables.

## Commit messages

Use clear, conventional-style prefixes where possible:
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `ci:`, `chore:`.

## Branches & PRs

1. Branch from `main`: `git checkout -b feat/my-change`.
2. Push and open a PR against `main`.
3. Fill in the PR template; link any related issue.
4. CI (lint/typecheck/test/build) must be green before merge.

## Reporting bugs / requesting features

Open an issue using the templates under `.github/ISSUE_TEMPLATE/`. For security
issues, follow [SECURITY.md](./SECURITY.md) instead (private reporting).

## Code of conduct

Be respectful and constructive. We want a welcoming community for DJs,
producers, developers and music lovers alike.
