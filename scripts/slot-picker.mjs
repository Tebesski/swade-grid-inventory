import {t as sbsI18n} from "./i18n.mjs";
import {matchesInventoryQuery} from "./model.mjs";
import {warn} from "./actions.mjs";

export function openSlotPicker(anchor, label, items, choose, trigger = anchor) {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView;
  const controller = new AbortController();
  const {signal} = controller;
  const panel = doc.createElement("section");
  panel.className = "sgi-slot-picker";
  panel.popover = "manual";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", label);
  const search = doc.createElement("input");
  search.type = "search";
  search.placeholder = sbsI18n("swade-grid-inventory.UI.Search_7336265a04");
  search.autocomplete = "off";
  search.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Searchcompatibleitems_d08b25184c"));
  const grid = doc.createElement("div");
  grid.className = "sgi-slot-picker-grid";
  const empty = doc.createElement("p");
  empty.className = "hint";
  panel.append(search, grid, empty);

  const tiles = items.map(item => {
    const tile = doc.createElement("button");
    tile.type = "button";
    tile.setAttribute("aria-label", item.name);
    tile.dataset.tooltipText = item.name;
    const art = doc.createElement("img");
    art.alt = "";
    art.src = item.img;
    art.draggable = false;
    tile.append(art);
    tile.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (!panel.isConnected) return;
      close();
      void choose(item).catch(warn);
    });
    grid.append(tile);
    return [item, tile];
  });
  function position() {
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const right = rect.right + 5;
    const x = right + width < win.innerWidth - 4 ? right : rect.left - width - 5;
    panel.style.left = `${Math.max(4, x)}px`;
    panel.style.top = `${Math.max(4, Math.min(rect.top, win.innerHeight - height - 4))}px`;
  }
  function filter() {
    let count = 0;
    for (const [item, tile] of tiles) {
      tile.hidden = !matchesInventoryQuery(item, search.value);
      if (!tile.hidden) count++;
    }
    grid.hidden = count === 0;
    empty.hidden = count > 0;
    empty.textContent = items.length ? sbsI18n("swade-grid-inventory.UI.Nomatchingitems_7f406b7e22") : sbsI18n("swade-grid-inventory.UI.Nocompatibleitems_99ca89989b");
    grid.style.setProperty("--sgi-picker-rows", Math.max(1, Math.min(3, Math.ceil(count / 5))));
    grid.scrollLeft = 0;
    position();
  }
  function close() {
    controller.abort();
    trigger.setAttribute("aria-expanded", "false");
    panel.remove();
  }
  search.addEventListener("input", filter);
  grid.addEventListener("wheel", event => {
    if (grid.scrollWidth <= grid.clientWidth || !event.deltaY || event.deltaX) return;
    event.preventDefault();
    grid.scrollLeft += event.deltaY;
  }, {passive: false});
  panel.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.target !== search) return;
    event.preventDefault();
    grid.querySelector("button:not([hidden])")?.click();
  });
  doc.addEventListener("pointerdown", event => {
    if (!panel.contains(event.target) && !anchor.closest("[data-sgi-slot]")?.contains(event.target)) close();
  }, {capture: true, signal});
  doc.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
    trigger.focus({preventScroll: true});
  }, {capture: true, signal});
  doc.addEventListener("scroll", position, {capture: true, signal});
  win.addEventListener("resize", position, {signal});
  anchor.closest(".sgi-layout").append(panel);
  trigger.setAttribute("aria-expanded", "true");
  panel.showPopover();
  filter();
  search.focus({preventScroll: true});
  return {anchor, panel, close};
}
