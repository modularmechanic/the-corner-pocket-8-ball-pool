import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRuleSet, ruleBook, RULES_SOURCE } from '../src/presentation/rule-book';
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
  assert.match(text('old', 'The black'), /together with any other ball.*only the black and your opponent's balls/);
  const oldOnly = SECTION_TITLES.slice(0, -1)
    .map((title) => text('old', title))
    .join(' ');
  assert.doesNotMatch(oldOnly, /four balls|free ball/i, 'the shared "In this game" notes aside');
});

test('New Rules: four-cushion break, cushion after contact, turn-only break scratch and the automatic free ball', () => {
  assert.match(text('new', 'Objective & groups'), /on your next shot/);
  assert.match(text('new', 'Break'), /at least four balls to a cushion/);
  assert.match(text('new', 'Break'), /cue ball on a fair break only passes the turn/);
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
