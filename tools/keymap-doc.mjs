// Generates docs/keymap.html: every layer of the keymap plus what each status LED means.
//
//   node tools/keymap-doc.mjs
//
// Layers, layer names and how each layer is reached are read from config/dactyl_manuform_5x6.keymap.
// LED layer numbers and the low-battery threshold are read from Kconfig (and overrides in the .conf).
// Only two things are maintained by hand, both in the "Hand-maintained" section below:
//   - labels for keycodes this script does not know yet (they show up as the raw keycode)
//   - the LED patterns, which must match src/dactyl_leds.c

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// ---------------------------------------------------------------------------
// Hand-maintained
// ---------------------------------------------------------------------------

// Layer names: short ones go on keys and tabs, long ones in the description. Unlisted layers use
// their #define name.
const LAYER_SHORT = { DEFAULT: "Base" };
const LAYER_LONG = { AOE2: "Age of Empires II" };

// Optional one-line notes shown under a layer, keyed by #define name.
const LAYER_NOTES = {
  DEFAULT: "N: tócala para n, mantenla para ñ (requiere Num Lock activo en Windows).",
  SYM: "[ ] arriba, ( ) en medio, { } abajo: siempre abres con el índice y cierras con el medio.",
  AOE2: "El LED azul se queda encendido mientras esta capa está activa.",
  ADJUST: "Boot y Reset actúan sobre la mitad en la que los pulsas. El LED verde se queda fijo.",
};

// Categories: m = modifier/editing, p = punctuation (symbol color outside the base layer),
// n = navigation, u = media and utilities, l = layer, x = system.
const KEYS = {
  TAB: ["Tab", "m"], ESC: ["Esc", "m"], BSPC: ["⌫", "m"], DELETE: ["Del", "m"], SPACE: ["Space", "m"],
  ENTER: ["Enter", "m"], LSHFT: ["Shift", "m"], LCTRL: ["Ctrl", "m"], LEFT_GUI: ["Win", "m"],
  LEFT_ALT: ["Alt", "m"], LALT: ["Alt", "m"], KP_NUMLOCK: ["Num~Lock", "m"],
  MINUS: ["-", "p"], SEMI: [";", "p"], SQT: ["'", "p"], COMMA: [",", "p"], DOT: [".", "p"],
  FSLH: ["/", "p"], SLASH: ["/", "p"], BSLH: ["\\", "p"], EXCL: ["!", "p"], AT: ["@", "p"],
  HASH: ["#", "p"], DOLLAR: ["$", "p"], PERCENT: ["%", "p"], AMPS: ["&", "p"], LBKT: ["[", "p"],
  RBKT: ["]", "p"], PIPE: ["|", "p"], GRAVE: ["`", "p"], DQT: ['"', "p"], UNDER: ["_", "p"],
  PLUS: ["+", "p"], EQUAL: ["=", "p"], LPAR: ["(", "p"], RPAR: [")", "p"], TILDE: ["~", "p"],
  QMARK: ["?", "p"], COLON: [":", "p"], ASTRK: ["*", "p"], ASTERISK: ["*", "p"], CARET: ["^", "p"],
  LT: ["<", "p"], GT: [">", "p"], LBRC: ["{", "p"], RBRC: ["}", "p"], KP_MINUS: ["-", "p"],
  KP_PLUS: ["+", "p"],
  HOME: ["Home", "n"], END: ["End", "n"], PG_UP: ["PgUp", "n"], PG_DN: ["PgDn", "n"],
  LEFT: ["←", "n"], RIGHT: ["→", "n"], UP: ["↑", "n"], DOWN: ["↓", "n"],
  C_VOL_UP: ["Vol~+", "u"], C_VOL_DN: ["Vol~−", "u"], C_MUTE: ["Mute", "u"], C_PP: ["Play~Pausa", "u"],
  C_NEXT: ["Next", "u"], C_PREV: ["Prev", "u"],
};

// Shortcuts with a friendlier name than "Ctrl+Win+...".
const COMBOS = {
  "LG(LS(S))": ["Captura", "u"],
  "LC(LG(LEFT))": ["Escr.~←", "u"],
  "LC(LG(RIGHT))": ["Escr.~→", "u"],
  "LG(TAB)": ["Vista~tareas", "u"],
  "LC(LG(D))": ["Nuevo~escr.", "u"],
  "LG(L)": ["Bloquear", "x"],
  "LC(LSHFT)": ["Ctrl~Shift", "m"],
};

// LED patterns, mirroring src/dactyl_leds.c. Times in ms; `count` blinks of on/off, then `pause`.
// `loop` repeats while the condition holds; otherwise the sequence plays once.
const ledStates = ({ layer, low }) => ({
  left: [
    { led: "red", steady: true, when: "Fijo", meaning: "Caps Lock activo." },
    { led: "blue", steady: true, when: "Fijo", meaning: `Estás en la capa ${layer.mode}.` },
    { led: "green", steady: true, when: "Fijo", meaning: `Estás en la capa ${layer.adjust}. Mientras tanto no se ven las alertas del lado derecho.` },
    { led: "green", on: 150, off: 0, count: 1, pause: 1850, loop: true, when: "Repetitivo", meaning: "El lado derecho no está enlazado. Es normal los primeros segundos después de conectar." },
    { led: "green", on: 80, off: 150, count: 2, pause: 5000, loop: true, when: "Repetitivo", meaning: `La batería del lado derecho está en ${low}% o menos.` },
    { led: "green", on: 250, off: 250, count: 3, when: "Al enlazarse", meaning: "El lado derecho se conectó con 50% de batería o más." },
    { led: "green", on: 250, off: 250, count: 2, when: "Al enlazarse", meaning: `El lado derecho se conectó con entre ${low + 1}% y 49% de batería.` },
    { led: "green", on: 250, off: 250, count: 1, when: "Al enlazarse", meaning: `El lado derecho se conectó con ${low}% de batería o menos.` },
  ],
  right: [
    { led: "red", on: 500, off: 500, count: 2, when: "Al encender", meaning: "Batería al 50% o más." },
    { led: "red", on: 150, off: 150, count: 4, when: "Al encender", meaning: `Batería entre ${low + 1}% y 49%.` },
    { led: "red", on: 50, off: 50, count: 6, when: "Al encender", meaning: `Batería en ${low}% o menos: conviene cargarlo.` },
    { led: "red", on: 80, off: 120, count: 2, when: "Una vez", meaning: "Se enlazó con el lado izquierdo." },
    { led: "red", on: 1000, off: 0, count: 1, when: "Una vez", meaning: "Perdió el enlace con el lado izquierdo." },
    { led: "red", on: 40, off: 0, count: 1, pause: 30000, loop: true, when: "Repetitivo", meaning: `Batería en ${low}% o menos.` },
  ],
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const KEY_COUNT = 86; // 5 rows x 14, the 4-key mid row, 3 thumb rows x 4

const keymapSrc = read("config/dactyl_manuform_5x6.keymap").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const defines = {};
for (const [, name, value] of keymapSrc.matchAll(/#define\s+(\w+)\s+(\d+)/g)) defines[name] = Number(value);
const defineByIndex = Object.fromEntries(Object.entries(defines).map(([k, v]) => [v, k]));
const layerIndex = (ref) => (/^\d+$/.test(ref) ? Number(ref) : defines[ref]);

const macroLabels = {};
for (const [, name, body] of keymapSrc.matchAll(/(\w+)\s*:\s*\w+\s*\{([^{}]*?zmk,behavior-macro[^{}]*?)\}/g)) {
  const label = body.match(/label\s*=\s*"([^"]*)"/);
  macroLabels[name] = label ? label[1] : name;
}

const holdTaps = {};
for (const [, name, body] of keymapSrc.matchAll(/(\w+)\s*:\s*\w+\s*\{([^{}]*?zmk,behavior-hold-tap[^{}]*?)\}/g)) {
  const b = body.match(/bindings\s*=\s*<&(\w+)>\s*,\s*<&(\w+)>/);
  if (b) holdTaps[name] = { hold: b[1], tap: b[2] };
}

const conditionals = [...keymapSrc.matchAll(/if-layers\s*=\s*<([^>]*)>\s*;\s*then-layer\s*=\s*<([^>]*)>/g)].map(([, ifs, then]) => ({
  ifs: ifs.trim().split(/\s+/).map(layerIndex),
  then: layerIndex(then.trim()),
}));

const keymapBlock = keymapSrc.slice(keymapSrc.indexOf('"zmk,keymap"'));
const layers = [...keymapBlock.matchAll(/(\w+)\s*\{([^{}]*?)bindings\s*=\s*<([\s\S]*?)>\s*;/g)].map(([, node, props, bindings], index) => {
  const tokens = bindings.split(/(?=&)/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length !== KEY_COUNT) throw new Error(`${node}: expected ${KEY_COUNT} bindings, found ${tokens.length}`);
  const define = defineByIndex[index] ?? node;
  const displayName = props.match(/display-name\s*=\s*"([^"]*)"/);
  return {
    index,
    define,
    name: displayName ? displayName[1] : LAYER_SHORT[define] ?? (/\d/.test(define) ? define : define[0] + define.slice(1).toLowerCase()),
    long: LAYER_LONG[define] ?? "",
    note: LAYER_NOTES[define] ?? "",
    tokens: tokens.map((t) => {
      const [behavior, ...params] = t.slice(1).split(/\s+/);
      return { behavior, params };
    }),
  };
});
const layerName = (ref) => layers[layerIndex(ref)]?.name ?? ref;

const MODS = { LC: "Ctrl", RC: "Ctrl", LS: "Shift", RS: "Shift", LA: "Alt", RA: "AltGr", LG: "Win", RG: "Win" };
function keyLabel(code) {
  if (COMBOS[code]) return COMBOS[code];
  if (KEYS[code]) return KEYS[code];
  if (/^[A-Z]$/.test(code)) return [code, ""];
  if (/^N\d$/.test(code)) return [code[1], ""];
  if (/^F\d{1,2}$/.test(code)) return [code, ""];
  const mod = code.match(/^([LR][CSAG])\((.*)\)$/);
  if (mod) return [`${MODS[mod[1]]}~${keyLabel(mod[2])[0].replace("~", " ")}`, "n"];
  return [code, ""];
}

// Returns { label, sub, cat } or { trans: true }.
function describe({ behavior, params }) {
  const [p1, p2] = params;
  const out = (label, cat, sub = "") => ({ label, sub, cat });
  switch (behavior) {
    case "trans": return { trans: true };
    case "none": return out("", "e");
    case "kp": return out(...keyLabel(p1));
    case "mo": return out(layerName(p1), "l");
    case "to": return out(`→ ${layerName(p1)}`, "l");
    case "tog": return out(`Tog ${layerName(p1)}`, "l");
    case "bootloader": return out("Boot", "x");
    case "sys_reset": return out("Reset", "x");
    case "studio_unlock": return out("Studio", "x");
    case "caps_word": return out("Caps~Word", "u");
    case "bt":
      if (p1 === "BT_SEL") return out(`BT ${Number(p2) + 1}`, "x");
      return out({ BT_CLR: "BT Clr", BT_NXT: "BT →", BT_PRV: "BT ←" }[p1] ?? p1, "x");
    case "out": return out({ OUT_USB: "USB", OUT_BLE: "BLE", OUT_TOG: "USB/BLE" }[p1] ?? p1, "x");
  }
  const ht = holdTaps[behavior];
  if (ht) {
    const [tapLabel, tapCat] = ht.tap === "kp" ? keyLabel(p2) : [macroLabels[ht.tap] ?? ht.tap, "u"];
    const holdLabel = ht.hold === "kp" ? keyLabel(p1)[0] : macroLabels[ht.hold] ?? ht.hold;
    return out(tapLabel, tapCat, `mant. ${holdLabel}`);
  }
  return out(macroLabels[behavior] ?? behavior, "u");
}

// Where a key sits, in words, for the "how to reach this layer" line.
function where(pos) {
  if (pos < 70) return `${pos % 14 < 7 ? "mitad izquierda" : "mitad derecha"}, fila ${Math.floor(pos / 14) + 1}`;
  const j = (pos - 70) % 4;
  return pos < 74 ? `fila bajo el teclado ${j < 2 ? "izquierdo" : "derecho"}` : `pulgar ${j < 2 ? "izquierdo" : "derecho"}`;
}

function findBindings(behaviors, target) {
  const found = [];
  for (const l of layers) l.tokens.forEach((t, pos) => {
    if (behaviors.includes(t.behavior) && layerIndex(t.params[0]) === target) found.push({ layer: l, pos, behavior: t.behavior });
  });
  return found;
}

for (const l of layers) {
  const how = [];
  let held = [];
  let stack = [l.index, 0];
  const cond = conditionals.find((c) => c.then === l.index);
  if (l.index === 0) how.push("Capa por defecto.");
  else if (cond) {
    how.push(`Mantén ${cond.ifs.map((i) => layers[i].name).join(" + ")} a la vez.`);
    held = cond.ifs.flatMap((i) => findBindings(["mo"], i).filter((b) => b.layer.index === 0).map((b) => b.pos));
    stack = [l.index, ...[...cond.ifs].sort((a, b) => b - a), 0];
  } else {
    const mo = findBindings(["mo"], l.index);
    if (mo.length) {
      how.push(`Mantén ${l.name} (${[...new Set(mo.map((b) => where(b.pos)))].join(" o ")}).`);
      held = mo.filter((b) => b.layer.index === 0).map((b) => b.pos);
    }
    const entries = findBindings(["to", "tog"], l.index).filter((b) => b.layer.index !== l.index);
    for (const b of entries) how.push(`Se activa con «${describe(b.layer.tokens[b.pos]).label}» en la capa ${b.layer.name} (${where(b.pos)}).`);
    // Layers entered with &to stay on until left the same way.
    const exit = entries.length ? l.tokens.findIndex((t) => t.behavior === "to" && layerIndex(t.params[0]) !== l.index) : -1;
    if (exit >= 0) how.push(`Para salir: «${describe(l.tokens[exit]).label}» (${where(exit)}).`);
  }
  l.how = how.join(" ");
  // Transparent keys show what the next active layer down provides, as ZMK resolves it.
  l.keys = l.tokens.map((t, pos) => {
    const own = describe(t);
    if (!own.trans) return { ...own, cat: own.cat === "p" && l.index !== 0 ? "s" : own.cat === "p" ? "" : own.cat };
    const below = stack.slice(1).map((i) => describe(layers[i].tokens[pos])).find((d) => !d.trans) ?? { label: "", cat: "e" };
    return { label: below.label, sub: below.sub, cat: held.includes(pos) ? "h" : "t" };
  });
}

// ---------------------------------------------------------------------------
// LED settings from Kconfig defaults and .conf overrides
// ---------------------------------------------------------------------------

const kconfig = read("Kconfig");
const conf = read("config/dactyl_manuform_5x6.conf");
function setting(name) {
  const override = conf.match(new RegExp(`^CONFIG_${name}=(\\d+)`, "m"));
  if (override) return Number(override[1]);
  return Number(kconfig.match(new RegExp(`config ${name}[\\s\\S]*?default (\\d+)`))[1]);
}
const layerTitle = (l) => (l ? l.long || l.name : "?");
const leds = ledStates({
  layer: {
    mode: layerTitle(layers[setting("DACTYL_LEDS_MODE_LAYER")]),
    adjust: layerTitle(layers[setting("DACTYL_LEDS_ADJUST_LAYER")]),
  },
  low: setting("DACTYL_LEDS_BATTERY_LOW"),
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const data = {
  layers: layers.map(({ name, long, how, note, keys }) => ({ name, long, how, note, keys })),
  leds,
};

const html = readFileSync(join(root, "tools/keymap-doc.template.html"), "utf8")
  .replace("/*DATA*/null", JSON.stringify(data).replace(/</g, "\\u003c"));

mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs/keymap.html"), html);
console.log(`docs/keymap.html: ${layers.length} layers, ${leds.left.length + leds.right.length} LED states`);
