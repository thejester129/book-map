// Fetches the best-known books from each country from Wikidata and writes
// src/popular-books.json, which build.js inlines into the page.
// Usage: node scripts/fetch-popular.js   (takes a few minutes; re-run to refresh)
//
// A book's popularity is the number of Wikipedia language editions with an article on it.
// Each author is placed with the same scoring the page uses for your own books
// (pickCountry and descCountries are read straight out of the template).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WD = "https://query.wikidata.org/sparql";
const UA = "BookMap/1.0 (popular books data script)";
const MIN_LINKS = 5;       // books covered by fewer Wikipedias than this are skipped
const PER_COUNTRY = 20;    // the page shows 10, after dropping any you've read
const PER_AUTHOR = 2;      // so one prolific author doesn't fill a country's list
// Kinds of work to include: literary work, book, written work, novel.
const CLASSES = ["Q7725634", "Q571", "Q47461344", "Q8261"];
const MAX_AUTHORS = 3;     // skips anthologies and collective works
// Works whose type or genre mentions any of these aren't "books to read".
const SKIP_KINDS = /encyclop|dictionar|lexicon|religious|scripture|sacred|holy book|manifesto|inscription|edict|legal|law\b|constitution|treaty|charter|atlas|textbook|catalog|periodical|magazine|newspaper|report|standard|manual|\bmap\b|propaganda|polemic|hoax|forgery|antisemit|epigraph|creed|sutra|hindu text|buddhist text|theolog|hymn|liturg|prayer/i;

// ---- reuse the page's country matching and scoring ----
const tpl = fs.readFileSync(path.join(ROOT, "src/index.template.html"), "utf8");
const grab = re => { const m = tpl.match(re); if (!m) throw new Error("Couldn't find " + re + " in the template"); return m[0]; };
const topo = JSON.parse(fs.readFileSync(path.join(ROOT, "src/countries-topo.json"), "utf8"));
const NAMES = [...new Set(topo.objects.countries.geometries.map(g => g.properties.name).filter(Boolean))];
const shared = new Function("NAMES", [
  "const NAMESET = new Set(NAMES); const LOWER = new Map(NAMES.map(n => [n.toLowerCase(), n]));",
  grab(/const ALIAS = \{[\s\S]*?\n\};/),
  grab(/function matchCountry\(s\)\{[\s\S]*?\n\}/),
  grab(/const DEMONYM_EXTRA = \{[\s\S]*?\};/),
  grab(/const MULTINATIONAL = .*;/),
  grab(/function placeCountry\(label\)\{.*\}/),
  grab(/function descCountries\(desc, demonyms\)\{[\s\S]*?\n\}/),
  grab(/function pickCountry\(p\)\{[\s\S]*?\n\}/),
  "return { matchCountry, placeCountry, DEMONYM_EXTRA, descCountries, pickCountry };"
].join("\n"))(NAMES);
const { matchCountry, placeCountry, DEMONYM_EXTRA, descCountries, pickCountry } = shared;

// ---- Wikidata helpers ----
async function sparql(query, tries = 4){
  for (let i = 1; ; i++){
    const res = await fetch(WD, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/sparql-results+json", "User-Agent": UA },
      body: "query=" + encodeURIComponent(query)
    });
    const text = await res.text();
    // A query that runs out of time can return 200 with the JSON cut off part way.
    if (res.ok){ try { return JSON.parse(text).results.bindings; } catch(e){} }
    if (i >= tries || res.status === 400) throw new Error(`Wikidata ${res.status}: ${text.slice(0, 200)}`);
    console.log(`  Wikidata ${res.ok ? "timed out" : res.status}, retrying…`);
    await new Promise(r => setTimeout(r, 5000 * i));
  }
}
const qid = uri => uri.replace("http://www.wikidata.org/entity/", "");
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

async function main(){
  // 1. Well-known books and their authors.
  const books = new Map(); // qid -> { links, authors:Set }
  for (const cls of CLASSES){
    console.log(`Fetching works of type ${cls}…`);
    const rows = await sparql(`SELECT ?book ?l ?a WHERE {
  ?book wdt:P31 wd:${cls} ; wikibase:sitelinks ?l . FILTER(?l >= ${MIN_LINKS})
  ?book wdt:P50 ?a .
}`);
    for (const r of rows){
      const id = qid(r.book.value), a = qid(r.a.value);
      if (!/^Q\d+$/.test(a)) continue; // "unknown author"
      if (!books.has(id)) books.set(id, { links: +r.l.value, authors: new Set() });
      books.get(id).authors.add(a);
    }
  }
  console.log(`${books.size} books`);

  // 2. Nationality words.
  const demonyms = new Map(Object.entries(DEMONYM_EXTRA).map(([d, c]) => [d, new Set([c])]));
  for (const r of await sparql(`SELECT ?cLabel ?dem WHERE {
  { ?c wdt:P31 wd:Q6256 } UNION { ?c wdt:P31 wd:Q3624078 }
  ?c wdt:P1549 ?dem FILTER(LANG(?dem) = "en")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?c rdfs:label ?cLabel }
}`)){
    const c = matchCountry(r.cLabel.value), d = r.dem.value.toLowerCase();
    if (!c || d === r.cLabel.value.toLowerCase()) continue;
    if (!demonyms.has(d)) demonyms.set(d, new Set());
    demonyms.get(d).add(c);
  }

  // 3. Each author's country, scored like the page does.
  const authorIds = [...new Set([...books.values()].flatMap(b => [...b.authors]))];
  const authors = new Map(); // qid -> { name, country }
  const batches = chunks(authorIds, 150);
  for (const [i, batch] of batches.entries()){
    process.stdout.write(`\x1b[2K\rPlacing authors: batch ${i + 1} of ${batches.length}`);
    const rows = await sparql(`SELECT ?a ?name ?desc ?citLabel ?ended ?bcLabel ?dcLabel ?wlLabel WHERE {
  VALUES ?a { ${batch.map(id => "wd:" + id).join(" ")} }
  OPTIONAL { ?a rdfs:label ?name FILTER(LANG(?name) = "en") }
  OPTIONAL { ?a schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?a p:P27 ?cs . ?cs ps:P27 ?cit . BIND(EXISTS { ?cs pq:P582 ?e } AS ?ended) }
  OPTIONAL { ?a wdt:P19/wdt:P17 ?bc }
  OPTIONAL { ?a wdt:P20/wdt:P17 ?dc }
  OPTIONAL { ?a wdt:P937/wdt:P17 ?wl }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);
    const people = new Map();
    for (const r of rows){
      const id = qid(r.a.value);
      if (!people.has(id)) people.set(id, { name: "", desc: "", from: new Set(), now: new Set(), old: new Set(), born: new Set(), died: new Set(), worked: new Set() });
      const p = people.get(id);
      if (r.name) p.name = r.name.value;
      if (r.desc) p.desc = r.desc.value;
      const cit = placeCountry(r.citLabel?.value);
      if (cit) (r.ended?.value === "true" ? p.old : p.now).add(cit);
      for (const [k, set] of [["bcLabel", p.born], ["dcLabel", p.died], ["wlLabel", p.worked]]){
        const x = placeCountry(r[k]?.value); if (x) set.add(x);
      }
    }
    for (const [id, p] of people){
      p.from = descCountries(p.desc, demonyms);
      const country = pickCountry(p);
      if (p.name && country) authors.set(id, { name: p.name, country });
    }
  }
  console.log(`\n${authors.size} authors placed`);

  // 4. English titles and publication years.
  const meta = new Map();
  const bookBatches = chunks([...books.keys()], 300);
  for (const [i, batch] of bookBatches.entries()){
    process.stdout.write(`\x1b[2K\rFetching titles: batch ${i + 1} of ${bookBatches.length}`);
    const rows = await sparql(`SELECT ?b ?t (MIN(YEAR(?d)) AS ?y) (GROUP_CONCAT(DISTINCT ?kl; separator="; ") AS ?kinds) WHERE {
  VALUES ?b { ${batch.map(id => "wd:" + id).join(" ")} }
  ?b rdfs:label ?t FILTER(LANG(?t) = "en")
  OPTIONAL { ?b wdt:P577 ?d }
  OPTIONAL { ?b wdt:P31|wdt:P136 ?k . ?k rdfs:label ?kl FILTER(LANG(?kl) = "en") }
} GROUP BY ?b ?t`);
    for (const r of rows){
      if (SKIP_KINDS.test(r.kinds?.value || "")) continue;
      meta.set(qid(r.b.value), { title: r.t.value, year: r.y ? +r.y.value : null });
    }
  }
  console.log("");

  // 5. Top books per country.
  const byCountry = {};
  const ranked = [...books.entries()].sort((x, y) => y[1].links - x[1].links);
  const perAuthor = new Map();
  for (const [id, b] of ranked){
    const m = meta.get(id); if (!m) continue;
    if (b.authors.size > MAX_AUTHORS) continue;
    const placed = [...b.authors].map(a => [a, authors.get(a)]).filter(([, a]) => a);
    if (!placed.length) continue;
    // File the book under the country most of its authors share.
    const tally = new Map();
    for (const [, a] of placed) tally.set(a.country, (tally.get(a.country) || 0) + 1);
    const country = [...tally].sort((x, y) => y[1] - x[1])[0][0];
    const list = byCountry[country] ||= [];
    if (list.length >= PER_COUNTRY) continue;
    const lead = placed.find(([, a]) => a.country === country)[0];
    if ((perAuthor.get(lead) || 0) >= PER_AUTHOR) continue;
    perAuthor.set(lead, (perAuthor.get(lead) || 0) + 1);
    list.push([m.title, placed.map(([, a]) => a.name).join(", "), m.year]);
  }
  const sorted = Object.fromEntries(Object.keys(byCountry).sort().map(k => [k, byCountry[k]]));
  fs.writeFileSync(path.join(ROOT, "src/popular-books.json"), JSON.stringify(sorted));
  console.log(`Wrote src/popular-books.json: ${Object.keys(sorted).length} countries`);
}

main().catch(e => { console.error(e); process.exit(1); });
