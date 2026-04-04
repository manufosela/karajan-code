import { api } from './api.js';

const AUTH_KEY = 'taskboard_user';

/**
 * Get the stored user from sessionStorage.
 * @returns {{ id: string, email: string } | null}
 */
export function getUser() {
  const raw = sessionStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Store user info in sessionStorage.
 * @param {{ id: string, email: string }} user
 */
export function setUser(user) {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

/** Clear stored user */
export function clearUser() {
  sessionStorage.removeItem(AUTH_KEY);
}

/**
 * Try to refresh the session. Returns true if successful.
 * @returns {Promise<boolean>}
 */
export async function tryRefresh() {
  try {
    const { user } = await api.refresh();
    setUser(user);
    return true;
  } catch {
    clearUser();
    return false;
  }
}
