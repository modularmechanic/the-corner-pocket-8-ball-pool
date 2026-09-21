import type { RuleBookSection } from './rule-book';

/** Rule book content for the modes that are not eight-ball. Each one describes what this engine actually does,
 * including the corners it cuts, rather than the paper rules it is based on. The eight-ball sections stay in
 * rule-book.ts, where they were settled against the EPA rules. */

/** Snooker. Written from src/simulation/modes/snooker.ts and modes/table.ts, both of which cite the WPBSA Official
 * Rules of the Games of Snooker and English Billiards (2019 revision): Section 1 the table, Section 2 the
 * definitions and values, Section 3 the play and penalties, Section 4 the end of the frame. */
export const SNOOKER_SOURCE = 'Based on the WPBSA Official Rules of the Game of Snooker (2019 revision).';

export const SNOOKER_SECTIONS: RuleBookSection[] = [
  {
    title: 'Objective & scoring',
    bullets: [
      'Score more than the other side over the frame. Fifteen reds and six colours sit on a full-size table with tighter pockets than the pub one.',
      'A red is worth 1, yellow 2, green 3, brown 4, blue 5, pink 6 and black 7.',
      'Score and you stay at the table. A stroke that scores nothing, or any foul, ends your visit.',
    ],
  },
  {
    title: 'Break',
    bullets: [
      'The frame opens with the cue ball in hand: place it anywhere inside the D and play up the table.',
      'There is no fair-break rule to satisfy — hit a red first and the break is legal.',
    ],
  },
  {
    title: 'The ball on',
    bullets: [
      'While any red is up, a red is on. Pot one and a colour is on; pot that colour and it goes back on its spot, and a red is on again.',
      'You may pot several reds in one stroke and every one of them counts.',
      'Once the last red is gone, the colours are taken in ascending order — yellow, green, brown, blue, pink, black — and each one stays down.',
    ],
  },
  {
    title: 'Fouls',
    bullets: [
      'Hitting nothing, or hitting a ball that is not on first.',
      'Potting the cue ball, or potting a ball that is not on.',
      'Sending any ball off the table.',
      'The penalty is 4 points to the other side, or the value of the ball on, of the ball you struck first, or of any ball wrongly potted, whichever is highest. A foul stroke scores you nothing.',
      'No cushion is needed after contact.',
    ],
  },
  {
    title: 'After a foul',
    bullets: [
      'The other side plays next from where the cue ball lies. A potted cue ball is placed in the D.',
      'Free ball: if the foul leaves them unable to hit both edges of any ball that is on, every ball on the table is on for their next stroke, and potting the one they hit first scores the value of the ball on.',
      'There is no option to put you back in: the incoming player always takes the shot.',
    ],
  },
  {
    title: 'The end of the frame',
    bullets: [
      'When the black goes down the frame is over and the higher score wins.',
      'Level after the black, the black goes back on its spot, the cue ball is in hand, and the next score or foul decides the frame.',
      'You may concede the frame while you are at the table.',
    ],
  },
  {
    title: 'In this game',
    bullets: [
      'There is no nomination prompt. The ball you strike first is taken as the ball you nominated, both for the colour after a red and for a free ball.',
      'Foul snookers are found automatically, so a free ball is awarded without anyone calling it.',
      'A colour goes back on its own spot; if that is taken, on the highest-value free spot; if every spot is taken, as near its own spot as it fits on the centre line, towards the top cushion first.',
      'Not modelled: the miss rule and the option to make the offender play again, touching balls, push and jump strokes as fouls, stalemate, time limits and conduct fouls. A jump shot here is simply a shot.',
      'No power-ups, blocks or portals: a frame is played on a plain table.',
    ],
  },
];

/** English Billiards. Written from src/simulation/modes/billiards.ts, which cites the WPBSA Official Rules of the
 * Games of Snooker and English Billiards, English Billiards part: Section 2 the definitions, Section 3 the game. */
export const BILLIARDS_SOURCE = 'Based on the WPBSA Official Rules of the Game of English Billiards.';

export const BILLIARDS_SECTIONS: RuleBookSection[] = [
  {
    title: 'Objective',
    bullets: [
      'Three balls on the full-size table: a red and two cue balls. The white is yours, the yellow is the other side’s — or the other way round if you are the second player.',
      'The other side’s cue ball and the red are both object balls for you.',
      'First to the points target wins; the game is set to 100 unless the table says otherwise.',
      'Score and you stay at the table. A stroke that scores nothing, or any foul, ends your visit.',
    ],
  },
  {
    title: 'Start',
    bullets: [
      'The red goes on the billiard spot and both cue balls start in hand, played from the D.',
      'Whenever your cue ball is off the table you play it from the D; the balls already on the table stay where they lie.',
    ],
  },
  {
    title: 'Scoring strokes',
    bullets: [
      'Cannon: your cue ball touches both the red and the other cue ball in one stroke — 2 points.',
      'Pot the red 3, pot the other cue ball 2.',
      'In-off: your cue ball goes down after contact — 3 off the red, 2 off a cue ball, judged by the ball you hit first.',
      'Every cannon and hazard made in the same stroke scores together.',
    ],
  },
  {
    title: 'Fouls',
    bullets: [
      'Hitting nothing at all.',
      'Sending any ball off the table. A cue ball forced off is a foul, not an in-off.',
      'More than 75 cannons in a row with no hazard among them, or more than 15 hazards in a row with no cannon among them.',
      'A foul costs 2 points to the other side, never more than 2 in one stroke, and the foul stroke scores you nothing.',
    ],
  },
  {
    title: 'Spotting',
    bullets: [
      'The red comes back on the billiard spot, or on the pyramid spot, or on the centre spot when those are taken.',
      'Pot the red on its own twice running and the third one goes to the centre spot first. Any other scoring stroke restarts that sequence.',
      'A potted cue ball is not spotted: it stays in hand for its owner. The exception is the fifteenth hazard in a row, which brings the other side’s ball back to the middle of the baulk line, or the corner of the D when that is taken.',
    ],
  },
  {
    title: 'The end of the game',
    bullets: ['The game ends the moment a player reaches or passes the target.', 'You may concede the game.'],
  },
  {
    title: 'In this game',
    bullets: [
      'Only the points game is offered; a timed game would need a clock, which the rules layer deliberately does not own.',
      'A cannon is scored from every object ball the cue ball touched on the stroke, so a stroke reported with only its first contact can never score one.',
      'After a foul the incoming player always plays from where the balls lie; the option to have both object balls spotted and play from in hand is not offered.',
      'Not modelled: the baulk-line restrictions on a shot from in hand and the crossing rule late in a break, touching balls, push and jump strokes as fouls, spot-barred variations, time limits and conduct fouls.',
      'No power-ups, blocks or portals: a game is played on a plain table.',
    ],
  },
];

/** Zombie Horde is not a cue sport and gets instructions rather than rules. Written from
 * src/simulation/modes/zombie.ts; every number below is one of that file's constants. */
export const ZOMBIE_SOURCE = 'An arcade mode. No cue-sport rules apply.';

export const ZOMBIE_SECTIONS: RuleBookSection[] = [
  {
    title: 'The run',
    bullets: [
      'One cue ball, no object balls and no pockets. The cushions run unbroken, so the ball always comes back to you.',
      'The horde walks up the table towards your rail. It only moves while the ball is rolling, so take as long as you like over a shot.',
      'Between shots the cue ball is put back on its spot in front of your rail.',
    ],
  },
  {
    title: 'Shooting',
    bullets: [
      'Aim and set your power exactly as you would a normal shot, then fire into the horde.',
      'The cue ball is not stopped by a body: it reflects off it and keeps going, a little slower each time, so one good line can carry through several of them.',
      'The shot ends when the ball rolls to a stop. Cushions and bodies both take pace off it.',
    ],
  },
  {
    title: 'Scoring',
    bullets: [
      'Every body takes a set number of hits before it goes down; later waves take more.',
      'The first kill of a shot scores 100, the second 200, the third 300, and so on — the combo is how many you drop in that one shot.',
      'Clear a wave and you bank 250 points times the wave number.',
      'Your best combo of the run is kept alongside your score.',
    ],
  },
  {
    title: 'Waves',
    bullets: [
      'Each wave puts one more body on the table than the last, up to fifteen, and they walk faster until they hit their top speed.',
      'From wave 4 they take two hits, from wave 7 three, and from wave 10 four. Their colour tells you how tough they are.',
    ],
  },
  {
    title: 'How it ends',
    bullets: [
      'Let one body reach the cue ball’s spot at your rail and the run is over on the spot.',
      'There is no other way to lose, and no way to win: the run goes until they get through.',
    ],
  },
];
