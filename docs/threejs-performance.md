# Three.js performance upgrade

The target is at least 60 FPS on an M4 Pro at 2560×1440 with Very High, and above 60 FPS up to 120 FPS on lower presets. No browser or Playwright performance tests were run. Node checks establish correctness and rendering budgets; they do not establish GPU frame times or certify these hardware targets. Presentation above 60 FPS also requires a display running above 60 Hz.

| Setting                | Maximum scene pixels | Moving camera     | Table shadows | Drink glass |
| ---------------------- | -------------------- | ----------------- | ------------- | ----------- |
| Performance            | 1600×900             | Same budget       | 1 × 512       | Alpha       |
| Auto, desktop          | Up to 1920×1080      | 80% pixel budget  | 1–3, 512–1024 | Alpha       |
| High                   | 1920×1080            | 85% pixel budget  | 1 × 1024      | Alpha       |
| Very High · 2K (1440p) | 2560×1440            | Full 1440p budget | 3 × 1024      | Alpha       |
| Ultra · 4K             | 3840×2160            | 70% pixel budget  | 3 × 2048      | Refraction  |

Pixel counts are caps; viewport size, native device density and hardware buffer limits still apply. Very High renders 2560×1440 for a 2560×1440 viewport at device pixel ratio 1 or higher. Motion scale is a fraction of total pixels, not of each dimension. Auto follows the observed refresh; High and Performance expose an 8.33 ms target, Very High and Ultra 16.67 ms. Manual presets remain stable rather than silently changing quality under load.

## Work removed

- `pub-bottle-layout.ts` coordinates both shelf families: 60 bottles across three shelves with 0.75-unit horizontal spacing, plus fewer classic counter bottles. This replaces the partially upgraded checkout's 120 shelf bottles and removes inter-family overlaps.
- `instance-visibility.ts` keeps original static transforms and conservative bounds, tests individual instances against the current camera, and compacts existing instance buffers. It retains objects needed by shadow cameras on the appropriate layers. Camera changes, projection changes, parent movement and arriving assets invalidate visibility immediately; unchanged selections do not upload new buffers. Ordinary meshes retain Three's built-in frustum culling. This is frustum culling, not occlusion culling through walls.
- Reflection captures restore all static instances before rendering all six directions, then the main view reapplies culling. Gameplay objects and animated instance arrays are outside this static controller.
- `motion-resolution.ts` detects slow movement, rotation, camera-parent transforms and lens changes. Hysteresis prevents brief pauses from repeatedly resizing buffers. Resize applies the current motion state and changes drawing-buffer size and pixel ratio together.
- `bloom-pass.ts` runs glow extraction and blurs at half their previous dimensions below Ultra, reducing those effect buffers to one quarter of the pixels. Scene color, labels and the output pass retain the preset's resolution.
- Refraction is reserved for Ultra, avoiding its extra scene-color pass on the 1440p and high-refresh presets. The pool table below bounds the direct lighting cost.

## Direct lighting follow-up

The loaded room and table models contain 30 point lights and three area lights, before the scene adds its pendant, cloth fill and gameplay flashes. The previous practical-light controller was disabled, so every one expanded the per-material light loops, even on Performance. The reported 12 FPS has not been reproduced with a browser benchmark.

| Preset                             | Point-light slots | Area-light slots |
| ---------------------------------- | ----------------- | ---------------- |
| Performance / Auto light / minimum | 2                 | 1                |
| Auto fast                          | 3                 | 1                |
| High / Auto balanced / refined     | 4                 | 2                |
| Very High                          | 6                 | 2                |
| Ultra                              | 12                | 4                |

`light-budget.ts` now enforces these limits. Selection uses light influence volumes and retains existing selections with hysteresis, then fades replacements. Emissive fixtures remain visible; table spotlights keep their independent shadows. Decorative direct lighting is an approximation at each budget, while reflection captures temporarily restore the complete authored lights. Source visibility and animated intensities remain under the game's control. Slots beyond the current budget are removed from the shader rather than merely dimmed to zero.

`lighting-shader.ts` skips the direct BRDF when Three's light attenuation reports no contribution. Its material hook composes with the cloth's normal/height shader. Asset revisions trigger material/light discovery and lightmap binding; the game no longer rescans the entire settled scene every two seconds.

## Menu responsiveness

Open menus suspend scene rendering, reflections and shader prewarming. Match/network updates and DOM input continue. The opening menu has a static backdrop instead of starting the room tour. Graphics choices are queued until rendering resumes, and the graphics panel labels its diagnostics as the last scene frames. Opening a dialog releases pointer lock immediately.

`menu-input.ts` handles completed clicks and keyboard activation within the opening dialog. It does not switch panels during a global pointer-down, interfere with other dialogs, or replace native activation of menu buttons.

## Powerup placement

Pickup expiry now uses the current level's simulation clock, independently of the scene's continuous animation clock. The old mismatch could drive the expiry shrink factor below zero after a long session or a level change, inverting and enlarging the pickup beneath the table. Shrink stays between 0.86 and 1 even for stale expired snapshots. Each solid icon also reserves clearance above its plinth for the full bob animation; bounds are computed once when the pickup is built.

## Ramp contact and settling

Rapier's wedge owns ramp contact; only the cloth receives an artificial floor correction. Projecting a ball onto the ramp's face planes could hold it above the actual ridge. Striking from the ramp now retains its real height for energy accounting. A stationary ball can settle on a ridge without waiting for the 28-second safety timeout or being moved into the wedge. Rebuilding a physics world also clears the old ramp collider handles.

Node regressions cover shots from 90 ramp positions/headings, resting ridge contact, rebuilt collider identities, and progression through all five levels with the scene animation clock already minutes old.

## WASM and validation

Physics uses Rapier WASM and compressed model decoding uses Meshopt WASM already. Culling stays in allocation-conscious TypeScript: these instance sets are small, and sending transforms across another WASM boundary would add complexity without measured benefit. No new runtime dependency is introduced.

Run `npm test` for Node regression tests and `npm run build` for TypeScript and production bundling. The placement snapshot covers loaded model world bounds and UVs; only the deliberately changed bottle placements should differ. Culling tests exercise camera return, empty batches, parent transforms, orthographic zoom, shadow layers, reflection restoration and asset swaps. These tests do not render frames and must not be presented as FPS evidence.

The M4 Pro FPS requirement remains unverified until actual frame times are measured on the target setup. The in-game graphics panel reports current render resolution, observed FPS, CPU/GPU times (GPU when supported), draw calls and practical-light counts; no automatic browser benchmark was added or run.
