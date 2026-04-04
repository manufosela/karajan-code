import './components/theme-toggle.js';
import './components/login-form.js';
import './components/register-form.js';
import './components/task-board.js';
import './components/app-modal.js';
import { api } from './services/api.js';
import { getUser, setUser, clearUser, tryRefresh } from './services/auth.js';

const app = document.getElementById('app');

/** Render the current view based on auth state */
async function router() {
  const user = getUser();

  if (!user) {
    const refreshed = await tryRefresh();
    if (!refreshed) return renderAuth('login');
  }

  renderBoardSelector();
}

/** @param {'login'|'register'} view */
function renderAuth(view) {
  if (view === 'register') {
    app.innerHTML = '<register-form></register-form>';
  } else {
    app.innerHTML = '<login-form></login-form>';
  }
}

async function renderBoardSelector() {
  const user = getUser();
  let boards = [];

  try {
    const data = await api.listBoards();
    boards = data.boards;
  } catch {
    clearUser();
    return renderAuth('login');
  }

  app.innerHTML = `
    <header class="app-header">
      <h1>TaskBoard</h1>
      <div class="actions">
        <span style="font-size:13px;color:var(--color-text-secondary)">${user?.email || ''}</span>
        <theme-toggle></theme-toggle>
        <button class="btn-ghost" id="logout-btn">Logout</button>
      </div>
    </header>
    <div class="board-selector">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2>Your Boards</h2>
        <button class="btn-primary" id="new-board-btn">+ New Board</button>
      </div>
      <div class="board-list" id="board-list"></div>
    </div>
    <app-modal></app-modal>`;

  renderBoardList(boards);
  app.querySelector('#logout-btn').addEventListener('click', handleLogout);
  app.querySelector('#new-board-btn').addEventListener('click', handleNewBoard);
}

/** @param {Array} boards */
function renderBoardList(boards) {
  const list = app.querySelector('#board-list');
  if (boards.length === 0) {
    list.innerHTML = '<p style="color:var(--color-text-secondary);text-align:center;padding:24px">No boards yet. Create one!</p>';
    return;
  }

  list.innerHTML = boards.map((b) => `
    <div class="board-item" data-id="${b.id}">
      <span>${escapeHtml(b.title)}</span>
      <button class="btn-ghost delete-board" data-id="${b.id}" style="color:var(--color-danger);font-size:12px">Delete</button>
    </div>
  `).join('');

  list.querySelectorAll('.board-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-board')) return;
      renderBoard(el.dataset.id);
    });
  });

  list.querySelectorAll('.delete-board').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.deleteBoard(btn.dataset.id);
      renderBoardSelector();
    });
  });
}

/** @param {string} boardId */
function renderBoard(boardId) {
  app.innerHTML = `
    <header class="app-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn-ghost" id="back-btn">&larr; Boards</button>
        <h1>TaskBoard</h1>
      </div>
      <div class="actions">
        <theme-toggle></theme-toggle>
        <button class="btn-ghost" id="logout-btn">Logout</button>
      </div>
    </header>
    <task-board board-id="${boardId}"></task-board>`;

  app.querySelector('#back-btn').addEventListener('click', () => renderBoardSelector());
  app.querySelector('#logout-btn').addEventListener('click', handleLogout);
}

async function handleLogout() {
  await api.logout();
  clearUser();
  renderAuth('login');
}

async function handleNewBoard() {
  const title = prompt('Board title:');
  if (!title) return;
  await api.createBoard(title);
  renderBoardSelector();
}

/** @param {string} str */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Event delegation for auth navigation
document.addEventListener('navigate', (e) => renderAuth(e.detail));
document.addEventListener('authenticated', () => renderBoardSelector());

// Boot
router();
