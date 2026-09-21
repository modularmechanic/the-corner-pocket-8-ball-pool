import type { RuleBookSection } from './rule-book';

/** How you play a shot, in every mode. Nothing here is a rule of any game: the cue, the camera, the keyboard and
 * the touch controls are the same whether the table is racked for eight-ball, snooker, billiards or the horde.
 * The wording is the help text that used to sit in the Rules dialog beside the eight-ball rules. */
export const CONTROL_HELP: RuleBookSection[] = [
  {
    title: 'Aim & shoot',
    bullets: [
      'Move the mouse left or right to aim, then click once to lock the direction. Pull back, then click again to shoot.',
      'Behind the cue, your first click takes the cue and hides the pointer so you can keep turning; Escape shows the pointer again and cancels the shot.',
    ],
  },
  {
    title: 'Strike, spin & jumps',
    bullets: [
      'Hold S and move the mouse to choose the tip contact point. Hold E and move vertically to raise the cue. The contact and elevation buttons work on touch screens.',
      'For a jump, choose a low contact point and hit hard; raising the cue adds lift. For draw, use a lower-power bottom hit. A raised cue with side contact bends the path on the cloth; chalk improves grip.',
      'Chalk the cue for better grip on your next off-centre strike. Airborne balls can clear or clip other balls.',
    ],
  },
  {
    title: 'Camera',
    bullets: [
      'Hold the right mouse button, or R, and move to look around. Release to return. R + arrow keys also rotates the view. F returns to shooting view; V toggles overhead. The view eases out while balls roll.',
    ],
  },
  {
    title: 'Ball in hand',
    bullets: [
      'When the cue ball must be placed, click or tap a clear spot inside the placement zone the table shows you.',
      'When placement is optional, aim and shoot from where the cue ball lies, or press the placement button (P) first; press it again or Escape to play from where it lies.',
    ],
  },
  {
    title: 'Touch',
    bullets: [
      'Turn the aim dial, tap Engage cue, slide the power bar on the right, then tap Shoot. Tapping the table never shoots. The camera button switches between overhead and the cue view.',
    ],
  },
  {
    title: 'Keyboard',
    bullets: [
      'Arrow keys adjust aim or power; hold Shift for finer aim. S + arrows adjusts spin; E + arrows adjusts elevation.',
      'Space locks aim, then shoots. C chalks, X centres the strike, B opens your cues, and Escape cancels the shot.',
    ],
  },
];
