import {t as sbsI18n} from "./i18n.mjs";
import {inventory, move, prepareStorageItems, rotation, serialize} from "./actions.mjs";
import {CELL} from "./board.mjs";
import {activePickup} from "./drag.mjs";
import {bindInventory} from "./interactions.mjs";
import {CONTAINER, buildState, findSpace, hasInventory, inventoryParent, matchesFlag, occupiedChildren, registerStorageType, typesOf} from "./model.mjs";
import {node, renderContainerList, renderGrid} from "./view.mjs";

function renderPartyStorage(target, app, actor, rootId, {editable, privateContents, iconsOnly}) {
  const root = actor.items.get(rootId);
  const state = privateContents ? buildState(root ? [root] : [], []) : inventory(actor);
  const storage = state.grids.get(rootId);
  const doc = target.ownerDocument;
  if (!storage) {
    target.append(node(doc, "p", "hint", sbsI18n("swade-grid-inventory.UI.Thisstoragecontainerisunavailable_e9a70f0071")));
    return;
  }
  const layout = node(doc, "div", "sgi-layout sbs-party-grid-layout");
  const readPictures = privateContents || iconsOnly;
  if (storage.list) layout.append(renderContainerList(doc, storage, state, editable, false, readPictures));
  else {
    const viewport = node(doc, "div", "sgi-board-viewport");
    const board = node(doc, "div", "sgi-board");
    board.style.setProperty("--sgi-cell", `${CELL}px`);
    board.append(renderGrid(doc, storage, state.gridItems.get(rootId), state, editable, readPictures));
    viewport.append(board);
    layout.append(viewport);
  }
  target.append(layout);
  return readPictures ? undefined : bindInventory(layout, app, actor, state, editable, {partyStorage: true});
}

function placeInPartyStorage(actor, item, rootId, rotated) {
  return move(actor, item, (state, candidate) => {
    const fit = findSpace(state, candidate, rotated ?? rotation(state, candidate), rootId);
    if (!fit) throw new Error(sbsI18n("swade-grid-inventory.UI.Nospaceforinthiscontainer_665a2356f0", {p0: (item.name)}));
    return fit;
  });
}

async function getPartyDrop(event) {
  const pickup = activePickup(event);
  const data = pickup ? null : foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  const item = pickup?.item ?? (data.type === "Item" ? await CONFIG.Item.documentClass.fromDropData(data) : null);
  return {item, rotated: pickup?.rotated};
}

function hasContents(item) {
  return hasInventory(item.actor) && occupiedChildren(inventory(item.actor), item);
}

function acceptsContainer(item, {types = [], flags = []}) {
  return item.type === CONTAINER && (!types.length && !flags.length || types.includes("*")
    || types.some(type => typesOf(item).includes(type)) || flags.some(flag => matchesFlag(item, flag)));
}

function recoverableItems(actor, rootId, includeRootContents) {
  const state = inventory(actor);
  return [...state.items.values()].filter(item => {
    if (item.id === rootId) return false;
    const parent = inventoryParent(state, item.id);
    return !parent || (includeRootContents && parent.id === rootId);
  });
}

function unplacePartyItem(actor, item, rotated) {
  return move(actor, item, (state, candidate) => ({
    kind: "loose", rotated: rotated ?? rotation(state, candidate)
  }));
}

function creditPartyStorage(actor, rootId, credit) {
  return serialize(actor, () => credit(documents => prepareStorageItems(actor, rootId, documents)));
}

export const partyStorage = {CONTAINER, registerStorageType, acceptsContainer, getPartyDrop, hasContents, placeInPartyStorage,
  creditPartyStorage, recoverableItems, renderPartyStorage, unplacePartyItem};
