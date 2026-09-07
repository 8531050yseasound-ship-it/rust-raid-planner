// Corrosion Hour の item list HTML からスタック上限を抽出し、items.json に st（最大スタック数）を付与する
// usage: node add_stacks.js <rust-item-list.html> <items.json>
const fs = require("fs");
const [htmlP, itemsP] = process.argv.slice(2);
const h = fs.readFileSync(htmlP, "utf8");
const st = {};
for (const m of h.matchAll(/class="ch-tbl-short-name">([^<]+)<\/td>[\s\S]*?class="ch-tbl-stack-size">(\d+)<\/td>/g)) st[m[1].trim()] = +m[2];
fs.writeFileSync(require("path").join(__dirname, "stacks.json"), JSON.stringify(st));
const items = JSON.parse(fs.readFileSync(itemsP, "utf8"));
let hit = 0, miss = [];
for (const it of items) { if (st[it.s]) { it.st = st[it.s]; hit++; } else { it.st = 1; miss.push(it.s); } }
fs.writeFileSync(itemsP, JSON.stringify(items));
console.log(`stack rows: ${Object.keys(st).length}, items with stack: ${hit}/${items.length}, missing(=1): ${miss.length}`);
console.log(miss.slice(0, 60).join(" "));
console.log("samples:", ["ammo.rifle", "explosive.timed", "ammo.rocket.basic", "syringe.medical", "bandage", "wood", "largemedkit", "grenade.f1", "rifle.ak", "ladder.wooden.wall", "explosive.satchel", "metal.refined"].map(s => s + "=" + st[s]).join(" "));
