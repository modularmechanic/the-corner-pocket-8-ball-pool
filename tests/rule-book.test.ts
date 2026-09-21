import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRuleSet,
  ruleBook,
  ruleBookFor,
  RULES_SOURCE,
  type RuleBook,
  type RuleBookMode,
} from '../src/presentation/rule-book';
import { CONTROL_HELP } from '../src/presentation/control-help';
import { RULE_TERMS } from '../src/presentation/table-presentation';
import type { RuleSet } from '../src/simulation/types';

const BOTH: RuleSet[] = ['old', 'new'];
const SECTION_TITLES = [
  'Objective & groups',
  'Break',
  'Legal shot',
  'Fouls',
  'After a foul',
  'The black',
  'In this game',
];
const sectionText = (book: RuleBook) => book.sections.map((section) => section.bullets.join(' ')).join(' ');
const text = (rules: RuleSet, title?: string) =>
  ruleBook(rules)
    .filter((section) => !title || section.title === title)
    .map((section) => section.bullets.join(' '))
    .join(' ');

test('both rule sets carry every section with non-empty bullets', () => {
  for (const rules of BOTH) {
    const sections = ruleBook(rules);
    assert.deepEqual(
      sections.map((section) => section.title),
      SECTION_TITLES,
    );
    for (const section of sections) {
      assert.ok(section.bullets.length > 0, `${rules} · ${section.title} has bullets`);
      for (const bullet of section.bullets) assert.ok(bullet.trim().length > 0);
    }
  }
});

test('the "In this game" section lists the house adaptations, omissions and arcade extras for both rule sets', () => {
  for (const rules of BOTH) {
    const adaptations = text(rules, 'In this game');
    for (const pattern of [
      /head string stands in for the baulk line/i,
      /solids and stripes stand in for the reds and yellows/i,
      new RegExp(RULE_TERMS.chooseGroup),
      /foul snookers are found automatically/i,
      /first ball you hit/i,
      /where the EPA rules would let you nominate that ball and win/,
      /Game ruling where the EPA Old Rules are silent.*foul on the shot that pots the black.*loses/,
      /toward the foot cushion first under New Rules, toward the head string only under Old Rules/,
      /knocked off the table on the break is an ordinary foul/i,
      /touching balls/i,
      /stalemate/i,
      /total-snooker cushion exemption/i,
      /time limits/i,
      /conduct fouls/i,
      /free ball after a lost cue ball/i,
      /power-ups/i,
      /Scratch shield/,
      /portals/i,
      /block counts as contact/i,
      /jump shots are allowed/i,
      /pockets are never called/i,
    ])
      assert.match(adaptations, pattern, `${rules}: ${pattern}`);
  }
});

test('both rule sets describe two visits, cue-ball placement, fouls, the break and the black as settled', () => {
  for (const rules of BOTH) {
    const afterFoul = text(rules, 'After a foul');
    assert.match(afterFoul, /two visits in a row/);
    assert.match(afterFoul, /A pot keeps a visit going and the second visit still follows/);
    assert.match(afterFoul, /A foul during either visit gives two visits back/);
    assert.match(afterFoul, /from where it lies/);
    assert.ok(afterFoul.includes(`tap ${RULE_TERMS.placeBehindHeadString}`), `${rules}: the placement button`);
    assert.match(afterFoul, /potted or off-table cue ball must be placed behind the head string/);
    assert.match(text(rules, 'Break'), /foul break re-racks the balls and your opponent breaks, with two visits/i);
    assert.match(text(rules, 'Break'), /black on the break re-racks.*same player breaks again/i);
    assert.match(text(rules, 'Fouls'), /Potting an opponent's ball/);
    assert.match(text(rules, 'The black'), /black included, is a foul and goes back on the black's rack position/);
  }
});

test('Old Rules: two-cushion break, no cushion rule, a free shot after every foul and the black-with-another-ball loss', () => {
  assert.match(text('old', 'Objective & groups'), /the break included/);
  assert.match(text('old', 'Break'), /at least two balls to a cushion/);
  assert.match(text('old', 'Legal shot'), /No cushion is needed/);
  assert.match(text('old', 'Fouls'), /except on a free shot/);
  assert.match(
    text('old', 'After a foul'),
    /free shot: any ball may be hit first, the black included, and every ball it pots counts/,
  );
  assert.match(text('old', 'The black'), /even on a free shot/);
  assert.doesNotMatch(text('old', 'The black'), /on a foul/, 'the EPA Old Rules only name the in-off as a losing foul');
  assert.match(text('old', 'The black'), /together with any other ball.*only the black and your opponent's balls/);
  const oldOnly = SECTION_TITLES.slice(0, -1)
    .map((title) => text('old', title))
    .join(' ');
  assert.doesNotMatch(oldOnly, /four balls|free ball/i, 'the shared "In this game" notes aside');
});

test('New Rules: four-cushion break, cushion after contact, turn-only break scratch and the automatic free ball', () => {
  assert.match(text('new', 'Objective & groups'), /on your next shot/);
  assert.match(text('new', 'Break'), /at least four balls to a cushion/);
  assert.match(text('new', 'Break'), /in-off \(potting the cue ball\) on a fair break only passes the turn/);
  assert.match(text('new', 'Break'), /cue ball off the table is an ordinary foul/);
  assert.match(text('new', 'Legal shot'), /reach a cushion/);
  assert.match(text('new', 'Fouls'), /No pot and no cushion after contact/);
  assert.match(text('new', 'Fouls'), /except the free ball/);
  assert.match(text('new', 'After a foul'), /both edges of any of their balls/);
  assert.match(text('new', 'After a foul'), /first ball hit counts as theirs/);
  assert.match(text('new', 'After a foul'), /still snookered from there/);
  assert.match(text('new', 'The black'), /together with your last ball/);
  assert.match(text('new', 'The black'), /unless you are on the black/);
  assert.doesNotMatch(text('new'), /free shot|two balls to a cushion/i);
});

test('RULES_SOURCE names the EPA sources', () => {
  assert.match(RULES_SOURCE.old, /EPA Old Rules/);
  assert.match(RULES_SOURCE.new, /EPA.*(Oct(ober)? 2019)/);
});

test("defaultRuleSet shows the running session's rules once started, otherwise the saved preference", () => {
  assert.equal(defaultRuleSet(false, 'new', 'old'), 'old');
  assert.equal(defaultRuleSet(true, 'new', 'old'), 'new');
  assert.equal(defaultRuleSet(true, 'old', 'new'), 'old');
});

test('every mode answers with a titled, non-empty book, and only eight-ball varies by rule set', () => {
  for (const mode of ['eight-ball', 'snooker', 'billiards', 'zombie'] as RuleBookMode[]) {
    const book = ruleBookFor(mode, 'new');
    assert.equal(book.mode, mode);
    assert.ok(book.title.trim().length > 0, `${mode} has a title`);
    assert.ok(book.source.trim().length > 0, `${mode} names its source`);
    assert.ok(book.sections.length > 0, `${mode} has sections`);
    for (const section of book.sections) {
      assert.ok(section.title.trim().length > 0);
      assert.ok(section.bullets.length > 0 && section.bullets.every((bullet) => bullet.trim().length > 0));
    }
    assert.equal(book.ruleSets, mode === 'eight-ball', `${mode} rule-set tabs`);
  }
});

test('the eight-ball book is the settled eight-ball text, per rule set', () => {
  for (const rules of BOTH) {
    const book = ruleBookFor('eight-ball', rules);
    assert.deepEqual(book.sections, ruleBook(rules));
    assert.equal(book.source, RULES_SOURCE[rules]);
  }
  assert.notDeepEqual(ruleBookFor('eight-ball', 'old').sections, ruleBookFor('eight-ball', 'new').sections);
  for (const mode of ['snooker', 'billiards', 'zombie'] as RuleBookMode[])
    assert.deepEqual(ruleBookFor(mode, 'old').sections, ruleBookFor(mode, 'new').sections);
});

test('snooker, billiards and the horde describe what their engines actually do', () => {
  const snooker = sectionText(ruleBookFor('snooker'));
  assert.match(snooker, /yellow 2, green 3, brown 4, blue 5, pink 6 and black 7/);
  assert.match(snooker, /place it anywhere inside the D/i);
  assert.match(snooker, /penalty is 4 points/i);
  assert.match(snooker, /ball you strike first is taken as the ball you nominated/i);
  assert.match(snooker, /next score or foul decides the frame/i);

  const billiards = sectionText(ruleBookFor('billiards'));
  assert.match(billiards, /Cannon.*2 points/);
  assert.match(billiards, /Pot the red 3, pot the other cue ball 2/);
  assert.match(billiards, /75 cannons in a row|15 hazards in a row/);
  assert.match(billiards, /foul costs 2 points/i);
  assert.match(billiards, /100/);

  const zombie = sectionText(ruleBookFor('zombie'));
  assert.match(zombie, /no pockets/i);
  assert.match(zombie, /reflects off it and keeps going/i);
  assert.match(zombie, /first kill of a shot scores 100, the second 200/i);
  assert.match(zombie, /250 points times the wave number/i);
  assert.match(zombie, /reach the cue ball’s spot at your rail and the run is over/i);
});

test('control help covers the shared controls and never repeats a mode rule', () => {
  assert.deepEqual(
    CONTROL_HELP.map((section) => section.title),
    ['Aim & shoot', 'Strike, spin & jumps', 'Camera', 'Ball in hand', 'Touch', 'Keyboard'],
  );
  const controls = CONTROL_HELP.map((section) => section.bullets.join(' ')).join(' ');
  for (const pattern of [
    /aim/i,
    /contact point/i,
    /right mouse button/i,
    /placement/i,
    /touch screens|aim dial/i,
    /Arrow keys/,
  ])
    assert.match(controls, pattern);
  assert.doesNotMatch(controls, /\bfoul\b|two visits|eight-ball|solids|stripes/i);
});
