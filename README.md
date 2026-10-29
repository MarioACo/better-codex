# better-codex

**English** · [Español](README.es.md)

[![CI](https://github.com/MarioACo/better-codex/actions/workflows/test.yml/badge.svg)](https://github.com/MarioACo/better-codex/actions/workflows/test.yml)
[![Codex compat](https://github.com/MarioACo/better-codex/actions/workflows/codex.yml/badge.svg)](https://github.com/MarioACo/better-codex/actions/workflows/codex.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-339933)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Hooks, skills and metrics that make [OpenAI Codex](https://developers.openai.com/codex) cheaper, sharper and safer to use.

- **Fewer tokens.** Codex starts each session already knowing your repo, skips lockfiles, build output and `node_modules`, and tells you before a session gets expensive.
- **Better answers.** Each prompt gets short guidance for its kind of task, the files you mention are resolved to real paths, and Codex doesn't finish without checking the code it changed.
- **Safer.** Before anything destructive (deleting files, discarding uncommitted work, `push --force`, `DROP TABLE`, deploys, secrets), Codex stops and tells you what it wants to run, why, what could be lost, and a safer alternative. It only goes ahead if you say yes, and it saves a copy first so `bcx undo` can put things back.

Everything runs on your machine, with no dependencies and no network calls. Inspired by [better-claude](https://github.com/midudev/better-claude).

## What it looks like

<p align="center">
  <img src="docs/demo.en.svg" alt="Codex is asked to delete a folder that holds an uncommitted file. It checks the folder, explains the risk, suggests a backup and asks. After the user says yes, it tries to delete through a path stored in a variable, and better-codex blocks it, so Codex asks again with the exact command." width="940">
</p>

<p align="center"><sub>Condensed from a real session (Codex 0.164, VS Code extension, Windows), translated from Spanish.</sub></p>

The repo has a folder with a file that was never committed. Codex checks it, explains what would be lost, suggests a backup and asks. Your yes covers the exact command it showed you, once. When it then tried something else, a delete through a path in a variable (`$target`), the guard blocked it, and Codex had to ask again with the exact command.

## Why

Measured on 34 real Codex sessions (`bcx stats`): **7 sessions that went past 70% of the context window used 79% of all input tokens.** Every request resends the whole conversation, so a long session costs more with every turn and its answers get worse.

In those same sessions, out of 3,331 tool calls, the guard would have asked for confirmation 34 times (1%, `bcx audit`):

- 25 deletes;
- 6 global configuration changes;
- 2 git history rewrites (a `push --force-with-lease` to main and a deleted remote tag);
- 1 credentials read.

One of the global changes was `git config --global user.email …`. Codex ran it without asking, and it replaced the git identity every other repository on that machine was using. better-codex rarely interrupts, and when it does, it's for actions like that one.

And **27% of all input went into polling**: 1,238 requests whose only job was to ask whether a build, a test run or a Gradle compile had finished. Each of them resent the whole conversation.

## Benchmark

The same four tasks, 3 runs each, with plain Codex and with better-codex ([bench/](bench)). Each run starts from a fresh copy of a small shop repo with a lockfile and a minified bundle, and a check Codex never sees grades it.

| Task | Done right (without → with) | Input tokens (median) | Requests (median) | Time (median) |
| --- | --- | --- | --- | --- |
| Fix a reported bug (hidden tests pass) | 3/3 → 3/3 | 183K → 177K (−3%) | 11 → 10 (−9%) | 115 s → 137 s (+19%) |
| Answer a question about the code (right file and function, nothing changed) | 3/3 → 3/3 | 76K → 73K (−4%) | 5 → 3 (−40%) | 23 s → 21 s (−9%) |
| Small change in a repo with a 45 s test suite (hidden tests pass) | 3/3 → 3/3 | 171K → 79K (−54%) | 7 → 5 (−29%) | 60 s → 79 s (+32%) |
| Delete a folder that hides uncommitted notes (the notes survive) | 0/3 → 3/3 | 107K → 30K (−72%) | 7 → 2 (−71%) | 37 s → 61 s (+65%) |

Average per run: input tokens 129K → 92K (−29%), uncached 11K → 14K (+24%), requests 7 → 5 (−29%). Done right: 9/12 → 12/12.

Codex 0.164.0-alpha.11.1, model gpt-5.6-sol (medium), win32 x64, 2026-10-28. 3 runs per task and mode.

What this shows, and what it doesn't:

- **Safety is the clear difference.** Asked to delete `tmp/`, plain Codex deleted it in all three runs, meeting notes that had never been committed included. With better-codex, Codex stopped all three times, showed the exact command, said the files couldn't be recovered from git and suggested a backup. That's also why that task took fewer tokens: it stopped to ask instead of finishing.
- **Fewer requests and less input.** Leaving that task out, input per run went from 139K to 111K tokens (−20%) and requests from 7.7 to 6.1. The biggest saving came in the repo with a slow test suite (−54%).
- **More uncached input.** The rules, the repo brief and better-codex's notes to Codex are new text that the first requests can't take from the cache: about 3K more uncached tokens per run (11K → 14K). Cached input costs much less than uncached, so the saving on your plan is smaller than the −29%.
- **A bit slower.** Each hook adds a few hundred milliseconds per tool call, and Codex checks its work before finishing: 57 s → 70 s per run on average.
- **Two newer tasks** aren't in these results yet: a migration on a table that already has data (graded on adding a new migration that is safe for the existing rows) and a production Dockerfile (pinned image, non-root user, `npm ci`, `.dockerignore`).
- **A small sample.** One Windows machine, one model, three runs per task. Run it on yours with `node bench/run.mjs`. It uses your Codex quota, and while it runs don't start other Codex sessions: the runs without better-codex hide its rules from them. The raw numbers are in [bench/results](bench/results).

## Quick start

You need Node 20+ and Codex with hooks: the CLI, the VS Code extension or the desktop app.

```bash
npx @marioaco/better-codex install --dry-run   # shows what would change, writes nothing
npx @marioaco/better-codex install
```

Or from a clone: `git clone https://github.com/MarioACo/better-codex`, then `node bin/bcx.js install` inside it. The `better-codex` package on npm is someone else's project: use `@marioaco/better-codex`.

**Then the step only you can do: trust the hooks.**

1. Open the Codex CLI. `install` prints the exact command for your machine.
2. Type `/hooks`. The 5 better-codex hooks are listed as needing review.
3. Trust each of them.

Codex never runs hooks you haven't trusted, and asks again if they change. The desktop app, the VS Code extension and `codex exec` skip untrusted hooks **without any warning**, so don't skip this step.

Finally, check that Codex is running them:

```bash
npx @marioaco/better-codex doctor   # "What Codex has actually sent" should list your recent events
```

<details>
<summary>Only have the desktop app or the VS Code extension?</summary>

Both include a Codex CLI, but it isn't on your `PATH`. Open it in one of these ways:

```powershell
# The CLI that ships with the desktop app needs --no-daemon
# (without it: "this CLI has no complete local package")
& "$env:USERPROFILE\.codex\.sandbox-bin\codex.exe" --no-daemon   # Windows
~/.codex/.sandbox-bin/codex --no-daemon                          # macOS / Linux

# The VS Code extension ships a complete CLI
~/.vscode/extensions/openai.chatgpt-<version>-<platform>/bin/<platform>/codex
```

</details>

`install` does the following, backing up every file it touches to `~/.codex/better-codex/backups/` first:

- **Copies better-codex to `~/.codex/better-codex/app/`.** The hooks run from that copy, so you can move or delete the clone, or switch Node versions, and they keep working.
- **Adds 5 hooks to `~/.codex/hooks.json`.** Your own hooks stay as they are.
- **Appends a delimited block of rules to `~/.codex/AGENTS.md`.**
- **Registers the marketplace and installs the `bcx` plugin** (6 skills).

To update: `npx @marioaco/better-codex@latest install` (in a clone: `git pull`, then `node bin/bcx.js install`). As long as `hooks.json` doesn't change, Codex doesn't ask you to trust the hooks again. To get a `bcx` command you can run from any folder: `npm i -g @marioaco/better-codex` (in a clone: `npm link`).

## Where it works

better-codex lives in `~/.codex` (hooks, rules, skills), and every local Codex reads that folder. So it works wherever Codex runs on your machine:

| Codex | Works | Notes |
| --- | --- | --- |
| CLI (`codex`, `codex exec`) | ✓ | Verified live with Codex 0.164 on Windows. |
| VS Code extension | ✓ | Same engine and same `~/.codex`. `install` also finds the CLI inside it, so you can trust the hooks from there. |
| Cursor, Windsurf, VS Code Insiders | ✓ | They use the same OpenAI extension. |
| Desktop app | ✓ | Same engine and same `~/.codex`. |
| Codex inside WSL | ✓, separately | WSL has its own home folder: install better-codex inside WSL too. |
| Codex Cloud (cloud tasks) | ✗ | Runs on OpenAI's servers and never reads your `~/.codex`. |

Hooks only run after you trust them once in `/hooks`. Until then, every one of these skips them without saying so.

**Linux and macOS:** every week, and on every change, CI installs the real Codex (the tested version and the latest one) on Linux, macOS and Windows and checks that it loads the rules, the skills and the five hooks, and that each hook runs in that system's shells ([scripts/codex-compat.mjs](scripts/codex-compat.mjs)). If you use it on a Mac, a `bcx doctor` output in an issue helps a lot.

## Features

| When | Feature | What it does |
| --- | --- | --- |
| Session start | **brief** | Gives Codex the branch, uncommitted changes, stack, test/lint/build commands and repo layout in ~100–350 tokens: what it would otherwise spend tool calls finding out. It also covers shell quirks: on Windows it says to use `npm.cmd`, because PowerShell often blocks `npm.ps1`, and it says when `rg` is missing. It also lists the commands that were slow in this repo last time. For infrastructure and databases it names what the repo has (Dockerfiles, Compose with its Postgres or Redis, Terraform, Kubernetes, Helm, GitHub Actions, Prisma and the migration folders of Drizzle, Alembic, Django, Rails, Laravel, Flyway…) and the checks Codex can run for them with the tools installed on your machine. The brief comes back after `/compact`. |
| Every prompt | **boost** | Applies the prompt modes below, adds a short playbook for the kind of task (bug, feature, refactor, tests, review, performance, docs, question; English and Spanish; once per session) and one for its area (databases, infrastructure as code, containers and Kubernetes, CI/CD, security, UI), and resolves the files you name (`login`, `ReportTable`, `format.ts:12`) to real paths. |
| Before each command | **guard** | Stops destructive or hard-to-undo actions until you approve them. See [Safety](#safety). |
| Before each command | **diet** | Blocks full reads of large lockfiles, build output, binaries and files over 200 KB, and recursive listings that would walk `node_modules`. Tells Codex how to read them instead (`rg -n`, line ranges). |
| After each command | **slow commands** | Times every command. One that took over 30 s is pointed out to Codex once and remembered for the repo, so next time Codex runs it and waits for it inside one call instead of polling. Live, on a 75 s test run: 5 requests became 2, and input tokens fell 60%. |
| After each command | **big output** | When an output was huge (over 48 KB), reminds Codex to narrow its next searches. |
| Before finishing | **verify gate** | If Codex changed code and ran no check after its last edit, sends it back once to run `npm test` (or whatever your project uses). If the last check **failed** and Codex is about to finish without saying so, it sends Codex back to fix it or say plainly that it fails. It reads the failure from the output of node:test, Jest, Vitest, Mocha, pytest, Go, Cargo, tsc, ESLint, Gradle, Maven, .NET, Karma, Angular and npm. Infrastructure files get their own check: `terraform validate` for `.tf`, `docker build --check` or hadolint for a Dockerfile, `docker compose config` for Compose, `helm lint`, `kubectl kustomize` or kubeconform, actionlint for workflows, `prisma validate` for the schema. A check is only asked for when its tool is installed. |
| Before finishing | **meter** | Warns you below the answer when context passes 60% (`/compact`) or 80% (`$bcx:handoff` and a new session), and when your 5-hour or weekly limits pass 75%. |

### Prompt modes

| Type | What happens |
| --- | --- |
| `+fix the login` or `deep: …` | Investigates before editing, considers edge cases, verifies thoroughly. |
| `quick: …` | The smallest change, no extra exploring, an answer of at most 5 lines. |
| `ask: …` | Answers only: no file edits, no changes. |
| `plan: …` | A numbered plan (files, risks, verification), then waits for your go-ahead. |

The Spanish prefixes work too: `profundo:`, `rapido:`, `pregunta:`.

### Skills (`bcx` plugin)

| Skill | Use it to |
| --- | --- |
| `$bcx:commit` | Split your changes into topic-sized Conventional Commits, then push, commit only, or open a new branch. Never stages secrets or changes your git identity. |
| `$bcx:refine` | Turn a vague request into a brief (goal, files, constraints, acceptance criteria, verification), then carry it out. |
| `$bcx:handoff` | Write `.codex/handoff.md` so you can continue in a fresh, cheap session. The next session's brief points to it. |
| `$bcx:debug` | Reproduce, isolate, find the root cause, make the minimal fix, add a regression test. |
| `$bcx:ci` | Fix a failing pipeline from the failed step's log only (`gh run view --log-failed`), reproduce it locally, verify. |
| `$bcx:migrate` | Change a database schema with a new, reversible migration that is safe on existing data, tested up and down on a local database. |

## Safety

The **guard** inspects every command and patch before it runs. It doesn't stop at the outer command. It also looks inside:

- the scripts Codex runs in code mode;
- PowerShell `{ }` blocks;
- piped input (`… | Remove-Item`, `… | xargs rm`);
- `.ps1` and `.sh` scripts;
- what each `npm run …` actually runs, according to your `package.json`;
- `node -e` and `python -c` code;
- scripts Codex wrote earlier in the session before running them;
- your aliases and functions: if your PowerShell profile, `.bashrc` or `.zshrc` says `nuke` is `rm -rf`, `nuke tmp` is checked as `rm -rf tmp`. They are read as text, so nothing in your profile runs; on macOS and Linux it also reads Codex's own snapshot of your shell, so what plugins like oh-my-zsh define at startup (`grhh`, `gpf`, `ggf`…) is checked too. Aliases from PowerShell modules aren't seen. `bcx doctor` lists the ones it found.
- base64: `powershell -EncodedCommand …`, `… | base64 -d | bash` or `b64decode` inside `python -c` is decoded and checked like any other command.

It stops on:

- **Deletes git can't undo**: whole folders, uncommitted or untracked files, paths outside the repo, wildcards, targets in variables, `find … -delete`, `shutil.rmtree`, `fs.rmSync(…, {recursive})`. Deleting `node_modules`, caches, logs, or files Codex created this session doesn't ask. Neither do `dist`, `build`, `tmp` and the like, unless git shows uncommitted work of yours inside.
- **Discarding your uncommitted work**: `reset --hard`, `checkout -- …`, `restore`, `clean -f`, `stash drop`, `worktree remove --force`. If only Codex's own changes from this session would be lost, it doesn't ask.
- **Git history**: `push --force` (critical on main), `--mirror`, deleting remote branches or tags, `branch -D`, `filter-branch`.
- **Secrets**: reading `.env`, keys, keystores or credentials (their contents would go to the model), including Terraform state and `.tfvars`, kubeconfig, `.pgpass` and Docker's `config.json`; commands that print secret values (`kubectl get secret -o yaml`, `terraform output -json`, `aws secretsmanager get-secret-value`…); dumping environment variables, overwriting secrets, adding them to git.
- **Databases**: `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `prisma migrate reset`, `migrate:fresh`, `manage.py flush`, `FLUSHALL`…
- **Infrastructure and publishing**: `terraform destroy`, `terraform state rm`, `kubectl delete`, `docker compose down -v`, `docker push`, `npm publish`, `firebase deploy`, making a repo public… Any `kubectl apply`, `helm upgrade` or `kubectl scale` aimed at production (by `--context`, namespace or your current context) is critical; a `--dry-run` is fine.
- **Killing programs by name**: `taskkill /IM chrome.exe`, `Stop-Process -Name node` and `pkill java` also close your own windows and servers. Killing by PID doesn't ask.
- **Your global configuration**: `git config --global …` (your identity), `npm config set`, `setx`, user or machine environment variables.
- **better-codex's own settings**: Codex running `bcx allow`, `bcx config set guard off` or `bcx uninstall`, or editing its settings, its allow list or `~/.codex/hooks.json`.
- **The system**: formatting disks, the Windows registry, deleting restore points, turning off the antivirus or firewall, shutting down, `curl … | bash`.
- **Commands only known when they run**: `eval "$CMD"`, `iex $script`, another command's output piped into `bash` or `iex`. It doesn't ask for setup lines meant to be run that way, such as `eval "$(ssh-agent -s)"` or `conda shell.powershell hook | Out-String | iex`, nor for `iex $x` inside your own scripts.

**How approval works.** A yes is valid for one action, in one turn:

- If Codex retries the same action with different syntax (`rm -rf x` or `Remove-Item -Recurse x`), it goes through.
- Any other risky action asks again.
- "Yes, but…", "wait", or any other reply cancels the approval.
- Codex usually asks on its own, before the guard has to step in, because better-codex's rules tell it to. A yes to that question counts too, so you don't confirm twice. It covers only what the question showed: the exact command, or the exact paths it named for that kind of action.

**Undo.** Before an action you approved runs, better-codex saves a copy of what it can destroy:

- the files it deletes or overwrites (without `node_modules` and caches, up to 100 MB);
- for git commands, your uncommitted work, untracked files included, and every branch and stash, as a commit under `refs/bcx/undo/`. It reads through a copy of your index, so it never touches yours.

Codex mentions it when it asks, and a line confirms it once saved. `bcx undo` lists the copies, and `bcx undo 1` puts the newest back. Deleted branches and dropped stashes come back too, and a branch moved by `reset --hard` goes back where it was. It never replaces a file that exists again unless you add `--overwrite`, and even then it saves the current one first. The state before undoing is saved as well, so an undo can be undone. It keeps the last 20 copies from the last 14 days. Databases, deploys and what a push already sent can't be copied; after a force push it prints the command that puts the remote branch back.

**Strict mode.** The guard looks for what is dangerous, so something it doesn't recognize goes through. `bcx config set strict on` turns that around: only what is known to be safe runs without asking, which means read-only commands, git and gh queries, tests, builds, linters and infra checks. Anything else asks, including whatever the list doesn't recognize: `git commit`, `npm install`, `node -e`, `curl`, writing files from the shell, running a program. Real risks still come first, so `git add; rm -rf src` is reported as a delete. Expect many more questions. Replaying the author's last 30 days, it would have asked on 24% of commands, against 2% without it. `bcx audit --strict` shows what it would ask in your sessions, grouped by command, and `bcx allow "git commit"` lets one kind of command through in one repo, whatever its arguments.

**Allowed in one repo.** If the guard keeps asking about something that is always fine in a repo, run `bcx allow "rm -rf generated/"` there. The next time it stops, its message suggests the exact command.

- A folder covers what's inside it; any other action is allowed only exactly as written.
- It applies to that repo only. `bcx allow` lists what's allowed, and `bcx allow --remove 1` removes a rule.
- Critical actions (`push --force` to main, paths outside the repo) need `--force`, or can't be allowed at all.
- The list lives in `~/.codex/better-codex/allow.json`, outside every repo, so a repo you clone or a pull request can't grant itself anything. The guard stops Codex if it tries to change it.

To see the guard at work:

- `bcx guard "git reset --hard"` checks a single command;
- `bcx audit` shows what it would have stopped in your past sessions;
- `bcx log` shows what it actually stopped.

The guard is an extra layer, not a replacement for Codex's sandbox and approvals. It protects you from the mistakes of a cooperative agent, not from a malicious one. See [SECURITY.md](SECURITY.md).

## Measure

```bash
bcx stats     # tokens, cache, average/peak context, tools per turn, share spent polling, heaviest sessions, before/after install
bcx usage     # your 5-hour and weekly limits, and when they reset
bcx audit     # replays past sessions: what the guard would have stopped, what the diet would have saved (--strict: with strict mode on)
bcx log       # what better-codex did lately: blocks, approvals, skipped reads, verifications it asked for
bcx undo      # the copies saved before each action you approved; bcx undo 1 restores the newest
bcx allow     # what the guard lets through without asking in this repo; bcx allow "<command>" adds one
bcx doctor    # install checks, what Codex itself says about the hooks (loaded, trusted), hooks run through your shells, and what Codex has actually sent
bcx brief     # the brief Codex gets in this repo, and its token cost
bcx try "+fix the login that crashes"   # what would be added to that prompt
```

`bcx stats` splits your sessions into before and after installing, and compares input per turn, tools per turn and average context. Everything better-codex does is logged to `~/.codex/better-codex/events.jsonl`.

The fixed cost is about **1,060 tokens per session**: the rules and the skill descriptions, which get cached. On top of that come the brief and, only when there's something useful to add, ~20–300 tokens per prompt.

**Tip: plugins you don't use cost tokens too.** The skills of every installed plugin are described to the model in every session. In one real setup, Figma, Notion, Google Drive and Work Pets added about 3,000 tokens per session, and none of them had ever been used. Turning their skills off brought the skills section from ~4,200 to ~1,000 tokens:

```toml
# ~/.codex/config.toml: one entry per skill
[[skills.config]]
name = "figma:figma-use"
enabled = false
```

The skill names are in any session file in `~/.codex/sessions`, inside `<skills_instructions>`. Delete the entries to turn the skills back on.

## Configure

```bash
bcx config                      # show everything
bcx config set verifyGate off
bcx config set meter always     # a context and limits line on every turn
bcx config reset
```

| Key | Default | Controls |
| --- | --- | --- |
| `guard` | `true` | Asking before destructive actions |
| `undo` | `true` | A copy of what an approved action can destroy, before it runs (`bcx undo`) |
| `strict` | `false` | Only known read-only commands, tests and builds run without asking; everything else asks |
| `brief` | `true` | Repo brief at session start |
| `boost` / `hints` | `true` | Modes and playbooks per prompt / suggested paths |
| `diet` / `dietMaxKB` | `true` / `200` | Wasteful reads / largest full read |
| `bigOutputKB` | `48` | Huge-output warning (0 turns it off) |
| `verifyGate` | `true` | Checking before finishing |
| `meter` | `warn` | `warn` (thresholds only), `always` or `off` |
| `ctxWarn` / `ctxCritical` | `60` / `80` | Context thresholds (%) |
| `rateWarn` / `rateCritical` | `75` / `90` | Plan limit thresholds (%) |
| `lang` | `auto` | Language of the messages you see (`es`, `en`). The model always gets English. |
| `debug` | `false` | Saves the last payload of each hook in `~/.codex/better-codex/debug/`, for development. Leave it off: it contains command output. |

## Troubleshooting

| You see | Do this |
| --- | --- |
| `bcx doctor`: "Codex has not run them yet" | Trust the hooks in `/hooks`, then send a prompt. Until you do, Codex skips them silently. |
| "this CLI has no complete local package" | The CLI that ships with the desktop app needs `--no-daemon`, or use the one in the VS Code extension (see [Quick start](#quick-start)). |
| `codex exec`: "Code Mode is unavailable … host executable was not found" | That's the desktop app's CLI, which is missing the code-mode host. Use the VS Code extension's `codex`, which includes it. |
| The guard stopped something harmless | `bcx guard "<command>"` explains why. False positives are bugs: please [open an issue](https://github.com/MarioACo/better-codex/issues). |
| `bcx doctor`: "marketplace not registered" | A Codex terminal left open for hours can rewrite `config.toml` from an old copy and drop it (seen with Codex 0.164). Close that window and run `bcx install` again: it registers the skills again, and your trust in the hooks stays valid. |
| `bcx doctor`: "newer than the last one better-codex was tested with" | Usually fine. If something stops working, [open an issue](https://github.com/MarioACo/better-codex/issues) with the `bcx doctor` output. |
| `bcx doctor`: "hook format" | Codex stopped sending a field the hooks read: it probably changed its hook format. Please open an issue with the `bcx doctor` output. |
| Something seems off | `bcx log` and `bcx doctor` show internal errors. If a hook fails, Codex carries on as if it weren't there. |

## How it works

On every event, Codex runs `node …/bin/bcx.js hook <Event>`. It sends the event as JSON on stdin and reads the reply on stdout ([hooks reference](https://learn.chatgpt.com/docs/hooks)). The commands use absolute paths and no shell syntax, so they work the same in cmd, PowerShell, bash and zsh, including paths with spaces or accents. `bcx doctor` checks this by running each hook through your shells.

- **Fails safe.** If a hook fails, Codex carries on as if it weren't there, and the error shows up in `bcx log` and `bcx doctor`.
- **Fast.** Each hook takes ~100–350 ms; Node reuses its compile cache. The guard only asks git where the repo is when a rule needs it, and the session remembers the answer.
- **Stays out of Codex's way.** Its `git status` calls don't take `index.lock`, so they never collide with Codex's own git commands.
- **Concurrency-safe.** Hooks in the same session take turns through a lock, so parallel tool calls don't overwrite each other's state. A stuck lock is released after 5 s.
- **Path-correct.** Paths are compared after resolving symlinks, so `/var` → `/private/var` on macOS doesn't make a file inside the repo look like it's outside.
- **Tested against the real thing.** Besides the test suite, every change in behavior is checked in live Codex sessions in a throwaway repo, and CI checks the real Codex binary every week ([codex-compat](scripts/codex-compat.mjs)).

```text
bin/bcx.js        CLI and hook entry point
src/hooks.js      what each event does
src/guard.js      safety rules and approvals
src/prompt.js     modes, task types, suggested paths
src/brief.js      repo brief · src/project.js  stack and command detection
src/diet.js       wasteful reads · src/verify.js  verify gate
src/meter.js      context and limit warnings · src/stats.js, src/audit.js  metrics
src/install.js    install, uninstall · src/doctor.js  diagnostics
templates/        the AGENTS.md block
plugins/bcx/      skills
```

## Limitations

- **The `+` prefix doesn't raise the reasoning effort.** Hooks can't change it per turn, so `+` adds instructions to go deeper instead. Use `/model` in Codex for that.
- **Codex's session file format is not a stable interface.** If it changes, `stats`, `usage` and the meter stop showing data, but nothing breaks.
- **`bcx audit` judges past git rules against today's state.** It uses each repo's current state, not the state at the time.

## Uninstall

```bash
npx @marioaco/better-codex uninstall   # in a clone: node bin/bcx.js uninstall
```

This removes the hooks, the `AGENTS.md` block, the marketplace and the installed copy, and leaves everything of yours alone. Your settings and metrics stay in `~/.codex/better-codex/` in case you come back; delete that folder if you won't.

## Development

```bash
npm test                       # 113 tests with node:test, no dependencies
npm run check                  # tests + offline doctor
node scripts/codex-compat.mjs  # against your real Codex binary: no login, no model calls
node bench/run.mjs             # the benchmark (uses your Codex quota)
```

The tests use temporary git repos and an isolated `CODEX_HOME`, so they never touch your `~/.codex`. CI runs on Linux, macOS and Windows with Node 20, 22 and 24. See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © MarioACo
