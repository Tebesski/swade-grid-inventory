import {t as sbsI18n} from "./i18n.mjs";
import {containerShape, gridSize} from "./container-shape.mjs";

export {gridSize};
export const ID = "swade-grid-inventory";
export const MONEY = "swade-better-money.money";
export const CONTAINER = `${ID}.container`;
const storageTypes = new Set();

export function registerStorageType(type) {
  storageTypes.add(type);
}
export const ARMOR = ["head", "torso", "arms", "legs"];
export const HANDS = ["main-hand", "off-hand"];
export const EVENTS = ["drag", "equip", "place"];
export const BUILTIN_TYPES = ["weapon", "armor", "shield", "gear", "consumable"];
export const EQUIP = {stored: 0, carried: 1, offHand: 2, worn: 3, mainHand: 4, twoHands: 5};

export const DEFAULT_SLOTS = [
  {id: "head", get label() { return sbsI18n("swade-grid-inventory.UI.Head_9bb0aacc6d"); }, icon: "helmet-safety", types: ["armor"], column: 2, row: 1},
  {id: "mask", get label() { return sbsI18n("swade-grid-inventory.UI.Mask_e368929abd"); }, icon: "mask", types: ["gear", "armor", "mask"], column: 3, row: 1},
  {id: "arms", get label() { return sbsI18n("swade-grid-inventory.UI.Arms_f831a06b4f"); }, icon: "mitten", types: ["armor"], column: 1, row: 2},
  {id: "torso", get label() { return sbsI18n("swade-grid-inventory.UI.Torso_5dcecdc811"); }, icon: "shirt", types: ["armor"], column: 2, row: 2},
  {id: "backpack", get label() { return sbsI18n("swade-grid-inventory.UI.Backpack_5118f76d90"); }, icon: "bag-shopping", types: ["gear", "backpack"], column: 3, row: 2},
  {id: "main-hand", get label() { return sbsI18n("swade-grid-inventory.UI.Mainhand_bd73f463f8"); }, icon: "hand", types: ["*"], column: 1, row: 3},
  {id: "belt", get label() { return sbsI18n("swade-grid-inventory.UI.Belt_eeebd533eb"); }, icon: "grip-lines", types: ["gear", "belt"], column: 2, row: 3},
  {id: "off-hand", get label() { return sbsI18n("swade-grid-inventory.UI.Offhand_5d154d9c57"); }, icon: "hand-paper", types: ["*"], column: 3, row: 3},
  {id: "legs", get label() { return sbsI18n("swade-grid-inventory.UI.Legs_38557594d0"); }, icon: "shoe-prints", types: ["armor"], column: 2, row: 4},
  {id: "pouches", get label() { return sbsI18n("swade-grid-inventory.UI.Pouches_786babd7e8"); }, icon: "sack-dollar", types: ["gear", "pouch"], column: 3, row: 4}
];

export function splitList(value) {
  return [...new Set(String(value ?? "").split(",").map(part => part.trim()).filter(Boolean))];
}

export function settings(item) {
  return item.flags?.[ID]?.item ?? {};
}

export function isGear(item) {
  return BUILTIN_TYPES.includes(item.type) || item.type === MONEY || item.type === CONTAINER || item.isPhysicalItem
    || Boolean(settings(item).customType);
}

export function hasInventory(actor) {
  return actor?.type === "character" || isPartyStorage(actor);
}

export function isPartyStorage(actor) {
  return storageTypes.has(actor?.type) || (actor?.type === "group" && !!actor.flags?.["swade-better-setting"]?.partyStorage);
}

export function dimensions(item, rotated = false) {
  const {width, height} = settings(item);
  const w = gridSize(width);
  const h = gridSize(height);
  return rotated ? [h, w] : [w, h];
}

export function typesOf(item) {
  const aliases = item.type === CONTAINER ? ["container", "gear"] : item.type === MONEY ? ["money"] : [];
  return [item.type, ...aliases, settings(item).customType]
    .filter(Boolean).map(type => type.toLowerCase());
}

export function matchesInventoryQuery(item, query) {
  if (!query.trim()) return true;
  const normalize = value => String(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const text = normalize([item.name, ...typesOf(item), ...(settings(item).tags ?? [])].join(" "));
  return normalize(query.trim()).split(/\s+/).every(term => text.includes(term));
}

export function matchesFlag(item, selector) {
  if (selector.startsWith("#")) return settings(item).tags?.includes(selector.slice(1).toLowerCase()) ?? false;
  const [path, ...remainder] = selector.trim().split("=");
  const expected = remainder.join("=").trim();
  const keys = path.trim().replace(/^flags\./, "").split(".");
  const value = keys.reduce((object, key) => object != null && Object.hasOwn(object, key)
    ? object[key] : undefined, item.flags);
  if (!remainder.length) return value !== undefined && value !== null && value !== false && value !== "";
  if (Array.isArray(value)) return value.some(entry => String(entry).toLowerCase() === expected.toLowerCase());
  return value != null && String(value).toLowerCase() === expected.toLowerCase();
}

function matchesType(item, types = []) {
  return types.includes("*") || types.some(type => typesOf(item).includes(type.toLowerCase()));
}

export function fitsSlot(item, slot) {
  const preferred = splitList(settings(item).slot);
  return slotMatch(item, slot) > 0
    && (!preferred.length || preferred.some(id => id === slot.id || id === slot.key) || HANDS.includes(slot.id))
    && (!ARMOR.includes(slot.id) || item.type !== "armor" || !!item.system?.locations?.[slot.id]);
}

function slotMatch(item, slot) {
  const types = typesOf(item);
  const {customType, tags = []} = settings(item);
  let best = slot.types?.length ? 0 : 1;
  for (const selector of slot.types ?? []) {
    const type = selector.toLowerCase();
    if (type === "*") best = Math.max(best, 1);
    else if (type === customType?.toLowerCase() || tags.includes(type)
      || ((type.startsWith("#") || selector.includes(".")) && matchesFlag(item, selector))) return 3;
    else if (types.includes(type)) best = Math.max(best, 2);
  }
  return best;
}

export function bestSlotPlacement(state, item, slots, rotated) {
  const preferred = splitList(settings(item).slot);
  const candidates = [...state.slots.values()].filter(slot => !state.locks.has(slot.id) && fitsSlot(item, slot));
  const rank = slot => preferred.some(id => id === slot.id || id === slot.key) ? 4 : slotMatch(item, slot);
  const standard = slot => (item.type === "armor" && slot.id === "torso") || (item.type === "shield" && slot.id === "off-hand");
  const unrestricted = slot => !slot.types?.length || slot.types.includes("*");
  candidates.sort((a, b) => rank(b) - rank(a) || Number(unrestricted(a)) - Number(unrestricted(b))
    || Number(state.occupants.has(a.id)) - Number(state.occupants.has(b.id))
    || Math.max(1, a.types?.length ?? 0) - Math.max(1, b.types?.length ?? 0) || Number(standard(b)) - Number(standard(a)));
  const items = [...state.items.values()];
  for (const slot of candidates) {
    const target = {kind: "slot", slot: slot.id, rotated};
    try {
      planMove(items, slots, item, target, state);
      return target;
    } catch {
      // A matching slot can be unavailable if its current item cannot be stowed.
    }
  }
  return null;
}

function coveredSlots(item, placement, slots) {
  if (HANDS.includes(placement.slot)) {
    return placement.twoHands ? HANDS.filter(hand => hand !== placement.slot && slots.has(hand)) : [];
  }
  if (item.type !== "armor") return [];
  return ARMOR.filter(part => part !== placement.slot && slots.has(part) && item.system?.locations?.[part]);
}

export function weightOf(item) {
  return (Number(item.system?.weight) || 0) * Number(item.system?.quantity ?? 1);
}

export function equippedWeightOf(item) {
  return item.flags?.[ID]?.equippedWeight ?? Math.ceil((Number(item.system?.weight) || 0) / 2);
}

function storageFor(item) {
  const data = settings(item).container ?? {};
  const portable = item.type === CONTAINER;
  return portable || data.enabled ? {
    item, ...containerShape(data),
    list: portable && data.layout === "list",
    factor: portable ? Math.min(1, Math.max(0, Number(data.factor ?? 1) || 0)) : 1,
    limit: Math.max(0, Number(data.limit) || 0),
    quantityLimit: Math.max(0, Number(data.quantityLimit) || 0),
    quantityRules: data.quantityRules ?? [],
    color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#58a79c",
    types: data.types ?? [], flags: data.flags ?? []
  } : null;
}

export function inventoryParent(state, id) {
  const placement = state.placements.get(id);
  if (placement?.kind === "grid") return {id: placement.container, grid: true};
  const parent = state.attachmentSlots.get(placement?.slot)?.parent;
  return parent && {id: parent.id, grid: false};
}

export function slotOccupant(state, id) {
  return state.occupants.get(id) ?? state.inactiveOccupants.get(id);
}

function contains(state, item, descendant) {
  for (let id = descendant; id; id = inventoryParent(state, id)?.id) {
    if (id === item.id) return true;
  }
  return false;
}

export function contentsWeight(state, id) {
  return (state.gridItems.get(id) ?? []).reduce((total, {item}) => total + loadedWeight(state, item), 0);
}

export function loadedWeight(state, item) {
  const factor = state.grids.get(item.id)?.factor ?? 1;
  const attachments = (state.attachedItems.get(item.id) ?? []).reduce((total, child) => total + loadedWeight(state, child), 0);
  return weightOf(item) + attachments + factor * contentsWeight(state, item.id);
}

export function baseSlots(actor) {
  return isPartyStorage(actor) ? [] : actor.flags?.[ID]?.slots ?? DEFAULT_SLOTS;
}

function legacyPlacement(item, slots) {
  const state = item.system?.equipStatus;
  if (state === EQUIP.offHand) return {kind: "slot", slot: "off-hand"};
  if (state >= EQUIP.mainHand) return {kind: "slot", slot: "main-hand", twoHands: state === EQUIP.twoHands};
  if (state !== EQUIP.worn) return null;
  const preferred = splitList(settings(item).slot);
  if (preferred.length) {
    const slot = [...slots.values()].find(slot => preferred.some(id => id === slot.id || id === slot.key) && fitsSlot(item, slot));
    if (slot) return {kind: "slot", slot: slot.id};
  }
  if (item.type === "shield") return {kind: "slot", slot: "off-hand"};
  if (item.type === "armor") {
    const slot = ["torso", "head", "arms", "legs"].find(id => slots.has(id) && item.system.locations?.[id]);
    if (slot) return {kind: "slot", slot};
  }
  return null;
}

export function readPlacement(item, slots) {
  const saved = item.flags?.[ID]?.placement;
  if (item.system?.equipStatus === EQUIP.stored) return {kind: "stored", rotated: !!saved?.rotated};
  if (saved && (saved.equipStatus == null || saved.equipStatus === item.system?.equipStatus)) return saved;
  return legacyPlacement(item, slots);
}

export function buildState(items, slotDefinitions, overrides = new Map()) {
  const slots = new Map(slotDefinitions.map(slot => [slot.id, slot]));
  const state = {
    slots, items: new Map(items.filter(isGear).map(item => [item.id, item])), placements: new Map(),
    occupants: new Map(), locks: new Map(), grids: new Map(), rootGrids: new Map(), gridItems: new Map(), stored: new Map(),
    attachmentSlots: new Map(), attachedItems: new Map(), inactiveOccupants: new Map()
  };
  const pending = [];
  for (const item of state.items.values()) {
    const storage = storageFor(item);
    if (storage) state.grids.set(item.id, storage);
    const attachments = (settings(item).slots ?? []).map(attachment => {
      const id = `${item.id}:${attachment.id}`;
      const definition = {...attachment, id, key: attachment.id, parent: item};
      state.attachmentSlots.set(id, definition);
      return definition;
    });
    const placement = overrides.has(item.id) ? overrides.get(item.id) : readPlacement(item, slots);
    if (placement?.kind === "stored") state.stored.set(item.id, item);
    else if (placement) pending.push({item, placement, attachments});
  }
  // Explicit placements take precedence over equipment inferred from a legacy sheet.
  pending.sort((a, b) => Number(explicit(b.item)) - Number(explicit(a.item)));
  const waiting = pending.filter(({placement}) => placement.kind === "slot");
  let equipped;
  do {
    equipped = 0;
    for (const {item, placement, attachments} of waiting) {
      const slot = slots.get(placement.slot);
      if (!slot || state.placements.has(item.id) || !fitsSlot(item, slot)) continue;
      if (state.occupants.has(slot.id) || state.locks.has(slot.id)) continue;
      const covered = coveredSlots(item, placement, slots);
      if (covered.some(id => state.occupants.has(id) || state.locks.has(id))) continue;
      state.placements.set(item.id, placement);
      rememberAttachment(item, slot);
      state.occupants.set(slot.id, item);
      for (const id of covered) state.locks.set(id, item);
      if (state.grids.has(item.id)) state.rootGrids.set(item.id, state.grids.get(item.id));
      for (const attachment of attachments) slots.set(attachment.id, attachment);
      equipped++;
    }
  } while (equipped);
  for (const {item, placement} of waiting) {
    const slot = state.attachmentSlots.get(placement.slot);
    if (!slot || slots.has(slot.id) || state.inactiveOccupants.has(slot.id) || !fitsSlot(item, slot)) continue;
    if (contains(state, item, slot.parent.id)) continue;
    state.inactiveOccupants.set(slot.id, item);
    state.placements.set(item.id, placement);
    rememberAttachment(item, slot);
  }
  state.gridItems = new Map([...state.grids.keys()].map(id => [id, []]));
  for (const {item, placement} of pending) {
    if (placement.kind !== "grid" || gridError(state, item, placement)) continue;
    state.placements.set(item.id, placement);
    state.gridItems.get(placement.container).push({item, placement});
  }
  return state;

  function rememberAttachment(item, slot) {
    if (!slot.parent) return;
    if (!state.attachedItems.has(slot.parent.id)) state.attachedItems.set(slot.parent.id, []);
    state.attachedItems.get(slot.parent.id).push(item);
  }

  function explicit(item) {
    return overrides.has(item.id) || Boolean(item.flags?.[ID]?.placement);
  }
}

export function gridError(state, item, placement) {
  const error = storageError(state, item, placement.container);
  if (error) return error;
  const grid = state.grids.get(placement.container);
  return grid.list ? "" : cellError(state.gridItems.get(placement.container), grid, item, placement);
}

export function storageError(state, item, container) {
  const grid = state.grids.get(container);
  if (!grid) return sbsI18n("swade-grid-inventory.UI.Chooseanavailablecontainer_a6b07f377b");
  if (contains(state, item, container)) return sbsI18n("swade-grid-inventory.UI.Acontainercannotgoinsideitself_1a84554bfb");
  if (grid.types.length || grid.flags.length) {
    const allowed = matchesType(item, grid.types) || grid.flags.some(flag => matchesFlag(item, flag));
    if (!allowed) return `${grid.item.name} does not accept this item.`;
  }
  const quantityError = containerQuantityError(state, item, container);
  if (quantityError) return quantityError;
  const mass = loadedWeight(state, item);
  const changes = new Map();
  addWeight({id: container, grid: true}, mass);
  addWeight(inventoryParent(state, item.id), -mass);
  for (const [affected, change] of changes) {
    if (change > 0 && affected.limit && contentsWeight(state, affected.item.id) + change > affected.limit + 1e-8) {
      return `${affected.item.name} would exceed its weight limit.`;
    }
  }
  return "";

  function addWeight(first, change) {
    for (let link = first; link && change; link = inventoryParent(state, link.id)) {
      if (!link.grid) continue;
      const parent = state.grids.get(link.id);
      changes.set(parent, (changes.get(parent) ?? 0) + change);
      change *= parent.factor;
    }
  }
}

export function containerQuantities(state, container, item) {
  const grid = state.grids.get(container);
  if (!grid) return null;
  const contents = (state.gridItems.get(container) ?? []).map(entry => entry.item).filter(other => other.id !== item?.id);
  if (item) contents.push(item);
  const count = entries => entries.reduce((total, entry) => total + Math.max(0, Number(entry.system?.quantity ?? 1) || 0), 0);
  const effects = globalThis.game?.modules?.get("swade-better-effects")?.api;
  const rules = [];
  for (const rule of grid.quantityRules) {
    if (!(rule.limit > 0)) continue;
    const matches = entry => splitList(rule.match).some(selector => rule.kind === "flag"
      ? matchesFlag(entry, selector) || !!effects?.getFlags?.(entry)?.includes(effects.normalizeFlag(selector))
      : matchesType(entry, [selector]));
    rules.push({...rule, current: count(contents.filter(matches))});
  }
  return {current: count(contents), limit: grid.quantityLimit, rules};
}

export function containerQuantityError(state, item, container) {
  const quantities = containerQuantities(state, container, item);
  if (!quantities) return "";
  const name = state.grids.get(container).item.name;
  if (quantities.limit && quantities.current > quantities.limit) {
    return `${name} allows at most ${quantities.limit} items in total.`;
  }
  for (const rule of quantities.rules) {
    if (rule.current > rule.limit) return `${name} allows at most ${rule.limit} items matching ${rule.match}.`;
  }
  return "";
}

function cellError(entries, grid, item, {x, y, rotated}) {
  const [width, height] = dimensions(item, rotated);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + width > grid.width || y + height > grid.height) {
    return `This item extends beyond ${grid.item.name}.`;
  }
  if (grid.pattern) {
    for (let row = y; row < y + height; row++) {
      if (grid.pattern[row].slice(x, x + width).includes(".")) {
        return `This item crosses an unpainted cell in ${grid.item.name}.`;
      }
    }
  }
  for (const {item: other, placement: point} of entries) {
    if (other.id === item.id) continue;
    const [w, h] = dimensions(other, point.rotated);
    if (x < point.x + w && x + width > point.x && y < point.y + h && y + height > point.y) {
      return `That space is occupied by ${other.name}.`;
    }
  }
  return "";
}

export function listDrop(state, item, container, rotated) {
  const origin = state.placements.get(item.id);
  return {...(origin?.container === container ? origin : {}), kind: "grid", container, rotated};
}

export function findSpace(state, item, rotated = false, onlyContainer, near) {
  let nearest = null;
  let distance = Infinity;
  let originDistance = Infinity;
  const [itemWidth, itemHeight] = dimensions(item);
  const rotations = itemWidth === itemHeight ? [rotated] : [rotated, !rotated];
  const grids = onlyContainer ? [state.grids.get(onlyContainer)].filter(Boolean) : state.rootGrids.values();
  for (const grid of grids) {
    const container = grid.item.id;
    if (storageError(state, item, container)) continue;
    if (grid.list) return listDrop(state, item, container, rotated);
    const entries = state.gridItems.get(container);
    for (const turn of rotations) {
      const [width, height] = turn ? [itemHeight, itemWidth] : [itemWidth, itemHeight];
      for (let y = 0; y + height <= grid.height; y++) {
        for (let x = 0; x + width <= grid.width; x++) {
          const placement = {kind: "grid", container, x, y, rotated: turn};
          if (cellError(entries, grid, item, placement)) continue;
          if (!near) return placement;
          const steps = Math.max(0, x - near.x, near.x - x - width + 1)
            + Math.max(0, y - near.y, near.y - y - height + 1);
          const originSteps = Math.abs(x - near.x) + Math.abs(y - near.y);
          if (steps < distance || (steps === distance && originSteps < originDistance)) {
            distance = steps;
            originDistance = originSteps;
            nearest = placement;
          }
        }
      }
    }
  }
  return nearest;
}

export function fitListContents(items, slots, original, container) {
  const area = item => {
    const [width, height] = dimensions(item);
    return width * height;
  };
  const contents = [...original.gridItems.get(container)].sort((a, b) => area(b.item) - area(a.item));
  const changes = new Map();
  const next = buildState(items, slots);
  if (!fit(changes, next, contents.filter(({item}) => !next.placements.has(item.id)))) return changes;

  const rearranged = new Map(contents.map(({item}) => [item.id, {kind: "loose"}]));
  const blocked = fit(rearranged, buildState(items, slots, rearranged), contents);
  if (blocked) {
    throw new Error(sbsI18n("swade-grid-inventory.UI.doesnotfitthegridChange_875a471292", {p0: (blocked.name)}));
  }
  return rearranged;

  function fit(placements, state, entries) {
    for (const {item, placement} of entries) {
      const target = findSpace(state, item, placement.rotated, container);
      if (!target) return item;
      placements.set(item.id, target);
      state = buildState(items, slots, placements);
    }
  }
}

export function usesExactGridDrop(state, item) {
  const origin = state.placements.get(item.id);
  return origin?.kind === "slot" || (origin?.kind === "grid" && !state.grids.get(origin.container)?.list);
}

export function gridDrop(state, item, target) {
  if (usesExactGridDrop(state, item)) return target;
  const grid = state.grids.get(target.container);
  if (grid?.pattern && !gridError(state, item, target)) return target;
  return findSpace(state, item, target.rotated, target.container, grid?.pattern ? target : undefined);
}

export function occupiedChildren(state, item) {
  return (state.gridItems.get(item.id)?.length ?? 0) > 0
    || (state.attachedItems.get(item.id)?.length ?? 0) > 0;
}

export function planMove(items, slots, item, target, original = buildState(items, slots)) {
  const changes = new Map([[item.id, target]]);
  const withItem = items.some(entry => entry.id === item.id) ? items : [...items, item];
  if (target.kind === "grid") {
    const error = gridError(original, item, target);
    if (error) throw new Error(error);
  }
  if (target.kind === "slot") {
    const active = original.slots.get(target.slot);
    const slot = active ?? original.attachmentSlots.get(target.slot);
    if (!slot || !fitsSlot(item, slot)) throw new Error(sbsI18n("swade-grid-inventory.UI.Thisitemdoesnotfit_bac1923c38", {p0: (slot?.label ?? "that slot")}));
    if (slot.parent && contains(original, item, slot.parent.id)) throw new Error(sbsI18n("swade-grid-inventory.UI.Anitemcannotoccupyitsown_5c076d1f65"));
    const lock = original.locks.get(slot.id);
    if (lock && lock.id !== item.id) throw new Error(sbsI18n("swade-grid-inventory.UI.isblockedby_5db6ac021a", {p0: (slot.label), p1: (lock.name)}));
    const other = slotOccupant(original, slot.id);
    if (other && other.id !== item.id) changes.set(other.id, {kind: "loose"});
    if (target.twoHands && (!HANDS.includes(slot.id) || !HANDS.every(id => original.slots.has(id)))) {
      throw new Error(sbsI18n("swade-grid-inventory.UI.Twohandedgriprequiresbothhand_9ebbbf52a4"));
    }
    const covered = active ? coveredSlots(item, target, original.slots) : [];
    for (const id of covered) {
      const blocking = original.locks.get(id);
      if (blocking && blocking.id !== item.id) throw new Error(sbsI18n("swade-grid-inventory.UI.alreadycovers_42317d9b76", {p0: (blocking.name), p1: (original.slots.get(id).label)}));
      const displaced = original.occupants.get(id);
      if (displaced && displaced.id !== item.id) changes.set(displaced.id, {kind: "loose"});
    }
    for (const [id, placement] of changes) {
      if (placement.kind !== "loose") continue;
      const displaced = original.items.get(id);
      const pending = buildState(withItem, slots, changes);
      const rotated = !!original.placements.get(id)?.rotated;
      let space;
      if (!active) {
        if (pending.grids.has(slot.parent.id)) space = findSpace(pending, displaced, rotated, slot.parent.id);
        for (let parent = inventoryParent(pending, slot.parent.id); parent && !space; parent = inventoryParent(pending, parent.id)) {
          if (parent.grid) space = findSpace(pending, displaced, rotated, parent.id);
        }
      }
      space ??= findSpace(pending, displaced, rotated);
      if (!space) throw new Error(sbsI18n("swade-grid-inventory.UI.Nospacetostow_04d21f751c", {p0: (displaced.name)}));
      changes.set(id, space);
    }
  }
  const next = buildState(withItem, slots, changes);
  if (["grid", "slot"].includes(target.kind) && next.placements.get(item.id) !== target) {
    throw new Error(sbsI18n("swade-grid-inventory.UI.Thismovewouldinvalidateanequipment_90ffd47b72"));
  }
  for (const id of original.placements.keys()) {
    if (!next.placements.has(id) && id !== item.id) {
      throw new Error(sbsI18n("swade-grid-inventory.UI.Moveoutofitsslotor_f4ae219845", {p0: (original.items.get(id).name)}));
    }
  }
  for (const [id, placement] of next.placements) {
    if (placement.kind !== "slot" || !next.attachmentSlots.has(placement.slot)) continue;
    const attached = next.items.get(id);
    const inactive = next.occupants.get(placement.slot)?.id !== id;
    const equipped = {...placement, inactive};
    if (changes.has(id) || equipStatus(attached, equipped) !== attached.system?.equipStatus) changes.set(id, equipped);
  }
  return changes;
}

export function equipStatus(item, placement) {
  if (typeof item.system?.equipStatus !== "number") return undefined;
  if (placement.kind === "stored") return EQUIP.stored;
  if (placement.kind !== "slot" || placement.inactive) return EQUIP.carried;
  if (placement.twoHands && ["weapon", "shield"].includes(item.type)) return EQUIP.twoHands;
  if (item.type === "weapon") {
    if (placement.slot === "main-hand") return EQUIP.mainHand;
    if (placement.slot === "off-hand") return EQUIP.offHand;
    return EQUIP.carried;
  }
  if (item.type === "armor" && HANDS.includes(placement.slot)) return EQUIP.carried;
  if (item.type === "armor" || item.type === "shield" || item.system.equippable) return EQUIP.worn;
  return EQUIP.carried;
}
