// KJC-TSK-1816: the TDD inspector's traffic light. Pure: costumed-piece.js lights the lamps with this.
/** The lamps and the stop hand for a piece lit `gold` (earned, 0..1) and `red` (refused, 0..1). */
export function trafficLight(gold, red = 0) {
  return red > 0 ? { red, green: 0, stop: red } : { red: 0, green: gold, stop: 0 };
}
