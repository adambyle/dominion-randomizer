// Wiki export snippet. Run in the browser console (or ask Claude to run it in the built-in browser)
// on https://wiki.dominionstrategy.com AFTER you have passed the site's bot check yourself.
// It reads page wikitext through the wiki's API (GET, 25 pages per request, ~1 request/second)
// and downloads dominion-wiki-export.json. Move it to data/raw/wiki-export.json, then `npm run data`.

(async () => {
  const api = async (params) => {
    const r = await fetch("/api.php?" + new URLSearchParams({ format: "json", formatversion: "2", ...params }));
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error("Non-JSON response (bot check again?): " + text.slice(0, 80)); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const categories = ["Cards", "Card types", "Rules", "Sets", "Kingdom sets", "Other mechanics", "Tokens", "Non-card types"];
  const extra = ["Removed cards", "Special cards", "Basic cards", "Kingdom", "Setup", "Landscape", "Split pile",
    "Shelters", "Ruins", "Spoils", "Loot", "Horse", "Edition", "Second edition"];
  const titles = new Set(extra);
  for (const cat of categories) {
    let cont = {};
    do {
      const j = await api({ action: "query", list: "categorymembers", cmtitle: "Category:" + cat, cmlimit: "500", ...cont });
      for (const m of j.query.categorymembers) if (!/^(Category|File|User):/.test(m.title)) titles.add(m.title);
      cont = j.continue ? { cmcontinue: j.continue.cmcontinue } : null;
      await sleep(500);
    } while (cont);
  }
  // Community-designed kingdoms are deliberately excluded.
  titles.delete("Recommended Kingdoms/Designed by Community");

  const list = [...titles];
  const pages = {};
  for (let i = 0; i < list.length; i += 25) {
    const j = await api({
      action: "query", prop: "revisions|categories", rvprop: "content|timestamp", rvslots: "main",
      cllimit: "max", clshow: "!hidden", redirects: "1", titles: list.slice(i, i + 25).join("|"),
    });
    const redirects = Object.fromEntries((j.query.redirects || []).map((x) => [x.to, x.from]));
    for (const p of j.query.pages) {
      if (p.missing || !p.revisions) continue;
      pages[p.title] = {
        title: p.title, redirectFrom: redirects[p.title] || null, timestamp: p.revisions[0].timestamp,
        categories: (p.categories || []).map((x) => x.title.replace(/^Category:/, "")),
        wikitext: p.revisions[0].slots.main.content,
      };
    }
    await sleep(1000);
  }

  const data = { source: "https://wiki.dominionstrategy.com", license: "CC BY-NC-SA 3.0", fetched: new Date().toISOString(), pages };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = "dominion-wiki-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log(`Exported ${Object.keys(pages).length} pages`);
})();
