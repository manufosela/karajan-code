/**
 * Karajan Code ASCII banner with brand colors.
 *
 * Brand palette:
 *   #AACCEE  steel blue (primary text)
 *   #88CC88  green (accents, robot eyes)
 *   #464000  dark olive
 *   #444411  charcoal (secondary text)
 */

const C = {
  blue:     "\x1b[38;2;170;204;238m",  // #AACCEE
  green:    "\x1b[38;2;100;190;100m",   // green accents
  gray:     "\x1b[38;2;140;140;140m",   // borders/dim
  white:    "\x1b[38;2;220;220;220m",   // bright text
  charcoal: "\x1b[38;2;100;100;80m",    // #444411 approx
  bold:     "\x1b[1m",
  dim:      "\x1b[2m",
  reset:    "\x1b[0m"
};

const R = C.reset;

const BANNER_LINES = [
  ``,
  `${C.gray}        ╭───────────╮`,
  `${C.gray}        │  ${C.green}~${C.gray}        │`,
  `${C.gray}        │  ${C.green}|${C.gray}     ${C.green}|${C.gray}  │  ${C.charcoal}|`,
  `${C.gray}        |     ${C.green}v${C.gray}     │ ${C.charcoal}/`,
  `${C.gray}      ${C.charcoal}\\${C.gray} ╰───────────╯${C.charcoal}/`,
  `${C.charcoal}       \\${C.gray} ╭───${C.white}⋈${C.gray}───╮ ${C.charcoal}/`,
  `${C.charcoal}        \\${C.gray}        ${C.charcoal}/`,
  `${C.gray}         ╰───────╯`,
  ``,
  `  ${C.bold}${C.blue}╦╔═ ╔═╗ ╦═╗ ╔═╗  ╦ ╔═╗ ╔╗╔${R}`,
  `  ${C.bold}${C.blue}╠╩╗ ╠═╣ ╠╦╝ ╠═╣  ║ ╠═╣ ║║║${R}`,
  `  ${C.bold}${C.blue}╩ ╩ ╩ ╩ ╩╚═ ╩ ╩ ╚╝ ╩ ╩ ╝╚╝${R}`,
  `  ${C.bold}${C.white}        C O D E${R}  %%VERSION%%`,
  `  ${C.charcoal}multiagent coding orchestrator${R}`,
  ``,
];

/**
 * Print the Karajan Code ASCII banner.
 * @param {string} version - Package version to display
 * @param {object} [opts]
 * @param {boolean} [opts.compact] - Skip mascot, show only text
 * @param {boolean} [opts.force] - Print even without TTY
 */
export function printBanner(version, opts = {}) {
  if (!opts.force && !process.stdout.isTTY) return;

  const versionTag = `${C.dim}v${version}${R}`;

  if (opts.compact) {
    console.log();
    for (const line of BANNER_LINES.slice(10)) {
      console.log(line.replace("%%VERSION%%", versionTag));
    }
    return;
  }

  for (const line of BANNER_LINES) {
    console.log(line.replace("%%VERSION%%", versionTag));
  }
}
