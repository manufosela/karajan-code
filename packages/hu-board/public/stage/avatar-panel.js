// KJC-TSK-1570 (ADR 0056, point 2, decided by the maintainer on 2026-11-12): the panel of the
// scene where a person picks their emblem from the list and, for each role they want, a colour of
// its own. A native <dialog>, so focus and Escape work from the keyboard; what it saves is pure
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

/** For each role, a box to give it its own colour and the colour itself. */
function colourField(roles) {
  const field = el('fieldset', { className: 'avatar-roles' }, el('legend', { textContent: 'Own colour of each role' }));
  for (const { role, own, color } of roles) {
    const tick = el('input', { type: 'checkbox', name: `own-${role}`, checked: own });
    const picker = el('input', { type: 'color', name: `color-${role}`, value: color, ariaLabel: `Colour of the ${role}` });
    field.append(el('label', {}, tick, el('span', { textContent: role }), picker));
  }
  return field;
}

/**
 * Mounts the panel on `button` and `dialog`: `load()` gives the saved avatar, `save(avatar)` keeps
 * it and answers what was kept, and `onSaved(avatar)` dresses the robots in it.
 */
export function mountAvatarPanel({ button, dialog, load, save, onSaved }) {
  button.addEventListener('click', async () => {
    const { emblem, roles } = formOf(await load());
    const status = el('p', { className: 'avatar-status', role: 'status' });
    const form = el('form', { method: 'dialog' },
      el('h2', { id: 'avatar-title', textContent: 'Your avatar' }),
      emblemField(emblem), colourField(roles), status,
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
