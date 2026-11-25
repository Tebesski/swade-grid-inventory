import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTAINER, DEFAULT_SLOTS, ID, MONEY, bestSlotPlacement, buildState, contentsWeight, equipStatus, equippedWeightOf, findSpace, isHudInventoryItem,
  canEquipInSlot, containerQuantities, fitListContents, fitsSlot, gridDrop, gridError, loadedWeight, matchesInventoryQuery, planMove
} from "../scripts/model.mjs";
import {packGrids} from "../scripts/board.mjs";
import {cellKey, containerShape, displayedShape, serializeCells, shapeCells, traceCells} from "../scripts/container-shape.mjs";
import {firstSlotPosition, placeLayoutEntry} from "../scripts/slot-layout.mjs";
import {canSplit, checkQuantityUpdate, equip, move} from "../scripts/actions.mjs";
import {preserveTransferPlacement, transferActorDrop} from "../scripts/transfers.mjs";
import {soundPath} from "../scripts/sounds.mjs";

const slot = (slot, twoHands = false) => ({kind: "slot", slot, twoHands});
const cell = (container, x = 0, y = 0, rotated = false) => ({kind: "grid", container, x, y, rotated});

function item(id, type, {config = {}, system = {}, placement} = {}) {
  return {id, name: id, type, system: {equipStatus: 1, ...system}, flags: {[ID]: {item: config, placement}}};
}

function bag(config = {}) {
  return item("bag", "gear", {config: {container: {enabled: true, width: 3, height: 2, ...config}},
    placement: slot("backpack")});
}

test("two-handed grip stows the opposite hand at the first acceptable position", () => {
  const sword = item("sword", "weapon", {placement: slot("off-hand")});
  const dagger = item("dagger", "weapon", {placement: slot("main-hand")});
  const filler = item("filler", "gear", {placement: cell("bag")});
  const items = [sword, dagger, bag(), filler];
  const changes = planMove(items, DEFAULT_SLOTS, sword, slot("off-hand", true));
  assert.deepEqual(changes.get("dagger"), cell("bag", 1, 0));
  const state = buildState(items, DEFAULT_SLOTS, changes);
  assert.equal(state.locks.get("main-hand"), sword);
  assert.equal(equipStatus(sword, changes.get("sword")), 5);
});

test("a failed grip leaves both existing hand placements intact", () => {
  const sword = item("sword", "weapon", {placement: slot("main-hand")});
  const dagger = item("dagger", "weapon", {placement: slot("off-hand")});
  const items = [sword, dagger, bag({types: ["consumable"]})];
  assert.throws(() => planMove(items, DEFAULT_SLOTS, sword, slot("main-hand", true)), /No space to stow dagger/);
  assert.equal(buildState(items, DEFAULT_SLOTS).occupants.get("off-hand"), dagger);
});

test("worn armor blocks its SWADE coverage slots and stows conflicting armor", () => {
  const helm = item("helm", "armor", {system: {locations: {head: true}}, placement: slot("head")});
  const suit = item("suit", "armor", {system: {locations: {head: true, torso: true, arms: true}}});
  const items = [helm, suit, bag()];
  const changes = planMove(items, DEFAULT_SLOTS, suit, slot("torso"));
  const state = buildState(items, DEFAULT_SLOTS, changes);
  assert.equal(state.locks.get("head"), suit);
  assert.equal(state.locks.get("arms"), suit);
  assert.deepEqual(state.placements.get("helm"), cell("bag"));
  assert.equal(equipStatus(suit, slot("main-hand")), 1);
});

test("container filters, footprints, and stack weights affect fit", () => {
  const coins = item("coins", MONEY, {system: {quantity: 3, weight: 1}});
  const tonic = item("tonic", "gear", {system: {weight: 1}, config: {tags: ["potion"], width: 1, height: 3}});
  const stone = item("stone", "gear");
  const state = buildState([bag({limit: 2, types: ["money"], flags: ["#potion"]})], DEFAULT_SLOTS);
  assert.match(gridError(state, stone, cell("bag")), /does not accept/);
  assert.match(gridError(state, coins, cell("bag")), /weight limit/);
  assert.match(gridError(state, tonic, cell("bag")), /extends beyond/);
  assert.equal(gridError(state, tonic, cell("bag", 0, 0, true)), "");
});

test("portable containers keep their contents when worn, nested, or stored", () => {
  const pack = bag();
  const pouch = item("pouch", CONTAINER, {system: {weight: 2}, placement: slot("belt"),
    config: {container: {factor: 0.5, limit: 7}}});
  const vials = item("vials", "consumable", {system: {weight: 2, quantity: 3}, placement: cell("pouch")});
  const items = [vials, pouch, pack];
  const initial = buildState(items, DEFAULT_SLOTS);
  assert.equal(initial.rootGrids.has(pouch.id), true);
  const placement = cell(pack.id);
  const nested = buildState(items, DEFAULT_SLOTS, planMove(items, DEFAULT_SLOTS, pouch, placement, initial));
  assert.equal(nested.rootGrids.has(pouch.id), false);
  assert.equal(nested.gridItems.get(pouch.id)[0].item, vials);
  assert.equal(contentsWeight(nested, pouch.id), 6);
  assert.equal(loadedWeight(nested, pouch), 5);
  assert.equal(contentsWeight(nested, pack.id), 5);
  const stored = buildState(items, DEFAULT_SLOTS, planMove(items, DEFAULT_SLOTS, pouch, {kind: "stored"}, nested));
  assert.equal(stored.stored.get(pouch.id), pouch);
  assert.equal(stored.gridItems.get(pouch.id)[0].item, vials);
});

test("nested weight changes respect ancestor limits and cannot form a cycle", () => {
  const pack = bag({limit: 5});
  const pouch = item("pouch", CONTAINER, {system: {weight: 2}, placement: cell(pack.id),
    config: {container: {factor: 0.5, types: ["container"], flags: ["#ammo"]}}});
  const caseItem = item("case", CONTAINER, {system: {weight: 1}, placement: cell(pouch.id),
    config: {container: {factor: 0.5}}});
  const stones = item("stones", "gear", {system: {weight: 12}});
  const shot = item("shot", "gear", {system: {weight: 4}, config: {tags: ["ammo"]}, placement: cell(caseItem.id)});
  const items = [pack, pouch, caseItem, shot, stones];
  const state = buildState(items, DEFAULT_SLOTS);
  assert.equal(contentsWeight(state, pack.id), 3.5);
  assert.match(gridError(state, pouch, cell(caseItem.id, 1)), /inside itself or one of its contents/);
  assert.match(gridError(state, stones, cell(pouch.id, 1)), /does not accept/);
  assert.match(gridError(state, stones, cell(caseItem.id, 1)), /bag would exceed its weight limit/);
  assert.doesNotThrow(() => planMove(items, DEFAULT_SLOTS, shot, cell(pouch.id, 1), state));
});

test("list containers ignore item dimensions and retain filters, capacity, and loaded weight", () => {
  const caseItem = item("case", CONTAINER, {placement: slot("backpack"), system: {weight: 2},
    config: {container: {layout: "list", width: 1, height: 1, factor: 0.5, limit: 4, types: ["weapon"]}}});
  const sword = item("sword", "weapon", {system: {weight: 3}, config: {width: 8, height: 4}});
  const dagger = item("dagger", "weapon", {system: {weight: 1}});
  const club = item("club", "weapon", {system: {weight: 1}});
  const stone = item("stone", "gear");
  const items = [caseItem, sword, dagger, club, stone];
  for (const weapon of [sword, dagger]) {
    const state = buildState(items, DEFAULT_SLOTS);
    const target = findSpace(state, weapon);
    assert.deepEqual(target, {kind: "grid", container: caseItem.id, rotated: false});
    weapon.flags[ID].placement = planMove(items, DEFAULT_SLOTS, weapon, target, state).get(weapon.id);
  }
  const state = buildState(items, DEFAULT_SLOTS);
  assert.equal(state.gridItems.get(caseItem.id).length, 2);
  assert.equal(loadedWeight(state, caseItem), 4);
  assert.match(gridError(state, club, cell(caseItem.id)), /exceed its weight limit/);
  assert.match(gridError(state, stone, cell(caseItem.id)), /does not accept/);
  assert.match(gridError(state, caseItem, cell(caseItem.id)), /inside itself/);
});

test("switching from List to Grid repacks as needed and rejects a grid that cannot hold everything", () => {
  const container = layout => item("case", CONTAINER, {config: {container: {layout, width: 3, height: 1}}});
  const blocker = item("blocker", "gear", {placement: cell("case", 1)});
  const sword = item("sword", "weapon", {config: {width: 2}, placement: {kind: "grid", container: "case"}});
  const original = buildState([container("list"), blocker, sword], DEFAULT_SLOTS);
  const items = [container("grid"), blocker, sword];
  const fitted = fitListContents(items, DEFAULT_SLOTS, original, "case");
  assert.deepEqual(fitted.get(sword.id), cell("case"));
  assert.deepEqual(fitted.get(blocker.id), cell("case", 2));
  assert.equal(buildState(items, DEFAULT_SLOTS, fitted).gridItems.get("case").length, 2);

  const small = item("case", CONTAINER, {config: {container: {width: 1, height: 1}}});
  assert.throws(() => fitListContents([small, blocker, sword], DEFAULT_SLOTS, original, "case"), /sword does not fit/);
  assert.equal(original.gridItems.get("case").length, 2);
  assert.deepEqual(original.placements.get(blocker.id), cell("case", 1));
});

test("stowing loaded gear retains its grid and attachments and restores them on equip", () => {
  const caseItem = item("case", "gear", {placement: slot("belt"),
    system: {weight: 1}, config: {container: {enabled: true}, slots: [{id: "vial", label: "Vial", types: ["potion"]}]}});
  const tonic = item("tonic", "gear", {placement: slot("case:vial"), system: {weight: 2, equipStatus: 3, equippable: true},
    config: {customType: "potion", slot: "vial"}});
  const notes = item("notes", "gear", {placement: cell(caseItem.id), system: {weight: 3}});
  const container = item("outer", CONTAINER, {config: {container: {layout: "list", limit: 6, factor: 0.5}}});
  const items = [tonic, notes, caseItem, container];
  const initial = buildState(items, DEFAULT_SLOTS);
  assert.equal(initial.occupants.get("case:vial"), tonic);
  const stowed = planMove(items, DEFAULT_SLOTS, caseItem, {kind: "grid", container: container.id}, initial);
  assert.equal(equipStatus(tonic, stowed.get(tonic.id)), 1);
  const nested = buildState(items, DEFAULT_SLOTS, stowed);
  assert.equal(nested.slots.has("case:vial"), false);
  assert.equal(nested.placements.get(tonic.id).slot, "case:vial");
  assert.equal(nested.gridItems.get(caseItem.id)[0].item, notes);
  assert.equal(contentsWeight(nested, container.id), 6);
  assert.equal(loadedWeight(nested, container), 3);
  assert.match(gridError(nested, container, cell(caseItem.id, 1)), /inside itself or one of its contents/);

  const worn = buildState(items, DEFAULT_SLOTS, new Map([[caseItem.id, slot("belt")]]));
  assert.equal(worn.occupants.get("case:vial"), tonic);
  assert.equal(worn.gridItems.get(caseItem.id)[0].item, notes);

  const shallow = item("shallow", CONTAINER, {config: {container: {limit: 5}}});
  assert.throws(() => planMove([...items, shallow], DEFAULT_SLOTS, caseItem, cell(shallow.id)), /exceed its weight limit/);
});

test("editing a stowed attachment keeps it inactive and stows the previous occupant nearby", () => {
  const outer = item("outer", CONTAINER, {config: {container: {limit: 3}}});
  const belt = item("belt", "gear", {placement: cell(outer.id), config: {
    container: {enabled: true}, slots: [{id: "loop", label: "Loop", types: ["armor", "container"]}]
  }});
  const old = item("old", "armor", {placement: slot("belt:loop"), system: {weight: 1}});
  const replacement = item("replacement", "armor", {system: {weight: 2}});
  const heavy = item("heavy", "armor", {system: {weight: 4}});
  const items = [outer, belt, old, replacement, heavy];
  const state = buildState(items, DEFAULT_SLOTS);
  assert.equal(state.slots.has("belt:loop"), false);
  assert.equal(state.inactiveOccupants.get("belt:loop"), old);
  const target = slot("belt:loop");
  assert.throws(() => planMove(items, DEFAULT_SLOTS, outer, target, state), /descendant/);
  assert.throws(() => planMove(items, DEFAULT_SLOTS, heavy, target, state), /space|invalidate|Move/);
  const changes = planMove(items, DEFAULT_SLOTS, replacement, target, state);
  assert.deepEqual(changes.get(old.id), cell(belt.id));
  assert.equal(equipStatus(replacement, changes.get(replacement.id)), 1);
  const next = buildState(items, DEFAULT_SLOTS, changes);
  assert.equal(next.inactiveOccupants.get("belt:loop"), replacement);
  assert.equal(contentsWeight(next, outer.id), 3);
});

test("SWADE Stored items move out of the carried layout and can be retrieved", () => {
  const worn = item("worn", "weapon", {system: {equipStatus: 0}, placement: slot("main-hand")});
  const items = [worn, bag()];
  const state = buildState(items, DEFAULT_SLOTS);
  assert.equal(state.stored.get("worn"), worn);
  assert.equal(state.occupants.has("main-hand"), false);
  const target = cell("bag");
  const changes = planMove(items, DEFAULT_SLOTS, worn, target);
  assert.equal(buildState(items, DEFAULT_SLOTS, changes).placements.get("worn"), target);
  assert.equal(equipStatus(worn, target), 1);
  assert.equal(equipStatus(worn, {kind: "stored"}), 0);
});

test("new container placement finds a free cell and rotates only when necessary", () => {
  const blocker = item("blocker", "gear", {placement: cell("bag")});
  const tall = item("tall", "gear", {config: {width: 1, height: 3}});
  const wide = item("wide", "gear", {config: {width: 2, height: 1}});
  const state = buildState([bag(), blocker, tall, wide], DEFAULT_SLOTS);
  assert.deepEqual(gridDrop(state, tall, cell("bag", 2, 1)), cell("bag", 0, 1, true));
  assert.deepEqual(gridDrop(state, wide, cell("bag", 2, 1)), cell("bag", 1, 0));
  const request = cell("bag", 2, 1, true);
  assert.equal(gridDrop(state, blocker, request), request);
});

test("grid-to-grid transfers keep the requested position and rotation", () => {
  const pack = bag();
  const belt = item("belt", CONTAINER, {placement: slot("belt"), config: {container: {pattern: ["###", "#.#"]}}});
  const blade = item("blade", "weapon", {config: {width: 2}, placement: cell(pack.id)});
  const items = [pack, belt, blade];
  const state = buildState(items, DEFAULT_SLOTS);
  const selected = cell(belt.id, 1);
  assert.equal(gridDrop(state, blade, selected), selected);
  assert.equal(planMove(items, DEFAULT_SLOTS, blade, selected, state).get(blade.id), selected);
  const blocked = cell(belt.id, 0, 1);
  assert.equal(gridDrop(state, blade, blocked), blocked);
  assert.throws(() => planMove(items, DEFAULT_SLOTS, blade, blocked, state), /unpainted cell/);
  assert.deepEqual(findSpace(state, blade, false, belt.id), cell(belt.id));
});

test("blank sound flags provide per-action defaults after item and flag-specific sounds", () => {
  const rules = [
    {flag: "", drag: "sfx/default*.ogg", place: "sfx/place.ogg"},
    {flag: "#potion", drag: "sfx/potion.ogg"}
  ];
  const potion = item("potion", "consumable", {config: {tags: ["potion"], sounds: {place: "sfx/custom.ogg"}}});
  const pack = bag();
  assert.equal(soundPath(pack, "drag", rules), "sfx/default*.ogg");
  assert.equal(soundPath(pack, "place", rules), "sfx/place.ogg");
  assert.equal(soundPath(potion, "drag", rules), "sfx/potion.ogg");
  assert.equal(soundPath(potion, "place", rules), "sfx/custom.ogg");
  assert.equal(soundPath(potion, "equip", rules), undefined);
});

test("sound actions fall through matching rules independently before using the general sound", () => {
  const money = item("notes", MONEY, {config: {tags: ["money", "paper"]}});
  const rules = [
    {flag: "#money", drag: "  ", equip: "money-equip.ogg", place: "money-place.ogg"},
    {flag: "#paper", drag: "paper-drag.ogg", place: "paper-place.ogg"}
  ];
  assert.equal(soundPath(money, "drag", rules, "general.ogg"), "paper-drag.ogg");
  assert.equal(soundPath(money, "place", rules, "general.ogg"), "money-place.ogg");
  assert.equal(soundPath(money, "equip", rules, "general.ogg"), "money-equip.ogg");
  assert.equal(soundPath(item("stone", "gear"), "place", rules, "general.ogg"), "general.ogg");
});

test("equipping a stack by ID updates the original embedded item and preserves its quantity", async () => {
  const pack = bag();
  const coins = item("coins", MONEY, {system: {quantity: 4}, placement: cell("bag")});
  const items = new Map([[pack.id, pack], [coins.id, coins]]);
  items.contents = [...items.values()];
  const actor = {
    uuid: "Actor.picker",
    isOwner: true,
    type: "character",
    items,
    async updateEmbeddedDocuments(type, updates) {
      assert.equal(type, "Item");
      assert.deepEqual(updates.map(update => update._id), [coins.id]);
      assert.equal(Object.hasOwn(updates[0], "system.quantity"), false);
      coins.flags[ID].placement = updates[0][`flags.${ID}.placement`];
    },
    async createEmbeddedDocuments() {
      assert.fail("The picker must never create a new item.");
    }
  };
  await equip(actor, coins.id, "main-hand");
  const state = buildState(items.contents, DEFAULT_SLOTS);
  assert.equal(state.occupants.get("main-hand"), coins);
  assert.equal(state.gridItems.get(pack.id).length, 0);
  assert.equal(coins.system.quantity, 4);
  await assert.rejects(equip(actor, "removed-item", "main-hand"), /cannot be added/);
});

test("the item menu can offer Split for stacks without offering it for containers", () => {
  assert.equal(canSplit(item("single", "gear", {system: {quantity: 1}})), false);
  assert.equal(canSplit(item("stack", "gear", {system: {quantity: 4}})), true);
  assert.equal(canSplit(item("container", CONTAINER, {system: {quantity: 4}})), false);
});

test("automatic equip prioritizes a matching flag, then type, then a wildcard", () => {
  const slots = [
    {id: "main-hand", label: "Main hand", types: ["*"]},
    {id: "gear", label: "Gear", types: ["gear"]},
    {id: "belt", label: "Belt", types: ["#belt"]}
  ];
  const belt = item("utility-belt", "gear", {config: {tags: ["belt"]}});
  const ordinary = item("ordinary", "gear");
  const sword = item("sword", "weapon");
  const state = buildState([belt, ordinary, sword], slots);
  assert.equal(bestSlotPlacement(state, belt, slots, false).slot, "belt");
  assert.equal(bestSlotPlacement(state, ordinary, slots, false).slot, "gear");
  assert.equal(bestSlotPlacement(state, sword, slots, false).slot, "main-hand");

  const occupied = item("occupied", "gear", {config: {tags: ["belt"]}, placement: slot("belt")});
  const withoutStorage = buildState([belt, occupied], slots);
  assert.equal(bestSlotPlacement(withoutStorage, belt, slots, false).slot, "belt");
});

test("container quantity caps count stack totals and enforce every matching type or flag rule", () => {
  for (const layout of ["grid", "list"]) {
    const pack = item("pack", CONTAINER, {config: {container: {layout, width: 5, height: 5, quantityLimit: 100,
      quantityRules: [{kind: "type", match: "consumable", limit: 20}, {kind: "flag", match: "#potion", limit: 10}]}},
      placement: slot("backpack")});
    const existing = item("existing", "consumable", {system: {quantity: 8}, config: {tags: ["potion"]}, placement: cell("pack")});
    const general = item("general", "gear", {system: {quantity: 80}, placement: cell("pack", 1)});
    const candidate = item("candidate", "consumable", {system: {quantity: 3}, config: {tags: ["potion"]}});
    let state = buildState([pack, existing, general], DEFAULT_SLOTS);
    assert.match(gridError(state, candidate, cell("pack", 2)), /at most 10/);
    candidate.system.quantity = 2;
    assert.equal(gridError(state, candidate, cell("pack", 2)), "");
    candidate.flags[ID].item.tags = [];
    candidate.system.quantity = 13;
    pack.flags[ID].item.container.quantityLimit = 0;
    state = buildState([pack, existing, general], DEFAULT_SLOTS);
    assert.match(gridError(state, candidate, cell("pack", 2)), /at most 20/);
    candidate.type = "gear";
    assert.equal(gridError(state, candidate, cell("pack", 2)), "");
    pack.flags[ID].item.container.quantityLimit = 100;
    state = buildState([pack, existing, general], DEFAULT_SLOTS);
    assert.match(gridError(state, candidate, cell("pack", 2)), /100 items in total/);
    assert.equal(gridError(state, existing, cell("pack", 3)), "");
  }
});

test("editing a stored stack cannot bypass its container quantity limit", () => {
  const pack = bag({quantityLimit: 10});
  const stack = item("stack", "gear", {system: {quantity: 8}, placement: cell("bag")});
  const items = new Map([pack, stack].map(item => [item.id, item]));
  items.contents = [...items.values()];
  stack.actor = {type: "character", items};
  const previousUI = globalThis.ui;
  const warnings = [];
  globalThis.ui = {notifications: {warn: message => warnings.push(message)}};
  try {
    assert.equal(checkQuantityUpdate(stack, {system: {quantity: 11}}), false);
    assert.match(warnings[0], /10 items in total/);
    assert.equal(checkQuantityUpdate(stack, {"system.quantity": 10}), undefined);
    assert.equal(checkQuantityUpdate(stack, {system: {quantity: 7}}), undefined);
  } finally {
    globalThis.ui = previousUI;
  }
});

test("quantity totals replace the indexed contribution when an existing item's quantity or flags change", () => {
  const pack = bag({quantityLimit: 10, quantityRules: [{kind: "flag", match: "#potion", limit: 4}]});
  const stack = item("stack", "gear", {config: {tags: ["potion"]}, system: {quantity: 4}, placement: cell("bag")});
  const other = item("other", "gear", {system: {quantity: 2}, placement: cell("bag", 1)});
  const state = buildState([pack, stack, other], DEFAULT_SLOTS);
  stack.system.quantity = 8;
  stack.flags[ID].item.tags = [];
  const totals = containerQuantities(state, pack.id, stack);
  assert.equal(totals.current, 10);
  assert.equal(totals.rules[0].current, 0);
  assert.equal(gridError(state, stack, cell("bag", 2)), "");
});

test("slot picker falls back to full validation when equipping could invalidate another placement", () => {
  const pack = bag();
  const first = item("first", "gear", {placement: cell("bag", 0)});
  const waiting = item("waiting", "gear", {placement: cell("bag", 0), config: {width: 2}});
  const second = item("second", "gear", {placement: cell("bag", 1)});
  const items = [pack, first, waiting, second];
  const state = buildState(items, DEFAULT_SLOTS);
  const hand = state.slots.get("main-hand");
  const target = slot(hand.id);
  // Moving first would let waiting reclaim its saved position and strand second.
  assert.equal(canEquipInSlot(state, items, DEFAULT_SLOTS, first, hand, target), false);
  assert.equal(canEquipInSlot(state, items, DEFAULT_SLOTS, second, hand, target), true);
});

test("multiple equipment IDs work for placement, automatic equip, and legacy worn gear", () => {
  const slots = [...DEFAULT_SLOTS,
    {id: "first", types: ["gear"]}, {id: "second", types: ["gear"]}, {id: "other", types: ["gear"]}];
  const gear = item("multi", "gear", {config: {slot: " first, second, first "}});
  assert.equal(fitsSlot(gear, slots.find(slot => slot.id === "first")), true);
  assert.equal(fitsSlot(gear, slots.find(slot => slot.id === "second")), true);
  assert.equal(fitsSlot(gear, slots.find(slot => slot.id === "other")), false);
  assert.equal(fitsSlot(gear, DEFAULT_SLOTS.find(slot => slot.id === "main-hand")), true);
  const blocked = item("blocker", "gear", {placement: slot("first")});
  const state = buildState([gear, blocked], slots);
  assert.equal(bestSlotPlacement(state, gear, slots, false).slot, "second");
  assert.equal(planMove([gear, blocked], slots, gear, slot("second")).get(gear.id).slot, "second");
  const legacy = item("legacy", "gear", {config: {slot: "missing, second"}, system: {equipStatus: 3}});
  assert.equal(buildState([legacy], slots).placements.get(legacy.id).slot, "second");
  const single = item("single", "gear", {config: {slot: "first"}, system: {equipStatus: 3}});
  assert.equal(buildState([single], slots).placements.get(single.id).slot, "first");
});

test("multiple attachment IDs match their local keys on active and stowed containers", () => {
  const pack = bag();
  pack.flags[ID].item.slots = [
    {id: "left-pouch", types: ["gear"]}, {id: "right-pouch", types: ["gear"]}, {id: "case", types: ["gear"]}
  ];
  const gear = item("pouch", "gear", {config: {slot: "left-pouch, right-pouch"}, placement: slot("bag:right-pouch")});
  const state = buildState([pack, gear], DEFAULT_SLOTS);
  assert.equal(state.occupants.get("bag:right-pouch"), gear);
  assert.equal(fitsSlot(gear, state.slots.get("bag:left-pouch")), true);
  assert.equal(fitsSlot(gear, state.slots.get("bag:case")), false);
  const stowed = buildState([pack, gear], DEFAULT_SLOTS, new Map([[pack.id, {kind: "loose"}]]));
  assert.equal(stowed.inactiveOccupants.get("bag:right-pouch"), gear);
});

test("dragging from an equipment slot uses the requested grid cells or rejects the drop", () => {
  const held = item("held", "gear", {placement: slot("main-hand")});
  const blocker = item("blocker", "gear", {placement: cell("bag")});
  const items = [held, blocker, bag()];
  const state = buildState(items, DEFAULT_SLOTS);
  const target = cell("bag", 2, 1);
  const occupied = cell("bag");
  assert.equal(gridDrop(state, held, target), target);
  assert.equal(gridDrop(state, held, occupied), occupied);
  assert.throws(() => planMove(items, DEFAULT_SLOTS, held, occupied, state), /occupied by blocker/);
  assert.equal(state.occupants.get("main-hand"), held);
});

test("container regions share cell edges and never share cells", () => {
  const sizes = [{width: 10, height: 10}, {width: 3, height: 3}, {width: 2, height: 2}];
  assert.deepEqual(packGrids(sizes, 15), [
    {...sizes[0], x: 0, y: 0}, {...sizes[1], x: 10, y: 0}, {...sizes[2], x: 13, y: 0}
  ]);
  assert.deepEqual(packGrids(sizes, 10), [
    {...sizes[0], x: 0, y: 0}, {...sizes[1], x: 0, y: 10}, {...sizes[2], x: 3, y: 10}
  ]);
});

test("equipping from Unplaced swaps the old occupant into Unplaced, including loaded containers", () => {
  const bow = item("bow", "weapon", {placement: slot("main-hand")});
  const sword = item("sword", "weapon");
  const pack = bag();
  const items = [bow, sword, pack];
  const changes = planMove(items, DEFAULT_SLOTS, sword, slot("main-hand"));
  assert.deepEqual(changes.get("bow"), {kind: "loose", rotated: false});
  const spare = item("spare", "gear");
  const load = item("load", "gear", {placement: cell("bag")});
  const all = [...items, spare, load];
  const swapped = planMove(all, DEFAULT_SLOTS, spare, slot("backpack"));
  const state = buildState(all, DEFAULT_SLOTS, swapped);
  assert.equal(swapped.get(pack.id).kind, "loose");
  assert.equal(state.rootGrids.has(pack.id), false);
  assert.equal(state.gridItems.get(pack.id)[0].item, load);
});

test("equipping from Other returns the replaced stack to Other without changing quantities", () => {
  const held = item("held", "weapon", {system: {quantity: 4, equipStatus: 4}, placement: slot("main-hand")});
  const stored = item("stored", "weapon", {system: {quantity: 6, equipStatus: 0}});
  const items = [held, stored];
  const changes = planMove(items, DEFAULT_SLOTS, stored, slot("main-hand"));
  const state = buildState(items, DEFAULT_SLOTS, changes);
  assert.equal(state.occupants.get("main-hand"), stored);
  assert.equal(state.stored.get(held.id), held);
  assert.equal(equipStatus(held, changes.get(held.id)), 0);
  assert.equal(stored.system.quantity, 6);
  assert.equal(held.system.quantity, 4);
  assert.equal(state.items.size, 2);
});

test("natural weapons preserve native locations while occupying neither grids nor hand slots", () => {
  for (const location of [0, 1, 2, 4, 5]) {
    const natural = item("claws", "weapon", {system: {equipStatus: location}, placement: cell("bag"), config: {width: 4, height: 4}});
    natural.flags[ID].naturalWeapon = true;
    const sword = item("sword", "weapon", {placement: slot("main-hand")});
    const shield = item("shield", "shield", {placement: slot("off-hand")});
    const items = [natural, sword, shield, bag()];
    const state = buildState(items, DEFAULT_SLOTS);
    assert.equal(state.naturalWeapons.get(natural.id), natural);
    assert.equal(state.placements.get(natural.id).kind, "natural");
    assert.equal(equipStatus(natural, state.placements.get(natural.id)), location);
    assert.equal(state.occupants.get("main-hand"), sword);
    assert.equal(state.occupants.get("off-hand"), shield);
    assert.equal(state.locks.size, 0);
    assert.equal(state.gridItems.get("bag").length, 0);
    assert.equal(state.stored.has(natural.id), false);
    assert.equal(fitsSlot(natural, DEFAULT_SLOTS.find(slot => slot.id === "main-hand")), false);
    const equipped = planMove(items, DEFAULT_SLOTS, natural, slot("off-hand", true));
    assert.deepEqual(equipped.get(natural.id), {kind: "natural", equipStatus: 5});
    assert.equal(equipped.size, 1);
    assert.throws(() => planMove(items, DEFAULT_SLOTS, natural, cell("bag")), /do not occupy/);
  }
});

test("HUD inventory hides Unplaced and natural weapons without hiding stored or equipped items", () => {
  const loose = item("loose", "gear");
  const stored = item("stored", "gear", {system: {equipStatus: 0}});
  const held = item("held", "weapon", {placement: slot("main-hand")});
  const packed = item("packed", "gear", {placement: cell("bag")});
  const natural = item("bite", "weapon", {system: {equipStatus: 5}});
  natural.flags[ID].naturalWeapon = true;
  const state = buildState([loose, stored, held, packed, natural, bag()], DEFAULT_SLOTS);
  assert.equal(isHudInventoryItem(state, loose), false);
  assert.equal(isHudInventoryItem(state, natural), false);
  for (const item of [stored, held, packed]) assert.equal(isHudInventoryItem(state, item), true);
});

test("only armor defaults to half equipped weight while explicit overrides apply to every type", () => {
  for (const type of ["armor", "gear", "weapon", "shield", "consumable", CONTAINER, MONEY]) {
    const gear = item("item", type, {system: {weight: 9}});
    assert.equal(equippedWeightOf(gear), type === "armor" ? 5 : 9);
    gear.system.weight = 0.5;
    assert.equal(equippedWeightOf(gear), type === "armor" ? 1 : 0.5);
    gear.flags[ID].equippedWeight = 0;
    assert.equal(equippedWeightOf(gear), 0);
    gear.flags[ID].equippedWeight = 2;
    assert.equal(equippedWeightOf(gear), 2);
  }
});

test("slot layout swaps occupied cells and supports compact group membership", () => {
  const head = {kind: "slot", key: "head", row: 1, column: 1};
  const rings = {kind: "group", key: "rings", row: 1, column: 2};
  const red = {kind: "slot", key: "red"};
  const blue = {kind: "slot", key: "blue"};
  const entries = [head, rings, red, blue];

  assert.deepEqual(firstSlotPosition(entries), {row: 1, column: 3});
  placeLayoutEntry(entries, rings, {row: 1, column: 1});
  assert.equal(head.column, 2);
  assert.equal(rings.column, 1);
  placeLayoutEntry(entries, red, {group: "rings"});
  placeLayoutEntry(entries, blue, {group: "rings", before: "red"});
  assert.equal(red.group, "rings");
  assert.equal(blue.groupOrder, 0);
  assert.equal(red.groupOrder, 1);
  placeLayoutEntry(entries, red, {row: 2, column: 1});
  assert.equal(red.group, null);
  assert.equal(red.row, 2);
});

test("inventory search matches names, types, and tags without case or accent sensitivity", () => {
  const potion = item("Élixir", "consumable", {config: {customType: "POTION", tags: ["healing"]}});
  assert.equal(matchesInventoryQuery(potion, "  ELIXIR potion healing  "), true);
  assert.equal(matchesInventoryQuery(potion, "consumable"), true);
  assert.equal(matchesInventoryQuery(potion, "elixir ring"), false);
});

test("the painted belt permits both sheaths and refuses gear across the gaps", () => {
  const pattern = ["######", "#....#", "#.....", "#....."];
  const sword = item("sword", "weapon", {config: {width: 4, height: 1}});
  const dagger = item("dagger", "weapon", {config: {width: 2, height: 1}});
  const box = item("box", "gear", {config: {width: 2, height: 2}});
  const state = buildState([bag({pattern}), sword, dagger, box], DEFAULT_SLOTS);
  assert.equal([...shapeCells(state.grids.get("bag"))].length, 10);
  assert.equal(gridError(state, sword, cell("bag", 0, 0, true)), "");
  assert.equal(gridError(state, dagger, cell("bag", 5, 0, true)), "");
  assert.match(gridError(state, box, cell("bag", 1, 1)), /unpainted cell/);
  assert.deepEqual(gridDrop(state, sword, cell("bag", 0, 2)), cell("bag", 0, 0, true));
  assert.equal(gridDrop(state, box, cell("bag", 0, 0)), null);
});

test("other regions can occupy empty cells inside a patterned container's display bounds", () => {
  const shape = displayedShape(containerShape({pattern: ["######", "#....#", "#.....", "#....."]}));
  const box = {width: 2, height: 2};
  const locations = packGrids([shape, box], 10);
  assert.deepEqual(locations, [
    {x: 0, y: 0, width: 6, height: 4},
    {x: 1, y: 1, width: 2, height: 2}
  ]);
  const cells = new Set([...shapeCells(shape)].map(({x, y}) => cellKey(x, y)));
  for (const {x, y} of shapeCells(box)) assert.equal(cells.has(cellKey(x + 1, y + 1)), false);
});

test("painting and trimming preserve logical coordinates and legacy rectangles", () => {
  const stroke = [...traceCells({x: 2, y: 1}, {x: 5, y: 1})];
  const shape = serializeCells(new Set(stroke.map(({x, y}) => cellKey(x, y))));
  assert.deepEqual(shape, {width: 6, height: 2, pattern: ["......", "..####"]});
  assert.deepEqual(displayedShape(shape), {x: 2, y: 1, width: 4, height: 1, pattern: ["####"]});
  assert.deepEqual(containerShape({width: 8, height: 6}), {width: 8, height: 6, pattern: null});
  assert.throws(() => serializeCells(new Set()), /at least one cell/);
});

test("cross-actor drops transfer stacks and loaded containers across character, NPC, grid and list inventories", async () => {
  const saved = {foundry: globalThis.foundry, game: globalThis.game, fromUuidSync: globalThis.fromUuidSync};
  let sequence = 0;
  const mergeObject = (target, update) => {
    for (const [path, value] of Object.entries(update)) {
      const keys = path.split(".");
      let object = target;
      for (const key of keys.slice(0, -1)) object = object[key] ??= {};
      object[keys.at(-1)] = value;
    }
    return target;
  };
  const actor = type => {
    const items = new Map();
    Object.defineProperty(items, "contents", {get: () => [...items.values()]});
    return {uuid: "Actor." + ++sequence, type, isOwner: true, items, system: {}};
  };
  const add = (owner, doc) => {
    doc.actor = owner;
    doc.toObject = () => ({_id: doc.id, name: doc.name, type: doc.type,
      system: structuredClone(doc.system), flags: structuredClone(doc.flags)});
    owner.items.set(doc.id, doc);
    return doc;
  };
  globalThis.game = {settings: {get: () => false}};
  globalThis.foundry = {
    utils: {randomID: () => "new" + ++sequence, mergeObject},
    documents: {async modifyBatch(operations) {
      // Emulate the batch's create/delete results, including remapped descendant IDs.
      return operations.map(op => {
        if (op.action === "create") return op.data.map(data => {
          const doc = add(op.parent, {...data, id: data._id});
          if (op.parent.type === "npc") {
            // SWADE's GearData pre-create automatically equips newly created NPC gear.
            doc.system.equipStatus = 3;
            doc.updateSource = updates => mergeObject(doc, updates);
            preserveTransferPlacement(doc, data, op);
          }
          return doc;
        });
        if (op.action === "delete") return op.ids.map(id => {
          const doc = op.parent.items.get(id);
          assert.ok(doc, "The source must still contain every transferred document.");
          op.parent.items.delete(id);
          return doc;
        });
        return op.updates.map(update => mergeObject(op.parent.items.get(update._id), update));
      });
    }}
  };
  try {
    for (const from of ["character", "npc"]) for (const to of ["character", "npc"]) {
      for (const layout of ["grid", "list", "native"]) {
        const source = actor(from), destination = actor(to);
        const stack = add(source, item("stack", "gear", {system: {quantity: 7}}));
        let target = {kind: "loose"};
        if (layout !== "native") {
          add(destination, item("pack", CONTAINER, {config: {container: {layout, width: 4, height: 4}}}));
          target = layout === "grid" ? cell("pack") : {kind: "grid", container: "pack"};
        }
        await move(destination, stack, target);
        assert.equal(source.items.size, 0);
        assert.equal([...destination.items.values()].find(doc => doc.name === "stack").system.quantity, 7);
      }
    }
    const source = actor("character"), destination = actor("character");
    const pack = add(source, item("pack", CONTAINER, {config: {container: {width: 4, height: 4}}}));
    add(source, item("contents", "gear", {placement: cell("pack"), system: {quantity: 5}}));
    await move(destination, pack, {kind: "loose"});
    assert.equal(source.items.size, 0);
    const movedPack = [...destination.items.values()].find(doc => doc.type === CONTAINER);
    const contents = [...destination.items.values()].find(doc => doc.name === "contents");
    assert.equal(contents.flags[ID].placement.container, movedPack.id);
    assert.equal(contents.system.quantity, 5);

    const legacyNpc = actor("npc"), recipient = actor("character");
    const loaded = add(legacyNpc, item("loaded", CONTAINER, {config: {container: {width: 4, height: 4},
      slots: [{id: "loop", types: ["gear"]}]}}));
    const inner = add(legacyNpc, item("inner", CONTAINER, {
      config: {container: {layout: "list"}}, placement: {...cell(loaded.id), equipStatus: 1}, system: {equipStatus: 3}
    }));
    add(legacyNpc, item("deep", "weapon", {placement: cell(inner.id), system: {quantity: 9}}));
    add(legacyNpc, item("attachment", "gear", {placement: slot("loaded:loop")}));
    await move(recipient, loaded, {kind: "loose"});
    assert.equal(legacyNpc.items.size, 0);
    assert.equal(recipient.items.size, 4);
    let hierarchy = buildState(recipient.items.contents, DEFAULT_SLOTS);
    const root = [...recipient.items.values()].find(doc => doc.name === "loaded");
    const nested = [...recipient.items.values()].find(doc => doc.name === "inner");
    assert.equal(hierarchy.gridItems.get(root.id)[0].item, nested);
    assert.equal(hierarchy.gridItems.get(nested.id)[0].item.system.quantity, 9);
    assert.equal(hierarchy.attachedItems.get(root.id)[0].name, "attachment");
    const receiverNpc = actor("npc");
    const outer = add(receiverNpc, item("outer", CONTAINER, {config: {container: {width: 4, height: 4}}}));
    await move(receiverNpc, root, cell(outer.id, 1, 1));
    assert.equal(recipient.items.size, 0);
    hierarchy = buildState(receiverNpc.items.contents, DEFAULT_SLOTS);
    const received = [...receiverNpc.items.values()].find(doc => doc.name === "loaded");
    const receivedNested = [...receiverNpc.items.values()].find(doc => doc.name === "inner");
    assert.equal(hierarchy.gridItems.get(outer.id)[0].item, received);
    assert.equal(hierarchy.gridItems.get(received.id)[0].item, receivedNested);
    assert.equal(hierarchy.gridItems.get(receivedNested.id)[0].item.system.quantity, 9);
    assert.equal(hierarchy.attachedItems.get(received.id)[0].name, "attachment");

    const blockedSource = actor("npc"), blockedTarget = actor("character");
    const stack = add(blockedSource, item("stack", "gear"));
    await assert.rejects(move(blockedTarget, stack, cell("missing")), /available container/);
    assert.equal(blockedSource.items.size, 1);
    assert.equal(blockedTarget.items.size, 0);
    const attempts = await Promise.allSettled([
      move(blockedTarget, stack, {kind: "loose"}), move(actor("npc"), stack, {kind: "loose"})
    ]);
    assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(blockedTarget.items.size, 1);

    const nativeSource = actor("character"), nativeTarget = actor("npc");
    const nativeItem = add(nativeSource, item("native", "weapon", {system: {quantity: 4}}));
    globalThis.fromUuidSync = () => nativeItem;
    assert.equal(transferActorDrop(nativeTarget, {}, {type: "Item", uuid: "Actor.source.Item.native"}), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nativeSource.items.size, 0);
    assert.equal(nativeTarget.items.size, 1);
    assert.equal(transferActorDrop(nativeTarget, {}, {type: "Item", uuid: "Actor.source.Item.native", sgiPlacement: true}), undefined);
    assert.equal(transferActorDrop(nativeTarget, {}, {type: "Item", uuid: "Compendium.items.Item.native"}), undefined);
  } finally {
    Object.assign(globalThis, saved);
  }
});
