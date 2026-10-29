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
- **Benchmark** (`bench/`): the same four tasks with plain Codex and with better-codex, in fresh copies of a small repo, graded by checks Codex never sees. The results are in the README; run it yourself with `node bench/run.mjs`.
- **doctor asks Codex itself** (the app server's `hooks/list`, the same list `/hooks` shows) whether the five hooks are loaded and trusted, and points out the ones that changed since you trusted them. It also says when your Codex is newer than the last version tested (`codexTested` in package.json), when Codex stops sending a field the hooks read (a change in its hook format), and when an `AGENTS.override.md` hides the rules.
- **Real Codex in CI** (`scripts/codex-compat.mjs`): on Linux, macOS and Windows, with the tested and the latest Codex, every week and on every change. No login and no model calls: it checks that Codex loads the rules, the skills and the five hooks, and runs each hook in that system's shells. If a new Codex breaks it, the weekly run opens an issue.
- **Guard: `tmp/`, `build/` and `dist/` are checked, not trusted by name.** They were always fine to delete, so the hook let `rm -rf tmp` through even with uncommitted notes inside (found reviewing the benchmark: there the rules made Codex ask, the hook never fired). Now they go only when git shows nothing of yours inside; `node_modules`, caches and logs still go without asking.
- **Guard: your aliases and functions.** If your PowerShell profile, `.bashrc` or `.zshrc` (or a file they source) says `nuke` is `rm -rf`, `nuke tmp` is now checked as `rm -rf tmp`, with the alias named in the message. Codex runs PowerShell with your profile loaded, so these ran unchecked before (raised on Reddit). Profiles are read as text; `bcx doctor` lists what it found.
- **Benchmark**: `asked` also counts "Confirm that I should run…" and "Reply **approve**…", not only answers with a question mark. Recomputed for the published run: Codex asked 3/3 times in the cleanup task, not 1/3.
- **Issue forms** in English and Spanish (bug, guard mistake, idea) that ask for the `bcx doctor` output, and a PR checklist.
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
