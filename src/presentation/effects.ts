import type { PowerUp, StatusEffect } from '../simulation/types';

export type EffectId = StatusEffect | 'portal' | 'chalked';
interface EffectDefinition {
  name: string;
  description: string;
  color: string;
  icon: string;
  className: string;
  power?: PowerUp;
}

/** One vocabulary for pickups, HUD pills, ball halos and impact bursts. */
export const EFFECTS: Record<EffectId, EffectDefinition> = {
  overdrive: {
    name: 'Overdrive',
    description: 'Faster cue ball and double obstacle damage.',
    color: '#ffb754',
    icon: 'bolt',
    className: 'overdrive',
    power: 'overdrive',
  },
  frozen: {
    name: 'Frostbite',
    description: 'Your opponent’s next shot is weakened.',
    color: '#89dcff',
    icon: 'snow',
    className: 'frozen',
    power: 'frost',
  },
  ward: {
    name: 'Scratch shield',
    description: 'Saves one cue-ball scratch, except on the eight.',
    color: '#65dc99',
    icon: 'shield',
    className: 'ward',
    power: 'ward',
  },
  focus: {
    name: 'Deadeye',
    description: 'A longer aiming preview for your next shot.',
    color: '#f3d175',
    icon: 'target',
    className: 'focus',
    power: 'focus',
  },
  jammed: {
    name: 'Smoke screen',
    description: 'The aiming guide is hidden for your next shot.',
    color: '#bf93ff',
    icon: 'spark',
    className: 'jammed',
  },
  sticky: {
    name: 'Heavy cue',
    description: 'Extra drag slows your next cue-ball shot.',
    color: '#b5c765',
    icon: 'cue',
    className: 'sticky',
  },
  portal: {
    name: 'Portal pair',
    description: 'Opens linked portals after this shot for the next two shots.',
    color: '#b887ff',
    icon: 'spark',
    className: 'portal',
    power: 'portal',
  },
  chalked: {
    name: 'Chalked',
    description: 'Extra grip for off-center shots.',
    color: '#8ed2e4',
    icon: 'chalk',
    className: 'chalked',
  },
};
export const STATUS_IDS: readonly StatusEffect[] = ['overdrive', 'frozen', 'ward', 'focus', 'jammed', 'sticky'];
export const POWER_UPS = Object.fromEntries(
  Object.values(EFFECTS)
    .filter((effect) => effect.power)
    .map((effect) => [effect.power, effect]),
) as Record<PowerUp, EffectDefinition>;
export const STATUS_EFFECTS = Object.fromEntries(STATUS_IDS.map((id) => [id, EFFECTS[id].name])) as Record<
  StatusEffect,
  string
>;
export function effectDefinition(id: PowerUp | EffectId): EffectDefinition {
  return EFFECTS[id === 'frost' ? 'frozen' : id];
}
