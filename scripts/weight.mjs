import {t as sbsI18n} from "./i18n.mjs";
import {BUILTIN_TYPES, EQUIP, ID, defaultEquippedWeightOf, equippedWeightOf, inventoryParent, weightOf} from "./model.mjs";
import {inventory, warn} from "./actions.mjs";
import {node} from "./view.mjs";

const SETTING = "equippedWeight";

export function registerWeight() {
  game.settings.register(ID, SETTING, {
    name: sbsI18n("swade-grid-inventory.UI.Useweightwhenequipped_9b1f3dadc1"),
    hint: sbsI18n("swade-grid-inventory.UI.Applyeachequippeditemsalternate_b686372dd4"),
    scope: "world", config: true, type: Boolean, default: true,
    onChange: refreshWeight
  });
}

export function installWeight() {
  const prototype = CONFIG.Actor.documentClass.prototype;
  const calcInventoryWeight = prototype.calcInventoryWeight;
  const physicalModels = BUILTIN_TYPES.map(type => CONFIG.Item.dataModels[type]).filter(Boolean);
  prototype.calcInventoryWeight = function (...args) {
    let total = calcInventoryWeight.apply(this, args);
    if (this.type !== "character") return total;
    const adjustEquipped = game.settings.get(ID, SETTING);
    const inventoryState = inventory(this);
    for (const item of this.items) {
      const state = item.system?.equipStatus;
      if (state === EQUIP.stored || !physicalModels.some(model => item.system instanceof model)) continue;
      const placement = inventoryState.placements.get(item.id);
      const equipped = placement?.kind === "slot" ? inventoryState.occupants.get(placement.slot)?.id === item.id
        : state >= EQUIP.offHand;
      const base = weightOf(item);
      const weight = adjustEquipped && equipped ? equippedWeightOf(item) * Number(item.system.quantity) : base;
      let factor = 1;
      for (let parent = inventoryParent(inventoryState, item.id); parent && factor; parent = inventoryParent(inventoryState, parent.id)) {
        if (inventoryState.stored.has(parent.id)) factor = 0;
        else if (parent.grid) factor *= inventoryState.grids.get(parent.id).factor;
      }
      total += weight * factor - base;
    }
    return total;
  };
}

function refreshWeight() {
  if (!game.ready) return;
  const tokens = globalThis.canvas?.scene?.tokens.map(token => token.actor).filter(Boolean) ?? [];
  for (const actor of new Set([...game.actors, ...tokens])) {
    if (actor.type !== "character") continue;
    actor.reset();
    actor.render(false);
  }
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && app.document?.documentName === "Item") void app.render();
  }
}

export function renderEquippedWeight(app, root) {
  const previous = root.querySelector(".sgi-weight-inputs");
  if (previous) previous.replaceWith(previous.firstElementChild);
  if (!game.settings.get(ID, SETTING)) return;
  const item = app.document;
  if (!item?.isPhysicalItem || (item.actor && item.actor.type !== "character")) return;
  const weight = root.querySelector('[name="system.weight"]');
  const group = weight?.closest(".form-group, label");
  if (!group) return;
  const doc = root.ownerDocument;
  const fields = node(doc, "span", "sgi-weight-inputs");
  const input = node(doc, "input");
  input.type = "number";
  input.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Weightwhenequipped_21629c5211"));
  input.min = "0";
  input.step = "any";
  input.disabled = !app.isEditable || !item.isOwner || weight.disabled;
  const armor = item.type === "armor";
  input.dataset.tooltipText = armor
    ? sbsI18n("swade-grid-inventory.UI.LeaveblankforhalfofWeight_e1cb2cefc2")
    : sbsI18n("swade-grid-inventory.UI.EquippedWeightDefaultsToWeight");
  const info = node(doc, "i", "fa-solid fa-circle-info");
  info.dataset.tooltipText = sbsI18n("swade-grid-inventory.UI.Whenequipped_0a55e11457");
  info.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Whenequipped_0a55e11457"));
  info.tabIndex = 0;
  weight.before(fields);
  fields.append(weight, input, info);
  const updateDefault = () => {
    const fallback = defaultEquippedWeightOf(item, weight.value);
    input.placeholder = String(fallback);
    input.value = item.getFlag(ID, SETTING) ?? (armor ? "" : fallback);
  };
  updateDefault();
  fields.addEventListener("input", event => { if (event.target === weight) updateDefault(); });
  input.addEventListener("change", event => {
    event.stopPropagation();
    if (!input.reportValidity()) return;
    const update = input.value === "" ? item.unsetFlag(ID, SETTING) : item.setFlag(ID, SETTING, input.valueAsNumber);
    void update.then(updateDefault).catch(error => {
      updateDefault();
      warn(error);
    });
  });
}
