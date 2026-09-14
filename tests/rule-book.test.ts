import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRuleSet, ruleBook, RULES_SOURCE } from '../src/presentation/rule-book';
import type { RuleSet } from '../src/simulation/types';

const SECTION_TITLES = [
  'Objective & groups',
  'Break',
  'Legal shot',
  'Fouls',
  'After a foul',
  'The black',
  'In this game',
];

test('both rule sets carry every section with non-empty bullets', () => {
  for (const rules of ['old', 'new'] satisfies RuleSet[]) {
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

test('the "In this game" section lists the documented adaptations for both rule sets', () => {
  for (const rules of ['old', 'new'] satisfies RuleSet[]) {
    const adaptations = ruleBook(rules)
      .find((section) => section.title === 'In this game')!
      .bullets.join(' ');
    assert.match(adaptations, /head string/i);
    assert.match(adaptations, /solids and stripes/i);
    assert.match(adaptations, /choose which group/i);
    assert.match(adaptations, /respots at its rack position/i);
    assert.match(adaptations, /foul snooker/i);
    assert.match(adaptations, /power-ups/i);
    assert.match(adaptations, /jump shots are allowed/i);
    assert.match(adaptations, /no called pockets/i);
  }
});

test('key EPA terms appear where expected', () => {
  const old = ruleBook('old')
    .map((section) => section.bullets.join(' '))
    .join(' ');
  const fresh = ruleBook('new')
    .map((section) => section.bullets.join(' '))
    .join(' ');
  assert.match(old, /two visits/i);
  assert.match(fresh, /two visits/i);
  assert.match(old, /free shot/i);
  assert.match(old, /head string/i);
  assert.match(fresh, /head string/i);
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
