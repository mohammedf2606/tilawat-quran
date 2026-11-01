import "@fontsource/amiri/arabic-400.css";
import "@fontsource/amiri/arabic-700.css";
import "./style.css";
import { loadQuran, matchesQuery, type QuranData, type Surah } from "./quran";
import { Recognizer, type RecognizerEvent } from "./recognizer";
import type { CorrectionAction, CorrectionIssue, CorrectionState } from "@tilawa/core";
import type { Passage, ReciteMode } from "./worker";

// ---------------------------------------------------------------------------
// Persisted settings
// ---------------------------------------------------------------------------
interface Settings {
  showTranslation: boolean;
  fontScale: number;
  lastRead: { surah: number; ayah: number } | null;
  mode: ReciteMode;
}

const SETTINGS_KEY = "tilawat.settings";
const settings: Settings = { showTranslation: true, fontScale: 1, lastRead: null, mode: "follow" };
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
const $mode = document.getElementById("mode") as HTMLButtonElement;
const $modes = document.getElementById("modes")!;
const $correction = document.getElementById("correction")!;
const $review = document.getElementById("review")!;

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
  paintIssues();
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
    case "issue":
      logIssue(e.issue);
      break;
    case "correction":
      onCorrection(e.state);
      break;
    case "stopped":
      if (settings.mode !== "follow") showReview();
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
      $correction.hidden = true;
      await recognizer.stop();
    } else {
      recitePos = null;
      issues.clear();
      paintIssues();
      $review.hidden = true;
      $modes.hidden = true;
      await recognizer.start(settings.mode, currentPassage());
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(/denied|NotAllowed/i.test(msg) ? "Microphone permission is needed to recite" : `Error: ${msg}`, "error");
  } finally {
    $mic.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Recite modes
// ---------------------------------------------------------------------------
const MODES: { id: ReciteMode; label: string; desc: string }[] = [
  { id: "follow", label: "Follow along", desc: "Find your place and highlight words as you recite." },
  { id: "live", label: "Live correction", desc: "Stop me at a possible mistake so I can retry the ayah." },
  { id: "review", label: "Review after", desc: "Recite uninterrupted, then list possible mistakes when I stop." },
];

function renderModeButton(): void {
  $mode.textContent = MODES.find((m) => m.id === settings.mode)!.label;
}

function openModes(): void {
  $modes.replaceChildren(
    h("h2", {}, "Recite mode"),
    ...MODES.map((m) => {
      const b = h(
        "button",
        { class: `mode-option${m.id === settings.mode ? " selected" : ""}`, "aria-pressed": String(m.id === settings.mode) },
        h("b", {}, m.label),
        h("small", {}, m.desc),
      );
      b.addEventListener("click", () => {
        settings.mode = m.id;
        saveSettings();
        renderModeButton();
        $modes.hidden = true;
      });
      return b;
    }),
  );
  $review.hidden = true;
  $modes.hidden = false;
}

$mode.addEventListener("click", () => {
  if (recognizer.active) return setStatus("Stop reciting to change mode", "idle");
  if ($modes.hidden) openModes();
  else $modes.hidden = true;
});

/** In the reader, correction modes lock onto the surah from the ayah on screen. */
function currentPassage(): Passage | null {
  if (route.name !== "surah") return null;
  const s = quran.surahs[route.id - 1];
  const onScreen = settings.lastRead?.surah === s.id ? settings.lastRead.ayah : 1;
  return { surah: s.id, ayah: Math.max(1, onScreen - 1), ayahEnd: s.totalVerses };
}

// ---------------------------------------------------------------------------
// Correction: issue log, live sheet, end-of-recitation review
// ---------------------------------------------------------------------------
type IssueStatus = "open" | "deferred" | "dismissed" | "corrected";
const issues = new Map<string, { issue: CorrectionIssue; status: IssueStatus }>();
const issueKey = (i: CorrectionIssue) => `${i.surah}:${i.ayah}:${i.word}:${i.kind}`;

const AYAH_LEVEL = new Set<CorrectionIssue["kind"]>(["possible_skipped_ayah", "unclear_ayah"]);
const ISSUE_TEXT: Record<CorrectionIssue["kind"], [title: string, desc: string]> = {
  possible_omission: ["Possible missed word", "A word here may have been left out."],
  possible_substitution: ["Possible wrong word", "A different word may have been recited here."],
  possible_vowel: ["Possible harakah mistake", "A short vowel on this word may have been changed."],
  possible_repetition: ["Repeated word", "This word sounded like it was said twice."],
  possible_skipped_ayah: ["Ayah may have been skipped", "Almost nothing of this ayah was heard."],
  unclear_ayah: ["Couldn't follow this ayah", "Audio was heard, but it couldn't be matched to this ayah."],
};

function logIssue(issue: CorrectionIssue): void {
  const key = issueKey(issue);
  if (!issues.has(key)) issues.set(key, { issue, status: settings.mode === "live" ? "open" : "deferred" });
  paintIssues();
}

function flaggedWords(i: CorrectionIssue): Set<number> {
  return new Set(Array.from({ length: i.words ?? 1 }, (_, k) => i.word + k));
}

/** Mark unresolved issues in the reader: red words, or a red edge for ayah-level ones. */
function paintIssues(): void {
  document.querySelectorAll(".w.flag").forEach((el) => el.classList.remove("flag"));
  document.querySelectorAll(".ayah.flag-ayah").forEach((el) => el.classList.remove("flag-ayah"));
  for (const { issue, status } of issues.values()) {
    if (status === "dismissed" || status === "corrected") continue;
    const el = document.getElementById(`a-${issue.surah}-${issue.ayah}`);
    if (!el) continue;
    if (AYAH_LEVEL.has(issue.kind)) el.classList.add("flag-ayah");
    const words = flaggedWords(issue);
    el.querySelectorAll<HTMLElement>(".w").forEach((w) => {
      if (words.has(Number(w.dataset.i))) w.classList.add("flag");
    });
  }
}

function quoteAyah(i: CorrectionIssue): HTMLElement {
  const words = flaggedWords(i);
  const ayah = quran.surahs[i.surah - 1].ayahs[i.ayah - 1];
  return h(
    "p",
    { class: "ar quote", dir: "rtl", lang: "ar" },
    ...ayah.words.flatMap((w, k) => [h("span", { class: words.has(k) ? "flag" : "" }, w), " "]),
  );
}

function onCorrection(state: CorrectionState): void {
  const entry = state.issue && issues.get(issueKey(state.issue));
  if (entry && state.outcome) {
    entry.status = state.outcome === "dismissed" ? "dismissed" : state.outcome === "corrected" ? "corrected" : "deferred";
  }
  if (entry && state.phase === "corrected") entry.status = "corrected";
  paintIssues();

  if (state.phase === "idle" || !state.issue) {
    $correction.hidden = true;
    if (recognizer.active) setStatus("Listening… carry on reciting", "live");
    return;
  }

  const i = state.issue;
  const s = quran.surahs[i.surah - 1];
  if (route.name !== "surah" || route.id !== i.surah) location.hash = `#/surah/${i.surah}/${i.ayah}`;
  else document.getElementById(`a-${i.surah}-${i.ayah}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const [title, desc] = ISSUE_TEXT[i.kind];
  const button = (label: string, action: CorrectionAction, primary = false) => {
    const b = h("button", { class: primary ? "primary" : "" }, label);
    b.addEventListener("click", () => recognizer.act(action));
    return b;
  };
  let heading = title;
  let body = desc;
  let actions: HTMLElement[];
  if (state.phase === "retrying") {
    heading = "Take your time";
    body = `Recite ayah ${i.ayah} again from its beginning.`;
    actions = [button("Stop retry", "stop_retry", true), button("Review later", "review_later")];
    setStatus("Listening for your retry…", "live");
  } else if (state.phase === "corrected") {
    heading = "That sounded right";
    body = "Carry on from where you left off.";
    actions = [button("Continue reciting", "continue", true), button("Practise once more", "retry")];
  } else {
    actions = [
      button("Retry ayah", "retry", true),
      button("I recited it correctly", "dismiss"),
      button("Review later", "review_later"),
    ];
    setStatus("Paused at a possible mistake", "error");
  }
  $correction.dataset.phase = state.phase;
  $correction.replaceChildren(
    h("small", { class: "ref" }, `${s.transliteration} ${i.surah}:${i.ayah}`),
    h("h2", {}, heading),
    h("p", { class: "desc" }, body),
    quoteAyah(i),
    h("div", { class: "actions" }, ...actions),
  );
  $correction.hidden = false;
}

function showReview(): void {
  const open = [...issues.values()]
    .filter((e) => e.status === "open" || e.status === "deferred")
    .sort((a, b) => a.issue.surah - b.issue.surah || a.issue.ayah - b.issue.ayah || a.issue.word - b.issue.word);
  const close = h("button", { class: "icon", "aria-label": "Close review" }, "✕");
  close.addEventListener("click", () => ($review.hidden = true));
  const header = h("header", {}, h("h2", {}, "Recitation review"), close);

  if (!open.length) {
    $review.replaceChildren(
      header,
      h("p", { class: "desc" }, "No possible mistakes found."),
      h("p", { class: "fine" }, "Tilawat only flags clear cases, so it can miss some mistakes."),
    );
  } else {
    $review.replaceChildren(
      header,
      h("p", { class: "desc" }, `${open.length} possible mistake${open.length > 1 ? "s" : ""}. Tap one to see it.`),
      h(
        "ul",
        { class: "issues" },
        ...open.map(({ issue }) => {
          const a = h(
            "a",
            { href: `#/surah/${issue.surah}/${issue.ayah}` },
            h("small", { class: "ref" }, `${quran.surahs[issue.surah - 1].transliteration} ${issue.surah}:${issue.ayah}`),
            h("b", {}, ISSUE_TEXT[issue.kind][0]),
            quoteAyah(issue),
          );
          a.addEventListener("click", () => ($review.hidden = true));
          return h("li", {}, a);
        }),
      ),
      h("p", { class: "fine" }, "These are possible mistakes, not certainties."),
    );
  }
  setStatus("");
  $review.hidden = false;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
setStatus("Loading Quran…", "busy");
loadQuran()
  .then((q) => {
    quran = q;
    setStatus("");
    window.addEventListener("hashchange", render);
    renderModeButton();
    render();
  })
  .catch((err) => setStatus(`Failed to load Quran data: ${err.message}`, "error"));
