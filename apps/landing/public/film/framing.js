// How the final shot fits beside the hero copy. Pure, so it can be tested
// without a renderer.

/**
 * Takes the cast's span on screen ({ left, right } in px, as the camera sees it
 * now) and returns how much further to pull the camera back (`wide`, a factor on
 * its distance) and how far to slide the view (`shift`, px, the view offset), so
 * the cast sits in the room right of the copy with `gap` px to spare on each side.
 * Pulling back shrinks the span around the centre of the screen.
 */
export function fitBeside({ left, right }, { width, copyRight, gap }) {
  const room = width - copyRight - 2 * gap;
  const wide = Math.max(1, (right - left) / room);
  const centre = width / 2 + ((left + right) / 2 - width / 2) / wide;
  return { wide, shift: centre - (copyRight + gap + room / 2) };
}
