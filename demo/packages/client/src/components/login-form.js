import { api } from '../services/api.js';
import { setUser } from '../services/auth.js';

class LoginForm extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <h2>Login</h2>
          <form id="login-form">
            <div class="form-group">
              <label for="login-email">Email</label>
              <input type="email" id="login-email" required autocomplete="email">
            </div>
            <div class="form-group">
              <label for="login-password">Password</label>
              <input type="password" id="login-password" required autocomplete="current-password">
            </div>
            <div class="form-error" id="login-error"></div>
            <button type="submit" class="btn-primary" style="width:100%;margin-top:12px">Login</button>
          </form>
          <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--color-text-secondary)">
            Don't have an account? <a href="#" id="show-register">Register</a>
          </p>
        </div>
      </div>`;

    this.querySelector('#login-form').addEventListener('submit', (e) => this.handleSubmit(e));
    this.querySelector('#show-register').addEventListener('click', (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('navigate', { detail: 'register', bubbles: true }));
    });
  }

  async handleSubmit(e) {
    e.preventDefault();
    const email = this.querySelector('#login-email').value;
    const password = this.querySelector('#login-password').value;
    const errorEl = this.querySelector('#login-error');

    try {
      const { user } = await api.login(email, password);
      setUser(user);
      this.dispatchEvent(new CustomEvent('authenticated', { detail: user, bubbles: true }));
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
    }
  }
}

customElements.define('login-form', LoginForm);
