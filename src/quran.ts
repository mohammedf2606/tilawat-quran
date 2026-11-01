// Offline Quran data. Arabic words come from the Tilawa phoneme corpus so the
// word indices in `word_progress` events line up exactly with what we render;
// surah metadata and the English translation come from quran_en.json.

export interface Ayah {
  surah: number;
  ayah: number;
  words: string[];
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
          words: corpusAyahs[i]?.w.map((w) => w[2]) ?? v.text.split(/\s+/),
          translation: v.translation,
        })),
      };
    });
    return { surahs, corpus };
  })();
  return cached;
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
