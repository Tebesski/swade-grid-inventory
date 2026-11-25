import {findSpace, isGear} from "./model.mjs";
import {move, warn} from "./actions.mjs";
import {isLootToken} from "./loot-model.mjs";
import {lootRequest} from "./loot-service.mjs";
import {playerLooter} from "./loot-ui.mjs";

export function installTokenDrops() {
  document.addEventListener("drop", event => {
    const view = canvas.app?.view;
    if (!canvas.ready || event.target !== view) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type !== "Item") return;
    const point = canvas.canvasCoordinatesFromClient({x: event.clientX, y: event.clientY});
    if (dropItemOnToken(canvas, {...data, ...point}) !== false) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, {capture: true});
}

export function dropItemOnToken(canvas, data) {
  if (data.type !== "Item") return;
  const tokens = canvas.tokens.placeables.filter(token => token.visible && token.actor);
  const token = tokens.sort((a, b) => b.zIndex - a.zIndex).find(token => {
    const bounds = token.bounds;
    return data.x >= bounds.x && data.x <= bounds.x + bounds.width
      && data.y >= bounds.y && data.y <= bounds.y + bounds.height;
  });
  if (!token) return;
  void (async () => {
    const item = await CONFIG.Item.documentClass.fromDropData(data);
    if (!item || !isGear(item)) throw new Error("Only inventory items can be dropped onto a token.");
    if (!token.actor.isOwner && isLootToken(token.document)) {
      const looter = playerLooter(token.document);
      if (!looter) throw new Error("Move your character next to the loot token.");
      await lootRequest("deposit", token.document, looter, item.uuid);
    } else {
      if (!token.actor.isOwner) throw new Error("You cannot change this token's inventory.");
      // Dropping on the same actor is already satisfied and must not move its equipment.
      if (item.actor?.uuid === token.actor.uuid) return;
      await move(token.actor, item, (state, candidate) => findSpace(state, candidate) ?? {kind: "loose"});
    }
  })().catch(warn);
  return false;
}
