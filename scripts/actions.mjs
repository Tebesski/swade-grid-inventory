import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {
  CONTAINER, HANDS, ID, baseSlots, bestSlotPlacement, buildState, equipStatus, findSpace, fitListContents, isGear, planMove,
  containerQuantityError, hasInventory, isPartyStorage, occupiedChildren, readPlacement, settings
} from "./model.mjs";
import {playSound} from "./sounds.mjs";

const queues = new Map();
const placementPath = `flags.${ID}.placement`;

export function warn(error) {
  const message = error.message ?? String(error);
  if (message.startsWith("This item extends beyond ")) return;
  ui.notifications.warn(message);
}

export function serialize(actor, action) {
  const previous = queues.get(actor.uuid) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => {
    if (!actor.isOwner || !hasInventory(actor)) throw new Error(sbsI18n("swade-grid-inventory.UI.Youcannoteditthisinventory_42194cd608"));
    return action();
  });
  queues.set(actor.uuid, current);
  return current.finally(() => {
    if (queues.get(actor.uuid) === current) queues.delete(actor.uuid);
  });
}

export function inventory(actor) {
  return buildState(actor.items.contents, baseSlots(actor));
}

export function checkQuantityUpdate(item, changes) {
  const actor = item.actor;
  if (!hasInventory(actor)) return;
  const quantity = changes.system?.quantity ?? changes["system.quantity"];
  if (quantity == null || Number(quantity) <= Number(item.system.quantity)) return;
  const state = inventory(actor);
  const parent = state.placements.get(item.id);
  if (parent?.kind !== "grid") return;
  const edited = {id: item.id, type: item.type, flags: item.flags, system: {...item.system, quantity}};
  const error = containerQuantityError(state, edited, parent.container);
  if (error) {
    warn(error);
    return false;
  }
}

function placementUpdate(item, target) {
  const status = equipStatus(item, target);
  const placement = {kind: target.kind, slot: target.slot ?? null, twoHands: !!target.twoHands,
    container: target.container ?? null, x: target.x ?? null, y: target.y ?? null, rotated: !!target.rotated,
    equipStatus: status ?? null};
  const update = {[placementPath]: placement};
  if (status !== undefined && status !== item.system.equipStatus) update["system.equipStatus"] = status;
  return update;
}

export function prepareStorageItems(actor, rootId, documents) {
  const slots = baseSlots(actor);
  const items = [...actor.items.contents];
  let state = buildState(items, slots);
  return documents.map(data => {
    const candidate = {id: foundry.utils.randomID(), ...data};
    const fit = findSpace(state, candidate, false, rootId);
    if (!fit) throw new Error(sbsI18n("swade-grid-inventory.UI.Thereisnoroomforin_45e564f3eb", {p0: (data.name)}));
    const placed = foundry.utils.mergeObject(data, placementUpdate(candidate, fit), {inplace: false});
    items.push({...placed, id: candidate.id});
    state = buildState(items, slots);
    return placed;
  });
}

export function rotation(state, item) {
  return !!(state.placements.get(item.id) ?? readPlacement(item, state.slots))?.rotated;
}

export function belongsTo(actor, item) {
  return item.parent === actor || item.actor === actor || item.parent?.uuid === actor.uuid
    || actor.items.get(item.id) === item;
}

function candidateData(item, id, system = item.system) {
  return {id, type: item.type, isPhysicalItem: item.isPhysicalItem, name: item.name, system, flags: item.flags};
}

function copyItems(item) {
  const source = hasInventory(item.actor) ? inventory(item.actor) : null;
  const documents = [];
  const candidates = [];
  const sourceIds = [];
  copy(item, {kind: "loose"});
  return {documents, candidates, sourceIds};

  function copy(original, placement) {
    const data = original.toObject();
    data._id = foundry.utils.randomID();
    data.folder = null;
    const candidate = candidateData(original, data._id, data.system);
    foundry.utils.mergeObject(data, placementUpdate(candidate, placement));
    candidate.flags = data.flags;
    documents.push(data);
    candidates.push(candidate);
    sourceIds.push(original.id);
    for (const child of source?.gridItems.get(original.id) ?? []) {
      copy(child.item, {...child.placement, container: data._id});
    }
    for (const child of source?.attachedItems.get(original.id) ?? []) {
      const placement = source.placements.get(child.id);
      const {key} = source.attachmentSlots.get(placement.slot);
      copy(child, {...placement, inactive: true, slot: `${data._id}:${key}`});
    }
  }
}

export function move(actor, source, destination, {owned = belongsTo(actor, source), onPlanned} = {}) {
  return serialize(actor, async () => {
    const slots = baseSlots(actor);
    const local = owned;
    const item = local ? actor.items.get(source.id) : source;
    if (!item || !isGear(item)) throw new Error(sbsI18n("swade-grid-inventory.UI.Thisitemcannotbeaddedto_152c9510cf"));
    if (item.flags?.["swade-better-setting"]?.partyStorageRoot) throw new Error(sbsI18n("swade-grid-inventory.UI.UseUpgradestomanagethisstorage_addfcd18f4"));
    const origin = item.actor;
    const transfer = !local && origin && !item.pack && (isPartyStorage(origin) || isPartyStorage(actor));
    if (transfer && (!origin.isOwner || origin.system.locked)) throw new Error(sbsI18n("swade-grid-inventory.UI.Youneedaccesstobothinventories_e89b103394"));
    if (isPartyStorage(actor) && actor.system.locked) throw new Error(sbsI18n("swade-grid-inventory.UI.Thisinventoryislocked_04e4e97a5c"));
    // A compendium or world item can share an ID with an existing embedded document.
    const imported = local ? null : copyItems(item);
    const candidate = imported?.candidates[0] ?? item;
    const items = [...actor.items.contents, ...(imported?.candidates ?? [])];
    const state = buildState(items, slots);
    const target = typeof destination === "function" ? destination(state, candidate) : destination;
    const changes = planMove(items, slots, candidate, target, state);
    const importedItems = new Map(imported?.candidates.map((entry, index) => [entry.id, imported.documents[index]]));
    const updates = [];
    for (const [id, placement] of changes) {
      const changedItem = state.items.get(id);
      const update = placementUpdate(changedItem, placement);
      if (importedItems.has(id)) foundry.utils.mergeObject(importedItems.get(id), update);
      else {
        const saved = changedItem.flags?.[ID]?.placement;
        if (!saved || "system.equipStatus" in update
          || Object.entries(update[placementPath]).some(([key, value]) => saved[key] !== value)) {
          updates.push({_id: id, ...update});
        }
      }
    }
    if (local && !updates.length) return target;
    onPlanned?.(target);

    if (local) {
      const updated = await actor.updateEmbeddedDocuments("Item", updates);
      if (Array.isArray(updated) && updated.length !== updates.length) throw new Error(sbsI18n("swade-grid-inventory.UI.Theinventorymovecouldnotbe_e0db48c6c7"));
    } else if (transfer) {
      const {documents, sourceIds} = imported;
      const operations = [
        {action: "create", documentName: "Item", parent: actor, data: documents, keepId: true},
        {action: "delete", documentName: "Item", parent: origin, ids: sourceIds}
      ];
      if (updates.length) operations.push({action: "update", documentName: "Item", parent: actor, updates});
      const result = await foundry.documents.modifyBatch(operations);
      if (result.length !== operations.length
        || result.some((entries, index) => entries.length !== (operations[index].data ?? operations[index].ids ?? updates).length)) {
        throw new Error(sbsI18n("swade-grid-inventory.UI.Foundrydidnotconfirmthefull_565fa15cf5"));
      }
    } else {
      const {documents} = imported;
      try {
        const created = await actor.createEmbeddedDocuments("Item", documents, {keepId: true});
        if (created.length !== documents.length) throw new Error(sbsI18n("swade-grid-inventory.UI.Couldnotadd_d62fe8dae6", {p0: (item.name)}));
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
      } catch (error) {
        const ids = documents.map(data => data._id).filter(id => actor.items.has(id));
        if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
        throw error;
      }
    }
    for (const [id, placement] of changes) {
      if (id !== candidate.id && placement.kind === "grid") void playSound(state.items.get(id), "place");
    }
    return target;
  });
}

export function equip(actor, itemId, slot, onPlanned) {
  return move(actor, {id: itemId}, (state, current) => ({
    kind: "slot", slot, rotated: rotation(state, current),
    twoHands: HANDS.includes(slot) && !!state.placements.get(current.id)?.twoHands
  }), {owned: true, onPlanned});
}

export function toggleEquip(actor, item, onPlanned) {
  return move(actor, item, (state, current) => {
    const rotated = rotation(state, current);
    if (state.placements.get(current.id)?.kind === "slot") {
      return findSpace(state, current, rotated) ?? {kind: "loose", rotated};
    }
    const target = bestSlotPlacement(state, current, baseSlots(actor), rotated);
    if (!target) throw new Error(sbsI18n("swade-grid-inventory.UI.Noeligibleequipmentslotisavailable_754d4cdec0", {p0: (current.name)}));
    return target;
  }, {onPlanned});
}

export function stow(actor, item, preferredRotation, onPlanned) {
  return move(actor, item, (state, current) => {
    const fit = findSpace(state, current, preferredRotation ?? rotation(state, current));
    if (!fit) throw new Error(sbsI18n("swade-grid-inventory.UI.Nospacetostow_04d21f751c", {p0: (current.name)}));
    return fit;
  }, {onPlanned});
}

export function rotate(actor, item) {
  return move(actor, item, (state, current) => ({
    ...(state.placements.get(current.id) ?? {kind: state.stored.has(current.id) ? "stored" : "loose"}),
    rotated: !rotation(state, current)
  }));
}

export function store(actor, item) {
  return move(actor, item, (state, current) => ({kind: "stored", rotated: rotation(state, current)}));
}

export function retrieve(actor, item, preferredRotation, onPlanned) {
  return move(actor, item, (state, current) => {
    const rotated = preferredRotation ?? rotation(state, current);
    return findSpace(state, current, rotated) ?? {kind: "loose", rotated};
  }, {onPlanned});
}

export function grip(actor, item) {
  return move(actor, item, (state, current) => {
    const placement = state.placements.get(current.id);
    if (placement?.kind !== "slot") throw new Error(sbsI18n("swade-grid-inventory.UI.Puttheiteminahand_4c4a28e49f"));
    return {...placement, twoHands: !placement.twoHands};
  });
}

export function canSplit(item) {
  const quantity = item.system?.quantity;
  return item.type !== CONTAINER && Number.isSafeInteger(quantity) && quantity > 1;
}

function chooseSplitAmount(item) {
  const quantity = item.system.quantity;
  if (quantity <= 3) return 1;
  const max = quantity - 1;
  const start = Math.floor(quantity / 2);
  return foundry.applications.api.DialogV2.prompt({
    classes: ["sbs-standard-swade-sheet"],
    window: {title: sbsI18n("swade-grid-inventory.UI.Split_3d23800e88", {p0: (item.name)})},
    content: `<div class="form-group">
      <label>${sbsI18n("swade-grid-inventory.UI.Quantitytosplit_ce30323312")}</label>
      <div class="form-fields">
        <input type="range" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Quantityslider_1f013a7ce3")}" min="1" max="${max}" step="1" value="${start}">
        <input type="number" name="amount" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Quantitytosplit_ce30323312")}" min="1" max="${max}" step="1" value="${start}" required>
      </div>
    </div>`,
    render: (_event, dialog) => {
      const slider = dialog.element.querySelector('input[type="range"]');
      const amount = dialog.element.querySelector('[name="amount"]');
      slider.addEventListener("input", () => { amount.value = slider.value; });
      amount.addEventListener("input", () => { if (amount.validity.valid) slider.value = amount.value; });
    },
    ok: {label: sbsI18n("swade-grid-inventory.UI.Split_32afaa7843"), callback: (_event, button) => button.form.elements.amount.valueAsNumber}
  });
}

export async function splitStack(actor, source) {
  const item = actor.items.get(source.id);
  if (!item || !canSplit(item)) return;
  const amount = await chooseSplitAmount(item);
  if (amount == null) return;
  return serialize(actor, async () => {
    const original = actor.items.get(item.id);
    const quantity = original?.system.quantity;
    if (!original || !canSplit(original) || !Number.isInteger(amount) || amount < 1 || amount >= quantity) {
      throw new Error(sbsI18n("swade-grid-inventory.UI.ThestackchangedChooseasmaller_3406a084e7"));
    }
    const state = inventory(actor);
    const origin = state.placements.get(original.id);
    const rotated = rotation(state, original);
    let target = {kind: state.stored.has(original.id) ? "stored" : "loose", rotated};
    const data = original.toObject();
    data._id = foundry.utils.randomID();
    const remaining = candidateData(original, original.id, {...data.system, quantity: quantity - amount});
    data.system.quantity = amount;
    const copy = candidateData(original, data._id, data.system);
    if (origin?.kind === "grid") {
      const items = actor.items.contents.map(other => other.id === original.id ? remaining : other);
      const reduced = buildState(items, baseSlots(actor));
      target = findSpace(reduced, copy, rotated, origin.container) ?? target;
    }
    foundry.utils.setProperty(data, placementPath, placementUpdate(copy, target)[placementPath]);
    const status = equipStatus(copy, target);
    if (status !== undefined) data.system.equipStatus = status;
    await original.update({"system.quantity": quantity - amount});
    if (actor.items.get(original.id)?.system.quantity !== quantity - amount) {
      throw new Error(sbsI18n("swade-grid-inventory.UI.Theoriginalstackcouldnotbe_242659f654"));
    }
    let created;
    try {
      [created] = await actor.createEmbeddedDocuments("Item", [data], {keepId: true});
      if (!created) throw new Error(sbsI18n("swade-grid-inventory.UI.Thesplitstackcouldnotbe_99485e2efb"));
    } catch (error) {
      const current = actor.items.get(original.id);
      if (current?.system.quantity === quantity - amount) await current.update({"system.quantity": quantity});
      throw error;
    }
    if (target.kind === "grid") void playSound(created, "place");
    else if (origin?.kind === "grid") ui.notifications.info(sbsI18n("swade-grid-inventory.UI.wassplitintoUnplaced_bd7e25e0a2", {p0: (created.name)}));
    return created;
  });
}

export async function remove(actor, item) {
  const yes = await foundry.applications.api.DialogV2.confirm({
    classes: ["sbs-standard-swade-sheet"],
    window: {title: sbsI18n("swade-grid-inventory.UI.Remove_95fe37ef03", {p0: (item.name)})},
    content: `<p>${sbsI18n("swade-grid-inventory.UI.Deletethisitemfromtheinventory_e7e5a47a2c")}</p>`
  });
  if (!yes) return;
  await serialize(actor, async () => {
    const current = actor.items.get(item.id);
    if (!current) return;
    if (occupiedChildren(inventory(actor), current)) throw new Error(sbsI18n("swade-grid-inventory.UI.Emptybeforeremovingit_cda415fbac", {p0: (current.name)}));
    await current.delete();
  });
}

export function checkConfiguration(actor, slots, edited) {
  const original = inventory(actor);
  const items = actor.items.contents.map(item => item.id === edited?.id ? edited : item);
  const changes = original.grids.get(edited?.id)?.list && settings(edited).container?.layout !== "list"
    ? fitListContents(items, slots, original, edited.id) : new Map();
  const next = buildState(items, slots, changes);
  for (const id of original.placements.keys()) {
    if (!next.placements.has(id)) throw new Error(sbsI18n("swade-grid-inventory.UI.Movebeforechangingthisconfiguration_0a50825d5c", {p0: (original.items.get(id).name)}));
    if (original.placements.get(id).twoHands && !HANDS.every(hand => next.slots.has(hand))) {
      throw new Error(sbsI18n("swade-grid-inventory.UI.Releasethetwohandedgripbefore_b9b616ed70"));
    }
  }
  return [...changes].map(([id, placement]) => ({_id: id, ...placementUpdate(original.items.get(id), placement)}));
}
