# SKY STUDY — Progress log

Living log so any session can resume. Newest entries at the bottom of each section.

## Reference study (what is actually observable)

Source: five screenshots from the user of the X post `azlenelza/status/2114018879328682447` (0:01–0:17 of a 24 s clip). The video itself was not downloaded; no source code is available and none is assumed.

Observable in the screenshots:
- Full-bleed sky, no chrome except the video player. Two camera setups: a side view with a blue→warm haze gradient (0:01–0:03) and a top-down-ish view against deep slate blue (0:09–0:17).
- A thin white freehand line and a small `+` crosshair cursor. A closed heart becomes a broad flat-based cumulus; a hook/question-mark becomes a tall cloud with a tail.
- Clouds go from grainy/noisy (0:03, early frames) to smooth (0:09+), which is consistent with progressive accumulation of a stochastic renderer. We don't claim to know the original technique.
- Lighting: bright tops/right sides, blue-grey undersides, fine grainy boundary detail, soft self-shadowing.
- 0:17 shows a selection box with corner handles and a size label in metres ("3055 × 3175 m").

## Technical plan

- Vite + React + TypeScript for UI; **raw WebGL2** for rendering (a single full-screen raymarch is simpler and faster without a scene graph).
- Sky: physically based single scattering (Rayleigh/Mie/ozone) into a 256×144 sky-view LUT, plus a twilight term; the CPU runs the same model to derive cloud light colours, so sky and clouds always agree.
- Clouds: gesture → seeded lobes → baked 96×64×64 coverage volume per cloud (RG8: coverage, formation order) in a shared 3D atlas (16 slots). The shader displaces the coverage surface with tileable Perlin-Worley + Worley noise generated on the GPU at startup, then raymarches all clouds in one pass (correct mutual occlusion), with a 7-step light march, multiple-scattering octaves, powder term, sky/ground ambient and aerial perspective.
- Progressive accumulation (jittered frames averaged) when the scene is still; history is reset on any visible change, so dragging never ghosts.
- AgX tone mapping; partial auto-exposure (night stays darker than day).

## Milestones

- [x] M0 — repo, toolchain, docs skeleton
- [x] M1 — volumetric rendering spike (`/spike.html`)
- [x] M2 — sky + five time presets
- [x] M3 — stroke capture & shape generation
- [x] M4 — formation animation (frame-reviewed from the recorded showcase)
- [x] M5 — movable 3D clouds
- [x] M6 — UI, undo/redo, persistence
- [x] M7 — capture/export
- [x] M8 — optimisation
- [x] M9 — QA, case study

## Log

### M1/M2 — renderer iterations (inspected via `node scripts/shoot.mjs`, headless Chromium + Metal)
1. First light: smooth "cotton" blob, flat lighting, a grey ground band. Cause: noise only eroded a soft fringe.
2. Rewrote density as a displaced distance-like field with a narrow smoothstep → crisp cauliflower billows.
3. Ambient was scaled by π (wrong: in-scattered radiance from an isotropic sky is its average radiance). Fixing it restored sunlit/shadow contrast.
4. Terraced contour bands on lit faces from a fixed-offset light march → jittered light-march samples.
5. Blue hour was a saturated sunset (sun too high), then black (single scattering collapses below −6°). Added a twilight dome/glow term in both GPU and CPU models and desaturated the last red direct light toward pink.

### M3–M6 — the app
- Strokes are projected onto a vertical plane 9 km in front of the camera; open strokes become lobes along the path, closed strokes are inflated (lobe radius from distance-to-outline), then towers and cauliflower lobes are added on upper surfaces.
- Formation reveals the volume along the gesture order (G channel) with an ease-out over 3.4 s; the white line holds 0.7 s then fades.
- Picking ray-tests the gesture lobes (shrunk 18 %) rather than the noisy density: stable and forgiving. Selection box is projected from the lobes.
- Depth moves keep altitude (like a real receding cloud it sinks toward the horizon) — first version moved along the view ray, which sent far clouds to 10 km altitude.
- Golden-hour finding from the pixel test: with the sun slightly in front the visible faces were in shadow and read cool. Swung the evening sun to behind-right so lit faces face the viewer.
- Tests: 37 unit (Vitest) + 12 E2E (Playwright, Chromium on Metal; 3 also on Playwright WebKit). E2E assertions use `engine.sample()`, a small offscreen render of the real scene, so they check pixels, not just state.

### M7–M9
- Bug: recording hid the UI, unmounting the menu that owned the recorder. Moved to `src/capture/session.ts`; a stop pill renders whenever recording.
- Formation frame review (ffmpeg crops of the showcase) showed specks and IGN dither blocks: soft changes now keep a 2-frame history; early formation is translucent vapour.
- Perf (see CASE_STUDY.md table): sorted per-pixel cloud lists, distance-aware steps, faster empty strides, 6-step light march. 16 clouds balanced 26.7 → 14.4 ms.
- Soak test: 20 gestures, edits, 15 light changes, resizes, captures, reload — no errors, 60 fps throughout.
- Polish: lower ambient share, base occlusion, +noon exposure; closed gestures get a higher flat base; short preset labels on phones.
- Final: 37 unit + 18 E2E passing on dev and production builds.

### Perspective (2026-10-26, after first handoff)
- X demo v1 (1920×1080, 25 s) delivered; v2 (31 s) adds a rise above the clouds.
- Camera = yaw/pitch/altitude; eased display view; presets Ground / Eye level / Above; right-drag, Look tool (L), arrows; persisted separately from undoable scene.
- Drawing plane follows the view; from above, strokes become horizontal footprints (`orientation: 'horizontal'` on the cloud doc).
- Sky LUT from camera altitude; ocean albedo + slate deepening at altitude; jittered soft cloud shadows on the sea.
- E2E made deterministic (seeded Math.random in tests) after one WebKit flake from random cloud seeds.
- 40 unit + 22 E2E passing on dev and production builds.

## Remaining / ideas
- Camera translation / orbit around a cloud; inter-cloud shadowing; reprojection so dragged clouds stay smooth; pinch-to-scale; Safari.app / Firefox / real-device testing; deployment.

## Environment notes
- Dev server: `npm run dev` → http://localhost:5362 (launch config `sky-study`).
- Homebrew ffmpeg is broken on this machine; use the `ffmpeg-static` / `ffprobe-static` dev dependencies.
- Headless Chromium needs `--use-angle=metal` for real GPU rendering.
