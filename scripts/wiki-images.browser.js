// Image URL lookup. Run in a wiki.dominionstrategy.com tab after passing the bot check yourself
// (same as wiki-export.browser.js). Resolves every card's image and art file through the API
// (file names are often redirects) plus box art, set icons, symbols and tokens, then downloads
// dominion-wiki-images.json. Move it to data/raw/wiki-images.json and run `npm run images`.

(async () => {
  const api = async (p) => {
    const r = await fetch("/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...p }));
    const t = await r.text();
    try { return JSON.parse(t); } catch { throw new Error("Non-JSON response (bot check again?): " + t.slice(0, 80)); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cards = await (await fetch("https://raw.githubusercontent.com/adambyle/dominion-randomizer/master/src/data/cards.json")).json();

  const titles = new Set();
  for (const c of cards.cards) {
    if (c.wikiTitle === "Split pile") continue;
    titles.add("File:" + (c.image || c.wikiTitle + ".jpg"));
    if (["kingdom", "pileMember", "nonSupply", "basic"].includes(c.kind)) titles.add("File:" + c.wikiTitle + "Art.jpg");
  }

  const files = {};
  const list = [...titles];
  for (let i = 0; i < list.length; i += 50) {
    const j = await api({ action: "query", prop: "imageinfo", iiprop: "url|size", iiurlwidth: "320", redirects: "1", titles: list.slice(i, i + 50).join("|") });
    const back = Object.fromEntries((j.query.redirects || []).map((r) => [r.to, r.from]));
    const norm = Object.fromEntries((j.query.normalized || []).map((n) => [n.to, n.from]));
    for (const p of j.query.pages) {
      if (!p.imageinfo) continue;
      const from = back[p.title] ? (norm[back[p.title]] || back[p.title]) : (norm[p.title] || p.title);
      const info = p.imageinfo[0];
      files[from] = { file: p.title, url: info.url, thumb: info.thumburl, w: info.width, h: info.height };
    }
    await sleep(900);
  }

  const categories = {};
  for (const cat of ["Box images", "Card symbols", "Box art", "Tokens"]) {
    const out = [];
    let cont = {};
    do {
      const j = await api({ action: "query", generator: "categorymembers", gcmtitle: "Category:" + cat, gcmnamespace: "6", gcmlimit: "50", prop: "imageinfo", iiprop: "url|size", iiurlwidth: "320", ...cont });
      for (const p of j.query?.pages || []) if (p.imageinfo) out.push({ file: p.title, url: p.imageinfo[0].url, thumb: p.imageinfo[0].thumburl, w: p.imageinfo[0].width, h: p.imageinfo[0].height });
      cont = j.continue ? { gcmcontinue: j.continue.gcmcontinue } : null;
      await sleep(900);
    } while (cont);
    categories[cat] = out;
  }
  // Box covers that aren't in the category (2nd editions, newer sets).
  const prefix = [];
  for (const p of ["Rising Sun", "Hinterlands", "Cornucopia", "Intrigue", "Seaside", "Prosperity", "Dominion", "Sun"]) {
    const j = await api({ action: "query", list: "allimages", aiprefix: p, ailimit: "100", aiprop: "url|size" });
    prefix.push(...j.query.allimages.map((x) => ({ file: "File:" + x.name.replace(/_/g, " "), url: x.url, w: x.width, h: x.height })));
    await sleep(900);
  }
  categories.prefix = prefix;

  const data = { source: "https://wiki.dominionstrategy.com", fetched: new Date().toISOString(), files, categories };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = "dominion-wiki-images.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Resolved ${Object.keys(files).length} of ${list.length} card images`);
})();
