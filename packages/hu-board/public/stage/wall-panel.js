// KJC-TSK-1627 (asked by the maintainer on 2026-11-14): the task wall, large. A click on it opens
// a native <dialog> (Escape closes it) with its three columns and every task, the newest first.
import { wallLists } from './wall-layout.js';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Mounts the panel on `dialog`; answers `open(cards)`, which shows the wall of those cards. */
export function mountWallPanel({ dialog }) {
  const close = () => dialog.close();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  return (cards) => {
    const button = el('button', { type: 'button', className: 'wall-close', textContent: 'Close' });
    button.addEventListener('click', close);
    const columns = wallLists(cards).map(({ title, cards: here }) => el('section', { ariaLabel: title },
      el('h3', { textContent: `${title} · ${here.length}` }),
      here.length
        ? el('ol', {}, ...here.map(({ id, title: text }) => el('li', {}, el('strong', { textContent: id }), text ? ` ${text}` : '')))
        : el('p', { textContent: 'None.' })));
    dialog.replaceChildren(el('div', { className: 'wall-top' }, el('h2', { id: 'wall-title', textContent: 'Task wall' }), button), el('div', { className: 'wall-columns' }, ...columns));
    dialog.showModal();
  };
}
