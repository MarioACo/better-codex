# Security

**English** · [Español](SECURITY.es.md)

## What the guard protects against, and what it doesn't

The guard protects you from **the mistakes of a cooperative agent**: one `rm -rf` too many, a `reset --hard` over your uncommitted work, a `push --force` to main, or reading a `.env` whose contents then travel to the model.

It inspects every command and patch before it runs, including:

- code-mode scripts;
- PowerShell `{ }` blocks;
- piped commands;
- `.ps1` and `.sh` scripts;
- `package.json` scripts;
- code that Codex wrote earlier in the session and then runs;
- your shell aliases and functions (`nuke tmp` when `nuke` is `rm -rf`), on macOS and Linux also the ones plugins like oh-my-zsh create, from Codex's shell snapshot;
- base64 it can decode (`-EncodedCommand`, `base64 -d`). Text built at runtime (`eval "$CMD"`, `… | bash`) asks first.

**It is not a sandbox, and it does not protect against a malicious agent.** It reads command text with heuristics, so a sufficiently indirect program can get past it. Use it alongside Codex's sandbox and approvals, not instead of them. Strict mode (`bcx config set strict on`) fails closed instead: what it doesn't recognize asks. It still reads command text, so it doesn't replace the sandbox either.

## Your data

Everything runs on your machine, and better-codex makes no network calls. It keeps its state and metrics in `~/.codex/better-codex/`:

- **Per-session state**: the last prompt you sent and Codex's last reply. It's used to tie a "yes" to the question it answers, and it's deleted after 7 days.
- **Your shell profiles** (PowerShell profile, `.bashrc`, `.zshrc` and the files they source in your home) are read as text to expand your aliases. Nothing in them runs and nothing from them is stored. On Windows it remembers where your Documents folder is (`shell.json`).
- **Codex's shell snapshot** (`~/.codex/shell_snapshots/`, macOS and Linux) is read as text, like your profiles, for its aliases and functions. Nothing from it is stored.
- **`bcx allow` rules** (`allow.json`): each repo's path and the actions you allowed there. They're kept outside your repos so a repo you clone can't grant itself permissions, and the guard stops Codex from changing them.
- **Copies for `bcx undo`**: before an action you approved, the files it would delete or overwrite go to `~/.codex/better-codex/undo/`, and that can include a `.env`. For git commands the snapshot is also stored as git objects under `refs/bcx/undo/` in your repo. They stay on your machine: `git push` doesn't send those refs, but `git push --mirror` would, and the guard asks before that. Only the last 20 copies from the last 14 days are kept. `bcx config set undo off` turns it off.
- **The relay** (`relay/`, one file per repo): when a session passes 80% of its context, its last requests (trimmed to 300 characters), the files it changed, its last check and Codex's last answer, for the next session in that repo. Given once and kept 3 days.
- **Learned fixes** (`fixes.json`): which missing program was replaced by which variant on this machine (`python` → `py`). **Approval counts** (`approvals.json`): how many times you approved each action per repo, for the `bcx allow` hint.
- **Metrics** (`events.jsonl`): no prompts. They do record the commands the guard stopped or allowed and the paths the diet skipped, trimmed to 160 characters. The file rotates at 2 MB, and `BCX_NO_METRICS=1` turns metrics off.

## Supported versions

Fixes go into the latest version. Update with `npx @marioaco/better-codex@latest install` (in a clone: `git pull` and `node bin/bcx.js install`).

## Reporting a gap

If you find a destructive command the guard lets through, or a harmless one it stops for no reason:

1. Check what it decides today with `bcx guard "<command>"`.
2. [Open an issue](https://github.com/MarioACo/better-codex/issues) with the command (no private data), what you expected and what happened.

**For a gap that lets something serious through without asking** (deleting data, leaking secrets), please report it privately first, with the **Report a vulnerability** button in the repository's **Security** tab, rather than in a public issue.
