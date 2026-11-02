// Page behaviour outside the film: theme toggle, copy button, scroll reveals and
// the terminal that types itself. Texts come from the page, in its language.
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// The theme button is a toggle named "Dark theme": pressed while the dark theme is on.
const theme = document.getElementById('theme');
const isDark = () => getComputedStyle(root).colorScheme === 'dark';
const showTheme = () => theme.setAttribute('aria-pressed', String(isDark()));
theme.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  // Same keys as the Starlight docs, so the docs open in the theme chosen here.
  localStorage.setItem('theme', root.dataset.theme);
  localStorage.setItem('starlight-theme', root.dataset.theme);
  showTheme();
});
showTheme();

const copy = document.getElementById('copy');
// Screen readers do not announce a button relabelling itself: the status region does.
const copyStatus = document.getElementById('copy-status');
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
  copyStatus.textContent = copy.textContent;
  setTimeout(() => { copy.textContent = copyLabel; copyStatus.textContent = ''; delete copy.dataset.copied; }, 1800);
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
