---
name: debug
description: Methodical debugging — reproduce, isolate, find the root cause, fix minimally and prove it with a test. Use for hard or recurring bugs, flaky tests, or after a first fix attempt failed.
---

# Debug

1. **Reproduce**: get the exact failing command or steps and the full error. If it does not reproduce, gather evidence first (logs, stack trace, `git log -p -5 -- <file>`) before touching code.
2. **Isolate**: shrink it to the smallest failing case. Start from the first stack frame inside the project. Bisect inputs, code paths or commits (`git bisect`) instead of guessing.
3. **Hypothesize**: list one to three candidate causes with the evidence for each, then run the cheapest check that tells them apart (a log line, an assertion, a one-off script).
4. **Fix** the root cause, not the symptom, with a minimal diff and no unrelated refactors.
5. **Prove** it: a regression test that fails before and passes after (when the project has tests), then the related suite.
6. **Report**: cause → fix → evidence (command and result). Remove temporary logs and scripts.

If two fix attempts fail, stop and recheck the assumptions from step 3 instead of trying a third variation.
