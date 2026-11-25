import { t as sbsI18n, a as sbsI18nAttribute } from "./i18n.mjs"
import {
   BUILTIN_TYPES,
   CONTAINER,
   DEFAULT_SLOTS,
   EVENTS,
   ID,
   MONEY,
   baseSlots,
   gridSize,
   hasInventory,
   settings,
   splitList,
} from "./model.mjs"
import { checkConfiguration, serialize, warn } from "./actions.mjs"
import { bindContainerPainter, containerPainter } from "./container-painter.mjs"
import { containerShape } from "./container-shape.mjs"
import {
   bindSlotDesigner,
   collectSlotGroups,
   layoutAttributes,
   readLayout,
} from "./slot-designer.mjs"

const { ApplicationV2, DialogV2 } = foundry.applications.api
const DOLL = `modules/${ID}/assets/paper-doll.svg`
const eventNames = {
   get drag() {
      return sbsI18n("swade-grid-inventory.UI.Pickup_0ab5431518")
   },
   get equip() {
      return sbsI18n("swade-grid-inventory.UI.Equip_885fd3041d")
   },
   get place() {
      return sbsI18n("swade-grid-inventory.UI.Placeingrid_03b5032728")
   },
   get open() {
      return sbsI18n("swade-grid-inventory.UI.Opencontainer_55f0e5f361")
   },
   get close() {
      return sbsI18n("swade-grid-inventory.UI.Closecontainer_888539af92")
   },
}
const unit = () =>
   game.settings.get("swade", "weightUnit") === "imperial" ? "lb" : "kg"
const escape = (value) => foundry.utils.escapeHTML(String(value ?? ""))
const formData = (button) => new FormData(button.form)
const dollEditors = new WeakMap()

export function paperDoll(actor) {
   const data = actor.flags?.[ID]?.paperDoll ?? {}
   return {
      image: data.image || DOLL,
      x: Number(data.x) || 0,
      y: Number(data.y) || 0,
      scale: Number(data.scale) || 100,
   }
}

export function paintDoll(image, { image: path, x, y, scale }) {
   if (image.getAttribute("src") !== path) image.src = path
   image.classList.toggle("sgi-default-doll", path === DOLL)
   image.style.transform = `translate(${x}%, ${y}%) scale(${scale / 100})`
}

function input(label, name, value, attributes = "") {
   return `<label><span>${label}</span><input name="${name}" value="${escape(value)}" ${attributes}></label>`
}

function file(label, name, type, value, placeholder = "") {
   return `<label><span>${label}</span><file-picker type="${type}" name="${name}" value="${escape(value)}"
    placeholder="${escape(placeholder)}"></file-picker></label>`
}

function soundInputs(sounds = {}, events = EVENTS) {
   return events
      .map((event) =>
         file(
            eventNames[event],
            event,
            "audio",
            sounds[event],
            "sfx/item*.ogg",
         ),
      )
      .join("")
}

function readSounds(root, events = EVENTS) {
   return Object.fromEntries(
      events.map((event) => [
         event,
         root.querySelector(`file-picker[name="${event}"]`).value.trim(),
      ]),
   )
}

function option(value, label) {
   return `<option value="${escape(value)}">${escape(label)}</option>`
}

function typeOptions() {
   const types = [
      ...new Set([
         ...BUILTIN_TYPES,
         ...Object.keys(CONFIG.Item.dataModels),
         "container",
         "money",
      ]),
   ]
   return types.map((type) => option(type, type)).join("")
}

function quantityRuleRow({
   kind = sbsI18n("swade-grid-inventory.UI.type_1303c06b0b"),
   match = "",
   limit = 1,
} = {}) {
   return `<div class="sgi-quantity-rule">
    <select aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Matchby_91d6f6c398")}"><option value="type" ${kind === "type" ? "selected" : ""}>${sbsI18n("swade-grid-inventory.UI.Type_baaddf70fb")}</option><option value="flag" ${kind === "flag" ? "selected" : ""}>${sbsI18n("swade-grid-inventory.UI.Flag_552127973f")}</option></select>
    <input class="sgi-quantity-match" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Typeorflag_06e057501a")}" placeholder="${sbsI18nAttribute("swade-grid-inventory.UI.consumableorpotion_f16e7501aa")}" value="${escape(match)}">
    <input class="sgi-quantity-max" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Maximumquantity_a9d1f8826b")}" type="number" min="1" step="1" value="${escape(limit)}">
    <button type="button" class="icon sgi-remove-quantity-rule" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Removequantitylimit_d8dc66e9d6")}"><i class="fa-solid fa-xmark"></i></button>
  </div>`
}

function slotRow(definition = {}) {
   const {
      id = "",
      label = "",
      types = [],
      icon = sbsI18n("swade-grid-inventory.UI.diamond_81c9d6128b"),
      iconImage = "",
      group = "",
   } = definition
   return `<div class="sgi-setting-row" data-slot-id="${escape(id)}"
    data-sgi-slot-key="${escape(id || foundry.utils.randomID())}" data-sgi-group="${escape(group)}" ${layoutAttributes(definition)}>
    <input class="slot-id" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.SlotID_d9042bb4b3")}" placeholder="${sbsI18nAttribute("swade-grid-inventory.UI.SlotID_d9042bb4b3")}" value="${escape(id)}" ${id ? "readonly" : ""}>
    <input class="slot-label" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Slotlabel_a7e09c7269")}" placeholder="${sbsI18nAttribute("swade-grid-inventory.UI.Displayname_2b7f6a84de")}" value="${escape(label)}" required>
    <input class="slot-types" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Acceptedtypesorflags_0762021399")}" placeholder="${sbsI18nAttribute("swade-grid-inventory.UI.Anyitem_71723b9111")}" value="${escape(types.join(", "))}">
    <input class="slot-icon" type="hidden" value="${escape(iconImage)}">
    <button type="button" class="icon sgi-slot-icon-picker" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Choosesloticon_868bde72af")}" data-tooltip-text="${sbsI18nAttribute("swade-grid-inventory.UI.Choosesloticon_868bde72af")}">
      ${iconImage ? `<img src="${escape(iconImage)}" alt="">` : `<i class="fa-solid fa-${escape(icon)}"></i>`}
    </button>
    <button type="button" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Removeslot_8c09755dcb")}" class="icon sgi-remove"><i class="fa-solid fa-xmark"></i></button>
  </div>`
}

function slotsEditor(definitions, title, help) {
   return `<fieldset class="sgi-slot-settings">
    <legend>${title}</legend>${help ? `<p class="hint">${help}</p>` : ""}
    <div class="sgi-setting-row sgi-row-labels"><span>${sbsI18n("swade-grid-inventory.UI.SlotID_d9042bb4b3")}</span><span>${sbsI18n("swade-grid-inventory.UI.Label_0e66373f45")}</span><span>${sbsI18n("swade-grid-inventory.UI.Acceptedtypesorflags_0762021399")}</span><span>${sbsI18n("swade-grid-inventory.UI.Icon_a35abcd6da")}</span></div>
    <div class="sgi-setting-rows">${definitions.map(slotRow).join("")}</div>
    <button type="button" class="sgi-add"><i class="fa-solid fa-plus"></i> ${sbsI18n("swade-grid-inventory.UI.Addslot_21ac8a985a")}</button>
  </fieldset>`
}

function bindRows(editor, row, redraw = () => {}) {
   editor.addEventListener("input", (event) => {
      if (event.target.matches(".slot-label")) redraw()
   })
   editor.addEventListener("click", (event) => {
      if (event.target.closest(".sgi-remove")) {
         event.target.closest(".sgi-setting-row").remove()
         redraw()
      }
      if (event.target.closest(".sgi-add")) {
         const rows = editor.querySelector(".sgi-setting-rows")
         rows.insertAdjacentHTML("beforeend", row())
         rows.lastElementChild.querySelector("input").focus()
         redraw()
      }
      const icon = event.target.closest(".sgi-slot-icon-picker")
      if (icon) {
         const field = icon
            .closest(".sgi-setting-row")
            .querySelector(".slot-icon")
         void new CONFIG.ux.FilePicker({
            type: "image",
            current: field.value,
            callback: (path) => {
               field.value = path
               const img = icon.ownerDocument.createElement("img")
               img.src = path
               img.alt = ""
               icon.replaceChildren(img)
               redraw()
            },
         }).render({
            force: true,
            window: { windowId: icon.ownerDocument.defaultView.id },
         })
      }
   })
}

function collectSlots(editor, existing = [], saveLayout = false) {
   const known = new Map(
      [...DEFAULT_SLOTS, ...existing].map((slot) => [slot.id, slot]),
   )
   const ids = new Set()
   return [
      ...editor.querySelectorAll(".sgi-setting-rows .sgi-setting-row"),
   ].map((row) => {
      const label = row.querySelector(".slot-label").value.trim()
      const id = (row.querySelector(".slot-id").value.trim() || label)
         .toLowerCase()
         .replace(/[^a-z0-9_-]+/g, "-")
         .replace(/^-+|-+$/g, "")
      const types = splitList(row.querySelector(".slot-types").value)
      const iconImage = row.querySelector(".slot-icon").value
      if (!id || !label)
         throw new Error(
            sbsI18n("swade-grid-inventory.UI.GiveeachslotauniqueID_d006ecc61c"),
         )
      if (ids.has(id))
         throw new Error(
            sbsI18n("swade-grid-inventory.UI.DuplicateslotID_c136f04b07", {
               p0: id,
            }),
         )
      ids.add(id)
      const base = known.get(id)
      return {
         ...base,
         ...(saveLayout ? readLayout(row) : {}),
         id,
         label,
         types,
         iconImage,
      }
   })
}

function editDialog(title, content, { render, save, width = 560 } = {}) {
   return DialogV2.prompt({
      classes: ["sgi-dialog", "sbs-standard-swade-sheet"],
      window: { title, resizable: true },
      position: { width },
      form: { closeOnSubmit: false },
      content: `<div class="sgi-config">${content}</div>`,
      ok: {
         label: sbsI18n("swade-grid-inventory.UI.Save_1509f561f2"),
         callback: async (_event, button, dialog) => {
            try {
               await save(formData(button), button.form)
               await dialog.close({ submitted: true })
            } catch (error) {
               warn(error)
            }
         },
      },
      render: (_event, dialog) => render?.(dialog.element),
   })
}

export function isPaperDollOpen(app) {
   return dollEditors.has(app)
}

export async function editPaperDoll(actor, app, anchor) {
   const open = dollEditors.get(app)
   if (open) return open.close()
   const data = paperDoll(actor)
   const slots = baseSlots(actor)
   const content = `<div class="sgi-config"><div class="sgi-doll-designer">
  <fieldset>
    <legend>${sbsI18n("swade-grid-inventory.UI.Paperdollimage_cdd07c3225")}</legend>
    ${file("Image", "image", "image", data.image)}
    <div class="sgi-image-preview" tabindex="0" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Paperdollpositionandscale_00d7bc558f")}"
      data-tooltip-text="${sbsI18nAttribute("swade-grid-inventory.UI.DragtomoveScrolltoscale_b39d24d223")}"><img alt="${sbsI18nAttribute("swade-grid-inventory.UI.Paperdollpreview_b44d11f765")}" draggable="false"></div>
  </fieldset>
  <fieldset class="sgi-slot-designer">
    <legend>${sbsI18n("swade-grid-inventory.UI.Slotlayout_bbf8c79ab5")}</legend>
    <p class="hint">${sbsI18n("swade-grid-inventory.UI.Dragstandardslotstopositionthem_3e3a3bfb1f")}</p>
    <div class="sgi-designer-board" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Paperdollslotlayout_ecba8f3508")}">
      <div class="sgi-doll-art"><img class="sgi-designer-art" alt="" draggable="false"></div>
    </div>
    <div class="sgi-designer-tray">
      <span>${sbsI18n("swade-grid-inventory.UI.Unpositioned_04c02b2905")}</span>
      <div class="sgi-designer-unpositioned"></div>
    </div>
  </fieldset>
  </div>
  <fieldset class="sgi-designer-groups">
    <legend>${sbsI18n("swade-grid-inventory.UI.Slotgroups_89124e689a")}</legend>
    <div class="sgi-designer-group-list"></div>
    <button type="button" class="sgi-add-group"><i class="fa-solid fa-plus"></i> ${sbsI18n("swade-grid-inventory.UI.Addslotgroup_d4be31fe43")}</button>
  </fieldset>
  ${slotsEditor(slots, sbsI18n("swade-grid-inventory.UI.Equipmentslots_6e79bc0fa3"), sbsI18n("swade-grid-inventory.UI.Separatetypesandflagswithcommas_fcafb11a52"))}
  <button type="button" class="sgi-reset-slots">${sbsI18n("swade-grid-inventory.UI.Restoredefaultslots_f5fe140492")}</button></div>`
   const rect = anchor.getBoundingClientRect()
   const available = anchor.ownerDocument.defaultView.innerWidth
   const width = Math.min(670, available - 16)
   const right = available - rect.right - 10
   const left = rect.left - 10
   const beside = Math.min(width, Math.max(right, left))
   const position =
      beside >= 410
         ? {
              width: beside,
              left: right >= beside ? rect.right + 8 : rect.left - beside - 8,
           }
         : { width }
   const dialog = new DialogV2({
      classes: ["sgi-dialog", "sbs-standard-swade-sheet"],
      window: {
         title: sbsI18n(
            "swade-grid-inventory.UI.ConfigurePaperDoll_f6da9366dd",
         ),
         resizable: true,
      },
      form: { closeOnSubmit: false },
      position,
      content,
      buttons: [
         {
            action: "save",
            label: sbsI18n("swade-grid-inventory.UI.Save_1509f561f2"),
            default: true,
            callback: save,
         },
      ],
   })
   async function save(_event, button) {
      try {
         const { form } = button
         const updated = collectSlots(
            form.querySelector(".sgi-slot-settings"),
            slots,
            true,
         )
         const changes = {
            [`flags.${ID}.slots`]: updated,
            [`flags.${ID}.slotGroups`]: collectSlotGroups(form),
            [`flags.${ID}.paperDoll`]: {
               ...data,
               image:
                  form
                     .querySelector('file-picker[name="image"]')
                     .value.trim() || DOLL,
            },
         }
         await serialize(actor, async () => {
            checkConfiguration(actor, updated)
            await actor.update(changes)
         })
         await dialog.close({ submitted: true })
      } catch (error) {
         warn(error)
      }
   }
   dialog.addEventListener(
      "render",
      () => {
         const root = dialog.element
         const designer = bindSlotDesigner(
            root,
            actor.flags?.[ID]?.slotGroups ?? [],
         )
         dialog.addEventListener("close", bindDollPreview(root, data), {
            once: true,
         })
         const editor = root.querySelector(".sgi-slot-settings")
         bindRows(editor, slotRow, designer.draw)
         root
            .querySelector(".sgi-reset-slots")
            .addEventListener("click", () => {
               editor.querySelector(".sgi-setting-rows").innerHTML =
                  DEFAULT_SLOTS.map(slotRow).join("")
               designer.reset([])
            })
      },
      { once: true },
   )
   const forget = () => {
      if (dollEditors.get(app) === dialog) dollEditors.delete(app)
      app.element
         ?.querySelector(".sgi-configure-doll")
         ?.setAttribute("aria-expanded", "false")
   }
   dialog.addEventListener("close", forget, { once: true })
   dollEditors.set(app, dialog)
   anchor.setAttribute("aria-expanded", "true")
   try {
      await app.renderChild(dialog, { force: true })
   } catch (error) {
      forget()
      throw error
   }
}

function bindDollPreview(root, data) {
   const preview = root.querySelector(".sgi-image-preview")
   const images = [
      preview.firstElementChild,
      root.querySelector(".sgi-designer-art"),
   ]
   const file = root.querySelector('file-picker[name="image"]')
   const refresh = () => {
      for (const image of images)
         paintDoll(image, { ...data, image: file.value?.trim() || DOLL })
   }
   const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
   let start
   const page = root.ownerDocument.documentElement
   const endPan = () => {
      start = null
      page.classList.remove("sgi-doll-panning")
   }
   file.addEventListener("input", refresh)
   file.addEventListener("change", refresh)
   preview.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return
      preview.focus({ preventScroll: true })
      preview.setPointerCapture(event.pointerId)
      start = { x: event.clientX, y: event.clientY, left: data.x, top: data.y }
      page.classList.add("sgi-doll-panning")
      game.tooltip.deactivate()
   })
   preview.addEventListener("pointermove", (event) => {
      if (!start || !preview.hasPointerCapture(event.pointerId)) return
      data.x = clamp(
         start.left + (100 * (event.clientX - start.x)) / preview.clientWidth,
         -100,
         100,
      )
      data.y = clamp(
         start.top + (100 * (event.clientY - start.y)) / preview.clientHeight,
         -100,
         100,
      )
      refresh()
   })
   preview.addEventListener("lostpointercapture", endPan)
   preview.addEventListener(
      "wheel",
      (event) => {
         if (!event.deltaY) return
         event.preventDefault()
         data.scale = clamp(
            data.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
            10,
            400,
         )
         refresh()
      },
      { passive: false },
   )
   preview.addEventListener("keydown", (event) => {
      const offsets = {
         ArrowLeft: [-2, 0],
         ArrowRight: [2, 0],
         ArrowUp: [0, -2],
         ArrowDown: [0, 2],
      }
      if (offsets[event.key]) {
         const [x, y] = offsets[event.key]
         data.x = clamp(data.x + x, -100, 100)
         data.y = clamp(data.y + y, -100, 100)
      } else if (["+", "-", "="].includes(event.key)) {
         data.scale = clamp(
            data.scale + (event.key === "-" ? -10 : 10),
            10,
            400,
         )
      } else return
      event.preventDefault()
      refresh()
   })
   refresh()
   return endPan
}

export function editItem(item) {
   const data = settings(item)
   const container = data.container ?? {}
   const portable = item.type === CONTAINER
   const vault = item.flags?.["swade-better-setting"]?.partyStorageRoot
   const list = portable && container.layout === "list"
   const events = portable ? [...EVENTS, "open", "close"] : EVENTS
   let paintedShape
   const content = `<fieldset>
    <legend>${sbsI18n("swade-grid-inventory.UI.Size_1af8519073")}</legend>
    <div class="sgi-fields-2">
      ${input("Width (cells)", sbsI18n("swade-grid-inventory.UI.width_dec0f004ea"), data.width ?? 1, sbsI18n("swade-grid-inventory.UI.typenumbermin1max50_3b2e8aaaa2"))}
      ${input("Height (cells)", sbsI18n("swade-grid-inventory.UI.height_39e0f5efdc"), data.height ?? 1, sbsI18n("swade-grid-inventory.UI.typenumbermin1max50_3b2e8aaaa2"))}
      ${input(sbsI18n("swade-grid-inventory.UI.Customtype_2e67d6c7a1"), sbsI18n("swade-grid-inventory.UI.customType_b1fe4fe42c"), data.customType, sbsI18n("swade-grid-inventory.UI.placeholderpotion_f52faaf60f"))}
      ${input(sbsI18n("swade-grid-inventory.UI.EquipmentslotIDs_6f762505c6"), sbsI18n("swade-grid-inventory.UI.slot_6558838331"), data.slot, sbsI18n("swade-grid-inventory.UI.listsgislotidsplaceholderbelt_a5a2fb2379"))}
    </div>
    <label class="sgi-check"><input type="checkbox" name="fillImage" ${data.fillImage ? "checked" : ""}> ${sbsI18n("swade-grid-inventory.UI.Fillgridsquareswiththeitem_dc29089674")}</label>
    <datalist id="sgi-slot-ids">${[...new Set([...DEFAULT_SLOTS, ...(item.parent?.type === "character" ? baseSlots(item.parent) : [])].map((slot) => slot.id))].map((id) => option(id, id)).join("")}</datalist>
    ${input(sbsI18n("swade-grid-inventory.UI.Flagtags_15e87cd7fa"), sbsI18n("swade-grid-inventory.UI.tags_978c2f8941"), data.tags?.join(", "), sbsI18n("swade-grid-inventory.UI.placeholderpotionhealing_d0bcdbb393"))}
  </fieldset>
  <fieldset>
    <legend>${sbsI18n("swade-grid-inventory.UI.Container_0c7823e8c7")}</legend>
    ${
       portable
          ? `<label><span>${sbsI18n("swade-grid-inventory.UI.Inventorylayout_e397eb1a67")}</span><select name="layout">
      <option value="grid" ${list ? "" : "selected"}>${sbsI18n("swade-grid-inventory.UI.Grid_0d7d12ac62")}</option>
      <option value="list" ${list ? "selected" : ""}>${sbsI18n("swade-grid-inventory.UI.List_6f202f54a7")}</option>
    </select></label>`
          : `<label class="sgi-check"><input type="checkbox" name="container" ${container.enabled ? "checked" : ""}> ${sbsI18n("swade-grid-inventory.UI.Providesstoragewhileequipped_5f4e44ec09")}</label>`
    }
    <div class="sgi-container-fields" ${portable || container.enabled ? "" : "hidden"}>
      ${
         portable
            ? `<div class="sgi-fields-2">
        ${[
           [
              sbsI18n("swade-grid-inventory.UI.Visibility_7448611d5f"),
              "visibility",
           ],
           [
              sbsI18n("swade-grid-inventory.UI.Accessibility_d3368cbffe"),
              "accessibility",
           ],
        ]
           .map(
              ([label, key]) =>
                 `<label><span>${label}</span><select name="${key}" ${vault ? "disabled" : ""}>
            <option value="public" ${container[key] !== "private" ? "selected" : ""}>${sbsI18n("swade-grid-inventory.UI.Public_591935b15b")}</option>
            <option value="private" ${container[key] === "private" ? "selected" : ""}>${sbsI18n("swade-grid-inventory.UI.Private_c63eb6720c")}</option>
          </select></label>`,
           )
           .join("")}
      </div>${vault ? `<p class="hint">${sbsI18n("swade-grid-inventory.UI.Changevaultaccessintheparty_375cbfbbba")}</p>` : ""}`
            : ""
      }
      <div class="sgi-container-shape" ${list ? "hidden" : ""}>
        ${containerPainter}
      </div>
      <div class="sgi-fields-2">
        <div class="sgi-container-outline" ${list ? "hidden" : ""}>${input("Outline", sbsI18n("swade-grid-inventory.UI.color_74284d9dcb"), container.color ?? "#58a79c", sbsI18n("swade-grid-inventory.UI.typecolor_43ea3922b2"))}</div>
        ${input(`Weight limit (${unit()})`, sbsI18n("swade-grid-inventory.UI.limit_55ea09e571"), container.limit ?? 0, sbsI18n("swade-grid-inventory.UI.typenumbermin0stepany_d3e53eb6de"))}
        ${portable ? input(sbsI18n("swade-grid-inventory.UI.Contentsweight_1a6fa20647"), "factor", (container.factor ?? 1) * 100, sbsI18n("swade-grid-inventory.UI.typenumbermin0max100_3237991a95")) : ""}
      </div>
      <details class="sgi-quantity-limits">
        <summary>${sbsI18n("swade-grid-inventory.UI.Quantitylimits_beae0ad710")}</summary>
        ${input(sbsI18n("swade-grid-inventory.UI.Maximumcombinedquantity_7ded51e7d1"), sbsI18n("swade-grid-inventory.UI.quantityLimit_33dec3c9c1"), container.quantityLimit ?? 0, sbsI18n("swade-grid-inventory.UI.typenumbermin0step1_c0fa527962"))}
        <p class="hint">${sbsI18n("swade-grid-inventory.UI.0meansunlimitedStackquantitiesare_d2437d6d06")}</p>
        <div class="sgi-quantity-rules">${(container.quantityRules ?? []).map(quantityRuleRow).join("")}</div>
        <button type="button" class="sgi-add-quantity-rule"><i class="fa-solid fa-plus"></i> ${sbsI18n("swade-grid-inventory.UI.Addtypeorflaglimit_37e11043a1")}</button>
      </details>
      ${input(sbsI18n("swade-grid-inventory.UI.Acceptedtypes_e4f5b874f9"), sbsI18n("swade-grid-inventory.UI.types_8d8460221b"), container.types?.join(", "), sbsI18n("swade-grid-inventory.UI.placeholdergearconsumablemoneylistsgi_19d583b135"))}
      <datalist id="sgi-item-types">${typeOptions()}</datalist>
      ${input(sbsI18n("swade-grid-inventory.UI.Acceptedflags_6d95bb391a"), sbsI18n("swade-grid-inventory.UI.flags_2934fb49d6"), container.flags?.join(", "), sbsI18n("swade-grid-inventory.UI.placeholderpotionscopekeyvalue_0e3031f04d"))}
      <p class="hint">${sbsI18n("swade-grid-inventory.UI.Anitemcanmatchanylisted_f439abae12")}</p>
      ${portable ? `<p class="hint">${sbsI18n("swade-grid-inventory.UI.Theweightlimitappliesbeforethis_584676bd5d")}</p>` : ""}
    </div>
  </fieldset>
  ${slotsEditor(data.slots ?? [], sbsI18n("swade-grid-inventory.UI.Attachmentslots_241e177737"))}
  <fieldset><legend>${sbsI18n("swade-grid-inventory.UI.Itemsounds_50caa6c31a")}</legend>
    <div class="sgi-fields-3">${soundInputs(data.sounds, events)}</div>
  </fieldset>`
   return editDialog(`${item.name} · Inventory Settings`, content, {
      render: (root) => {
         paintedShape = bindContainerPainter(root, container)
         const enabled = root.querySelector('[name="container"]')
         const fields = root.querySelector(".sgi-container-fields")
         const toggle = () => {
            fields.hidden = !enabled.checked
            for (const field of fields.querySelectorAll("input"))
               field.disabled = !enabled.checked
         }
         if (enabled) {
            enabled.addEventListener("change", toggle)
            toggle()
         }
         const layout = root.querySelector('[name="layout"]')
         layout?.addEventListener("change", () => {
            for (const control of root.querySelectorAll(
               ".sgi-container-shape, .sgi-container-outline",
            )) {
               control.hidden = layout.value === "list"
            }
         })
         bindRows(root.querySelector(".sgi-slot-settings"), slotRow)
         const quantity = root.querySelector(".sgi-quantity-limits")
         quantity.addEventListener("click", (event) => {
            if (event.target.closest(".sgi-add-quantity-rule")) {
               quantity
                  .querySelector(".sgi-quantity-rules")
                  .insertAdjacentHTML("beforeend", quantityRuleRow())
            }
            event.target
               .closest(".sgi-remove-quantity-rule")
               ?.closest(".sgi-quantity-rule")
               .remove()
         })
      },
      save: (values, form) => {
         const enabled = portable || values.has("container")
         const layout = values.get("layout") === "list" ? "list" : "grid"
         const config = {
            width: gridSize(values.get("width")),
            height: gridSize(values.get("height")),
            fillImage: values.has("fillImage"),
            customType: values.get("customType").trim().toLowerCase(),
            slot: splitList(values.get("slot").toLowerCase()).join(", "),
            tags: splitList(values.get("tags")?.toLowerCase()),
            sounds: readSounds(form, events),
            slots: collectSlots(
               form.querySelector(".sgi-slot-settings"),
               data.slots,
            ),
            container: {
               ...(enabled ? paintedShape() : containerShape(container)),
               color: values.get("color") ?? container.color ?? "#58a79c",
               limit: Number(values.get("limit") ?? container.limit) || 0,
               types: values.has("types")
                  ? splitList(values.get("types")?.toLowerCase())
                  : (container.types ?? []),
               flags: values.has("flags")
                  ? splitList(values.get("flags"))
                  : (container.flags ?? []),
               quantityLimit: values.has("quantityLimit")
                  ? Number(values.get("quantityLimit")) || 0
                  : (container.quantityLimit ?? 0),
               quantityRules: [
                  ...form.querySelectorAll(".sgi-quantity-rule"),
               ].map((row) => {
                  const match = row
                     .querySelector(".sgi-quantity-match")
                     .value.trim()
                  const limit =
                     row.querySelector(".sgi-quantity-max").valueAsNumber
                  if (!match || !Number.isSafeInteger(limit) || limit < 1)
                     throw new Error(
                        sbsI18n(
                           "swade-grid-inventory.UI.Giveeachquantityruleatype_fe894064d6",
                        ),
                     )
                  return {
                     kind: row.querySelector("select").value,
                     match,
                     limit,
                  }
               }),
               ...(portable
                  ? {
                       layout,
                       factor: Number(values.get("factor")) / 100,
                       visibility:
                          values.get("visibility") ??
                          container.visibility ??
                          "public",
                       accessibility:
                          values.get("accessibility") ??
                          container.accessibility ??
                          "public",
                    }
                  : {}),
               enabled,
            },
         }
         const actor = item.parent
         if (!hasInventory(actor) && actor?.type !== "npc") return item.setFlag(ID, "item", config)
         return serialize(actor, async () => {
            const current = actor.items.get(item.id)
            if (!current)
               throw new Error(
                  sbsI18n(
                     "swade-grid-inventory.UI.Thisitemwasremoved_42d7901277",
                  ),
               )
            const edited = {
               id: current.id,
               name: current.name,
               type: current.type,
               system: current.system,
               isPhysicalItem: current.isPhysicalItem,
               flags: {
                  ...current.flags,
                  [ID]: { ...current.flags[ID], item: config },
               },
            }
            const updates = checkConfiguration(actor, baseSlots(actor), edited)
            if (updates.length) {
               await actor.updateEmbeddedDocuments("Item", [
                  { _id: current.id, [`flags.${ID}.item`]: config },
                  ...updates,
               ])
            } else await current.setFlag(ID, "item", config)
         })
      },
   })
}

export function createItem(actor) {
   const builder = game.modules.get("swade-better-setting")?.api?.openInventoryItemBuilder
   if (builder) return builder(actor)
   const choices = [...BUILTIN_TYPES, CONTAINER]
      .map((type) =>
         option(type, game.i18n.localize(CONFIG.Item.typeLabels[type] ?? type)),
      )
      .join("")
   return DialogV2.prompt({
      classes: ["sbs-standard-swade-sheet"],
      window: {
         title: sbsI18n("swade-grid-inventory.UI.AddInventoryItem_795d1ad848"),
      },
      content: `<label>${sbsI18n("swade-grid-inventory.UI.Itemtype_5b71c546c6")} <select name="type">${choices}</select></label>`,
      ok: {
         label: sbsI18n("swade-grid-inventory.UI.Create_4759498ac2"),
         callback: (event, button) =>
            serialize(actor, async () => {
               const type = formData(button).get("type")
               const name = CONFIG.Item.documentClass.defaultName({
                  type,
                  parent: actor,
               })
               await actor.createEmbeddedDocuments("Item", [{ type, name }], {
                  renderSheet: true,
               })
               return true
            }),
      },
   })
}

function soundRule(rule = {}) {
   return `<div class="sgi-setting-row sgi-sound-row">
    ${input(sbsI18n("swade-grid-inventory.UI.Itemflag_9fa82c503b"), sbsI18n("swade-grid-inventory.UI.flag_807d0fbcae"), rule.flag, sbsI18n("swade-grid-inventory.UI.placeholderBlankforallitems_7fe3c11165"))}
    ${soundInputs(rule)}
    <button type="button" aria-label="${sbsI18nAttribute("swade-grid-inventory.UI.Removesoundrule_7dd9e803b1")}" class="sgi-remove"><i class="fa-solid fa-xmark"></i></button>
  </div>`
}

class SoundRules extends ApplicationV2 {
   async render() {
      const content = `<div class="sgi-sound-default">${file("General sound", "generalSound", "audio", game.settings.get(ID, "soundDefault"), "")}</div>
      <p class="hint">${sbsI18n("swade-grid-inventory.UI.LeaveItemflagblanktoset_552400b53e")}</p>
      <div class="sgi-setting-rows">${game.settings.get(ID, "soundRules").map(soundRule).join("")}</div>
      <button type="button" class="sgi-add"><i class="fa-solid fa-plus"></i> ${sbsI18n("swade-grid-inventory.UI.Addrule_a27cff51a2")}</button>`
      await editDialog(
         sbsI18n("swade-grid-inventory.UI.InventorySoundRules_2c05751064"),
         content,
         {
            width: 780,
            render: (root) =>
               bindRows(root.querySelector(".sgi-config"), soundRule),
            save: async (_values, form) => {
               await game.settings.set(ID, "soundDefault", form.querySelector('file-picker[name="generalSound"]').value.trim())
               await game.settings.set(
                  ID,
                  "soundRules",
                  [...form.querySelectorAll(".sgi-sound-row")]
                     .map((row) => ({
                        flag: row
                           .querySelector('input[name="flag"]')
                           .value.trim(),
                        ...readSounds(row),
                     }))
                     .filter((rule) => EVENTS.some((event) => rule[event])),
               )
            },
         },
      )
      return this
   }
}

export function registerSettings() {
   game.settings.register(ID, "soundDefault", {
      scope: "world", config: false, type: String, default: "",
   })
   game.settings.register(ID, "soundRules", {
      scope: "world",
      config: false,
      type: Array,
      default: [],
   })
   game.settings.register(ID, "soundsEnabled", {
      name: sbsI18n("swade-grid-inventory.UI.Inventorysounds_9f3a6c1a31"),
      hint: sbsI18n(
         "swade-grid-inventory.UI.Playpickupequipandplacementsounds_34f0d1e7ea",
      ),
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
   })
   game.settings.registerMenu(ID, "editSounds", {
      name: sbsI18n(
         "swade-grid-inventory.UI.Globalinventorysoundrules_213e3ecc48",
      ),
      label: sbsI18n("swade-grid-inventory.UI.ConfigureSounds_f956242270"),
      hint: sbsI18n(
         "swade-grid-inventory.UI.Setdefaultpickupequipandplacement_8af52f7930",
      ),
      icon: "fa-solid fa-volume-high",
      type: SoundRules,
      restricted: true,
   })
}

export function canConfigureItem(item) {
   return (
      item?.documentName === "Item" &&
      item.isOwner &&
      (item.parent?.documentName !== "Actor" || hasInventory(item.parent) || item.parent.type === "npc") &&
      (item.type !== MONEY || game.modules.get("swade-better-money")?.active)
   )
}
