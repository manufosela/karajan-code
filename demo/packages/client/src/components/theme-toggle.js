const THEME_KEY = 'taskboard_theme';

class ThemeToggle extends HTMLElement {
  connectedCallback() {
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    document.documentElement.dataset.theme = saved;

    this.innerHTML = `<button class="btn-ghost" aria-label="Toggle theme">
      ${saved === 'dark' ? '☀️' : '🌙'}
    </button>`;

    this.querySelector('button').addEventListener('click', () => this.toggle());
  }

  toggle() {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
    this.querySelector('button').textContent = next === 'dark' ? '☀️' : '🌙';
  }
}

customElements.define('theme-toggle', ThemeToggle);
