import {t as sbsI18n} from "./i18n.mjs";
export const MAX_GRID_SIZE = 50;

export function gridSize(value, fallback = 1) {
  return Math.max(1, Math.min(MAX_GRID_SIZE, Math.floor(Number(value) || fallback)));
}

export function containerShape(data) {
  if (Array.isArray(data.pattern)) {
    const rows = data.pattern.slice(0, MAX_GRID_SIZE)
      .map(row => typeof row === "string" ? row.slice(0, MAX_GRID_SIZE).replace(/[^#]/g, ".") : "");
    while (rows.length && !rows.at(-1).includes("#")) rows.pop();
    const width = Math.max(0, ...rows.map(row => row.lastIndexOf("#") + 1));
    if (width) {
      const pattern = rows.map(row => row.slice(0, width).padEnd(width, "."));
      return {width, height: rows.length, pattern: pattern.some(row => row.includes(".")) ? pattern : null};
    }
  }
  return {width: gridSize(data.width, 4), height: gridSize(data.height, 4), pattern: null};
}

// Trim display bounds while preserving the coordinate origin stored on existing items.
export function displayedShape({width, height, pattern}) {
  if (!pattern) return {x: 0, y: 0, width, height, pattern: null};
  const y = pattern.findIndex(row => row.includes("#"));
  const x = Math.min(...pattern.filter(row => row.includes("#")).map(row => row.indexOf("#")));
  return {x, y, width: width - x, height: height - y, pattern: pattern.slice(y).map(row => row.slice(x))};
}

export function* shapeCells({width, height, pattern}) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pattern || pattern[y][x] === "#") yield {x, y};
    }
  }
}

export function cellKey(x, y) {
  return y * MAX_GRID_SIZE + x;
}

export function serializeCells(cells) {
  if (!cells.size) throw new Error(sbsI18n("swade-grid-inventory.UI.Paintatleastonecellfor_111ef1f99e"));
  const rows = Array.from({length: MAX_GRID_SIZE}, () => Array(MAX_GRID_SIZE).fill("."));
  for (const cell of cells) rows[Math.floor(cell / MAX_GRID_SIZE)][cell % MAX_GRID_SIZE] = "#";
  return containerShape({pattern: rows.map(row => row.join(""))});
}

export function* traceCells(start, end) {
  let {x, y} = start;
  const dx = Math.abs(end.x - x);
  const dy = Math.abs(end.y - y);
  const sx = Math.sign(end.x - x);
  const sy = Math.sign(end.y - y);
  let error = dx - dy;
  for (;;) {
    yield {x, y};
    if (x === end.x && y === end.y) return;
    const twice = error * 2;
    if (twice > -dy) { error -= dy; x += sx; }
    if (twice < dx) { error += dx; y += sy; }
  }
}
