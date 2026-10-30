# Reproducing the Prismatix showcase

These are screenshots and a video of the real locally running UI, captured by browser automation. Application source was unchanged. Existing license and attribution terms apply; public visibility is not a new license grant.

## Provenance

- Application source revision: [`c516e3683d0dbdc2c0e4aaf46d9556f75a70ae47`](https://github.com/gthgomez/Prismatix/tree/c516e3683d0dbdc2c0e4aaf46d9556f75a70ae47). The showcase commit adds documentation/media only.
- Captured 2026-10-30 with Chromium 154.0.8037.57, 1280 × 900, en-US / UTC.
- [Machine-readable capture manifest](capture.json) records scenario, source SHA, timing, blocked hosts, screenshot labels, media byte sizes and SHA-256 checksums.
- MP4: 16.1 seconds, silent H.264. GIF: 1.01× playback, 4 fps, reduced palette/size. JPGs are direct viewport captures. Only the video/GIF receives a provenance caption; no UI is generated or reconstructed.
- Real browser capture of the shipped interactive sample. Responses, model names, routing decisions, token counts, and costs in this preview are scripted examples; no provider inference or billing was exercised.

## Run locally

Use this PR branch (the baseline revision above predates the added capture scripts). From the repository root, start the application in one terminal:

```bash
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4311
```

In another terminal, install the isolated capture-tool dependencies and record. Requirements: Node compatible with the project, Chromium, FFmpeg and ffprobe on PATH. On Linux, the default browser path is `/usr/bin/chromium`; set `CHROMIUM_PATH` for your system. Installing Playwright's small FFmpeg helper supports its temporary WebM recorder; system FFmpeg creates the committed MP4/GIF. No hosted account or external media upload is needed.

```bash
npm ci --prefix docs/showcase
npx --prefix docs/showcase playwright install ffmpeg
node docs/showcase/capture.mjs
```

`SHOWCASE_URL` can override the local server origin; only loopback hosts are accepted. `CHROMIUM_PATH` and `FFMPEG_PATH` override executables. In restricted environments, put npm, corepack and Playwright caches in writable directories and use the same `PLAYWRIGHT_BROWSERS_PATH` during helper installation and capture. Do not point this script at production.

The script launches a new browser context with empty storage, blocks non-loopback requests, operates the actual UI, records a temporary WebM, creates the compact deliverables in `media/`, writes `capture.json`, and removes its own temporary recording directory. Rerunning replaces only showcase media and its manifest. Fonts can differ slightly because external font requests are blocked.

## Workflow and limits

Open public demo; replay architecture sample; switch to fast concept and debate samples.

This capture establishes rendering and playback of `src/components/InteractivePublicDemo.tsx` inside `/demo`. It does not establish live provider behavior, calibrated pricing, backend authorization, or routing quality. `DEMO_SCENARIOS.syntheticCost` values are samples, not invoices.

Source surfaces inspected: `src/components/InteractivePublicDemo.tsx`, `src/components/ResumeDemo.tsx`, `src/App.tsx`.

## Validation

`npm run type-check`, `npm run build`, and `npm test`: passed (85 files, 780 tests). The focused public-demo tests are included in that suite.

Every screenshot and sampled video frames were visually inspected. Browser capture reported no uncaught page errors. README links, media checksums, encodings, file sizes, and final Git diff were reviewed. Public hosted links, when listed, received a read-only HTTP 200 check only; no production UI interaction, account setup, cloud sync, deployment, or paid inference was performed.
