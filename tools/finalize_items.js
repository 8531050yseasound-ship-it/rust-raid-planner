// items_raw.json + rostov114 items_text.md(カテゴリ補完) + jp_aliases.json + アイコン有無 → items.json
// usage: node finalize_items.js <items_raw.json> <items_text.md> <jp_aliases.json> <out items.json>
const fs = require("fs");
const path = require("path");
const [rawP, mdP, jpP, outP] = process.argv.slice(2);
const P = path.resolve(__dirname, "..");
const raw = JSON.parse(fs.readFileSync(rawP, "utf8"));
const jp = JSON.parse(fs.readFileSync(jpP, "utf8"));
delete jp._;

// rostov114 の表: |[shortname](/x.png)|ID|Name|Category|
const catMap = { Weapon: "Weapons", Ammunition: "Ammo", Tool: "Tools", Component: "Components", Items: "Items", Attire: "Attire", Food: "Food", Electrical: "Electrical", Misc: "Misc", Construction: "Construction", Fun: "Fun", Resources: "Resources", Traps: "Traps", Medical: "Medical" };
const rost = new Map();
for (const line of fs.readFileSync(mdP, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\|\[([^\]]+)\]\([^)]*\)\|(-?\d+)\|([^|]*)\|([^|]*)\|/);
  if (m) rost.set(m[1].trim(), { id: +m[2], name: m[3].trim(), cat: catMap[m[4].trim()] || "Misc" });
}
console.log("rostov rows:", rost.size);

// 「よく使う（レイド）」擬似カテゴリ
const RAID = new Set(["explosive.timed", "explosive.satchel", "rocket.launcher", "ammo.rocket.basic", "ammo.rocket.hv", "ammo.rocket.fire", "ammo.rifle.explosive", "grenade.beancan", "grenade.f1", "multiplegrenadelauncher", "ammo.grenadelauncher.he", "ladder.wooden.wall", "building.planner", "hammer", "jackhammer", "syringe.medical", "bandage", "largemedkit", "rifle.ak", "rifle.lr300", "smg.mp5", "lmg.m249", "rifle.bolt", "rifle.l96", "rifle.semiauto", "shotgun.spas12", "shotgun.pump", "ammo.rifle", "ammo.rifle.hv", "ammo.pistol", "ammo.shotgun", "ammo.shotgun.slug", "weapon.mod.holosight", "weapon.mod.silencer", "weapon.mod.lasersight", "weapon.mod.small.scope", "metal.facemask", "metal.plate.torso", "roadsign.kilt", "roadsign.jacket", "roadsign.gloves", "tactical.gloves", "hoodie", "pants", "shoes.boots", "coffeecan.helmet", "hazmatsuit", "nightvisiongoggles", "cupboard.tool", "door.hinged.metal", "door.hinged.toptier", "wall.frame.garagedoor", "lock.code", "wood", "stones", "metal.fragments", "metal.refined", "sheetmetal", "box.wooden.large", "sleepingbag", "supply.signal", "flare", "torch", "flashlight.held", "tool.binoculars", "rf.detonator", "grenade.smoke", "grenade.flashbang", "grenade.molotov", "flamethrower", "lowgradefuel", "gunpowder", "sulfur", "explosives", "largebackpack", "smallbackpack", "healingtea.advanced", "maxhealthtea.advanced", "scraptea", "bearmeat.cooked", "chocolate", "can.beans", "water", "botabag", "trap.landmine", "guntrap", "flameturret", "autoturret", "wall.external.high.stone", "wall.external.high", "barricade.metal", "barricade.wood", "shutter.metal.embrasure.a", "wall.window.bars.metal", "floor.ladder.hatch"]);

const has = (s, size) => { try { return fs.statSync(path.join(P, "icons", String(size), s + ".png")).size > 0; } catch { return false; } };
const items = [];
let noIcon = 0;
for (const it of raw) {
  if (!has(it.s, 64) || !has(it.s, 256)) { noIcon++; continue; }
  const r = rost.get(it.s);
  const c = it.c === "Other" ? (r ? r.cat : "Misc") : it.c;
  const o = { s: it.s, id: it.id ?? (r ? r.id : null), n: it.n, c };
  if (jp[it.s]) o.j = jp[it.s];
  if (RAID.has(it.s)) o.r = 1;
  items.push(o);
}
items.sort((a, b) => (b.r || 0) - (a.r || 0) || a.n.localeCompare(b.n));
fs.writeFileSync(outP, JSON.stringify(items));
const cc = {}; for (const i of items) cc[i.c] = (cc[i.c] || 0) + 1;
console.log("items with icons:", items.length, " skipped(no icon):", noIcon, " jp:", items.filter((i) => i.j).length, " raid:", items.filter((i) => i.r).length);
console.log(cc);
const missingRaid = [...RAID].filter((s) => !items.some((i) => i.s === s));
console.log("RAID set missing:", missingRaid.join(" ") || "(none)");
const jpMissing = Object.keys(jp).filter((s) => !items.some((i) => i.s === s));
console.log("jp alias not matched:", jpMissing.join(" ") || "(none)");
