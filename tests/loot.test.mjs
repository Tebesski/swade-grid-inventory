import assert from "node:assert/strict";
import test from "node:test";
import {CONTAINER, ID} from "../scripts/model.mjs";
import {adjacentTokens, isLootToken, lootItems, overallSearch, searchProgress, advanceSearch} from "../scripts/loot-model.mjs";
import {installLootService} from "../scripts/loot-service.mjs";

test("loot adjacency covers occupied token squares, larger tokens, elevations and gridless reach", () => {
  const scene = {uuid: "Scene.test", grid: {size: 100, distance: 5, type: 1}};
  const token = (x, y, width = 1) => ({parent: scene, x, y, width, height: 1, elevation: 0});
  const target = token(100, 100);
  assert.equal(adjacentTokens(token(0, 100), target), true);
  assert.equal(adjacentTokens(token(0, 0), target), true);
  assert.equal(adjacentTokens(token(0, 100, 2), token(200, 100)), true);
  assert.equal(adjacentTokens(token(0, 100), token(200, 100)), false);
  assert.equal(adjacentTokens({...token(0, 100), elevation: 10}, target), false);
  assert.equal(adjacentTokens({...token(0, 100), parent: {uuid: "Scene.other"}}, target), false);
  scene.grid.type = 0;
  assert.equal(adjacentTokens(token(0, 100), token(180, 100)), true);
});

test("loot rows exclude natural weapons and preserve per-item partial search progress", () => {
  const gear = {id: "a", type: "armor", sort: 0};
  const natural = {id: "b", type: "weapon", flags: {[ID]: {naturalWeapon: true}}};
  const weapon = {id: "c", type: "weapon", sort: 1};
  const items = lootItems({items: [gear, natural, weapon, {id: "d", type: "skill"}]});
  assert.deepEqual(items, [gear, weapon]);
  let progress = searchProgress(items);
  progress = advanceSearch(progress, 350);
  assert.equal(progress.elapsed, 350);
  progress = searchProgress(items, progress);
  progress = advanceSearch(progress, progress.duration - 350);
  assert.deepEqual(progress.revealed, ["a"]);
  progress = searchProgress(items, progress);
  assert.equal(progress.pending, "c");
  assert.equal(progress.elapsed, 0);
  assert.equal(isLootToken({actor: {type: "npc"}, flags: {[ID]: {loot: {enabled: true}}}}), true);
  assert.equal(searchProgress(items, {}, () => 0).duration, 650);
  assert.equal(searchProgress(items, {}, () => 1).duration, 1800);
});

test("overall search advances within an item and retains completed work after loot is removed", () => {
  const items = [{id: "first"}, {id: "second"}, {id: "third"}];
  let progress = searchProgress(items, {}, () => 0);
  let overall = overallSearch(items, progress, progress.duration / 2);
  assert.equal(overall.fraction, 1 / 6);
  assert.equal(overall.next, 1 / 3);
  progress = advanceSearch(progress, progress.duration);
  progress = searchProgress(items, progress, () => 1);
  overall = overallSearch(items, progress, progress.duration / 2);
  assert.equal(overall.fraction, 0.5);
  const remainingItems = items.slice(1);
  progress = searchProgress(remainingItems, progress);
  assert.equal(overallSearch(remainingItems, progress, progress.duration / 2).fraction, 0.5);
  assert.equal(overallSearch([], searchProgress([], progress), 0).fraction, 1);
});

test("GM loot service resumes individual searches, validates access, and transfers revealed items", async () => {
  const saved = {game: globalThis.game, Hooks: globalThis.Hooks, fromUuidSync: globalThis.fromUuidSync, foundry: globalThis.foundry};
  const realNow = Date.now;
  const realRandom = Math.random;
  let now = 10000;
  let sequence = 0;
  const docs = new Map(), responses = new Map();
  class Items extends Map {
    [Symbol.iterator]() { return this.values(); }
    get contents() { return [...this.values()]; }
  }
  const scene = {id: "scene", uuid: "Scene.scene", grid: {size: 100, distance: 5, type: 1}};
  const actor = (uuid, type) => ({uuid, type, system: {}, isOwner: true, items: new Items(),
    testUserPermission: user => user.isGM || uuid === user.character});
  const npc = actor("Actor.npc", "npc");
  const character = actor("Actor.player", "character");
  const token = {id: "npc", uuid: "Scene.scene.Token.npc", name: "Loot", parent: scene,
    actor: npc, flags: {[ID]: {loot: {enabled: true, sounds: {search: "loop.ogg"}}}}, x: 100, y: 0, width: 1, height: 1};
  const looter = {uuid: "Scene.scene.Token.player", parent: scene, actor: character, x: 0, y: 0, width: 1, height: 1};
  docs.set(token.uuid, token);
  docs.set(looter.uuid, looter);
  const makeItem = (id, type, extra = {}) => {
    const item = {id, type, name: id, actor: npc, system: {quantity: 3, equipStatus: 3}, flags: {}, ...extra};
    item.toObject = () => ({_id: id, type, name: id, system: structuredClone(item.system), flags: structuredClone(item.flags)});
    npc.items.set(id, item);
    return item;
  };
  makeItem("a", "armor");
  makeItem("b", "weapon", {flags: {[ID]: {naturalWeapon: true}}});
  makeItem("c", "gear");
  const user = (id, isGM = false) => ({id, isGM, active: true, character: character.uuid, flags: {},
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, path, value) {
      const [key, subkey] = path.split(".");
      this.flags[scope] ??= {};
      (this.flags[scope][key] ??= {})[subkey] = structuredClone(value);
    }});
  const gm = user("gm", true), alice = user("alice"), bob = user("bob");
  const users = new Map([gm, alice, bob].map(user => [user.id, user]));
  users.activeGM = gm;
  let listener;
  globalThis.Hooks = {on() {}};
  globalThis.fromUuidSync = uuid => docs.get(uuid);
  globalThis.game = {user: gm, users, settings: {get: (_scope, key) => key === "soundRules" ? [] : false},
    socket: {on(channel, callback) { listener = callback; }, emit(channel, message) {
      if (message.kind === "response") {
        const response = responses.get(message.id);
        responses.delete(message.id);
        if (message.error) response.reject(new Error(message.error));
        else response.resolve(message.result);
      }
    }}};
  globalThis.foundry = {applications: {ux: {TextEditor: {implementation: {async enrichHTML(text, options) {
    assert.equal(options.secrets, false);
    return text;
  }}}}}, utils: {randomID: () => "new" + ++sequence, mergeObject(target, update) {
    for (const [path, value] of Object.entries(update)) {
      const keys = path.split(".");
      let node = target;
      for (const key of keys.slice(0, -1)) node = node[key] ??= {};
      node[keys.at(-1)] = value;
    }
    return target;
  }}, documents: {async modifyBatch(operations) {
    return operations.map(operation => operation.action === "create"
      ? operation.data.map(data => {
        const item = {...data, id: data._id};
        operation.parent.items.set(item.id, item);
        return item;
      }) : operation.action === "update" ? operation.updates.map(update => {
        const item = operation.parent.items.get(update._id);
        item.system.quantity = update["system.quantity"];
        return item;
      }) : operation.ids.map(id => {
        const item = operation.parent.items.get(id);
        operation.parent.items.delete(id);
        return item;
      }));
  }}};
  const send = (user, action, item, options = {}) => new Promise((resolve, reject) => {
    const id = "request" + ++sequence;
    responses.set(id, {resolve, reject});
    listener({kind: "request", id, user: user.id, token: token.uuid, looter: looter.uuid, action, item, ...options});
  });
  Date.now = () => now;
  Math.random = () => (1000 - 650) / (1800 - 650);
  try {
    installLootService();
    const initial = await send(alice, "open");
    assert.equal(initial.items.length, 2);
    assert.ok(initial.items.every(item => item.hidden && !item.id && !item.name));
    now += 400;
    await send(alice, "pause");
    now += 10000;
    assert.equal((await send(alice, "open")).remaining, 600);
    assert.equal((await send(bob, "open")).remaining, 1000);
    now += 600;
    let result = await send(alice, "step");
    assert.deepEqual(result.items.filter(item => !item.hidden).map(item => item.id), ["a"]);
    result = await send(bob, "step");
    assert.ok(result.items.every(item => item.hidden));
    assert.equal(result.remaining, 400);
    await assert.rejects(send(alice, "take", "c"), /Search this item/);
    looter.x = 500;
    await assert.rejects(send(alice, "refresh"), /next to/);
    looter.x = 0;
    await send(alice, "take", "a");
    assert.equal(npc.items.has("a"), false);
    assert.equal(character.items.size, 1);
    assert.equal([...character.items][0].system.quantity, 3);
    now += 1000;
    result = await send(alice, "step");
    assert.deepEqual(result.items.map(item => item.id), ["c"]);
    assert.equal(result.pending, false);
    assert.equal(npc.items.has("b"), true);
    const pack = makeItem("d", CONTAINER, {flags: {[ID]: {item: {container: {pattern: ["###", "#.#", "###"]}}}}});
    makeItem("e", "gear", {system: {quantity: 3, equipStatus: 1, description: "<p>Inside the pack</p>"},
      flags: {[ID]: {item: {width: 2, height: 1},
        placement: {kind: "grid", container: "d", x: 0, y: 0, rotated: true}}}});
    result = await send(alice, "refresh");
    assert.equal(result.items.length, 2, "Nested contents must appear only inside their container.");
    await assert.rejects(send(bob, "open", undefined, {container: "d"}), /Search the container/);
    now += 1000;
    result = await send(alice, "step");
    assert.equal(result.items.find(item => item.id === "d").container, true);
    result = await send(alice, "open", undefined, {container: "d"});
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].hidden, true);
    assert.deepEqual(result.grid.pattern, ["###", "#.#", "###"]);
    assert.deepEqual(result.items[0].footprint, {x: 0, y: 0, width: 1, height: 2, rotated: true});
    assert.equal(result.items[0].name, undefined);
    assert.equal(result.overall.fraction, 0);
    now += 1000;
    result = await send(alice, "step", undefined, {container: "d"});
    assert.equal(result.items[0].id, "e");
    assert.deepEqual(result.items[0].footprint, {x: 0, y: 0, width: 1, height: 2, rotated: true});
    assert.equal(result.overall.fraction, 1);
    pack.flags[ID].item.container.layout = "list";
    assert.equal((await send(alice, "refresh", undefined, {container: "d"})).grid, null);
    pack.flags[ID].item.container.layout = "grid";
    const detail = await send(alice, "describe", "e", {container: "d"});
    assert.match(detail.description, /Inside the pack/);
    await send(alice, "take", "e", {container: "d", quantity: 1});
    assert.equal(npc.items.get("e").system.quantity, 2);
    assert.equal([...character.items].find(item => item.name === "e").system.quantity, 1);
    assert.equal((await send(alice, "refresh", undefined, {container: "d"})).overall.fraction, 1);
    await assert.rejects(send(alice, "take", "e", {container: "d", quantity: 9}), /stack changed/);
    assert.equal(npc.items.get("e").system.quantity, 2);
    await send(alice, "take", "e", {container: "d", quantity: 2});
    assert.equal(npc.items.has("e"), false);
    assert.equal((await send(alice, "refresh", undefined, {container: "d"})).overall.fraction, 1);
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
    Object.assign(globalThis, saved);
  }
});
