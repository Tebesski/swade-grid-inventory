import {ID, matchesFlag, settings} from "./model.mjs";

const wildcardFiles = new Map();
const extensions = [".ogg", ".mp3", ".wav", ".flac", ".webm", ".m4a", ".aac", ".opus"];

export function soundPath(item, event, rules = [], general = "") {
  const effects = globalThis.game?.modules?.get("swade-better-effects")?.api;
  let flags;
  const matches = expression => expression.split(";").some(group => group.split(",").every(value => {
    const flag = value.trim();
    if (!flag) return false;
    if (flag.startsWith("#")) return matchesFlag(item, flag);
    if (!effects?.getFlags) return false;
    flags ??= new Set(effects.getFlags(item));
    return flags.has(effects.normalizeFlag(flag));
  }));
  const path = value => typeof value === "string" ? value.trim() : "";
  return path(settings(item).sounds?.[event])
    || path(rules.find(rule => path(rule[event]) && rule.flag?.trim() && matches(rule.flag))?.[event])
    || path(rules.find(rule => path(rule[event]) && !rule.flag?.trim())?.[event])
    || path(general) || undefined;
}

export async function playSound(item, event) {
  if (!game.settings.get(ID, "soundsEnabled")) return;
  const path = soundPath(item, event, game.settings.get(ID, "soundRules"), game.settings.get(ID, "soundDefault"));
  if (!path) return;
  try {
    const src = path.includes("*") ? await randomSource(path) : path;
    if (src) foundry.audio.AudioHelper.play({src, channel: "interface"});
  } catch (error) {
    console.warn(`${ID} | Could not play ${path}`, error);
  }
}

export async function playFileSound(path, loop = false) {
  if (!path || !game.settings.get(ID, "soundsEnabled")) return;
  try {
    const src = path.includes("*") ? await randomSource(path) : path;
    if (src) return await foundry.audio.AudioHelper.play({src, loop, channel: "interface"});
  } catch (error) {
    console.warn(`${ID} | Could not play ${path}`, error);
  }
}

async function randomSource(path) {
  if (!wildcardFiles.has(path)) {
    const files = CONFIG.ux.FilePicker.browse("data", path, {wildcard: true, extensions})
      .then(result => result.files)
      .catch(error => {
        wildcardFiles.delete(path);
        throw error;
      });
    wildcardFiles.set(path, files);
  }
  const files = await wildcardFiles.get(path);
  if (!files.length) wildcardFiles.delete(path);
  return files[Math.floor(Math.random() * files.length)];
}
