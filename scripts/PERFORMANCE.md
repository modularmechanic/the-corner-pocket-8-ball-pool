# CPU benchmark

Run from the repository root:

```sh
node --import tsx scripts/benchmark-cpu.ts
node --import tsx scripts/benchmark-cpu.ts --frames 12000
```

The script initializes the real Rapier engine, warms each workload for 500 iterations, then measures 6,000 iterations by default. `--frames` accepts integers from 100 through 1,000,000. Output is JSON with mean, 95th-percentile and 99th-percentile milliseconds per iteration.

The three workloads are:

1. A level-five idle Match, stepping 1/120 second, reading cached public state and actor permissions, and draining events. Timed pickups remain enabled.
2. Repeated level-five full-power breaks with a fixed seed. Each iteration performs one 1/120-second Match update plus public state/actor reads and event draining. Completed shots trigger a fresh identical rack; reset cost is included.
3. Serialization of a representative settled-state HUD cache key, including equipment and arcade data. This measures serialization only; it does not access the DOM.

Recorded on 14 September 2026 with Node v24.14.0 on darwin/arm64:

| Workload | Mean ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| Idle Match | 0.02808 | 0.03933 | 0.04738 |
| Repeated full-power breaks | 0.05829 | 0.07975 | 0.12146 |
| HUD key serialization | 0.00402 | 0.00413 | 0.00504 |

These are CPU component timings, **not FPS results**. They exclude rendering, browser layout, paint, input delivery, audio, network processing and asset loading. Runtime warmup, machine load and engine version affect results. Browser frame telemetry is required to attribute the complete frame cost or verify a 120 FPS target.

## Texture allocation audit

The material pass preserves numbered-ball resolution, felt resolution, normal maps, cue grain, anisotropy and physical shading. It changes storage and ownership:

- Six procedural roughness maps use RG8 instead of RGBA8. Three.js reads roughness from green, which is preserved exactly. Their base-level typed-array allocation falls by 5 MiB, from 10 MiB to 5 MiB. The corresponding mip-chain reduction is approximately 6.67 MiB before driver overhead.
- The unmarked, uniform cue-ball color map is 8×4 instead of 1024×512. Numbered balls remain 1024×512. This removes approximately 2 MiB of base color storage with identical uniform color.
- Once each scanned wood map loads, its corresponding procedural fallback is disposed. Failed loads keep the fallback. Successful loading releases another 2.5 MiB of base procedural texture data after RG packing.
- Identical procedural walnut textures are generated once and cloned with a shared Three.js texture Source. Owners retain independent sampler settings and disposal. Three can share GPU storage when sampler settings match; different sampler configurations may require separate allocations.

The allocation check verified all six roughness arrays retain nonzero green data with linear color space, successful wood loads dispose exactly three fallback textures, the cue-ball map has 32 texels, and walnut clones share their Source while keeping independent repeat settings. The installed Three.js roughness shader samples `.g`, and its WebGL texture code maps this unsigned-byte format to RG8.

These byte counts describe texture data and intended formats; they are not measured total GPU memory or an FPS improvement. The browser renderer must validate final appearance and GPU behavior alongside the other performance changes.

## Wool baize detail

The fine baize is authored and baked in Blender through the installed MCP add-on. Its 2048×2048 albedo and 1024×1024 normal/surface maps load once from `public/textures/table/`. The authoring source is `art/blender/create_fine_baize.py` / `fine-baize.blend`. No fiber generation runs in the browser. Albedo is sRGB; normal and packed surface maps are linear. Red in the surface map stores height and green stores matte roughness, so bump and roughness share one allocation. All three maps are shared between the bed and cushions.

Mipmapped linear filtering, up to 8× anisotropy and fine texture scale prevent coarse visible texels in the cue camera. The cloth-only shader hook combines tangent normals with subtle height perturbation; bump scale is 0.035% of the ball radius. The previous exaggerated startup-generated nap has been removed, including from the loading fallback. The three RGBA browser allocations use about 24 MiB before mipmaps (32 MiB with a full mip chain), an intentional increase for close-view albedo fidelity. This does not add draw calls, geometry, dynamic lights or animated procedural noise. Tests cover actual PNG dimensions, color spaces, filtering, shared maps, shader integration and disposal.

## Browser frame measurement

Open `/art/performance.html?quality=auto` while the development server is running. Keep the browser visible and allow the room assets and reflection capture to settle, then choose **Measure 15 seconds**. Do not edit renderer files during a sample: Vite reloads invalidate it. Repeat the same viewport, quality, camera and hardware conditions when comparing runs. The fixture records rAF intervals, scene-update CPU submission time, and all-pass draw/triangle counts. Its runtime summary includes asynchronous GPU timer results when the browser supports them.

Auto starts with a bounded native-resolution budget, caches stationary table shadows, and reduces practical light loops using a fixed-size proxy pool. It retains the full lighting setup for room reflections. Quality changes require sustained timing windows; a stable 60 Hz display is not treated as overloaded merely because the desktop target is 120 FPS. GPU/CPU headroom and observed missed refresh intervals determine downgrades. Phone-class touch controls start with a 16.67 ms budget and lower pixel cap. Manual High/Ultra preserve the fuller lighting/postprocessing path.

The photographs use shared atlas textures, and the neon glow uses authored emissive/baked materials. Adding them does not add dynamic lights or image decoding to the per-frame loop.

The recorded 2026-09-14 foreground Chrome sample achieved **143.9 FPS** over 2,160 frames at a 1666×1045 render size, Auto/Light, with 7.7 ms p95 frame intervals. The scene includes the new Blender decor and photographs. Full data: `art/benchmarks/browser-cue-auto.json`. This is a fixed shooting-view workload with animated guides and screens; it is not a mobile/4K result or a promise for every live shot and effect.
