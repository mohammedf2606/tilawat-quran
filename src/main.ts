import "@fontsource/amiri/arabic-400.css";
import "@fontsource/amiri/arabic-700.css";
import "./style.css";
import { loadQuran, matchesQuery, type QuranData, type Surah } from "./quran";
import { Recognizer, type RecognizerEvent } from "./recognizer";

// ---------------------------------------------------------------------------
// Persisted settings
// ---------------------------------------------------------------------------
interface Settings {
  showTranslation: boolean;
  fontScale: number;
  lastRead: { surah: number; ayah: number } | null;
}

const SETTINGS_KEY = "tilawat.settings";
const settings: Settings = { showTranslation: true, fontScale: 1, lastRead: null };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"));
} catch {
  /* first run or storage unavailable */
}
function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arabicNumber = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);

const $app = document.getElementById("app")!;
const $status = document.getElementById("status")!;
const $mic = document.getElementById("mic") as HTMLButtonElement;

let quran: QuranData;

// ---------------------------------------------------------------------------
// Routing (hash-based so Android's back button walks history)
// ---------------------------------------------------------------------------
type Route = { name: "home" } | { name: "surah"; id: number; ayah?: number };

function parseRoute(): Route {
  const m = location.hash.match(/^#\/surah\/(\d+)(?:\/(\d+))?/);
  if (m) return { name: "surah", id: Number(m[1]), ayah: m[2] ? Number(m[2]) : undefined };
  return { name: "home" };
}

let route: Route = { name: "home" };

function render(): void {
  route = parseRoute();
  if (route.name === "surah") renderSurah(quran.surahs[route.id - 1], route.ayah);
  else renderHome();
}

// ---------------------------------------------------------------------------
// Home: continue card + searchable surah list
// ---------------------------------------------------------------------------
let searchQuery = "";

function renderHome(): void {
  const list = h("ul", { class: "surah-list" });
  const fill = () => {
    list.replaceChildren(
      ...quran.surahs
        .filter((s) => matchesQuery(s, searchQuery))
        .map((s) =>
          h(
            "li",
            {},
            h(
              "a",
              { href: `#/surah/${s.id}` },
              h("span", { class: "num" }, String(s.id)),
              h(
                "div",
                { class: "meta" },
                h("b", {}, s.transliteration),
                h("small", {}, `${s.translation} · ${s.type === "meccan" ? "Meccan" : "Medinan"} · ${s.totalVerses} ayat`),
              ),
              h("span", { class: "ar", lang: "ar" }, s.name),
            ),
          ),
        ),
    );
  };

  const search = h("input", {
    type: "search",
    placeholder: "Search surah by name or number",
    class: "search",
    value: searchQuery,
  });
  search.addEventListener("input", () => {
    searchQuery = search.value;
    fill();
  });

  const children: Node[] = [
    h("header", { class: "top" }, h("h1", {}, "Tilawat"), h("span", { class: "sub" }, "Offline Quran")),
  ];
  const last = settings.lastRead;
  if (last) {
    const s = quran.surahs[last.surah - 1];
    children.push(
      h(
        "a",
        { class: "continue", href: `#/surah/${last.surah}/${last.ayah}` },
        h("small", {}, "Continue reading"),
        h("b", {}, `${s.transliteration} · Ayah ${last.ayah}`),
      ),
    );
  }
  children.push(
    h("p", { class: "hint" }, "Tap the mic and start reciting. Tilawat finds where you are, fully offline."),
    search,
    list,
  );
  $app.replaceChildren(...children);
  fill();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------
let ayahObserver: IntersectionObserver | null = null;

function applyReaderPrefs(): void {
  document.documentElement.style.setProperty("--font-scale", String(settings.fontScale));
  document.body.classList.toggle("hide-translation", !settings.showTranslation);
}

function renderSurah(s: Surah, scrollToAyah?: number): void {
  const fontBtn = (label: string, delta: number) => {
    const b = h("button", { class: "icon", "aria-label": delta > 0 ? "Larger text" : "Smaller text" }, label);
    b.addEventListener("click", () => {
      settings.fontScale = Math.min(1.8, Math.max(0.7, +(settings.fontScale + delta).toFixed(2)));
      saveSettings();
      applyReaderPrefs();
    });
    return b;
  };
  const trBtn = h("button", { class: "icon", "aria-label": "Toggle translation" }, "EN");
  trBtn.addEventListener("click", () => {
    settings.showTranslation = !settings.showTranslation;
    saveSettings();
    applyReaderPrefs();
  });
  const back = h("a", { class: "icon", href: "#/", "aria-label": "All surahs" }, "‹");

  const header = h(
    "header",
    { class: "top reader-top" },
    back,
    h("div", { class: "title" }, h("b", {}, `${s.id}. ${s.transliteration}`), h("small", {}, s.translation)),
    fontBtn("A−", -0.1),
    fontBtn("A+", 0.1),
    trBtn,
  );

  const ayahs = s.ayahs.map((a) =>
    h(
      "article",
      { class: "ayah", id: `a-${a.surah}-${a.ayah}`, "data-ayah": String(a.ayah) },
      h(
        "p",
        { class: "ar", dir: "rtl", lang: "ar" },
        ...a.words.flatMap((w, i) => [h("span", { class: "w", "data-i": String(i) }, w), " "]),
        h("span", { class: "end" }, `۝${arabicNumber(a.ayah)}`),
      ),
      h("p", { class: "tr" }, h("span", { class: "n" }, `${a.surah}:${a.ayah}`), " ", a.translation),
    ),
  );

  const intro = h("div", { class: "surah-intro" }, h("div", { class: "ar surah-name", lang: "ar" }, s.name));
  // Al-Fatihah's basmala is its first ayah; At-Tawbah has none.
  if (s.id !== 1 && s.id !== 9) {
    intro.append(h("div", { class: "ar basmala", lang: "ar" }, "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ"));
  }

  $app.replaceChildren(header, intro, h("section", { class: "ayahs" }, ...ayahs));
  applyReaderPrefs();

  // Remember the topmost visible ayah as the reading position.
  ayahObserver?.disconnect();
  ayahObserver = new IntersectionObserver(
    (entries) => {
      const top = entries
        .filter((e) => e.isIntersecting)
        .sort((x, y) => x.boundingClientRect.top - y.boundingClientRect.top)[0];
      if (!top) return;
      settings.lastRead = { surah: s.id, ayah: Number((top.target as HTMLElement).dataset.ayah) };
      saveSettings();
    },
    { rootMargin: "-80px 0px -60% 0px" },
  );
  ayahs.forEach((el) => ayahObserver!.observe(el));

  if (scrollToAyah) {
    document.getElementById(`a-${s.id}-${scrollToAyah}`)?.scrollIntoView({ block: "center" });
  } else {
    window.scrollTo(0, 0);
  }
  if (recitePos?.surah === s.id) highlight(recitePos.surah, recitePos.ayah, recitePos.matched);
}

// ---------------------------------------------------------------------------
// Live recitation tracking
// ---------------------------------------------------------------------------
let recitePos: { surah: number; ayah: number; matched: number[] } | null = null;

function highlight(surah: number, ayah: number, matched: number[]): void {
  document.querySelectorAll(".ayah.current").forEach((el) => el.classList.remove("current"));
  const el = document.getElementById(`a-${surah}-${ayah}`);
  if (!el) return;
  el.classList.add("current");
  const set = new Set(matched);
  el.querySelectorAll<HTMLElement>(".w").forEach((w) => w.classList.toggle("heard", set.has(Number(w.dataset.i))));
}

function followRecitation(surah: number, ayah: number, matched: number[]): void {
  const moved = recitePos?.surah !== surah || recitePos?.ayah !== ayah;
  recitePos = { surah, ayah, matched };
  if (route.name !== "surah" || route.id !== surah) {
    location.hash = `#/surah/${surah}/${ayah}`;
    return; // render() will highlight
  }
  highlight(surah, ayah, matched);
  if (moved) document.getElementById(`a-${surah}-${ayah}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setStatus(text: string, kind: "idle" | "busy" | "live" | "error" = "idle"): void {
  $status.textContent = text;
  $status.dataset.kind = kind;
  $status.hidden = !text;
}

const recognizer = new Recognizer((e: RecognizerEvent) => {
  switch (e.type) {
    case "loading":
      setStatus(e.percent != null ? `${e.message} ${e.percent}%` : `${e.message}…`, "busy");
      break;
    case "ready":
      setStatus("Model ready", "idle");
      break;
    case "listening":
      $mic.classList.toggle("on", e.active);
      $mic.setAttribute("aria-pressed", String(e.active));
      setStatus(e.active ? "Listening… start reciting" : "", e.active ? "live" : "idle");
      break;
    case "level":
      $mic.style.setProperty("--level", String(Math.min(1, e.rms * 12)));
      break;
    case "verse_match": {
      const s = quran.surahs[e.surah - 1];
      setStatus(`${s.transliteration} ${e.surah}:${e.ayah}`, "live");
      followRecitation(e.surah, e.ayah, recitePos?.surah === e.surah && recitePos.ayah === e.ayah ? recitePos.matched : []);
      break;
    }
    case "word_progress":
      followRecitation(e.surah, e.ayah, e.matched_indices);
      break;
    case "error":
      setStatus(`Error: ${e.message}`, "error");
      break;
  }
});

$mic.addEventListener("click", async () => {
  $mic.disabled = true;
  try {
    if (recognizer.active) {
      await recognizer.stop();
    } else {
      recitePos = null;
      await recognizer.start();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(/denied|NotAllowed/i.test(msg) ? "Microphone permission is needed to recite" : `Error: ${msg}`, "error");
  } finally {
    $mic.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
setStatus("Loading Quran…", "busy");
loadQuran()
  .then((q) => {
    quran = q;
    setStatus("");
    window.addEventListener("hashchange", render);
    render();
  })
  .catch((err) => setStatus(`Failed to load Quran data: ${err.message}`, "error"));
