# The Corner Pocket

A browser-based 3D eight-ball game set around a walnut pub table. Built with TypeScript, Three.js, Rapier physics and Socket.IO.

## Run the game

Use Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The same process serves the game and the multiplayer room server, and the page connects to it (`VITE_ROOM_SERVER_URL=same-origin`). Set `PORT` to change the port.

## Play

- **Aim:** in the default low view, move the mouse left or right to turn the cue and camera together. Overhead and orbit views aim at the point under the cursor.
- **Two-click shooting:** aim and click to lock direction. Pull back along the cue to set power, then click again to shoot. Before either click, hold S and move to set cue-ball contact, or hold E and move vertically to set cue elevation. Release the key to resume aiming or charging. Touch users can toggle the contact/elevation buttons.
- **Pointer lock:** in the behind-the-cue view the first click only takes the cue: the browser hides and locks the pointer ("Click to take the cue · Esc to release"), so turning never stops at the screen edge. Aim, power and right-drag/R orbit then use mouse movement, and the lock lasts across shots and pass-and-play turns. Escape or leaving the window releases it and cancels the setup; menus, overhead or table views, ball in hand and turns you do not play release it without cancelling. Browsers without pointer lock keep the plain click flow.
- **Alternative controls:** the shot button or Space locks aim, then shoots. Arrow keys adjust aim or power; hold S with arrows for contact, E with arrows for elevation, and Shift for finer adjustments. X resets the contact and elevation. The power slider becomes available after the first click.
- **Touch screens:** phones and tablets start in an overhead view fitted between the controls (the camera button switches to the cue view and back). Turn the aim dial at the bottom left, tap **Engage cue**, drag the power slider on the right, then tap **Shoot**. Tapping the table never shoots; letting go of the slider does not shoot; tap **Cancel cue** to disengage. Using a mouse again restores the desktop controls.
- **Chalk:** click the chalk icon or press C before shooting for a one-shot grip buff that improves off-centre strikes.
- **Table return:** inspect the glass-fronted ball return with the table-view button. Click the coin slot or coin button to animate and sound the release mechanism and start a fresh rack. Online resets are available after the rack ends; rail coins are decorative.
- **Camera:** the default view sits behind the cue at ball height, 35% farther back than the previous camera. After a shot it pulls straight back over 0.58 seconds, preserving the horizontal heading and level horizon. Automatic AI turns keep that steady overview; the AI waits for camera alignment before its backswing. Returning to shooting view takes 0.65 seconds. Hold the right mouse button or R and move to orbit; releasing restores the selected view. R + arrow keys rotates without the mouse. F or the FPS button returns to shooting view; V toggles centered overhead. Selecting a different camera requires a fresh aim lock, preserving contact/elevation.
- **Cancel a setup:** Escape or leaving the window. Temporary orbit preserves the prepared strike.
- **Cue collection:** press B or open the trophy button. Five level-unlocked woods/weights trade power, draw and curve. Equipment belongs to each seat, including doubles; online stats and unlocks are validated by the server.
- **Shot guide:** twin white rails animate arrows toward contact. A colored outgoing fan widens with the cut angle; head-on shots show parallel rails. Green/yellow/red combines angle and power as a visual difficulty cue, not a pot probability.
- **Scoreboard:** each team has its own side card; potted balls are shown in full color.
- **Ball in hand:** click a clear spot on the felt when you have ball in hand. Under Old Rules, place it behind the head string.
- **Solo:** choose Casual, Regular, or Expert. The AI evaluates clear potting paths and cut angles, with different aim error and shot selection by difficulty. Select Doubles for you and an AI partner against two AI opponents.
- **Pass & play:** select the gamepad button and share the mouse.
- **Friends:** select the friends button, open a table, and share the six-character room code or invitation link. Friends join through the same room server. Builds without a room server hide the friends entries, and invitation links show that online play is unavailable. Choose Singles for two players or Doubles for four.

Room codes seed the rack. The server owns online physics, legality, turns and the result, and targets 60 rolling-state broadcasts per second. Singles has two seats; doubles has four, with seats 1 + 3 against 2 + 4. Everyone must be connected before shooting. A temporary network disconnect preserves the seat and game; the open tab reconnects automatically. Rooms are held in memory and expire after ten minutes with all players disconnected. A server restart clears rooms.

For friends on the same network, use the host computer's LAN address in place of `localhost`. Friends over the internet need a publicly reachable deployment of the complete Node server. A static build provides multiplayer only when `VITE_ROOM_SERVER_URL` names a reachable room server (see Production).

## House rules

Choose **Old Rules** or **New Rules** on the setup screen; the choice holds for the whole session, including rematches and new levels. Old Rules is the default and your last choice is remembered. In a private room everyone plays the host's rules.

- **New Rules:** after a foul, the opponent has ball in hand anywhere on the table and one normal visit.
- **Old Rules:** after a foul, the opponent has two shots. If the cue ball was potted or left the table, they place it behind the head string; otherwise they play it from where it stopped. Both shots follow the normal contact rules. A legal pot on the first shot turns the two shots into an ordinary visit; a legal miss leaves the second shot, after which ordinary rules apply. A foul while holding two shots loses the remaining shot and gives the other side one visit. In doubles the two shots belong to the team, and partners still alternate.

Doubles uses Scotch doubles: partners alternate after every completed shot, including a legal pot that keeps their team at the table. Each team shares its ball group, score, chalk and power-ups. Only the current teammate can shoot or place the cue ball; reconnecting preserves the seat and shot order.

The game includes solids/stripes assignment, continued turns after legal pots, first-contact fouls, scratches, ball in hand, early-eight losses and legal-eight wins. Groups remain open on the break. A legal break pots a ball, hits an obstacle, or drives at least four object balls to cushions. Obstacle contact counts as a legal shot and a rail action; wrong-ball-first fouls still apply. An eight on the break is respotted. This house does not require called pockets. Off-centre contact supplies draw, follow and cushion sidespin. Raised side strikes curve on the cloth, with the response depending on power, elevation, tip contact and chalk. Hard low-tip strikes can jump: use more than 55% power and contact below the centre, or add cue elevation for lift. This low-tip scoop is an arcade allowance. Balls use real 3D collision height, gravity and cloth landings; they can clear or clip other balls. Airborne balls do not collect pickups or activate terrain and only enter pockets at cloth height. Leaving the table is a foul; object balls are respotted, and an off-table eight loses except on the break.

## Power-ups and fresh tables

Every match is arcade eight-ball. There is no separate arcade toggle or ability loadout.

- Only the moving **white cue ball** collects power-ups. Distinct glowing flame, ice, shield, crosshair and portal models identify each reward. Two start on the table; seeded timers spawn more every 5–9 seconds and expire them after 12–20 seconds, with at most three available. The effect is queued automatically for the next applicable shot; Frostbite affects the opponent.
- **Overdrive** adds 30% cue speed and double block damage. **Scratch shield** saves a cue-ball scratch, except when the eight is potted. **Deadeye** extends the object-ball aiming preview. **Frostbite** reduces shot speed by 35%.
- **Comeback buffs:** scratching on two or more consecutive shots of your own awards a hidden, randomly selected positive effect. The opponent's intervening shots do not reset your scratch streak. A shot without a scratch resets it, including a scratch successfully rescued by Scratch shield.
- **Debuffs:** potting one of your own balls and an opponent's ball in the same shot applies a random debuff. Crossing five consecutively potted own balls also applies one. A miss or foul resets the pot streak. Debuffs include a weakened shot, a hidden aiming guide and extra cue-ball drag.
- Blocks have **1–4 HP**, shown by lights on their tops. Hard impacts deal two damage, softer impacts one. Destroying ordinary blocks drops more visible power-ups. Purple hex blocks curse the aiming preview.
- Choose **Crossfire**, **Fortress**, or **Hex Gauntlet** in Settings. Every new rack generates a fresh seeded arrangement, with an open break corridor and clearance between props and balls. Multiplayer uses the server's exact same layout for every player.
- **Portals** only appear from portal power-ups. A collected portal power opens a safely placed pair after the current shot finishes and lasts for the next two completed shots (including retained turns), then disappears. Portals preserve speed and only use clear exits; **ramps** raise and boost a passing ball; **electric pads** accelerate it; **water/slime** add drag; **smoke** curses the cue's next aiming guide. Their visible footprints match the simulation.

## Level progression

Start at level 1 with one breakable block and no terrain. Winning against the house unlocks the next level, up to five; pass-and-play rack winners also unlock progression. Each level adds a small number of obstacles and hazards, capped at five blocks and three terrain patches. Choose unlocked levels in the main menu. The result screen offers **Next level** after a win or **Replay level** to retry. Private rooms use the host’s chosen level; players can advance together after a completed rack.

## Scores and replay

The animated menu opens with **Start Game**, then mode and level selection, and **Start Session**. Select the AI, pass-and-play or online mode before starting. Three AI difficulties, Settings, the private lobby and a resumable local match remain available. Opening a menu keeps the running match and pickup clock going. Local AI planning pauses while a dialog is open or the tab is hidden; elapsed simulation time catches up after browser throttling. An online room pauses its idle clock when a player disconnects, while any shot already in motion finishes. Rematches generate a new rack and arrangement.

Legal own-ball pots award 100 points each, with a multi-pot bonus; winning on the eight adds 500. Blocks award 50 points per starting HP, pickups award 25, and ramp/electric activations award 15 once per ball/pad per shot. The live scoreboard tracks points independently of the eight-ball winner. The eight best completed results are saved on the current device.

## Sound

Recorded cue strikes, ball clacks and pocket drops replace the synthesized impact tones. Impacts have position-aware stereo, speed-dependent volume, small pitch variations and short room reflections. Cushion hits are filtered from the ball recording. Coin insertion, the sliding release mechanism and chalk scraping use generated audio, with recorded clacks layered into the ball release. Sound requires an initial user gesture; Settings includes a preview and volume slider.

[Asset sources, licenses and adaptations](ASSET_CREDITS.md) are also available from Settings → Asset credits.

## Graphics

- Glass-fronted ball-return chamber with numbered pocketed balls, a moving coin mechanism and rail-top tokens.
- Open pocket throats with recessed leather liners, rubber lips, stitched corner/side saddles and worn brass castings. The table foundation has matching through-holes. Woven baize uses fine normal and roughness detail; rails and side panels use scanned walnut. The cue has longitudinal maple grain, spliced hardwood and brushed brass collars.
- Glossy resin balls reflect a filtered cubemap captured inside the actual enclosed pub. Captures update after room assets load, omit balls/cues/guide overlays, and are reused during play.
- Solid white shot paths, a contact ring, and separate object-ball and cue-deflection previews. These grounded geometric guides use shared collision queries and stop at balls, cushions, obstacles and portals; they do not predict a complete curved or airborne shot.
- Thirty-two Blender-authored GLB assets: pub furniture, fireplace, chained brass billiard lamp, dividers, carved frames, casks, handpumps, wall-mounted television and slot cabinet, plus nine bottle shapes and five cocktail/glass designs. Repeated props share geometry and materials.
- The pub has 50% more floor area, with the original table and furniture scale preserved. Its four walls contain an entrance and sidelights, six curtained windows, two exposed-brick gallery bays, burgundy seating areas, dartboard, radiators, a stone pier and ceiling beams. Walls and ceiling cut away according to camera position. The hanging pool lamps remain visible in clear oblique views and disappear when their projected silhouette would obstruct the table.
- Stocked bar with 185 bottles, 42 stemmed glasses, taps, till and serving details. Seven tables, four booth benches, ten loose chairs and imported CC0 stools keep clear aisles around the pool table. Nineteen additional cocktails and drinks sit beside the existing pints. The record-filled jukebox rests against the left wall and faces into the room. Repeated props are instanced and room trim is batched by material and wall.
- Three decorative slot cabinets run animated attract screens. Two televisions show original animated football and rugby scenes; these are fictional animations, not live broadcasts. The cabinets do not accept wagers or affect the match.
- Thirty distinct generated club images appear inside Blender-authored frames: twenty photographs spanning the 1980s–2020s, a six-photo pool-events collage, and the existing four gallery artworks. Five shared decade texture sheets total 715 KiB. Prompts and previews are indexed in `art/pool-photo-collection.md`.
- New championship cups, framed poster boards, and amber/cyan neon glass are authored through Blender MCP and loaded from three GLBs. They add no dynamic lights; editable source is `art/blender/pub-club-decor.blend`.
- Scanned 2K wood color, normal and roughness maps, scanned worn-stone and brick flooring/wall maps (color and normal at 1K, roughness at 2K), Blender-baked fine baize with subtle bump/normal mapping, and high-resolution ball textures.
- Pub GLBs are not mesh-compressed. `gltf-transform meshopt` also quantizes positions onto node transforms, which misplaced the gallery artwork (built from raw frame geometry); the loader still registers `MeshoptDecoder` for a future non-quantized pass.
- Numbers are baked into the sphere textures. Numbers and stripes rotate together according to the ball's distance traveled; there are no floating number labels.
- Pooled explosion fragments, shockwaves, fire and ice trails, branching lightning, portal ribbons and brief colored lighting.
- Dark evening ambience with focused table spotlights, warm area lighting across the bar and its bottles, gentle table-cabinet bounce, booth lamps, jukebox glow and nighttime windows. Physically based resin materials, custom light reflections, three fixture-aligned table shadow maps, furniture contact shading, soft ball shadows and subtle bloom in High/Ultra.
- Auto is the default and adjusts lighting, shadows, bloom and render resolution using sustained frame/CPU/GPU measurements. It targets an 8.33 ms desktop render budget and 16.67 ms on touch devices, with hysteresis to avoid quality pumping. It never forces supersampling above native display density. High and Ultra remain manual options; Ultra has an 8.3-megapixel cap and 2048-pixel table shadows. Performance uses a fixed lower-cost budget. Settings show measured FPS and render resolution; achieving 120 FPS also requires a suitable browser, GPU and display refresh rate.
- Low cue, straight-overhead and inspection cameras, with right-drag orbit and reset view. Settings include aiming guides, graphics and sound.

Rendering uses Three.js/WebGL 2 and GLSL shaders. Static table shadows are cached, room reflections are captured after asset loading settles, and a fixed-size pool limits the practical lights evaluated per pixel in Auto/Performance. Static pub geometry is batched and shelf bottles use Blender-authored lower-polygon variants. These retain the original close-up models. Including the added memorabilia, the pub census has 338 draw submissions and 1,243,563 triangles, down from the original 460 and 3,171,110. See `art/benchmarks/pub-batching.md` and `art/benchmarks/pub-club-decor-after.json`.

WebGL 2 and hardware acceleration are required. Mouse and touch shot setup are supported. The canvas responds to resizing; portrait screens automatically rotate the table to keep the balls larger. Phone and tablet controls respect screen safe areas. Gameplay assets are served locally; Google Fonts is optional and has local serif/sans-serif fallbacks.

## Production

```sh
VITE_ROOM_SERVER_URL=same-origin npm run build
npm start
```

`VITE_ROOM_SERVER_URL` is read at build time: `same-origin` uses the serving Node process, an `https://` URL uses a separate room server, and unset or empty hides online play (plain `npm run build` for static hosting). A room server accepts cross-origin browsers only from the comma-separated `CORS_ORIGIN` list; unset allows same-origin pages only. See `.env.example`.

Deploy the application to a Node host with WebSocket support, or use the included Dockerfile:

```sh
docker build -t corner-pocket .
docker run --rm -p 3000:3000 corner-pocket
```

Use one server instance, or sticky routing with shared room/physics ownership if extending the server to multiple instances. Put HTTPS in front of public deployments.

### GitHub Pages

Play solo and pass-and-play at [modularmechanic.github.io/the-corner-pocket-8-ball-pool](https://modularmechanic.github.io/the-corner-pocket-8-ball-pool/). Every push to `main` runs `.github/workflows/deploy-pages.yml`: tests, then a static build with `--base=/<repository>/` and no room server, so online play is hidden. To offer Friends mode from Pages, host the Node server separately, set `CORS_ORIGIN` on it to the Pages origin, and add `VITE_ROOM_SERVER_URL` to the workflow's build step.

## Verification

```sh
npm test
npm run build
```

Tests cover pure shot settlement and presentation, engine arrangement and mid-shot restore, shared geometry, local/hosted Match parity, remote reconnect recovery, deterministic racks, breaks, isolated collisions, high-power stability, obstacle durability, ability lifetimes, cue spin/chalk, white-ball-only timed pickups, two-click controls and held modifiers, camera projection/orbit, airborne collisions and network flight interpolation, placement, eight-ball rules, AI sequences, singles and Scotch-doubles partner rotation, team results, four-client multiplayer authorization/synchronization, room expansion and cutaways, hanging-light visibility, and decorative screen animation. Verification is `npm test`, type checks (`npx tsc --noEmit`), production builds and the headless scene census `scripts/benchmark-pub-batching.ts`; none of them see the rendered image, so visual changes need a manual look.

Blender source, reproducible authoring scripts, Cycles asset previews and glTF validation receipts are in `art/blender/`. The expansion sources include `create_pub_photo_frame.py` / `pub-photo-frame.blend`, `create_pub_entertainment.py` / `pub-entertainment.blend`, and `create_pub_drinks.py` / `pub-drinks.blend`. The gallery atlas source is `art/blender/textures/gallery-atlas.png`; its prompt is `art/blender/gallery-image-prompt.md`. Development-only `/art/pub-review.html` and `/art/shot-review.html` provide fixed room, shot and pocket views. `/art/performance.html` records a repeatable 15-second browser frame sample; these fixtures are not included in the production game. CPU and geometry benchmark commands and their limitations are documented in `scripts/PERFORMANCE.md`.

## Architecture

The browser talks to one Match interface for shoot, place, chalk, equip, reset, rematch and advance. The local adapter owns the engine, AI seats, command authorization and time; the remote adapter owns room transport, reconnects and delayed ball/event presentation. The server runs the same local adapter behind its authenticated room seats. Game rules settle through a pure function, while Rapier applies the returned state and respots. Tests and replay callers edit detached snapshots and restore them through `arrange()` instead of manipulating physics handles.

Shared table geometry keeps AI, layout generation, placement and the aiming guide consistent. The presentation model supplies status, team effect pills and scene effects from one catalog, distinguishing a power queued for the next shot from an effect already active on the current one.

Source boundaries:

- `src/match/`: command interface, local/remote adapters, room protocol, timing and progression eligibility.
- `src/simulation/`: serializable game state, pure settlement, shared table geometry and level policy, AI and private Rapier engine.
- `src/presentation/`: pure HUD/scene view models and the effect catalog.
- `src/render/`: Three.js scene; `asset-installer.ts` loads every file-backed prop (cache, placeholders, settled signal); `table-model.ts` and `arena-visuals.ts` build the table and arcade obstacles/hazards/pickups; adaptive light, shadow and effect budgets.
- `src/ui/`: DOM shell, `player-profile.ts` (preferences, records, unlocks), `shot-input-controller.ts` (DOM-free controls), `hud-writer.ts` (change-only HUD writes) and sampled table audio.
- `server/`: HTTP/Vite hosting, room seats/tokens and transport around the authoritative Match.
- `tests/`: rules, simulation and multiplayer integration tests.
