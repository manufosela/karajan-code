// KJC-TSK-1452 (ADR 0049): where each factory stands on the map, in metres. Each
// one gets a lot as big as its hall's floor; the lots fill a near-square grid,
// centred, the busiest factory (first in the list) at the back left.
export const LOT = { width: 84, depth: 44 };

const grid = (n) => {
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
};

/** The centre of factory `i`'s lot of `n`. */
export function lotOrigin(i, n) {
  const { cols, rows } = grid(n);
  const along = (k, count, size) => (k - (count - 1) / 2) * size;
  return { x: along(i % cols, cols, LOT.width), z: along(Math.floor(i / cols), rows, LOT.depth) };
}

/** How wide and deep the map of `n` factories is, so the camera can fit it. */
export function mapSize(n) {
  const { cols, rows } = grid(n);
  return { width: cols * LOT.width, depth: rows * LOT.depth };
}
