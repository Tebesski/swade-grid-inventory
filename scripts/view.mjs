import {t as sbsI18n} from "./i18n.mjs";
import {CONTAINER, DEFAULT_SLOTS, ID, MONEY, containerQuantities, contentsWeight, dimensions, loadedWeight, matchesInventoryQuery, settings, slotOccupant} from "./model.mjs";
import {inventory, rotation, warn} from "./actions.mjs";
import {createItem, editPaperDoll, isPaperDollOpen, paperDoll, paintDoll} from "./config.mjs";
import {bindInventory} from "./interactions.mjs";
import {tooltipCharges} from "./item-use.mjs";
import {CELL, packGrids} from "./board.mjs";
import {displayedShape, shapeCells} from "./container-shape.mjs";
import {slotOrder, slotPosition} from "./slot-layout.mjs";

const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const number = value => Number(value).toLocaleString(undefined, {maximumFractionDigits: 3});
const unit = () => game.settings.get("swade", "weightUnit") === "imperial" ? "lb" : "kg";
const selectedTabs = new WeakMap();
const searchQueries = new WeakMap();
const bindings = new WeakMap();
const pendingScroll = new WeakMap();
const standardSlotIds = new Set(DEFAULT_SLOTS.map(slot => slot.id));
const scrollViewport = ".sgi-board-viewport, .sgi-container-interior .sgi-container-list";

export function readInventoryScroll(panel) {
  const viewport = panel?.querySelector(scrollViewport);
  return [panel, viewport].map(element => element && [element.scrollLeft, element.scrollTop]);
}

export function saveInventoryScroll(app) {
  const panel = app.element?.querySelector(".sgi-inventory-tab, .sgi-container-tab");
  if (panel) pendingScroll.set(app, readInventoryScroll(panel));
}

export function takeInventoryScroll(app, panel) {
  const position = pendingScroll.get(app) ?? readInventoryScroll(panel);
  pendingScroll.delete(app);
  return position;
}

export function restoreInventoryScroll(panel, [outer, inner]) {
  const viewport = panel.querySelector(scrollViewport);
  if (inner) viewport?.scrollTo(...inner);
  if (outer) panel.scrollTo(...outer);
}

export function node(doc, tag, className, content) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

export function button(doc, label, icon, action, iconOnly = false) {
  const control = node(doc, "button", iconOnly ? "icon" : "");
  control.type = "button";
  if (icon) {
    const glyph = node(doc, "i", `fa-solid fa-${icon}`);
    glyph.setAttribute("aria-hidden", "true");
    control.append(glyph);
  }
  if (iconOnly) {
    control.setAttribute("aria-label", label);
    control.dataset.tooltipText = label;
  } else control.append(doc.createTextNode(label));
  if (action) control.addEventListener("click", () => Promise.resolve().then(action).catch(warn));
  return control;
}

function image(doc, src, className) {
  const img = node(doc, "img", className);
  img.src = src || "icons/svg/item-bag.svg";
  img.alt = "";
  img.draggable = false;
  return img;
}

function renderCoatingIcons(tile, item) {
  tile.querySelector(":scope > .sgi-coating-icons")?.remove();
  const effects = game.modules.get("swade-better-usables")?.api?.getCoatingEffects?.(item);
  if (!effects?.length) return;
  const doc = tile.ownerDocument;
  const icons = node(doc, "span", "sgi-coating-icons");
  icons.setAttribute("aria-hidden", "true");
  for (const effect of effects) icons.append(image(doc, effect.img, "sgi-coating-icon"));
  tile.append(icons);
}

export function refreshCoatingIcons(effect) {
  const item = effect.parent;
  if (item?.documentName !== "Item") return;
  for (const tile of document.querySelectorAll(`[data-sgi-item-uuid="${CSS.escape(item.uuid)}"]`)) {
    renderCoatingIcons(tile, item);
  }
}

function styleTier(item, parts) {
  game.modules.get("swade-better-money")?.api?.styleItemTier?.(item, parts);
}

function tooltipEffects(doc, item, refresh) {
  const list = node(doc, "ul", "sgi-tooltip-effects");
  for (const effect of item.effects ?? []) {
    if (!effect.active || effect.transfer) continue;
    const duration = (refresh ? effect.updateDuration?.() : undefined) ?? effect.duration;
    if (duration?.expired) continue;
    const label = duration?.label && Number.isFinite(duration.remaining) ? `${effect.name} (${duration.label})` : effect.name;
    const entry = node(doc, "li");
    entry.append(image(doc, effect.img), node(doc, "span", "", label));
    list.append(entry);
  }
  return list.childElementCount ? list.outerHTML : "";
}

function itemTooltip(item, doc, rotated, containerName, weight, refresh = false) {
  const type = game.i18n.localize(CONFIG.Item.typeLabels[item.type] ?? (item.type === MONEY ? sbsI18n("swade-grid-inventory.UI.Money_5ccc2e8715") : item.type));
  const system = item.system ?? {};
  const [width, height] = dimensions(item, rotated);
  const stats = [[sbsI18n("swade-grid-inventory.UI.Size_1af8519073"), `${width} × ${height}`], [sbsI18n("swade-grid-inventory.UI.Quantity_822bab8d41"), system.quantity], [sbsI18n("swade-grid-inventory.UI.Weight_81d27ef6d5"), `${number(weight)} ${unit()}`]];
  if (item.type === "weapon") stats.push([sbsI18n("swade-grid-inventory.UI.Damage_0c874f581a"), system.damage], ["AP", system.ap], [sbsI18n("swade-grid-inventory.UI.Range_5de74a81b1"), system.range]);
  if (item.type === "armor") {
    stats.push([sbsI18n("swade-grid-inventory.UI.Armor_a592855d05"), system.armor], [sbsI18n("swade-grid-inventory.UI.Covers_3f8d88db58"), Object.keys(system.locations ?? {}).filter(part => system.locations[part]).join(", ")]);
  }
  if (item.type === "shield") stats.push([sbsI18n("swade-grid-inventory.UI.Parry_e5567f841f"), system.parry]);
  if (item.type === MONEY) stats.push([sbsI18n("swade-grid-inventory.UI.Valueperunit_aaa4a9bf00"), system.price]);
  if (system.minStr) stats.push([sbsI18n("swade-grid-inventory.UI.MinStrength_2bd199a333"), system.minStr]);
  stats.push([sbsI18n("swade-grid-inventory.UI.Charges_d3f9533d4d"), tooltipCharges(item)]);
  const plain = doc.createElement("template");
  plain.innerHTML = system.notes || system.description || "";
  const notes = plain.content.textContent.trim().replace(/\s+/g, " ");
  const name = node(doc, "strong", "", item.name);
  styleTier(item, {name});
  return `<div class="sgi-tooltip-content">
    <div class="sgi-tooltip-heading">${name.outerHTML}<span>${escape(settings(item).customType || type)}</span></div>
    <dl>${stats.filter(([, value]) => value != null && value !== "").map(([label, value]) =>
      `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>
    ${tooltipEffects(doc, item, refresh)}
    ${notes ? `<p>${escape(notes.length > 230 ? notes.slice(0, 229) + "…" : notes)}</p>` : ""}
    ${containerName ? `<p class="sgi-tooltip-container">${sbsI18n("swade-grid-inventory.UI.Container_6385ff4a0a", {p0: (escape(containerName))})}</p>` : ""}</div>`;
}

function tile(doc, item, state, editable, variant, region, iconsOnly = false, insideContainerSheet = false) {
  const place = state.placements.get(item.id);
  const turned = rotation(state, item);
  if (iconsOnly) {
    const icon = node(doc, "span", `sgi-item sgi-item-${variant} sgi-icons-only`);
    icon.setAttribute("aria-hidden", "true");
    icon.classList.toggle("sgi-rotated", turned);
    icon.append(image(doc, item.img, "sgi-item-art"));
    if (region) {
      const [width, height] = dimensions(item, turned);
      icon.style.gridArea = `${place.y - region.y + 1} / ${place.x - region.x + 1} / span ${height} / span ${width}`;
    }
    return icon;
  }
  const control = node(doc, "button", `sgi-item sgi-item-${variant}`);
  control.type = "button";
  control.classList.toggle("sgi-rotated", turned);
  control.dataset.sgiItem = item.id;
  control.dataset.sgiItemUuid = item.uuid;
  if (editable) control.dataset.sgiDraggable = "";
  const containerName = insideContainerSheet ? undefined : state.grids.get(place?.container)?.item.name;
  // Give Foundry's capture listener a tooltip target before generating the details.
  control.dataset.tooltipText = item.name;
  control.addEventListener("pointerenter", () => {
    const current = item.actor?.items.get(item.id) ?? item;
    const html = itemTooltip(current, doc, turned, containerName, loadedWeight(state, current), true);
    if (html === control.dataset.tooltipHtml) return;
    control.dataset.tooltipHtml = html;
    if (game.tooltip.element === control) game.tooltip.activate(control);
  });
  control.setAttribute("aria-label", item.name);
  const art = image(doc, item.img, "sgi-item-art");
  if (variant === "list") {
    const weight = loadedWeight(state, item);
    const icon = node(doc, "span", "sgi-item-icon");
    const name = node(doc, "span", "sgi-item-name", item.name);
    icon.append(art);
    control.append(icon, name,
      node(doc, "span", "sgi-list-quantity", number(item.system?.quantity ?? 1)),
      node(doc, "span", "sgi-list-weight", `${number(weight)} ${unit()}`));
    styleTier(item, {icon, name});
  } else {
    control.append(art);
    styleTier(item, {icon: control});
    if (item.system?.quantity > 1) control.append(node(doc, "span", "sgi-qty", `×${number(item.system.quantity)}`));
  }
  if (place?.twoHands) control.append(node(doc, "i", "sgi-item-mark fa-solid fa-hands"));
  if (variant === "grid") {
    if (item.type === CONTAINER) control.dataset.sgiStowIn = item.id;
    art.classList.toggle("sgi-fill-image", !!settings(item).fillImage);
    const [width, height] = dimensions(item, turned);
    control.style.gridArea = `${place.y - region.y + 1} / ${place.x - region.x + 1} / span ${height} / span ${width}`;
  }
  renderCoatingIcons(control, item);
  return control;
}

function slotTile(doc, slot, state, editable) {
  const target = node(doc, "div", "sgi-slot");
  target.dataset.sgiSlot = slot.id;
  const lock = state.locks.get(slot.id);
  const item = slotOccupant(state, slot.id);
  const surface = item ? tile(doc, item, state, editable, "slot") : button(doc, slot.label, null, null, true);
  const face = node(doc, "div", "sgi-slot-face");
  surface.classList.add("sgi-slot-surface");
  face.append(surface);
  if (!item) {
    if (lock || !slot.iconImage) surface.append(node(doc, "i", `fa-solid fa-${lock ? "lock" : slot.icon || "diamond"}`));
    else surface.append(image(doc, slot.iconImage, "sgi-slot-icon"));
  }
  if (lock) {
    target.classList.add("sgi-slot-locked");
    target.dataset.tooltipText = lock.name;
    surface.disabled = true;
  } else if (editable) {
    const trigger = item ? button(doc, sbsI18n("swade-grid-inventory.UI.Chooseitemfor_6a47c5a652", {p0: (slot.label)}), sbsI18n("swade-grid-inventory.UI.chevrondown_307f680f76"), null, true) : surface;
    trigger.dataset.sgiSlotPicker = slot.id;
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    if (item) {
      trigger.classList.add("sgi-slot-picker-button");
      face.append(trigger);
    }
  }
  const label = node(doc, "span", "sgi-slot-label", slot.label);
  if (!lock && editable) label.dataset.sgiSlotPicker = slot.id;
  target.append(face, label);
  return target;
}

export function renderAttachmentSlots(doc, item, state, editable) {
  const slots = [...state.attachmentSlots.values()].filter(slot => slot.parent.id === item.id);
  if (!slots.length) return null;
  const section = node(doc, "fieldset", "sgi-attachment");
  const group = node(doc, "div", "sgi-extra-slots");
  group.append(...slots.map(slot => slotTile(doc, slot, state, editable)));
  section.append(node(doc, "legend", "", sbsI18n("swade-grid-inventory.UI.Attachmentslots_241e177737")), group);
  return section;
}

function slotAccordion(doc, key, label, className = "") {
  const details = node(doc, "details", className);
  const summary = node(doc, "summary", "", label);
  details.append(summary);
  const storage = doc.defaultView.localStorage;
  details.open = storage.getItem(key) === "open";
  summary.addEventListener("click", event => {
    event.preventDefault();
    details.open = !details.open;
    if (details.open) storage.setItem(key, "open");
    else storage.removeItem(key);
  });
  return details;
}

function renderDoll(doc, actor, state, editable) {
  const region = node(doc, "aside", "sgi-equipment");
  const stage = node(doc, "div", "sgi-stage");
  const art = node(doc, "div", "sgi-doll-art");
  const drawing = image(doc);
  paintDoll(drawing, paperDoll(actor));
  art.append(drawing);
  stage.append(art);
  const extra = [];
  const attachments = new Map();
  const groups = new Map((actor.flags?.[ID]?.slotGroups ?? []).map(group => [group.id, {group, slots: []}]));
  for (const slot of state.slots.values()) {
    const target = slotTile(doc, slot, state, editable);
    if (slot.parent) {
      const {id, name} = slot.parent;
      if (!attachments.has(id)) attachments.set(id, {label: name, targets: []});
      attachments.get(id).targets.push(target);
    } else if (groups.has(slot.group)) {
      groups.get(slot.group).slots.push({slot, target});
    } else if (standardSlotIds.has(slot.id) && slotPosition(slot)) {
      target.style.gridArea = `${slot.row} / ${slot.column}`;
      stage.append(target);
    } else extra.push({key: `slot.${slot.id}`, definition: slot, targets: [target]});
  }
  for (const {group, slots} of groups.values()) {
    extra.push({key: `group.${group.id}`, definition: group, compact: true,
      targets: slots.sort((a, b) => slotOrder(a.slot, b.slot)).map(({target}) => target)});
  }
  region.append(stage);
  if (!extra.length && !attachments.size) return region;
  extra.sort((a, b) => {
    const first = slotPosition(a.definition);
    const second = slotPosition(b.definition);
    return (first?.row ?? Infinity) - (second?.row ?? Infinity) || (first?.column ?? 0) - (second?.column ?? 0);
  });
  for (const [id, {label, targets}] of attachments) {
    extra.push({key: `attachment.${id}`, definition: {label}, targets});
  }
  const prefix = `${ID}.additionalSlots.${game.world.id}.${game.user.id}.${actor.uuid}`;
  const accordion = slotAccordion(doc, prefix, sbsI18n("swade-grid-inventory.UI.Additionalslots_5ad4b2dcd5"), sbsI18n("swade-grid-inventory.UI.sgislotaccordion_b092179f71"));
  for (const {key, definition, targets, compact} of extra) {
    const entry = slotAccordion(doc, `${prefix}.${key}`, definition.label, compact ? "sgi-slot-group" : "");
    const content = node(doc, "div", compact ? "sgi-slot-group-squares" : "sgi-extra-slots");
    content.append(...targets);
    entry.append(content);
    accordion.append(entry);
  }
  region.append(accordion);
  return region;
}

export function containerQuantityLabels(state, id) {
  const quantities = containerQuantities(state, id);
  if (!quantities) return [];
  const lines = [`Items ${number(quantities.current)} / ${quantities.limit ? number(quantities.limit) : "∞"}`];
  if (quantities.rules.length > 1) {
    for (const rule of quantities.rules) lines.push(`${rule.match} ${number(rule.current)} / ${number(rule.limit)}`);
  }
  return lines;
}

function storageTooltip(storage, state) {
  const lines = [storage.item.name];
  if (storage.limit) lines.push(`${number(contentsWeight(state, storage.item.id))} / ${number(storage.limit)} ${unit()}`);
  lines.push(...containerQuantityLabels(state, storage.item.id));
  return lines.join(" · ");
}

export function renderGridSurface(doc, grid) {
  const surface = node(doc, "div", "sgi-grid");
  const region = displayedShape(grid);
  surface.dataset.sgiGrid = grid.item.id;
  surface.dataset.sgiGridLeft = region.x;
  surface.dataset.sgiGridTop = region.y;
  surface.setAttribute("aria-label", grid.item.name);
  surface.style.setProperty("--sgi-columns", region.width);
  surface.style.setProperty("--sgi-rows", region.height);
  surface.style.setProperty("--sgi-container-color", grid.color);
  if (region.pattern) {
    surface.classList.add("sgi-pattern-grid");
    const cells = doc.createDocumentFragment();
    for (const {x, y} of shapeCells(region)) {
      const cell = node(doc, "span", "sgi-pattern-cell");
      cell.style.gridArea = `${y + 1} / ${x + 1}`;
      cell.dataset.sgiCellX = x + region.x;
      cell.dataset.sgiCellY = y + region.y;
      cell.classList.toggle("sgi-edge-top", region.pattern[y - 1]?.[x] !== "#");
      cell.classList.toggle("sgi-edge-right", region.pattern[y][x + 1] !== "#");
      cell.classList.toggle("sgi-edge-bottom", region.pattern[y + 1]?.[x] !== "#");
      cell.classList.toggle("sgi-edge-left", region.pattern[y][x - 1] !== "#");
      cells.append(cell);
    }
    surface.append(cells);
  }
  return surface;
}

export function renderGrid(doc, grid, entries, state, editable, iconsOnly = false, insideContainerSheet = false) {
  const surface = renderGridSurface(doc, grid);
  const region = displayedShape(grid);
  if (!iconsOnly && !insideContainerSheet) surface.dataset.tooltipText = storageTooltip(grid, state);
  for (const {item} of entries) surface.append(tile(doc, item, state, editable, "grid", region, iconsOnly, insideContainerSheet));
  return surface;
}

function moneyBar(doc, actor, editable) {
  const api = game.modules.get("swade-better-money")?.api;
  if (!api?.balances) return null;
  const bar = node(doc, "div", "sgi-money");
  const balances = node(doc, "div", "sgi-balances");
  for (const {currency, amount} of api.balances(actor)) {
    const mark = api.currencyMark?.(doc, currency);
    const balance = node(doc, "span", "sgi-balance");
    if (mark) balance.append(mark);
    balance.append(`${mark ? "" : currency.symbol ?? ""}${amount}`, node(doc, "span", "sr-only", ` ${currency.name}`));
    balances.append(balance);
  }
  bar.append(balances);
  if (editable && api.open) bar.append(button(doc, sbsI18n("swade-grid-inventory.UI.ManageMoney_460af20e2f"), sbsI18n("swade-grid-inventory.UI.moneybilltransfer_021609a656"), () => api.open(actor), true));
  return bar;
}

function renderCarried(doc, state, editable) {
  const storage = node(doc, "div", "sgi-storage-body");
  if (!state.rootGrids.size) {
    storage.append(node(doc, "p", "hint", sbsI18n("swade-grid-inventory.UI.Nostorageequipped_158c2fe988")));
    return storage;
  }
  const grids = [...state.rootGrids.values()].filter(grid => !grid.list);
  if (grids.length) {
    const viewport = node(doc, "div", "sgi-board-viewport");
    const board = node(doc, "div", "sgi-board");
    board.style.setProperty("--sgi-cell", `${CELL}px`);
    for (const grid of grids) board.append(renderGrid(doc, grid, state.gridItems.get(grid.item.id), state, editable));
    viewport.append(board);
    storage.append(viewport);
  }
  for (const list of state.rootGrids.values()) {
    if (list.list) storage.append(renderContainerList(doc, list, state, editable, true));
  }
  return storage;
}

export function renderItemList(doc, state, items, editable, emptyText, insideContainerSheet = false, itemHeading = "Item") {
  const body = node(doc, "div", "sgi-storage-body sgi-item-list");
  const list = [...items];
  if (list.length) {
    const heading = node(doc, "div", "sgi-list-heading");
    heading.append(node(doc, "span", "", itemHeading), node(doc, "span", "", sbsI18n("swade-grid-inventory.UI.Qty_a9be9c3e9a")), node(doc, "span", "", sbsI18n("swade-grid-inventory.UI.Weight_81d27ef6d5")));
    const entries = node(doc, "ol", "sgi-list-rows");
    for (const item of list) {
      const row = node(doc, "li");
      row.append(tile(doc, item, state, editable, "list", null, false, insideContainerSheet));
      entries.append(row);
    }
    body.append(heading, entries);
  } else body.append(node(doc, "p", "hint", emptyText));
  return body;
}

export function renderContainerList(doc, storage, state, editable, showName = false, iconsOnly = false, insideContainerSheet = false) {
  const surface = node(doc, "section", "sgi-container-list");
  surface.dataset.sgiContainerList = storage.item.id;
  if (!iconsOnly && !insideContainerSheet) surface.dataset.tooltipText = storageTooltip(storage, state);
  surface.setAttribute("aria-label", storage.item.name);
  if (showName) surface.append(node(doc, "strong", "sgi-container-list-name", storage.item.name));
  const items = state.gridItems.get(storage.item.id).map(({item}) => item);
  if (iconsOnly) {
    const icons = node(doc, "div", "sgi-container-icon-list");
    for (const item of items) icons.append(tile(doc, item, state, false, "slot", null, true));
    surface.append(icons);
    return surface;
  }
  surface.append(renderItemList(doc, state, items, editable, sbsI18n("swade-grid-inventory.UI.Emptycontainer_97283bd8b5"), insideContainerSheet));
  return surface;
}

function renderStorage(doc, app, actor, state, editable, summary) {
  const storage = node(doc, "section", "sgi-storage");
  const toolbar = node(doc, "div", "sgi-toolbar");
  const tabs = node(doc, "nav", "sgi-storage-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Inventorylocation_5f3d8439c2"));
  const carried = renderCarried(doc, state, editable);
  const unplacedItems = [...state.items.values()].filter(item => !state.placements.has(item.id) && !state.stored.has(item.id));
  const unplaced = renderItemList(doc, state, unplacedItems, editable, sbsI18n("swade-grid-inventory.UI.Nounplaceditems_5a5a84d03b"));
  const stored = node(doc, "section", "sgi-storage-body sgi-other-items");
  if (state.naturalWeapons.size) {
    const natural = node(doc, "section", "sgi-natural-weapons");
    natural.append(renderItemList(doc, state, state.naturalWeapons.values(), editable, "", false,
      sbsI18n("swade-grid-inventory.UI.NaturalWeapons")));
    stored.append(natural);
  }
  stored.append(renderItemList(doc, state, state.stored.values(), editable,
    state.naturalWeapons.size ? "" : sbsI18n("swade-grid-inventory.UI.Nostoreditems_a1d85cce17")));
  unplaced.dataset.sgiListLocation = "loose";
  stored.dataset.sgiListLocation = "stored";
  if (editable) {
    unplaced.dataset.sgiIntake = "";
    stored.dataset.sgiStore = "";
  }
  const views = {
    carried: {label: sbsI18n("swade-grid-inventory.UI.Carried_4014b8870c"), panel: carried, drop: "sgiRetrieve"},
    unplaced: {label: sbsI18n("swade-grid-inventory.UI.Unplaced_dfa4be8dbb", {p0: (number(unplacedItems.length))}), panel: unplaced, drop: "sgiIntake"},
    stored: {label: sbsI18n("swade-grid-inventory.UI.Stored_d7fa12d75f", {p0: (number(state.stored.size + state.naturalWeapons.size))}), panel: stored, drop: "sgiStore"}
  };
  const keys = Object.keys(views);
  const id = foundry.utils.randomID();
  const win = doc.defaultView;
  for (const [key, view] of Object.entries(views)) {
    const tab = view.tab = button(doc, view.label);
    tab.addEventListener("click", () => select(key));
    tab.id = `sgi-${id}-${key}-tab`;
    view.panel.id = `sgi-${id}-${key}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", view.panel.id);
    view.panel.setAttribute("role", "tabpanel");
    view.panel.setAttribute("aria-labelledby", tab.id);
    if (editable) {
      tab.dataset[view.drop] = "";
      let hoverTimer;
      const stopHover = () => win.clearTimeout(hoverTimer);
      tab.addEventListener("dragenter", event => {
        if (selectedTabs.get(app) === key || !event.dataTransfer?.types.includes("text/plain")) return;
        stopHover();
        hoverTimer = win.setTimeout(() => { if (tab.isConnected) select(key); }, 300);
      });
      tab.addEventListener("dragleave", event => { if (!tab.contains(event.relatedTarget)) stopHover(); });
      tab.addEventListener("drop", stopHover);
    }
    tabs.append(tab);
  }
  tabs.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = keys.indexOf(selectedTabs.get(app));
    const key = event.key === "Home" ? keys[0] : event.key === "End" ? keys.at(-1)
      : keys[(index + (event.key === "ArrowLeft" ? -1 : 1) + keys.length) % keys.length];
    select(key);
    views[key].tab.focus();
  });
  function select(key) {
    selectedTabs.set(app, key);
    for (const [name, {tab, panel}] of Object.entries(views)) {
      const active = key === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
    }
  }
  if (editable && !actor.flags?.["swade-better-mounts-and-vehicles"]?.grid) {
    const config = button(doc, sbsI18n("swade-grid-inventory.UI.Configurepaperdoll_fc23529e51"), sbsI18n("swade-grid-inventory.UI.usergear_4ec5e6731c"), () => editPaperDoll(actor, app, config), true);
    config.classList.add("sgi-configure-doll");
    config.setAttribute("aria-expanded", String(isPaperDollOpen(app)));
    toolbar.append(config);
  }
  toolbar.append(tabs);
  const tools = node(doc, "div", "sgi-toolbar-tools");
  if (editable) tools.append(button(doc, sbsI18n("swade-grid-inventory.UI.AddItem_054bcbbe57"), sbsI18n("swade-grid-inventory.UI.plus_383ef36928"), async () => {
    if (await createItem(actor)) {
      selectedTabs.set(app, "unplaced");
      searchQueries.delete(app);
      await app.render();
    }
  }));
  const search = node(doc, "input", "sgi-inventory-search");
  search.type = "search";
  search.autocomplete = "off";
  search.placeholder = sbsI18n("swade-grid-inventory.UI.Search_7336265a04");
  search.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Searchinventory_f138ecf914"));
  search.value = searchQueries.get(app) ?? "";
  search.addEventListener("keydown", event => { if (event.key === "Enter") event.preventDefault(); });
  tools.append(search);
  toolbar.append(tools);
  storage.append(toolbar);
  const money = moneyBar(doc, actor, editable);
  if (summary || money) {
    summary ??= node(doc, "section");
    summary.classList.add("sgi-inventory-summary");
    summary.querySelector(".sgi-money")?.remove();
    if (money) summary.prepend(money);
    storage.append(summary);
  }
  storage.append(carried, unplaced, stored);

  const results = [carried, unplaced, stored].map(panel => {
    const tiles = [...panel.querySelectorAll("[data-sgi-item]")];
    const empty = node(doc, "p", "hint sgi-search-empty", sbsI18n("swade-grid-inventory.UI.Nomatchingitems_7f406b7e22"));
    panel.append(empty);
    return {tiles, empty};
  });
  const filter = () => {
    const query = search.value.trim();
    searchQueries.set(app, search.value);
    for (const {tiles, empty} of results) {
      for (const tile of tiles) tile.hidden = !matchesInventoryQuery(state.items.get(tile.dataset.sgiItem), query);
      empty.hidden = !query || !tiles.length || tiles.some(tile => !tile.hidden);
    }
  };
  search.addEventListener("input", filter);
  filter();
  select(selectedTabs.get(app) ?? "carried");
  return storage;
}

function observeBoard(layout, state) {
  const viewport = layout.querySelector(".sgi-board-viewport");
  if (!viewport) return null;
  const board = viewport.firstElementChild;
  const regions = [...board.children];
  const grids = regions.map(region => displayedShape(state.grids.get(region.dataset.sgiGrid)));
  let lastColumns;
  const arrange = () => {
    if (!viewport.clientWidth) return;
    const gap = parseFloat(board.ownerDocument.defaultView.getComputedStyle(board).columnGap);
    const columns = Math.floor((viewport.clientWidth + gap) / (CELL + gap));
    if (lastColumns === columns) return;
    lastColumns = columns;
    packGrids(grids, columns).forEach(({x, y, width, height}, index) => {
      regions[index].style.gridArea = `${y + 1} / ${x + 1} / span ${height} / span ${width}`;
    });
  };
  const observer = new ResizeObserver(arrange);
  observer.observe(viewport);
  arrange();
  return observer;
}

export function closeInventory(app) {
  bindings.get(app)?.();
  bindings.delete(app);
}

export function renderInventory(app, root) {
  closeInventory(app);
  const actor = app.document;
  if (actor?.flags?.["swade-better-mounts-and-vehicles"]?.grid) return;
  if (actor?.documentName !== "Actor" || actor.type !== "character") return;
  const native = root.querySelector("[data-tab='inventory'] > section.inventory");
  if (!native) return;
  const tab = native.parentElement;
  const position = takeInventoryScroll(app, tab);
  const summary = tab.querySelector(":scope > section.flexrow:has(> .encumbrance), .sgi-inventory-summary:has(> .encumbrance)");
  tab.querySelector(".sgi-layout")?.remove();
  tab.classList.add("sgi-inventory-tab");
  native.hidden = true;
  native.classList.add("sgi-native-inventory");
  const doc = root.ownerDocument;
  const state = inventory(actor);
  const editable = actor.isOwner && app.isEditable;
  const layout = node(doc, "div", "sgi-layout");
  layout.dataset.tooltipClass = "sbs-standard-swade-sheet";
  const doll = renderDoll(doc, actor, state, editable);
  layout.append(doll, renderStorage(doc, app, actor, state, editable, summary));
  native.before(layout);
  const board = observeBoard(layout, state);
  restoreInventoryScroll(tab, position);
  const cleanup = bindInventory(layout, app, actor, state, editable);
  bindings.set(app, () => {
    board?.disconnect();
    cleanup?.();
  });
}

// Reuse the complete inventory, including placement, search, storage and item
// controls, for actors whose equipment consists of container slots.
export function renderContainerInventory(app, target) {
  closeInventory(app);
  target.querySelector(".sgi-layout")?.remove();
  const actor = app.document;
  const state = inventory(actor);
  const editable = actor.isOwner && app.isEditable;
  const doc = target.ownerDocument;
  const layout = node(doc, "div", "sgi-layout sgi-container-inventory");
  layout.dataset.tooltipClass = "sbs-standard-swade-sheet";
  const slots = node(doc, "div", "sgi-container-slots");
  for (const slot of state.slots.values()) slots.append(slotTile(doc, slot, state, editable));
  layout.append(slots, renderStorage(doc, app, actor, state, editable));
  target.append(layout);
  const board = observeBoard(layout, state);
  const cleanup = bindInventory(layout, app, actor, state, editable);
  bindings.set(app, () => { board?.disconnect(); cleanup?.(); });
}
