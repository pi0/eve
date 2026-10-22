---
"eve": minor
---

Sandbox providers now key each sandbox by its session: `start()` must return the existing sandbox for `ctx.session.id` when one exists, and the required `onSessionEnd(ctx, state | null, { reason })` takes no artifact and must delete by key when `state` is `null`. Session end now removes a sandbox even when the session never recorded it, such as one a subagent sharing the sandbox opened first. Built-in providers keep a session's sandbox across rebuilds and open-option changes.
