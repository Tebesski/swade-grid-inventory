import {ID, dimensions, findSpace, inventoryParent, settings} from "./model.mjs";
import {inventory, move} from "./actions.mjs";
import {soundPath} from "./sounds.mjs";
import {adjacentTokens, advanceSearch, isLootContainer, isLootToken, lootItems, overallSearch, searchProgress} from "./loot-model.mjs";

const channel = `module.${ID}`;
const requests = new Map();
const sessions = new Map();
let queue = Promise.resolve();
let changed = () => {};

export function onLootChanged(callback) {
  changed = callback;
}

function activeGM() {
  return game.users.activeGM;
}

function progressKey(token, container) {
  return `${token.parent.id}-${token.id}${container ? "-" + container : ""}`;
}

function sessionKey(user, token, container) {
  return `${user.id}:${token.uuid}:${container ?? ""}`;
}

async function saveProgress(user, token, progress, container) {
  await user.setFlag(ID, `lootProgress.${progressKey(token, container)}`, progress);
}

function scopeItems(user, token, container, state) {
  if (container) {
    const item = state.items.get(container);
    if (!item || !isLootContainer(item)) throw new Error("This container is no longer available.");
    const visited = new Set();
    for (let id = container; id; id = inventoryParent(state, id)?.id) {
      if (visited.has(id)) throw new Error("Invalid container hierarchy.");
      visited.add(id);
      const parent = inventoryParent(state, id)?.id;
      const saved = user.getFlag(ID, "lootProgress")?.[progressKey(token, parent)];
      if (!saved?.revealed?.includes(id)) throw new Error("Search the container before opening it.");
    }
  }
  return lootItems(token.actor, container ?? null, state);
}

function context(user, request, requireAdjacent = true) {
  const token = fromUuidSync(request.token);
  if (!user?.active || !token || (!isLootToken(token) && request.action !== "pause")) throw new Error("This token is no longer lootable.");
  if (user.isGM) return {token, looter: request.looter ? fromUuidSync(request.looter) : null};
  const looter = fromUuidSync(request.looter ?? "");
  if ((requireAdjacent && token.hidden) || !looter || looter.actor?.type !== "character"
    || !looter.actor.testUserPermission(user, "OWNER")
    || (requireAdjacent && !adjacentTokens(looter, token))) {
    throw new Error("Move your character next to the loot token to search it.");
  }
  return {token, looter};
}

async function handle(user, request) {
  const {token, looter} = context(user, request, request.action !== "pause");
  const container = request.container ?? null;
  let state = inventory(token.actor);
  const key = sessionKey(user, token, container);
  const saved = user.getFlag(ID, "lootProgress")?.[progressKey(token, container)];
  let items = scopeItems(user, token, container, state);
  let progress = searchProgress(items, saved);
  if (saved?.pending !== progress.pending || saved?.duration !== progress.duration) {
    await saveProgress(user, token, progress, container);
  }
  const session = sessions.get(key);
  if (request.action === "pause" || request.action === "step") {
    if (session && session.pending === progress.pending) {
      progress = request.action === "step"
        ? advanceSearch(progress, Date.now() - session.started)
        : {...progress, elapsed: Math.min(progress.duration, progress.elapsed + Date.now() - session.started)};
      progress = searchProgress(items, progress);
      await saveProgress(user, token, progress, container);
    }
    sessions.delete(key);
    if (request.action === "pause") return {};
  }
  if (request.action === "take" || request.action === "describe") {
    if (!progress.revealed.includes(request.item)) throw new Error("Search this item before taking it.");
    const item = items.find(item => item.id === request.item);
    if (!item) throw new Error("This item is no longer available.");
    if (request.action === "describe") {
      const description = item.system.description || item.system.notes || "";
      const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(description, {relativeTo: item, secrets: false});
      return {name: item.name, description: html};
    }
    const destination = looter?.actor;
    if (!item || destination?.type !== "character"
      || (!user.isGM && !destination.testUserPermission(user, "OWNER"))) throw new Error("Choose your character to receive the loot.");
    await move(destination, item, (state, candidate) => findSpace(state, candidate) ?? {kind: "loose"}, {quantity: request.quantity});
    state = inventory(token.actor);
    items = scopeItems(user, token, container, state);
    progress = searchProgress(items, progress);
    await saveProgress(user, token, progress, container);
    game.socket.emit(channel, {kind: "changed", token: token.uuid});
    changed(token.uuid);
  }
  const current = sessions.get(key);
  if (progress.pending && current?.pending !== progress.pending) {
    sessions.set(key, {pending: progress.pending, started: Date.now(), token: token.uuid, container});
  }
  if (!progress.pending) sessions.delete(key);
  const searching = sessions.get(key);
  const remaining = progress.duration - progress.elapsed - (searching ? Date.now() - searching.started : 0);
  const revealed = new Set(progress.revealed);
  const storage = state.grids.get(container);
  const grid = storage && !storage.list
    ? {width: storage.width, height: storage.height, pattern: storage.pattern, color: storage.color} : null;
  return {
    name: container ? token.actor.items.get(container).name : token.name, actor: token.actor.uuid, container,
    sounds: token.flags[ID].loot.sounds ?? token.actor.flags?.[ID]?.loot?.sounds ?? {},
    grid,
    items: items.map((item, index) => {
      const placement = state.placements.get(item.id);
      let footprint;
      if (grid && placement?.kind === "grid" && placement.container === container) {
        const [width, height] = dimensions(item, placement.rotated);
        footprint = {x: placement.x, y: placement.y, width, height, rotated: !!placement.rotated};
      }
      if (!revealed.has(item.id)) return {hidden: true, searching: item.id === progress.pending, row: index, footprint};
      return {id: item.id, name: item.name, img: item.img, quantity: item.system.quantity ?? 1,
        revealSound: soundPath(item, "place", game.settings.get(ID, "soundRules"), game.settings.get(ID, "soundDefault")),
        footprint, fillImage: !!settings(item).fillImage,
        container: isLootContainer(item)};
    }),
    overall: overallSearch(items, progress, remaining),
    pending: !!progress.pending, duration: progress.duration, remaining: Math.max(0, remaining)
  };
}

function execute(message) {
  const operation = queue.catch(() => {}).then(() => {
    const user = game.users.get(message.user);
    if (message.action === "deposit") return deposit(user, message);
    if (!["open", "refresh", "step", "pause", "take", "describe"].includes(message.action)) throw new Error("Unknown loot action.");
    return handle(user, message);
  });
  queue = operation.catch(() => {});
  return operation;
}

async function deposit(user, request) {
  const {token} = context(user, request);
  const item = await fromUuid(request.item);
  const permitted = item?.actor ? item.actor.testUserPermission(user, "OWNER")
    : item?.testUserPermission(user, "OBSERVER");
  if (!item || !permitted) throw new Error("You cannot move this item.");
  await move(token.actor, item, (state, candidate) => findSpace(state, candidate) ?? {kind: "loose"});
  game.socket.emit(channel, {kind: "changed", token: token.uuid});
  changed(token.uuid);
  return {};
}

export function lootRequest(action, token, looter, item, {container, quantity} = {}) {
  const gm = activeGM();
  if (!gm) return Promise.reject(new Error("An active GM is required to loot this token."));
  const message = {kind: "request", id: foundry.utils.randomID(), user: game.user.id, action,
    token: token.uuid, looter: looter?.uuid, item, container, quantity};
  if (gm.id === game.user.id) return execute(message);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      requests.delete(message.id);
      reject(new Error("The GM did not respond to the loot request."));
    }, 12000);
    requests.set(message.id, {resolve, reject, timeout});
    game.socket.emit(channel, message);
  });
}

export function installLootService() {
  game.socket.on(channel, message => {
    if (message?.kind === "changed") {
      changed(message.token ?? message.actor);
      return;
    }
    if (message?.kind === "response" && message.user === game.user.id) {
      const pending = requests.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      requests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    }
    if (message?.kind !== "request" || activeGM()?.id !== game.user.id) return;
    void execute(message).then(result => game.socket.emit(channel, {
      kind: "response", id: message.id, user: message.user, result
    })).catch(error => game.socket.emit(channel, {
      kind: "response", id: message.id, user: message.user, error: error.message
    }));
  });
  Hooks.on("updateUser", (user, changes) => {
    if (changes.active === false) {
      for (const [key, session] of sessions) {
        if (!key.startsWith(`${user.id}:`)) continue;
        const token = fromUuidSync(session.token);
        if (token) {
          const progress = searchProgress(lootItems(token.actor, session.container), user.getFlag(ID, "lootProgress")?.[progressKey(token, session.container)]);
          if (progress.pending === session.pending) {
            progress.elapsed = Math.min(progress.duration, progress.elapsed + Date.now() - session.started);
            void saveProgress(user, token, progress, session.container).catch(console.error);
          }
        }
        sessions.delete(key);
      }
    }
  });
  for (const event of ["createItem", "updateItem", "deleteItem"]) Hooks.on(event, item => {
    if (activeGM()?.id !== game.user.id || item.actor?.type !== "npc") return;
    game.socket.emit(channel, {kind: "changed", actor: item.actor.uuid});
    changed(item.actor.uuid);
  });
}
