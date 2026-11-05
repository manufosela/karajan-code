/**
 * What the board prints when it starts. As a daemon its output is
 * ~/.karajan/hu-board.log, a file people read, paste and share, so it never
 * carries the token itself (KJC-BUG-0499): only where to read it and how to
 * pass it.
 */
export function startupBanner({ pid, host, port, dataDir, tokenPath, isLoopback }) {
  const visibleHost = isLoopback ? 'localhost' : host;
  const lines = [
    '',
    '  Karajan HU Board',
    '  -----------------',
    `  PID:        ${pid}`,
    `  Running at: http://${visibleHost}:${port}`,
    `  Data dir:   ${dataDir}`,
  ];
  if (!isLoopback) {
    lines.push(
      '',
      '  ⚠️  Bound to non-loopback interface.',
      `     Token required for non-loopback peers: ${tokenPath}`,
      `     Open it as http://${host}:${port}/?token=<token> (the token is in that file, or HU_BOARD_TOKEN when set).`,
    );
  }
  lines.push('');
  return lines;
}
