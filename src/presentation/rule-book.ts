import type { RuleSet } from '../simulation/types';
import { RULE_TERMS } from './table-presentation';

export interface RuleBookSection {
  title: string;
  bullets: string[];
}

/** Where each rule set's wording in this dialog comes from. */
export const RULES_SOURCE: Readonly<Record<RuleSet, string>> = {
  old: 'Based on the EPA Old Rules (1991 pub rules).',
  new: 'Based on the EPA / World Eightball Rules poster (EPA Oct 2019 issue).',
};

const place = RULE_TERMS.placeBehindHeadString,
  choose = RULE_TERMS.chooseGroup;
const TWO_VISITS =
  'A pot keeps a visit going and the second visit still follows. A foul during either visit gives two visits back.';
const OFF_TABLE =
  "A ball knocked off the table, the black included, is a foul and goes back on the black's rack position; the rack goes on.";
const LEGAL_FIRST =
  'Hit one of your own balls first: any ball but the black on an open table, the black once your group is down.';

const IN_THIS_GAME: string[] = [
  'The head string stands in for the baulk line and the area behind it for baulk. The break is taken from a set spot on the head string.',
  'Solids and stripes stand in for the reds and yellows of the EPA rules.',
  `Choosing a group is a ${choose} prompt, so there is no foul for failing to nominate.`,
  'New Rules foul snookers are found automatically, and the free ball you nominate is simply the first ball you hit.',
  'A black knocked off the table on the break is an ordinary foul; only a potted black re-racks.',
  'If nothing behind the head string is clear, a lost cue ball may go anywhere on the table and an optional placement plays from where it lies.',
  'Not modelled: touching balls, the stalemate re-rack, the total-snooker cushion exemption, time limits, push, double-hit and conduct fouls, and a free ball after a lost cue ball.',
  'Arcade extras stay in play: power-ups, the Scratch shield (a rescued scratch is no foul), portals and blocks. Hitting a block counts as contact and as a cushion.',
  'Jump shots are allowed, and pockets are never called.',
];

const OLD_SECTIONS: RuleBookSection[] = [
  {
    title: 'Objective & groups',
    bullets: [
      'Clear your group of seven balls, solids or stripes, then legally pot the black to win the rack.',
      `Your first clean pot decides your group, the break included. If balls of both groups drop on that shot, a ${choose} prompt lets you pick.`,
    ],
  },
  {
    title: 'Break',
    bullets: [
      'Break from the head string.',
      'A fair break pots a ball or sends at least two balls to a cushion.',
      'A foul break re-racks the balls and your opponent breaks, with two visits.',
      'Potting the black on the break re-racks with no penalty, and the same player breaks again.',
    ],
  },
  {
    title: 'Legal shot',
    bullets: [LEGAL_FIRST, 'No cushion is needed after contact.'],
  },
  {
    title: 'Fouls',
    bullets: [
      'Potting the cue ball or sending it off the table.',
      "Hitting an opponent's ball or the black first, or hitting nothing.",
      "Potting an opponent's ball, except on a free shot.",
      'Sending any other ball off the table, or a foul break.',
    ],
  },
  {
    title: 'After a foul',
    bullets: [
      'Your opponent gets two visits in a row.',
      `With the cue ball still on the table they play it from where it lies, or tap ${place} first to move it. A potted or off-table cue ball must be placed behind the head string.`,
      'Their first shot is a free shot: any ball may be hit first, the black included, and every ball it pots counts as theirs.',
      TWO_VISITS,
    ],
  },
  {
    title: 'The black',
    bullets: [
      'Potting the black legally once your group is clear wins the rack; a free shot may play it directly.',
      "You lose if you pot the black before your group is clear (even on a free shot), on a foul, or together with any other ball. The one exception is a free shot with only the black and your opponent's balls left.",
      OFF_TABLE,
    ],
  },
  { title: 'In this game', bullets: IN_THIS_GAME },
];

const NEW_SECTIONS: RuleBookSection[] = [
  {
    title: 'Objective & groups',
    bullets: [
      'Clear your group of seven balls, solids or stripes, then legally pot the black to win the rack.',
      `Pot balls on the break and a ${choose} prompt follows: a group you potted is yours at once, the other only if you pot one of it on your next shot.`,
      'After that, your first clean pot decides your group; if balls of both groups drop, you choose.',
    ],
  },
  {
    title: 'Break',
    bullets: [
      'Break from the head string.',
      'A fair break pots a ball or sends at least four balls to a cushion.',
      'A foul break re-racks the balls and your opponent breaks, with two visits.',
      'Potting the black on the break re-racks, and the same player breaks again.',
      'Losing the cue ball on a fair break only passes the turn: no two visits, and the cue ball is placed behind the head string.',
    ],
  },
  {
    title: 'Legal shot',
    bullets: [LEGAL_FIRST, 'Then pot a ball, or make any ball, the cue ball included, reach a cushion.'],
  },
  {
    title: 'Fouls',
    bullets: [
      'Potting the cue ball or sending it off the table.',
      'Hitting the wrong ball first, or hitting nothing.',
      'No pot and no cushion after contact.',
      "Potting an opponent's ball, except the free ball.",
      'Sending any other ball off the table, or a foul break.',
    ],
  },
  {
    title: 'After a foul',
    bullets: [
      'Your opponent gets two visits in a row, playing the cue ball from where it lies.',
      'A potted or off-table cue ball must be placed behind the head string.',
      `Free ball: if the foul leaves them unable to hit both edges of any of their balls in a straight line, their first shot may hit any ball first, and the first ball hit counts as theirs for that shot. They may also tap ${place}, but the free ball stays only if they are still snookered from there.`,
      TWO_VISITS,
    ],
  },
  {
    title: 'The black',
    bullets: [
      'Potting the black legally once your group is clear wins the rack.',
      "You lose if you pot the black before your group is clear, together with your last ball, or on a foul, such as with the cue ball or an opponent's ball.",
      'On a free ball the black may be the ball you hit first: potting it loses unless you are on the black, where potting the ball you hit first and the black wins.',
      OFF_TABLE,
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
