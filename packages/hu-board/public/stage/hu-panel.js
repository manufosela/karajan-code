// KJC-TSK-1621: the HU of a workshop, from the board, in a native <dialog> to read (Escape closes
// it): its id and title, what the board holds of it (workshop-info.js) and a link to the board.
import { storyFacts } from './workshop-info.js';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const heading = (id, title) => (title ? `${id} · ${title}` : id);

/**
 * Mounts the panel on `dialog`; `load(id)` answers the board's story or null, `boardHref()` the
 * board's page of the project. Answers `open(hu)`, which shows it at once and fills it when loaded.
 */
export function mountHuPanel({ dialog, load, boardHref }) {
  const close = () => dialog.close();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  return async (hu) => {
    const button = el('button', { type: 'button', className: 'hu-close', textContent: 'Close' });
    button.addEventListener('click', close);
    const title = el('h2', { id: 'hu-title', textContent: heading(hu.id, hu.title) });
    const body = el('p', { textContent: 'Asking the board…' });
    dialog.replaceChildren(el('div', { className: 'hu-top' }, title, button), body);
    dialog.showModal();
    // `load` answers null when the board keeps no record of the HU, and throws when it does not answer.
    const story = await load(hu.id).catch(() => undefined);
    if (story?.title && !hu.title) title.textContent = heading(hu.id, story.title);
    const facts = story ? storyFacts(story) : [];
    const empty = { undefined: 'The board did not answer for this HU.', null: 'The board keeps no record of this HU.' };
    const list = facts.length
      ? el('dl', {}, ...facts.flatMap(([label, text]) => [el('dt', { textContent: label }), el('dd', { textContent: text })]))
      : el('p', { textContent: story ? 'The board holds nothing more of this HU.' : empty[String(story)] });
    body.replaceWith(list, el('p', {}, el('a', { href: boardHref(), textContent: 'Open the board' })));
  };
}
