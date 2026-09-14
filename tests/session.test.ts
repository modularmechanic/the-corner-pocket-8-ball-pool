import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/simulation/types';
import { humanControls, resultTeams } from '../src/ui/session';

test('solo doubles gives the human only their own seat and leaves their partner to the AI', () => {
  const state=initialState('team-control');state.format='doubles';
  for(const team of [0,1] as const) for(const partner of [0,1] as const){
    state.turn=team;state.teamOrder[team]=partner;
    assert.equal(humanControls(state,'ai'),team===0&&partner===0);
    assert.equal(humanControls(state,'local'),true);
    for(let seat=0;seat<4;seat++)assert.equal(humanControls(state,'online',seat),seat===team+partner*2);
  }
});
test('online teammate results use the team score and winner rather than indexing a nonexistent third or fourth team', () => {
  assert.deepEqual(resultTeams('online',2),[0]);assert.deepEqual(resultTeams('online',3),[1]);
  assert.deepEqual(resultTeams('local'),[0,1]);assert.deepEqual(resultTeams('ai'),[0]);
});
