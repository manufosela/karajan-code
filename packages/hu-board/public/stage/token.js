// KJC-BUG-0492: off loopback (Tailscale, LAN) the board asks for its token. The
// stage page takes it as the RAG and Wiki pages do: from ?token= in its address,
// or the one the board pages stored in the browser.

/** The board token for this page, or '' when there is none. `storage` is read lazily: touching it can throw. */
export function boardToken(search, storage) {
  const fromAddress = new URLSearchParams(search).get('token');
  if (fromAddress) return fromAddress;
  try {
    return storage().getItem('kj_board_token') ?? '';
  } catch {
    return ''; // a browser that blocks storage: the board will answer 401 and the page says so
  }
}

/** The URL with the token as a query param (EventSource cannot send headers). */
export const withToken = (url, token) => (token ? `${url}&token=${encodeURIComponent(token)}` : url);
