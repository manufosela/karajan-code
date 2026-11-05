/**
 * The SPA fallback: index.html for the app's own routes (non-API, non-static).
 * KJC-BUG-0497: a route whose last segment names a file (it has an extension)
 * is a static file that does not exist, so it answers 404. Served index.html,
 * a missing module reached the browser as HTML and blanked the page with no
 * clear error, and a deploy check read it as a 200.
 */
const namesAFile = (path) => /\.[A-Za-z0-9]+$/.test(path.split('/').at(-1) ?? '');

export const spaFallback = (publicDir) => (req, res) => {
  if (namesAFile(req.path)) {
    res.status(404).type('text/plain').send(`not found: ${req.path}`);
    return;
  }
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  // `root` makes send() check dotfiles on the relative name only: an install path with a
  // dot directory (a lane under .kj/, ~/.nvm, a .pnpm store) no longer turns the fallback into a 404.
  res.sendFile('index.html', { root: publicDir });
};
