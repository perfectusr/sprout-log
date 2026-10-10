#!/usr/bin/env node
/*
  Re-checks every Auk help article linked from data/library.js.
  It stores only a fingerprint (hash) of each article's text — never the text itself —
  in data/doc-hashes.json, and reports which articles changed since the last check.

  Usage:
    node scripts/check-docs.mjs            report only
    node scripts/check-docs.mjs --update   report and save new fingerprints

  Needs Node 18+ (built-in fetch). No dependencies.
*/
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libPath = path.join(root, "data/library.js");
const hashPath = path.join(root, "data/doc-hashes.json");
const reportPath = path.join(root, "doc-check-report.md");
const update = process.argv.includes("--update");

const sandbox = { window: {} };
vm.runInNewContext(await readFile(libPath, "utf8"), sandbox);
const lib = sandbox.window.SPROUT_LIBRARY;

// Which seeds rely on each source, so the report says what to review.
const usedBy = {};
for (const s of lib.seeds) for (const k of s.sources || []) (usedBy[k] ||= []).push(s.name);
for (const [id, d] of Object.entries(lib.devices)) for (const k of d.sources || []) (usedBy[k] ||= []).push(d.name + " settings");

let previous = {};
try { previous = JSON.parse(await readFile(hashPath, "utf8")); } catch { /* first run */ }

function articleText(html) {
  const m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let t = (m ? m[1] : html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
  const cut = t.search(/Related Articles/i);       // the related-links box changes often; ignore it
  if (cut > 0) t = t.slice(0, cut).trim();
  return t;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
for (const [key, src] of Object.entries(lib.sources)) {
  try {
    const res = await fetch(src.url, { headers: { "User-Agent": "SproutLog doc check (+https://github.com)" }, redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = articleText(await res.text());
    if (text.length < 200) throw new Error("article text not found");
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const before = previous[src.url]?.hash;
    results.push({ key, src, hash, status: !before ? "new" : before === hash ? "same" : "changed" });
  } catch (e) {
    results.push({ key, src, status: "failed", error: e.message });
  }
  await sleep(400); // be polite to Auk's help centre
}

const changed = results.filter(r => r.status === "changed");
const failed = results.filter(r => r.status === "failed");
const fresh = results.filter(r => r.status === "new");
const today = new Date().toISOString().slice(0, 10);

let md = `## Auk help-centre check — ${today}\n\n`;
md += `Checked ${results.length} articles: ${changed.length} changed, ${fresh.length} new, ${failed.length} couldn't be read.\n\n`;
if (changed.length) {
  md += `### Changed since the last check\nOpen each article and compare it with the matching entries in \`data/library.js\`. Update any timings, then bump \`checked\` at the top of that file.\n\n`;
  for (const r of changed) md += `- [${r.src.label}](${r.src.url}) — used by: ${(usedBy[r.key] || ["(unused)"]).join(", ")}\n`;
  md += "\n";
}
if (failed.length) {
  md += `### Couldn't read\nThese may have moved or been removed. Search Auk's help centre and update the link in \`data/library.js\`.\n\n`;
  for (const r of failed) md += `- [${r.src.label}](${r.src.url}) — ${r.error}\n`;
  md += "\n";
}
if (!changed.length && !failed.length) md += "Nothing to review.\n";

console.log(md);
await writeFile(reportPath, md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `needs_review=${changed.length || failed.length ? "true" : "false"}\n`);

if (update) {
  const next = { ...previous };
  for (const r of results) if (r.hash) next[r.src.url] = { hash: r.hash, checked: today };
  await writeFile(hashPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`Saved fingerprints to ${path.relative(root, hashPath)}`);
}
