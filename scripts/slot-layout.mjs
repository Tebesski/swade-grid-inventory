export const SLOT_COLUMNS = 3;
export const SLOT_ROWS = 4;

export function slotPosition({row, column}) {
  return Number.isInteger(row) && row > 0 && Number.isInteger(column)
    && column > 0 && column <= SLOT_COLUMNS ? {row, column} : null;
}

export function slotOrder(a, b) {
  return (a.groupOrder ?? 0) - (b.groupOrder ?? 0);
}

export function firstSlotPosition(entries) {
  const occupied = new Set(entries.filter(entry => !entry.group && slotPosition(entry))
    .map(entry => `${entry.row}:${entry.column}`));
  for (let index = 0; ; index++) {
    const row = Math.floor(index / SLOT_COLUMNS) + 1;
    const column = index % SLOT_COLUMNS + 1;
    if (!occupied.has(`${row}:${column}`)) return {row, column};
  }
}

export function placeLayoutEntry(entries, source, destination) {
  if (destination?.group) {
    if (source.kind !== "slot" || (source.group === destination.group && source.key === destination.before)) return;
    const siblings = entries.filter(entry => entry !== source && entry.group === destination.group).sort(slotOrder);
    const index = siblings.findIndex(entry => entry.key === destination.before);
    siblings.splice(index < 0 ? siblings.length : index, 0, source);
    siblings.forEach((slot, groupOrder) => Object.assign(slot, {
      row: null, column: null, group: destination.group, groupOrder
    }));
    return;
  }

  const previous = source.group ? null : slotPosition(source);
  if (destination) {
    const displaced = entries.find(entry => entry !== source && !entry.group
      && entry.row === destination.row && entry.column === destination.column);
    if (displaced) Object.assign(displaced, previous ?? {row: null, column: null});
  }
  Object.assign(source, destination ?? {row: null, column: null}, {group: null, groupOrder: null});
}
