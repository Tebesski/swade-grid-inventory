import {hasInventory, isHudInventoryItem} from "./model.mjs";
import {inventory} from "./actions.mjs";

// Filter the inventory sidebar only; the HUD's attack list still receives every weapon.
export function installHudInventory() {
  const hud = game.modules.get("swade-hud")?.api;
  if (!hud?.inventorySidebar || !hud.inventoryItem || hud.inventorySidebar.sgiFiltered) return;
  const sidebar = hud.inventorySidebar;
  const itemRow = hud.inventoryItem;
  const states = new WeakMap();
  hud.inventoryItem = function (list, item, ...args) {
    const state = states.get(list);
    if (state && !isHudInventoryItem(state, item)) return;
    return itemRow.call(this, list, item, ...args);
  };
  hud.inventorySidebar = function (list, ...args) {
    if (hasInventory(this.actor)) states.set(list, inventory(this.actor));
    try {
      const result = sidebar.call(this, list, ...args);
      for (const heading of list.querySelectorAll(":scope > header")) {
        if (!heading.nextElementSibling || heading.nextElementSibling.tagName === "HEADER") heading.remove();
      }
      return result;
    } finally {
      states.delete(list);
    }
  };
  hud.inventorySidebar.sgiFiltered = true;
  hud.schedule?.();
}
