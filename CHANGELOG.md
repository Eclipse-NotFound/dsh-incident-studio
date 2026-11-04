# Changelog

## 0.1.0 — 2026-11-04

First public release.

- **Right-sidebar panel** (`现场取证台 / Incident Studio`): record, review, annotate, hand off — all inside the DSH window. First mount opens the panel once so you can find it.
- **Three capture paths**: `electron.desktopCapturer` frame polling → per-window capture; Windows GDI screen grabber (`tools/grab-frames.ps1`) when the plugin host cannot reach Electron APIs; browser `getDisplayMedia` + `MediaRecorder` for a real `dsh web` in Chrome.
- **Configurable log sources**: named profiles, several files per profile, tail-following with 96 KB / 800-line pre-roll, plus an HTTP `ingest` route for programs that want to push events with an exact wall-clock timestamp.
- **One clock**: frames and log lines both carry the recording-start-relative millisecond; the log panel follows the picture and clicking a line seeks the picture.
- **Range + annotation + export**: mark the failing seconds, drag boxes on the frame, write one sentence; export a 6-frame contact strip (PNG), an animated GIF (local `gifenc`), and `bundle.md` / `bundle.json` into the session workspace.
- **One-click hand-off**: the compact markdown with the log slice goes into the composer, the strip/GIF become draft attachments; send from there or review first.
- **Self-check receipts**: `client-boot.json` (page reached `apply` / `seat` / `panel`) and `capture-capability.json` (which capture path the host can use) under `$DSH_HOME/storages/dsh-incident-studio/`; `tools/check-live.mjs` reads them alongside the live module graph.
- **Tests**: 250 assertions across six suites (host routes end-to-end, client pure functions, `apply()` seat registration, panel SSR, a jsdom click-through of the whole flow, GIF encoding and strip layout, capture polling) plus a real-machine GDI capture check.
