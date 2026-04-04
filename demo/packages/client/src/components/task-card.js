import { makeDraggable } from '../services/drag-drop.js';

class TaskCard extends HTMLElement {
  static get observedAttributes() {
    return ['card-id', 'title', 'description'];
  }

  connectedCallback() {
    this.render();
    makeDraggable(this, this.getAttribute('card-id'));
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const title = this.getAttribute('title') || '';
    const description = this.getAttribute('description') || '';

    this.style.cssText = `
      display:block;padding:10px 12px;background:var(--color-surface);
      border:1px solid var(--color-border);border-radius:var(--radius);
      cursor:grab;transition:box-shadow var(--transition);margin-bottom:8px;
    `;

    this.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <strong style="font-size:14px">${this.escapeHtml(title)}</strong>
        <div style="display:flex;gap:4px">
          <button class="btn-ghost edit-card" style="padding:2px 6px;font-size:12px">✏</button>
          <button class="btn-ghost delete-card" style="padding:2px 6px;font-size:12px;color:var(--color-danger)">✕</button>
        </div>
      </div>
      ${description ? `<p style="font-size:12px;color:var(--color-text-secondary);margin-top:4px">${this.escapeHtml(description)}</p>` : ''}
    `;

    this.querySelector('.edit-card').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('edit-card', {
        detail: { id: this.getAttribute('card-id'), title, description },
        bubbles: true,
      }));
    });

    this.querySelector('.delete-card').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('delete-card', {
        detail: { id: this.getAttribute('card-id') },
        bubbles: true,
      }));
    });
  }

  /**
   * @param {string} str
   * @returns {string}
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

customElements.define('task-card', TaskCard);
