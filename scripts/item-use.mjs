import {t as sbsI18n} from "./i18n.mjs";
import {serialize} from "./actions.mjs";

export function tooltipCharges(item) {
  const charges = item.system?.charges;
  if (!charges?.hasCharges) return;
  let pool = charges.default;
  const usables = game.modules.get("swade-better-usables");
  if (usables?.active && item.type === "consumable" && item.system.subtype === "regular") {
    const flags = item.flags?.["swade-better-usables"] ?? item.flags?.["swade-better-consumables"] ?? {};
    const uses = charges.charges ?? [];
    const separate = uses.filter(use => flags.useConfig?.[use.id]?.separate);
    const shared = flags.shared !== false && uses.some(use => {
      const config = flags.useConfig?.[use.id];
      return !config?.separate && (config?.cost ?? 1) > 0;
    });
    if (separate.length + Number(shared) > 1) return sbsI18n("swade-grid-inventory.UI.Seeitem_97e10feb19");
    pool = shared ? {...pool, ...flags.sharedPool} : separate[0];
  }
  if (pool?.max > 0) return `${pool.value} / ${pool.max}`;
}

function hasMultipleUses(item) {
  return item.type === "consumable" && item.system.subtype === "regular" && item.system.charges.charges?.length > 1
    && !!globalThis.game?.modules?.get("swade-better-consumables")?.active;
}

function availableUses(item) {
  const charges = item?.system.charges;
  const charge = charges?.default;
  if (!charges?.hasCharges || !charge) throw new Error(sbsI18n("swade-grid-inventory.UI.Thisitemhasnousablecharges_72676ab7c0"));
  const quantity = item.system.quantity ?? 1;
  const uses = hasMultipleUses(item) ? charges.charges.filter(pool => pool.value >= 1).length
    : Number(charge.value >= 1 || (item.type === "consumable" && quantity > 1 && charge.max >= 1));
  if (!uses || (item.type === "consumable" && quantity < 1)) throw new Error(sbsI18n("swade-grid-inventory.UI.hasnochargesremaining_096bb573f0", {p0: (item.name)}));
  return uses;
}

export async function promptUseCharge(actor, source) {
  const item = actor.items.get(source.id);
  const uses = availableUses(item);
  if (uses > 1) return useCharge(actor, item);
  const use = hasMultipleUses(item) && item.system.charges.charges.find(pool => pool.value >= 1)?.name;
  if (await foundry.applications.api.DialogV2.confirm({
    classes: ["sbs-standard-swade-sheet"],
    window: {title: use ? `Use ${item.name} (${use})?` : `Use ${item.name}?`},
    position: {width: 300}, content: `<p>${sbsI18n("swade-grid-inventory.UI.Spendonecharge_f77b3b9422")}</p>`,
    yes: {label: sbsI18n("swade-grid-inventory.UI.Use_c36d819e7b")}, no: {label: sbsI18n("swade-grid-inventory.UI.Cancel_19766ed6cc")}
  })) return useCharge(actor, item);
}

export function useCharge(actor, source) {
  return serialize(actor, async () => {
    const item = actor.items.get(source.id);
    availableUses(item);
    if (hasMultipleUses(item)) return item.consume();
    if (item.type === "consumable") return item.consume(1);
    const charges = item.system.charges;
    const charge = charges.default;
    return item.update({"system.charges.charges": charges.charges.map(pool =>
      pool.id === charge.id ? {...pool, value: pool.value - 1} : pool)});
  });
}

export function rechargeItem(actor, source) {
  return serialize(actor, async () => {
    const item = actor.items.get(source.id);
    const charges = item?.system.charges;
    if (!charges?.hasCharges) throw new Error(sbsI18n("swade-grid-inventory.UI.Thisitemhasnocharges_d14aaa5b16"));
    const pools = charges.charges.filter(pool => pool.rechargeType !== "finite");
    if (!pools.length) throw new Error(sbsI18n("swade-grid-inventory.UI.hasnorechargeablecharges_45c7ceea68", {p0: (item.name)}));
    const depleted = pools.filter(pool => pool.value < pool.max);
    if (!depleted.length) throw new Error(sbsI18n("swade-grid-inventory.UI.isalreadyfullycharged_14aa76ca14", {p0: (item.name)}));
    for (const {id} of depleted) {
      const current = item.system.charges.find(id);
      if (current && current.rechargeType !== "finite") await item.rechargeCharge(current);
    }
  });
}

export function itemActions(item) {
  const actions = [];
  if (item.type === "weapon") {
    actions.push({key: "formula", label: sbsI18n("swade-grid-inventory.UI.Attack_4cd548f3cc"), icon: "fa-solid fa-crosshairs"});
    if (item.system.damage) actions.push({key: "damage", label: sbsI18n("swade-grid-inventory.UI.Damage_0c874f581a"), icon: "fa-solid fa-dice-d6"});
  }
  for (const [key, action] of Object.entries(item.system.actions?.additional ?? {})) {
    actions.push({key, label: action.name || sbsI18n("swade-grid-inventory.UI.Action_64cff1319d")});
  }
  return actions;
}

export async function useAction(actor, source) {
  const selection = await foundry.applications.api.DialogV2.wait({
    classes: ["sgi-use-action", "sbs-standard-swade-sheet"],
    window: {title: source.name},
    position: {width: 300}, content: "",
    buttons: itemActions(source).map(({key, label, icon}, index) => ({
      action: `item-action-${index}`, label, icon, callback: event => ({key, event})
    }))
  });
  if (!selection) return;
  const item = actor.items.get(source.id);
  if (!item || !itemActions(item).some(action => action.key === selection.key)) {
    throw new Error(sbsI18n("swade-grid-inventory.UI.Thisactionisnolongeravailable_d16bf8bcfe"));
  }
  const action = item.system.actions?.additional?.[selection.key];
  let roller = actor;
  if (action?.type === CONFIG.SWADE.CONST.ACTION_TYPE.RESIST) {
    const tokens = globalThis.canvas?.tokens?.controlled;
    if (tokens?.length !== 1) return ui.notifications.warn(game.i18n.localize("SWADE.NoTokenSelectedForResistRoll"));
    roller = tokens[0].actor ?? actor;
  }
  return game.swade.itemChatCardHelper.handleAction(item, roller, selection.key, {event: selection.event});
}
