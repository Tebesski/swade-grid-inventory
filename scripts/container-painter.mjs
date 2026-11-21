import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {MAX_GRID_SIZE, cellKey, containerShape, serializeCells, shapeCells, traceCells} from "./container-shape.mjs";

export const containerPainter = `<fieldset class="sgi-container-painter">
  <legend>${sbsI18n("swade-grid-inventory.UI.Storageshape_4121d63f7a")}</legend>
  <div class="sgi-painter-tools" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Paintingtools_bf31aee2f3")}">
    <button type="button" data-paint-mode="paint" aria-pressed="true">${sbsI18n("swade-grid-inventory.UI.Paint_50d0cceb2f")}</button>
    <button type="button" data-paint-mode="erase" aria-pressed="false">${sbsI18n("swade-grid-inventory.UI.Erase_511a2da097")}</button>
    <button type="button" data-paint-mode="rectangle" aria-pressed="false">${sbsI18n("swade-grid-inventory.UI.Rectangle_0306996228")}</button>
    <button type="button" data-paint-clear>${sbsI18n("swade-grid-inventory.UI.Clear_83b12c2216")}</button>
    <output aria-live="polite"></output>
  </div>
  <div class="sgi-painter-viewport" tabindex="0" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.StoragegridDragtopaintcells_ad2a433ce5")}">
    <div class="sgi-painter-canvas"></div>
  </div>
</fieldset>`;

export function bindContainerPainter(root, data) {
  const editor = root.querySelector(".sgi-container-painter");
  const doc = editor.ownerDocument;
  const canvas = editor.querySelector(".sgi-painter-canvas");
  const output = editor.querySelector("output");
  const color = root.querySelector('[name="color"]');
  const cells = new Map();
  let mode = "paint";
  let stroke;
  canvas.style.setProperty("--sgi-painter-size", MAX_GRID_SIZE);

  function setCell({x, y}, enabled) {
    const key = cellKey(x, y);
    const tile = cells.get(key);
    if (enabled && !tile) {
      const cell = doc.createElement("span");
      cell.className = "sgi-painter-cell";
      cell.style.gridArea = `${y + 1} / ${x + 1}`;
      canvas.append(cell);
      cells.set(key, cell);
    } else if (!enabled && tile) {
      tile.remove();
      cells.delete(key);
    }
  }
  function count() {
    output.value = `${cells.size} ${cells.size === 1 ? "cell" : "cells"}`;
  }
  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    const clamp = value => Math.max(0, Math.min(MAX_GRID_SIZE - 1, Math.floor(value * MAX_GRID_SIZE)));
    return {x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height)};
  }
  function rectangle(start, end) {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    return {x, y, width: Math.abs(start.x - end.x) + 1, height: Math.abs(start.y - end.y) + 1};
  }
  function showRectangle(start, end) {
    const {x, y, width, height} = rectangle(start, end);
    stroke.preview.style.gridArea = `${y + 1} / ${x + 1} / span ${height} / span ${width}`;
  }
  function line(start, end) {
    for (const cell of traceCells(start, end)) setCell(cell, mode === "paint");
    count();
  }
  editor.addEventListener("click", event => {
    const tool = event.target.closest("[data-paint-mode]");
    if (tool) {
      mode = tool.dataset.paintMode;
      for (const button of editor.querySelectorAll("[data-paint-mode]")) {
        button.setAttribute("aria-pressed", String(button === tool));
      }
    }
    if (event.target.closest("[data-paint-clear]")) {
      canvas.replaceChildren();
      cells.clear();
      count();
    }
  });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || stroke) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const start = point(event);
    stroke = {id: event.pointerId, start, previous: start};
    if (mode === "rectangle") {
      stroke.preview = doc.createElement("span");
      stroke.preview.className = "sgi-painter-rectangle";
      canvas.append(stroke.preview);
      showRectangle(start, start);
    } else line(start, start);
  });
  canvas.addEventListener("pointermove", event => {
    if (stroke?.id !== event.pointerId) return;
    const next = point(event);
    if (stroke.preview) showRectangle(stroke.start, next);
    else line(stroke.previous, next);
    stroke.previous = next;
  });
  canvas.addEventListener("pointerup", event => {
    if (stroke?.id !== event.pointerId) return;
    const end = point(event);
    if (stroke.preview) {
      const {x, y, width, height} = rectangle(stroke.start, end);
      for (let row = y; row < y + height; row++) {
        for (let column = x; column < x + width; column++) setCell({x: column, y: row}, true);
      }
      count();
    } else line(stroke.previous, end);
  });
  canvas.addEventListener("lostpointercapture", () => {
    stroke?.preview?.remove();
    stroke = null;
  });
  const updateColor = () => editor.style.setProperty("--sgi-painter-color", color.value);
  color.addEventListener("input", updateColor);
  updateColor();
  for (const cell of shapeCells(containerShape(data))) setCell(cell, true);
  count();
  return () => serializeCells(new Set(cells.keys()));
}
