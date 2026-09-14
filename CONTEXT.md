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
How a foul is paid for, chosen when a session starts and fixed until the session ends. Online, the host's rule set applies to every seat.
_Avoid_: mode, ruleset toggle, house rules (that is the whole rulebook)

**Old Rules**:
The rule set in which a foul gives the opponent two shots. The default.

**New Rules**:
The rule set in which a foul gives the opponent ball in hand anywhere and one visit.

**Two shots**:
The Old Rules allowance a team receives after the other side fouls. A legal pot turns it into an ordinary visit; a foul while holding it forfeits the rest and gives the other side one visit.
_Avoid_: free shot, bonus shot, extra turn

**Kitchen**:
The area behind the head string, where the cue ball is placed after a scratch under Old Rules. Placing it there is head string placement.
_Avoid_: baulk
