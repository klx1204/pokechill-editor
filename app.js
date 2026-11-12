"use strict";

/* ============================================================
   Pokechill save editor — pure client side
   ============================================================ */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const NATURES = [
  { id: "adamant", zh: "固执", en: "Adamant" },
  { id: "modest", zh: "内敛", en: "Modest" },
  { id: "jolly", zh: "爽朗", en: "Jolly" },
  { id: "relaxed", zh: "悠闲", en: "Relaxed" },
  { id: "quiet", zh: "冷静", en: "Quiet" },
  { id: "bold", zh: "大胆", en: "Bold" },
];

const state = {
  meta: null,
  raw: null,
  original: null,
  dirty: false,
  selected: null,
  page: 1,
  pageSize: 50,
  gen: "all",
  showAll: false,
  search: "",
  filters: {
    type: "all", type2: "all", level: "all", division: "all", evolution: "all",
    ability: "all", shiny: "all", signature: "all", ribbon: "all", sort: "dex",
  },
  tags: [],
  filtered: [],
  history: [],
  historyIndex: -1,
  theme: "dark",
  itemSearch: "",
  itemOwned: false,
  itemRawSearch: "",
};

const M = {
  pokemon: new Map(),
  pkmnList: [],
  moves: new Map(),
  moveList: [],
  abilities: new Map(),
  abilityList: [],
  items: new Map(),
  itemList: [],
  types: {},
  familyAdj: new Map(),
};

/* ================= helpers ================= */

const norm = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const typeZh = (t) => M.types[t] || t || "";
const natureZh = (id) => NATURES.find((n) => n.id === id)?.zh || id || "无";
const natureSelect = (id) =>
  NATURES.map((n) => `<option value="${n.id}" ${n.id === id ? "selected" : ""}>${n.zh} / ${n.en}</option>`).join("");

const fmtNum = (n) => (typeof n === "number" ? String(n) : "0");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, ms = 1800) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), ms);
}

function showModal(title, html, buttons = [{ label: "关闭", primary: true, close: true }]) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  const foot = $("#modalFoot");
  foot.innerHTML = "";
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = "btn" + (b.primary ? " primary" : " ghost");
    btn.textContent = b.label;
    btn.onclick = () => {
      const keep = b.onClick ? b.onClick() : false;
      if (!keep && b.close !== false) $("#modal").hidden = true;
    };
    foot.appendChild(btn);
  }
  $("#modal").hidden = false;
}

function download(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================= boot ================= */

async function boot() {
  initTheme();
  bindGlobal();
  renderFilters();

  try {
    const res = await fetch("data/meta.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    state.meta = await res.json();
  } catch (err) {
    $("#status").textContent = "meta.json 加载失败：" + err.message;
    showModal("无法加载数据", `<p>请确认 <code>data/meta.json</code> 存在，或运行 <code>node tools/build-meta.mjs</code> 重新生成。</p>`);
    return;
  }

  M.types = state.meta.types || {};
  for (const p of state.meta.pokemon) {
    M.pokemon.set(p.id, p);
    M.pkmnList.push(p);
  }
  for (const m of state.meta.moves) {
    M.moves.set(m.id, m);
    M.moveList.push(m);
  }
  for (const a of state.meta.abilities) {
    M.abilities.set(a.id, a);
    M.abilityList.push(a);
  }
  for (const i of state.meta.items) {
    M.items.set(i.id, i);
    M.itemList.push(i);
  }
  buildFamily();
  renderGenbar();
  renderFilters();
  setStatus("数据已就绪：" + M.pkmnList.length + " 只宝可梦 / " + M.moveList.length + " 招式");
  refresh();
}

function buildFamily() {
  for (const p of M.pkmnList) {
    if (!M.familyAdj.has(p.id)) M.familyAdj.set(p.id, new Set());
    for (const to of p.evolvesTo || []) {
      if (!M.familyAdj.has(to)) M.familyAdj.set(to, new Set());
      M.familyAdj.get(p.id).add(to);
      M.familyAdj.get(to).add(p.id);
    }
  }
}

function familyOf(id) {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.pop();
    for (const n of M.familyAdj.get(cur) || []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

function setStatus(text) {
  $("#status").textContent = text;
}

function setDirty(v) {
  state.dirty = v;
  $("#dirty").hidden = !v;
}

function updateHistoryButtons() {
  $("#btnUndo").disabled = state.historyIndex <= 0;
  $("#btnRedo").disabled = state.historyIndex >= state.history.length - 1;
}

/* ================= theme ================= */

function initTheme() {
  const saved = localStorage.getItem("pke-theme");
  setTheme(saved === "light" ? "light" : "dark");
}

function setTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("pke-theme", t);
  $("#btnTheme").textContent = t === "dark" ? "☾" : "☀";
}

/* ================= history ================= */

function commit() {
  if (!state.raw) return;
  const snap = structuredClone(state.raw);
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snap);
  if (state.history.length > 30) state.history.shift();
  state.historyIndex = state.history.length - 1;
  setDirty(true);
  updateHistoryButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  state.raw = structuredClone(state.history[state.historyIndex]);
  setDirty(true);
  updateHistoryButtons();
  refresh();
  renderDetail(state.selected);
  toast("已撤销");
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  state.raw = structuredClone(state.history[state.historyIndex]);
  setDirty(true);
  updateHistoryButtons();
  refresh();
  renderDetail(state.selected);
  toast("已重做");
}

/* ================= import / validate ================= */

async function importFile(file) {
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) {
    showModal("文件过大", "<p>存档文件不应该超过 30 MB，请确认选择了正确的 JSON。</p>");
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch (e) {
    showModal("读取失败", esc(e.message));
    return;
  }
  importText(text);
}

function importText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    showModal("JSON 解析失败", `<p class="warn">${esc(e.message)}</p><p>请确认导入的是游戏 <b>Export Data</b> 导出的文件。</p>`);
    return;
  }
  const { errors, warnings } = validateSave(data);
  if (errors.length) {
    showModal(
      "存档校验失败",
      `<p class="warn">发现 ${errors.length} 个错误，已阻止导入：</p><ul class="help">${errors.slice(0, 12).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>${errors.length > 12 ? `<p class="muted">…还有 ${errors.length - 12} 条</p>` : ""}`
    );
    return;
  }

  state.raw = data;
  state.original = structuredClone(data);
  state.selected = null;
  state.page = 1;
  state.tags = [];
  state.history = [structuredClone(data)];
  state.historyIndex = 0;
  setDirty(false);

  const counts = countEntries(data);
  setStatus(`已载入：${counts.pkmn} 只宝可梦 · ${counts.items} 个道具 · 存档版本 v${data.saved?.version ?? "?"}`);
  if (warnings.length) {
    showModal(
      "载入成功（有警告）",
      `<ul class="help">${warnings.slice(0, 10).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>${warnings.length > 10 ? `<p class="muted">…还有 ${warnings.length - 10} 条</p>` : ""}`
    );
  }
  $("#btnExport").disabled = false;
  $("#btnCopy").disabled = false;
  $("#btnRestore").disabled = false;
  updateHistoryButtons();

  renderBottles();
  renderItems();
  renderTagBar();
  refresh();
}

function countEntries(data) {
  let pkmn = 0;
  let items = 0;
  for (const [, v] of Object.entries(data)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    if ("caught" in v) pkmn++;
    else if ("got" in v && "newItem" in v) items++;
  }
  return { pkmn, items };
}

function isPkmnEntry(id, v) {
  return v && typeof v === "object" && !Array.isArray(v) && "caught" in v;
}

function isItemEntry(id, v) {
  return v && typeof v === "object" && !Array.isArray(v) && "got" in v && "newItem" in v;
}

function abilityFits(abilityId, p) {
  const a = M.abilities.get(abilityId);
  if (!a) return false;
  if (!a.types || a.types.length === 0) return true;
  if (a.types.includes("all")) return true;
  return a.types.some((t) => p.types.includes(t));
}

function validateSave(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["存档必须是 JSON 对象"], warnings };
  }
  if (!data.saved || typeof data.saved !== "object") errors.push("缺少 saved 对象");
  if (!data.team || typeof data.team !== "object") errors.push("缺少 team 对象");

  let pkmnCount = 0;
  let itemCount = 0;

  for (const [id, v] of Object.entries(data)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;

    if (isPkmnEntry(id, v)) {
      pkmnCount++;
      const p = M.pokemon.get(id);
      if (!p) {
        warnings.push(`未知宝可梦条目：${id}（将被保留，无法编辑）`);
        continue;
      }
      if (!Number.isInteger(v.level) || v.level < 1 || v.level > 100)
        errors.push(`${id}.level 必须是 1–100 的整数（当前 ${v.level}）`);
      if (typeof v.exp !== "number" || !Number.isFinite(v.exp) || v.exp < 0)
        errors.push(`${id}.exp 必须是非负数字（当前 ${v.exp}）`);
      else if (v.exp > 100) warnings.push(`${id}.exp = ${v.exp}，游戏会连续升级`);

      if (!v.ivs || typeof v.ivs !== "object") errors.push(`${id}.ivs 缺失`);
      else
        for (const k of ["hp", "atk", "def", "satk", "sdef", "spe"]) {
          const x = v.ivs[k];
          if (!Number.isInteger(x) || x < 0 || x > 6) errors.push(`${id}.ivs.${k} 必须是 0–6（当前 ${x}）`);
        }

      if (!v.moves || typeof v.moves !== "object") errors.push(`${id}.moves 缺失`);
      else {
        const used = new Set();
        for (const slot of ["slot1", "slot2", "slot3", "slot4"]) {
          const mv = v.moves[slot];
          if (mv == null) continue;
          if (typeof mv !== "string" || !M.moves.has(mv)) errors.push(`${id}.moves.${slot} 不是合法招式：${mv}`);
          else if (used.has(mv)) warnings.push(`${id} 重复装备了招式 ${mv}`);
          else used.add(mv);
        }
        if (Array.isArray(v.movepool)) {
          for (const mv of used) if (!v.movepool.includes(mv)) warnings.push(`${id} 的 ${mv} 不在招式池中`);
        }
      }

      if (!Array.isArray(v.movepool)) errors.push(`${id}.movepool 必须是数组`);
      else {
        const seen = new Set();
        for (const mv of v.movepool) {
          if (typeof mv !== "string" || !M.moves.has(mv)) errors.push(`${id}.movepool 含非法招式：${mv}`);
          if (seen.has(mv)) warnings.push(`${id}.movepool 有重复招式 ${mv}`);
          seen.add(mv);
        }
        if (v.movepool.length > 20) warnings.push(`${id}.movepool 有 ${v.movepool.length} 招（超过 20 后 Move Training 失效）`);
      }

      if (v.ability != null && !M.abilities.has(v.ability)) errors.push(`${id}.ability 不合法：${v.ability}`);
      else if (v.ability && !abilityFits(v.ability, p)) warnings.push(`${id}.ability 与属性不匹配：${v.ability}`);

      if (v.hiddenAbilityUnlocked === true && !p.hiddenAbility)
        errors.push(`${id} 没有隐藏特性，不能解锁`);

      if (v.nature != null && v.nature !== "" && !NATURES.some((n) => n.id === v.nature))
        errors.push(`${id}.nature 不合法：${v.nature}`);

      if (v.shiny != null && typeof v.shiny !== "boolean") errors.push(`${id}.shiny 必须是布尔值`);
      if (v.caught != null && (!Number.isInteger(v.caught) || v.caught < 0))
        errors.push(`${id}.caught 必须是非负整数`);

      if (!v.moves || !v.ivs || !Array.isArray(v.movepool)) {
        // already reported above
      }
    } else if (isItemEntry(id, v)) {
      itemCount++;
      if (!M.items.has(id)) warnings.push(`未知道具条目：${id}`);
      if (!Number.isInteger(v.got) || v.got < 0) errors.push(`${id}.got 必须是非负整数`);
      if (!Number.isInteger(v.newItem) || v.newItem < 0) errors.push(`${id}.newItem 必须是非负整数`);
      if (v.got > 9999 || v.newItem > 9999) warnings.push(`${id} 的数量超过 9999`);
    }
  }

  if (pkmnCount === 0) errors.push("没有找到任何宝可梦条目（caught）");
  if (itemCount === 0) errors.push("没有找到任何道具条目（got/newItem）");
  return { errors, warnings };
}

/* ================= filters ================= */

function renderFilters() {
  const typeOptions =
    `<option value="all">属性</option>` +
    Object.entries(M.types || {})
      .map(([k, zh]) => `<option value="${k}">${zh} / ${k}</option>`)
      .join("");
  $("#fType").innerHTML = typeOptions;
  $("#fType2").innerHTML = typeOptions.replace(">属性<", ">属性 2<");
}

function renderGenbar() {
  const el = $("#genbar");
  const gens = ["all", 1, 2, 3, 4, 5, 6, 7, 8, 9];
  el.innerHTML = gens
    .map((g) => `<button data-gen="${g}" class="${g === state.gen ? "active" : ""}">${g === "all" ? "全部" : "Gen " + g}</button>`)
    .join("");
  el.onclick = (e) => {
    const b = e.target.closest("button[data-gen]");
    if (!b) return;
    state.gen = b.dataset.gen === "all" ? "all" : Number(b.dataset.gen);
    state.page = 1;
    $$("button", el).forEach((x) => x.classList.toggle("active", x === b));
    refreshList();
  };
}

function refresh() {
  refreshList();
  renderItems();
  renderBottles();
  renderTagBar();
}

function applyFilters() {
  const raw = state.raw;
  if (!raw) return [];
  const f = state.filters;
  return M.pkmnList.filter((p) => {
    const e = raw[p.id];
    if (!e) return false;
    if (!state.showAll && !(e.caught > 0)) return false;
    if (state.gen !== "all" && p.gen !== state.gen) return false;

    if (f.type !== "all" && !p.types.includes(f.type)) return false;
    if (f.type2 !== "all" && !p.types.includes(f.type2)) return false;
    if (f.level !== "all") {
      const max = Number(f.level);
      if (!(e.level <= max && e.level >= max - 19)) return false;
    }
    if (f.division !== "all" && p.division !== f.division) return false;
    if (f.ability !== "all") {
      if (f.ability === "4") {
        if (!p.hiddenAbility || e.hiddenAbilityUnlocked === true) return false;
      } else {
        const a = M.abilities.get(e.ability);
        if (!a || String(a.rarity) !== String(f.ability)) return false;
      }
    }

    if (f.evolution !== "all") {
      const evo = p.evolves || [];
      const missingAll = evo.some((x) => (raw[x.id]?.caught ?? 0) === 0);
      const missingLevel = evo.some((x) => x.level && (raw[x.id]?.caught ?? 0) === 0);
      if (f.evolution === "true" && !missingAll) return false;
      if (f.evolution === "level-only" && !missingLevel) return false;
    }

    if (f.shiny !== "all") {
      if (f.shiny === "true" && !e.shiny) return false;
      if (f.shiny === "false" && e.shiny) return false;
      if (f.shiny === "sign" && (!Array.isArray(e.starsignList) || !e.shiny)) return false;
      if (f.shiny === "signall" && (!Array.isArray(e.starsignList) || e.starsignList.length < 6)) return false;
    }

    if (f.signature !== "all") {
      if (f.signature === "signature" && !p.signature) return false;
      if (f.signature === "egg" && !p.eggMove) return false;
    }

    if (f.ribbon !== "all" && !(Array.isArray(e.ribbons) && e.ribbons.length)) return false;

    if (state.tags.length) {
      const list = Array.isArray(e.tagList) ? e.tagList : [];
      const hit = state.tags.some((t) => list.some((x) => x.name === t.name && x.color === t.color));
      if (!hit) return false;
    }
    return true;
  });
}

function parseQuery(q) {
  const orGroups = q.split(/\s+or\s+/i).map((g) => g.trim()).filter(Boolean);
  const parseGroup = (text) => {
    const tokens = text.split(/\s+/).filter(Boolean);
    const inc = [];
    const exc = [];
    const num = [];
    for (const t of tokens) {
      const m = t.match(/^(ivsum|dictionaryTagIvSum)(>=|<=|>|<|=|==)(\d+)$/i);
      if (m) num.push({ op: m[2], value: Number(m[3]) });
      else if (t.startsWith("!") && t.length > 1) exc.push(t.slice(1));
      else inc.push(t);
    }
    return { inc, exc, num };
  };
  return orGroups.map(parseGroup);
}

function termHaystack(p, e) {
  const parts = [
    p.nameZh, p.nameEn, p.id, p.dexNo != null ? String(p.dexNo) : "",
    ...p.types, ...p.types.map((t) => typeZh(t)),
    e.ability, e.ability ? M.abilities.get(e.ability)?.nameZh : "",
    p.hiddenAbility, p.hiddenAbility ? M.abilities.get(p.hiddenAbility)?.nameZh : "",
    p.signature, p.signature ? M.moves.get(p.signature)?.nameZh : "",
    p.eggMove, p.eggMove ? M.moves.get(p.eggMove)?.nameZh : "",
    ...(Array.isArray(e.movepool) ? e.movepool : []),
    ...(Array.isArray(e.movepool) ? e.movepool.map((m) => M.moves.get(m)?.nameZh) : []),
    e.shiny ? "shiny" : "", e.pokerus ? "pokerus" : "",
    p.signature ? "signature" : "", p.eggMove ? "eggMove" : "",
    String(e.level ?? ""),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function termMatches(p, e, term) {
  const hay = termHaystack(p, e);
  const t = String(term).toLowerCase();
  if (hay.includes(t)) return true;
  const n = norm(term);
  return n.length > 0 && norm(hay).includes(n);
}

function isAbilityOrMoveTerm(term) {
  return M.abilities.has(term) || M.moves.has(term);
}

function ivSum(e) {
  if (!e.ivs) return 0;
  return ["hp", "atk", "def", "satk", "sdef", "spe"].reduce((a, k) => a + (e.ivs[k] || 0), 0);
}

function applySearch(list, query) {
  const groups = parseQuery(query);
  const raw = state.raw;
  let results = [];

  for (const g of groups.length ? groups : [{ inc: [], exc: [], num: [] }]) {
    let base;
    if (g.inc.length === 0) base = list.slice();
    else {
      // AND within a group
      base = list.filter((p) => g.inc.every((term) => termMatches(p, raw[p.id], term)));
    }
    if (g.exc.length) {
      base = base.filter((p) => !g.exc.some((term) => termMatches(p, raw[p.id], term)));
    }
    if (g.num.length) {
      base = base.filter((p) => {
        const v = ivSum(raw[p.id]);
        return g.num.every((n) => {
          switch (n.op) {
            case ">": return v > n.value;
            case "<": return v < n.value;
            case ">=": return v >= n.value;
            case "<=": return v <= n.value;
            case "=": case "==": return v === n.value;
            default: return true;
          }
        });
      });
    }
    results.push(...base);
  }

  // dedupe
  const seen = new Set();
  results = results.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  // evolution family expansion, unless numeric filter or ability/move term
  const hasNumeric = groups.some((g) => g.num.length);
  const hasAbilityOrMove = groups.some((g) => g.inc.some(isAbilityOrMoveTerm));
  if (!hasNumeric && !hasAbilityOrMove && results.length && results.length < 40) {
    const fam = new Set();
    for (const p of results) for (const id of familyOf(p.id)) fam.add(id);
    results = [...fam].map((id) => M.pokemon.get(id)).filter(Boolean);
  }
  return results;
}

function sortList(list) {
  const s = state.filters.sort;
  const raw = state.raw;
  const totalOf = (p, stat) => {
    const e = raw[p.id];
    const bst = p.bst?.[stat] ?? 1;
    const iv = e?.ivs?.[stat] ?? 0;
    return bst * 30 * Math.pow(1.1, iv);
  };
  if (s === "dex") {
    list.sort((a, b) => (a.dexNo ?? 99999) - (b.dexNo ?? 99999) || a.id.localeCompare(b.id));
  } else if (s === "level") {
    list.sort((a, b) => (raw[b.id]?.level || 0) - (raw[a.id]?.level || 0));
  } else if (s.endsWith("Total")) {
    const st = s.slice(0, -5);
    list.sort((a, b) => totalOf(b, st) - totalOf(a, st));
  } else if (s.endsWith("Bst")) {
    const st = s.slice(0, -3);
    list.sort((a, b) => (b.bst?.[st] || 0) - (a.bst?.[st] || 0));
  } else if (s.endsWith("Iv")) {
    const st = s.slice(0, -2);
    list.sort((a, b) => (raw[b.id]?.ivs?.[st] || 0) - (raw[a.id]?.ivs?.[st] || 0));
  }
  return list;
}

function refreshList() {
  if (!state.raw) {
    $("#pkmnList").innerHTML = `<div class="empty" style="height:40vh"><p>还没有载入存档</p></div>`;
    $("#pageInfo").textContent = "";
    $("#resultCount").textContent = "";
    return;
  }
  let list = applyFilters();
  const q = state.search.trim();
  if (q) list = applySearch(list, q);
  sortList(list);
  state.filtered = list;

  const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;

  $("#resultCount").textContent = `${list.length} 只`;
  renderList();
}

function renderList() {
  const el = $("#pkmnList");
  const start = (state.page - 1) * state.pageSize;
  const slice = state.filtered.slice(start, start + state.pageSize);
  if (!slice.length) {
    el.innerHTML = `<div class="empty" style="height:40vh"><p>没有匹配的宝可梦</p><p class="muted">试试清除筛选或切换「显示未捕获」</p></div>`;
    $("#pageInfo").textContent = "";
    return;
  }
  const raw = state.raw;
  el.innerHTML = slice
    .map((p) => {
      const e = raw[p.id] || {};
      const no = p.dexNo != null ? "#" + String(p.dexNo).padStart(4, "0") : "—";
      const stars = e.shiny ? `<span class="pill star">★</span>` : "";
      const ha = e.hiddenAbilityUnlocked ? `<span class="pill ha">HA</span>` : "";
      return `<div class="pkmn-row ${state.selected === p.id ? "selected" : ""}" data-id="${p.id}">
        <span class="no">${no}</span>
        <div class="names">
          <div class="zh">${esc(p.nameZh || p.nameEn || p.id)}</div>
          <div class="en">${esc(p.nameEn || p.id)}${p.nameZh ? "" : " · " + esc(p.id)}</div>
        </div>
        <div class="meta"><span>Lv.${e.level ?? "-"}</span>${stars}${ha}</div>
      </div>`;
    })
    .join("");
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  $("#pageInfo").textContent = `第 ${state.page} / ${pages} 页 · 共 ${state.filtered.length} 条`;
}

/* ================= detail ================= */

function isPhonePortrait() {
  return window.matchMedia("(max-width: 720px) and (orientation: portrait)").matches;
}

function openDetailOverlay() {
  const d = $("#detail");
  if (isPhonePortrait()) d.classList.add("open");
}

function closeDetailOverlay() {
  $("#detail").classList.remove("open");
}

function renderDetail(id) {
  if (!id || !state.raw || !M.pokemon.has(id)) {
    $("#detailEmpty").hidden = false;
    $("#detailBody").hidden = true;
    $("#detailBody").innerHTML = "";
    return;
  }
  const p = M.pokemon.get(id);
  const e = state.raw[id];
  if (!e) return;
  state.selected = id;

  // ensure defaults without mutating until edit
  const ivs = e.ivs || {};
  const moves = e.moves || {};
  const movepool = Array.isArray(e.movepool) ? e.movepool : [];

  const signature = p.signature ? M.moves.get(p.signature) : null;
  const eggMove = p.eggMove ? M.moves.get(p.eggMove) : null;
  const hidden = p.hiddenAbility ? M.abilities.get(p.hiddenAbility) : null;

  const html = `
    <div class="detail-head">
      <div>
        <div class="no">${p.dexNo != null ? "#" + String(p.dexNo).padStart(4, "0") : "—"} ${p.gen ? "· Gen " + p.gen : ""} · ${p.division || "-"}</div>
        <h2>${esc(p.nameZh || p.nameEn || p.id)}</h2>
        <div class="en">${esc(p.nameEn || p.id)} · ${esc(p.id)}</div>
      </div>
      <button class="btn small ghost detail-close" id="detailBack">返回</button>
    </div>

    <div class="form-grid">
      <div class="field">
        <label>等级</label>
        <input class="input" type="number" min="1" max="100" step="1" id="fldLevel" value="${e.level ?? 1}" inputmode="numeric">
      </div>
      <div class="field">
        <label>经验（0–99）</label>
        <input class="input" type="number" min="0" max="99" step="0.5" id="fldExp" value="${e.exp ?? 0}" inputmode="decimal">
      </div>
      <div class="field">
        <label>性格</label>
        <select class="select" id="fldNature">
          <option value="">无</option>
          ${natureSelect(e.nature)}
        </select>
      </div>
      <div class="field">
        <label>捕获数量 / caught</label>
        <input class="input" type="number" min="0" step="1" id="fldCaught" value="${e.caught ?? 0}" inputmode="numeric">
      </div>
      <div class="field span2">
        <label>昵称</label>
        <input class="input" id="fldNickname" maxlength="24" value="${esc(e.nickname ?? "")}">
      </div>
      <label class="switch span2"><input type="checkbox" id="fldShiny" ${e.shiny ? "checked" : ""}> 闪光</label>
    </div>

    <div class="section">
      <h4>IV（0–6）</h4>
      <div class="iv-grid">
        ${["hp", "atk", "def", "satk", "sdef", "spe"]
          .map((k) => `<div class="field"><label>${k}</label><input class="input" type="number" min="0" max="6" step="1" data-iv="${k}" value="${ivs[k] ?? 0}" inputmode="numeric"></div>`)
          .join("")}
      </div>
    </div>

    <div class="section">
      <h4>招式（4 槽）</h4>
      <div id="moveSlots">
        ${["slot1", "slot2", "slot3", "slot4"]
          .map((slot, i) => `<div class="move-row"><span>${i + 1}</span><div class="combo" data-combo="move" data-slot="${slot}"></div></div>`)
          .join("")}
      </div>
    </div>

    <div class="section">
      <h4>招式池（${movepool.length}）</h4>
      <div class="movepool" id="movepool">
        ${movepool.length ? movepool.map((m) => `<span class="chip" data-move="${m}">${esc(M.moves.get(m)?.nameZh || M.moves.get(m)?.nameEn || m)}</span>`).join("") : `<span class="muted">空</span>`}
      </div>
    </div>

    <div class="section">
      <h4>特性</h4>
      <div class="form-grid">
        <div class="field span2">
          <label>按属性筛选特性池</label>
          <select class="select" id="abilityTypeFilter">
            <option value="all">全部属性</option>
            <option value="none">无属性限制</option>
            ${Object.entries(M.types).map(([k, zh]) => `<option value="${k}">${zh} / ${k}</option>`).join("")}
          </select>
        </div>
        <div class="field span2">
          <label>普通特性</label>
          <div class="combo" data-combo="ability" data-slot="ability"></div>
        </div>
        <label class="switch span2"><input type="checkbox" id="fldHa" ${e.hiddenAbilityUnlocked ? "checked" : ""} ${hidden ? "" : "disabled"}> 解锁隐藏特性${hidden ? `：${esc(hidden.nameZh || hidden.nameEn)}` : "（无）"}</label>
      </div>
    </div>

    <div class="section">
      <h4>专属 / 蛋招式（游戏数据，只读）</h4>
      <div class="special-row">
        <span class="label">专属：</span><span>${signature ? esc(signature.nameZh || signature.nameEn) : "—"}</span>
        <button class="btn small" id="btnAddSignature" ${!signature || movepool.includes(p.signature) ? "disabled" : ""}>加入招式池</button>
      </div>
      <div class="special-row" style="margin-top:.4rem">
        <span class="label">蛋招式：</span><span>${eggMove ? esc(eggMove.nameZh || eggMove.nameEn) : "—"}</span>
        <button class="btn small" id="btnAddEgg" ${!eggMove || movepool.includes(p.eggMove) ? "disabled" : ""}>加入招式池</button>
      </div>
    </div>
  `;

  $("#detailEmpty").hidden = true;
  $("#detailBody").hidden = false;
  $("#detailBody").innerHTML = html;

  bindDetail(p, e);
  if (isPhonePortrait()) openDetailOverlay();
}

function bindDetail(p, e) {
  const body = $("#detailBody");

  $("#detailBack", body).onclick = () => closeDetailOverlay();

  const setNum = (sel, key, min, max, round = true) => {
    const el = $(sel, body);
    el.onchange = () => {
      let v = Number(el.value);
      if (!Number.isFinite(v)) v = min;
      v = round ? Math.round(v) : Math.round(v * 10) / 10;
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      e[key] = v;
      commit();
      refreshList();
    };
  };
  setNum("#fldLevel", "level", 1, 100);
  setNum("#fldExp", "exp", 0, 99, false);
  setNum("#fldCaught", "caught", 0, 999999);

  $("#fldNickname", body).onchange = (ev) => {
    const v = ev.target.value.trim();
    if (v) e.nickname = v;
    else delete e.nickname;
    commit();
  };
  $("#fldShiny", body).onchange = (ev) => {
    if (ev.target.checked) e.shiny = true;
    else delete e.shiny;
    commit();
    refreshList();
  };
  $("#fldNature", body).onchange = (ev) => {
    if (ev.target.value) e.nature = ev.target.value;
    else delete e.nature;
    commit();
  };

  for (const input of $$("input[data-iv]", body)) {
    input.onchange = () => {
      const k = input.dataset.iv;
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(6, v));
      input.value = v;
      if (!e.ivs) e.ivs = {};
      e.ivs[k] = v;
      commit();
      refreshList();
    };
  }

  // move slot comboboxes
  for (const combo of $$('[data-combo="move"]', body)) {
    const slot = combo.dataset.slot;
    const cur = e.moves?.[slot] || "";
    makeCombo(combo, {
      value: cur,
      placeholder: "搜索招式（中文 / 英文）",
      options: M.moveList.map((m) => ({
        value: m.id,
        zh: m.nameZh,
        en: m.nameEn,
        extra: `${typeZh(m.type)}${m.power != null ? " · " + m.power : ""}${m.split ? " · " + m.split : ""}`,
      })),
      allowEmpty: true,
      onChange: (v) => {
        if (!e.moves) e.moves = { slot1: null, slot2: null, slot3: null, slot4: null };
        e.moves[slot] = v || null;
        commit();
        refreshList();
      },
    });
  }

  // ability combo with type filter
  const abilityCombo = $('[data-combo="ability"]', body);
  const abilityTypeSel = $("#abilityTypeFilter", body);
  const abilityOptions = (filter) =>
    M.abilityList
      .filter((a) => {
        if (a.id === e.ability) return true;
        if (filter === "all") return true;
        if (filter === "none") return !a.types || a.types.length === 0;
        return !a.types || a.types.length === 0 || a.types.includes("all") || a.types.includes(filter);
      })
      .map((a) => ({
        value: a.id,
        zh: a.nameZh,
        en: a.nameEn,
        extra: [a.rarity ? `★${a.rarity}` : "", a.types?.length ? a.types.map(typeZh).join("/") : "无限制"].filter(Boolean).join(" · "),
        fits: abilityFits(a.id, p),
      }));
  const renderAbilityCombo = () => {
    makeCombo(abilityCombo, {
      value: e.ability || "",
      placeholder: "搜索特性（中文 / 英文）",
      options: abilityOptions(abilityTypeSel.value),
      allowEmpty: false,
      sortFits: true,
      onChange: (v) => {
        if (v) e.ability = v;
        commit();
      },
    });
  };
  abilityTypeSel.onchange = renderAbilityCombo;
  renderAbilityCombo();

  $("#fldHa", body).onchange = (ev) => {
    if (ev.target.checked) e.hiddenAbilityUnlocked = true;
    else delete e.hiddenAbilityUnlocked;
    commit();
    refreshList();
  };

  // add signature / egg move
  const addMove = (moveId, btn) => {
    if (!moveId) return;
    if (!Array.isArray(e.movepool)) e.movepool = [];
    if (!e.movepool.includes(moveId)) e.movepool.push(moveId);
    if (!e.moves) e.moves = { slot1: null, slot2: null, slot3: null, slot4: null };
    for (const slot of ["slot1", "slot2", "slot3", "slot4"]) {
      if (!e.moves[slot]) {
        e.moves[slot] = moveId;
        break;
      }
    }
    commit();
    renderDetail(p.id);
    refreshList();
    toast("已加入招式池");
  };
  $("#btnAddSignature", body).onclick = (ev) => addMove(p.signature, ev.target);
  $("#btnAddEgg", body).onclick = (ev) => addMove(p.eggMove, ev.target);

  // clicking a movepool chip equips it into the first empty slot
  $("#movepool", body).onclick = (ev) => {
    const chip = ev.target.closest("[data-move]");
    if (!chip) return;
    const mv = chip.dataset.move;
    if (!e.moves) e.moves = { slot1: null, slot2: null, slot3: null, slot4: null };
    for (const slot of ["slot1", "slot2", "slot3", "slot4"]) {
      if (!e.moves[slot]) {
        e.moves[slot] = mv;
        commit();
        renderDetail(p.id);
        refreshList();
        return;
      }
    }
    toast("4 个招式槽已满");
  };
}

/* ================= combobox ================= */

let openCombo = null;

function makeCombo(container, { value, placeholder, options, allowEmpty, onChange, sortFits }) {
  const current = options.find((o) => o.value === value);
  container.innerHTML = `<input class="input" autocomplete="off" placeholder="${esc(placeholder)}" value="${esc(current?.zh || current?.en || "")}"><div class="combo-list" hidden></div>`;
  const input = $("input", container);
  const list = $(".combo-list", container);
  let active = -1;
  let filtered = [];

  const label = (o) => `${o.zh || o.en}${o.zh && o.en ? " / " + o.en : ""}`;

  function open() {
    if (openCombo && openCombo !== closeThis) openCombo();
    openCombo = closeThis;
    render(input.value);
    list.hidden = false;
  }
  function closeThis() {
    list.hidden = true;
    if (openCombo === closeThis) openCombo = null;
  }

  function render(q) {
    const n = norm(q);
    const terms = String(q).trim().toLowerCase();
    let items = options.filter((o) => {
      if (!terms) return true;
      const hay = `${o.zh || ""} ${o.en || ""} ${o.value}`.toLowerCase();
      return hay.includes(terms) || (n && norm(hay).includes(n));
    });
    if (sortFits) items = items.slice().sort((a, b) => (b.fits ? 1 : 0) - (a.fits ? 1 : 0));
    filtered = items.slice(0, 80);
    if (allowEmpty) {
      filtered.unshift({ value: "", zh: "（空）", en: "", extra: "" });
    }
    active = filtered.length ? 0 : -1;
    list.innerHTML = filtered.length
      ? filtered
          .map(
            (o, i) =>
              `<div class="combo-item ${i === active ? "active" : ""}" data-i="${i}">
                 <div class="c-zh">${esc(o.zh || o.en)}${o.fits === false ? ' <span class="muted">（属性不匹配）</span>' : ""}</div>
                 <div class="c-en">${esc(o.en || "")}${o.extra ? " · " + esc(o.extra) : ""}</div>
               </div>`
          )
          .join("")
      : `<div class="combo-empty">没有匹配项</div>`;
  }

  function pick(i) {
    const o = filtered[i];
    if (!o) return;
    input.value = o.value ? label(o) : "";
    closeThis();
    onChange(o.value);
  }

  input.onfocus = open;
  input.oninput = () => open();
  input.onkeydown = (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      active = Math.min(filtered.length - 1, active + 1);
      updateActive();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      active = Math.max(0, active - 1);
      updateActive();
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      pick(active);
    } else if (ev.key === "Escape") {
      closeThis();
      input.blur();
    }
  };

  function updateActive() {
    $$(".combo-item", list).forEach((el, i) => el.classList.toggle("active", i === active));
    const el = $$(".combo-item", list)[active];
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  list.onmousedown = (ev) => {
    ev.preventDefault();
    const item = ev.target.closest(".combo-item");
    if (item) pick(Number(item.dataset.i));
  };
}

document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".combo")) {
    if (openCombo) openCombo();
  }
});

/* ================= items ================= */

function itemMatches(it, q) {
  if (!q) return true;
  const hay = `${it.nameZh || ""} ${it.nameEn || ""} ${it.id}`.toLowerCase();
  const n = norm(q);
  return hay.includes(q.toLowerCase()) || (n.length > 0 && norm(hay).includes(n));
}

function renderBottles() {
  if (!state.raw) return;
  const cards = [
    { id: "bottleCap", zh: "银色瓶盖", en: "Bottle Cap" },
    { id: "goldenBottleCap", zh: "金色瓶盖", en: "Golden Bottle Cap" },
  ];
  $("#bottleCards").innerHTML = cards
    .map((c) => {
      const v = state.raw[c.id] || {};
      return `<div class="bottle-card">
        <div>
          <div class="bc-name">${c.zh}</div>
          <div class="bc-en">${c.en} · ${c.id}</div>
        </div>
        <input class="input" type="number" min="0" step="1" data-bottle="${c.id}" value="${v.got ?? 0}" inputmode="numeric">
      </div>`;
    })
    .join("");
  for (const input of $$("[data-bottle]", $("#bottleCards"))) {
    input.onchange = () => {
      const id = input.dataset.bottle;
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, v);
      input.value = v;
      if (!state.raw[id]) state.raw[id] = { got: 0, newItem: 0 };
      state.raw[id].got = v;
      commit();
      renderItems();
    };
  }
}

function renderItems() {
  if (!state.raw) return;
  const q = state.itemSearch.trim();
  let list = M.itemList.filter((it) => {
    const v = state.raw[it.id];
    if (state.itemOwned && !(v && v.got > 0)) return false;
    return itemMatches(it, q);
  });
  list = list.slice().sort((a, b) => {
    const av = state.raw[a.id]?.got || 0;
    const bv = state.raw[b.id]?.got || 0;
    if (av > 0 !== bv > 0) return av > 0 ? -1 : 1;
    return 0;
  });
  $("#itemCount").textContent = `${list.length} 个`;
  $("#itemList").innerHTML = list
    .map((it) => {
      const v = state.raw[it.id] || { got: 0, newItem: 0 };
      return `<div class="item-row ${v.got > 0 ? "owned" : ""}" data-item="${it.id}">
        <div>
          <div class="i-zh">${esc(it.nameZh || it.nameEn || it.id)}</div>
          <div class="i-en">${esc(it.nameEn || it.id)} · ${esc(it.id)} <span class="i-type">${esc(it.type || "")}</span></div>
        </div>
        <input class="input" type="number" min="0" step="1" data-item-got="${it.id}" value="${v.got ?? 0}" inputmode="numeric" title="got">
        <input class="input" type="number" min="0" step="1" data-item-new="${it.id}" value="${v.newItem ?? 0}" inputmode="numeric" title="newItem">
      </div>`;
    })
    .join("");

  for (const input of $$("[data-item-got]", $("#itemList"))) {
    input.onchange = () => {
      const id = input.dataset.itemGot;
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = 0;
      input.value = Math.max(0, v);
      if (!state.raw[id]) state.raw[id] = { got: 0, newItem: 0 };
      state.raw[id].got = Math.max(0, v);
      commit();
      if (state.itemOwned) renderItems();
    };
  }
  for (const input of $$("[data-item-new]", $("#itemList"))) {
    input.onchange = () => {
      const id = input.dataset.itemNew;
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = 0;
      input.value = Math.max(0, v);
      if (!state.raw[id]) state.raw[id] = { got: 0, newItem: 0 };
      state.raw[id].newItem = Math.max(0, v);
      commit();
    };
  }
}

/* ================= tags ================= */

function tagsAvailable() {
  const t = state.raw?.saved?.tagSystemTags;
  return Array.isArray(t) ? t : [];
}

function renderTagBar() {
  const tags = tagsAvailable();
  const bar = $("#tagBar");
  if (!tags.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = tags
    .map(
      (t, i) =>
        `<span class="tag-chip ${state.tags.some((x) => x.name === t.name && x.color === t.color) ? "active" : ""}" data-tag-i="${i}" style="border-color:${esc(t.color || "")}">${esc(t.name)}</span>`
    )
    .join("");
  bar.onclick = (ev) => {
    const chip = ev.target.closest("[data-tag-i]");
    if (!chip) return;
    const t = tags[Number(chip.dataset.tagI)];
    if (!t) return;
    const idx = state.tags.findIndex((x) => x.name === t.name && x.color === t.color);
    if (idx >= 0) state.tags.splice(idx, 1);
    else state.tags.push(t);
    state.page = 1;
    renderTagBar();
    refreshList();
    if (!$("#tagModal").hidden) renderTagModal();
  };
}

function renderTagModal() {
  const tags = tagsAvailable();
  $("#tagList").innerHTML = tags.length
    ? tags
        .map(
          (t, i) =>
            `<span class="tag-chip ${state.tags.some((x) => x.name === t.name && x.color === t.color) ? "active" : ""}" data-tag-i="${i}" style="border-color:${esc(t.color || "")}; margin:.2rem">${esc(t.name)}</span>`
        )
        .join("")
    : `<p class="muted">存档里没有标签（saved.tagSystemTags 为空）。</p>`;
  $("#tagList").onclick = (ev) => {
    const chip = ev.target.closest("[data-tag-i]");
    if (!chip) return;
    const t = tags[Number(chip.dataset.tagI)];
    if (!t) return;
    const idx = state.tags.findIndex((x) => x.name === t.name && x.color === t.color);
    if (idx >= 0) state.tags.splice(idx, 1);
    else state.tags.push(t);
    state.page = 1;
    renderTagModal();
    renderTagBar();
    refreshList();
  };}

/* ================= export ================= */

function exportJSON() {
  if (!state.raw) return;
  const { errors, warnings } = validateSave(state.raw);
  if (errors.length) {
    showModal(
      "导出被阻止",
      `<p class="warn">有 ${errors.length} 个错误需要先修复：</p><ul class="help">${errors.slice(0, 15).map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`
    );
    return;
  }
  if (warnings.length) {
    showModal(
      "有警告，仍要导出吗？",
      `<ul class="help">${warnings.slice(0, 12).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`,
      [
        { label: "取消", ghost: true },
        { label: "仍然导出", primary: true, onClick: () => { doExport(); return false; } },
      ]
    );
    return;
  }
  doExport();
}

function doExport() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const text = JSON.stringify(state.raw);
  download(`Pokechill-edited-${ymd}.json`, text);
  setDirty(false);
  toast("已导出 JSON");
}

async function copyText() {
  if (!state.raw) return;
  const text = JSON.stringify(state.raw);
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
  } catch {
    showModal("复制失败", `<p>浏览器拒绝了剪贴板权限。可以改用「导出 JSON」，或手动全选下面的文本：</p><textarea style="width:100%;height:8rem" readonly>${esc(text)}</textarea>`);
  }
}

function restoreOriginal() {
  if (!state.original) return;
  showModal("还原原始存档？", "<p>当前所有修改都会丢失，恢复到刚导入时的状态。</p>", [
    { label: "取消", ghost: true },
    {
      label: "还原",
      primary: true,
      onClick: () => {
        state.raw = structuredClone(state.original);
        state.history = [structuredClone(state.original)];
        state.historyIndex = 0;
        setDirty(false);
        updateHistoryButtons();
        state.tags = [];
        refresh();
        renderDetail(state.selected);
        toast("已还原");
        return false;
      },
    },
  ]);
}

/* ================= quick actions ================= */

function quickAction(fn, label) {
  if (!state.raw) return;
  showModal(label, "<p>此操作会修改所有已捕获的宝可梦，可在之后撤销。</p>", [
    { label: "取消", ghost: true },
    {
      label: "执行",
      primary: true,
      onClick: () => {
        fn();
        commit();
        refresh();
        toast("完成");
        return false;
      },
    },
  ]);
}

/* ================= global bindings ================= */

function bindGlobal() {
  $("#btnTheme").onclick = () => setTheme(state.theme === "dark" ? "light" : "dark");
  $("#btnImport").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = (ev) => {
    importFile(ev.target.files[0]);
    ev.target.value = "";
  };
  $("#btnExport").onclick = exportJSON;
  $("#btnCopy").onclick = copyText;
  $("#btnRestore").onclick = restoreOriginal;
  $("#btnUndo").onclick = undo;
  $("#btnRedo").onclick = redo;
  updateHistoryButtons();

  // tabs
  $$(".tab").forEach((tab) => {
    tab.onclick = () => {
      $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      const name = tab.dataset.tab;
      for (const p of $$(".panel")) p.hidden = p.id !== "panel-" + name;
      if (name === "items") renderItems();
    };
  });

  // modals
  document.addEventListener("click", (ev) => {
    const close = ev.target.closest("[data-close]");
    if (close) $("#" + close.dataset.close).hidden = true;
  });
  for (const m of $$(".modal")) {
    m.onclick = (ev) => {
      if (ev.target === m) m.hidden = true;
    };
  }

  // filters
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  $("#search").oninput = debounce((ev) => {
    state.search = ev.target.value;
    state.page = 1;
    refreshList();
  }, 160);

  const bindFilter = (sel, key) => {
    $(sel).onchange = (ev) => {
      state.filters[key] = ev.target.value;
      state.page = 1;
      refreshList();
    };
  };
  bindFilter("#fType", "type");
  bindFilter("#fType2", "type2");
  bindFilter("#fLevel", "level");
  bindFilter("#fDivision", "division");
  bindFilter("#fEvolution", "evolution");
  bindFilter("#fAbility", "ability");
  bindFilter("#fShiny", "shiny");
  bindFilter("#fSignature", "signature");
  bindFilter("#fRibbon", "ribbon");
  bindFilter("#fSort", "sort");

  $("#showAll").onchange = (ev) => {
    state.showAll = ev.target.checked;
    state.page = 1;
    refreshList();
  };

  $("#btnClear").onclick = () => {
    state.filters = { type: "all", type2: "all", level: "all", division: "all", evolution: "all", ability: "all", shiny: "all", signature: "all", ribbon: "all", sort: "dex" };
    state.search = "";
    state.showAll = false;
    state.tags = [];
    state.gen = "all";
    state.page = 1;
    $("#search").value = "";
    $("#showAll").checked = false;
    for (const id of ["#fType", "#fType2", "#fLevel", "#fDivision", "#fEvolution", "#fAbility", "#fShiny", "#fSignature", "#fRibbon", "#fSort"]) {
      $(id).value = "all";
    }
    $("#fSort").value = "dex";
    renderGenbar();
    renderTagBar();
    refreshList();
  };

  $("#prevPage").onclick = () => {
    if (state.page > 1) {
      state.page--;
      renderList();
    }
  };
  $("#nextPage").onclick = () => {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.page < pages) {
      state.page++;
      renderList();
    }
  };

  // list click
  $("#pkmnList").onclick = (ev) => {
    const row = ev.target.closest("[data-id]");
    if (!row) return;
    renderDetail(row.dataset.id);
    $$(".pkmn-row").forEach((r) => r.classList.toggle("selected", r === row));
  };

  // tags modal
  $("#btnTags").onclick = () => {
    renderTagModal();
    $("#tagModal").hidden = false;
  };
  $("#btnTagClear").onclick = () => {
    state.tags = [];
    renderTagBar();
    renderTagModal();
    refreshList();
  };

  // items
  $("#itemSearch").oninput = debounce((ev) => {
    state.itemSearch = ev.target.value;
    renderItems();
  }, 160);
  $("#itemOwned").onchange = (ev) => {
    state.itemOwned = ev.target.checked;
    renderItems();
  };

  // quick actions
  $("#btnMaxLevel").onclick = () =>
    quickAction(() => {
      for (const [id, v] of Object.entries(state.raw)) {
        if (isPkmnEntry(id, v) && v.caught > 0) v.level = 100;
      }
    }, "全部升到 100 级");

  $("#btnMaxIvs").onclick = () =>
    quickAction(() => {
      for (const [id, v] of Object.entries(state.raw)) {
        if (isPkmnEntry(id, v) && v.caught > 0) v.ivs = { hp: 6, atk: 6, def: 6, satk: 6, sdef: 6, spe: 6 };
      }
    }, "全部 IV 设为 6");

  $("#btnUnlockAllHa").onclick = () =>
    quickAction(() => {
      for (const [id, v] of Object.entries(state.raw)) {
        const p = M.pokemon.get(id);
        if (isPkmnEntry(id, v) && v.caught > 0 && p?.hiddenAbility) v.hiddenAbilityUnlocked = true;
      }
    }, "解锁全部隐藏特性");

  $("#btnMaxItems").onclick = () =>
    quickAction(() => {
      for (const [id, v] of Object.entries(state.raw)) {
        if (isItemEntry(id, v)) {
          v.got = 999;
          v.newItem = 999;
        }
      }
    }, "所有道具设为 999");

  $("#btnApplyCaps").onclick = () => {
    if (!state.raw) return;
    const a = Math.max(0, Math.round(Number($("#quickBottleCap").value) || 0));
    const b = Math.max(0, Math.round(Number($("#quickGoldenBottleCap").value) || 0));
    if (!state.raw.bottleCap) state.raw.bottleCap = { got: 0, newItem: 0 };
    if (!state.raw.goldenBottleCap) state.raw.goldenBottleCap = { got: 0, newItem: 0 };
    state.raw.bottleCap.got = a;
    state.raw.goldenBottleCap.got = b;
    commit();
    renderBottles();
    renderItems();
    toast("瓶盖数量已更新");
  };

  // keyboard
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      if (ev.shiftKey) redo();
      else undo();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") {
      ev.preventDefault();
      redo();
    } else if (ev.key === "Escape") {
      closeDetailOverlay();
      for (const m of $$(".modal")) if (!m.hidden) m.hidden = true;
    }
  });

  window.addEventListener("orientationchange", () => {
    if (!isPhonePortrait()) closeDetailOverlay();
  });

  // drag & drop
  document.addEventListener("dragover", (ev) => ev.preventDefault());
  document.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) importFile(f);
  });
}

boot();

// debug / test hook
window.__pke = {
  state, M, importText, exportJSON, validateSave,
  applyFilters, applySearch, termMatches, termHaystack, refreshList,
  itemMatches, renderItems, renderBottles,
};
