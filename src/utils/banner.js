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
  blue:    "\x1b[38;2;170;204;238m",  // #AACCEE
  green:   "\x1b[38;2;100;190;100m",  // green accents
  gray:    "\x1b[38;2;140;140;140m",  // borders/dim
  white:   "\x1b[38;2;220;220;220m",  // bright text
  olive:   "\x1b[38;2;70;64;0m",      // #464000
  charcoal:"\x1b[38;2;100;100;80m",   // #444411 approx
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  reset:   "\x1b[0m"
};

// Robot mascot (conductor with visor, bowtie, baton)
const MASCOT = [
  `${C.gray}    ╭──────────╮`,
  `${C.gray}    │ ${C.green}~╷${C.gray}    ${C.green}╷${C.gray}  │`,
  `${C.gray}    │  ${C.green}v${C.gray}     ${C.green}│${C.gray}  ├${C.charcoal}──`,
  `${C.gray}    ╰──────────╯${C.charcoal} /`,
  `${C.gray}       ╭─${C.white}⋈${C.gray}─╮  ${C.charcoal}/`,
  `${C.gray}       ╰────╯`,
];

// "KARAJAN" in compact block letters
const TITLE = [
  `${C.bold}${C.blue}╦╔═ ╔═╗ ╦═╗ ╔═╗   ╦ ╔═╗ ╔╗╔`,
  `${C.bold}${C.blue}╠╩╗ ╠═╣ ╠╦╝ ╠═╣   ║ ╠═╣ ║║║`,
  `${C.bold}${C.blue}╩ ╩ ╩ ╩ ╩╚═ ╩ ╩ ╚╝  ╩ ╩ ╝╚╝`,
];

/**
 * Print the Karajan Code ASCII banner.
 * @param {string} version - Package version to display
 * @param {object} [opts] - Options
 * @param {boolean} [opts.compact] - Skip mascot, show only text
 * @param {boolean} [opts.force] - Print even without TTY
 */
export function printBanner(version, opts = {}) {
  if (!opts.force && !process.stdout.isTTY) return; // skip in pipes/non-interactive

  console.log();

  if (!opts.compact) {
    // Combine mascot (left) + title (right)
    const pad = "  ";
    const mascotWidth = 22; // visual width of mascot lines

    for (let i = 0; i < Math.max(MASCOT.length, TITLE.length + 2); i++) {
      const left = i < MASCOT.length ? MASCOT[i] : " ".repeat(mascotWidth);
      const titleIdx = i - 1; // offset title down 1 line
      let right = "";
      if (titleIdx >= 0 && titleIdx < TITLE.length) {
        right = `${pad}${TITLE[titleIdx]}`;
      } else if (titleIdx === TITLE.length) {
        right = `${pad}${C.white}${C.bold}        C O D E${C.reset}  ${C.dim}v${version}${C.reset}`;
      } else if (titleIdx === TITLE.length + 1) {
        right = `${pad}${C.charcoal}  multiagent coding orchestrator${C.reset}`;
      }
      console.log(`${left}${C.reset}${right}${C.reset}`);
    }
  } else {
    // Compact: just title + version
    for (const line of TITLE) {
      console.log(`  ${line}${C.reset}`);
    }
    console.log(`  ${C.white}${C.bold}        C O D E${C.reset}  ${C.dim}v${version}${C.reset}`);
  }

  console.log();
}
