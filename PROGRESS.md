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
- [ ] M3 — stroke capture & shape generation
- [ ] M4 — formation animation
- [ ] M5 — movable 3D clouds
- [ ] M6 — UI, undo/redo, persistence
- [ ] M7 — capture/export
- [ ] M8 — optimisation
- [ ] M9 — QA, case study

## Log

### M1/M2 — renderer iterations (inspected via `node scripts/shoot.mjs`, headless Chromium + Metal)
1. First light: smooth "cotton" blob, flat lighting, a grey ground band. Cause: noise only eroded a soft fringe.
2. Rewrote density as a displaced distance-like field with a narrow smoothstep → crisp cauliflower billows.
3. Ambient was scaled by π (wrong: in-scattered radiance from an isotropic sky is its average radiance). Fixing it restored sunlit/shadow contrast.
4. Terraced contour bands on lit faces from a fixed-offset light march → jittered light-march samples.
5. Blue hour was a saturated sunset (sun too high), then black (single scattering collapses below −6°). Added a twilight dome/glow term in both GPU and CPU models and desaturated the last red direct light toward pink.

## Environment notes
- Dev server: `npm run dev` → http://localhost:5362 (launch config `sky-study`).
- Homebrew ffmpeg is broken on this machine; use the `ffmpeg-static` / `ffprobe-static` dev dependencies.
- Headless Chromium needs `--use-angle=metal` for real GPU rendering.
