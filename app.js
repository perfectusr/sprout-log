(function () {
"use strict";

const L = window.SPROUT_LIBRARY;
const SEEDS = Object.fromEntries(L.seeds.map(s => [s.id, s]));
const KEY = "sprout-log-v2";
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
function blank() {
  return { v: 2, device: null, potCount: 0, pots: [], log: [], history: [], checks: {},
    units: (navigator.language || "").toLowerCase() === "en-us" ? "F" : "C", updated: 0 };
}
function migrateV1(o) {
  const s = blank();
  s.device = "mini2"; s.potCount = 2; s.units = "F";
  const t = { id: uid(), seed: "kit-tomato", sown: o.sowDate, ms: (o.plants && o.plants.tomato && o.plants.tomato.milestones) || {} };
  const c = { id: uid(), seed: "kit-chili", sown: o.sowDate, ms: (o.plants && o.plants.chili && o.plants.chili.milestones) || {} };
  s.pots = [t, c];
  s.log = (o.log || []).map(e => ({ id: e.id || uid(), date: e.date, pot: e.plant === "tomato" ? t.id : e.plant === "chili" ? c.id : "all",
    type: e.type, text: e.text || "", height: e.height || null }));
  return s;
}
function normalize(o) {
  if (!o || typeof o !== "object") throw new Error("bad");
  if (o.v === 2) return Object.assign(blank(), o);
  if (o.sowDate && o.plants) return migrateV1(o);
  throw new Error("bad");
}
let state = blank();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = normalize(JSON.parse(raw));
  else {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) { state = migrateV1(JSON.parse(legacy)); localStorage.setItem(KEY, JSON.stringify(state)); }
  }
} catch (e) { state = blank(); }

function save() {
  state.updated = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast("Couldn't save in this browser. Export a backup so you don't lose anything."); }
}

/* ---------------- units ---------------- */
const tempTxt = r => {
  if (!r) return "";
  const conv = c => state.units === "F" ? Math.round(c * 9 / 5 + 32) : c;
  const u = state.units === "F" ? "°F" : "°C";
  return r[0] === r[1] ? `${conv(r[0])} ${u}` : `${conv(r[0])}–${conv(r[1])} ${u}`;
};
const lenTxt = cm => state.units === "F" ? `${Math.round(cm / 2.54)} in` : `${cm} cm`;
const heightTxt = cm => state.units === "F" ? `${(cm / 2.54).toFixed(1).replace(/\.0$/, "")} in` : `${cm} cm`;

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
function drawUnit() {
  const n = Math.max(1, state.potCount), soilY = 248;
  const span = 400, spacing = span / n, rx = Math.min(62, spacing * 0.4);
  const scale = Math.max(0.6, Math.min(1, spacing / 150));
  let s = `<defs><linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--glow)" stop-opacity=".5"/><stop offset="1" stop-color="var(--glow)" stop-opacity="0"/></linearGradient></defs>`;
  s += `<polygon class="glowbeam" points="70,58 490,58 500,262 60,262" fill="url(#beam)"/>`;
  s += `<rect x="44" y="26" width="16" height="250" rx="5" fill="var(--wood)"/><rect x="500" y="26" width="16" height="250" rx="5" fill="var(--wood)"/>`;
  s += `<rect x="36" y="36" width="488" height="22" rx="11" fill="var(--ink)"/><rect x="70" y="54" width="420" height="4" rx="2" fill="var(--glow)"/>`;
  const centers = [];
  for (let i = 0; i < n; i++) centers.push(80 + spacing * (i + .5));
  centers.forEach((cx, i) => { const p = state.pots[i]; if (p) s += drawPlant(Object.assign({ idx: i }, p), cx, soilY, scale); });
  s += `<rect x="24" y="252" width="512" height="44" rx="14" fill="var(--wood)"/>`;
  centers.forEach((cx, i) => {
    const p = state.pots[i];
    s += `<ellipse cx="${cx}" cy="253" rx="${rx}" ry="11" fill="${p ? "var(--soil)" : "var(--soil-empty)"}"/>`;
    const label = p ? seedOf(p).name.split(" (")[0] : "Empty";
    const short = n > 3 && label.length > 20 ? label.slice(0, 19) + "…" : label;
    const ly = n > 3 ? 314 + (i % 2) * 17 : 318;
    s += `<text x="${cx}" y="${ly}" text-anchor="middle" font-size="${n > 3 ? 12 : 14}" font-weight="700" fill="${p ? "var(--ink)" : "var(--ink-2)"}" font-family="inherit">${esc(short)}</text>`;
  });
  document.getElementById("unit").innerHTML = s;
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
  $("daynum").innerHTML = `Day ${n}<small>since your first sowing · ${fmt(first, { weekday: "short", month: "short", day: "numeric" })}</small>`;
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
  $("heightlabel").textContent = state.units === "F" ? "Height (in)" : "Height (cm)";
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
  document.querySelectorAll("[data-units]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.units === state.units)));
}
function render() {
  const ready = !!state.device;
  $("app").classList.toggle("hidden", !ready);
  if (!ready) { openSetup(); return; }
  drawUnit(); renderHero(); renderPots(); renderTasks(); renderDevice(); renderUpcoming(); renderLog(); renderHistory(); renderUnits();
}

/* ---------------- setup ---------------- */
function seedOptions(sel) {
  const groups = {};
  L.seeds.forEach(s => (groups[s.group] = groups[s.group] || []).push(s));
  return `<option value="">Empty</option>` + Object.keys(L.groups).filter(g => groups[g]).map(g =>
    `<optgroup label="${esc(L.groups[g].label)}">${groups[g].map(s => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}${s.variety ? " (" + esc(s.variety) + ")" : ""}</option>`).join("")}</optgroup>`).join("");
}
let draft = null;
function openSetup() {
  draft = { device: state.device || "mini2", potCount: state.potCount || 4,
    pots: Array.from({ length: 6 }, (_, i) => state.pots[i] ? { seed: state.pots[i].seed, sown: state.pots[i].sown } : { seed: "", sown: today() }) };
  $("setup").classList.remove("hidden");
  $("setupCancel").classList.toggle("hidden", !state.device);
  renderUnits();
  renderSetup();
  $("setup").scrollIntoView({ block: "start" });
}
function renderSetup() {
  const dev = L.devices[draft.device];
  if (!dev.potOptions.some(o => o.count === draft.potCount)) draft.potCount = dev.potOptions[0].count;
  $("devices").innerHTML = Object.entries(L.devices).map(([id, d]) =>
    `<label class="devopt"><input type="radio" name="device" value="${id}" ${id === draft.device ? "checked" : ""}><span>${esc(d.name)}</span><small>${d.potOptions.map(o => o.count).join(" or ")} pots</small></label>`).join("");
  $("potcountwrap").innerHTML = dev.potOptions.length > 1
    ? `<label>Pot setup <select id="potcount">${dev.potOptions.map(o => `<option value="${o.count}" ${o.count === draft.potCount ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : `<p class="small muted">${esc(dev.potOptions[0].label)}</p>`;
  $("potrows").innerHTML = Array.from({ length: draft.potCount }, (_, i) => {
    const p = draft.pots[i], s = SEEDS[p.seed];
    const hint = s ? `${s.sow === "surface" ? "Leave seeds on the surface. " : ""}${s.seeds}.` : "";
    return `<div class="potrow"><span class="potnum">Pot ${i + 1}</span>
      <label class="grow">Seed<select data-i="${i}" data-f="seed">${seedOptions(p.seed)}</select></label>
      <label>Sown on<input type="date" data-i="${i}" data-f="sown" value="${p.sown}" ${p.seed ? "" : "disabled"}></label>
      <p class="small muted hint">${esc(hint)}</p></div>`;
  }).join("");
}
function saveSetup() {
  const t = today();
  const next = [];
  for (let i = 0; i < Math.max(draft.potCount, state.pots.length); i++) {
    const old = state.pots[i], d = i < draft.potCount ? draft.pots[i] : { seed: "" };
    const same = old && d.seed === old.seed && d.sown === old.sown;
    if (old && !same) state.history.push(Object.assign({}, old, { ended: t }));
    if (i >= draft.potCount) continue;
    next[i] = !d.seed ? null : same ? old : { id: uid(), seed: d.seed, sown: d.sown || t, ms: {} };
  }
  state.device = draft.device; state.potCount = draft.potCount; state.pots = next;
  save();
  $("setup").classList.add("hidden");
  render();
  window.scrollTo({ top: 0 });
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
  else if (b.dataset.edit) openSetup();
  else if (b.dataset.units) { state.units = b.dataset.units; save(); if (state.device) render(); else renderUnits(); }
  else if (b.id === "setupSave") saveSetup();
  else if (b.id === "setupCancel") { $("setup").classList.add("hidden"); }
  else if (b.id === "exportBtn") exportData();
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.name === "device") { draft.device = t.value; renderSetup(); }
  else if (t.id === "potcount") { draft.potCount = Number(t.value); renderSetup(); }
  else if (t.dataset.f) { draft.pots[+t.dataset.i][t.dataset.f] = t.value; if (t.dataset.f === "seed") renderSetup(); }
  else if (t.dataset.k && t.dataset.pot && t.type === "date" && t.value) { potById(t.dataset.pot).ms[t.dataset.k] = t.value; save(); render(); }
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
  const cm = hv ? (state.units === "F" ? Math.round(Number(hv) * 2.54 * 10) / 10 : Number(hv)) : null;
  addLog({ date: f.get("date") || today(), pot: f.get("pot"), type, text, height: cm });
  form.text.value = ""; form.height.value = ""; form.date.value = today();
});

/* ---------------- backup ---------------- */
function exportData() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  a.download = `sprout-log-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}
$("importFile").addEventListener("change", async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try { state = normalize(JSON.parse(await f.text())); save(); $("setup").classList.add("hidden"); render(); toast("Backup imported."); }
  catch (e) { toast("That file isn't a Sprout Log backup."); }
  ev.target.value = "";
});
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500); }

$("libdate").textContent = fmt(L.checked, { month: "long", day: "numeric", year: "numeric" });
render();
setInterval(() => { if (document.visibilityState === "visible" && state.device) render(); }, 60 * 60 * 1000);
})();
