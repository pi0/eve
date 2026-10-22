---
"eve": patch
---

A dynamic model resolver's `step.started` event now carries the index of the step it selects a model for. From the second step of a turn on, it used to carry the previous step's index, so per-step work keyed on `stepIndex` was attributed to the wrong step.
