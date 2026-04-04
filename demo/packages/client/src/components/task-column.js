import './task-card.js';
import { makeDropTarget } from '../services/drag-drop.js';

class TaskColumn extends HTMLElement {
  static get observedAttributes() {
    return ['column-id', 'title'];
  }

  connectedCallback() {
    this.render();
    makeDropTarget(this, (cardId, columnId, position) => {
      this.dispatchEvent(new CustomEvent('move-card', {
        detail: { cardId, columnId, position },
        bubbles: true,
      }));
    });
  }

  /** @param {Array<{id:string,title:string,description:string}>} cards */
  setCards(cards) {
    const container = this.querySelector('.column-cards');
    if (!container) return;
    container.innerHTML = '';
    for (const card of cards) {
      const el = document.createElement('task-card');
      el.setAttribute('card-id', card.id);
      el.setAttribute('title', card.title);
      el.setAttribute('description', card.description || '');
      container.appendChild(el);
    }
  }

  render() {
    const title = this.getAttribute('title') || '';
    const columnId = this.getAttribute('column-id') || '';
    this.dataset.columnId = columnId;

    this.style.cssText = `
      display:flex;flex-direction:column;min-width:280px;max-width:320px;
      background:var(--color-bg);border-radius:var(--radius-lg);
      border:1px solid var(--color-border);overflow:hidden;flex-shrink:0;
    `;

    this.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--color-surface);border-bottom:1px solid var(--color-border)">
        <h3 style="font-size:14px;font-weight:600">${this.escapeHtml(title)}</h3>
        <div style="display:flex;gap:4px">
          <button class="btn-ghost add-card" style="padding:2px 8px;font-size:16px">+</button>
          <button class="btn-ghost delete-column" style="padding:2px 6px;font-size:12px;color:var(--color-danger)">✕</button>
        </div>
      </div>
      <div class="column-cards" style="padding:12px;min-height:60px;flex:1"></div>
    `;

    this.querySelector('.add-card').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('add-card', {
        detail: { columnId },
        bubbles: true,
      }));
    });

    this.querySelector('.delete-column').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('delete-column', {
        detail: { columnId },
        bubbles: true,
      }));
    });
  }

  /** @param {string} str */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

customElements.define('task-column', TaskColumn);
