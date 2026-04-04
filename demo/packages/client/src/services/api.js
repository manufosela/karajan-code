const BASE = '/api';

/**
 * Make an API request with JSON body and credentials.
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

export const api = {
  // Auth
  register: (email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  refresh: () =>
    request('/auth/refresh', { method: 'POST' }),
  logout: () =>
    request('/auth/logout', { method: 'POST' }),

  // Boards
  listBoards: () => request('/boards'),
  createBoard: (title) =>
    request('/boards', { method: 'POST', body: JSON.stringify({ title }) }),
  getBoard: (id) => request(`/boards/${id}`),
  updateBoard: (id, title) =>
    request(`/boards/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteBoard: (id) =>
    request(`/boards/${id}`, { method: 'DELETE' }),

  // Columns
  listColumns: (boardId) => request(`/boards/${boardId}/columns`),
  createColumn: (boardId, title) =>
    request(`/boards/${boardId}/columns`, { method: 'POST', body: JSON.stringify({ title }) }),
  updateColumn: (id, data) =>
    request(`/columns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteColumn: (id) =>
    request(`/columns/${id}`, { method: 'DELETE' }),

  // Cards
  listCards: (columnId) => request(`/columns/${columnId}/cards`),
  createCard: (columnId, title, description = '') =>
    request(`/columns/${columnId}/cards`, { method: 'POST', body: JSON.stringify({ title, description }) }),
  updateCard: (id, data) =>
    request(`/cards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  moveCard: (id, columnId, position) =>
    request(`/cards/${id}/move`, { method: 'PATCH', body: JSON.stringify({ columnId, position }) }),
  deleteCard: (id) =>
    request(`/cards/${id}`, { method: 'DELETE' }),
};
