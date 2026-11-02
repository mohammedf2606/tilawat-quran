// Builds the alternative Quran scripts (QPC Hafs, IndoPak) as word lists aligned
// to the Tilawa corpus, so word highlighting works the same in every script.
// Usage: node scripts/fetch-scripts.mjs   (needs public/models/zipformer_quran.json)
import { readFile, writeFile, mkdir } from "node:fs/promises";

const API = "https://api.quran.com/api/v4/verses/by_chapter";
const FIELDS = { hafs: "text_qpc_hafs", indopak: "text_indopak" };

const LETTER = /[ء-يٮ-ۓ]/;
/** "a b" → ["a", "b"] when both halves hold letters (not a stray space before a waqf mark). */
const splitPair = (w) => {
  const parts = w.trim().split(/\s+/);
  return parts.length === 2 && parts.every((p) => LETTER.test(p)) ? parts : [w];
};

const corpus = JSON.parse(await readFile("public/models/zipformer_quran.json", "utf8"));
const out = { hafs: [], indopak: [] };
const mismatches = [];

for (let surah = 1; surah <= 114; surah++) {
  const url = `${API}/${surah}?words=true&word_fields=${Object.values(FIELDS).join(",")}&per_page=300`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const { verses } = await res.json();
  const corpusAyahs = corpus.surahs[surah - 1].ayahs;
  if (verses.length !== corpusAyahs.length) throw new Error(`surah ${surah}: ${verses.length} ayahs vs ${corpusAyahs.length}`);
  for (const key of Object.keys(FIELDS)) out[key].push([]);
  verses.forEach((v, i) => {
    const words = v.words.filter((w) => w.char_type_name === "word");
    const expected = corpusAyahs[i].w.length;
    for (const [key, field] of Object.entries(FIELDS)) {
      let list = words.map((w) => w[field]);
      // Quran.com keeps a few pairs as one word (بَعۡدَ مَا, إِلۡ يَاسِينَ); the corpus splits them.
      if (list.length !== expected) list = list.flatMap(splitPair);
      if (list.length !== expected) mismatches.push(`${key} ${v.verse_key}: ${list.length} vs ${expected}`);
      out[key][surah - 1].push(list);
    }
  });
  process.stdout.write(`\r${surah}/114`);
}
console.log();

await mkdir("public/data", { recursive: true });
for (const key of Object.keys(FIELDS)) {
  await writeFile(`public/data/script_${key}.json`, JSON.stringify(out[key]));
}
console.log(mismatches.length ? `Word-count mismatches:\n${mismatches.join("\n")}` : "All ayahs align with the corpus");
