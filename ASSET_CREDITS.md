# Asset credits

## Table audio

- **billiard ball clack** by **Za-Games** — [Freesound source](https://freesound.org/people/Za-Games/sounds/539854/), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Used in `public/audio/clack-1.wav` and filtered cushion/block impacts.
- **SPRTIndor-BILLIARDS_Billiard Ball Cue Hit 01_KVV AUDIO_FREE** by **KVV Audio** — [Freesound source](https://freesound.org/people/KVV_Audio/sounds/851086/), [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Used in `public/audio/cue-1.wav`, `cue-2.wav`, and `cue-3.wav`.
- **SPRTIndor-BILLIARDS_Dropping Ball In Pocket 01_KVV AUDIO_FREE** by **KVV Audio** — [Freesound source](https://freesound.org/people/KVV_Audio/sounds/851090/), [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Used in `public/audio/pocket-1.wav`, `pocket-2.wav`, and `pocket-3.wav`.

Adaptations: short gameplay clips cut from the available high-quality previews, downmixed to mono, resampled to 48 kHz, normalized and faded. During play these receive impact-dependent gain, subtle pitch variation, stereo positioning, filtering and room reflections. The bundled clips are incorporated into the game; they are not presented as an independent stock sound library. No endorsement is implied.

Cushions use a low-pass-filtered, pitched version of the recorded ball impact. The quiet cloth rolling bed, short room impulse response, chalk scraping, coin insertion and release mechanism are generated in code. The release animation also layers the credited ball-clack recording.

## Table surface

**Wood Table 001** by **Dimitrios Savva** (photography) and **Rico Cilliers** (processing), via [Poly Haven](https://polyhaven.com/a/wood_table_001), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The 2K diffuse, OpenGL normal and roughness maps are bundled as `public/wood-color.jpg`, `wood-normal.jpg`, and `wood-roughness.jpg`. Material color and mapping are adjusted for the table rails.

## Pub flooring

**Monastery Stone Floor** by **Amal Kumar**, via [Poly Haven](https://polyhaven.com/a/monastery_stone_floor), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The 2K diffuse, OpenGL normal and roughness maps are bundled as `public/textures/pub/stone-*.webp`, compressed at quality 88 (color/roughness) and 95 (normal), with repeat mapping and material tint adjusted for the pub. Original hashes and sizes are retained in `public/textures/pub/source.json`.

## Pub furniture

**Metal Stool 01** by **Ulan Cabanilla**, via [Poly Haven](https://polyhaven.com/a/metal_stool_01), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The original glTF mesh (8,334 triangles) and 2K color, normal and packed material maps are bundled in `public/models/stool/`. Instances share geometry and textures and are scaled into the pub. No external asset service is required during play.

## Brick architecture

**Medieval Red Brick** by **Rob Tuytel**, via [Poly Haven](https://polyhaven.com/a/medieval_red_brick), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Scanned 2K diffuse, OpenGL normal and roughness originals are stored in `art/blender/textures/`; WebP maps are served in `public/textures/pub/brick-*.webp` and embedded at 1K in the optimized fireplace. Material UVs use its physical 2 × 2 metre scale. Official source hashes and conversion settings are in `public/textures/pub/brick-source.json`.

## Blender-authored pub collection

Thirty-two original props were authored through the locally installed Blender MCP add-on and exported to `public/models/pub/`. Editable source and reproducible authoring scripts are in `art/blender/`; `scripts/optimize-pub-assets.py` runs glTF Transform 4.5.0 to simplify geometry and package 1K WebP textures. The walnut material reuses the credited Poly Haven Wood Table 001 maps. Leather grain, labels, upholstery, hardware, neon, records, furniture and bottle shapes were created for this project. Models use meters scaled to this game’s table; room props are decorative and do not alter table collisions.

Nine additional shelf LOD files (`liquor-*-lod.glb` and `bottle-*-lod.glb`) are derived from those original bottle recipes using native Blender background exports. `scripts/create-liquor-lods.py` retains label lettering and materials while replacing microscopic embossed lettering with flat vector text and reducing cap, bevel and radial detail. Original hero files remain available. The reproducible count and bounds checks in `scripts/liquor-lod-report.json` record 847–1,397 triangles per LOD, reductions of 86–94%, with unchanged width/height and at most 1.1 mm less label depth.

The additional architecture collection includes an arched brick fireplace with oak mantel, clock, candlesticks, forged grate and ember logs; a three-shade brass lamp with linked suspension chains; paneled leaded-glass snug dividers; carved pub, darts and stout frames; coopered casks; and ale handpumps. Sources are `pub-architecture.blend` and `pub-finishing.blend`, with corresponding `create_pub_*.py` scripts. Cycles previews, optimization receipts and glTF validation results are in `art/blender/`. These original models use the credited brick and wood scans.

The room expansion adds a carved photo frame, a television with mounting hardware, a slot cabinet, five spirit/wine bottles and five cocktail/glass models. Their sources are `art/blender/create_pub_photo_frame.py` with `pub-photo-frame.blend`, `create_pub_entertainment.py` with `pub-entertainment.blend`, and `create_pub_drinks.py` with `pub-drinks.blend`. Bottle labels and brands are fictional. Instanced placement supplies 185 bottles in total and 19 cocktails and other drinks in addition to the existing pints. Three slot cabinets are decorative; the two television screens show original football and rugby animations generated in code, with no broadcast footage, betting or payouts.

## Original gallery artwork

Four artworks were created for the game using the built-in image-generation tool: a sepia football-team group photograph, a black-and-white darts-club group photograph, a faded-color rugby-team group photograph and an oil-style painting of a village pub. The depicted people, teams and places are fictional; these are generated images, not archival photographs.

The source atlas is `art/blender/textures/gallery-atlas.png`, with the generation prompt retained in `art/blender/gallery-image-prompt.md`. The browser uses `public/textures/pub/gallery-atlas.webp`, converted at WebP quality 91 and cropped through UV windows into four framed images. The frame geometry is the original Blender photo-frame model described above.

## Room composition and effects

The close-view table materials in `src/render/table-surfaces.ts` include fine wool baize authored and baked through Blender MCP, plus original pebbled leather, brushed brass, maple shaft and spliced hardwood maps. Walnut reuses the credited CC0 scans above. Pocket sleeves, castings, stitching and shot-path shaders are original geometry and code. Ball reflections are captured from this game's room; the supplied commercial-game screenshot is used only as a visual reference and is not bundled as artwork or a texture.

The expanded room has 50% more floor area while retaining the original pool-table and furniture scale. The wall-backed jukebox, camera-dependent wall and ceiling cutaways, and separately visible hanging billiard fixture are implemented in the game. Other modeled geometry, ball number textures, felt and effects are generated in this project. Google Fonts in `index.html` have system font fallbacks.


## Club photo collection and memorabilia

Twenty additional fictional pool-club photographs cover the 1980s, 1990s, 2000s, 2010s and 2020s, four scenes per decade. They were created with the built-in image-generation tool; they are original generated scenes, not historical records or photographs of real club members. Five shared 1024-square WebP atlases total 731,890 bytes. Source PNGs, full prompts and a scene/hash manifest are retained; see `art/pool-photo-collection.md` and `art/prompts/pool-club-decades.md`. An additional original six-photo pool-events collage uses `art/prompts/pool-club-photo-atlas.txt`.

Three new wall sets, `club-decor-left.glb`, `club-decor-right.glb` and `club-decor-front.glb`, contain original championship cups, display woodwork, poster boards, neon glass and glow surfaces. They were modeled natively in Blender via its installed MCP extension, then exported with `art/blender/create_pub_club_decor.py`. Editable source is `art/blender/pub-club-decor.blend`; the export report records 4,966 triangles. New gallery frames reuse the existing Blender photo-frame model. Runtime code supplies print/glow textures and places imported meshes; it does not model these new objects.

The fine baize material was authored and Cycles-baked through Blender MCP using `art/blender/create_fine_baize.py`. The editable `fine-baize.blend` and bake report accompany 2K color and 1K normal/height/roughness maps. The browser uses the packed `baize-surface.png` for height and roughness, together with the color and normal bakes. The old coarse cloth generation is no longer used.
