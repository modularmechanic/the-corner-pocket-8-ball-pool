# Asset installer (candidate A)

Branch: `refactor/asset-installer` (from baseline `66ac895`). Glossary: `CONTEXT.md` (Pub, Prop, Placeholder, Settled, Cutaway).
Status: in progress. Baseline: 188/188 tests, tsc clean, vite build OK. Before screenshots: session scratchpad `before/*.png` (9 views of `art/pub-review.html`).

## Goal
One deep module, `src/render/asset-installer.ts`, owns every file-backed prop load. pub-* area modules keep only placements + per-URL preparation callbacks.

## Settled decisions
| # | Decision |
|---|---|
| Q2 | Scope: every file-backed render asset, including `table-surfaces.ts` baize + wood. Audio stays out. |
| Q3 | Placeholders stay visible until the prop arrives (current behaviour). |
| Q4 | Failure: `console.warn(url)`, keep placeholder, record the failure in the settled result. |
| Q5 | Settled signal = promise resolving `{ loaded: string[], failed: string[] }`, plus a revision number bumped on every swap. No progress counts. |
| Q6 | Installer accepts a loader adapter: three GLTFLoader/TextureLoader in the browser, in-memory fake in Node tests. |
| Q7 | Wire `MeshoptDecoder` (three/examples/jsm/libs/meshopt_decoder.module.js) into the GLTF adapter now. Do NOT compress assets in this branch. |
| Q8 | Per-prop quirks are preparation callbacks, not a declarative spec. Installer owns URL resolution, cache, error policy, placeholder swap, disposal, pending/settled/revision. |
| Q9 | Cache by URL; one preparation per URL runs once on the parsed source (wall-panel x4 shares it). Clone-mode installs clone. |
| Q10 | On successful swap, remove + dispose placeholder. On failure, keep it. Shared placeholder sources (pub-drinks shelf/hero) are released after the last install using them settles. |
| Q11 | Disposed before arrival: discard + dispose the result on arrival. No network abort. |
| Q12 | Rewrite `tests/table-surfaces.test.ts` against the fake adapter; delete `TextureLoader.prototype.load` patching. Keep its assertions' intent. |
| Q13 | Generic fixups applied by installer to every GLB: transparent -> depthWrite=false; one anisotropy value (8; renderer clamps to device max, WebGLTextures.js:658). Remove per-site clamps and the `renderer` pass-through arg. Stool gets the fixups too. Canvas screen textures stay owned by entertainment. |
| Q14 | Dependent loads (gallery atlases after photo frame) go through the installer so settled waits for them. |
| Q15 | room-reflections: delete fingerprint polling. Capture when table stable (as today), recapture once when installer settles and on later revision bumps (respect existing cooldown). |
| Q16 | Fix bottle placeholder parent bug (placeholders in `backBar` pub.ts:110, models in `backWallFittings` :121). No new placeholders for gallery frames or club decor. |
| Q17 | Unused asset files NOT deleted in this branch. |
| Q18 | Area files stay; inline loads in pub.ts stay in pub.ts. |
| Q19 | Declared paths relative to `public/`, no leading slash; installer resolves with `import.meta.env?.BASE_URL ?? '/'`. Add `vite/client` to tsconfig types if needed. |

## Load-site catalog (explorer, 12:56)
- pub.ts:24-56 `installModel` (16 GLBs incl. wall-panel x4 :235,238,240; jukebox "Optical glass"/"Black enamel", wall-panel "Warm plaster", pint "Optical glass" rules); pub.ts:57-60 wood jpg x3; :75 stone webp x3; :131 stool gltf (inline new loader, no fixups).
- pub-interior.ts:72 brick webp x3 (own TextureLoader, aniso hard 8, no dispose).
- pub-dressing.ts:93-111 fireplace, memorabilia x3 (+ `extra` targets), handpump, snug-divider, cask-stack.
- pub-drinks.ts:109-166 bottles lod (shelf) + hero, drinks x5; name rules Drink Glass/Ice/Liquid; post-instance glass castShadow=false, renderOrder 2/3; instanced placeholder source shared lod+hero; :111 disposes shared source on empty placements (hazard).
- pub-entertainment.ts:134-172 slot-cabinet, sports-tv; clone per anchor + canvas screen material; post-load `batchPubStatic(root,'subtree')`; no screen material -> dispose scene, keep placeholder.
- pub-gallery.ts:84 gallery-atlas; :92 photo frame (clone + "Gallery artwork" swap, instancePubModel 1 placement, subtree batch; no onError); :41,56 decade atlases drawn into canvas then disposed; :74 events atlas.
- pub-club-decor.ts:64-90 club-decor-{left,right,front}; canvas maps by material name; whole scene added; no onError.
- table-surfaces.ts:75-90 baize png x3; :103-111 wood jpg x3 (duplicate of pub.ts wood).
- Handles: scene.ts uses `buildPub().group/withEnclosedRoom/update/dispose` only. Cutaway depends on parent group membership, not GLB node names.
- Tests: no test runs a builder or GLTFLoader. Preserve exports `POOL_DECADE_GALLERIES`, `applyPoolPhotoRegion`, `PUB_ENTERTAINMENT`, `PUB_CLUB_DECOR`; no module-scope `document` access; keep `instancePubModel`/batching identity + dispose-once semantics.

## Steps
1. `asset-installer.ts` + `tests/asset-installer.test.ts` (fake adapter): one parse per URL, placeholder swap+free, failure keeps placeholder + reported, dispose before arrival, nested loads counted, settled + revision.
2. Migrate `table-surfaces.ts` (shares wood cache with pub) + rewrite its test.
3. Migrate pub.ts, pub-interior, pub-dressing, pub-drinks (fix parent bug), pub-entertainment, pub-gallery, pub-club-decor. Remove `renderer` arg + per-site aniso.
4. room-reflections consumes settled/revision; delete fingerprint.
5. `tests/asset-paths.test.ts`: every declared path exists under `public/`.
6. Verify: `npm test`, `npx tsc --noEmit`, `npm run build`; browser: pub-review loads with zero failures, after screenshots vs before.
7. Code review pass; commit.

## Success criteria
- All tests green; tsc + build clean.
- No asset URL string starting with `/` in src/render.
- wall-panel.glb and wood-*.jpg parsed/uploaded once.
- Visuals match before screenshots (minor depthWrite/aniso differences acceptable, documented).

## Risks
- Shared cached materials mutated by preparation: enforce one preparation per URL.
- Freeing placeholders that share geometry with live placeholders: rely on disposePubObject retire path; test dispose-once.
- Reflections recapture cost: at most one extra capture on settle.
