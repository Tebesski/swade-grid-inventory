import {t as sbsI18n} from "./i18n.mjs";
import {CONTAINER, ID, baseSlots, buildState, contentsWeight, hasInventory, isPartyStorage, loadedWeight, settings} from "./model.mjs";
import {checkConfiguration, inventory, serialize, warn} from "./actions.mjs";
import {CELL} from "./board.mjs";
import {bindInventory} from "./interactions.mjs";
import {playSound} from "./sounds.mjs";
import {
  containerQuantityLabels, node, readInventoryScroll, renderAttachmentSlots, renderContainerList, renderGrid, restoreInventoryScroll, takeInventoryScroll
} from "./view.mjs";

const {HandlebarsApplicationMixin} = foundry.applications.api;
const {ItemSheetV2} = foundry.applications.sheets;
const image = "icons/containers/bags/pack-leather-white-tan.webp";
const tabId = "sgi-container";
const panels = new Map();
const refreshes = new Set();
const weightUnit = () => game.settings.get("swade", "weightUnit") === "imperial" ? "lb" : "kg";
const format = value => Number(value).toLocaleString(undefined, {maximumFractionDigits: 3});

export class ContainerSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["swade", "sgi-container-sheet"],
    position: {width: 480, height: "auto"},
    window: {resizable: true},
    sheetConfig: false,
    form: {submitOnChange: true}
  };

  static PARTS = {sheet: {
    template: `modules/${ID}/templates/container.hbs`, templates: ["templates/generic/tab-navigation.hbs"],
    scrollable: [".sgi-board-viewport", ".sgi-container-list"]
  }};

  static TABS = {main: {
    initial: tabId,
    tabs: [{id: "details", get label() { return sbsI18n("swade-grid-inventory.UI.Details_45989de49f"); }, cssClass: "item"}, {id: tabId, get label() { return sbsI18n("swade-grid-inventory.UI.Container_0c7823e8c7"); }, cssClass: "item"}]
  }};

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {...context, item: this.item, units: weightUnit(), weightId: `${this.id}-weight`};
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    void playSound(this.item, "open");
  }

  _onClose(options) {
    super._onClose(options);
    void playSound(this.item, "close");
  }

  async _processSubmitData(event, form, submitData, options) {
    if (!hasInventory(this.actor)) return super._processSubmitData(event, form, submitData, options);
    try {
      return await serialize(this.actor, async () => {
        const current = this.actor.items.get(this.item.id);
        if (!current) throw new Error(sbsI18n("swade-grid-inventory.UI.Thiscontainerwasremoved_2def755052"));
        const edited = current.clone(submitData, {keepId: true});
        checkConfiguration(this.actor, baseSlots(this.actor), edited);
        return super._processSubmitData(event, form, submitData, options);
      });
    } catch (error) {
      warn(error);
      await this.render();
    }
  }
}

export function registerContainers() {
  const GearData = CONFIG.Item.dataModels.gear;
  const {NumberField} = foundry.data.fields;
  class ContainerData extends GearData {
    static defineSchema() {
      return {...super.defineSchema(), quantity: new NumberField({integer: true, min: 1, max: 1, initial: 1})};
    }

    async _preCreate(data, options, user) {
      if (!data.img) this.parent.updateSource({img: image});
      return super._preCreate({...data, img: data.img || image}, options, user);
    }
  }
  CONFIG.Item.dataModels[CONTAINER] = ContainerData;
  foundry.documents.collections.Items.registerSheet(ID, ContainerSheet, {
    types: [CONTAINER], makeDefault: true, label: sbsI18n("swade-grid-inventory.UI.Container_0c7823e8c7")
  });
}

export function closeContainerTab(app) {
  panels.get(app)?.cleanup?.();
  panels.delete(app);
}

function isEquipped(state, item) {
  const placement = state.placements.get(item.id);
  return placement?.kind === "slot" && state.occupants.get(placement.slot)?.id === item.id;
}

export function renderContainerTab(app, root) {
  const item = app.document;
  if (item?.documentName !== "Item") return;
  closeContainerTab(app);
  const dedicated = app instanceof ContainerSheet;
  const config = settings(item);
  const actor = item.actor;
  const ownsInventory = hasInventory(actor) && actor.items.has(item.id);
  const doc = root.ownerDocument;
  const nav = root.querySelector(dedicated ? "nav.sheet-tabs" : ".main-grid nav.sheet-tabs");
  const first = nav?.querySelector(`[data-action="tab"]:not([data-tab="${tabId}"])`);
  if (!first) return;
  const group = first.dataset.group;
  let panel = root.querySelector(`.tab[data-tab="${tabId}"]`);
  const position = takeInventoryScroll(app, panel);
  const supportsStorage = dedicated || config.container?.enabled || config.slots?.length;
  const state = ownsInventory && supportsStorage ? inventory(actor) : null;
  const equipped = !!state && isEquipped(state, item);
  const binding = {app, item, actor: ownsInventory ? actor : null, equipped};

  if (equipped || (!dedicated && ((!ownsInventory && actor) || !supportsStorage))) {
    nav.querySelector(`[data-tab="${tabId}"]`)?.remove();
    panel?.remove();
    if (app.tabGroups[group] === tabId) app.changeTab(first.dataset.tab, group, {updatePosition: false});
    if (equipped) panels.set(app, binding);
    return;
  }

  if (!dedicated) {
    const body = root.querySelector(".main-grid .sheet-body");
    if (!body) return;
    nav.querySelector(`[data-tab="${tabId}"]`)?.remove();
    panel?.remove();
    const link = node(doc, "a", "item", sbsI18n("swade-grid-inventory.UI.Container_0c7823e8c7"));
    link.tabIndex = 0;
    link.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      link.click();
    });
    Object.assign(link.dataset, {action: "tab", group, tab: tabId});
    panel = node(doc, "section", "tab scrollable sgi-container-tab");
    Object.assign(panel.dataset, {group, tab: tabId});
    if (app.tabGroups[group] === tabId) {
      link.classList.add("active");
      panel.classList.add("active");
    }
    nav.append(link);
    body.append(panel);
  }
  if (!panel) return;
  binding.panel = panel;
  renderContents(binding, state ?? buildState([item], []), position);
  panels.set(app, binding);
}

function renderContents(binding, state, position = readInventoryScroll(binding.panel)) {
  const {app, panel, item, actor} = binding;
  const doc = panel.ownerDocument;
  const editable = !!(actor?.isOwner && app.isEditable && !actor.system.locked);
  const root = item.flags?.["swade-better-setting"]?.partyStorageRoot;
  const config = settings(item).container;
  const canRead = !actor || actor.testUserPermission(game.user, "OBSERVER");
  const iconsOnly = !canRead;
  if (iconsOnly && (root || config?.visibility === "private")) {
    binding.cleanup?.();
    panel.replaceChildren(node(doc, "p", "hint", sbsI18n("swade-grid-inventory.UI.Thiscontainerisprivate_e7f4b6315c")));
    return;
  }
  const grid = state.grids.get(item.id);
  const unit = weightUnit();
  const layout = node(doc, "div", "sgi-layout sgi-container-interior");
  layout.dataset.tooltipClass = "sbs-standard-swade-sheet";
  const summary = node(doc, "div", "sgi-container-summary");
  const weight = node(doc, "span", "", sbsI18n("swade-grid-inventory.UI.Loadedweight_4e457c097e"));
  weight.append(node(doc, "strong", "", `${format(loadedWeight(state, item))} ${unit}`));
  summary.append(weight);
  if (grid?.limit) {
    const limit = node(doc, "span", "", `${format(contentsWeight(state, item.id))} / ${format(grid.limit)} ${unit}`);
    limit.title = sbsI18n("swade-grid-inventory.UI.Contentscapacity_3afc08e845");
    summary.append(limit);
  }
  if (!iconsOnly) {
    for (const label of containerQuantityLabels(state, item.id)) {
      summary.append(node(doc, "span", "sgi-container-quantity", label));
    }
  }
  const attachments = !iconsOnly && renderAttachmentSlots(doc, item, state, editable);
  if (attachments) layout.append(attachments);
  if (grid?.list) layout.append(renderContainerList(doc, grid, state, editable, false, iconsOnly, true));
  else if (grid) {
    const viewport = node(doc, "div", "sgi-board-viewport");
    const board = node(doc, "div", "sgi-board");
    board.style.setProperty("--sgi-cell", `${CELL}px`);
    board.append(renderGrid(doc, grid, state.gridItems.get(item.id), state, editable, iconsOnly, true));
    viewport.append(board);
    layout.append(viewport);
  }
  binding.cleanup?.();
  panel.replaceChildren(...(iconsOnly ? [layout] : [summary, layout]));
  if (!actor) panel.append(node(doc, "p", "hint", sbsI18n("swade-grid-inventory.UI.Addthisitemtoaplayer_58b06254ea")));
  restoreInventoryScroll(panel, position);
  binding.cleanup = actor && !iconsOnly ? bindInventory(layout, app, actor, state, editable, {partyStorage: isPartyStorage(actor)}) : undefined;
}

export function refreshContainerSheets(item) {
  const actor = item.actor;
  if (!actor || refreshes.has(actor.uuid) || ![...panels.values()].some(binding => binding.actor?.uuid === actor.uuid)) return;
  refreshes.add(actor.uuid);
  requestAnimationFrame(() => {
    refreshes.delete(actor.uuid);
    const state = inventory(actor);
    for (const binding of panels.values()) {
      if (!binding.app.element?.isConnected || binding.actor?.uuid !== actor.uuid) continue;
      if (binding.equipped !== isEquipped(state, binding.item)) void binding.app.render();
      else if (binding.panel?.isConnected) renderContents(binding, state);
    }
  });
}
