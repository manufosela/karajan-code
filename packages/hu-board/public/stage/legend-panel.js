// KJC-TSK-1617 (asked by the maintainer on 2026-11-14): the Cast button opens the legend of the
// factory's characters as collectable cards (legend.js), in a native <dialog>, so focus and Escape
// work from the keyboard. A card's portrait comes from `portraitOf` (KJC-TSK-1618); without it,
// the card shows its character's initial.
import { legendSections } from './legend.js';
import { cardsIn, kindsIn, labelsIn, langOf } from './legend-es.js';

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
function cardOf(card, title, portraitOf, words) {
  const facts = el('dl', {},
    el('dt', { textContent: words.does }), el('dd', { textContent: card.does }),
    el('dt', { textContent: words.when }), el('dd', { textContent: card.when }),
    el('dt', { textContent: words.calledBy }), el('dd', { textContent: card.calledBy }));
  const article = el('article', { className: `cast-card cast-${card.kind}` },
    // A div, not a header: the page's header rule pins every <header> to the top.
    el('div', { className: 'cast-head' }, el('h4', { textContent: card.name }), el('span', { className: 'cast-kind', textContent: title })),
    portrait(card, portraitOf), facts);
  if (card.marks.length) {
    article.append(el('ul', { className: 'cast-marks', ariaLabel: words.marks },
      ...card.marks.map(({ mark, means }) => el('li', {}, el('strong', { textContent: `${mark}: ` }), means))));
  }
  return el('li', {}, article);
}

/** KJC-TSK-1626: the language switch, the one shown pressed. */
function switchOf(lang, pick) {
  const group = el('div', { className: 'cast-langs', role: 'group', ariaLabel: 'Language / Idioma' });
  for (const [code, text] of [['en', 'English'], ['es', 'Español']]) {
    const button = el('button', { type: 'button', textContent: text, lang: code });
    button.setAttribute('aria-pressed', String(code === lang));
    button.addEventListener('click', () => pick(code));
    group.append(button);
  }
  return group;
}

/** The dialog's content in `lang`: its title, the language switch, its close button and a section of cards per kind. */
function legendOf(portraitOf, lang, pick, close) {
  const words = labelsIn(lang);
  const shut = el('button', { type: 'button', className: 'cast-close', textContent: words.close });
  shut.addEventListener('click', close);
  const sections = legendSections(cardsIn(lang), kindsIn(lang)).map(({ kind, title, cards }) => el('section', { ariaLabel: title },
    el('h3', { textContent: title }),
    el('ul', { className: 'cast-cards' }, ...cards.map((card) => cardOf(card, title, portraitOf, words)))));
  return [el('div', { className: 'cast-top' }, el('h2', { id: 'cast-title', textContent: words.title }), switchOf(lang, pick), shut), ...sections];
}

// KJC-TSK-1626: the language picked stays for the next time, in this browser only.
// The name of the local storage item that holds it (a name, not a secret).
const LANG_ITEM = 'kj-stage-legend-lang';
const remembered = () => { try { return localStorage.getItem(LANG_ITEM); } catch { return null; } };
const remember = (lang) => { try { localStorage.setItem(LANG_ITEM, lang); } catch { /* the choice lasts this visit */ } };

/** Mounts the legend on `button` and `dialog`; the cards are built when it opens or the language changes. */
export function mountLegend({ button, dialog, portraitOf }) {
  let lang = langOf(remembered(), navigator.language);
  let shown = null;
  const close = () => dialog.close();
  const show = (next) => {
    lang = next;
    remember(lang);
    dialog.lang = lang;
    dialog.replaceChildren(...legendOf(portraitOf, lang, show, close));
    shown = lang;
    // Rebuilt under the keyboard, the focus stays on the language just picked.
    if (dialog.open) dialog.querySelector(`.cast-langs [lang="${lang}"]`)?.focus();
  };
  button.addEventListener('click', () => {
    if (shown !== lang) show(lang);
    dialog.showModal();
  });
  // A click on the backdrop closes it too; closed, the focus goes back to the button.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => button.focus());
  button.hidden = false;
}
