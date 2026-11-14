// KJC-TSK-1617 (asked by the maintainer on 2026-11-14): the Cast button opens the legend of the
// factory's characters as collectable cards (legend.js), in a native <dialog>, so focus and Escape
// work from the keyboard. A card's portrait comes from `portraitOf` (KJC-TSK-1618); without it,
// the card shows its character's initial.
import { CARDS, legendSections } from './legend.js';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Its picture: the portrait once it is drawn, else the initial in the frame's colour. */
function portrait(card, portraitOf) {
  const figure = el('figure', { className: 'cast-portrait' }, el('span', { textContent: card.name.charAt(0), ariaHidden: 'true' }));
  Promise.resolve(portraitOf?.(card)).then((src) => {
    if (src) figure.replaceChildren(el('img', { src, alt: '', width: 220, height: 160 }));
  }).catch(() => { /* no portrait: the initial stays */ });
  return figure;
}

/** One card: its name and kind on top, its portrait, what it does, when and who, and its marks. */
function cardOf(card, title, portraitOf) {
  const facts = el('dl', {},
    el('dt', { textContent: 'Does' }), el('dd', { textContent: card.does }),
    el('dt', { textContent: 'Comes out' }), el('dd', { textContent: card.when }),
    el('dt', { textContent: 'Called by' }), el('dd', { textContent: card.calledBy }));
  const article = el('article', { className: `cast-card cast-${card.kind}` },
    // A div, not a header: the page's header rule pins every <header> to the top.
    el('div', { className: 'cast-head' }, el('h4', { textContent: card.name }), el('span', { className: 'cast-kind', textContent: title })),
    portrait(card, portraitOf), facts);
  if (card.marks.length) {
    article.append(el('ul', { className: 'cast-marks', ariaLabel: 'Its marks' },
      ...card.marks.map(({ mark, means }) => el('li', {}, el('strong', { textContent: `${mark}: ` }), means))));
  }
  return el('li', {}, article);
}

/** The dialog's content: its title, its close button and a section of cards per kind. */
function legendOf(portraitOf) {
  const close = el('button', { type: 'button', className: 'cast-close', textContent: 'Close' });
  const sections = legendSections(CARDS).map(({ kind, title, cards }) => el('section', { ariaLabel: title },
    el('h3', { textContent: title }),
    el('ul', { className: 'cast-cards' }, ...cards.map((card) => cardOf(card, title, portraitOf)))));
  return { close, nodes: [el('div', { className: 'cast-top' }, el('h2', { id: 'cast-title', textContent: 'The cast' }), close), ...sections] };
}

/** Mounts the legend on `button` and `dialog`; the cards are built the first time it opens. */
export function mountLegend({ button, dialog, portraitOf }) {
  let built = false;
  button.addEventListener('click', () => {
    if (!built) {
      const { close, nodes } = legendOf(portraitOf);
      close.addEventListener('click', () => dialog.close());
      dialog.replaceChildren(...nodes);
      built = true;
    }
    dialog.showModal();
  });
  // A click on the backdrop closes it too; closed, the focus goes back to the button.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => button.focus());
  button.hidden = false;
}
