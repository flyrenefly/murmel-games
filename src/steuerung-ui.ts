// The choice "Steuerung: Neigen / Wischen" as a segmented control (touch devices, start and pause dialog).

import type { Steering } from './steuerung';

const OPTIONS: [Steering, string][] = [
  ['tilt', 'Neigen'],
  ['swipe', 'Wischen'],
];

export function steeringControl(current: Steering, onChange: (s: Steering) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Steuerung');
  for (const [value, label] of OPTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === current));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (value !== current) onChange(value);
    });
    group.append(b);
  }
  return group;
}
