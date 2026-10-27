---
name: handoff
description: Write a compact handoff of the current work so it continues in a fresh session with a small context. Use when the context is large, before starting a new session, or when the user says handoff, relevo, or "sigue en otra sesión".
---

# Handoff

A long session resends its whole context on every request: a fresh session that starts from a good handoff is cheaper and answers better.

1. Write `.codex/handoff.md` at the repository root (create `.codex/` if needed), at most 40 lines, facts only:

   ```markdown
   # Handoff — <date> — <branch>
   ## Goal
   The user's actual objective, in one or two sentences.
   ## Done
   - path — what changed and why
   ## State
   What works, what was verified and how, what fails (exact error).
   ## Next
   1. The first step, concrete enough to start right away.
   ## Notes
   Decisions and their reasons, gotchas, commands that matter.
   ```

2. If `.codex/` is not ignored by git, mention it; do not edit `.gitignore` unless asked.
3. Reply with the path and the line to start the next session with: `Continúa desde .codex/handoff.md`. The better-codex repo brief points new sessions to this file for three days.
