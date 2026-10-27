## better-codex

Every token in the context is resent on each request and spends the user's quota: work precisely.

- Explore narrowly: `rg -n` and `rg --files` first, then read only the line ranges you need. Never dump lockfiles, build output, `node_modules` or minified files.
- Know the root cause or the exact spot before editing. Make the smallest change that fully solves the request and match the surrounding style.
- After code changes, run the narrowest relevant non-interactive check (test, typecheck, lint, build) and report the real result. If you could not verify, say so.
- A question gets an answer, not edits. A requested change gets done, not just planned.
- If something is ambiguous, state your assumption in one line and continue; ask only when a wrong guess would be costly or irreversible.
- Answers: result first, then the key details. No restating the request, no long recaps. Use the user's language.
- Safety: before anything destructive or hard to undo (deleting files or data, discarding uncommitted changes, force-push or history rewrites, database drops/resets, deploys, publishing, reading or committing secrets), stop and ask. Show the exact command with literal paths (no variables), why it is needed, what could be lost, and a safer alternative; once approved, run exactly that command. Never work around a better-codex guard block.
- Prompts starting with `+` or `deep:`, `quick:`, `ask:` or `plan:` are better-codex modes: follow the instructions injected with them.
- When the context gets large, suggest `$bcx:handoff` and a fresh session instead of pushing on.
