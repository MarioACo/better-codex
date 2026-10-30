# Changelog

**English** · [Español](CHANGELOG.es.md)

## 0.3.0 — 2026-10-29

More efficient, safer, better answers:

- **Relay** (efficiency). Past 80% of the context, better-codex writes down where the work stands, without the model: the requests, the files changed, the last check and Codex's last answer. The next session in that repo gets it once in its brief. In the author's sessions, the few that ran past 70% of the context took 79% of all input tokens.
- **Commands fixed before they run** (efficiency). On Windows `npm`, `npx`, `pnpm` and `yarn` become `.cmd`, because PowerShell blocks the `.ps1`. That call failed in every session; verified live, Codex now runs `npm.cmd --version` and gets the version. `npm install` runs with `--no-audit --no-fund`, and a missing program replaced by a known variant (`python` → `py`) is remembered. Codex applies the change only with `allow`, and in Codex that `allow` just carries the new input: its approvals and sandbox are evaluated again for the corrected command.
- **Where things are defined** (efficiency). Functions and classes named in the prompt come with their definition (`calcularTotal → src/tax.js:12`), from one `git grep` (~50 ms).
- **Review of the diff before finishing** (better answers). Without the model: `debugger`, `pdb.set_trace()`, debug prints, `.only`/`.skip` in tests, conflict markers and new TODOs that the change added send Codex back once.
- **Tests of what changed first** (better answers, efficiency). The verify gate asks for the tests of the changed files (`src/cart.js` → `node --test test/cart.test.js`) before the full suite.
- **MCP tools in the guard** (safety). Destructive SQL through a database server, and tools that delete, merge, push, publish, deploy, pay or send messages, ask first. Reading passes. **`hooks.json` changes: trust the hooks again once in `/hooks`.**
- **`bcx undo` for more**: the old value of a `git config --global` key or a Windows user variable, `~/.npmrc`, and local SQLite databases before an approved `DROP` or reset.
- **`bcx allow` offered** the third time you approve the same action in a repo.
- **Install**: the command it prints to open Codex adds `--no-daemon` for the CLI inside the editor extensions too. Since the VS Code extension 26.1021 it fails without it ("this CLI has no complete local package"), like the desktop app's.
- **Benchmark, 0.3.0** (3 tasks × 3 runs, Codex closed during the runs): a production Dockerfile done right 0/3 → 3/3 (plain Codex left out the `.dockerignore` every time); a migration on a table with data at half the input and requests and 134 s → 42 s; the slow test suite 171K → 63K input tokens. Average input −40%, uncached −33%, requests −33%.

Infrastructure, databases, DevOps and strict mode:

- **Guard: infrastructure secrets.** Reading Terraform state (`terraform.tfstate` keeps passwords in plain text), `.tfvars`, kubeconfig, `.pgpass` or Docker's `config.json` now asks first, and so do commands that print secret values: `kubectl get secret -o yaml`, `terraform output -json`, `terraform state pull`, `aws secretsmanager get-secret-value`, `gcloud secrets versions access`, Vault, 1Password, Doppler, Heroku.
- **Guard: production clusters.** `kubectl apply/patch/scale/rollout…` and `helm install/upgrade/rollback` aimed at production (by `--context`, `--kube-context`, the namespace or kubectl's current context) are critical. A `--dry-run` and other contexts are fine. `terraform state rm/mv/push`, `force-unlock`, `taint` and `docker push` ask too.
- **Repo brief: infrastructure and databases.** It names the Dockerfiles, the Compose services (Postgres, Redis…), Terraform, Kubernetes, Helm, GitHub Actions, Prisma and the migration folder of each common tool, and the checks Codex can run for them with the tools installed on your machine.
- **Verify gate: infrastructure checks.** A changed `.tf`, Dockerfile, Compose file, Helm chart, Kubernetes manifest, workflow or Prisma schema has to be checked with its own tool before Codex finishes (`terraform validate`, `docker build --check`, `docker compose config`, `helm lint`, `kubectl kustomize`, actionlint, `prisma validate`), only if that tool is installed. A failed check is read from its output.
- **Playbooks by area**: databases, infrastructure as code, containers and Kubernetes, CI/CD, security and UI, from the words in the prompt and the files it names, once per session.
- **Skills**: `$bcx:ci` fixes a failing pipeline from the failed step's log; `$bcx:migrate` changes a schema with a new, reversible migration tested locally.
- **Images**: the rules tell Codex to view images at the default detail, one or two at a time. In the author's last 30 days, the 60 largest tool outputs were all images viewed at `detail: "original"`.
- **Benchmark**: two new tasks, a migration on a table with data and a production Dockerfile.
- **Strict mode** (`bcx config set strict on`, raised on Reddit: "security shouldn't be fully heuristic"). Only known read-only commands, git and gh queries, tests, builds, linters and infra checks run without asking; anything else asks, including what the list doesn't recognize. Real risks are still reported first. `bcx audit --strict` shows what it would ask, grouped by command; `bcx allow "git commit"` lets one kind of command through in one repo. On the author's last 30 days: 24% of commands would ask, against 2% without it. Off by default, and Codex can't turn it off.

## 0.2.0 — 2026-10-29

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
- **Guard: commands that hide what they run.** `powershell -EncodedCommand`, `echo … | base64 -d | bash` and `exec(b64decode(…))` went through, even when the base64 was `rm -rf src` (raised on Reddit). Base64 is now decoded and checked like any other command. `eval "$CMD"`, `iex $script`, `sh -c "$(…)"` and other output piped into a shell ask first, because what they run is only known when they run. `sh -c "$(curl …)"` counts as running a downloaded script. Setup lines such as `eval "$(ssh-agent -s)"` don't ask. Replaying the author's last 30 days (1721 commands), this added one question.
- **`bcx undo`**: before an action you approved runs, a copy of what it can destroy. For deletes and overwrites that means the files; for git commands it means your uncommitted work, untracked files and every branch and stash, kept as a commit under `refs/bcx/undo/` without touching your index. `git clean -fdx` copies what `git clean -n` says it would remove, ignored `.env` included. `bcx undo 1` puts it back. It never replaces a file that exists again unless you pass `--overwrite`, and it saves the state before undoing too. Codex mentions the copy when it asks, and a line confirms it. Limits: 100 MB per copy, the last 20 copies from 14 days. Measured in a real repo on OneDrive: 441 ms for a git snapshot, 32 ms to copy 26 files.
- **`bcx allow`**: what the guard keeps asking about but is always fine in one repo (`bcx allow "rm -rf generated/"`). A folder covers what's inside it; other actions are allowed exactly as written. The stop message suggests the command. The rules live in `~/.codex/better-codex/allow.json`, outside every repo, so a cloned repo or a pull request can't grant itself anything.
- **Guard: better-codex's own settings.** Codex running `bcx allow`, `bcx config set guard off` or `bcx uninstall`, or writing `allow.json`, `config.json` or `~/.codex/hooks.json`, now asks first. Before, Codex could switch the guard off with one command.
- **Guard: aliases from oh-my-zsh and other plugins.** On macOS and Linux, Codex keeps a snapshot of your shell after it starts (`~/.codex/shell_snapshots/<session>.*.sh`, bash and zsh). The guard reads this session's snapshot, so `grhh`, `gpf` or `ggf` from oh-my-zsh are checked for what they run. The format was taken from Codex's source (`codex-rs/shell-command/src/shell_snapshot_capture.rs`). Names like `gc!` and values with `'\''` are read correctly too.
- **npm**: `npx @marioaco/better-codex install`, no clone needed. Hooks and skills run from the installed copy, never from npx's cache. (`better-codex` on npm is someone else's project.)
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
