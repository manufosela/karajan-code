// Page behaviour outside the film: theme toggle, copy button, scroll reveals and
// the terminal that types itself. Texts come from the page, in its language.
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

document.getElementById('theme').addEventListener('click', () => {
  const dark = getComputedStyle(root).colorScheme === 'dark';
  root.dataset.theme = dark ? 'light' : 'dark';
  // Same keys as the Starlight docs, so the docs open in the theme chosen here.
  localStorage.setItem('theme', root.dataset.theme);
  localStorage.setItem('starlight-theme', root.dataset.theme);
});

const copy = document.getElementById('copy');
const copyLabel = copy.textContent;
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('prompt-text').textContent);
    copy.textContent = copy.dataset.done;
    copy.dataset.copied = '';
  } catch (error) {
    console.warn('[page] clipboard unavailable:', error);
    copy.textContent = copy.dataset.failed;
  }
  setTimeout(() => { copy.textContent = copyLabel; delete copy.dataset.copied; }, 1800);
});

const term = document.getElementById('term');
const typeTerm = () => {
  if (reduced) return;
  term.classList.add('typing');
  let at = 350;
  for (const line of term.querySelectorAll('p')) {
    at += line.querySelector('.ps') ? 750 : 380;
    setTimeout(() => line.classList.add('shown'), at);
  }
};

const reveal = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('in');
    if (entry.target === term) typeTerm();
    reveal.unobserve(entry.target);
  }
}, { threshold: 0.25 });
document.querySelectorAll('.reveal').forEach((el) => reveal.observe(el));
