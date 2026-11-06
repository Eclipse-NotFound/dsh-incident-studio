# Changelog

## 0.2.0 — 2026-11-06

Keyboard and mouse recording on the same timeline as the frames and the log.

- **Input recorder (Windows)**: `tools/record-input.ps1` polls `GetAsyncKeyState` at ~30 Hz (10/20/33 ms selectable) and writes one JSONL line per *change* — key down/up with the virtual-key name, button down/up with screen coordinates, foreground switches, optional pointer path. **No keyboard hooks, no text, no layout translation**: `tools/input-interop.cs` is a 120-line interop surface (`GetAsyncKeyState`, `GetForegroundWindow`, `GetSystemTimePreciseAsFileTime`, a 108-entry key table) compiled once into a cached assembly under `%LOCALAPPDATA%\dsh-incident-studio\`.
- **Scoped by default**: keys are recorded only while the configured target process owns the foreground (`input.targets`, per profile). Alt-tabbing out writes one `focus lost / blur-release` line; the plugin host process is always excluded.
- **Hold durations**: key-up events carry the measured hold (`Space ↑ (0.14s)`). Keys still held when focus leaves are not given a fabricated release time.
- **Mark anchors**: a mark now remembers the last key/button down within 2 s, so the note says `（前一条输入：Space ↓ 0.12s 前）` / `(last input: Space ↓ 0.12s before)`.
- **Review UI**: a live input read-out while recording (ready / held keys / counts), and an expandable input list in review; clicking an entry seeks the picture. The marker row shows its anchor.
- **Bundle**: new `## 输入记录` section (sampling, scope, counts, most-pressed keys, longest holds, per-mark windows around each mark, the full event stream capped at 1500 rows) plus the raw `input.jsonl` archived into `.dsh-incidents/<id>/`, and the input summary in the composer text. `bundle.json` gained `inputConfig` / `inputSummary` / `inputs` / `inputArtifact` / `markers`.
- **Ability receipt**: `input-capability.json` records the result of a real start-up probe (does the helper compile and report ready, key count, PowerShell version, elapsed). Settings and `/state` surface it; when blocked, only this feature is off.
- **Tests**: 457 assertions (up from 293). New suite `test/input.test.mjs` (config normalisation, JSONL parsing, statistics, anchors, markdown, a fake-helper end-to-end run) and `test/live-input.mjs` (real probe / self test / 2.5 s recording / optional injected Shift, 33 more assertions when run). `test/dom.test.mjs` now also clicks through the input HUD, the review list and the anchored hand-off.

## 0.1.0 — 2026-11-04

First public release.

- **Right-sidebar panel** (`现场取证台 / Incident Studio`): record, review, annotate, hand off — all inside the DSH window. First mount opens the panel once so you can find it.
- **Three capture paths**: `electron.desktopCapturer` frame polling → per-window capture; Windows GDI screen grabber (`tools/grab-frames.ps1`) when the plugin host cannot reach Electron APIs; browser `getDisplayMedia` + `MediaRecorder` for a real `dsh web` in Chrome.
- **Configurable log sources**: named profiles, several files per profile, tail-following with 96 KB / 800-line pre-roll, plus an HTTP `ingest` route for programs that want to push events with an exact wall-clock timestamp.
- **One clock**: frames and log lines both carry the recording-start-relative millisecond; the log panel follows the picture and clicking a line seeks the picture.
- **Range + annotation + export**: mark the failing seconds, drag boxes on the frame, write one sentence; export a 6-frame contact strip (PNG), an animated GIF (local `gifenc`), and `bundle.md` / `bundle.json` into the session workspace.
- **One-click hand-off**: the compact markdown with the log slice goes into the composer, the strip/GIF become draft attachments; send from there or review first.
- **Self-check receipts**: `client-boot.json` (page reached `apply` / `seat` / `panel`) and `capture-capability.json` (which capture path the host can use) under `$DSH_HOME/storages/dsh-incident-studio/`; `tools/check-live.mjs` reads them alongside the live module graph.
- **Tests**: 293 assertions across seven suites (host routes end-to-end, manifest/release shape, client pure functions, `apply()` seat registration, panel SSR, a jsdom click-through of the whole flow, GIF encoding and strip layout, capture polling) plus a real-machine GDI capture check.

## 0.1.0 — fix (2026-11-05)

- `package.json` had shipped with a UTF-8 BOM (left by a Windows PowerShell `Set-Content -Encoding utf8` step). A BOM is not legal JSON, so the plugin market rejected the manifest with `Unexpected token … is not valid JSON`. The manifest and the `v0.1.0` release tarball are BOM-free now, and `test/manifest.test.mjs` fails the suite if any published text file grows a BOM again.

Also: the test runner now covers the manifest, and the dev docs list the new suite.

