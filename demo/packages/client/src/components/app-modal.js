class AppModal extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="modal-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
        <div class="modal-content" style="background:var(--color-surface);border-radius:var(--radius-lg);padding:24px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto">
          <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h3 id="modal-title"></h3>
            <button class="btn-ghost modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body" id="modal-body"></div>
        </div>
      </div>`;

    this.overlay = this.querySelector('.modal-overlay');
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.querySelector('.modal-close').addEventListener('click', () => this.close());
  }

  /**
   * @param {string} title
   * @param {string} bodyHtml
   */
  open(title, bodyHtml) {
    this.querySelector('#modal-title').textContent = title;
    this.querySelector('#modal-body').innerHTML = bodyHtml;
    this.overlay.style.display = 'flex';
  }

  close() {
    this.overlay.style.display = 'none';
    this.dispatchEvent(new CustomEvent('modal-close', { bubbles: true }));
  }
}

customElements.define('app-modal', AppModal);
