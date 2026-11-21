import {t as sbsI18n} from "./i18n.mjs";
import {canConfigureItem, editItem, registerSettings} from "./config.mjs";
import {button, closeInventory, refreshCoatingIcons, renderInventory, saveInventoryScroll} from "./view.mjs";
import {installWeight, registerWeight, renderEquippedWeight} from "./weight.mjs";
import {ContainerSheet, closeContainerTab, refreshContainerSheets, registerContainers, renderContainerTab} from "./container-sheet.mjs";
import {partyStorage} from "./party-storage.mjs";
import {checkQuantityUpdate} from "./actions.mjs";

Hooks.once("init", () => {
  if (game.system.id !== "swade") return;
  registerSettings();
  registerWeight();
  registerContainers();
  game.modules.get("swade-grid-inventory").api = {partyStorage};
});

Hooks.once("setup", () => { if (game.system.id === "swade") installWeight(); });

Hooks.once("ready", () => {
  if (game.system.id !== "swade") return;
  Hooks.on("preUpdateItem", checkQuantityUpdate);
  for (const action of [sbsI18n("swade-grid-inventory.UI.createItem_2be87307d5"), sbsI18n("swade-grid-inventory.UI.updateItem_fc765ef48a"), sbsI18n("swade-grid-inventory.UI.deleteItem_0259ed622a")]) Hooks.on(action, refreshContainerSheets);
  for (const action of [sbsI18n("swade-grid-inventory.UI.createActiveEffect_4607bdbb60"), sbsI18n("swade-grid-inventory.UI.updateActiveEffect_5ddfac034c"), sbsI18n("swade-grid-inventory.UI.deleteActiveEffect_1194b28b56")]) Hooks.on(action, refreshCoatingIcons);
  Hooks.on("closeApplicationV2", closeInventory);
  Hooks.on("closeApplicationV2", closeContainerTab);
  Hooks.on("preRenderApplicationV2", saveInventoryScroll);
  Hooks.on("renderApplicationV2", (app, root) => {
    renderInventory(app, root);
    if (app instanceof ContainerSheet) root.classList.add("sbs-standard-swade-sheet");
    const item = app.document;
    if (item?.documentName === "Item") {
      renderContainerTab(app, root);
      renderEquippedWeight(app, root);
    }
    if (!canConfigureItem(item) || !app.isEditable) return;
    const header = root.querySelector(".window-header");
    const controls = header?.querySelector('[data-action="toggleControls"], [data-action="close"]');
    if (!controls || header.querySelector(".sgi-item-settings")) return;
    const settings = button(root.ownerDocument, sbsI18n("swade-grid-inventory.UI.Inventorysettings_13c28b0dbd"), sbsI18n("swade-grid-inventory.UI.boxesstacked_23ccd8e4fa"), () => editItem(item), true);
    settings.classList.add("header-control", sbsI18n("swade-grid-inventory.UI.sgiitemsettings_85275e1444"));
    controls.before(settings);
  });
});
