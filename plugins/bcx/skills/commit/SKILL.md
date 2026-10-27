---
name: commit
description: Commit the current git changes as Conventional Commits split by topic, then push, commit only, or use a new branch. Use when the user asks to commit, push their changes, or says "haz commit".
---

# Commit

1. Inspect in one command: `git status --short`, `git branch --show-current`, `git log --oneline -10` and `git diff HEAD --stat`. Read `git diff HEAD -- <file>` only for files whose change the stat does not explain. In a repository without commits, use `git status` and `git diff --cached`.
2. Decide what to do:
   - If the user already said it ("solo commit", "sin push", "en otra rama", "and push"), do that.
   - Otherwise ask once, in one short line: commit + push (recommended), commit only, or commit on a new branch. If you cannot ask, commit + push.
3. Group the changes by topic, one concern per commit. If files outside the first group are already staged, run `git reset` first so each commit has only its own files.
4. Never stage `.env*` (except `.env.example`), keys, credentials, build output or large binaries. If they show up, leave them out and mention them.
5. For each group: `git add <files>`, then `git commit -m "type(scope): summary"`.
   - Types: feat, fix, refactor, perf, test, docs, style, build, ci, chore.
   - Imperative mood, at most 72 characters; add a body only when the why is not obvious.
   - Language: the one used in `git log`; English when there are no commits yet.
   - No AI attribution or trailers unless the repository's own conventions require them.
6. Stay on the current branch, whatever it is, unless the user chose a new branch: then `git switch -c <type>/<short-summary>` before the first commit.
7. Unless it is commit only, `git push -u origin HEAD`. Never force-push. If there is no remote or the push fails, report the error and stop.
8. Never change git config (user.name, user.email): commit with the identity the repository already has.

Reply with only: the commits (short hash + message), the branch, and the push result.
