import {t} from "./i18n.mjs";
import {ID, isNaturalWeapon} from "./model.mjs";
import {warn} from "./actions.mjs";

export function renderNaturalWeapon(app, root) {
  root.querySelector(".sgi-natural-weapon-setting")?.remove();
  const item = app.document;
  if (item?.type !== "weapon" || (item.actor && item.actor.type !== "character")) return;
  const trademark = root.querySelector('[name="system.trademark"]')?.closest(".form-group");
  if (!trademark) return;
  const doc = root.ownerDocument;
  const group = doc.createElement("div");
  group.className = "form-group sgi-natural-weapon-setting";
  const label = doc.createElement("label");
  label.textContent = t("swade-grid-inventory.UI.NaturalWeapon");
  const fields = doc.createElement("span");
  fields.className = "form-fields";
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.id = `${app.id}-natural-weapon`;
  input.name = `flags.${ID}.naturalWeapon`;
  input.checked = isNaturalWeapon(item);
  input.disabled = !app.isEditable || !item.isOwner;
  label.htmlFor = input.id;
  fields.append(input);
  group.append(label, fields);
  trademark.before(group);
  input.addEventListener("change", event => {
    event.stopPropagation();
    input.disabled = true;
    void item.update({[`flags.${ID}.naturalWeapon`]: input.checked,
      [`flags.${ID}.placement`]: null}).catch(error => {
      input.checked = isNaturalWeapon(item);
      warn(error);
    }).finally(() => { input.disabled = !app.isEditable || !item.isOwner; });
  });
}
