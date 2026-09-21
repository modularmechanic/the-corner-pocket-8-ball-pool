/** Keep intro navigation on completed menu events. Changing panels on a global
 * pointerdown can remove a control before its click and misses click-only input. */
export function bindLandingInput(
  menu: HTMLDialogElement,
  landing: HTMLElement,
  begin: HTMLButtonElement,
  advance: () => void,
): () => void {
  const onLanding = () => menu.open && !landing.hidden;
  const control = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest('button, a, input, select, textarea, summary, [role="button"], [contenteditable]')
      : null;
  const click = (event: MouseEvent) => {
    if (!onLanding() || event.defaultPrevented || event.button !== 0) return;
    // Buttons use their native click handler; background clicks also enter the picker.
    if (control(event.target)) return;
    advance();
  };
  const keydown = (event: KeyboardEvent) => {
    if (!onLanding() || event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey)
      return;
    if (['Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
    const target = control(event.target);
    if (target && target !== begin) return;
    // Enter/Space activate the prompt natively. Keep that click's target in place.
    if (target === begin && (event.key === 'Enter' || event.key === ' ')) return;
    event.preventDefault();
    advance();
  };
  menu.addEventListener('click', click);
  menu.addEventListener('keydown', keydown);
  return () => {
    menu.removeEventListener('click', click);
    menu.removeEventListener('keydown', keydown);
  };
}
