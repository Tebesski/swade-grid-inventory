import {t as sbsI18n} from "./i18n.mjs";
import {
  HANDS, baseSlots, dimensions, findSpace, fitsSlot, gridDrop, gridError, isGear, listDrop, planMove,
  inventoryParent, settings, slotOccupant, storageError
} from "./model.mjs";
import {belongsTo, canSplit, equip, grip, move, remove, retrieve, rotate, rotation, splitStack, store, stow, toggleEquip, warn} from "./actions.mjs";
import {editItem} from "./config.mjs";
import {DROP_TARGETS, activePickup, cellAt, installPickup} from "./drag.mjs";
import {playSound} from "./sounds.mjs";
import {openSlotPicker} from "./slot-picker.mjs";
import {itemActions, promptUseCharge, rechargeItem, useAction, useCharge} from "./item-use.mjs";
import {node} from "./view.mjs";

function gridTarget(surface, point, item, rotated, offset = {x: 0, y: 0}) {
  const [width, height] = dimensions(item, rotated);
  return {kind: "grid", container: surface.dataset.sgiGrid, rotated,
    x: point.x - Math.min(offset.x, width - 1), y: point.y - Math.min(offset.y, height - 1)};
}

function dropSurface(target, ownId) {
  const surface = target.closest(DROP_TARGETS);
  if (surface?.dataset.sgiStowIn && surface.dataset.sgiStowIn === ownId) return surface.parentElement.closest(DROP_TARGETS);
  return surface;
}

function menuEntry(label, icon, action) {
  return {label, icon, onClick: () => Promise.resolve().then(action).catch(warn)};
}

function makeMenu(layout, selector, entries, {eventName, relative, cssClass}) {
  const doc = layout.ownerDocument;
  const ContextMenu = foundry.applications.ux.ContextMenu.implementation;
  const closeOnRight = event => {
    if (ui.context !== menu || !menu.element?.isConnected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void menu.close({animate: false});
  };
  const menu = new ContextMenu(layout, selector, [], {
    eventName, fixed: true, relative, jQuery: false,
    classes: ["sgi-menu", cssClass, "sbs-standard-swade-sheet"],
    onOpen: target => {
      game.tooltip.deactivate();
      menu.menuItems = entries(target);
      doc.addEventListener("contextmenu", closeOnRight, true);
    },
    onClose: () => doc.removeEventListener("contextmenu", closeOnRight, true)
  });
  return menu;
}

function slotChoices(slot, actor, state) {
  const occupied = slotOccupant(state, slot.id);
  const items = [...state.items.values()];
  const definitions = baseSlots(actor);
  const choices = [];
  for (const item of items) {
    if (item.id === occupied?.id || !fitsSlot(item, slot)) continue;
    const placement = {kind: "slot", slot: slot.id, rotated: rotation(state, item),
      twoHands: HANDS.includes(slot.id) && !!state.placements.get(item.id)?.twoHands};
    try {
      planMove(items, definitions, item, placement, state);
    } catch {
      continue;
    }
    choices.push(item);
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}

function itemChoices(item, actor, state, partyStorage) {
  if (!item) return [];
  const entries = [];
  const placement = state.placements.get(item.id);
  const act = (label, icon, action) => entries.push(menuEntry(label, `fa-solid fa-${icon}`, action));
  act(sbsI18n("swade-grid-inventory.UI.Openitem_85f9cb4f3f"), "file-lines", () => item.sheet?.render({force: true}));
  if (item.system.charges?.hasCharges) {
    act(sbsI18n("swade-grid-inventory.UI.UseItem_2aca6670b3"), "flask", () => useCharge(actor, item));
    act(sbsI18n("swade-grid-inventory.UI.RechargeItem_d6cf6dac36"), "rotate-right", () => rechargeItem(actor, item));
  }
  else if (item.type === "consumable") act(sbsI18n("swade-grid-inventory.UI.Useconsumable_d1d4fb6983"), "flask", () => item.consume());
  if (itemActions(item).length) act(sbsI18n("swade-grid-inventory.UI.UseAction_8f8e0575e8"), "bolt", () => useAction(actor, item));
  act(sbsI18n("swade-grid-inventory.UI.Inventorysettings_13c28b0dbd"), "sliders", () => editItem(item));
  act(sbsI18n("swade-grid-inventory.UI.Rotateitem_d00a90f9b2"), "rotate-right", () => rotate(actor, item));
  if (canSplit(item)) act("Split", "code-branch", () => splitStack(actor, item));
  if (!partyStorage && state.stored.has(item.id)) {
    act(sbsI18n("swade-grid-inventory.UI.Retrieveitem_43b2c502ab"), "box-open", async () => {
      if ((await retrieve(actor, item)).kind === "grid") void playSound(item, "place");
    });
  } else if (!partyStorage) {
    act(sbsI18n("swade-grid-inventory.UI.Storeitem_66c4f37ff3"), "box-archive", () => store(actor, item));
    if (placement?.kind !== "grid") act(sbsI18n("swade-grid-inventory.UI.Stowinfirstavailablespace_d765d2caf1"), "boxes-stacked", async () => {
      await stow(actor, item);
      void playSound(item, "place");
    });
  }
  if (placement?.kind === "slot" && HANDS.includes(placement.slot)) {
    act(placement.twoHands ? sbsI18n("swade-grid-inventory.UI.Useonehand_f00f32b30d") : sbsI18n("swade-grid-inventory.UI.Usetwohands_beeba74b09"), "hands", async () => {
      await grip(actor, item);
      void playSound(item, "equip");
    });
  }
  if (item.type === "weapon" && item.system.shots && game.settings.get("swade", "ammoManagement")) {
    act(game.i18n.localize("SWADE.Reload"), "right-to-bracket", () => item.reload());
    const reload = CONFIG.SWADE.CONST.RELOAD_TYPE;
    if (item.getFlag("swade", "loadedAmmo") && item.usesAmmoFromInventory
      && [reload.MAGAZINE, reload.BATTERY].includes(item.system.reloadType)) {
      act(game.i18n.localize("SWADE.RemoveAmmo"), "right-from-bracket", () => item.removeAmmo());
    }
  }
  act(sbsI18n("swade-grid-inventory.UI.Showinchat_dbda69f506"), "comment", () => item.show());
  act(sbsI18n("swade-grid-inventory.UI.Removeitem_5a89edf286"), "trash", () => remove(actor, item));
  return entries;
}

function fallbackError(state, item, container) {
  return storageError(state, item, container) || `No space for ${item.name} in ${state.grids.get(container).item.name}.`;
}

function placementPreview(layout, item, target) {
  const slot = target.kind === "slot";
  const grid = target.kind === "grid";
  if (!slot && !grid) return;
  const id = CSS.escape(slot ? target.slot : target.container);
  const surface = layout.querySelector(slot ? `[data-sgi-slot="${id}"] .sgi-slot-surface` : `[data-sgi-grid="${id}"]`);
  if (!surface || surface.closest("[hidden]")) return;
  const doc = layout.ownerDocument;
  const preview = node(doc, "span", slot ? "sgi-item-slot sgi-slot-landing" : "sgi-item-grid sgi-grid-landing");
  preview.setAttribute("aria-hidden", "true");
  preview.classList.toggle("sgi-rotated", !!target.rotated);
  const art = node(doc, "img", "sgi-item-art");
  art.alt = "";
  art.src = item.img || "icons/svg/item-bag.svg";
  art.classList.toggle("sgi-fill-image", grid && !!settings(item).fillImage);
  preview.append(art);
  game.modules.get("swade-better-money")?.api?.styleItemTier?.(item, {icon: preview});
  if (grid) {
    const [width, height] = dimensions(item, target.rotated);
    const row = target.y - Number(surface.dataset.sgiGridTop) + 1;
    const column = target.x - Number(surface.dataset.sgiGridLeft) + 1;
    preview.style.gridArea = `${row} / ${column} / span ${height} / span ${width}`;
  }
  surface.append(preview);
  return preview;
}

export function bindInventory(layout, app, actor, state, editable, {partyStorage = false} = {}) {
  const getTile = event => event.target.closest("[data-sgi-item]");
  const getItem = tile => actor.items.get(tile?.dataset.sgiItem);
  const open = item => item.sheet?.render({force: true});
  const pending = new Set();
  async function place(item, action, source = layout.querySelector(`[data-sgi-item="${CSS.escape(item.id)}"]`)) {
    if (source?.classList.contains("sgi-moving")) return;
    let clear;
    try {
      const target = await action(target => {
        if (!layout.isConnected) return;
        const preview = placementPreview(layout, item, target);
        source?.classList.add("sgi-moving");
        clear = () => {
          pending.delete(clear);
          preview?.remove();
          source?.classList.remove("sgi-moving");
        };
        pending.add(clear);
      });
      if (target.kind === "slot") void playSound(item, "equip");
      if (target.kind === "grid") void playSound(item, "place");
    } catch (error) {
      clear?.();
      throw error;
    }
  }
  let picker;
  const stopItemClick = event => {
    event.preventDefault();
    event.stopPropagation();
    if (ui.context?.element && ui.context.target?.closest(".sgi-layout") === layout) void ui.context.close({animate: false});
    picker?.close();
    game.tooltip.deactivate();
  };
  layout.addEventListener("dblclick", event => {
    const item = getItem(getTile(event));
    if (!item || event.button !== 0 || event.shiftKey) return;
    stopItemClick(event);
    if (editable && item.system.charges?.hasCharges) {
      void promptUseCharge(actor, item).catch(warn);
    } else void open(item);
  });
  layout.addEventListener("click", event => {
    const item = getItem(getTile(event));
    if (!item || event.button !== 0) return;
    if (event.shiftKey && event.detail > 0) {
      stopItemClick(event);
      if (!editable || partyStorage || event.detail > 1) return;
      void place(item, onPlanned => toggleEquip(actor, item, onPlanned), getTile(event)).catch(warn);
    } else if (event.detail === 0) void open(item);
  });
  if (!editable) return;
  const itemMenu = makeMenu(layout, "[data-sgi-item]", target => itemChoices(getItem(target), actor, state, partyStorage), {
    eventName: "contextmenu", relative: "cursor", cssClass: "sgi-item-menu"
  });
  layout.addEventListener("click", event => {
    const target = event.target.closest("[data-sgi-slot-picker]");
    if (!target || event.detail > 1) return;
    const element = target.closest("[data-sgi-slot]");
    const anchor = element.querySelector(".sgi-slot-surface");
    const trigger = element.querySelector("button[data-sgi-slot-picker]");
    const close = picker?.anchor === anchor && picker.panel.isConnected;
    picker?.close();
    if (close) return;
    const id = target.dataset.sgiSlotPicker;
    const slot = state.slots.get(id) ?? state.attachmentSlots.get(id);
    picker = openSlotPicker(anchor, slot.label, slotChoices(slot, actor, state),
      item => place(item, onPlanned => equip(actor, item.id, slot.id, onPlanned)), trigger);
  });
  layout.addEventListener("keydown", event => {
    const item = getItem(getTile(event));
    if (!item || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const action = event.key === "Delete" ? remove : event.key.toLowerCase() === "r" ? rotate : null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    void action(actor, item).catch(warn);
  });
  const cancelPickup = installPickup(layout, getItem, state, actor);

  let highlighted;
  let preview;
  let panePreview = [];
  let cachedFit;
  let lastGridHover;
  function clear() {
    highlighted?.classList.remove("sgi-drop-active", "sgi-drop-invalid");
    highlighted = null;
    preview?.remove();
    preview = null;
    for (const cell of panePreview) cell.classList.remove("sgi-pattern-preview");
    panePreview = [];
    cachedFit = null;
    lastGridHover = null;
  }
  function hoverFit(item, rotated, position, fit) {
    if (!cachedFit || cachedFit.item !== item || cachedFit.rotated !== rotated || cachedFit.position !== position) {
      cachedFit = {item, rotated, position, target: fit()};
    }
    return cachedFit.target;
  }
  layout.addEventListener("dragover", event => {
    const pickup = activePickup(event);
    const surface = dropSurface(event.target, pickup?.actor.uuid === actor.uuid ? pickup.item.id : undefined);
    if (!surface || !event.dataTransfer?.types.includes("text/plain")) {
      clear();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (surface !== highlighted) {
      clear();
      highlighted = surface;
      surface.classList.add("sgi-drop-active");
    }
    if (!pickup) return;
    const {item, rotated, offset} = pickup;
    const nested = surface.dataset.sgiStowIn;
    if (nested) {
      const fit = hoverFit(item, rotated, nested, () => findSpace(state, item, rotated, nested));
      surface.classList.toggle("sgi-drop-invalid", !fit);
      return;
    }
    const list = surface.dataset.sgiContainerList;
    if (list) {
      const error = hoverFit(item, rotated, list, () => gridError(state, item, listDrop(state, item, list, rotated)));
      surface.classList.toggle("sgi-drop-invalid", !!error);
      return;
    }
    if (!surface.dataset.sgiGrid) return;
    const atPointer = gridTarget(surface, cellAt(event, surface), item, rotated, offset);
    if (lastGridHover?.item === item && lastGridHover.rotated === rotated
      && lastGridHover.x === atPointer.x && lastGridHover.y === atPointer.y) return;
    lastGridHover = {item, rotated, x: atPointer.x, y: atPointer.y};
    const grid = state.grids.get(atPointer.container);
    let placement = atPointer;
    if (!pickup.exactGridDrop) {
      const position = grid.pattern ? `${atPointer.x}:${atPointer.y}` : "";
      placement = hoverFit(item, rotated, position, () => gridDrop(state, item, atPointer));
    }
    const error = !placement || gridError(state, item, placement);
    const target = placement ?? atPointer;
    surface.classList.toggle("sgi-drop-invalid", !!error);
    const [width, height] = dimensions(item, target.rotated);
    if (surface.classList.contains("sgi-pattern-grid")) {
      for (const cell of panePreview) cell.classList.remove("sgi-pattern-preview");
      panePreview = [...surface.querySelectorAll(".sgi-pattern-cell")].filter(cell => {
        const x = Number(cell.dataset.sgiCellX);
        const y = Number(cell.dataset.sgiCellY);
        return x >= target.x && x < target.x + width && y >= target.y && y < target.y + height;
      });
      for (const cell of panePreview) cell.classList.add("sgi-pattern-preview");
      return;
    }
    if (!preview?.isConnected) {
      preview = node(layout.ownerDocument, "span", "sgi-placement-preview");
      surface.append(preview);
    }
    preview.style.setProperty("--sgi-preview-x", target.x - Number(surface.dataset.sgiGridLeft));
    preview.style.setProperty("--sgi-preview-y", target.y - Number(surface.dataset.sgiGridTop));
    preview.style.setProperty("--sgi-preview-width", width);
    preview.style.setProperty("--sgi-preview-height", height);
  });
  layout.addEventListener("dragleave", event => {
    if (!highlighted?.contains(event.relatedTarget)) clear();
  });
  function handleDrop(event) {
    clear();
    if (!event.target.closest(DROP_TARGETS)) return;
    const pickup = activePickup(event);
    const data = pickup ? null : foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!pickup && data.type !== "Item") return;
    event.preventDefault();
    event.stopPropagation();
    if (!pickup && Hooks.call("dropActorSheetData", actor, app, data) === false) return;
    void (async () => {
      const ownedPickup = pickup && (pickup.layout === layout || pickup.actor === actor || pickup.actor.uuid === actor.uuid);
      const item = ownedPickup ? actor.items.get(pickup.item.id)
        : pickup?.item ?? await CONFIG.Item.documentClass.fromDropData(data);
      if (!item || !isGear(item)) throw new Error(sbsI18n("swade-grid-inventory.UI.Onlyinventoryitemscanbedropped_2c261744f0"));
      const local = Boolean(ownedPickup || belongsTo(actor, item));
      const surface = dropSurface(event.target, local ? item.id : undefined);
      if (!surface) return;
      const point = surface.dataset.sgiGrid ? cellAt(event, surface) : null;
      if (surface.hasAttribute("data-sgi-retrieve")) {
        if (local && state.placements.has(item.id)) return;
        const action = local && !state.stored.has(item.id) ? stow : retrieve;
        await place(item, onPlanned => action(actor, item, pickup?.rotated, onPlanned), local ? pickup?.tile : null);
        return;
      }
      if (local && surface.hasAttribute("data-sgi-intake") && !state.stored.has(item.id) && !inventoryParent(state, item.id)) return;
      const destination = (current, candidate) => {
        const rotated = pickup?.rotated ?? rotation(current, candidate);
        const slot = surface.dataset.sgiSlot;
        if (slot) return {kind: "slot", slot, rotated,
          twoHands: HANDS.includes(slot) && !!current.placements.get(candidate.id)?.twoHands};
        const list = surface.dataset.sgiContainerList;
        if (list) return listDrop(current, candidate, list, rotated);
        const nested = surface.dataset.sgiStowIn;
        if (nested) {
          const fit = findSpace(current, candidate, rotated, nested);
          if (!fit) throw new Error(fallbackError(current, candidate, nested));
          return fit;
        }
        if (point) {
          const requested = gridTarget(surface, point, candidate, rotated, pickup?.offset);
          const fitted = pickup?.exactGridDrop ? requested : gridDrop(current, candidate, requested);
          if (!fitted) throw new Error(fallbackError(current, candidate, requested.container));
          return fitted;
        }
        return {kind: surface.hasAttribute("data-sgi-store") ? "stored" : "loose", rotated};
      };
      await place(item, onPlanned => move(actor, item, destination, {owned: local, onPlanned}), local ? pickup?.tile : null);
    })().catch(error => {
      if (pickup) void playSound(pickup.item, "place");
      warn(error);
    });
  }
  layout.addEventListener("drop", handleDrop);
  layout.addEventListener("sgi-inventory-drop", handleDrop);

  return () => {
    cancelPickup();
    clear();
    for (const release of pending) release();
    picker?.close();
    if (ui.context === itemMenu && itemMenu.element) void itemMenu.close({animate: false});
  };
}
