// KJC-TSK-1694 (asked by the maintainer on 2026-11-18): the status lines at the bottom left fold
// and unfold. Folded, they leave the view but still speak to screen readers.

/** The name of the local storage item that holds the choice (a name, not a secret). */
export const FOLD_ITEM = 'kj-stage-status-folded';

const remembered = (storage) => { try { return storage().getItem(FOLD_ITEM) === '1'; } catch { return false; } };
const remember = (storage, folded) => { try { storage().setItem(FOLD_ITEM, folded ? '1' : '0'); } catch { /* the choice lasts this visit */ } };

/** Mounts the fold on `button` over `list`; the choice stays for the next visit in this browser. */
export function mountStatusFold({ button, list, storage }) {
  let folded = remembered(storage);
  const show = () => {
    list.classList.toggle('stage-folded', folded);
    button.setAttribute('aria-expanded', String(!folded));
  };
  button.addEventListener('click', () => {
    folded = !folded;
    remember(storage, folded);
    show();
  });
  show();
}
