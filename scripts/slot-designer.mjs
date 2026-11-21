import {t as sbsI18n} from "./i18n.mjs";
import {SLOT_COLUMNS, SLOT_ROWS, firstSlotPosition, placeLayoutEntry, slotOrder, slotPosition} from "./slot-layout.mjs";

const DRAG_TYPE = "application/x-sgi-layout";

export function layoutAttributes(entry) {
  return `data-sgi-row="${Number(entry.row) || ""}" data-sgi-column="${Number(entry.column) || ""}"
    data-sgi-order="${entry.groupOrder == null ? "" : Number(entry.groupOrder)}"`;
}

function groupRow(container, group) {
  const doc = container.ownerDocument;
  const row = doc.createElement("div");
  row.className = "sgi-designer-group-row";
  row.dataset.sgiGroupKey = group.id;
  row.dataset.sgiRow = group.row ?? "";
  row.dataset.sgiColumn = group.column ?? "";
  const label = doc.createElement("input");
  label.type = "text";
  label.required = true;
  label.value = group.label;
  label.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Groupname_762ebb70ef"));
  const remove = doc.createElement("button");
  remove.type = "button";
  remove.className = "icon fa-solid fa-xmark";
  remove.dataset.removeGroup = "";
  remove.setAttribute("aria-label", sbsI18n("swade-grid-inventory.UI.Removeslotgroup_90d83dc121"));
  row.append(label, remove);
  container.append(row);
  return label;
}

export function readLayout(row) {
  return {
    row: Number(row.dataset.sgiRow) || null,
    column: Number(row.dataset.sgiColumn) || null,
    group: row.dataset.sgiGroup || null,
    groupOrder: row.dataset.sgiOrder ? Number(row.dataset.sgiOrder) : null
  };
}

export function collectSlotGroups(form) {
  return [...form.querySelectorAll("[data-sgi-group-key]")].map(row => {
    const label = row.querySelector("input").value.trim();
    if (!label) throw new Error(sbsI18n("swade-grid-inventory.UI.Giveeachslotgroupaname_ed83dd9fce"));
    const {row: y, column} = readLayout(row);
    return {id: row.dataset.sgiGroupKey, label, row: y, column};
  });
}

export function bindSlotDesigner(root, initialGroups) {
  const doc = root.ownerDocument;
  const designer = root.querySelector(".sgi-slot-designer");
  const board = designer.querySelector(".sgi-designer-board");
  const art = board.firstElementChild;
  const unpositioned = designer.querySelector(".sgi-designer-unpositioned");
  const groups = root.querySelector(".sgi-designer-group-list");
  let dragged;

  function entries() {
    const slots = [...root.querySelectorAll("[data-sgi-slot-key]")].map(row => ({
      kind: "slot", key: row.dataset.sgiSlotKey, element: row,
      label: row.querySelector(".slot-label").value || row.querySelector(".slot-id").value || sbsI18n("swade-grid-inventory.UI.Newslot_985d66b956"),
      icon: row.querySelector(".sgi-slot-icon-picker").firstElementChild,
      ...readLayout(row)
    }));
    const definitions = [...groups.children].map(row => ({
      kind: "group", key: row.dataset.sgiGroupKey, element: row,
      label: row.querySelector("input").value || sbsI18n("swade-grid-inventory.UI.Newgroup_df796c655f"), ...readLayout(row)
    }));
    return [...slots, ...definitions];
  }

  function token(entry) {
    const part = doc.createElement("div");
    part.className = "sgi-designer-token";
    part.dataset.sgiToken = entry.key;
    part.dataset.sgiKind = entry.kind;
    part.draggable = true;
    part.title = entry.label;
    if (entry.icon) {
      const icon = entry.icon.cloneNode(true);
      icon.draggable = false;
      part.append(icon);
    }
    const name = doc.createElement("span");
    name.textContent = entry.label;
    part.append(name);
    return part;
  }

  function draw() {
    const all = entries();
    const top = all.filter(entry => !entry.group);
    const cells = new Map(top.filter(slotPosition).map(entry => [`${entry.row}:${entry.column}`, entry]));
    const rows = Math.max(SLOT_ROWS - 1, ...top.map(entry => entry.row ?? 0)) + 1;
    const surface = doc.createDocumentFragment();
    unpositioned.replaceChildren();
    for (let row = 1; row <= rows; row++) {
      for (let column = 1; column <= SLOT_COLUMNS; column++) {
        const cell = doc.createElement("div");
        cell.className = "sgi-designer-cell";
        cell.dataset.sgiDesignerRow = row;
        cell.dataset.sgiDesignerColumn = column;
        const entry = cells.get(`${row}:${column}`);
        if (entry) cell.append(tile(entry));
        surface.append(cell);
      }
    }
    for (const entry of top.filter(entry => !slotPosition(entry))) unpositioned.append(tile(entry));
    board.replaceChildren(art, surface);

    function tile(entry) {
      if (entry.kind === "slot") return token(entry);
      const group = doc.createElement("div");
      group.className = "sgi-designer-group";
      group.dataset.sgiGroupDrop = entry.key;
      group.append(token(entry));
      const members = doc.createElement("div");
      members.className = "sgi-designer-members";
      for (const member of all.filter(slot => slot.group === entry.key).sort(slotOrder)) members.append(token(member));
      if (!members.children.length) {
        const hint = doc.createElement("span");
        hint.className = "sgi-designer-group-hint";
        hint.textContent = sbsI18n("swade-grid-inventory.UI.Dropslotshere_17e3bd5341");
        members.append(hint);
      }
      group.append(members);
      return group;
    }
  }

  function dropTarget(event) {
    if (!dragged) return null;
    const group = event.target.closest("[data-sgi-group-drop]");
    if (group && dragged.kind === "slot") return group;
    return event.target.closest(".sgi-designer-cell, .sgi-designer-unpositioned");
  }
  designer.addEventListener("dragstart", event => {
    const tile = event.target.closest("[data-sgi-token]");
    if (!tile) return;
    dragged = {key: tile.dataset.sgiToken, kind: tile.dataset.sgiKind};
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, dragged.key);
  });
  designer.addEventListener("dragover", event => {
    const target = dropTarget(event);
    if (!target || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    designer.querySelector(".sgi-designer-target")?.classList.remove("sgi-designer-target");
    target.classList.add("sgi-designer-target");
  });
  designer.addEventListener("dragleave", event => {
    const target = dropTarget(event);
    if (target && !target.contains(event.relatedTarget)) target.classList.remove("sgi-designer-target");
  });
  designer.addEventListener("dragend", () => {
    dragged = null;
    designer.querySelector(".sgi-designer-target")?.classList.remove("sgi-designer-target");
  });
  designer.addEventListener("drop", event => {
    const target = dropTarget(event);
    if (!target || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    const all = entries();
    const source = all.find(entry => entry.key === dragged.key && entry.kind === dragged.kind);
    if (source) {
      const before = event.target.closest('[data-sgi-kind="slot"]')?.dataset.sgiToken;
      const destination = target.dataset.sgiGroupDrop ? {group: target.dataset.sgiGroupDrop, before}
        : target.dataset.sgiDesignerRow
          ? {row: Number(target.dataset.sgiDesignerRow), column: Number(target.dataset.sgiDesignerColumn)} : null;
      placeLayoutEntry(all, source, destination);
      for (const entry of all) Object.assign(entry.element.dataset, {
        sgiRow: entry.row ?? "", sgiColumn: entry.column ?? "",
        sgiGroup: entry.group ?? "", sgiOrder: entry.groupOrder ?? ""
      });
    }
    dragged = null;
    draw();
  });

  const reset = definitions => {
    groups.replaceChildren();
    for (const group of definitions) groupRow(groups, group);
    draw();
  };
  groups.addEventListener("input", draw);
  groups.addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-group]");
    if (!remove) return;
    const row = remove.closest("[data-sgi-group-key]");
    for (const slot of entries().filter(entry => entry.group === row.dataset.sgiGroupKey)) {
      slot.element.dataset.sgiGroup = "";
      slot.element.dataset.sgiOrder = "";
    }
    row.remove();
    draw();
  });
  root.querySelector(".sgi-add-group").addEventListener("click", () => {
    const input = groupRow(groups, {id: foundry.utils.randomID(), label: sbsI18n("swade-grid-inventory.UI.Newgroup_df796c655f"), ...firstSlotPosition(entries())});
    draw();
    input.focus();
    input.select();
  });
  reset(initialGroups);
  return {draw, reset};
}
