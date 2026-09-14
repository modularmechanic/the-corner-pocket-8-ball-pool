# Architecture review implementation

Source: `architecture-review-20260914-1030.html`, supplied by the user on 14 September 2026. All five recommendations were audited against their requested boundaries. All five implementations and the combined repository verification below are complete.

## 1. Match module

`src/match/types.ts` defines one command interface for shooting, placing, chalking, resetting, replaying and advancing. `LocalMatch` owns the engine, authenticated turn checks, Scotch-doubles actors, AI scheduling and previews, fixed stepping, queued events and cached detached state. AI actions enter the same command authorization core as human actions. Public human dispatch cannot take over an AI seat.

`RemoteMatch` owns Socket.IO, room requests, acknowledgements, pending commands, reserved-seat reconnection and the snapshot/event timeline. `protocol.ts` supplies client/server packet types used by both adapters, the room server and socket tests. `main.ts` sends Match commands, advances elapsed time and renders state; it no longer owns a physics accumulator, AI planner, socket request fork or network interpolation queue. `server/rooms.ts` retains seats, tokens, transport and publication while delegating gameplay to the same `LocalMatch`. The old UI session/interpolation files only reexport implementations from Match for existing test consumers.

The shared capabilities expose reset, rematch and progression eligibility. Match progression rejects advancing beyond the final level; replay remains available. `src/simulation/level-policy.ts` owns the level cap and normalization used by both arena construction and Match progression.

Evidence: five Match tests cover local/hosted command parity, turn authorization, all three doubles AI seats, menu-independent pickup time, disconnected-room behavior, reset/progression and timeline ordering. Four existing session/interpolation tests pass. Twelve real localhost Socket.IO tests pass, including four-player authorization, reconnect reservation, authoritative airborne snapshots, timed effects, and a `RemoteMatch` transport-loss/recovery test. The focused RemoteMatch test was rerun after request cancellation handling changed and passed.

## 2. Pure shot settlement

`src/simulation/settlement.ts` owns shield rescue, foul and winner evaluation, group assignment, turn retention, Scotch-doubles rotation, pot scoring, combo/streak awards, respot targets and portal lifetime. `settleShot` clones its inputs and returns state, outcome, respots and events without accessing Rapier. One own-group pot count feeds retention, scoring and streaks. `PoolGame` applies the returned state, moves physical bodies to returned respots and emits returned events. The previous `rules.ts` implementation and duplicated arcade settlement path have been removed.

The rule decision raised by the review is explicit: a cue-ball scratch rescued by Scratch shield does **not** count toward the comeback scratch streak. Pocketing the eight with the cue remains a loss; off-table fouls also bypass the shield.

Evidence: eight pure tests pass for input immutability, seeded repeatability, group assignment, foul cases, shield behavior, mixed pots, scratch/pot streaks, eight-ball outcomes and exactly two subsequent portal settlements. These tests do not initialize Rapier.

## 3. Engine arrangement and restore

`PoolGame` keeps its Rapier world, bodies, colliders and mutable state private. Its public state view rejects mutation. `snapshot()` returns detached editable data; `arrange(state)` validates and rebuilds ball/body and obstacle/collider state. Continuation metadata preserves contacts, previous shot events, spin, hazard cooldowns and seeded pickup scheduling when restoring a rolling shot. The test-only obstacle constructor option has been removed; fixtures arrange the intended table state instead.

Existing simulation and room fixtures use snapshot → edit → arrange. No test reaches into a `PoolGame` world or finds its bodies by Rapier handle. The geometry suite separately uses Rapier shape casts to verify shared geometric queries, which does not expose engine internals.

Evidence: six arrangement tests pass for nested data isolation, invalid input rejection, arbitrary obstacle IDs, pocketed-body activation, airborne/spin restore, post-contact/pot restore, pickup-clock continuation and prevention of duplicate restored collision damage/events.

## 4. Shared table geometry

`src/simulation/table-geometry.ts` owns rail/jaw definitions, rounded obstacle sweeps, grounded first-contact and boundary queries, named placement/respot policies, spawn clearance, rolling resistance and surface drag. The engine consumes geometry and drag definitions; AI consumes contacts, safe placement and surface costs; arcade generation consumes layout/spawn clearance; the scene consumes the shared rail/jaw data and contact query for its guide. Settlement uses named respot policies, including safe shield rescue.

Margins remain explicit by purpose: manual placement may permit terrain, AI prefers calm felt, and shield rescue avoids pockets and hazards. A portal terminates the same grounded initial route for both the AI and aiming guide. The guide is a contact preview, not a prediction of a complete airborne or curved trick shot.

Evidence: ten geometry tests pass for all six pocket openings, rounded corners, more than 250 rail/jaw comparisons against Rapier shape casts, ball/block/portal ordering, AI/guide portal agreement, departure from a bank cushion, named clearances, overlapping drag, deterministic layouts and safe pickups/portals.

## 5. Shared presentation model

`src/presentation/effects.ts` owns effect names, descriptions, colors, icons and classes. `deriveTablePresentation` supplies HUD status and team pills; `deriveTableEffects` supplies the scene's active cue effects, halo, trail and guide visibility. The DOM and scene both consume these derivations, while pickups and burst effects consume the same catalog.

Queued mid-shot rewards are distinguished from the current shot's effects: the HUD can show a next-shot pill without prematurely coloring the cue or starting a trail. Status precedence is explicit: reset, connection/readiness, rolling, result, AI aiming, placement, then shot setup and ordinary turn hints.

Evidence: four pure presentation tests pass for status precedence, queued/current effect separation, doubles actor/team labels and catalog consistency.

## Session clock policy

- Menus are presentation. A running local match keeps advancing physics and the pickup clock while a menu is open, just as an online room does.
- Local AI planning can pause independently while a dialog is open, the tab is hidden or a reset animation runs.
- Local elapsed time is caught up after browser throttling. Rolling motion uses fixed 120 Hz steps; settled tables advance the pickup clock at event boundaries instead of looping through every quiet physics tick. Hidden/catchup impact audio is discarded.
- An online room needs all reserved seats connected before accepting actions or advancing an idle pickup clock. An in-flight shot still settles if somebody disconnects. A finished rack stops its clock.

## Validation recorded on 14 September 2026

- `npx tsc --noEmit`: passed after the Match integration available at this audit.
- `node --import tsx --test tests/match.test.ts tests/session.test.ts tests/network-balls.test.ts`: 9 passed.
- `node --import tsx --test tests/rooms.test.ts`: 12 passed against a real localhost server; the focused RemoteMatch reconnect test also passed after its last lifecycle change.
- `node --import tsx --test tests/settlement.test.ts tests/arrangement.test.ts tests/table-geometry.test.ts tests/presentation.test.ts`: 28 passed in this audit.
- After consolidating arena level normalization, `tests/match.test.ts` and `tests/table-geometry.test.ts`: 15 passed. After preserving the server publication timer remainder, the complete 12-test room/socket suite passed again.

The targeted results above were followed by the complete combined verification below.

## Integration audit and final checks

The audit found and resolved two additional drifts: arena construction now shares the domain level policy instead of independently clamping to five, and room broadcasts retain their fractional timer remainder to sustain the 60 Hz rolling target. Main-menu integration now guards pending room entry with a session-intent generation and consults Match reset capabilities. All five requested module boundaries are present and have targeted test evidence.

Final combined verification:

- `npm test`: **138 passed**, no failures, skips or cancellations. Includes all 12 real socket tests, the pure architecture cases, camera framing and guidance, and full-aperture/sleeve geometry checks.
- The four pocket tests passed again after the final rubber facing refinement.
- `npm run build`: passed TypeScript and Vite production compilation. Vite reports the existing large combined Three.js/Rapier bundle warning; no build errors.
- The development server on port 3000 was restarted with the shared Match backend.
- Browser inspection confirmed the low cue camera, room reflections, separate cut-shot paths, rolling overview, and open corner and middle pockets. The reviewed pages reported no console errors. This is targeted visual inspection, not a claim of a new exhaustive gameplay playthrough.
- The physical coin animation retains its no-reset-while-rolling guard. Match intentionally permits a separately confirmed local rack reset during play.

## Additional screenshot-driven graphics work

The main camera now sits behind the cue with stable mouse-delta yaw, and widens for rolling and placement. Right-drag orbit, overhead, reset and inspection remain available. Shot guidance uses antialiased mesh ribbons and a contact ring; outgoing normal/tangent routes share collision queries and do not cross an obstruction. They remain geometric guidance rather than a full trick-shot solver.

`table-surfaces.ts` owns woven baize, leather/rubber, scanned wood and maple/brass cue materials. `pocket-details.ts` builds actual open throats and cuts matching holes and edge notches through the cloth, foundation, apron and rail caps. `room-reflections.ts` captures and filters the enclosed pub after static asset loading, restores cutaway/render state after capture, and reuses the result on polished balls. It excludes gameplay overlays and self-reflections and avoids per-frame cubemap rendering. Development-only shot/pocket views are in `art/shot-review.html`.
