# The Corner Pocket

A 3D arcade eight-ball game played on a pub table, solo against the house, pass-and-play, or online with friends.

## Room

**Pub**:
The enclosed room around the table: walls, bar, furniture and decor. Presentation only; it never affects play.
_Avoid_: level, environment, interior (the interior is only the pub's walls)

**Prop**:
A file-backed model or surface texture placed in the pub or on the table.
_Avoid_: asset (too broad), dressing, model

**Placeholder**:
The built-in stand-in shown for a prop until its file arrives, and kept if the file fails to load.
_Avoid_: fallback, stand-in, proxy

**Settled**:
The pub is settled when every requested prop has either arrived or failed.
_Avoid_: loaded, ready (ready belongs to Match)

**Cutaway**:
The walls and wall fittings hidden so the camera can see the table from outside the room.

## Player

**Player profile**:
One device's preferences, house records and highest unlocked level. It shapes the menus and new local racks; online tables use the host's level.
_Avoid_: settings (only one part of it), save, account

**House record**:
A finished rack's team score saved on this device; the eight best are kept.
_Avoid_: high score, leaderboard

## Rules

**Rule set**:
Which English Pool Association eight-ball rules apply, chosen when a session starts and fixed until the session ends. Online, the host's rule set applies to every seat.
_Avoid_: mode, ruleset toggle, house rules (that is the whole rulebook)

**Old Rules**:
The classic EPA pub rules: a foul gives two visits, a free shot and optional kitchen placement. The default.

**New Rules**:
The EPA World Eightball rules: a foul gives two visits from where the cue ball lies, with a free ball only after a foul snooker.

**Visit**:
One player's (or team's) turn at the table, lasting one or more shots until a miss or a foul.
_Avoid_: turn (a turn is whose visit it is), inning

**Two visits**:
What a team receives after the other side fouls. A pot continues the current visit and the second still follows; a foul during them gives the other side two visits.
_Avoid_: two shots, bonus shot, extra turn

**Free shot**:
Old Rules: the first shot after a foul, which may hit any ball first and scores every ball it pots.
_Avoid_: free ball (that is New Rules)

**Foul snooker**:
A foul that leaves the incoming player unable to hit both edges of any ball they are on in a straight line.

**Free ball**:
New Rules: after a foul snooker, the first shot may hit any ball first, and that ball counts as the player's own for the shot.
_Avoid_: free shot (that is Old Rules)

**Kitchen**:
The area behind the head string, standing in for the EPA baulk area. A lost cue ball must be placed there.
_Avoid_: baulk, D

**Optional placement**:
After some fouls the cue ball is still on the table: it is shot from where it lies unless the player chooses Place behind head string and puts it in the kitchen.
_Avoid_: ball in hand (that is placing the cue ball, mandatory or chosen)

**Group choice**:
The shooter picking solids or stripes when balls of both groups drop on an open table, or after a New Rules break pot.
_Avoid_: nomination, call
