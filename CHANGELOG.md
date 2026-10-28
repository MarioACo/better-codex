# Changelog

**English** · [Español](CHANGELOG.es.md)

## Unreleased

Found by testing against real Codex 0.164 (VS Code extension, Windows):

- **Guard**: a yes to a question Codex asked on its own no longer needs a second confirmation. It covers only the command or the paths that question showed. Codex now writes out the command with literal paths when it asks.
- **Verify gate**: `npm.cmd test`, `node.exe --test` and the like count as checks. Before, Codex ran the tests a second time.
- **Repo brief**: on Windows it tells Codex to use `npm.cmd`, because PowerShell often blocks `npm.ps1`. If `rg` isn't installed, it says to search with `git grep -n`. Each of these was a failed call in every session.
- **Install**: prints the exact command to open Codex and trust the hooks (`--no-daemon` for the CLI that ships with the desktop app). It no longer mistakes `[hooks.state]` in `config.toml` for a second set of hooks.
- **doctor / log**: they say what's actually missing, and tell "allowed" apart from "ran".
- **Docs**: README, contributing guide, security policy and changelog in English and Spanish. The README adds a real session example and a troubleshooting section.

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
