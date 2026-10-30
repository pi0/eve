---
"eve": patch
---

eve now builds on the Nitro v3 RC (`nitro@3.0.261029-rc`) and ships its own `rolldown`, so `eve build` and `eve dev` never install a bundler into your app.

If your own routes use `nitro/storage`, add `unstorage` to your app's dependencies: Nitro no longer ships it and would otherwise install it during the build. Those routes now also bundle your app's `assets/` directory.
