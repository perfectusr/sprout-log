(function () {
"use strict";

const L = window.SPROUT_LIBRARY;
const SEEDS = Object.fromEntries(L.seeds.map(s => [s.id, s]));
// Storage. v3 holds several gardens. Older saves (v2, and the original single-page tracker) are read once,
// copied into v3, and then left untouched in the browser as an automatic backup.
const KEY = "sprout-log-v3";
const V2_KEY = "sprout-log-v2";
const LEGACY_KEY = "auk-grow-tracker-v1";
const DAY = 86400000;

/* ---------------- dates & formatting ---------------- */
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => iso(new Date());
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * DAY));
const diff = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o || { month: "short", day: "numeric" });
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const weekKey = () => Math.floor(parse(today()).getTime() / (7 * DAY));

/* ---------------- state ---------------- */
// db = everything saved in this browser; state = the garden currently on screen.
const defaultUnits = () => (navigator.language || "").toLowerCase() === "en-us" ? "F" : "C";
function blankGarden() {
  return { id: uid(), name: "", device: null, potCount: 0, pots: [], log: [], history: [], checks: {}, caughtUp: {} };
}
function blankDb() { return { v: 3, units: defaultUnits(), dismissed: {}, gardens: [], active: null, updated: 0 }; }
const GARDEN_FIELDS = ["device", "potCount", "pots", "log", "history", "checks", "caughtUp"];
function gardenFromV2(o) {
  const g = blankGarden();
  GARDEN_FIELDS.forEach(k => { if (o[k] !== undefined && o[k] !== null) g[k] = o[k]; });
  return g;
}
function migrateV1(o) {
  const s = blankGarden();
  s.device = "mini2"; s.potCount = 2;
  const t = { id: uid(), seed: "kit-tomato", sown: o.sowDate, ms: (o.plants && o.plants.tomato && o.plants.tomato.milestones) || {} };
  const c = { id: uid(), seed: "kit-chili", sown: o.sowDate, ms: (o.plants && o.plants.chili && o.plants.chili.milestones) || {} };
  s.pots = [t, c];
  s.log = (o.log || []).map(e => ({ id: e.id || uid(), date: e.date, pot: e.plant === "tomato" ? t.id : e.plant === "chili" ? c.id : "all",
    type: e.type, text: e.text || "", height: e.height || null }));
  return s;
}
// Turns any saved or exported format into a v3 db.
function toDb(o) {
  if (!o || typeof o !== "object") throw new Error("bad");
  if (o.v === 3 && Array.isArray(o.gardens)) {
    const d = Object.assign(blankDb(), o);
    d.dismissed = d.dismissed || {};
    d.gardens = d.gardens.filter(g => g && typeof g === "object").map(g => Object.assign(blankGarden(), g));
    if (!d.gardens.some(g => g.id === d.active)) d.active = d.gardens[0] ? d.gardens[0].id : null;
    return d;
  }
  if (o.v === 2) {
    const d = blankDb(), g = gardenFromV2(o);
    d.units = o.units || d.units; d.dismissed = o.dismissed || {};
    if (g.device) { d.gardens = [g]; d.active = g.id; }
    return d;
  }
  if (o.sowDate && o.plants) {
    const d = blankDb(), g = migrateV1(o);
    d.units = "F"; d.gardens = [g]; d.active = g.id;
    return d;
  }
  throw new Error("bad");
}
let db = blankDb();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) db = toDb(JSON.parse(raw));
  else {
    const older = localStorage.getItem(V2_KEY) || localStorage.getItem(LEGACY_KEY);
    if (older) { db = toDb(JSON.parse(older)); localStorage.setItem(KEY, JSON.stringify(db)); }
  }
} catch (e) { db = blankDb(); }
const activeGarden = () => db.gardens.find(g => g.id === db.active) || db.gardens[0] || null;
let state = activeGarden() || blankGarden();
let addingGarden = false;   // true while setting up a new garden that isn't saved yet
const gardenName = g => (g && g.name) || (g && g.device ? L.devices[g.device].name : "New garden");

function save() {
  db.updated = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast("Couldn't save in this browser. Export a backup so you don't lose anything."); }
}

/* ---------------- units ---------------- */
const tempTxt = r => {
  if (!r) return "";
  const conv = c => db.units === "F" ? Math.round(c * 9 / 5 + 32) : c;
  const u = db.units === "F" ? "°F" : "°C";
  return r[0] === r[1] ? `${conv(r[0])} ${u}` : `${conv(r[0])}–${conv(r[1])} ${u}`;
};
const lenTxt = cm => db.units === "F" ? `${Math.round(cm / 2.54)} in` : `${cm} cm`;
const heightTxt = cm => db.units === "F" ? `${(cm / 2.54).toFixed(1).replace(/\.0$/, "")} in` : `${cm} cm`;

/* ---------------- plant logic ---------------- */
const active = () => state.pots.map((p, i) => p ? Object.assign({ idx: i }, p) : null).filter(Boolean);
const seedOf = p => SEEDS[p.seed] || SEEDS["other-herb"];
const potName = p => `Pot ${p.idx + 1}`;
const findPot = id => state.pots.find(p => p && p.id === id) || state.history.find(p => p.id === id);
const dayOf = p => Math.max(0, diff(p.sown, today()));

function milestones(s) {
  if (s.type === "fruiting" && s.flowerOnly) return [["sprouted", "Sprouted"], ["thinned", "Thinned to one plant"], ["flowering", "First flower"], ["harvest", "First pick"]];
  if (s.type === "fruiting") return [["sprouted", "Sprouted"], ["thinned", "Thinned to one plant"], ["flowering", "First flower"], ["fruit", "First fruit set"], ["ripe", "First ripe fruit"], ["harvest", "First harvest"]];
  return [["sprouted", "Sprouted"], ["harvest", "First harvest"]];
}
function windowOf(s, k) {
  const sp = s.sprout, fl = s.flower || [35, 49], h = s.harvest;
  const pv = s.prov || {};
  switch (k) {
    case "sprouted": return { r: sp, prov: pv.sprout || "general" };
    case "thinned": return { r: [sp[0] + 7, sp[1] + 10], prov: "general" };
    case "flowering": return { r: fl, prov: pv.flower || "general" };
    case "fruit": return { r: [fl[0] + 7, fl[1] + 14], prov: "general" };
    case "ripe": return { r: h, prov: pv.harvest || "general" };
    case "harvest": return { r: s.type === "fruiting" && !s.flowerOnly ? [h[0], h[1] + 7] : h, prov: pv.harvest || "general" };
  }
}
function nextMilestone(p) {
  const s = seedOf(p), list = milestones(s);
  let last = -1; list.forEach(([k], i) => { if (p.ms[k]) last = i; });
  return list.slice(last + 1).find(([k]) => !p.ms[k]);
}
function stage(p) {
  const s = seedOf(p), m = p.ms;
  if (s.type === "fruiting") {
    if (m.ripe || (m.harvest && !s.flowerOnly)) return 6;
    if (m.fruit) return 5;
    if (m.flowering || m.harvest) return 4;
    if (!m.sprouted) return 0;
    const since = diff(m.sprouted, today());
    return since < 12 ? 1 : since < 26 ? 2 : 3;
  }
  if (!m.sprouted) return 0;
  if (m.harvest || dayOf(p) >= s.harvest[0]) return 3;
  return diff(m.sprouted, today()) < 10 ? 1 : 2;
}
const STAGE_FRUIT = ["Seeds in the fiber", "Sprouting", "Seedling", "Growing leaves", "Flowering", "Setting fruit", "Ripening"];
const STAGE_LEAF = ["Seeds in the fiber", "Sprouting", "Growing", "Ready to harvest"];
const stageName = p => (seedOf(p).type === "fruiting" ? STAGE_FRUIT : STAGE_LEAF)[stage(p)];
const PROV = { auk: "Auk guide", "auk-group": "Auk guide (similar plants)", general: "General guidance" };

/* ---------------- illustration ---------------- */
function leaf(x, y, ang, len, w, fill) {
  return `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang})" d="M0 0 C ${len * .3} ${-w} ${len * .75} ${-w} ${len} 0 C ${len * .75} ${w} ${len * .3} ${w} 0 0Z" fill="${fill}"/>`;
}
function drawPlant(p, cx, soilY, scale) {
  const s = seedOf(p), st = stage(p);
  const L1 = s.leafColor || "var(--leaf)", L2 = s.leafColor || "var(--leaf-2)";
  let g = "";
  if (st === 0) {
    for (let i = -1; i <= 1; i++) g += `<ellipse cx="${cx + i * 9}" cy="${soilY - 2}" rx="3" ry="2" fill="var(--seed)"/>`;
    return g;
  }
  const wrap = inner => `<g transform="translate(${cx} ${soilY}) scale(${scale}) translate(${-cx} ${-soilY})">${inner}</g>`;

  if (s.draw === "herb" || s.draw === "leafy") {
    const H = [0, 18, 46, 78][st], n = st === 1 ? 4 : 5;
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * (st === 1 ? 9 : 13), h = H * (0.75 + 0.25 * ((i * 37) % 5) / 4);
      if (s.draw === "leafy") {
        const ang = -90 + (i - (n - 1) / 2) * (st === 1 ? 22 : 26);
        g += leaf(cx + dx * .3, soilY, ang, h, st === 1 ? 4 : 10, i % 2 ? L1 : L2);
      } else {
        const top = soilY - h;
        g += `<path d="M${cx + dx * .4} ${soilY} Q ${cx + dx * .7} ${soilY - h * .5} ${cx + dx} ${top}" stroke="${L2}" stroke-width="2" fill="none"/>`;
        const pairs = st === 1 ? 1 : st === 2 ? 2 : 4;
        for (let k = 0; k < pairs; k++) {
          const y = top + (k * h * .22), x = cx + dx - k * dx * .08, len = st === 1 ? 7 : 11 - k;
          g += leaf(x, y, -150, len, len * .45, i % 2 ? L1 : L2) + leaf(x, y, -30, len, len * .45, i % 2 ? L2 : L1);
        }
      }
    }
    return wrap(g);
  }

  const H = [0, 22, 52, 105, 128, 140, 142][st], top = soilY - H;
  g += `<path d="M${cx} ${soilY} C ${cx - 4} ${soilY - H * .4} ${cx + 4} ${soilY - H * .7} ${cx} ${top}" stroke="${L2}" stroke-width="${st > 2 ? 4 : 3}" fill="none" stroke-linecap="round"/>`;
  if (st === 1) return wrap(g + leaf(cx, top, -160, 16, 6, L1) + leaf(cx, top, -20, 16, 6, L1));
  const pairs = st === 2 ? 2 : 5;
  for (let i = 0; i < pairs; i++) {
    const y = soilY - H * (0.3 + 0.68 * i / Math.max(1, pairs - 1));
    const len = (s.draw === "tomato" ? 30 : s.draw === "cucumber" ? 34 : 24) * (st === 2 ? .8 : 1) * (1 - i * .06);
    const w = s.draw === "cucumber" ? 14 : 9;
    g += leaf(cx, y, -155 - i * 4, len, w, L1) + leaf(cx, y, -25 + i * 4, len, w, L2);
    if (s.draw === "tomato") g += leaf(cx - len * .55, y - len * .18, -120, len * .45, 6, L1) + leaf(cx + len * .55, y - len * .18, -60, len * .45, 6, L2);
  }
  if (st >= 4) {
    const fl = s.draw === "pepper" ? "#F4F1E8" : s.draw === "flower" ? (s.fruit || "#F07A1E") : "#F2C230";
    const big = s.draw === "flower" ? 7 : 4, pr = s.draw === "flower" ? 5 : 3;
    [[-18, .62], [16, .74], [-8, .88], [22, .5]].forEach(([dx, f]) => {
      const fx = cx + dx, fy = soilY - H * f;
      for (let k = 0; k < 5; k++) { const a = k * 72 * Math.PI / 180; g += `<circle cx="${(fx + Math.cos(a) * big).toFixed(1)}" cy="${(fy + Math.sin(a) * big).toFixed(1)}" r="${pr}" fill="${fl}"/>`; }
      g += `<circle cx="${fx}" cy="${fy}" r="2" fill="#C9961A"/>`;
    });
  }
  if (st >= 5 && s.draw !== "flower") {
    const ripe = st === 6;
    const col = ripe ? (s.fruitRipe || s.fruit || "#C8261B") : (s.draw === "cucumber" ? "#7DB34A" : "#7DB34A");
    [[-24, .45], [20, .55], [-6, .35], [28, .4]].forEach(([dx, f], i) => {
      const fx = cx + dx, fy = soilY - H * f;
      if (s.draw === "tomato") g += `<circle cx="${fx}" cy="${fy}" r="${i % 2 ? 8 : 9}" fill="${col}"/><path d="M${fx - 4} ${fy - 8} l4 3 l4 -3" stroke="var(--leaf-2)" stroke-width="2" fill="none"/>`;
      else if (s.draw === "cucumber") g += `<rect x="${fx - 4}" y="${fy - 4}" width="9" height="26" rx="4.5" fill="${ripe ? s.fruit : col}"/>`;
      else g += `<path d="M${fx} ${fy - 6} C ${fx + 5} ${fy} ${fx + 4} ${fy + 16} ${fx + 1} ${fy + 22} C ${fx - 3} ${fy + 14} ${fx - 4} ${fy} ${fx} ${fy - 6}Z" fill="${col}"/><path d="M${fx} ${fy - 6} v-5" stroke="var(--leaf-2)" stroke-width="2"/>`;
    });
  }
  return wrap(g);
}
function drawUnit(target, pots, potCount) {
  const n = Math.max(1, potCount), soilY = 248;
  const span = 400, spacing = span / n, rx = Math.min(62, spacing * 0.4);
  const scale = Math.max(0.6, Math.min(1, spacing / 150));
  let s = `<defs><linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--glow)" stop-opacity=".5"/><stop offset="1" stop-color="var(--glow)" stop-opacity="0"/></linearGradient></defs>`;
  s += `<polygon class="glowbeam" points="70,58 490,58 500,262 60,262" fill="url(#beam)"/>`;
  s += `<rect x="44" y="26" width="16" height="250" rx="5" fill="var(--wood)"/><rect x="500" y="26" width="16" height="250" rx="5" fill="var(--wood)"/>`;
  s += `<rect x="36" y="36" width="488" height="22" rx="11" fill="var(--ink)"/><rect x="70" y="54" width="420" height="4" rx="2" fill="var(--glow)"/>`;
  const centers = [];
  for (let i = 0; i < n; i++) centers.push(80 + spacing * (i + .5));
  centers.forEach((cx, i) => { const p = pots[i]; if (p) s += drawPlant(Object.assign({ idx: i }, p), cx, soilY, scale); });
  s += `<rect x="24" y="252" width="512" height="44" rx="14" fill="var(--wood)"/>`;
  centers.forEach((cx, i) => {
    const p = pots[i];
    s += `<ellipse cx="${cx}" cy="253" rx="${rx}" ry="11" fill="${p ? "var(--soil)" : "var(--soil-empty)"}"/>`;
    const label = p ? seedOf(p).name.split(" (")[0] : "Empty";
    const short = n > 3 && label.length > 20 ? label.slice(0, 19) + "…" : label;
    const ly = n > 3 ? 314 + (i % 2) * 17 : 318;
    s += `<text x="${cx}" y="${ly}" text-anchor="middle" font-size="${n > 3 ? 12 : 14}" font-weight="700" fill="${p ? "var(--ink)" : "var(--ink-2)"}" font-family="inherit">${esc(short)}</text>`;
  });
  document.getElementById(target).innerHTML = s;
}
function samplePots() {
  const d = k => addDays(today(), -k);
  return [
    { id: "s1", seed: "basil", sown: d(40), ms: { sprouted: d(36), harvest: d(5) } },
    { id: "s2", seed: "kit-tomato", sown: d(80), ms: { sprouted: d(74), thinned: d(60), flowering: d(40), fruit: d(30), ripe: d(2) } },
    { id: "s3", seed: "kit-chili", sown: d(60), ms: { sprouted: d(50), thinned: d(35), flowering: d(10), fruit: d(3) } },
    { id: "s4", seed: "pak-choi", sown: d(20), ms: { sprouted: d(14) } }
  ];
}

/* ---------------- device guidance ---------------- */
function counts() {
  const a = active(), fr = a.filter(p => seedOf(p).type === "fruiting");
  return { a, fr, leaf: a.filter(p => seedOf(p).type !== "fruiting"),
    flowering: fr.some(p => p.ms.flowering), fruitWeeks5: fr.some(p => dayOf(p) >= 35 || p.ms.flowering) };
}
function guidance() {
  const d = state.device, dev = L.devices[d], c = counts(), out = { mode: "", notes: [], dose: null, src: dev.sources };
  const mixed = c.fr.length && c.leaf.length;
  if (c.fr.length > 2) out.notes.push(`Auk recommends no more than two fruiting plants at once, and you have ${c.fr.length}. They'll compete for light.`);
  if (mixed) out.notes.push("Auk suggests growing fruiting plants separately from herbs and salads. If you mix them, keep it to one fruiting plant so the others aren't shaded.");
  if (d === "mini2") {
    if (!c.a.length) out.mode = "Herbs & Salads mode (16 h on, 8 h off)";
    else if (!c.fr.length) out.mode = "Herbs & Salads mode (16 h on, 8 h off)";
    else if (!mixed) out.mode = "Fruits & Veggies mode (20 h on, 4 h off). Tap the mode button to switch";
    else out.mode = "Your call: Herbs & Salads favours the herbs; Fruits & Veggies (after about 5 weeks) favours the fruit, but herbs may flower sooner";
    if (state.potCount === 4 && c.fr.length) out.notes.push("Growing fruit in the standard small pots? Auk suggests leaving two pots empty.");
    const bloom = c.flowering;
    out.dose = { head: ["Grow", "Flavour", "Bloom"], rows: [["Full refill", 6, 6, c.fr.length ? 6 : "–"], ["Top-up, per litre", 2, 2, c.fr.length ? 2 : "–"]], off: bloom ? [] : [3],
      note: c.fr.length ? (bloom ? "Flowering has started, so Bloom Booster goes in with every refill." : "Grow and Flavour for now. Bloom Booster joins when the first flower appears.") : "Grow and Flavour with every refill." };
  } else if (d === "mini1") {
    if (!c.fr.length) out.mode = "White light (the default, 17.5 h on)";
    else out.mode = c.fruitWeeks5 ? "Bloom light: tap the light button 3× (13.5 h on); it blinks red to confirm" : "White light for now; switch to bloom light (tap 3×) at about 5 weeks";
    const fruitPhase = c.fr.length && c.fruitWeeks5 && !(mixed && false);
    out.dose = { head: ["Green (Grow)", "Red (Flavour)"], rows: fruitPhase ? [["Full refill", 6, 6], ["Top-up, per litre", 2, 2]] : [["Full refill", 6, 3], ["Top-up, per litre", 2, 1]], off: [],
      note: fruitPhase ? "After 5 weeks with fruiting plants, red goes up to match green." : c.fr.length ? "Standard mix until about 5 weeks, then 6 + 6." : "Standard herb mix." };
  } else {
    out.mode = !c.fr.length ? "Green plant chip: herbs & salads program (the default)" : !mixed ? "Red plant chip: tomato & chili program (hold it on the receiver at startup)" : "Pick the chip for whichever plants matter more: green for herbs, red for fruit";
    out.dose = null;
    out.notes.push("Nutrients dose automatically from the capsules. Check them whenever you refill water, since the indicator isn't always accurate.");
  }
  return out;
}

/* ---------------- tasks ---------------- */
function tasks() {
  const T = new Map(), t = today(), dev = state.device, c = counts();
  const add = (id, once, title, detail, pot, mode) => {
    if (!T.has(id)) T.set(id, { id, title, detail: [], pots: [], mode: mode || (once ? "once" : "day") });
    const x = T.get(id); if (detail && !x.detail.includes(detail)) x.detail.push(detail); if (pot) x.pots.push(pot);
  };
  c.a.forEach(p => {
    const s = seedOf(p), d = dayOf(p), m = p.ms, nm = `${potName(p)} · ${s.name}`;
    if (!m.sprouted) {
      if (d > s.sprout[1] + 7) add("late-" + p.id, false, `No sprouts yet in ${potName(p).toLowerCase()}?`, `${s.name} usually sprouts by day ${s.sprout[1]}. Check the fiber is moist and the room is warm enough (${tempTxt(s.tempC)}). Resowing is fine.`, null);
      else add("sprouts", false, "Watch for sprouts", `${nm}: usually day ${s.sprout[0]}–${s.sprout[1]}${s.sow === "surface" ? " (seeds stay on the surface)" : ""}`, p);
      return;
    }
    if (s.type === "fruiting") {
      if (!m.thinned) add("thin-" + p.id, false, `Thin ${potName(p).toLowerCase()} to one plant`, `Keep the strongest ${s.name.toLowerCase()} seedling and snip the rest at the fiber, or replant them elsewhere.`, null);
      if (!m.flowering && d >= (s.flower ? s.flower[0] : 35) - 7) add("buds", false, "Look for first flower buds", `${nm}: expected around day ${s.flower ? s.flower[0] : 35}. Log it when you see one.`, p);
      if (m.flowering && !s.flowerOnly) add("pollinate", false, "Help pollinate the flowers",
        dev === "mini2" ? "Shake gently, blow on the flowers, or dab between them with a cotton swab. Auk suggests once a day while flowering." : "Shake gently or blow on the flowers. Auk suggests doing this a few times a week.", p, "day");
      if (s.draw === "tomato" && (m.flowering || d >= 42) && !m.harvest) add("stake-" + p.id, true, `Stake the ${s.name.toLowerCase()} if it's leaning`, "Tomatoes get top-heavy once fruit sets. A small stick and a soft tie is plenty.", null, "once");
      if (s.prune && d >= 28) add("suckers-" + p.id, false, `Pinch out side shoots on ${potName(p).toLowerCase()}`, "Remove the shoots growing in the joints between leaves and stem, since they take energy from fruit.", null, "week");
      if (d >= 28) add("toplight", false, "Trim anything touching the light", "If a top shoot reaches the light, cut just above a flower cluster and keep as many clusters as you can.", null, "week");
      if (m.fruit || d >= s.harvest[0] - 7) add("ripe", false, "Check for ripe fruit", `${nm}: ${s.harvestHow}`, p);
      if (dev === "mini1" && d >= 35 && !m.harvest) add("mini1-bloom", true, "Switch to bloom light and more red nutrient", "Tap the light button 3× (it blinks red). From now on use 6 pumps green + 6 red per full tank.", null, "once");
    } else {
      if (d >= s.harvest[0] && !m.harvest) add("first-" + p.id, false, `${potName(p)} is ready for a first harvest`, `${s.name}: ${s.harvestHow}`, null);
      if (m.harvest) add("trim", false, "Harvest and trim", `${nm}: take no more than a third, and pinch off any flower buds.`, p, "week");
    }
  });
  if (dev === "mini2" && c.fr.length && !c.leaf.length && c.a.some(p => dayOf(p) <= 3)) add("mini2-mode", true, "Set Fruits & Veggies mode", "Tap the mode button until it confirms Fruits & Veggies. The light then runs 20 hours a day.", null, "once");
  if (dev === "auk1" && c.fr.length && !c.leaf.length && c.a.some(p => dayOf(p) <= 3)) add("auk1-chip", true, "Use the red plant chip", "Hold the tomato & chili chip on the receiver at startup so the Auk runs the fruit program.", null, "once");
  if (dev === "mini2" && c.flowering) {
    const firstFlower = c.fr.map(p => p.ms.flowering).filter(Boolean).sort()[0];
    if (!state.log.some(e => (e.type === "refill" || e.type === "topup") && e.date >= firstFlower)) add("bloom", true, "Add Bloom Booster at your next refill", "6 pumps for a full tank, or 2 per litre on a top-up, alongside Grow and Flavour.", null, "once");
  }
  if (c.a.some(p => dayOf(p) >= 14)) add("lightgap", false, "Raise the light as plants grow", `Keep it about ${lenTxt(L.devices[dev].lightCm)} above the tallest plant.`, null, "week");
  if (c.a.length) {
    const lw = lastWater(), since = lw ? diff(lw.date, t) : null;
    if (dev === "auk1") add("auk1-water", false, "Check the water tank and nutrient capsules", "Refill the tank and top up any empty capsule.", null, "week");
    else if (!lw || since >= 7) add("water", false, "Check the water level", lw ? `Last refill or top-up was ${since} days ago.` : "Log refills so this can count the days for you.", null);
  }
  return [...T.values()];
}
const checkKey = x => x.mode === "once" ? x.id + "@once" : x.mode === "week" ? x.id + "@w" + weekKey() : x.id + "@" + today();
const lastWater = () => state.log.filter(e => e.type === "refill" || e.type === "topup").sort((a, b) => b.date.localeCompare(a.date))[0];

/* ---------------- render ---------------- */
const $ = id => document.getElementById(id);
function srcLinks(keys) {
  return keys.map(k => L.sources[k]).filter(Boolean).map(s => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.label.replace(/^Auk: /, ""))}</a>`).join(" · ");
}
function renderHero() {
  const a = active();
  if (!a.length) { $("daynum").innerHTML = `No pots planted<small>Set up your garden to start tracking.</small>`; $("next").innerHTML = ""; return; }
  const first = a.map(p => p.sown).sort()[0], n = Math.max(0, diff(first, today()));
  $("daynum").innerHTML = `${db.gardens.length > 1 ? `<span class="gname">${esc(gardenName(state))}</span>` : ""}Day ${n}<small>since your first sowing · ${fmt(first, { weekday: "short", month: "short", day: "numeric" })}</small>`;
  $("next").innerHTML = a.map(p => {
    const s = seedOf(p), nm = nextMilestone(p);
    if (!nm) return `<p><strong>${esc(s.name)}:</strong> every milestone logged.</p>`;
    const w = windowOf(s, nm[0]), a1 = addDays(p.sown, w.r[0]), b1 = addDays(p.sown, w.r[1]);
    const late = diff(b1, today()) > 0;
    return `<p><strong>${esc(s.name)}:</strong> ${nm[1].toLowerCase()} expected ${fmt(a1)}–${fmt(b1)}${late ? ' <span class="muted">(window passed, so log it if it happened)</span>' : ""}</p>`;
  }).join("");
}
function renderPots() {
  const el = $("pots");
  el.style.setProperty("--cols", Math.min(state.potCount || 1, 2));
  el.innerHTML = state.pots.slice(0, state.potCount).map((raw, i) => {
    if (!raw) return `<article class="pot empty"><header><h3>Pot ${i + 1}</h3></header><p class="muted">Empty.</p><button class="btn sm" data-edit="1">Plant something</button></article>`;
    const p = Object.assign({ idx: i }, raw), s = seedOf(p);
    const rows = milestones(s).map(([k, label]) => {
      const done = p.ms[k], w = windowOf(s, k), a1 = addDays(p.sown, w.r[0]), b1 = addDays(p.sown, w.r[1]);
      const when = done ? `Logged ${fmt(done)} · day ${diff(p.sown, done)}` : `Expected ${fmt(a1)}–${fmt(b1)} · ${PROV[w.prov]}`;
      const ctl = done
        ? `<input type="date" value="${done}" data-pot="${p.id}" data-k="${k}" aria-label="${esc(label)} date"><button class="btn ghost sm" data-clear="${p.id}:${k}">Clear</button>`
        : `<button class="btn sm" data-mark="${p.id}:${k}">Mark today</button>`;
      return `<li class="${done ? "done" : ""}"><span class="dot"></span><div><div>${esc(label)}</div><div class="when ${!done && diff(b1, today()) > 0 ? "late" : ""}">${when}</div></div><div class="ctl">${ctl}</div></li>`;
    }).join("");
    const hs = state.log.filter(e => e.height && (e.pot === p.id)).sort((a, b) => b.date.localeCompare(a.date))[0];
    const facts = [
      `Sown ${fmt(p.sown)} · day ${dayOf(p)}`,
      s.sow === "surface" ? "Surface-sown" : null,
      s.tempC ? `Best at ${tempTxt(s.tempC)}` : null,
      hs ? `${heightTxt(hs.height)} on ${fmt(hs.date)}` : null
    ].filter(Boolean).join(" · ");
    const tips = [s.seeds && `Sowing: ${s.seeds}.`, `Harvest: ${s.harvestHow}`].concat(s.tips || []).filter(Boolean);
    return `<article class="pot" style="--c:${s.fruit || "var(--leaf-2)"}">
      <header><div><p class="eyebrow">Pot ${i + 1}</p><h3>${esc(s.name)}</h3>${s.variety ? `<p class="small muted">${esc(s.variety)}</p>` : ""}</div><span class="stage">${stageName(p)}</span></header>
      <p class="small muted">${facts}</p>
      <ul class="ms">${rows}</ul>
      <details class="tips"><summary>Growing notes</summary><ul>${tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul><p class="src">Sources: ${srcLinks(s.sources)}</p></details>
      <div class="potactions"><button class="btn ghost sm" data-edit="1">Replant this pot</button></div>
    </article>`;
  }).join("");
}
function renderTasks() {
  const T = tasks(), ul = $("tasks");
  if (!T.length) { ul.innerHTML = `<li><span class="muted">Nothing due today.</span></li>`; return; }
  ul.innerHTML = T.map(x => {
    const k = checkKey(x), c = !!state.checks[k];
    const det = x.detail.map(d => `<div>${esc(d)}</div>`).join("");
    return `<li class="${c ? "checked" : ""}"><input type="checkbox" id="c-${esc(x.id)}" data-check="${esc(k)}" data-task="${esc(x.id)}" ${c ? "checked" : ""}><label for="c-${esc(x.id)}"><div class="t">${esc(x.title)}</div><div class="small muted">${det}${x.mode === "week" ? "<div>(weekly)</div>" : ""}</div></label></li>`;
  }).join("");
}
function renderDevice() {
  const g = guidance(), dev = L.devices[state.device];
  let h = `<h3>${esc(dev.name)} settings</h3>`;
  h += `<p class="kv"><span>Light</span><strong>${esc(g.mode)}</strong></p>`;
  h += `<p class="kv"><span>Light height</span><strong>About ${lenTxt(dev.lightCm)} above the plants</strong></p>`;
  if (g.dose) {
    h += `<table><thead><tr><th></th>${g.dose.head.map(x => `<th>${x}</th>`).join("")}</tr></thead><tbody>${g.dose.rows.map(r => `<tr><td>${r[0]}</td>${r.slice(1).map((v, i) => `<td class="n ${g.dose.off.includes(i + 1) ? "off" : ""}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="small muted">${esc(g.dose.note)}</p>`;
  }
  g.notes.forEach(n => h += `<p class="note">${esc(n)}</p>`);
  const lw = lastWater();
  h += `<p class="lastfill">${lw ? `Last ${lw.type === "refill" ? "full refill" : "top-up"}: <strong>${fmt(lw.date)}</strong> (${diff(lw.date, today())} days ago)` : `<span class="muted">No refills logged yet.</span>`}</p>`;
  h += `<div class="row"><button class="btn sm" data-quick="refill">Log full refill</button><button class="btn sm" data-quick="topup">Log top-up</button></div>`;
  h += `<p class="src">Sources: ${srcLinks(g.src)}</p>`;
  $("device").innerHTML = h;
}
function renderUpcoming() {
  const ev = [];
  active().forEach(p => {
    const s = seedOf(p);
    milestones(s).forEach(([k, label]) => {
      if (p.ms[k]) return;
      const w = windowOf(s, k), a1 = addDays(p.sown, w.r[0]), b1 = addDays(p.sown, w.r[1]);
      ev.push({ a: a1, b: b1, p, s, label, prov: w.prov });
    });
  });
  ev.sort((x, y) => x.a.localeCompare(y.a));
  const t = today(), ol = $("sched");
  if (!ev.length) { ol.innerHTML = `<li class="emptyrow muted">Nothing left to wait for. Every milestone is logged.</li>`; return; }
  ol.innerHTML = ev.slice(0, 10).map(e => {
    const now = e.a <= t && e.b >= t, late = e.b < t;
    return `<li class="${now ? "now" : ""} ${late ? "late" : ""}"><div class="d">${fmt(e.a)} – ${fmt(e.b)}<span>${now ? "happening now" : late ? "window passed" : `in ${diff(t, e.a)} days`}</span></div><div><div class="ev"><span class="tag" style="--c:${e.s.fruit || "var(--leaf-2)"}">${potName(e.p)}</span> ${esc(e.s.name)}: ${esc(e.label.toLowerCase())}</div><p class="src">${PROV[e.prov]}</p></div></li>`;
  }).join("");
}
const TYPE = { note: "Note", measure: "Height", pollinate: "Pollinated", prune: "Pruned", refill: "Full refill", topup: "Top-up", harvest: "Harvest" };
function renderLog() {
  const sel = $("logpot");
  const cur = sel.value;
  sel.innerHTML = `<option value="all">All pots</option>` + active().map(p => `<option value="${p.id}">${potName(p)} · ${esc(seedOf(p).name)}</option>`).join("");
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  $("heightlabel").textContent = db.units === "F" ? "Height (in)" : "Height (cm)";
  const ul = $("entries"), list = state.log.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  if (!list.length) { ul.innerHTML = `<li class="emptyrow">No entries yet. A first note like “seeds in, light on” is worth a line.</li>`; return; }
  ul.innerHTML = list.map(e => {
    const p = e.pot === "all" ? null : findPot(e.pot);
    const who = p ? esc(seedOf(p).name) : "All pots";
    const extra = [e.height ? heightTxt(e.height) : "", esc(e.text)].filter(Boolean).join(" · ");
    return `<li><span class="date">${fmt(e.date, { weekday: "short", month: "short", day: "numeric" })}</span><div><span class="k">${TYPE[e.type] || "Note"}</span> <span class="small muted">· ${who}</span><div>${extra}</div></div><button class="btn ghost sm" data-del="${e.id}" aria-label="Delete entry">Delete</button></li>`;
  }).join("");
}
function renderHistory() {
  const sec = $("historysec");
  if (!state.history.length) { sec.classList.add("hidden"); return; }
  sec.classList.remove("hidden");
  $("history").innerHTML = state.history.slice().reverse().map(p => {
    const s = SEEDS[p.seed] || SEEDS["other-herb"];
    const got = milestones(s).filter(([k]) => p.ms[k]).map(([, l]) => l.toLowerCase());
    return `<li><strong>${esc(s.name)}</strong> <span class="muted small">${fmt(p.sown)} – ${fmt(p.ended)} · ${diff(p.sown, p.ended)} days</span><div class="small">${got.length ? "Reached: " + esc(got.join(", ")) : "No milestones logged"}</div></li>`;
  }).join("");
}
function renderUnits() {
  document.querySelectorAll("[data-units]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.units === db.units)));
}
/* ---------------- catch-up for gardens that were already growing ---------------- */
// Pots sown a few days ago with nothing logged get a one-time checklist of the stages that could have happened by now.
function catchupPots() {
  const done = state.caughtUp || {};
  return active().filter(p => dayOf(p) >= 4 && !done[p.id] && !Object.keys(p.ms).length).map(p => {
    const s = seedOf(p), d = dayOf(p);
    const stages = milestones(s).filter(([k]) => windowOf(s, k).r[0] <= d).map(([k, label]) => {
      const r = windowOf(s, k).r, mid = Math.round((r[0] + r[1]) / 2);
      const est = addDays(p.sown, Math.min(mid, d));
      return { k, label, r, est };
    });
    return { p, s, d, stages };
  }).filter(x => x.stages.length);
}
let showCatchupDates = false;
function renderCatchup() {
  const box = $("catchup"), list = catchupPots();
  if (!list.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<h2 id="catchuph">Catch up your garden</h2>
    <p class="muted">Some pots were sown a while ago. Tick anything that's already happened and Sprout Log will fill in estimated dates${showCatchupDates ? ". Adjust any date you remember exactly." : "."}</p>
    <div class="cu-pots">${list.map(({ p, s, d, stages }) => `
      <div class="cu-pot"><p class="cu-head"><strong>${esc(s.name)}</strong> <span class="muted small">${potName(p)} · sown ${d} days ago</span></p>
      ${stages.map((st, i) => `<label class="cu-row"><input type="checkbox" data-cu="${p.id}" data-k="${st.k}" data-i="${i}">
        <span>${esc(st.label)} <span class="muted small">usually day ${st.r[0]}–${st.r[1]}</span></span>
        <input type="date" class="cu-date ${showCatchupDates ? "" : "hidden"}" data-cud="${p.id}:${st.k}" value="${st.est}" min="${p.sown}" max="${today()}" aria-label="${esc(st.label)} date"></label>`).join("")}
      </div>`).join("")}</div>
    <div class="row"><button class="btn solid" data-cusave="1">Save</button><button class="btn ghost" data-cudates="1">${showCatchupDates ? "Hide dates" : "Change dates"}</button><button class="btn ghost" data-cuskip="1">Not now</button></div>`;
}
function saveCatchup(skip) {
  state.caughtUp = state.caughtUp || {};
  catchupPots().forEach(({ p }) => {
    const pot = potById(p.id);
    if (!skip) document.querySelectorAll(`input[data-cu="${p.id}"]:checked`).forEach(cb => {
      const d = document.querySelector(`input[data-cud="${p.id}:${cb.dataset.k}"]`);
      pot.ms[cb.dataset.k] = (d && d.value) || today();
    });
    state.caughtUp[p.id] = 1;
  });
  showCatchupDates = false;
  save(); render();
  if (!skip) toast("Garden caught up.");
}

/* ---------------- iPhone / iPad: protect gardens from Safari's 7-day storage limit ---------------- */
// Safari clears a site's saved data after 7 days without a visit. Home Screen web apps are exempt,
// but they keep their own separate storage, so the tip walks people through export, add, import.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
function renderIosTip() {
  const box = $("iosTip"), show = isIOS && !isStandalone && !(db.dismissed || {}).iosTip;
  box.classList.toggle("hidden", !show);
  if (!show) return;
  box.innerHTML = `<h3 id="iostiph">On iPhone or iPad? Keep your garden safe</h3>
    <p>Safari clears a website's saved data if you don't visit it for 7 days. Adding Sprout Log to your Home Screen avoids that. The Home Screen version keeps its own copy, so bring your garden with you:</p>
    <ol>
      <li><button class="btn sm" data-exporttip="1">Export a backup</button> <span class="muted">This saves a small file.</span></li>
      <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
      <li>Open Sprout Log from your Home Screen, tap <strong>I have a backup</strong>, and pick the file.</li>
    </ol>
    <div class="row"><button class="btn ghost sm" data-dismiss="iosTip">Got it</button></div>`;
}

/* ---------------- views: home (intro), setup, garden ---------------- */
let view = "home";
const PATHS = { home: "/", setup: "/setup", garden: "/garden", welcome: "/welcome" };
function viewFromPath() {
  if (!/^https?:$/.test(location.protocol)) return state.device ? "garden" : "home";
  const p = location.pathname.replace(/\/+$/, "") || "/";
  if (p === "/setup") return "setup";
  if (p === "/garden" || p === "/welcome") return state.device ? "garden" : "home";
  return state.device ? "garden" : "home";
}
function go(v, replace) {
  view = v;
  const path = PATHS[v];
  if (/^https?:$/.test(location.protocol) && location.pathname !== path) {
    try { history[replace ? "replaceState" : "pushState"]({ v }, "", path + location.search); } catch (e) { /* ignore */ }
  }
  render();
  window.scrollTo({ top: 0 });
}
window.addEventListener("popstate", () => {
  view = viewFromPath();
  if (view !== "setup" && addingGarden) { addingGarden = false; state = activeGarden() || blankGarden(); view = state.device ? "garden" : "home"; }
  if (view === "setup" && !draft) initDraft();
  if (view === "setup") renderSetup();
  render();
});
function render() {
  if ((view === "garden" || view === "welcome") && !state.device) view = "home";
  const garden = view === "garden" || view === "welcome";
  $("intro").classList.toggle("hidden", view !== "home");
  $("setup").classList.toggle("hidden", view !== "setup");
  $("app").classList.toggle("hidden", !garden);
  $("editBtn").classList.toggle("hidden", !garden);
  renderSwitcher(garden && db.gardens.length > 0);
  $("unitsToggle").classList.toggle("hidden", view === "home");
  renderUnits();
  if (view === "home") { $("standaloneNote").classList.toggle("hidden", !isStandalone); drawUnit("introUnit", samplePots(), 4); return; }
  if (view === "setup") return;
  drawUnit("unit", state.pots, state.potCount); renderIosTip(); renderCatchup(); renderHero(); renderPots(); renderTasks(); renderDevice(); renderUpcoming(); renderLog(); renderHistory(); renderUnits();
}

/* ---------------- setup ---------------- */
/* ---------------- searchable seed picker ---------------- */
const SEED_ALIASES = {
  arugula: "rocket", romaine: "lettuce", "crispy-salad": "lettuce", "pak-choi": "bok choy", "curly-kale": "kale",
  "garden-cress": "cress", physalis: "cape gooseberry ground cherry", "sweet-pepper": "bell pepper capsicum",
  cayennetta: "cayenne", "kit-tomato": "kit", "kit-chili": "kit", "other-herb": "other brand", "other-leafy": "other brand lettuce",
  "other-tomato": "other brand", "other-pepper": "other brand"
};
const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/chilli/g, "chili");
// The kit variety label ("Chili & Tomato Kit") is left out so searching "chili" doesn't surface the kit tomato.
const SEED_INDEX = L.seeds.map(s => ({ s, text: norm([s.name, s.id.startsWith("kit-") ? "" : s.variety || "", L.groups[s.group].label, SEED_ALIASES[s.id] || ""].join(" ")) }));
const seedLabel = s => s ? s.name + (s.variety ? ` (${s.variety})` : "") : "";
const seedMatches = q => { const t = norm(q).split(/\s+/).filter(Boolean); return SEED_INDEX.filter(x => t.every(w => x.text.includes(w))).map(x => x.s); };
let combo = { i: -1, active: 0, items: [] };
function openCombo(i, q) {
  const list = $("combo-list-" + i), input = $("combo-" + i);
  if (!list) return;
  const items = q.trim() ? seedMatches(q) : L.seeds.slice();
  const current = items.findIndex(s => s.id === draft.pots[i].seed);
  combo = { i, items, active: q.trim() || current < 0 ? 0 : current };
  if (!items.length) {
    list.innerHTML = `<li class="combo-empty" role="presentation">No matches. For seeds from another brand, try “Other herb” or “Other tomato”.</li>`;
  } else {
    let html = "", group = null;
    items.forEach((s, j) => {
      if (s.group !== group) { group = s.group; html += `<li class="combo-group" role="presentation">${esc(L.groups[group].label)}</li>`; }
      html += `<li role="option" id="combo-${i}-o${j}" class="combo-opt${j === combo.active ? " active" : ""}" data-pick="${i}:${s.id}" aria-selected="${s.id === draft.pots[i].seed}">${esc(s.name)}${s.variety ? ` <span class="muted">${esc(s.variety)}</span>` : ""}</li>`;
    });
    list.innerHTML = html;
  }
  list.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
  setActive(combo.active);
}
function setActive(j) {
  const list = $("combo-list-" + combo.i), input = $("combo-" + combo.i);
  if (!list || !combo.items.length) { if (input) input.removeAttribute("aria-activedescendant"); return; }
  combo.active = (j + combo.items.length) % combo.items.length;
  list.querySelectorAll(".combo-opt").forEach((o, k) => o.classList.toggle("active", k === combo.active));
  const el = $(`combo-${combo.i}-o${combo.active}`);
  input.setAttribute("aria-activedescendant", el.id);
  el.scrollIntoView({ block: "nearest" });
}
function closeCombo(i) {
  const list = $("combo-list-" + i), input = $("combo-" + i);
  if (list) list.classList.add("hidden");
  if (input) { input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  if (combo.i === i) combo.i = -1;
}
function pickSeed(i, id) {
  draft.pots[i].seed = id;
  combo.i = -1;
  renderSetup();
  const next = id ? document.querySelector(`input[data-i="${i}"][data-f="sown"]`) : $("combo-" + i);
  if (next) next.focus();
}
document.addEventListener("focusin", ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.combo !== undefined) {
    t.select(); openCombo(+t.dataset.combo, "");
    // On phones, lift the field toward the top so the on-screen keyboard doesn't hide the results.
    if (window.innerWidth < 820) setTimeout(() => t.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
  }
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.combo !== undefined) openCombo(+t.dataset.combo, t.value);
});
document.addEventListener("keydown", ev => {
  const t = ev.target;
  if (!t.dataset || t.dataset.combo === undefined) return;
  const i = +t.dataset.combo, open = combo.i === i;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!open) openCombo(i, ""); else setActive(combo.active + (ev.key === "ArrowDown" ? 1 : -1));
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    if (open && combo.items[combo.active]) pickSeed(i, combo.items[combo.active].id);
  } else if (ev.key === "Escape" && open) {
    ev.preventDefault();
    t.value = seedLabel(SEEDS[draft.pots[i].seed]);
    closeCombo(i);
  }
});
document.addEventListener("focusout", ev => {
  const t = ev.target;
  if (!t.dataset || t.dataset.combo === undefined) return;
  const i = +t.dataset.combo;
  setTimeout(() => {
    const input = $("combo-" + i);
    if (!input || document.activeElement === input) return;
    closeCombo(i);
    if (!input.value.trim() && draft.pots[i].seed) { draft.pots[i].seed = ""; renderSetup(); }
    else input.value = seedLabel(SEEDS[draft.pots[i].seed]);
  }, 120);
});
document.addEventListener("mousedown", ev => { if (ev.target.closest(".combo-list")) ev.preventDefault(); });
document.addEventListener("click", ev => {
  const o = ev.target.closest("[data-pick]");
  if (o) { const [i, id] = o.dataset.pick.split(":"); pickSeed(+i, id); }
});
function seedOptions(sel) {
  const groups = {};
  L.seeds.forEach(s => (groups[s.group] = groups[s.group] || []).push(s));
  return `<option value="">Empty</option>` + Object.keys(L.groups).filter(g => groups[g]).map(g =>
    `<optgroup label="${esc(L.groups[g].label)}">${groups[g].map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}${s.variety ? " (" + esc(s.variety) + ")" : ""}</option>`).join("")}</optgroup>`).join("");
}
let draft = null;
function initDraft() {
  draft = { name: state.name || "", device: state.device || "mini2", potCount: state.potCount || 4,
    pots: Array.from({ length: 6 }, (_, i) => state.pots[i] ? { seed: state.pots[i].seed, sown: state.pots[i].sown } : { seed: "", sown: today() }) };
}
function openSetup() {
  initDraft();
  renderSetup();
  go("setup");
}
function renderSetup() {
  const saved = db.gardens.includes(state) && !!state.device;
  $("setuph").textContent = addingGarden ? "Add another Auk" : saved ? "Edit garden" : "Set up your garden";
  $("setupCancel").textContent = saved || addingGarden ? "Cancel" : "Back";
  $("deleteWrap").classList.toggle("hidden", !saved);
  $("gardenName").value = draft.name;
  $("gardenName").placeholder = "e.g. Kitchen " + L.devices[draft.device].name.replace(/^Auk /, "");
  const dev = L.devices[draft.device];
  if (!dev.potOptions.some(o => o.count === draft.potCount)) draft.potCount = dev.potOptions[0].count;
  $("devices").innerHTML = Object.entries(L.devices).map(([id, d]) =>
    `<label class="devopt"><input type="radio" name="device" value="${id}" ${id === draft.device ? "checked" : ""}><span>${esc(d.name)}</span><small>${d.potOptions.map(o => o.count).join(" or ")} pots</small></label>`).join("");
  $("potcountwrap").innerHTML = dev.potOptions.length > 1
    ? `<label>Pot setup <select id="potcount">${dev.potOptions.map(o => `<option value="${o.count}" ${o.count === draft.potCount ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : `<p class="small muted">${esc(dev.potOptions[0].label)}</p>`;
  $("potrows").innerHTML = Array.from({ length: draft.potCount }, (_, i) => {
    const p = draft.pots[i], s = SEEDS[p.seed];
    const hint = s ? `${s.sow === "surface" ? "Leave seeds on the surface. " : ""}${s.seeds}. Planted earlier? Change the sow date.` : "";
    return `<div class="potrow"><span class="potnum">Pot ${i + 1}</span>
      <div class="grow field"><label for="combo-${i}">Seed</label>
        <div class="combo">
          <input type="text" id="combo-${i}" data-combo="${i}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="combo-list-${i}"
            autocomplete="off" spellcheck="false" enterkeyhint="done" placeholder="Type to search, e.g. basil or chili" value="${esc(seedLabel(s))}">
          ${s ? `<button type="button" class="combo-clear" data-comboclear="${i}" aria-label="Clear pot ${i + 1}">×</button>` : ""}
          <ul class="combo-list hidden" id="combo-list-${i}" role="listbox" aria-label="Seeds"></ul>
        </div>
      </div>
      <label>Sown on<input type="date" data-i="${i}" data-f="sown" value="${p.sown}" ${p.seed ? "" : "disabled"}></label>
      <p class="small muted hint">${esc(hint)}</p></div>`;
  }).join("");
}
function saveSetup() {
  const t = today(), first = !db.gardens.some(g => g.device);
  const next = [];
  for (let i = 0; i < Math.max(draft.potCount, state.pots.length); i++) {
    const old = state.pots[i], d = i < draft.potCount ? draft.pots[i] : { seed: "" };
    const same = old && d.seed === old.seed && d.sown === old.sown;
    if (old && !same) state.history.push(Object.assign({}, old, { ended: t }));
    if (i >= draft.potCount) continue;
    next[i] = !d.seed ? null : same ? old : { id: uid(), seed: d.seed, sown: d.sown || t, ms: {} };
  }
  state.device = draft.device; state.potCount = draft.potCount; state.pots = next;
  state.name = draft.name.trim();
  const added = !db.gardens.includes(state);
  if (added) db.gardens.push(state);
  db.active = state.id; addingGarden = false;
  save();
  // A brand-new garden gets its own address (/welcome) so Vercel Analytics can count gardens created.
  go(first ? "welcome" : "garden");
  if (first) toast(isIOS && !isStandalone ? "Your garden is set up." : "Your garden is set up. Bookmark this page to check in.");
  else if (added) toast(`${gardenName(state)} added.`);
}

/* ---------------- several gardens ---------------- */
function switchGarden(id) {
  if (!db.gardens.some(g => g.id === id)) return;
  db.active = id; state = activeGarden(); save(); go("garden");
}
function addGarden() {
  addingGarden = true;
  state = blankGarden();
  openSetup();
}
function leaveSetup() {
  if (addingGarden) { addingGarden = false; state = activeGarden() || blankGarden(); }
  go(state.device ? "garden" : "home");
}
function deleteGarden() {
  const name = gardenName(state);
  if (!confirm(`Delete "${name}"? Its pots, timeline and log will be removed from this browser. Export a backup first if you might want it back.`)) return;
  db.gardens = db.gardens.filter(g => g !== state);
  db.active = db.gardens[0] ? db.gardens[0].id : null;
  state = activeGarden() || blankGarden();
  save();
  go(state.device ? "garden" : "home");
  toast(`${name} deleted.`);
}
function renderSwitcher(show) {
  const sel = $("gardenSwitch");
  sel.classList.toggle("hidden", !show);
  if (!show) return;
  sel.innerHTML = db.gardens.map(g => `<option value="${g.id}" ${g === state ? "selected" : ""}>${esc(gardenName(g))}</option>`).join("") +
    `<option value="__add">+ Add another Auk</option>`;
}

/* ---------------- events ---------------- */
function addLog(e) { e.id = uid(); state.log.push(e); save(); render(); }
function potById(id) { return state.pots.find(p => p && p.id === id); }
function doseText(type) {
  const g = guidance();
  if (!g.dose) return "";
  const r = g.dose.rows[type === "refill" ? 0 : 1];
  return g.dose.head.map((h, i) => (g.dose.off.includes(i + 1) || r[i + 1] === "–") ? null : `${r[i + 1]} ${h}`).filter(Boolean).join(" + ") + (type === "topup" ? " per litre" : "");
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.dataset.mark) { const [id, k] = b.dataset.mark.split(":"); potById(id).ms[k] = today(); save(); render(); }
  else if (b.dataset.clear) { const [id, k] = b.dataset.clear.split(":"); delete potById(id).ms[k]; save(); render(); }
  else if (b.dataset.del) { state.log = state.log.filter(e => e.id !== b.dataset.del); save(); render(); }
  else if (b.dataset.quick) addLog({ date: today(), pot: "all", type: b.dataset.quick, text: doseText(b.dataset.quick), height: null });
  else if (b.dataset.comboclear !== undefined) pickSeed(+b.dataset.comboclear, "");
  else if (b.dataset.edit || b.dataset.start) openSetup();
  else if (b.dataset.home) { if (addingGarden) leaveSetup(); else go(state.device ? "garden" : "home"); }
  else if (b.dataset.exporttip) exportData();
  else if (b.dataset.dismiss) { db.dismissed = db.dismissed || {}; db.dismissed[b.dataset.dismiss] = 1; save(); render(); }
  else if (b.dataset.cusave) saveCatchup(false);
  else if (b.dataset.cuskip) saveCatchup(true);
  else if (b.dataset.cudates) {
    const ticked = [...document.querySelectorAll("input[data-cu]:checked")].map(c => c.dataset.cu + ":" + c.dataset.k);
    const dates = Object.fromEntries([...document.querySelectorAll("input[data-cud]")].map(i => [i.dataset.cud, i.value]));
    showCatchupDates = !showCatchupDates; renderCatchup();
    ticked.forEach(t => { const [id, k] = t.split(":"); const c = document.querySelector(`input[data-cu="${id}"][data-k="${k}"]`); if (c) c.checked = true; });
    Object.entries(dates).forEach(([key, v]) => { const i = document.querySelector(`input[data-cud="${key}"]`); if (i) i.value = v; });
  }
  else if (b.dataset.units) { db.units = b.dataset.units; save(); if (state.device) render(); else renderUnits(); }
  else if (b.id === "setupSave") saveSetup();
  else if (b.id === "setupCancel") leaveSetup();
  else if (b.id === "deleteGarden") deleteGarden();
  else if (b.id === "exportBtn") exportData();
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "gardenSwitch") { if (t.value === "__add") addGarden(); else switchGarden(t.value); }
  else if (t.name === "device") { draft.device = t.value; renderSetup(); }
  else if (t.id === "potcount") { draft.potCount = Number(t.value); renderSetup(); }
  else if (t.dataset.f) { draft.pots[+t.dataset.i][t.dataset.f] = t.value; if (t.dataset.f === "seed") renderSetup(); }
  else if (t.dataset.k && t.dataset.pot && t.type === "date" && t.value) { potById(t.dataset.pot).ms[t.dataset.k] = t.value; save(); render(); }
  else if (t.dataset.cu) {
    const boxes = [...document.querySelectorAll(`input[data-cu="${t.dataset.cu}"]`)], i = +t.dataset.i;
    boxes.forEach(b => { const j = +b.dataset.i; if (t.checked && j < i) b.checked = true; if (!t.checked && j > i) b.checked = false; });
  }
  else if (t.dataset.check !== undefined) {
    if (t.checked) { state.checks[t.dataset.check] = 1; if (t.dataset.task === "pollinate") state.log.push({ id: uid(), date: today(), pot: "all", type: "pollinate", text: "", height: null }); }
    else delete state.checks[t.dataset.check];
    save(); render();
  }
});
const form = $("logform");
form.date.value = today();
form.addEventListener("submit", ev => {
  ev.preventDefault();
  const f = new FormData(form), type = f.get("type");
  let text = (f.get("text") || "").trim();
  if (!text && (type === "refill" || type === "topup")) text = doseText(type);
  const hv = f.get("height");
  const cm = hv ? (db.units === "F" ? Math.round(Number(hv) * 2.54 * 10) / 10 : Number(hv)) : null;
  addLog({ date: f.get("date") || today(), pot: f.get("pot"), type, text, height: cm });
  form.text.value = ""; form.height.value = ""; form.date.value = today();
});

/* ---------------- backup ---------------- */
function exportData() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: "application/json" }));
  a.download = `sprout-log-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}
$("importFile").addEventListener("change", async ev => {
  const f = ev.target.files[0]; if (!f) return;
  let incoming;
  try { incoming = toDb(JSON.parse(await f.text())); }
  catch (e) { toast("That file isn't a Sprout Log backup."); ev.target.value = ""; return; }
  ev.target.value = "";
  if (!incoming.gardens.length) { toast("That backup doesn't have a garden in it."); return; }
  const have = db.gardens.filter(g => g.device).length;
  let msg = "Backup imported.";
  if (!have) { db = incoming; }
  else if (incoming.gardens.length === 1) {
    // A one-garden backup is added alongside what's here, so nothing is lost.
    const g = incoming.gardens[0];
    if (db.gardens.some(x => x.id === g.id)) g.id = uid();
    db.gardens.push(g); db.active = g.id; msg = `${gardenName(g)} added from your backup.`;
  } else {
    if (!confirm(`This backup has ${incoming.gardens.length} gardens. Replace the ${have} garden${have > 1 ? "s" : ""} in this browser with them?`)) return;
    db = incoming;
  }
  addingGarden = false;
  state = activeGarden() || blankGarden();
  save(); go("garden"); toast(msg);
  ev.target.value = "";
});
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500); }

$("gardenName").addEventListener("input", ev => { if (draft) draft.name = ev.target.value; });
$("libdate").textContent = fmt(L.checked, { month: "long", day: "numeric", year: "numeric" });
view = viewFromPath();
if (view === "setup") { initDraft(); renderSetup(); }
go(view, true);
setInterval(() => { if (document.visibilityState === "visible" && state.device) render(); }, 60 * 60 * 1000);
})();
