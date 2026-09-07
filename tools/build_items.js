// 公式Wiki(カテゴリ) + rusthelp(名称/ID) を突き合わせて items.json を生成する
// usage: node build_items.js <items_overview.html> <rusthelp_items.html> <out items.json> <out extra shortnames.txt>
const fs = require("fs");
const path = require("path");
const [wikiHtml, rhHtml, outJson, outExtra] = process.argv.slice(2);
const h = fs.readFileSync(wikiHtml, "utf8");

// --- 公式Wiki: <details class="level1"><summary><div><i/> Category <span class="child-count">N</span> ... <a href="/rust/item/xxx">Name</a>
const blocks = [];
const reBlock = /<details class="level1"[^>]*>\s*<summary>\s*<div>\s*(?:<i[^>]*><\/i>)?\s*([^<]+?)\s*<span class="child-count">(\d+)<\/span>/g;
let m;
while ((m = reBlock.exec(h))) blocks.push({ cat: m[1].trim(), n: +m[2], pos: m.index });
const wiki = new Map(); // shortname -> {cat,name}
for (let b = 0; b < blocks.length; b++) {
  const seg = h.slice(blocks[b].pos, b + 1 < blocks.length ? blocks[b + 1].pos : undefined);
  for (const a of seg.matchAll(/<a[^>]*href="\/rust\/item\/([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/g)) {
    if (!wiki.has(a[1])) wiki.set(a[1], { cat: blocks[b].cat, name: a[2].trim() });
  }
}
console.log("wiki blocks:", blocks.map((b) => `${b.cat}(${b.n})`).join(", "));
console.log("wiki items:", wiki.size);

// --- rusthelp: {shortName:"..",rustItemId:-123,displayName:"..",description:".."}
const r = fs.readFileSync(rhHtml, "utf8");
const rh = new Map();
const reRh = /\{shortName:"([^"]+)",rustItemId:(-?\d+),displayName:"((?:[^"\\]|\\.)*)",description:"((?:[^"\\]|\\.)*)"/g;
while ((m = reRh.exec(r))) {
  rh.set(m[1], { id: +m[2], name: JSON.parse('"' + m[3] + '"'), desc: JSON.parse('"' + m[4] + '"') });
}
console.log("rusthelp items:", rh.size);

// --- マージ（アイコン有無は後段で判定）
const all = new Set([...wiki.keys(), ...rh.keys()]);
const items = [];
for (const s of all) {
  const w = wiki.get(s), x = rh.get(s);
  items.push({ s, id: x ? x.id : null, n: (x && x.name) || (w && w.name) || s, c: w ? w.cat : "Other", d: x ? x.desc : "" });
}
items.sort((a, b) => a.n.localeCompare(b.n));
fs.writeFileSync(outJson, JSON.stringify(items));
const extra = [...rh.keys()].filter((s) => !wiki.has(s));
fs.writeFileSync(outExtra, extra.join("\n") + "\n");
console.log("merged:", items.length, " rusthelp-only:", extra.length, " wiki-only:", [...wiki.keys()].filter((s) => !rh.has(s)).length);
const catCount = {};
for (const it of items) catCount[it.c] = (catCount[it.c] || 0) + 1;
console.log(catCount);
