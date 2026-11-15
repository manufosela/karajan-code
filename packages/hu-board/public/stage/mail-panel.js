// KJC-TSK-1638 (asked by the maintainer on 2026-11-15): a click on the mailbox lists everything that
// waits for the human: in which lane, what to do, the command to type and since when. A native
// <dialog> (Escape closes it), as the task wall (wall-panel.js).
import { mailRows } from './mail-tip.js';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** One letter: its lane and age, what to do and, when it has one, the command to type. */
const rowOf = ({ lane, what, command, since, denial }) => el('li', { className: denial ? 'mail-denial' : '' },
  el('div', { className: 'mail-meta', textContent: [lane, since, denial ? 'refused by the Sentinel' : ''].filter(Boolean).join(' · ') }),
  el('div', { textContent: what }),
  ...(command ? [el('code', { textContent: command })] : []));

/** Mounts the panel on `dialog`; answers `open(letters)`, which lists them, oldest first. */
export function mountMailPanel({ dialog }) {
  const close = () => dialog.close();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  return (letters) => {
    const button = el('button', { type: 'button', className: 'wall-close', textContent: 'Close' });
    button.addEventListener('click', close);
    const rows = mailRows(letters, Date.now());
    const body = rows.length ? el('ol', { className: 'mail-list' }, ...rows.map(rowOf)) : el('p', { textContent: 'Nothing waits for you.' });
    dialog.replaceChildren(el('div', { className: 'wall-top' }, el('h2', { id: 'mail-title', textContent: `Mailbox · ${rows.length}` }), button), body);
    dialog.showModal();
  };
}
