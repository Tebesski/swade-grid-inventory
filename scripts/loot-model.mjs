import {CONTAINER, ID, baseSlots, buildState, inventoryParent, isGear, isNaturalWeapon, settings} from "./model.mjs";

export const SEARCH_MS = 1000;
export const MIN_SEARCH_MS = 650;
export const MAX_SEARCH_MS = 1800;

export function isLootContainer(item) {
  return item.type === CONTAINER || !!settings(item).container?.enabled || !!settings(item).slots?.length;
}

export function lootItems(actor, container = null, state = buildState([...actor.items], baseSlots(actor))) {
  return [...actor.items].filter(item => isGear(item) && !isNaturalWeapon(item))
    .filter(item => (inventoryParent(state, item.id)?.id ?? null) === container)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id.localeCompare(b.id));
}

export function isLootToken(token) {
  return token?.actor?.type === "npc" && !!token.flags?.[ID]?.loot?.enabled;
}

export function adjacentTokens(source, target) {
  if (!source || !target || source.parent?.uuid !== target.parent?.uuid) return false;
  const grid = target.parent.grid;
  const size = grid.size;
  const gap = (a, lengthA, b, lengthB) => Math.max(0, a - b - lengthB, b - a - lengthA);
  const dx = gap(source.x, source.width * size, target.x, target.width * size);
  const dy = gap(source.y, source.height * size, target.y, target.height * size);
  const reach = grid.type === 0 ? size : 1;
  return Math.hypot(dx, dy) <= reach && Math.abs((source.elevation ?? 0) - (target.elevation ?? 0)) <= grid.distance;
}

export function searchProgress(items, saved = {}, random = Math.random) {
  const ids = new Set(items.map(item => item.id));
  const revealed = [...new Set(saved.revealed ?? [])].filter(id => ids.has(id));
  const known = new Set(revealed);
  const searched = [...new Set([...(saved.searched ?? saved.revealed ?? []), ...revealed])];
  const pending = items.find(item => !known.has(item.id))?.id ?? null;
  const same = pending === saved.pending;
  const duration = same && Number.isFinite(saved.duration)
    ? Math.max(MIN_SEARCH_MS, Math.min(MAX_SEARCH_MS, saved.duration))
    : Math.round(MIN_SEARCH_MS + random() * (MAX_SEARCH_MS - MIN_SEARCH_MS));
  return {revealed, searched, pending, duration, elapsed: same ? Math.min(duration, Math.max(0, Number(saved.elapsed) || 0)) : 0};
}

export function overallSearch(items, progress, remaining) {
  const known = new Set(progress.revealed);
  const completed = new Set(progress.searched ?? progress.revealed).size;
  const total = completed + items.filter(item => !known.has(item.id)).length;
  if (!total || !progress.pending) return {fraction: 1, next: 1, completed, total};
  const partial = 1 - Math.min(progress.duration, Math.max(0, remaining)) / progress.duration;
  return {fraction: (completed + partial) / total, next: (completed + 1) / total, completed, total};
}

export function advanceSearch(progress, elapsed) {
  if (!progress.pending) return progress;
  const duration = progress.duration ?? SEARCH_MS;
  const next = {...progress, elapsed: Math.min(duration, progress.elapsed + Math.max(0, elapsed))};
  if (next.elapsed >= duration) {
    next.revealed = [...next.revealed, next.pending];
    next.pending = null;
    next.elapsed = 0;
  }
  return next;
}
