// KJC-TSK-1570 (ADR 0056, point 2, decided by the maintainer on 2026-11-12): the panel of the
// scene where a person picks their emblem from the list and their own colour (KJC-TSK-1603).
// A native <dialog>, so focus and Escape work from the keyboard; what it saves is pure
// (avatars.js).
import { EMBLEMS, avatarFromForm, formOf } from './avatars.js';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** The emblems as radio buttons, the saved one checked. */
function emblemField(picked) {
  const field = el('fieldset', { className: 'avatar-emblems' }, el('legend', { textContent: 'Emblem on the backpack' }));
  for (const { id, glyph, label } of EMBLEMS) {
    const input = el('input', { type: 'radio', name: 'emblem', value: id, checked: id === picked });
    field.append(el('label', { title: label }, input, el('span', { textContent: glyph, ariaHidden: 'true' }), el('span', { className: 'avatar-name', textContent: label })));
  }
  return field;
}

/**
 * KJC-TSK-1603 (the maintainer, 2026-11-13): one colour of the person's own, which marks the
 * backpack of all their robots and their host's hologram; no colour per role.
 */
function colourField(own, color) {
  const field = el('fieldset', { className: 'avatar-roles' }, el('legend', { textContent: 'Your colour, on all your robots' }));
  const tick = el('input', { type: 'checkbox', name: 'own-color', checked: own });
  const picker = el('input', { type: 'color', name: 'color', value: color, ariaLabel: 'Your colour' });
  field.append(el('label', {}, tick, el('span', { textContent: 'Use my colour' }), picker));
  return field;
}

/**
 * Mounts the panel on `button` and `dialog`: `load()` gives the saved avatar, `save(avatar)` keeps
 * it and answers what was kept, and `onSaved(avatar)` dresses the robots in it.
 */
export function mountAvatarPanel({ button, dialog, load, save, onSaved }) {
  button.addEventListener('click', async () => {
    const { emblem, own, color } = formOf(await load());
    const status = el('p', { className: 'avatar-status', role: 'status' });
    const form = el('form', { method: 'dialog' },
      el('h2', { id: 'avatar-title', textContent: 'Your avatar' }),
      emblemField(emblem), colourField(own, color), status,
      el('menu', {}, el('button', { type: 'button', value: 'cancel', textContent: 'Cancel' }), el('button', { type: 'submit', textContent: 'Save' })));
    form.querySelector('button[value="cancel"]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.textContent = 'Saving…';
      try {
        onSaved(await save(avatarFromForm(new FormData(form).entries())));
        dialog.close();
      } catch (err) {
        status.textContent = `The board did not keep it (${err.message}).`;
      }
    });
    dialog.replaceChildren(form);
    dialog.showModal();
  });
}
