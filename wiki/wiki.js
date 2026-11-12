"use strict";

/* ============================================================
   Pokechill Wiki — shared logic for abilities / moves / pokemon
   ============================================================ */

const PAGE = document.body.dataset.page;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  page: PAGE,
  data: [],
  names: { pokemon: {}, moves: {}, abilities: {} },
  types: {},
  pokemonIndex: [],
  movesIndex: [],
  q: "",
  rarity: "all",
  type: "all",
  type2: "all",
  split: "all",
  gen: "all",
  division: "all",
  sort: "default",
  filtered: [],
  selected: null,
  currentItem: null,
  pageNo: 1,
  pageSize: 60,
  theme: "dark",
};

const PAGE_LABEL = { abilities: "特性", moves: "招式", pokemon: "宝可梦" };

const norm = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const typeZh = (t) => state.types[t] || t || "";

function nameOf(kind, id) {
  const v = state.names[kind]?.[id];
  return v ? v[0] || v[1] || id : id;
}
function nameEnOf(kind, id) {
  const v = state.names[kind]?.[id];
  return v ? v[1] || v[0] || id : id;
}

function isPhone() {
  return window.matchMedia("(max-width: 720px) and (orientation: portrait)").matches;
}

/* ---------- theme ---------- */
function initTheme() {
  const saved = localStorage.getItem("pke-theme");
  setTheme(saved === "light" ? "light" : "dark");
}
function setTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("pke-theme", t);
  const btn = $("#btnTheme");
  if (btn) btn.textContent = t === "dark" ? "☾" : "☀";
}

/* ---------- boot ---------- */
async function boot() {
  initTheme();
  $("#btnTheme").onclick = () => setTheme(state.theme === "dark" ? "light" : "dark");

  const file = PAGE === "pokemon" ? "wiki-pokemon.json" : `wiki-${PAGE}.json`;
  const extraFile =
    PAGE === "moves" ? "wiki-pokemon-index.json" : PAGE === "pokemon" ? "wiki-moves-index.json" : null;
  try {
    const [dataRes, namesRes, extraRes] = await Promise.all([
      fetch(`../data/${file}`, { cache: "no-store" }),
      fetch("../data/wiki-names.json", { cache: "no-store" }),
      extraFile ? fetch(`../data/${extraFile}`, { cache: "no-store" }) : Promise.resolve(null),
    ]);
    if (!dataRes.ok || !namesRes.ok || (extraRes && !extraRes.ok))
      throw new Error(`HTTP ${dataRes.status}/${namesRes.status}${extraRes ? "/" + extraRes.status : ""}`);
    const json = await dataRes.json();
    state.names = await namesRes.json();
    state.types = json.types || {};
    state.data = json[PAGE] || [];
    if (extraRes) {
      const extra = await extraRes.json();
      if (PAGE === "moves") state.pokemonIndex = extra;
      if (PAGE === "pokemon") state.movesIndex = extra;
    }
  } catch (err) {
    $("#status").textContent = "数据加载失败：" + err.message;
    return;
  }

  buildFilters();
  bindControls();
  refresh();

  if (location.hash) {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) selectById(id, false);
  }

  $("#status").textContent = `${state.data.length} 个${PAGE_LABEL[PAGE]} · 数据来自 pokechill 与宝可梦百科`;
}

/* ---------- filters ---------- */
function buildFilters() {
  const typeSel = $("#fType");
  if (typeSel) {
    let html = `<option value="all">全部属性</option>`;
    for (const [k, zh] of Object.entries(state.types)) {
      html += `<option value="${k}">${zh} / ${k}</option>`;
    }
    if (PAGE === "abilities") {
      html += `<option value="__all">全属性</option>`;
      html += `<option value="__none">无属性（固定）</option>`;
    }
    typeSel.innerHTML = html;
  }

  const type2Sel = $("#fType2");
  if (type2Sel) {
    type2Sel.innerHTML =
      `<option value="all">全部属性</option>` +
      Object.entries(state.types)
        .map(([k, zh]) => `<option value="${k}">${zh} / ${k}</option>`)
        .join("");
  }

  const raritySel = $("#fRarity");
  if (raritySel) {
    raritySel.innerHTML =
      `<option value="all">全部稀有度</option>` +
      `<option value="1">★ 普通</option>` +
      `<option value="2">★★ 少见</option>` +
      `<option value="3">★★★ 稀有</option>` +
      (PAGE === "moves" ? `<option value="none">无稀有度</option>` : "");
  }

  const genSel = $("#fGen");
  if (genSel) {
    genSel.innerHTML =
      `<option value="all">全部世代</option>` +
      Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">Gen ${i + 1}</option>`).join("") +
      `<option value="none">无编号</option>`;
  }

  const divSel = $("#fDivision");
  if (divSel) {
    divSel.innerHTML =
      `<option value="all">全部分级</option>` +
      ["D", "C", "B", "A", "S", "SS", "SSS"].map((d) => `<option value="${d}">${d}</option>`).join("");
  }
}

function bindControls() {
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  $("#search").oninput = debounce((e) => {
    state.q = e.target.value;
    state.pageNo = 1;
    refresh();
  }, 160);

  const bind = (sel, key) => {
    const el = $(sel);
    if (!el) return;
    el.onchange = (e) => {
      state[key] = e.target.value;
      state.pageNo = 1;
      refresh();
    };
  };
  bind("#fRarity", "rarity");
  bind("#fType", "type");
  bind("#fType2", "type2");
  bind("#fSplit", "split");
  bind("#fGen", "gen");
  bind("#fDivision", "division");
  bind("#fSort", "sort");

  $("#btnClear").onclick = () => {
    state.q = "";
    state.rarity = "all";
    state.type = "all";
    state.type2 = "all";
    state.split = "all";
    state.gen = "all";
    state.division = "all";
    state.sort = "default";
    state.pageNo = 1;
    $("#search").value = "";
    for (const sel of ["#fRarity", "#fType", "#fType2", "#fSplit", "#fGen", "#fDivision"]) {
      const el = $(sel);
      if (el) el.value = "all";
    }
    const sortEl = $("#fSort");
    if (sortEl) sortEl.value = "default";
    refresh();
  };

  $("#prevPage").onclick = () => {
    if (state.pageNo > 1) {
      state.pageNo--;
      renderList();
    }
  };
  $("#nextPage").onclick = () => {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.pageNo < pages) {
      state.pageNo++;
      renderList();
    }
  };

  $("#list").onclick = (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    selectById(row.dataset.id, true);
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
  window.addEventListener("hashchange", () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) selectById(id, false);
  });
}

function abilityTypeMatch(a, sel) {
  if (sel === "all") return true;
  if (sel === "__none") return a.typeKind === "none";
  if (sel === "__all") return a.typeKind === "all";
  return a.types.includes(sel) || a.typeKind === "all";
}

function abilityTypeLabel(a) {
  if (a.typeKind === "none") return "无属性（固定）";
  if (a.typeKind === "all") {
    const concrete = a.types.filter((t) => t !== "all");
    return concrete.length ? `全属性（${concrete.map(typeZh).join(" / ")}）` : "全属性";
  }
  return a.types.map(typeZh).join(" / ") || "无属性";
}

function matchSearch(item, q) {
  const t = q.toLowerCase();
  const n = norm(q);
  let fields = [];
  if (PAGE === "abilities") {
    fields = [item.nameZh, item.nameEn, item.id, ...(item.types || []), item.descZh, item.effectEn];
  } else if (PAGE === "moves") {
    fields = [item.nameZh, item.nameEn, item.id, item.type, typeZh(item.type), item.descZh, item.effectEn, item.officialCategory];
  } else {
    fields = [item.nameZh, item.nameEn, item.id, item.dexNo != null ? String(item.dexNo).padStart(4, "0") : "", ...(item.types || [])];
  }
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return hay.includes(t) || (n.length > 0 && norm(hay).includes(n));
}

function applyFilters() {
  const q = state.q.trim();
  return state.data.filter((item) => {
    if (PAGE === "abilities") {
      if (state.rarity !== "all" && String(item.rarity) !== state.rarity) return false;
      if (!abilityTypeMatch(item, state.type)) return false;
    } else if (PAGE === "moves") {
      if (state.rarity === "none") {
        if (item.rarity != null) return false;
      } else if (state.rarity !== "all" && String(item.rarity) !== state.rarity) return false;
      if (state.type !== "all" && item.type !== state.type) return false;
      if (state.split !== "all" && (item.split || "status") !== state.split) return false;
    } else {
      const selectedTypes = [state.type, state.type2].filter((t) => t && t !== "all");
      if (selectedTypes.length && !selectedTypes.every((t) => item.types.includes(t))) return false;
      if (state.gen === "none") {
        if (item.gen != null) return false;
      } else if (state.gen !== "all" && String(item.gen) !== state.gen) return false;
      if (state.division !== "all" && item.division !== state.division) return false;
    }
    if (q && !matchSearch(item, q)) return false;
    return true;
  });
}

function sortData(list) {
  const s = state.sort;
  const byName = (a, b) => (a.nameZh || a.nameEn || a.id).localeCompare(b.nameZh || b.nameEn || b.id, "zh-Hans-CN");
  if (PAGE === "abilities") {
    if (s === "name") list.sort(byName);
    else if (s === "type") list.sort((a, b) => (a.types[0] || "zz").localeCompare(b.types[0] || "zz") || byName(a, b));
    else list.sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || byName(a, b));
  } else if (PAGE === "moves") {
    if (s === "power") list.sort((a, b) => (b.power ?? -1) - (a.power ?? -1) || byName(a, b));
    else if (s === "rarity") list.sort((a, b) => (b.rarity || 0) - (a.rarity || 0) || byName(a, b));
    else list.sort(byName);
  } else {
    const formRank = (id) =>
      /^(mega|gmax|alolan|galarian|hisuian|paldean|primal|crystal|spiky|ultra)/i.test(id) ||
      /(Clone|Gmax|Primal|Mega)$/i.test(id)
        ? 1
        : 0;
    if (s === "name") list.sort(byName);
    else if (s === "division") list.sort((a, b) => (a.division || "Z").localeCompare(b.division || "Z") || byName(a, b));
    else
      list.sort(
        (a, b) =>
          (a.dexNo ?? 99999) - (b.dexNo ?? 99999) ||
          formRank(a.id) - formRank(b.id) ||
          a.id.localeCompare(b.id)
      );
  }
  return list;
}

function refresh() {
  state.filtered = sortData(applyFilters());
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  if (state.pageNo > pages) state.pageNo = pages;
  $("#count").textContent = `筛选结果 ${state.filtered.length} 条`;
  renderList();
}

/* ---------- list ---------- */
function starLabel(r) {
  if (r === 1) return "★";
  if (r === 2) return "★★";
  if (r === 3) return "★★★";
  return "—";
}

function listLead(item) {
  if (PAGE === "abilities") return starLabel(item.rarity);
  if (PAGE === "moves") return item.power != null ? String(item.power) : "—";
  return item.dexNo != null ? "#" + String(item.dexNo).padStart(4, "0") : "—";
}

function listTail(item) {
  if (PAGE === "abilities") {
    return `<span class="pill type">${esc(abilityTypeLabel(item))}</span>`;
  }
  if (PAGE === "moves") {
    const parts = [];
    if (!item.moveset || !item.moveset.length) {
      const hasSig = (item.pokemon || []).some((x) => x.kind === "signature");
      const hasEgg = (item.pokemon || []).some((x) => x.kind === "eggMove");
      const label = hasSig && hasEgg ? "专属/蛋招" : hasSig ? "专属" : hasEgg ? "蛋招" : "特殊";
      parts.push(`<span class="pill special">${label}</span>`);
    }
    if (item.type) parts.push(`<span class="pill type">${esc(typeZh(item.type))}</span>`);
    if (item.split) parts.push(`<span class="pill">${item.split === "physical" ? "物理" : item.split === "special" ? "特殊" : "变化"}</span>`);
    return parts.join("");
  }
  return item.types.map((t) => `<span class="pill type">${esc(typeZh(t))}</span>`).join("");
}

function renderList() {
  const start = (state.pageNo - 1) * state.pageSize;
  const slice = state.filtered.slice(start, start + state.pageSize);
  const list = $("#list");
  if (!slice.length) {
    list.innerHTML = `<div class="empty" style="height:50vh"><div class="icon">◈</div><p>没有匹配结果</p><p class="muted">试试清除筛选或换个关键词</p></div>`;
    $("#pageInfo").textContent = "";
    return;
  }
  list.innerHTML = slice
    .map(
      (item) => `<div class="row ${state.selected === item.id ? "selected" : ""}" data-id="${item.id}">
        <span class="lead">${esc(listLead(item))}</span>
        <div class="names">
          <div class="zh">${esc(item.nameZh || item.nameEn || item.id)}</div>
          <div class="en">${esc(item.nameEn || item.id)}${PAGE === "pokemon" ? " · " + esc(item.id) : ""}</div>
        </div>
        <div class="tail">${listTail(item)}</div>
      </div>`
    )
    .join("");
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  $("#pageInfo").textContent = `第 ${state.pageNo} / ${pages} 页 · 共 ${state.filtered.length} 条`;
  $("#prevPage").disabled = state.pageNo <= 1;
  $("#nextPage").disabled = state.pageNo >= pages;
}

function selectById(id, pushHash) {
  const item = state.data.find((x) => x.id === id);
  if (!item) return;
  state.selected = id;
  if (pushHash) history.replaceState(null, "", "#" + encodeURIComponent(id));
  renderDetail(item);
  renderList();
  if (isPhone()) $("#detail").classList.add("open");
}

function closeDetail() {
  $("#detail").classList.remove("open");
}

/* ---------- detail ---------- */
/* ---------- learn pool ---------- */
function moveMatchesPokemon(move, p) {
  const ms = move.moveset;
  if (!ms || !ms.length) return false;
  if (ms.includes("all")) return true;
  return ms.some((t) => p.types.includes(t));
}

function getLearners(m) {
  return state.pokemonIndex
    .filter((p) => p.final && !p.special && moveMatchesPokemon(m, p))
    .sort((a, b) => (a.dexNo ?? 99999) - (b.dexNo ?? 99999) || a.id.localeCompare(b.id));
}

function learnerChip(p) {
  return `<a class="chip" href="pokemon.html#${p.id}">${esc(nameOf("pokemon", p.id))}</a>`;
}

function learnableHTML(p) {
  const groups = { 1: [], 2: [], 3: [] };
  const tm = [];
  for (const m of state.movesIndex) {
    if (!moveMatchesPokemon(m, p)) continue;
    if (m.rarity && groups[m.rarity]) groups[m.rarity].push(m);
    if (m.tm) tm.push(m);
  }
  const moveChip = (m) =>
    `<a class="chip" href="moves.html#${m.id}">${esc(nameOf("moves", m.id))}${m.tm ? ` <span class="sub">TM</span>` : ""}</a>`;
  const group = (label, list) =>
    list.length
      ? `<details class="learn-group"><summary>${label} · ${list.length} 个</summary><div class="chips">${list
          .map(moveChip)
          .join("")}</div></details>`
      : "";
  if (!groups[1].length && !groups[2].length && !groups[3].length && !tm.length) {
    return `<div class="block"><h4>可学招式（100 级潜在池）</h4><div class="muted">没有可学的普通招式。</div></div>`;
  }
  return `<div class="block">
    <h4>可学招式（100 级潜在池）</h4>
    ${group("Tier 1（Lv.1+）", groups[1])}
    ${group("Tier 2（Lv.10+）", groups[2])}
    ${group("Tier 3（Lv.30+）", groups[3])}
    ${group("技能机", tm)}
    <div class="source">由游戏随机池决定，不保证任意等级都能学到；技能机不受等级和稀有度限制。</div>
  </div>`;
}

function learnersHTML(m) {
  if (!m.moveset || !m.moveset.length) {
    return `<div class="block">
      <h4>可学宝可梦（潜在池）</h4>
      <div class="muted">该招式不在普通升级池中，只能通过专属 / 蛋招式 / 遗传获得。</div>
    </div>`;
  }
  const learners = getLearners(m);
  if (m.moveset.includes("all")) {
    return `<div class="block">
      <h4>可学宝可梦（潜在池）</h4>
      <div class="body">全属性招式，共 ${learners.length} 只（已排除特殊形态，每个家族只保留最终形态）</div>
      <div class="source">属性条件为 all，不列出具体名单。</div>
    </div>`;
  }
  const LIMIT = 60;
  const head = learners.slice(0, LIMIT);
  const rest = learners.length - head.length;
  return `<div class="block">
    <h4>可学宝可梦（潜在池）</h4>
    <div class="body">升级池 + 技能机：${learners.length} 只（已排除特殊形态，每个家族只保留最终形态）</div>
    <div class="chips" id="learnerChips">${head.map(learnerChip).join("")}</div>
    ${rest > 0 ? `<button class="btn small ghost expand-btn" id="expandLearners">展开剩余 ${rest} 只</button>` : ""}
    <div class="source">按图鉴编号排序；等级和稀有度影响升级池。</div>
  </div>`;
}

function acquisitionHTML(m) {
  const sig = (m.pokemon || []).filter((x) => x.kind === "signature").length;
  const egg = (m.pokemon || []).filter((x) => x.kind === "eggMove").length;
  const pool = m.moveset && m.moveset.length
    ? `Tier ${m.rarity ?? "—"}（可学属性：${m.moveset.map((t) => (t === "all" ? "全属性" : typeZh(t))).join(" / ")}）`
    : "无（不在普通升级池）";
  return `<div class="block">
    <h4>获取方式</h4>
    <div class="body plain">
      <div>升级随机池：${esc(pool)}</div>
      <div>技能机：${m.tm ? `有（${esc(m.tmItem)}）` : "无"}</div>
      <div>专属：${sig} 只</div>
      <div>蛋招式：${egg} 只</div>
    </div>
  </div>`;
}

function chips(kind, ids, subFn) {
  if (!ids || !ids.length) return `<span class="muted">无</span>`;
  return ids
    .map((id) => {
      const raw = typeof id === "string" ? id : id.id;
      const sub = subFn ? subFn(id) : "";
      return `<a class="chip" href="${kind}.html#${encodeURIComponent(raw)}">${esc(nameOf(kind, raw))}${
        sub ? ` <span class="sub">${esc(sub)}</span>` : ""
      }</a>`;
    })
    .join("");
}

function renderDetail(item) {
  const detail = $("#detail");
  let html = "";

  if (PAGE === "abilities") {
    const types = abilityTypeLabel(item);
    const users = item.pokemon || [];
    html = `
      <div class="detail-head">
        <div>
          <h2>${esc(item.nameZh || item.nameEn || item.id)}</h2>
          <div class="en">${esc(item.nameEn || item.id)}</div>
          <div class="id">${esc(item.id)}</div>
        </div>
        <button class="btn ghost back-btn" id="detailBack">返回</button>
      </div>
      <div class="meta-line">
        <span class="pill star">${starLabel(item.rarity)} ${item.rarity === 1 ? "普通" : item.rarity === 2 ? "少见" : item.rarity === 3 ? "稀有" : ""}</span>
        <span class="pill type">${esc(types)}</span>
      </div>
      <div class="block">
        <h4>本作效果</h4>
        <div class="effect en">${item.effectEn ? esc(item.effectEn) : `<span class="muted">游戏内没有额外效果说明</span>`}</div>
        ${item.nerf ? `<div class="source warn">作为非隐藏特性时：${esc(item.nerf)}</div>` : ""}
      </div>
      <div class="block">
        <h4>百科中文</h4>
        ${
          item.descZh
            ? `<div class="body">${esc(item.descZh)}</div><div class="source">来自宝可梦百科。部分特性在本作中有改动，请以「本作效果」为准。</div>`
            : `<div class="muted">暂无中文说明，本作原创特性。</div>`
        }
      </div>
      <div class="block">
        <h4>隐藏特性使用者（${users.length}）</h4>
        <div class="chips">${chips("pokemon", users)}</div>
      </div>`;
  } else if (PAGE === "moves") {
    const users = item.pokemon || [];
    html = `
      <div class="detail-head">
        <div>
          <h2>${esc(item.nameZh || item.nameEn || item.id)}</h2>
          <div class="en">${esc(item.nameEn || item.id)}</div>
          <div class="id">${esc(item.id)}</div>
        </div>
        <button class="btn ghost back-btn" id="detailBack">返回</button>
      </div>
      <div class="meta-line">
        ${item.type ? `<span class="pill type">${esc(typeZh(item.type))}</span>` : ""}
        ${item.split ? `<span class="pill">${item.split === "physical" ? "物理" : item.split === "special" ? "特殊" : "变化"}</span>` : ""}
        ${item.power != null ? `<span class="pill">威力 ${item.power}</span>` : ""}
        ${item.rarity ? `<span class="pill star">${starLabel(item.rarity)}</span>` : ""}
        ${item.tm ? `<span class="pill">技能机</span>` : ""}
        ${item.restricted ? `<span class="pill">限制招式</span>` : ""}
      </div>
      ${acquisitionHTML(item)}
      <div class="block">
        <h4>本作效果</h4>
        <div class="effect en">${item.effectEn ? esc(item.effectEn) : `<span class="muted">游戏内没有额外效果说明</span>`}</div>
      </div>
      <div class="block">
        <h4>百科中文</h4>
        ${
          item.descZh
            ? `<div class="body">${esc(item.descZh)}</div><div class="source">来自宝可梦百科。本作威力与机制可能不同，请以本作数据为准。</div>`
            : `<div class="muted">暂无中文说明，本作原创招式。</div>`
        }
      </div>
      <div class="block">
        <h4>百科数据</h4>
        <div class="body">命中 ${esc(item.accuracy ?? "—")} · PP ${esc(item.pp ?? "—")} · 官方分类 ${esc(item.officialCategory ?? "—")}</div>
        <div class="source">来自宝可梦百科，仅作参考。</div>
      </div>
      ${learnersHTML(item)}
      <div class="block">
        <h4>专属 / 蛋招式使用者（${users.length}）</h4>
        <div class="chips">${chips("pokemon", users, (x) => (x.kind === "signature" ? "专属" : "蛋招"))}</div>
      </div>`;
  } else {
    const bst = item.bst || {};
    html = `
      <div class="detail-head">
        <div>
          <h2>${esc(item.nameZh || item.nameEn || item.id)}</h2>
          <div class="en">${esc(item.nameEn || item.id)}</div>
          <div class="id">${esc(item.id)}</div>
        </div>
        <button class="btn ghost back-btn" id="detailBack">返回</button>
      </div>
      <div class="meta-line">
        <span class="pill">${item.dexNo != null ? "#" + String(item.dexNo).padStart(4, "0") : "无编号"}</span>
        ${item.gen ? `<span class="pill">Gen ${item.gen}</span>` : ""}
        ${item.division ? `<span class="pill">${item.division}</span>` : ""}
        ${item.types.map((t) => `<span class="pill type">${esc(typeZh(t))}</span>`).join("")}
      </div>
      <div class="block">
        <h4>BST 星级</h4>
        <div class="bst">
          ${["hp", "atk", "def", "satk", "sdef", "spe"]
            .map((k) => `<div>${k.toUpperCase()}<strong>${bst[k] ?? "—"}</strong></div>`)
            .join("")}
        </div>
      </div>
      ${learnableHTML(item)}
      <div class="block">
        <h4>隐藏特性</h4>
        <div class="chips">${item.hiddenAbility ? chips("abilities", [item.hiddenAbility]) : `<span class="muted">无</span>`}</div>
      </div>
      <div class="block">
        <h4>专属招式</h4>
        <div class="chips">${item.signature ? chips("moves", [item.signature]) : `<span class="muted">无</span>`}</div>
      </div>
      <div class="block">
        <h4>蛋招式</h4>
        <div class="chips">${item.eggMove ? chips("moves", [item.eggMove]) : `<span class="muted">无</span>`}</div>
      </div>
      <div class="block">
        <h4>进化</h4>
        <div class="chips">${chips("pokemon", item.evolvesTo || [])}</div>
      </div>`;
  }

  detail.innerHTML = html;
  state.currentItem = item;
  const back = $("#detailBack");
  if (back) back.onclick = closeDetail;
  const expand = $("#expandLearners");
  if (expand) {
    expand.onclick = () => {
      const learners = getLearners(state.currentItem);
      const rest = learners.slice(60);
      const container = $("#learnerChips");
      container.insertAdjacentHTML("beforeend", rest.map(learnerChip).join(""));
      expand.remove();
    };
  }
}

boot();
