---
name: refine
description: Turn a rough or vague request into a precise task brief (goal, files, constraints, acceptance criteria, verification) before doing it. Use when the user asks to refine or improve a prompt ("afina", "mejora mi prompt"), or when a request is ambiguous and a wrong guess would waste work.
---

# Refine

A little precision up front saves whole turns later.

1. Gather only the context needed to make the request concrete: `rg -n` / `rg --files` for the names in the request, then read just the matching ranges. At most about five tool calls.
2. Write the brief, at most 15 lines:
   - **Goal**: one sentence, about the outcome.
   - **Where**: the files and symbols involved (`path:line`).
   - **Constraints**: what must not change; the existing pattern to follow.
   - **Done when**: 2–4 checkable acceptance criteria.
   - **Verify**: the exact command(s) to run.
   - **Open questions**: only those whose answer changes the result.
3. If there are open questions whose wrong answer would waste work, ask them (at most three) and stop.
4. Otherwise, unless the user only wanted the brief ("solo el prompt", "just refine"), implement it and check the result against **Done when**.
5. If the user wants a reusable prompt, give the brief as a fenced block they can paste into a new session.
