---
name: ci
description: Fix a failing CI run (GitHub Actions, GitLab CI) from its log — read only the failed step, reproduce it locally, fix the cause, verify. Use when a pipeline, workflow or pull request check fails.
---

# CI

1. **Find the failure**: `gh pr checks` or `gh run list --limit 5`, then `gh run view <id> --log-failed`. Read only the failed step's log, never every log. On GitLab: `glab ci view`, or the failed job's trace.
2. **Name the kind**: a test, lint or type error, a build error, dependencies or cache, the environment (runtime version, missing secret, permissions), or flaky (passes on a re-run, timing-dependent). Compare with the last green run (`gh run list --status success --limit 1`) and the commits in between.
3. **Reproduce locally** with the command and versions the job uses (read its steps). If it only fails in CI, say what differs: OS, runtime version, environment variables, service containers.
4. **Fix the cause** with the smallest change, in the code or in the workflow when the workflow is wrong. Keep actions pinned and `permissions:` minimal, and never print secrets. Don't skip a test or disable a check to get it green unless the user agrees.
5. **Verify**: run the failing command locally, and `actionlint` if you changed a workflow and it is installed. Don't push or re-run the pipeline unless asked: give the user the command (`git push`, `gh run rerun <id> --failed`).
6. **Report**: failed step → cause → fix → local evidence.
