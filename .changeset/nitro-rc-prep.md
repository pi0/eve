---
"eve": patch
---

Build on the upcoming Nitro RC (currently `nitro-nightly`): eve now ships its own `rolldown` for Nitro, so builds never install a bundler into your app, and skill files are embedded in the server bundle. If a route of your own uses `nitro/storage`, add `unstorage` to your app's dependencies, since Nitro no longer ships it and otherwise installs it during `eve build` and `eve dev`; such a route also bundles your app's `assets/` directory.
