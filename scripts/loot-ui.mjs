import {ID} from "./model.mjs";
import {warn} from "./actions.mjs";
import {node, renderGridSurface} from "./view.mjs";
import {CELL} from "./board.mjs";
import {displayedShape} from "./container-shape.mjs";
import {playFileSound} from "./sounds.mjs";
import {adjacentTokens, isLootToken} from "./loot-model.mjs";
import {installLootService, lootRequest, onLootChanged} from "./loot-service.mjs";

const windows = new Map();
const {ApplicationV2, DialogV2} = foundry.applications.api;

function queueRefresh(app) {
  clearTimeout(app.refreshTimer);
  app.refreshTimer = setTimeout(() => {
    if (app.closed) return;
    if (app.busy) {
      app.refreshQueued = true;
      return;
    }
    void app.refresh().catch(error => app.fail(error));
  }, 100);
}

export async function chooseLootQuantity(item) {
  if (!(item.quantity > 1)) return 1;
  const maximum = Math.floor(item.quantity);
  const initial = Math.ceil(maximum / 2);
  const amount = await DialogV2.wait({
    classes: ["sbs-standard-swade-sheet"], window: {title: `Take ${item.name}`}, position: {width: 320},
    content: `<div class="sgi-loot-amount"><input type="range" name="slider" aria-label="Quantity" min="1" max="${maximum}" step="1" value="${initial}"><input type="number" name="amount" aria-label="Quantity to take" min="1" max="${maximum}" step="1" value="${initial}" required></div>`,
    render: (_event, dialog) => {
      const slider = dialog.element.querySelector('[name="slider"]');
      const input = dialog.element.querySelector('[name="amount"]');
      slider.addEventListener("input", () => { input.value = slider.value; });
      input.addEventListener("input", () => { if (input.validity.valid) slider.value = input.value; });
    },
    buttons: [
      {action: "take", label: "Take", default: true, callback: (_event, button) =>
        button.form.reportValidity() ? button.form.elements.amount.valueAsNumber : null},
      {action: "cancel", label: "Cancel", callback: () => null}
    ], rejectClose: false
  });
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= maximum ? amount : null;
}

export function playerLooter(token) {
  return canvas.tokens.controlled.find(object => object.actor?.type === "character"
    && object.actor.isOwner && adjacentTokens(object.document, token))?.document
    ?? canvas.tokens.placeables.find(object => object.actor?.id === game.user.character?.id
      && object.actor?.isOwner && adjacentTokens(object.document, token))?.document;
}

class LootWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["swade", "sgi-loot-window", "sbs-standard-swade-sheet"],
    position: {width: 350, height: "auto"},
    window: {resizable: false, minimizable: false}
  };

  constructor(token, looter, container) {
    super({window: {title: container?.name ?? token.name}});
    this.token = token;
    this.looter = looter;
    this.container = container?.id ?? null;
    this.closed = false;
    this.busy = false;
    this.revealed = new Set();
  }

  async open() {
    this.data = await this.request("open");
    this.revealed = new Set(this.data.items.filter(item => !item.hidden).map(item => item.id));
    if (this.closed) return;
    await this.render({force: true});
    void playFileSound(this.data.sounds.open);
    this.schedule();
  }

  request(action, item, options = {}) {
    return lootRequest(action, this.token, this.looter, item, {container: this.container, ...options});
  }

  async _renderHTML() {
    const doc = document;
    this.revealSounds = this.data.items.filter(item => !item.hidden && !this.revealed.has(item.id) && item.revealSound)
      .map(item => item.revealSound);
    const body = node(doc, "section", "sgi-loot-body");
    if (this.data.pending) {
      const status = node(doc, "p", "sgi-loot-status", "Looting...");
      status.setAttribute("role", "status");
      body.append(status);
      const progress = node(doc, "div", "sgi-loot-progress");
      const overall = this.data.overall;
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-label", "Overall loot search");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(Math.round(overall.fraction * 100)));
      progress.style.setProperty("--sgi-search-start", String(overall.fraction));
      progress.style.setProperty("--sgi-search-end", String(overall.next));
      progress.style.setProperty("--sgi-search-time", `${this.data.pending ? this.data.remaining : 0}ms`);
      progress.append(node(doc, "span"));
      body.append(progress);
    }
    if (this.data.grid) body.append(this.renderLootGrid(doc));
    const listed = this.data.grid ? this.data.items.filter(item => !item.footprint) : this.data.items;
    if (listed.length || !this.data.items.length) body.append(this.renderRows(doc, listed));
    this.revealed = new Set(this.data.items.filter(item => !item.hidden).map(item => item.id));
    return body;
  }

  hiddenItem(doc, item, tag = "li") {
    const element = node(doc, tag, "sgi-loot-hidden");
    if (item.searching) element.classList.add("sgi-loot-searching");
    element.setAttribute("aria-label", item.searching ? "Searching for an item" : "Unsearched item");
    return element;
  }

  openControl(doc, item, grid = false) {
    const open = node(doc, "button", grid ? "sgi-loot-grid-open" : "sgi-loot-open");
    open.type = "button";
    open.setAttribute("aria-label", `Open ${item.name}`);
    open.dataset.tooltipText = item.name;
    const image = node(doc, "img", grid ? "sgi-item-art" : "");
    image.src = item.img || "icons/svg/item-bag.svg";
    image.alt = "";
    image.draggable = false;
    if (grid && item.fillImage) image.classList.add("sgi-fill-image");
    open.append(image);
    if (!grid) open.append(node(doc, "span", "sgi-loot-name", item.name));
    open.addEventListener("click", () => void this.inspect(item).catch(warn));
    return open;
  }

  takeControl(doc, item) {
    const take = node(doc, "button", "icon fa-solid fa-hand sgi-loot-take");
    take.type = "button";
    take.setAttribute("aria-label", `Take ${item.name}`);
    take.dataset.tooltipText = "Take item";
    take.disabled = !this.looter;
    take.addEventListener("click", () => void this.take(item).catch(warn));
    return take;
  }

  renderLootGrid(doc) {
    const viewport = node(doc, "div", "sgi-board-viewport sgi-loot-grid-viewport");
    const board = node(doc, "div", "sgi-board");
    board.style.setProperty("--sgi-cell", `${CELL}px`);
    const grid = {...this.data.grid, item: {id: this.container, name: this.data.name}};
    const region = displayedShape(grid);
    const surface = renderGridSurface(doc, grid);
    surface.style.gridArea = `1 / 1 / span ${region.height} / span ${region.width}`;
    for (const item of this.data.items) {
      if (!item.footprint) continue;
      const {x, y, width, height, rotated} = item.footprint;
      const tile = item.hidden ? this.hiddenItem(doc, item, "div") : node(doc, "div");
      tile.classList.add("sgi-item", "sgi-item-grid", "sgi-loot-grid-item");
      tile.style.gridArea = `${y - region.y + 1} / ${x - region.x + 1} / span ${height} / span ${width}`;
      if (!item.hidden) {
        tile.classList.toggle("sgi-rotated", rotated);
        if (!this.revealed.has(item.id)) tile.classList.add("sgi-loot-row-new");
        tile.append(this.openControl(doc, item, true), this.takeControl(doc, item));
        if (item.quantity > 1) tile.append(node(doc, "span", "sgi-qty", `×${item.quantity}`));
      }
      surface.append(tile);
    }
    board.append(surface);
    viewport.append(board);
    return viewport;
  }

  renderRows(doc, items) {
    const rows = node(doc, "ol", "sgi-loot-rows");
    for (const item of items) {
      if (item.hidden) {
        rows.append(this.hiddenItem(doc, item));
        continue;
      }
      const row = node(doc, "li", "sgi-loot-row");
      if (!this.revealed.has(item.id)) row.classList.add("sgi-loot-row-new");
      row.append(this.openControl(doc, item));
      row.append(node(doc, "span", "sgi-loot-quantity", `×${item.quantity}`), this.takeControl(doc, item));
      rows.append(row);
    }
    if (!this.data.items.length) {
      rows.append(node(doc, "li", "hint", "No loot remaining."));
    }
    return rows;
  }

  _replaceHTML(result, content) {
    const positions = [".sgi-loot-rows", ".sgi-loot-grid-viewport"].map(selector => {
      const element = content.querySelector(selector);
      return {selector, left: element?.scrollLeft ?? 0, top: element?.scrollTop ?? 0};
    });
    content.replaceChildren(result);
    for (const {selector, left, top} of positions) {
      const element = content.querySelector(selector);
      if (element) {
        element.scrollLeft = left;
        element.scrollTop = top;
      }
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const path of this.revealSounds ?? []) void playFileSound(path);
    this.revealSounds = [];
    if (game.user.isGM && !this.element.querySelector(".sgi-loot-actor")) {
      const header = this.element.querySelector(".window-header");
      const button = node(this.element.ownerDocument, "button", "header-control icon fa-solid fa-user sgi-loot-actor");
      button.type = "button";
      button.setAttribute("aria-label", "Open NPC sheet");
      button.dataset.tooltipText = "Open NPC sheet";
      button.addEventListener("click", () => void this.token.actor.sheet.render({force: true}));
      header?.querySelector('[data-action="close"]')?.before(button);
    }
  }

  _updatePosition(position) {
    const result = super._updatePosition(position);
    const object = this.token?.object;
    if (!this.element?.isConnected || !object) return result;
    const bounds = object.getBounds();
    const view = canvas.app.view.getBoundingClientRect();
    const width = Number(result.width) || this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const right = view.left + bounds.x + bounds.width + 8;
    const left = right + width <= window.innerWidth ? right : view.left + bounds.x - width - 8;
    return {...result, left: Math.max(4, Math.min(left, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(view.top + bounds.y, window.innerHeight - height - 4))};
  }

  anchor() {
    if (this.rendered && this.element?.isConnected) this.setPosition({});
  }

  bringToFront() {
    if (this.element?.isConnected && !this.closed) return super.bringToFront();
  }

  async inspect(item) {
    if (item.container) return openLoot(this.token, item, this.looter);
    const detail = await this.request("describe", item.id);
    await DialogV2.wait({
      classes: ["sbs-standard-swade-sheet"], window: {title: detail.name}, position: {width: 380},
      content: detail.description || "<p>No description.</p>",
      buttons: [{action: "close", label: "Close"}], rejectClose: false
    });
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.closed) return;
    if (this.refreshQueued) {
      this.refreshQueued = false;
      queueRefresh(this);
    }
    if (!this.data.pending) {
      this.stopLoop();
      return;
    }
    if (!this.loopPromise) this.loopPromise = playFileSound(this.data.sounds.search, true).then(sound => {
      if (this.closed || !this.data.pending) void sound?.stop();
      return sound;
    });
    this.timer = setTimeout(() => void this.step().catch(error => this.fail(error)), Math.max(10, this.data.remaining));
  }

  stopLoop() {
    void this.loopPromise?.then(sound => sound?.stop());
    this.loopPromise = null;
  }

  async step() {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      this.data = await this.request("step");
      if (!this.closed) await this.render();
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  async take(item) {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      const quantity = await chooseLootQuantity(item);
      if (quantity == null) return;
      this.data = await this.request("take", item.id, {quantity});
      if (!this.closed) await this.render();
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  async refresh() {
    if (this.closed || this.busy) return;
    this.busy = true;
    clearTimeout(this.timer);
    try {
      this.data = await this.request("refresh");
      if (!this.closed) await this.render();
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  fail(error) {
    warn(error);
    void this.close();
  }

  _onClose(options) {
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.refreshTimer);
    this.stopLoop();
    windows.delete(`${this.token.uuid}:${this.container ?? ""}`);
    void this.request("pause").catch(() => {});
    void playFileSound(this.data?.sounds.close);
    return super._onClose(options);
  }
}

export async function openLoot(token, container = null, character = null) {
  const key = `${token.uuid}:${container?.id ?? ""}`;
  const existing = windows.get(key);
  if (existing) {
    existing.bringToFront();
    return;
  }
  const looter = character ?? playerLooter(token);
  if (!game.user.isGM && !looter) throw new Error("Move your character next to the loot token to search it.");
  const app = new LootWindow(token, looter, container);
  windows.set(key, app);
  try {
    await app.open();
  } catch (error) {
    windows.delete(key);
    throw error;
  }
}

export async function editTokenInventory(token) {
  if (!game.user.isGM || (token.actor?.type ?? token.type) !== "npc") return;
  const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
  const sounds = token.flags?.[ID]?.loot?.sounds ?? {};
  const fields = [["open", "Open loot"], ["close", "Close loot"], ["search", "Looting loop"]];
  const result = await DialogV2.wait({
    classes: ["sbs-standard-swade-sheet"],
    window: {title: `${token.name} — Inventory settings`}, position: {width: 400},
    content: fields.map(([key, label]) => `<div class="form-group"><label>${label}</label><div class="form-fields"><file-picker name="${key}" type="audio" value="${escape(sounds[key])}"></file-picker></div></div>`).join(""),
    buttons: [{action: "save", label: "Save", default: true, callback: (event, button) =>
      Object.fromEntries(fields.map(([key]) => [key, button.form.querySelector(`file-picker[name="${key}"]`).value.trim()]))}],
    rejectClose: false
  });
  if (result && typeof result === "object") await token.setFlag(ID, "loot.sounds", result);
}

export function renderLootHUD(app, root) {
  const token = app.document ?? app.object?.document;
  if (!game.user.isGM || token?.actor?.type !== "npc") return;
  root.querySelectorAll(".sgi-loot-control").forEach(element => element.remove());
  const config = root.querySelector('[data-action="config"]');
  if (!config) return;
  const toggle = node(root.ownerDocument, "button", "control-icon sgi-loot-control");
  toggle.type = "button";
  toggle.classList.toggle("active", isLootToken(token));
  toggle.setAttribute("aria-pressed", String(isLootToken(token)));
  toggle.dataset.tooltipText = "Loot mode";
  toggle.setAttribute("aria-label", "Loot mode");
  toggle.append(node(root.ownerDocument, "i", "fa-solid fa-box-open"));
  toggle.addEventListener("click", event => {
    event.stopPropagation();
    toggle.disabled = true;
    void token.setFlag(ID, "loot.enabled", !isLootToken(token)).then(() => {
      toggle.classList.toggle("active", isLootToken(token));
      toggle.setAttribute("aria-pressed", String(isLootToken(token)));
    }).catch(warn).finally(() => { toggle.disabled = false; });
  });
  config.after(toggle);
}

export function installLoot() {
  installLootService();
  const prototype = CONFIG.Token.objectClass.prototype;
  const canView = prototype._canView;
  const doubleClick = prototype._onClickLeft2;
  prototype._canView = function (...args) {
    return (isLootToken(this.document) && this.layer.active && !canvas.regions?._placementContext
      && !this.layer._draggedToken && !canvas.controls.ruler.active) || canView.apply(this, args);
  };
  prototype._onClickLeft2 = function (event) {
    if (!isLootToken(this.document)) return doubleClick.call(this, event);
    event.stopPropagation();
    void openLoot(this.document).catch(warn);
  };
  for (const object of canvas.tokens?.placeables ?? []) {
    const manager = object.mouseInteractionManager;
    if (!manager) continue;
    manager.permissions.clickLeft2 = prototype._canView;
    manager.callbacks.clickLeft2 = prototype._onClickLeft2;
  }
  Hooks.on("renderTokenHUD", renderLootHUD);
  const reposition = () => { for (const app of windows.values()) app.anchor(); };
  Hooks.on("canvasPan", reposition);
  const validate = () => {
    for (const app of windows.values()) {
      if (!isLootToken(app.token) || (!game.user.isGM && (app.token.hidden || !adjacentTokens(app.looter, app.token)))) void app.close();
      else app.anchor();
    }
  };
  Hooks.on("updateToken", validate);
  Hooks.on("refreshToken", validate);
  Hooks.on("deleteToken", token => {
    for (const app of windows.values()) if (app.token.uuid === token.uuid) void app.close();
  });
  Hooks.on("canvasTearDown", () => { for (const app of windows.values()) void app.close(); });
  onLootChanged(uuid => {
    for (const app of windows.values()) {
      if (app.token.uuid === uuid || app.data?.actor === uuid) queueRefresh(app);
    }
  });
  for (const event of ["createItem", "updateItem", "deleteItem"]) Hooks.on(event, item => {
    for (const app of windows.values()) {
      if (app.data?.actor !== item.actor?.uuid) continue;
      queueRefresh(app);
    }
  });
}

