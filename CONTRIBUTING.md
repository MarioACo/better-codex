# Contributing

**English** · [Español](CONTRIBUTING.es.md)

No dependencies: Node 20+ and git are all you need.

```bash
npm test                          # node:test with temporary repos and CODEX_HOME; never touches your ~/.codex
node bin/bcx.js doctor --offline  # runs every hook through your real shells
node bin/bcx.js audit --days 90   # replays your real sessions: false positives are bugs
```

## Try it in a real Codex session

The tests run the hooks the way Codex calls them, but Codex itself is the final judge. If your change affects what Codex sees or does, try it in a live session on a throwaway repo:

```bash
node bin/bcx.js install                                  # refreshes the installed copy; your trust stays valid if hooks.json didn't change
codex exec -C <throwaway-repo> --json "<a prompt that exercises your change>"
node bin/bcx.js log                                      # what better-codex did in that session
```

Several bugs only showed up this way:

- a confirmation asked twice;
- `npm.cmd test` not counting as a check;
- shell calls that failed in every session.

## A new Codex release

Codex is still in alpha, and a release can change what better-codex relies on. Two checks, from cheapest to most thorough:

```bash
node scripts/codex-compat.mjs     # the real Codex, no login, no model calls: rules, skills and hooks loaded and run
node bench/run.mjs --runs 1       # real sessions with and without better-codex (uses your Codex quota)
```

CI runs `codex-compat` on Linux, macOS and Windows against the version in `codexTested` (package.json) and against the latest one, every week. Once a new version passes both checks, update `codexTested`: `bcx doctor` compares the installed Codex against it.

## Benchmark

`node bench/run.mjs` runs the same tasks with plain Codex and with better-codex, in fresh copies of a small repo ([bench/fixture](bench/fixture)), and grades each run with a check Codex never sees ([bench/tasks.mjs](bench/tasks.mjs)). A good new task:

- is something people really ask Codex for;
- has a check that doesn't depend on wording (hidden tests, files on disk, a git status);
- would be done right by a careful developer, so it measures Codex and not the task.

Results go to `bench/results/`. Commit them along with any change to the README table they back.

## Guard rules

Every new rule comes with tests in [test/guard.test.js](test/guard.test.js) for both sides:

- what it must stop;
- the everyday commands it must **not** stop. The `allowed` list grows with every false positive found.

Before opening a PR, run `bcx audit` on your own sessions and compare how often it would ask. If that number jumps, the rule is too broad.

Text the model reads is in English and short. Text you read is in Spanish and English (`RULES` in [src/guard.js](src/guard.js)).

## Hooks

A hook must never break Codex:

- Every feature runs inside `safely()` in [src/hooks.js](src/hooks.js).
- Any error goes to `~/.codex/better-codex/events.jsonl`, where `bcx log` shows it.

Whatever gets injected into the model stays in the conversation for the rest of the session, so every line has to earn its place.

## Docs

The README, this guide, the security policy and the changelog come in English and Spanish (`*.es.md`). If you change one, change both, or say in the PR which one is missing. The animated demos in `docs/` come from `node scripts/demo-svg.mjs`; add `--static` to check the layout with every line visible.

## Commits

Use Conventional Commits (`feat(guard): …`, `fix(diet): …`), one change per commit. Add your change under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) and [CHANGELOG.es.md](CHANGELOG.es.md).
