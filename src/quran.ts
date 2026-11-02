// Offline Quran data. Arabic words come from the Tilawa phoneme corpus so the
// word indices in `word_progress` events line up exactly with what we render;
// surah metadata and the English translation come from quran_en.json.

export interface Ayah {
  surah: number;
  ayah: number;
  /** Words in the current script (see {@link applyScript}); indices match the corpus. */
  words: string[];
  /** The corpus (Tanzil Uthmani) words, shown with the Amiri font. */
  uthmani: string[];
  translation: string;
}

export interface Surah {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  totalVerses: number;
  ayahs: Ayah[];
}

interface RawEnSurah {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  total_verses: number;
  verses: { id: number; text: string; translation: string }[];
}

interface RawCorpus {
  surahs: { n: number; ayahs: { n: number; w: [string, string, string][] }[] }[];
}

export interface QuranData {
  surahs: Surah[];
  corpus: RawCorpus;
}

let cached: Promise<QuranData> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function loadQuran(): Promise<QuranData> {
  cached ??= (async () => {
    const [en, corpus] = await Promise.all([
      fetchJson<RawEnSurah[]>("/data/quran_en.json"),
      fetchJson<RawCorpus>("/models/zipformer_quran.json"),
    ]);
    const surahs = en.map((s): Surah => {
      const corpusAyahs = corpus.surahs[s.id - 1].ayahs;
      return {
        id: s.id,
        name: s.name,
        transliteration: s.transliteration,
        translation: s.translation,
        type: s.type,
        totalVerses: s.total_verses,
        ayahs: s.verses.map((v, i) => ({
          surah: s.id,
          ayah: v.id,
          // Fall back to the quran_en text if the corpus ever lacks an ayah.
          words: [],
          uthmani: corpusAyahs[i]?.w.map((w) => w[2]) ?? v.text.split(/\s+/),
          translation: v.translation,
        })),
      };
    });
    for (const s of surahs) for (const a of s.ayahs) a.words = a.uthmani;
    return { surahs, corpus };
  })();
  return cached;
}

/** amiri = corpus text in Amiri; hafs = KFGQPC Uthmanic Hafs; indopak = IndoPak Nastaleeq. */
export type Script = "amiri" | "hafs" | "indopak";
export const SCRIPTS: { id: Script; label: string }[] = [
  { id: "amiri", label: "Amiri" },
  { id: "hafs", label: "Uthmanic (Hafs)" },
  { id: "indopak", label: "IndoPak" },
];

const scriptCache = new Map<Script, Promise<string[][][]>>();

/**
 * Switch every ayah's `words` to the given script. The script files are word
 * lists aligned to the corpus (scripts/fetch-scripts.mjs), so word indices from
 * the recogniser still point at the right word.
 */
export async function applyScript(data: QuranData, script: Script): Promise<void> {
  if (script === "amiri") {
    for (const s of data.surahs) for (const a of s.ayahs) a.words = a.uthmani;
    return;
  }
  let p = scriptCache.get(script);
  if (!p) {
    p = fetchJson<string[][][]>(`/data/script_${script}.json`);
    scriptCache.set(script, p);
    p.catch(() => scriptCache.delete(script));
  }
  const words = await p;
  for (const s of data.surahs) {
    for (const a of s.ayahs) {
      const w = words[s.id - 1]?.[a.ayah - 1];
      a.words = w && w.length === a.uthmani.length ? w : a.uthmani;
    }
  }
}

/** The basmala as written in the given script (Al-Fatihah's first ayah). */
export function basmala(data: QuranData): string {
  return data.surahs[0].ayahs[0].words.join(" ");
}

const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;

/** Loose match for the surah search box: number, English, or Arabic name. */
export function matchesQuery(s: Surah, q: string): boolean {
  q = q.trim().toLowerCase();
  if (!q) return true;
  if (/^\d+$/.test(q)) return String(s.id).startsWith(q);
  const plain = (t: string) => t.toLowerCase().replace(/[^a-z؀-ۿ]/g, "").replace(DIACRITICS, "");
  const needle = plain(q);
  return [s.transliteration, s.translation, s.name].some((t) => plain(t).includes(needle));
}
