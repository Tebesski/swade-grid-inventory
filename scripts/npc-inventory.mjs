import {CONTAINER, inventoryParent} from "./model.mjs";
import {inventory, warn} from "./actions.mjs";
import {button} from "./view.mjs";
import {editTokenInventory} from "./loot-ui.mjs";
import {isLootContainer} from "./loot-model.mjs";

const boundRoots = new WeakSet();

export function bindNpcContainerOpening(app, root) {
  if (app.document?.type !== "npc" || boundRoots.has(root)) return;
  boundRoots.add(root);
  root.addEventListener("dblclick", event => {
    if (event.button !== 0 || event.target.closest(".item-controls, input, select")) return;
    const row = event.target.closest("[data-item-id]");
    const item = app.document.items.get(row?.dataset.itemId);
    if (!item || !isLootContainer(item)) return;
    event.preventDefault();
    event.stopPropagation();
    void (async () => {
      const sheet = item.sheet;
      await sheet.render({force: true});
      const tab = sheet.element?.querySelector('[data-action="tab"][data-tab="sgi-container"]');
      if (tab) sheet.changeTab("sgi-container", tab.dataset.group, {updatePosition: false});
    })().catch(warn);
  }, {capture: true});
}

export function prepareNpcInventory(app, context) {
  if (app.document?.type !== "npc" || !context.itemTypes) return;
  const state = inventory(app.document);
  for (const [type, items] of Object.entries(context.itemTypes)) {
    context.itemTypes[type] = items.filter(item => !inventoryParent(state, item.id));
  }
  const containers = context.itemTypes[CONTAINER] ?? [];
  if (!containers.length) return;
  const gear = context.itemTypes.gear ?? [];
  const existing = new Set(gear.map(item => item.id));
  context.itemTypes.gear = [...gear, ...containers.filter(item => !existing.has(item.id))];
}

export function renderNpcInventorySettings(app, root) {
  const actor = app.document;
  if (!game.user.isGM || actor?.documentName !== "Actor" || actor.type !== "npc") return;
  const header = root.querySelector(".window-header");
  if (!header || header.querySelector(".sgi-token-inventory")) return;
  const control = button(root.ownerDocument, "Inventory settings", "boxes-stacked",
    () => editTokenInventory(actor.token ?? actor), true);
  control.classList.add("header-control", "sgi-token-inventory");
  const before = header.querySelector('[data-action="openTweaks"], [data-action="toggleControls"], [data-action="close"]');
  if (before) before.before(control);
}
