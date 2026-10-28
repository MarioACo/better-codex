# Changelog

**English** · [Español](CHANGELOG.es.md)

## Unreleased

Found by testing against real Codex 0.164 (VS Code extension, Windows):

- **Guard**: a yes to a question Codex asked on its own no longer needs a second confirmation. It covers only the command or the paths that question showed. Codex now writes out the command with literal paths when it asks.
- **Verify gate**: `npm.cmd test`, `node.exe --test` and the like count as checks. Before, Codex ran the tests a second time.
- **Repo brief**: on Windows it tells Codex to use `npm.cmd`, because PowerShell often blocks `npm.ps1`. If `rg` isn't installed, it says to search with `git grep -n`. Each of these was a failed call in every session.
- **Install**: prints the exact command to open Codex and trust the hooks (`--no-daemon` for the CLI that ships with the desktop app). It no longer mistakes `[hooks.state]` in `config.toml` for a second set of hooks.
- **doctor / log**: they say what's actually missing, and tell "allowed" apart from "ran".
- **Install and doctor know when you already trusted the hooks** (from Codex's trust records in `config.toml`). `install` only asks you to trust them again when they actually changed, and `doctor` shows `trusted 5/5`.
- **Slow commands**: better-codex times every command. One that took over 30 s is pointed out to Codex once and remembered per repo, and the next session's brief lists it, so Codex runs it and waits for it inside one call. Live, on a 75 s test run: 5 requests → 2, input tokens −60%. `bcx stats` shows the share of input spent polling (27% across the author's sessions).
- **Rules for Codex**: put independent reads in one call, and run and poll long commands inside one `exec` instead of separate waits.
- **Verify gate checks the result**: if the last check after an edit failed (node:test, Jest, Vitest, Mocha, pytest, Go, Cargo, tsc, ESLint, Gradle, Maven, .NET, Karma, Angular, npm) and Codex's answer doesn't say so, it sends Codex back once to fix it or say it.
- **Faster hooks**: the guard only asks git for the repo root when a rule needs it, and the session remembers it: about half of better-codex's own time per command.
- **macOS and Windows paths**: the guard recognized Codex's own changes only when the path was spelled exactly like git spells it. On macOS (`/var` → `/private/var`) and with Windows short names (`C:\Users\RUNNER~1`) it asked about them as if they were the user's. Paths are now compared after resolving them.
- **Install never leaves broken hooks**: it checks that the copied app is really there and stops with a clear error otherwise. It used to fall back silently, which on the Windows CI left hooks pointing at a missing file for a home folder with spaces and accents.
- **Finds Codex inside editor extensions**: `install` looks for the complete CLI shipped in the OpenAI extension for VS Code, VS Code Insiders, Cursor and Windsurf. People with only the extension now get the skills and a working command to open `/hooks` (no `--no-daemon`). The README says where better-codex works (CLI, extension, desktop app, WSL) and where it doesn't (Codex Cloud).
- **Docs**: README, contributing guide, security policy and changelog in English and Spanish. The README adds an animated demo of a real session (`scripts/demo-svg.mjs`), a troubleshooting section and a tip for turning off the skills of plugins you don't use.

## 0.1.0 — 2026-10-27

First release.

- **Hooks**: repo brief at session start, prompt modes (`+`, `quick:`, `ask:`, `plan:`) and per-task playbooks, suggested paths, token diet, huge-output warning, verify gate, and a context and rate-limit meter.
- **Guard**: stops these actions, also inside scripts, `package.json`, pipes and PowerShell blocks. An approval covers that action, in that turn.
  - unrecoverable deletes;
  - discarding uncommitted work;
  - history rewrites;
  - secrets;
  - databases;
  - infrastructure;
  - killing programs by name;
  - global configuration;
  - system changes.
- **Skills** (`bcx` plugin): `$bcx:commit`, `$bcx:refine`, `$bcx:handoff`, `$bcx:debug`.
- **CLI**:
  - `install` (stable copy in `~/.codex/better-codex/app`, with backups) and `uninstall`;
  - `doctor` (runs the hooks through your shells and shows what Codex actually sent);
  - `stats`, `usage`, `audit`, `log`, `brief`, `try`, `guard`, `config`.
