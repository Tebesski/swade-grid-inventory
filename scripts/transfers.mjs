import {ID, isGear, hasInventory} from "./model.mjs";
import {belongsTo, move, warn} from "./actions.mjs";

export function preserveTransferPlacement(item, data, options) {
  if (!options.sgiTransfer) return;
  const placement = item.flags?.[ID]?.placement;
  if (typeof placement?.equipStatus === "number") {
    item.updateSource({"system.equipStatus": placement.equipStatus});
  }
}

// Custom grids handle their own placement. This hook handles standard SWADE sheets.
export function transferActorDrop(actor, app, data) {
  if (data.sgiPlacement || data.type !== "Item" || !data.uuid || data.uuid.startsWith("Compendium.")) return;
  if (!hasInventory(actor) && actor.type !== "npc") return;
  const item = fromUuidSync(data.uuid);
  if (!item?.actor || belongsTo(actor, item) || !isGear(item)) return;
  void move(actor, item, {kind: "loose"}).catch(warn);
  return false;
}
