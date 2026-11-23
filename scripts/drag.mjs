import {dimensions, settings, usesExactGridDrop} from "./model.mjs";
import {rotation} from "./actions.mjs";
import {CELL} from "./board.mjs";
import {playSound} from "./sounds.mjs";

const drags = new WeakMap();
const PICKUP_SCALE = 1.16;
const PICKUP_HOLD_MS = 180;
export const DROP_TARGETS = "[data-sgi-slot], [data-sgi-grid], [data-sgi-stow-in], [data-sgi-container-list], [data-sgi-intake], [data-sgi-store], [data-sgi-retrieve]";

export function activePickup(event) {
  const drag = drags.get(event.target.ownerDocument);
  return drag?.transfer === event.dataTransfer ? drag : undefined;
}

export function cellAt(event, surface) {
  const rect = surface.getBoundingClientRect();
  const columns = Number(surface.style.getPropertyValue("--sgi-columns"));
  const rows = Number(surface.style.getPropertyValue("--sgi-rows"));
  const style = surface.ownerDocument.defaultView.getComputedStyle(surface);
  const gap = parseFloat(style.columnGap);
  const padding = parseFloat(style.paddingLeft);
  const offset = padding - gap / 2;
  const index = (point, count, span) => Math.max(0, Math.min(count - 1,
    Math.floor((point - offset) * count / (span - 2 * offset))));
  return {
    x: index(event.clientX - rect.left, columns, rect.width) + Number(surface.dataset.sgiGridLeft ?? 0),
    y: index(event.clientY - rect.top, rows, rect.height) + Number(surface.dataset.sgiGridTop ?? 0)
  };
}

export function installPickup(layout, getItem, state, actor) {
  const doc = layout.ownerDocument;
  const win = doc.defaultView;
  let cancel;
  layout.addEventListener("pointerdown", event => {
    if (event.shiftKey) return;
    const tile = event.target.closest("[data-sgi-draggable]");
    if (!tile || tile.matches(".sgi-dragging, .sgi-moving") || event.button !== 0 || !event.isPrimary || drags.has(doc)) return;
    const item = getItem(tile);
    if (!item) return;
    cancel?.();
    const controller = new AbortController();
    const {signal} = controller;
    const start = {x: event.clientX, y: event.clientY};
    const pointerId = event.pointerId;
    const grid = tile.closest("[data-sgi-grid]");
    const origin = state.placements.get(item.id);
    const cell = grid ? cellAt(event, grid) : null;
    const offset = cell && origin ? {x: cell.x - origin.x, y: cell.y - origin.y} : {x: 0, y: 0};
    const pickup = {item, actor, layout, tile, offset, rotated: rotation(state, item), exactGridDrop: usesExactGridDrop(state, item)};
    const art = tile.querySelector(".sgi-item-art");
    const artBounds = art.getBoundingClientRect();
    const turned = pickup.rotated;
    const fromSlot = origin?.kind === "slot";
    const [columns, rows] = dimensions(item);
    const artWidth = (fromSlot ? columns * CELL : turned ? artBounds.height : artBounds.width) * PICKUP_SCALE;
    const artHeight = (fromSlot ? rows * CELL : turned ? artBounds.width : artBounds.height) * PICKUP_SCALE;
    const grabX = ((start.x - artBounds.left) / artBounds.width - 0.5) * (turned ? artHeight : artWidth);
    const grabY = ((start.y - artBounds.top) / artBounds.height - 0.5) * (turned ? artWidth : artHeight);
    let ghost;
    let dragging = false;
    let pointer = event;
    let lastTarget;
    let lastTurn = -Infinity;
    let frame = null;
    let moved = false;

    const send = (type, target, relatedTarget) => target?.dispatchEvent(new win.DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: pickup.transfer, relatedTarget,
      clientX: pointer.clientX, clientY: pointer.clientY
    }));
    function paint() {
      if (!ghost) return;
      const [x, y] = pickup.rotated === turned ? [grabX, grabY]
        : pickup.rotated ? [-grabY, grabX] : [grabY, -grabX];
      ghost.style.translate = `${pointer.clientX - x - artWidth / 2}px ${pointer.clientY - y - artHeight / 2}px`;
      ghost.classList.toggle("sgi-rotated", pickup.rotated);
    }
    function updateTarget(target) {
      if (target !== lastTarget) {
        send("dragleave", lastTarget, target);
        send("dragenter", target, lastTarget);
        lastTarget = target;
      }
      send("dragover", target);
    }
    function autoScroll(target) {
      const viewport = target?.closest(".sgi-board-viewport, .sgi-container-interior .sgi-container-list");
      const tab = target?.closest(".sgi-inventory-tab");
      const speed = (value, low, high) => {
        const edge = 25;
        if (value >= low && value - low < edge) return -Math.ceil((edge - (value - low)) / 3);
        if (value <= high && high - value < edge) return Math.ceil((edge - (high - value)) / 3);
        return 0;
      };
      let scrolled = false;
      if (viewport && (viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight)) {
        const rect = viewport.getBoundingClientRect();
        const {scrollLeft, scrollTop} = viewport;
        const dx = speed(pointer.clientX, rect.left, rect.right);
        const dy = speed(pointer.clientY, rect.top, rect.bottom);
        if (dx) viewport.scrollLeft += dx;
        if (dy) viewport.scrollTop += dy;
        scrolled ||= scrollLeft !== viewport.scrollLeft || scrollTop !== viewport.scrollTop;
      }
      if (tab && tab.scrollHeight > tab.clientHeight) {
        const rect = tab.getBoundingClientRect();
        const before = tab.scrollTop;
        const dy = speed(pointer.clientY, rect.top, rect.bottom);
        if (dy) tab.scrollTop += dy;
        scrolled ||= before !== tab.scrollTop;
      }
      return scrolled;
    }
    function updateFrame() {
      frame = null;
      let target = doc.elementFromPoint(pointer.clientX, pointer.clientY);
      const scrolled = autoScroll(target);
      if (scrolled) target = doc.elementFromPoint(pointer.clientX, pointer.clientY);
      if (moved) paint();
      if (moved || scrolled || target !== lastTarget) updateTarget(target);
      moved = false;
      if (scrolled) frame = win.requestAnimationFrame(updateFrame);
    }
    function requestPaint() {
      moved = true;
      frame ??= win.requestAnimationFrame(updateFrame);
    }
    function grab() {
      if (ghost || !tile.isConnected) return;
      win.clearTimeout(hold);
      ghost = doc.createElement("div");
      ghost.className = "sgi-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.width = `${artWidth}px`;
      ghost.style.height = `${artHeight}px`;
      const preview = art.cloneNode();
      if (fromSlot && settings(item).fillImage) preview.classList.add("sgi-fill-image");
      ghost.append(preview);
      doc.body.append(ghost);
      drags.set(doc, pickup);
      doc.documentElement.classList.add("sgi-pointer-grab");
      tile.classList.add("sgi-dragging");
      game.tooltip.deactivate();
      void playSound(item, "drag");
      paint();
    }
    function begin() {
      if (dragging) return;
      grab();
      if (!ghost) return;
      dragging = true;
      pickup.transfer = new win.DataTransfer();
      pickup.transfer.effectAllowed = "copyMove";
      pickup.transfer.setData("text/plain", JSON.stringify(item.toDragData()));
      requestPaint();
    }
    function finish(drop = false) {
      controller.abort();
      cancel = null;
      win.clearTimeout(hold);
      if (!ghost) return;
      if (frame !== null) win.cancelAnimationFrame(frame);
      doc.documentElement.classList.remove("sgi-pointer-grab");
      if (dragging && drop) {
        const destination = doc.elementFromPoint(pointer.clientX, pointer.clientY);
        if (destination?.closest(".sgi-layout")) {
          if (destination.closest(DROP_TARGETS)) send("sgi-inventory-drop", destination);
        } else if (destination && !layout.closest(".application")?.contains(destination)) {
          send("drop", destination);
        }
      }
      send("dragleave", lastTarget);
      drags.delete(doc);
      ghost.remove();
      tile.classList.remove("sgi-dragging");
      if (drop) {
        const click = event => {
          event.preventDefault();
          event.stopImmediatePropagation();
        };
        doc.addEventListener("click", click, {capture: true, once: true});
        win.setTimeout(() => doc.removeEventListener("click", click, true), 0);
      }
    }
    cancel = () => finish();
    const hold = win.setTimeout(grab, PICKUP_HOLD_MS);
    doc.addEventListener("pointermove", event => {
      if (event.pointerId !== pointerId) return;
      pointer = event;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) begin();
      if (dragging) {
        event.preventDefault();
        requestPaint();
      }
    }, {capture: true, signal});
    doc.addEventListener("wheel", event => {
      if (!event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.timeStamp - lastTurn < 110) return;
      lastTurn = event.timeStamp;
      begin();
      const [width, height] = dimensions(item, pickup.rotated);
      const {x, y} = pickup.offset;
      pickup.offset = pickup.rotated ? {x: y, y: width - 1 - x} : {x: height - 1 - y, y: x};
      pickup.rotated = !pickup.rotated;
      if (dragging) requestPaint();
    }, {capture: true, passive: false, signal});
    doc.addEventListener("pointerup", event => {
      if (event.pointerId !== pointerId || event.button !== 0) return;
      pointer = event;
      finish(true);
    }, {capture: true, signal});
    doc.addEventListener("pointercancel", cancel, {capture: true, signal});
    win.addEventListener("blur", cancel, {signal});
    doc.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (ghost) {
        event.preventDefault();
        event.stopPropagation();
      }
      finish();
    }, {capture: true, signal});
  });
  return () => cancel?.();
}
