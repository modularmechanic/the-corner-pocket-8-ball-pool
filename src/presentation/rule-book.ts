import type { RuleSet } from '../simulation/types';

export interface RuleBookSection {
  title: string;
  bullets: string[];
}

/** Where each rule set's wording in this dialog comes from. */
export const RULES_SOURCE: Readonly<Record<RuleSet, string>> = {
  old: 'Based on the EPA Old Rules (1991 pub rules).',
  new: 'Based on the EPA / World Eightball Rules poster (EPA Oct 2019 issue).',
};

const IN_THIS_GAME: string[] = [
  'The baulk line (the D) is replaced by the head string — that is where you place the cue ball on the break and after a foul.',
  'Solids and stripes stand in for the reds and yellows named in the EPA rules.',
  'If a shot pots balls from both groups, a prompt lets you choose which group is yours.',
  'The black always respots at its rack position, not the table centre spot.',
  'New Rules detects a foul snooker automatically and offers the free ball; you never need to claim it yourself.',
  'Touching-ball rules and the stalemate re-rack are not modelled.',
  'Arcade extras stay in play: power-ups, the Scratch shield, portals and obstacles — bumping an obstacle counts as a legal hit.',
  'Jump shots are allowed, and there are no called pockets.',
];

const OLD_SECTIONS: RuleBookSection[] = [
  {
    title: 'Objective & groups',
    bullets: [
      'Clear your group of seven balls — solids or stripes — then legally pot the black to win the rack.',
      'Your first clean pot, the break included, decides which group is yours; no group is set before that.',
      'Pot balls from both groups on the same shot and you choose which one becomes yours.',
    ],
  },
  {
    title: 'Break',
    bullets: [
      'Play the cue ball from on or behind the head string.',
      'A fair break pots a ball, or sends at least two other balls to a cushion; clipping an obstacle counts too.',
      'A foul break re-racks the balls, hands your opponent two visits, and they break next.',
      'Potting the black on the break re-racks with no penalty, and the same player breaks again.',
    ],
  },
  {
    title: 'Legal shot',
    bullets: [
      'Hit one of your own balls first — the black only once your group is down.',
      'No cushion is required afterwards; a clean contact on your own ball is a legal shot.',
    ],
  },
  {
    title: 'Fouls',
    bullets: [
      'Potting the cue ball.',
      "Hitting an opponent's ball or the black first, or missing everything.",
      "Potting an opponent's ball.",
      'Sending a ball off the table.',
    ],
  },
  {
    title: 'After a foul',
    bullets: [
      'Any foul hands your opponent two visits in a row.',
      'They play the cue ball from where it stopped, or place it anywhere on or behind the head string.',
      'Their first shot is a free shot: they may strike any ball first, including yours or the black, and anything it pots still counts for them.',
      'A pot on that first shot keeps the first visit going; the second visit still follows once it ends. Fouling during those two visits hands the full two visits straight back.',
    ],
  },
  {
    title: 'The black',
    bullets: [
      'Potting the black legally once your group is clear wins the rack.',
      'You lose if you pot the black before your group is down, foul on the shot that pots it, or pot it together with any other ball — the one exception is a free shot with only the black and opponent balls left.',
      'Knocking the black off the table is only a foul; it goes back on its own spot, and the rack continues.',
    ],
  },
  { title: 'In this game', bullets: IN_THIS_GAME },
];

const NEW_SECTIONS: RuleBookSection[] = [
  {
    title: 'Objective & groups',
    bullets: [
      'Clear your group of seven balls — solids or stripes — then legally pot the black to win the rack.',
      'Pot colours on the break and you nominate your group: naming one you already potted locks it in, naming the other only counts once you pot one of them on your next shot.',
      'After the break, your first clean pot decides your group; pot both groups on one shot and you choose.',
    ],
  },
  {
    title: 'Break',
    bullets: [
      'Play the cue ball from behind the head string.',
      'A fair break pots a ball, or sends at least four other balls to a cushion; clipping an obstacle counts too.',
      'A foul break re-racks the balls, hands your opponent two visits, and they break next.',
      'Potting the black on the break re-racks, and the same player breaks again.',
    ],
  },
  {
    title: 'Legal shot',
    bullets: [
      'Hit one of your own balls first — the black only once your group is down.',
      'Then either pot one of your balls or send a ball to a cushion; contact alone is not enough.',
    ],
  },
  {
    title: 'Fouls',
    bullets: [
      'Potting the cue ball.',
      'Hitting the wrong ball first, or missing everything.',
      'No cushion after contact, with nothing potted.',
      "Potting an opponent's ball.",
      'Sending a ball off the table.',
    ],
  },
  {
    title: 'After a foul',
    bullets: [
      'Any foul hands your opponent two visits in a row.',
      'They play the cue ball from where it stopped, or from behind the head string if it was potted or left the table.',
      'A pot on the first shot keeps that visit going; the second visit still follows once it ends. Fouling during those two visits hands the full two visits straight back.',
      'Free ball: a foul that leaves you with no straight line to any of your own balls lets you nominate an opponent ball to count as yours for your first shot. Nominating the black is risky — potting it loses the rack unless you were already on the black.',
    ],
  },
  {
    title: 'The black',
    bullets: [
      'Potting the black legally once your group is clear wins the rack.',
      "You lose if you pot the black before your group is down, or foul on the shot that pots it — including potting an opponent's ball on the same shot while you are on the black.",
      'Knocking the black off the table is only a foul; it goes back on its own spot, and the rack continues.',
    ],
  },
  { title: 'In this game', bullets: IN_THIS_GAME },
];

/** Titled sections describing a rule set, in plain language, for the in-game Rules dialog. */
export function ruleBook(rules: RuleSet): RuleBookSection[] {
  return rules === 'old' ? OLD_SECTIONS : NEW_SECTIONS;
}

/** The rule set the Rules dialog should open to: the running session's, or the saved preference before one starts. */
export function defaultRuleSet(hasStarted: boolean, sessionRules: RuleSet, preferredRules: RuleSet): RuleSet {
  return hasStarted ? sessionRules : preferredRules;
}
