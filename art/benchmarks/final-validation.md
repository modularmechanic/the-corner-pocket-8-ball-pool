# Graphics and camera validation — 14 September 2026

- `npm test`: 188 passed, zero failures. Includes AI camera readiness, repeated AI/human transitions, held camera controls, two-click shot setup, cue progression, high-power physics and multiplayer authorization.
- `npm run build`: successful. Vite retains its existing large-bundle warning; the main compressed JavaScript bundle is approximately 1.21 MB.
- Foreground Chrome: 15-second warmed shooting-view sample, 2,160 frames, **143.9 FPS**, 7.7 ms p95 frame intervals, 1666×1045 render resolution, Auto/Light. Full measurement and limitations: `browser-cue-auto.json`.
- Browser smoke check: menu → session setup → AI game; first click locks aim; power slider enables; second click takes a full-power break; the rack disperses and AI play returns control. Split scoreboards display the assigned groups and potted balls. Cue collection shows five cues with level locks. F/V, the FPS button, chalk and contact controls respond.
- Desktop overhead table is centered. A temporary 390×844 browser viewport override also fits the full table vertically and retains both scorecards and accessible touch controls; the override was reset. This checks responsive layout, not phone hardware FPS.
- New felt was inspected at shooting distance, overhead and phone size; the coarse generated nap is gone. Blender's 2K albedo and 1K normal/packed surface bakes are shared with the cushions. Browser console contained no errors.
- New trophies, poster boards and neon geometry are imported from three Blender MCP exports. New frames reuse the existing Blender frame model. The gallery and decor loaders contain no runtime `BoxGeometry`, `LatheGeometry`, `TubeGeometry` or `PlaneGeometry` construction.

The generated photo collection, exact prompts and runtime sizes are indexed in `../pool-photo-collection.md`. The independent pub census including all new decor records 338 draw submissions and 1,243,563 triangles, versus the original 460 and 3,171,110. Those are whole-room geometry counts, not per-frame totals.
