export const CELL = 40;

export function packGrids(grids, availableColumns) {
  let columns = Math.max(availableColumns, ...grids.map(grid => grid.width));
  const placed = [];
  const occupied = [];
  let hasPattern = false;
  for (const {width, height, pattern} of grids) {
    const rows = pattern ? pattern.map(row => {
      let bits = 0n;
      for (let i = 0; i < row.length; i++) if (row[i] === "#") bits |= 1n << BigInt(i);
      return bits;
    }) : Array(height).fill((1n << BigInt(width)) - 1n);
    const bottom = occupied.length;
    const right = Math.max(0, ...placed.map(region => region.x + region.width));
    let position = (hasPattern ? search(right, bottom - height) : null) ?? search(columns, bottom);
    function search(limit, lastRow) {
      for (let y = 0; y <= lastRow; y++) {
        candidate: for (let x = 0; x + width <= limit; x++) {
          let adjacent = !placed.length;
          const shift = BigInt(x);
          for (let row = 0; row < height; row++) {
            const cells = rows[row] << shift;
            const at = y + row;
            const same = occupied[at] ?? 0n;
            if (cells & same) continue candidate;
            const neighbors = (same << 1n) | (same >> 1n) | (occupied[at - 1] ?? 0n) | (occupied[at + 1] ?? 0n);
            adjacent ||= Boolean(cells & neighbors);
          }
          if (adjacent) return {x, y};
        }
      }
      return null;
    }
    if (!position) {
      // Unusual outlines may need a wider board to line up their top and bottom edges.
      const left = bits => (bits & -bits).toString(2).length - 1;
      let x = left(occupied[bottom - 1]) - left(rows[0]);
      if (x < 0) {
        for (const region of placed) region.x -= x;
        for (let i = 0; i < bottom; i++) occupied[i] = (occupied[i] ?? 0n) << BigInt(-x);
        columns -= x;
        x = 0;
      }
      columns = Math.max(columns, x + width);
      position = {x, y: bottom};
    }
    const shift = BigInt(position.x);
    for (let row = 0; row < height; row++) {
      const at = position.y + row;
      occupied[at] = (occupied[at] ?? 0n) | (rows[row] << shift);
    }
    placed.push({...position, width, height});
    hasPattern ||= Boolean(pattern);
  }
  return placed;
}
