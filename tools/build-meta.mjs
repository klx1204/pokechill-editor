#!/usr/bin/env node
// Generates data/meta.json for pokechill-editor.
// Usage: node tools/build-meta.mjs [pokechillRepo] [datasetRepo]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data", "meta.json");

const argv = process.argv.slice(2);
const POKECHILL = path.resolve(
  argv[0] || process.env.POKECHILL_PATH || path.join(ROOT, "..", "play-pokechill.github.io")
);
const DATASET = path.resolve(
  argv[1] || process.env.DATASET_PATH || path.join(ROOT, "..", "pokemon-dataset-zh")
);

const read = (p) => fs.readFileSync(p, "utf8");
const pkmnSrc = read(path.join(POKECHILL, "scripts", "pkmnDictionary.js"));
const dictSrc = read(path.join(POKECHILL, "scripts", "moveDictionary.js"));
const itemSrc = read(path.join(POKECHILL, "scripts", "itemDictionary.js"));

// ---------- text helpers ----------
const norm = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const camelWords = (s) => {
  const out = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
};

const splitEntries = (src, kw) => {
  const re = new RegExp(`^${kw}\\.(\\w+)\\s*=\\s*\\{`, "gm");
  const starts = [];
  let m;
  while ((m = re.exec(src))) starts.push({ id: m[1], index: m.index });
  return starts.map((s, i) => ({
    id: s.id,
    body: src.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : src.length),
  }));
};

const typeList = (body) => {
  const m = body.match(/type\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/[`'"]([a-z]+)[`'"]/g)].map((x) => x[1]);
};

const numExpr = (raw, consts) => {
  try {
    let e = raw.trim().replace(/\/\/.*$/, "").trim();
    for (const [k, v] of Object.entries(consts)) e = e.replace(new RegExp(`\\b${k}\\b`, "g"), String(v));
    if (!/^[\d\s.+\-*/()]+$/.test(e)) return null;
    const n = new Function(`return (${e})`)();
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
};

const bstBlock = (body, consts) => {
  const start = body.search(/bst\s*:\s*\{/);
  if (start < 0) return null;
  let i = body.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const inner = body.slice(body.indexOf("{", start) + 1, end);
  const obj = {};
  for (const m of inner.matchAll(/(\w+)\s*:\s*([^,\n}]+)/g)) {
    const v = numExpr(m[2], consts);
    if (v !== null) obj[m[1]] = v;
  }
  return obj;
};

// pokechill rating: 1 + (base - 20) * 5/180, clamp 1..6
const statRating = (v) => Math.min(6, Math.max(1, Math.round(1 + ((v ?? 0) - 20) * (5 / 180))));

const divisionOf = (bst) => {
  if (!bst) return null;
  const total = ["hp", "atk", "def", "satk", "sdef", "spe"].reduce((a, k) => a + statRating(bst[k]), 0);
  if (total < 10) return "D";
  if (total < 14) return "C";
  if (total < 16) return "B";
  if (total < 19) return "A";
  if (total < 21) return "S";
  if (total < 24) return "SS";
  return "SSS";
};

// ---------- dataset ----------
const dsDir = path.join(DATASET, "data");
const simple = JSON.parse(read(path.join(dsDir, "simple_pokedex.json")));
const moveList = JSON.parse(read(path.join(dsDir, "move_list.json")));
const abilityList = JSON.parse(read(path.join(dsDir, "ability_list.json")));
const itemTree = JSON.parse(read(path.join(dsDir, "item_list.json")));

const dsPkmn = new Map();
for (const e of simple) {
  if (!e.name_en) continue;
  dsPkmn.set(norm(e.name_en), { zh: e.name_zh || null, en: e.name_en, no: Number(e.index) || null });
}
const dsMove = new Map();
for (const e of moveList) if (e.name_en) dsMove.set(norm(e.name_en), e);
const dsAbility = new Map();
for (const e of abilityList) if (e.name_en) dsAbility.set(norm(e.name_en), e);

const dsItems = new Map();
(function walk(nodes) {
  for (const n of nodes || []) {
    if (n.type === "item" && n.name_en) dsItems.set(norm(n.name_en), n.name_zh || null);
    walk(n.children);
  }
})(itemTree);

// clean game ability text: ${tagXxx}, ${joinWithAnd(...)}, inline html
const TAG_TEXT = {
  Burn: "Burn", Poisoned: "Poisoned", Paralysis: "Paralyzed", Confused: "Confused",
  Sleep: "Asleep", Freeze: "Frozen", Sunny: "Sunny", Rainy: "Rainy",
  Sandstorm: "Sandstorm", Hail: "Hail", Foggy: "Foggy",
  GrassyTerrain: "Grassy Terrain", ElectricTerrain: "Electric Terrain", MistyTerrain: "Misty Terrain",
};
const cleanText = (s) => {
  if (!s) return null;
  const out = String(s)
    .replace(/\$\{tag(\w+)\}/g, (_, k) => TAG_TEXT[k] || k)
    .replace(/\$\{joinWithAnd\([^}]*\)\}/g, "")
    .replace(/<\/?span[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
};

// ---------- form vocabulary ----------
// pos: pre = 中文/英文形态词拼在前面, post = 括号放后面, enPost = 空格放后面
const FORMS = {
  mega: { zh: "Mega", pos: "pre" },
  gmax: { zh: "超极巨化", pos: "pre" },
  alolan: { zh: "阿罗拉", pos: "pre" },
  galarian: { zh: "伽勒尔", pos: "pre" },
  hisuian: { zh: "洗翠", pos: "pre" },
  paldean: { zh: "帕底亚", pos: "pre" },
  crystal: { zh: "水晶", pos: "pre" },
  clone: { zh: "克隆", pos: "pre" },
  primal: { zh: "原始", pos: "pre" },
  spiky: { zh: "刺刺耳", pos: "pre" },
  ultra: { zh: "究极", pos: "pre" },
  heat: { zh: "加热", pos: "pre" },
  wash: { zh: "清洗", pos: "pre" },
  frost: { zh: "结冰", pos: "pre" },
  fan: { zh: "旋转", pos: "pre" },
  mow: { zh: "切割", pos: "pre" },
  origin: { zh: "起源", pos: "post" },
  therian: { zh: "灵兽", pos: "post" },
  black: { zh: "黑", pos: "post" },
  white: { zh: "白", pos: "post" },
  resolute: { zh: "觉悟", pos: "post" },
  pirouette: { zh: "舞步", pos: "post" },
  unbound: { zh: "解放", pos: "post" },
  school: { zh: "群聚", pos: "post" },
  hero: { zh: "英雄", pos: "post" },
  roaming: { zh: "徘徊", pos: "post" },
  bloodmoon: { zh: "血月", pos: "post" },
  sunny: { zh: "晴天", pos: "post" },
  rainy: { zh: "雨天", pos: "post" },
  snowy: { zh: "雪天", pos: "post" },
  east: { zh: "东海", pos: "post" },
  west: { zh: "西海", pos: "post" },
  sky: { zh: "天空", pos: "post" },
  dawnWings: { zh: "拂晓之翼", pos: "post" },
  duskMane: { zh: "黄昏之鬃", pos: "post" },
  teal: { zh: "碧草", pos: "post" },
  wellspring: { zh: "水井", pos: "post" },
  hearthflame: { zh: "火灶", pos: "post" },
  cornerstone: { zh: "磐柱", pos: "post" },
  terastal: { zh: "太晶", pos: "post" },
  stellar: { zh: "星晶", pos: "post" },
  curly: { zh: "卷曲", pos: "post" },
  droopy: { zh: "下垂", pos: "post" },
  stretchy: { zh: "伸展", pos: "post" },
  combat: { zh: "格斗", pos: "post" },
  blaze: { zh: "火", pos: "post" },
  aqua: { zh: "水", pos: "post" },
  attack: { zh: "攻击", pos: "post" },
  defense: { zh: "防御", pos: "post" },
  speed: { zh: "速度", pos: "post" },
  single: { zh: "一击流", pos: "post" },
  rapid: { zh: "连击流", pos: "post" },
  ash: { zh: "Ash", pos: "enPost" },
  world: { zh: "World", pos: "enPost" },
  hoenn: { zh: "Hoenn", pos: "enPost" },
  unova: { zh: "Unova", pos: "enPost" },
  kalos: { zh: "Kalos", pos: "enPost" },
  belle: { zh: "Belle", pos: "enPost" },
  libre: { zh: "Libre", pos: "enPost" },
  phd: { zh: "PhD", pos: "enPost" },
  popstar: { zh: "Pop Star", pos: "enPost" },
  rockstar: { zh: "Rock Star", pos: "enPost" },
  event: { zh: "Event", pos: "enPost" },
  kabutopsB: { zh: "B", pos: "enPost" },
  aerodactylB: { zh: "B", pos: "enPost" },
  eternal: { zh: "永恒", pos: "post" },
  sandy: { zh: "砂土", pos: "post" },
  trash: { zh: "垃圾", pos: "post" },
  sunshine: { zh: "晴天", pos: "post" },
  autumn: { zh: "秋天", pos: "post" },
  spring: { zh: "春天", pos: "post" },
  summer: { zh: "夏天", pos: "post" },
  winter: { zh: "冬天", pos: "post" },
  douse: { zh: "水流", pos: "post" },
  shock: { zh: "闪电", pos: "post" },
  burn: { zh: "火焰", pos: "post" },
  chill: { zh: "冰冻", pos: "post" },
  blue: { zh: "蓝", pos: "post" },
  white: { zh: "白", pos: "post" },
  red: { zh: "红", pos: "post" },
  orange: { zh: "橙", pos: "post" },
  yellow: { zh: "黄", pos: "post" },
  green: { zh: "绿", pos: "post" },
  indigo: { zh: "靛", pos: "post" },
  violet: { zh: "紫", pos: "post" },
};
// forms intentionally left in English (user request)
const SKIP_FORMS = new Set([
  "heart", "star", "diamond", "debutante", "matron", "dandy", "reine", "kabuki", "pharaoh",
  "archipelago", "continental", "elegant", "fancy", "garden", "highPlains", "icySnow",
  "jungle", "marine", "modern", "monsoon", "ocean", "pokeball", "polar", "river",
  "sandstorm", "savanna", "sun", "tundra",
  "blue", "orange", "yellow", "green", "indigo", "violet", "red", "white",
  "koi", "regal", "sakura", "skelly", "soar", "tiger",
]);

const TYPE_ZH = {
  normal: "一般", fire: "火", water: "水", electric: "电", grass: "草", ice: "冰",
  fighting: "格斗", poison: "毒", ground: "地面", flying: "飞行", psychic: "超能力",
  bug: "虫", rock: "岩石", ghost: "幽灵", dragon: "龙", dark: "恶", steel: "钢", fairy: "妖精",
};

// special aliases / typos in the game source
const ALIASES = {
  dududunsparce: "dudunsparce",
  singleStrikeUrshifuGmax: "urshifuSingleGmax",
  arceusflying: "arceusFlying",
};

// forms whose suffix stays in English by request
const SKIP_BASE = /^(vivillon|furfrou|flabebe|floette|florges|minior|magikarp)/i;

const datasetPrefix = [...dsPkmn.entries()]
  .filter(([k]) => k.length >= 4)
  .sort((a, b) => b[0].length - a[0].length);

function formInfo(key, baseId) {
  const k = key.charAt(0).toLowerCase() + key.slice(1);
  if (key === "F") return { key, zh: "♀", pos: "enPost" };
  if (key === "M") return { key, zh: "♂", pos: "enPost" };
  if (key === "Z") return { key, zh: "Z", pos: "enPost" };
  if (/^[A-Z]$/.test(key)) return { key, zh: key, pos: "enPost" };
  if (/^\d+$/.test(key)) return { key, zh: `${key}%`, pos: "enPost" };
  if (/^calyrex/i.test(baseId)) {
    if (k === "ice") return { key, zh: "骑白马", pos: "post" };
    if (k === "shadow") return { key, zh: "骑黑马", pos: "post" };
  }
  if (SKIP_BASE.test(baseId)) return { key, zh: camelWords(key), pos: "enPost" };
  if (k === "crowned") {
    if (/^zacian/i.test(baseId)) return { key, zh: "剑之王", pos: "post" };
    if (/^zamazenta/i.test(baseId)) return { key, zh: "盾之王", pos: "post" };
  }
  if (TYPE_ZH[k]) return { key, zh: TYPE_ZH[k], pos: "post" };
  if (FORMS[k]) return { key, ...FORMS[k] };
  return { key, zh: camelWords(key), pos: "enPost" };
}

function resolveBase(id) {
  const real = ALIASES[id] || id;
  const exact = dsPkmn.get(norm(camelWords(real)));
  if (exact) return { baseId: real, en: exact.en, zh: exact.zh, no: exact.no, forms: [] };

  // prefix forms (megaVenusaur, alolanGeodude, crystalOnix, ...)
  for (const [key, info] of Object.entries(FORMS)) {
    if (info.pos !== "pre") continue;
    if (real.startsWith(key) && real.length > key.length && /^[A-Z0-9]/.test(real[key.length])) {
      const rest = real.slice(key.length);
      const r = resolveBase(rest);
      if (r) return { ...r, forms: [{ key, ...info }, ...r.forms] };
      return { baseId: rest, en: camelWords(rest), zh: null, no: null, forms: [{ key, ...info }] };
    }
  }

  // suffix forms on camel boundaries (venusaurGmax, rotomHeat, unownA, megaCharizardX, ...)
  const words = camelWords(real).split(" ").filter(Boolean);
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const base = words.slice(0, -n).join("");
    const suffixKey = words.slice(-n).join("");
    const r = resolveBase(base);
    if (!r) continue;
    return { ...r, forms: [...r.forms, formInfo(suffixKey, r.baseId)] };
  }

  // all-lowercase ids (arceusflying, etc.): longest dataset prefix
  const low = norm(real);
  for (const [key, d] of datasetPrefix) {
    if (low.length > key.length && low.startsWith(key)) {
      const rest = real.slice(key.length);
      const info = TYPE_ZH[rest] ? { key: rest, zh: TYPE_ZH[rest], pos: "post" } : formInfo(rest, d.en);
      return { baseId: real.slice(0, key.length), en: d.en, zh: d.zh, no: d.no, forms: [info] };
    }
  }
  return null;
}

const OVERRIDES = {
  nidoranF: { zh: "尼多兰 ♀", en: "Nidoran♀" },
  nidoranM: { zh: "尼多朗 ♂", en: "Nidoran♂" },
};

function displayName(id) {
  if (OVERRIDES[id]) return OVERRIDES[id];
  const r = resolveBase(id);
  if (!r) return { zh: null, en: camelWords(id) };
  if (!r.zh) return { zh: null, en: r.en || camelWords(id) };
  let zh = r.zh;
  for (const f of r.forms) {
    if (f.pos === "pre") zh = /^[A-Za-z]/.test(f.zh) ? `${f.zh} ${zh}` : `${f.zh}${zh}`;
  }
  for (const f of r.forms) {
    if (f.pos === "post") zh = `${zh}（${f.zh}）`;
    if (f.pos === "enPost") zh = `${zh} ${f.zh}`;
  }
  return { zh, en: r.en || camelWords(id) };
}

// ---------- pokemon ----------
const consts = { gmaxFactor: 1.2 };
const pkmnEntries = splitEntries(pkmnSrc, "pkmn");
const pokemon = pkmnEntries.map(({ id, body }) => {
  const bst = bstBlock(body, consts);
  const types = typeList(body);
  const hiddenMatch = body.match(/hiddenAbility\s*:\s*ability\.(\w+)/);
  const signMatch = body.match(/signature\s*:\s*move\.(\w+)/);
  const eggMatch = body.match(/eggMove\s*:\s*(move|ability)\.(\w+)/);
  const rename = body.match(/rename\s*:\s*[`'"]([^`'"]+)[`'"]/);
  const evolves = [...body.matchAll(/pkmn:\s*pkmn\.(\w+)([^}]*)/g)].map((m) => ({
    id: m[1],
    level: /level\s*:/.test(m[2]),
    item: /item\s*:/.test(m[2]),
  }));
  const evolvesTo = [...new Set(evolves.map((e) => e.id))].filter((x) => x !== id);
  const bstStars = bst
    ? Object.fromEntries(["hp", "atk", "def", "satk", "sdef", "spe"].map((k) => [k, statRating(bst[k])]))
    : null;
  const names = displayName(id);
  const base = resolveBase(id);
  return {
    id,
    dexNo: base?.no ?? null,
    gen: base?.no ? Math.min(9, Math.ceil(base.no / 151) === 1 ? 1 : 0) : null,
    nameZh: names.zh,
    nameEn: names.en,
    types,
    division: divisionOf(bst),
    hiddenAbility: hiddenMatch ? hiddenMatch[1] : null,
    signature: signMatch ? signMatch[1] : null,
    eggMove: eggMatch ? eggMatch[2] : null,
    eggMoveKind: eggMatch ? eggMatch[1] : null,
    evolvesTo,
    evolves,
    bst: bstStars,
    hidden: /^\s*hidden\s*:\s*true/m.test(body),
    rename: rename ? rename[1] : null,
  };
});

// generation from dex number
const GEN_RANGES = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1025]];
for (const p of pokemon) {
  p.gen = null;
  if (!p.dexNo) continue;
  for (let i = 0; i < GEN_RANGES.length; i++) {
    if (p.dexNo >= GEN_RANGES[i][0] && p.dexNo <= GEN_RANGES[i][1]) {
      p.gen = i + 1;
      break;
    }
  }
}

// ---------- moves ----------
const moveEntries = splitEntries(dictSrc, "move");
const moveConsts = { t4Base: 120, demeritBp: 150 };
const movesFull = moveEntries.map(({ id, body }) => {
  const rarity = body.match(/rarity\s*:\s*(\d+)/);
  const type = body.match(/type\s*:\s*[`'"]([a-z]+)[`'"]/);
  const power = body.match(/power\s*:\s*([^,\n}]+)/);
  const split = body.match(/split\s*:\s*[`'"]([a-z]+)[`'"]/);
  const moveset = body.match(/moveset\s*:\s*\[([^\]]*)\]/);
  const info = body.match(/info\s*:\s*function\s*\(\)\s*\{\s*return\s*`([^`]*)`/);
  const mv = camelWords(id);
  const ds = dsMove.get(norm(mv));
  return {
    id,
    nameZh: ds?.name_zh || null,
    nameEn: mv,
    rarity: rarity ? Number(rarity[1]) : null,
    type: type ? type[1] : null,
    power: power ? numExpr(power[1], moveConsts) : null,
    split: split ? split[1] : null,
    moveset: moveset ? [...moveset[1].matchAll(/[`'"]([\w]+)[`'"]/g)].map((x) => x[1]) : [],
    restricted: /^\s*restricted\s*:\s*true/m.test(body),
    effectEn: info ? cleanText(info[1]) : null,
    descZh: ds?.description || null,
    accuracy: ds?.accuracy || null,
    pp: ds?.pp || null,
    officialCategory: ds?.category || null,
    pokemon: [],
  };
});

// ---------- abilities ----------
const abilityEntries = splitEntries(dictSrc, "ability");
const abilitiesFull = abilityEntries.map(({ id, body }) => {
  const rarity = body.match(/rarity\s*:\s*(\d+)/);
  const rename = body.match(/rename\s*:\s*[`'"]([^`'"]+)[`'"]/);
  const mv = rename ? rename[1] : camelWords(id);
  const ds = dsAbility.get(norm(mv));
  const info = body.match(/info\s*:\s*function\s*\(\)\s*\{\s*return\s*`([^`]*)`/);
  const nerf = body.match(/nerf\s*:\s*`([^`]*)`/);
  const types = typeList(body);
  return {
    id,
    nameZh: ds?.name_zh || null,
    nameEn: mv,
    rarity: rarity ? Number(rarity[1]) : null,
    types,
    typeKind: types.includes("all") ? "all" : types.length ? "concrete" : "none",
    effectEn: info ? cleanText(info[1]) : null,
    nerf: nerf ? cleanText(nerf[1]) : null,
    rename: rename ? rename[1] : null,
    descZh: ds?.description || null,
    pokemon: [],
  };
});
const abilities = abilitiesFull.map(({ effectEn, nerf, descZh, pokemon, typeKind, ...rest }) => rest);
const moves = movesFull.map(({ effectEn, descZh, accuracy, pp, officialCategory, pokemon, ...rest }) => rest);

// ---------- items ----------
const itemEntries = splitEntries(itemSrc, "item");
const items = itemEntries.map(({ id, body }) => {
  const type = body.match(/type\s*:\s*[`'"]([a-z]+)[`'"]/);
  const mv = camelWords(id);
  return {
    id,
    nameZh: dsItems.get(norm(mv)) || null,
    nameEn: mv,
    type: type ? type[1] : null,
  };
});

const uniq = (arr, key) => {
  const seen = new Set();
  return arr.filter((x) => (seen.has(x[key]) ? false : (seen.add(x[key]), true)));
};

const meta = {
  generatedAt: new Date().toISOString(),
  sources: { pokechill: POKECHILL, dataset: DATASET },
  types: TYPE_ZH,
  pokemon: uniq(pokemon, "id"),
  moves: uniq(moves, "id"),
  abilities: uniq(abilities, "id"),
  items: uniq(items, "id"),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(meta));

// ---------- wiki data ----------
const wikiPokemon = uniq(pokemon, "id").map((p) => ({
  id: p.id,
  dexNo: p.dexNo,
  gen: p.gen,
  nameZh: p.nameZh,
  nameEn: p.nameEn,
  types: p.types,
  division: p.division,
  bst: p.bst,
  hiddenAbility: p.hiddenAbility,
  signature: p.signature,
  eggMove: p.eggMove,
  evolvesTo: p.evolvesTo,
}));
const wikiAbilities = uniq(abilitiesFull, "id");
const wikiMoves = uniq(movesFull, "id");

for (const a of wikiAbilities) {
  a.pokemon = wikiPokemon.filter((p) => p.hiddenAbility === a.id).map((p) => p.id);
}
for (const m of wikiMoves) {
  m.pokemon = [];
  for (const p of wikiPokemon) {
    if (p.signature === m.id) m.pokemon.push({ id: p.id, kind: "signature" });
    if (p.eggMove === m.id) m.pokemon.push({ id: p.id, kind: "eggMove" });
  }
}

// TM items: item.<moveId>Tm
const tmByMove = new Map();
for (const it of items) {
  if (!it.id.endsWith("Tm") || it.id.length <= 2) continue;
  const mv = it.id.slice(0, -2);
  if (wikiMoves.some((m) => m.id === mv)) tmByMove.set(mv, it.id);
}
for (const m of wikiMoves) {
  m.tm = tmByMove.has(m.id);
  m.tmItem = tmByMove.get(m.id) || null;
}

const wikiMovesIndex = wikiMoves.map((m) => ({
  id: m.id,
  nameZh: m.nameZh,
  nameEn: m.nameEn,
  type: m.type,
  rarity: m.rarity,
  moveset: m.moveset,
  tm: m.tm,
}));
const isSpecialId = (id) =>
  /^(mega|gmax|primal|crystal|spiky|ultra)/i.test(id) || /(Clone|Gmax|Primal|Mega)$/i.test(id);
const isFinalForm = (p) => !(p.evolvesTo || []).some((t) => !isSpecialId(t));
const wikiPokemonIndex = wikiPokemon.map((p) => ({
  id: p.id,
  nameZh: p.nameZh,
  nameEn: p.nameEn,
  types: p.types,
  dexNo: p.dexNo,
  division: p.division,
  final: isFinalForm(p),
  special: isSpecialId(p.id),
}));

const wikiBase = { generatedAt: meta.generatedAt, types: TYPE_ZH };
const wikiNames = {
  pokemon: Object.fromEntries(wikiPokemon.map((p) => [p.id, [p.nameZh, p.nameEn]])),
  moves: Object.fromEntries(wikiMoves.map((m) => [m.id, [m.nameZh, m.nameEn]])),
  abilities: Object.fromEntries(wikiAbilities.map((a) => [a.id, [a.nameZh, a.nameEn]])),
};
fs.writeFileSync(path.join(ROOT, "data", "wiki-abilities.json"), JSON.stringify({ ...wikiBase, abilities: wikiAbilities }));
fs.writeFileSync(path.join(ROOT, "data", "wiki-moves.json"), JSON.stringify({ ...wikiBase, moves: wikiMoves }));
fs.writeFileSync(path.join(ROOT, "data", "wiki-pokemon.json"), JSON.stringify({ ...wikiBase, pokemon: wikiPokemon }));
fs.writeFileSync(path.join(ROOT, "data", "wiki-names.json"), JSON.stringify(wikiNames));
fs.writeFileSync(path.join(ROOT, "data", "wiki-moves-index.json"), JSON.stringify(wikiMovesIndex));
fs.writeFileSync(path.join(ROOT, "data", "wiki-pokemon-index.json"), JSON.stringify(wikiPokemonIndex));

const wikiStat = {
  abilities: wikiAbilities.length,
  abilityZh: wikiAbilities.filter((a) => a.nameZh).length,
  abilityDescZh: wikiAbilities.filter((a) => a.descZh).length,
  moves: wikiMoves.length,
  movesZh: wikiMoves.filter((m) => m.nameZh).length,
  movesDescZh: wikiMoves.filter((m) => m.descZh).length,
  tmMoves: wikiMoves.filter((m) => m.tm).length,
  pokemon: wikiPokemon.length,
};
console.log("wiki data:", wikiStat);

const stat = {
  pokemon: meta.pokemon.length,
  withZh: meta.pokemon.filter((p) => p.nameZh).length,
  withDex: meta.pokemon.filter((p) => p.dexNo).length,
  moves: meta.moves.length,
  abilities: meta.abilities.length,
  items: meta.items.length,
};
console.log("meta written:", OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + " KB");
console.log(stat);
