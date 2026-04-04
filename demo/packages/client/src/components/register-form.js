import { api } from '../services/api.js';
import { setUser } from '../services/auth.js';

class RegisterForm extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="auth-container">
        <div class="auth-card">
          <h2>Register</h2>
          <form id="register-form">
            <div class="form-group">
              <label for="reg-email">Email</label>
              <input type="email" id="reg-email" required autocomplete="email">
            </div>
            <div class="form-group">
              <label for="reg-password">Password</label>
              <input type="password" id="reg-password" required minlength="8" autocomplete="new-password">
            </div>
            <div class="form-error" id="register-error"></div>
            <button type="submit" class="btn-primary" style="width:100%;margin-top:12px">Register</button>
          </form>
          <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--color-text-secondary)">
            Already have an account? <a href="#" id="show-login">Login</a>
          </p>
        </div>
      </div>`;

    this.querySelector('#register-form').addEventListener('submit', (e) => this.handleSubmit(e));
    this.querySelector('#show-login').addEventListener('click', (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('navigate', { detail: 'login', bubbles: true }));
    });
  }

  async handleSubmit(e) {
    e.preventDefault();
    const email = this.querySelector('#reg-email').value;
    const password = this.querySelector('#reg-password').value;
    const errorEl = this.querySelector('#register-error');

    try {
      const { user } = await api.register(email, password);
      setUser(user);
      this.dispatchEvent(new CustomEvent('authenticated', { detail: user, bubbles: true }));
    } catch (err) {
      errorEl.textContent = err.message || 'Registration failed';
    }
  }
}

customElements.define('register-form', RegisterForm);
