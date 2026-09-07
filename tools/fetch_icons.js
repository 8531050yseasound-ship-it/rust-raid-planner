// Facepunch 公式CDN (files.facepunch.com/rust/item/{shortname}_{64|256}.png) からアイコンを並列取得
// usage: node fetch_icons.js <items_raw.json>   既存ファイルはスキップ。結果を fetch_result.json に保存
const fs = require("fs");
const path = require("path");
const P = path.resolve(__dirname, "..");
const items = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const SIZES = [64, 256];
const CONC = 6;
const UA = "rust-raid-planner icon fetch (contact: site owner)";
const jobs = [];
for (const it of items) for (const s of SIZES) jobs.push({ s: it.s, size: s });
const result = { ok: [], miss: [] };
let idx = 0, done = 0;
async function worker() {
  while (idx < jobs.length) {
    const j = jobs[idx++];
    const dst = path.join(P, "icons", String(j.size), j.s + ".png");
    if (fs.existsSync(dst) && fs.statSync(dst).size > 0) { result.ok.push(j); done++; continue; }
    const url = `https://files.facepunch.com/rust/item/${j.s}_${j.size}.png`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok && (res.headers.get("content-type") || "").startsWith("image/png")) {
        fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
        result.ok.push(j);
      } else result.miss.push(j);
    } catch (e) { result.miss.push({ ...j, err: String(e) }); }
    done++;
    if (done % 100 === 0) console.log(`${done}/${jobs.length}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}
(async () => {
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(path.join(__dirname, "fetch_result.json"), JSON.stringify(result, null, 1));
  const miss256 = result.miss.filter((m) => m.size === 256).map((m) => m.s);
  console.log(`done: ok=${result.ok.length} miss=${result.miss.length} (256px missing: ${miss256.length})`);
  console.log(miss256.join(" "));
})();
