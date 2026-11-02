import "@fontsource/amiri/arabic-400.css";
import "@fontsource/amiri/arabic-700.css";
import "./style.css";
import { applyScript, basmala, loadQuran, matchesQuery, SCRIPTS, type QuranData, type Script, type Surah } from "./quran";
import { Recognizer, type RecognizerEvent } from "./recognizer";
import type { CorrectionAction, CorrectionIssue, CorrectionState } from "@tilawa/core";
import type { Passage, ReciteMode } from "./worker";
import * as progress from "./progress";
import * as plans from "./plans";
import * as reminders from "./reminders";
import { Waveform } from "./waveform";

// ---------------------------------------------------------------------------
// Persisted settings
// ---------------------------------------------------------------------------
interface Settings {
  showTranslation: boolean;
  fontScale: number;
  lastRead: { surah: number; ayah: number } | null;
  mode: ReciteMode;
  script: Script;
  reminder: reminders.ReminderSettings;
}

const SETTINGS_KEY = "tilawat.settings";
const settings: Settings = {
  showTranslation: true,
  fontScale: 1,
  lastRead: null,
  mode: "follow",
  script: "amiri",
  reminder: { enabled: false, time: "20:00" },
};
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
const $blind = document.getElementById("blind")!;
const $wave = document.getElementById("wave")!;
const waveform = new Waveform($wave.querySelector("canvas")!, (level) =>
  $mic.style.setProperty("--level", level.toFixed(3)),
);

let quran: QuranData;

// ---------------------------------------------------------------------------
// Routing (hash-based so Android's back button walks history)
// ---------------------------------------------------------------------------
type Route =
  | { name: "home" }
  | { name: "surah"; id: number; ayah?: number }
  | { name: "plans" }
  | { name: "plan-new" }
  | { name: "plan"; id: string };

function parseRoute(): Route {
  const m = location.hash.match(/^#\/surah\/(\d+)(?:\/(\d+))?/);
  if (m) return { name: "surah", id: Number(m[1]), ayah: m[2] ? Number(m[2]) : undefined };
  if (location.hash === "#/plans") return { name: "plans" };
  if (location.hash === "#/plans/new") return { name: "plan-new" };
  const p = location.hash.match(/^#\/plans\/([\w-]+)/);
  if (p) return { name: "plan", id: p[1] };
  return { name: "home" };
}

let route: Route = { name: "home" };

function render(): void {
  route = parseRoute();
  if (route.name === "surah") renderSurah(quran.surahs[route.id - 1], route.ayah);
  else if (route.name === "plans") renderPlans();
  else if (route.name === "plan-new") renderPlanNew();
  else if (route.name === "plan") renderPlan(route.id);
  else renderHome();
}

// ---------------------------------------------------------------------------
// Home: continue card + searchable surah list
// ---------------------------------------------------------------------------
let searchQuery = "";

function surahMeta(s: Surah): HTMLElement {
  const p = progress.surahProgress(s.id);
  const meta = h(
    "div",
    { class: "meta" },
    h("b", {}, s.transliteration),
    h("small", {}, `${s.translation} · ${s.type === "meccan" ? "Meccan" : "Medinan"} · ${s.totalVerses} ayat`),
  );
  if (p.recited) {
    const pct = Math.round((p.recited / s.totalVerses) * 100);
    meta.append(
      h("small", { class: "progress-line" }, `${p.recited}/${s.totalVerses} recited · ${progress.relativeTime(p.lastRecitedAt!)}`),
      progressBar(pct),
    );
  } else if (p.lastView) {
    meta.append(h("small", { class: "progress-line" }, `Viewed ${progress.relativeTime(p.lastView.at)} · ayah ${p.lastView.ayah}`));
  }
  return meta;
}

function progressBar(pct: number): HTMLElement {
  const bar = h("div", { class: "bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" });
  bar.style.setProperty("--pct", `${pct}%`);
  return bar;
}

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
              surahMeta(s),
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
    tabs("home"),
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
// Study plans: tab, builder, schedule
// ---------------------------------------------------------------------------
function tabs(active: "home" | "plans"): HTMLElement {
  const tab = (id: "home" | "plans", href: string, label: string) =>
    h("a", { href, class: `tab${id === active ? " active" : ""}`, ...(id === active ? { "aria-current": "page" } : {}) }, label);
  return h("nav", { class: "tabs" }, tab("home", "#/", "Surahs"), tab("plans", "#/plans", "Study plans"));
}

const surahName = (n: number) => quran.surahs[n - 1].transliteration;

function formatRange(from: plans.AyahRef, to: plans.AyahRef): string {
  const whole = (r: plans.AyahRef, end: boolean) => (end ? r.ayah === quran.surahs[r.surah - 1].totalVerses : r.ayah === 1);
  if (from.surah === to.surah) {
    if (whole(from, false) && whole(to, true)) return surahName(from.surah);
    return `${surahName(from.surah)} ${from.ayah}–${to.ayah}`;
  }
  const a = whole(from, false) ? surahName(from.surah) : `${surahName(from.surah)} ${from.ayah}`;
  const b = whole(to, true) ? surahName(to.surah) : `${surahName(to.surah)} ${to.ayah}`;
  return `${a} – ${b}`;
}

const formatDate = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const GOAL_VERB: Record<plans.PlanGoal, string> = { read: "Read", memorise: "Memorise" };

/** Days done: ticked by hand, or every ayah recited since the plan started. */
function planStatus(plan: plans.Plan) {
  const portions = plans.schedule(quran, plan);
  const recited = progress.recitedSince(plans.parseDate(plan.start).getTime());
  const manual = new Set(plan.done);
  const done = portions.map((p) => {
    const keys = plans.portionKeys(quran, p);
    const heard = keys.filter((k) => recited.has(k)).length;
    return { manual: manual.has(p.day), heard, complete: manual.has(p.day) || heard === keys.length };
  });
  return { portions, done, count: done.filter((d) => d.complete).length };
}

function renderPlans(): void {
  const list = plans.allPlans().map((plan) => {
    const { portions, done, count } = planStatus(plan);
    const t = plans.todayIndex(plan);
    const pct = Math.round((count / portions.length) * 100);
    const card = h(
      "a",
      { class: "plan-card", href: `#/plans/${plan.id}` },
      h("b", {}, plan.name),
      h("small", {}, `${GOAL_VERB[plan.goal]} · ${formatRange(plan.from, plan.to)} · ${portions.length} days`),
      progressBar(pct),
    );
    let next: string;
    if (count === portions.length) next = "Complete, alhamdulillah";
    else if (t < 0) next = `Starts ${formatDate(plans.parseDate(plan.start))}`;
    else {
      const behind = done.slice(0, Math.min(t, portions.length)).filter((d) => !d.complete).length;
      const today = portions[Math.min(t, portions.length - 1)];
      next = t < portions.length ? `Today: ${formatRange(today.from, today.to)}` : "Schedule finished";
      if (behind) next += ` · ${behind} day${behind > 1 ? "s" : ""} behind`;
    }
    card.append(h("small", { class: "progress-line" }, `${count}/${portions.length} done · ${next}`));
    return card;
  });

  const presets = h(
    "div",
    { class: "presets" },
    ...PRESETS.map((p) => {
      const b = h("button", { class: "preset" }, h("b", {}, p.label), h("small", {}, p.desc));
      b.addEventListener("click", () => {
        draft = { ...newDraft(), ...p.draft };
        location.hash = "#/plans/new";
      });
      return b;
    }),
  );

  const add = h("a", { class: "button primary", href: "#/plans/new" }, "Custom plan");
  add.addEventListener("click", () => (draft = newDraft()));

  $app.replaceChildren(
    h("header", { class: "top" }, h("h1", {}, "Tilawat"), h("span", { class: "sub" }, "Offline Quran")),
    tabs("plans"),
    h("h2", { class: "section" }, "Daily recitation"),
    renderTracker(),
    ...(list.length ? [h("h2", { class: "section" }, "Your plans"), h("div", { class: "plan-list" }, ...list)] : []),
    h("h2", { class: "section" }, "Start a plan"),
    presets,
    add,
  );
  window.scrollTo(0, 0);
}

// Builder ------------------------------------------------------------------
type Unit = "days" | "weeks" | "months" | "years";
interface Draft {
  goal: plans.PlanGoal;
  rangeBy: "juz" | "surah";
  juzFrom: number;
  juzTo: number;
  from: plans.AyahRef;
  to: plans.AyahRef;
  paceBy: "duration" | "ayahs";
  n: number;
  unit: Unit;
  perDay: number;
  start: string;
  name: string;
}

function newDraft(): Draft {
  return {
    goal: "read",
    rangeBy: "juz",
    juzFrom: 1,
    juzTo: 30,
    from: { surah: 1, ayah: 1 },
    to: { surah: 114, ayah: 6 },
    paceBy: "duration",
    n: 30,
    unit: "days",
    perDay: 5,
    start: plans.toYmd(new Date()),
    name: "",
  };
}
let draft: Draft = newDraft();

const PRESETS: { label: string; desc: string; draft: Partial<Draft> }[] = [
  { label: "Qur'an in a month", desc: "One juz a day", draft: { goal: "read", n: 30, unit: "days" } },
  { label: "Qur'an in a year", desc: "An even amount of reading each day", draft: { goal: "read", n: 1, unit: "years" } },
  {
    label: "Memorise Juz 'Amma",
    desc: "5 new ayat a day",
    draft: { goal: "memorise", juzFrom: 30, juzTo: 30, paceBy: "ayahs", perDay: 5 },
  },
];

function draftRange(d: Draft): { from: plans.AyahRef; to: plans.AyahRef } {
  if (d.rangeBy === "juz") return plans.juzRange(quran, Math.min(d.juzFrom, d.juzTo), Math.max(d.juzFrom, d.juzTo));
  const clamp = (r: plans.AyahRef) => ({ surah: r.surah, ayah: Math.min(Math.max(1, r.ayah || 1), quran.surahs[r.surah - 1].totalVerses) });
  return { from: clamp(d.from), to: clamp(d.to) };
}

function draftPlan(d: Draft) {
  const { from, to } = draftRange(d);
  const start = d.start || plans.toYmd(new Date());
  const pace: plans.Pace =
    d.paceBy === "ayahs"
      ? { kind: "ayahs", perDay: Math.max(1, d.perDay || 1) }
      : { kind: "days", days: Math.max(1, plans.durationDays(plans.parseDate(start), Math.max(1, d.n || 1), d.unit)) };
  return { goal: d.goal, from, to, pace, start };
}

function segmented<T extends string>(value: T, options: [T, string][], onPick: (v: T) => void): HTMLElement {
  return h(
    "div",
    { class: "segmented", role: "group" },
    ...options.map(([v, label]) => {
      const b = h("button", { type: "button", class: v === value ? "on" : "", "aria-pressed": String(v === value) }, label);
      b.addEventListener("click", () => onPick(v));
      return b;
    }),
  );
}

function select(value: string | number, options: [string | number, string][], onChange: (v: string) => void): HTMLSelectElement {
  const el = h("select", {}, ...options.map(([v, label]) => h("option", { value: String(v) }, label)));
  el.value = String(value);
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

function numberInput(value: number, min: number, max: number, onInput: (v: number) => void): HTMLInputElement {
  const el = h("input", { type: "number", inputmode: "numeric", min: String(min), max: String(max), value: String(value) });
  el.addEventListener("input", () => onInput(Number(el.value)));
  return el;
}

const field = (label: string, ...control: Node[]) => h("label", { class: "field" }, h("span", {}, label), ...control);

function renderPlanNew(): void {
  const d = draft;
  const rerender = () => renderPlanNew();
  const summary = h("p", { class: "plan-summary" });
  const updateSummary = () => {
    const p = draftPlan(d);
    const portions = plans.schedule(quran, p);
    const total = portions.reduce((n, x) => n + x.ayahs, 0);
    const end = portions[portions.length - 1].date;
    const perDay = Math.round(total / portions.length);
    summary.textContent =
      `${formatRange(p.from, p.to)} · ${total.toLocaleString()} ayat over ${portions.length} day${portions.length > 1 ? "s" : ""}` +
      ` · about ${perDay} a day · ends ${end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  };

  const surahOptions: [number, string][] = quran.surahs.map((s) => [s.id, `${s.id}. ${s.transliteration}`]);
  const juzOptions: [number, string][] = Array.from({ length: 30 }, (_, i) => [i + 1, `Juz ${i + 1}`]);
  const ayahPicker = (r: plans.AyahRef) =>
    h(
      "div",
      { class: "row" },
      select(r.surah, surahOptions, (v) => {
        r.surah = Number(v);
        r.ayah = r === d.to ? quran.surahs[r.surah - 1].totalVerses : 1;
        rerender();
      }),
      numberInput(r.ayah, 1, quran.surahs[r.surah - 1].totalVerses, (v) => {
        r.ayah = v;
        updateSummary();
      }),
    );

  const range =
    d.rangeBy === "juz"
      ? h(
          "div",
          { class: "row" },
          field("From", select(d.juzFrom, juzOptions, (v) => ((d.juzFrom = Number(v)), rerender()))),
          field("To", select(d.juzTo, juzOptions, (v) => ((d.juzTo = Number(v)), rerender()))),
        )
      : h("div", {}, field("From surah · ayah", ayahPicker(d.from)), field("To surah · ayah", ayahPicker(d.to)));

  const pace =
    d.paceBy === "duration"
      ? h(
          "div",
          { class: "row" },
          numberInput(d.n, 1, 3650, (v) => ((d.n = v), updateSummary())),
          select(d.unit, [["days", "days"], ["weeks", "weeks"], ["months", "months"], ["years", "years"]], (v) => {
            d.unit = v as Unit;
            updateSummary();
          }),
        )
      : h("div", { class: "row" }, numberInput(d.perDay, 1, 6236, (v) => ((d.perDay = v), updateSummary())), h("span", { class: "unit" }, "ayat a day"));

  const name = h("input", { type: "text", placeholder: "Name (optional)", value: d.name });
  name.addEventListener("input", () => (d.name = name.value));
  const start = h("input", { type: "date", value: d.start });
  start.addEventListener("change", () => ((d.start = start.value), updateSummary()));

  const create = h("button", { class: "button primary", type: "submit" }, "Create plan");
  const form = h(
    "form",
    { class: "plan-form" },
    field("Goal", segmented(d.goal, [["read", "Read"], ["memorise", "Memorise"]], (v) => ((d.goal = v), rerender()))),
    field("Range", segmented(d.rangeBy, [["juz", "By juz"], ["surah", "By surah & ayah"]], (v) => ((d.rangeBy = v), rerender()))),
    range,
    field("Pace", segmented(d.paceBy, [["duration", "Finish in"], ["ayahs", "Ayat per day"]], (v) => ((d.paceBy = v), rerender()))),
    pace,
    field("Start", start),
    field("Name", name),
    summary,
    create,
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const p = draftPlan(d);
    const plan = plans.addPlan({ ...p, name: d.name.trim() || `${GOAL_VERB[p.goal]} ${formatRange(p.from, p.to)}` });
    draft = newDraft();
    refreshReminders();
    location.hash = `#/plans/${plan.id}`;
  });

  const scrollY = window.scrollY;
  $app.replaceChildren(
    h(
      "header",
      { class: "top reader-top" },
      h("a", { class: "icon", href: "#/plans", "aria-label": "Study plans" }, "‹"),
      h("div", { class: "title" }, h("b", {}, "New study plan"), h("small", {}, "Choose what to cover and how fast")),
    ),
    form,
  );
  updateSummary();
  window.scrollTo(0, scrollY);
}

// Schedule -----------------------------------------------------------------
function renderPlan(id: string): void {
  const plan = plans.getPlan(id);
  if (!plan) {
    location.hash = "#/plans";
    return;
  }
  const { portions, done, count } = planStatus(plan);
  const t = plans.todayIndex(plan);

  const del = h("button", { class: "icon", "aria-label": "Delete plan" }, "🗑");
  del.addEventListener("click", () => {
    if (confirm(`Delete "${plan.name}"?`)) {
      plans.deletePlan(plan.id);
      refreshReminders();
      location.hash = "#/plans";
    }
  });

  const rows = portions.map((p, i) => {
    const st = done[i];
    const check = h("input", { type: "checkbox", "aria-label": `Day ${i + 1} done` });
    check.checked = st.complete;
    // Fully recited days are done automatically; the box only adds manual ticks.
    check.disabled = st.complete && !st.manual;
    check.addEventListener("change", () => {
      plans.setDone(plan, p.day, check.checked);
      refreshReminders();
      renderPlan(id);
    });
    const label = [`Day ${i + 1}`, formatDate(p.date), p.juzLabel].filter(Boolean).join(" · ");
    const detail = [`${p.ayahs} ayat`];
    if (st.heard && !st.complete) detail.push(`${st.heard}/${p.ayahs} recited`);
    if (st.complete && !st.manual) detail.push("recited");
    const body = h(
      "a",
      { href: `#/surah/${p.from.surah}/${p.from.ayah}`, class: "day-body" },
      h("small", {}, label),
      h("b", {}, formatRange(p.from, p.to)),
      h("small", {}, detail.join(" · ")),
    );
    if (plan.goal === "memorise" && i > 0) {
      const prev = portions[i - 1];
      body.append(h("small", { class: "revise" }, `Then revise: ${formatRange(prev.from, prev.to)}`));
    }
    return h(
      "li",
      { class: `day${i === t ? " today" : ""}${st.complete ? " complete" : ""}${i < t && !st.complete ? " late" : ""}`, id: `day-${i}` },
      check,
      body,
    );
  });

  const pct = Math.round((count / portions.length) * 100);
  $app.replaceChildren(
    h(
      "header",
      { class: "top reader-top" },
      h("a", { class: "icon", href: "#/plans", "aria-label": "Study plans" }, "‹"),
      h("div", { class: "title" }, h("b", {}, plan.name), h("small", {}, `${GOAL_VERB[plan.goal]} · ${portions.length} days`)),
      del,
    ),
    h(
      "div",
      { class: "progress-panel" },
      h("b", {}, `${count} of ${portions.length} days done`),
      progressBar(pct),
      h("p", { class: "fine" }, "Days tick themselves off once every ayah in them has been recited with the mic. Tap a day to open it in the reader."),
    ),
    h("ol", { class: "days" }, ...rows),
  );
  const focus = Math.max(0, Math.min(t, portions.length - 1));
  if (focus > 0) document.getElementById(`day-${focus}`)?.scrollIntoView({ block: "center" });
  else window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Daily tracker and reminders
// ---------------------------------------------------------------------------
const TRACKER_WEEKS = 20;

/** The first unfinished plan with a portion scheduled on `date`. */
function planPortionOn(date: Date): { plan: plans.Plan; portion: plans.Portion } | null {
  for (const plan of plans.allPlans()) {
    const portions = plans.schedule(quran, plan);
    const i = plans.todayIndex(plan, date);
    if (i < 0 || i >= portions.length || plan.done.includes(i)) continue;
    return { plan, portion: portions[i] };
  }
  return null;
}

function reminderMessage(date: Date, offset: number): reminders.ReminderMessage {
  const st = progress.streak();
  // Tomorrow's streak only holds if today was done; further ahead, keep it simple.
  const streakNow = offset === 0 ? st.current : offset === 1 && st.today ? st.current : 0;
  const title = streakNow > 0 ? `Keep your ${streakNow}-day streak going` : "Time for your daily recitation";
  const due = planPortionOn(date);
  if (due) {
    return {
      title,
      body: `Day ${due.portion.day + 1} of ${due.plan.name}: ${formatRange(due.portion.from, due.portion.to)}`,
      hash: `#/surah/${due.portion.from.surah}/${due.portion.from.ayah}`,
    };
  }
  const last = settings.lastRead;
  return {
    title,
    body: last
      ? `Pick up at ${surahName(last.surah)}, ayah ${last.ayah}. Even a few ayat count.`
      : "Open Tilawat and recite a few ayat.",
    hash: last ? `#/surah/${last.surah}/${last.ayah}` : "#/",
  };
}

let reminderQueue = Promise.resolve();
/** Rebuild the reminder schedule (after a recitation, a plan change or a settings change). */
function refreshReminders(): void {
  reminderQueue = reminderQueue
    .then(() => reminders.refresh(settings.reminder, progress.streak().today, reminderMessage))
    .catch((err) => console.warn("reminders: refresh failed", err));
}

function renderTracker(): HTMLElement {
  const st = progress.streak();
  const today = new Date();
  // Columns are weeks (Monday first), ending with the current week.
  const mondayOffset = (today.getDay() + 6) % 7;
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - (TRACKER_WEEKS - 1) * 7);
  const cells: HTMLElement[] = [];
  for (let n = 0; n < TRACKER_WEEKS * 7; n++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + n);
    if (d > today) {
      cells.push(h("span", { class: "cell future" }));
      continue;
    }
    const ayat = progress.ayahsOn(d);
    const level = ayat === 0 ? 0 : ayat < 10 ? 1 : ayat < 50 ? 2 : 3;
    const label = `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${ayat ? `${ayat} ayat recited` : "no recitation"}`;
    cells.push(h("span", { class: `cell l${level}${n === TRACKER_WEEKS * 7 - 7 + mondayOffset ? " now" : ""}`, title: label, "aria-label": label }));
  }

  const stat = (value: number, label: string) => h("div", { class: "stat" }, h("b", {}, String(value)), h("small", {}, label));
  const card = h(
    "section",
    { class: "tracker" },
    h(
      "div",
      { class: "stats" },
      stat(st.current, "day streak"),
      stat(st.best, "best streak"),
      stat(st.daysThisYear, "days this year"),
    ),
    h("div", { class: "heatmap", role: "img", "aria-label": `Recitation calendar for the last ${TRACKER_WEEKS} weeks` }, ...cells),
    h(
      "p",
      { class: "fine" },
      st.today ? "You've recited today. Well done." : "A day counts once you recite with the mic and Tilawat follows along.",
    ),
    renderReminderRow(),
  );
  return card;
}

function renderReminderRow(): HTMLElement {
  if (!reminders.supported) {
    return h("p", { class: "fine" }, "Daily reminders are available in the Android and iOS apps.");
  }
  const toggle = h("input", { type: "checkbox", role: "switch", "aria-label": "Daily reminder" });
  toggle.checked = settings.reminder.enabled;
  const time = h("input", { type: "time", value: settings.reminder.time, "aria-label": "Reminder time" });
  time.disabled = !settings.reminder.enabled;
  const note = h("small", {});
  const sync = () => {
    note.textContent = settings.reminder.enabled ? "Skipped on days you've already recited" : "";
    time.disabled = !settings.reminder.enabled;
  };
  toggle.addEventListener("change", async () => {
    if (toggle.checked && !(await reminders.requestPermission())) {
      toggle.checked = false;
      setStatus("Allow notifications for Tilawat in system settings to get reminders", "error");
      return;
    }
    settings.reminder.enabled = toggle.checked;
    saveSettings();
    sync();
    refreshReminders();
  });
  time.addEventListener("change", () => {
    if (!time.value) return;
    settings.reminder.time = time.value;
    saveSettings();
    refreshReminders();
  });
  sync();
  return h(
    "div",
    { class: "reminder-row" },
    h("label", { class: "switch" }, toggle, h("span", {}, h("b", {}, "Daily reminder"), note)),
    time,
  );
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------
let ayahObserver: IntersectionObserver | null = null;

function applyReaderPrefs(): void {
  document.documentElement.style.setProperty("--font-scale", String(settings.fontScale));
  document.body.classList.toggle("hide-translation", !settings.showTranslation);
  document.body.dataset.script = settings.script;
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
  const scriptBtn = h("button", { class: "icon script", "aria-label": "Change Arabic script" }, "خط");
  scriptBtn.addEventListener("click", async () => {
    const i = SCRIPTS.findIndex((x) => x.id === settings.script);
    const next = SCRIPTS[(i + 1) % SCRIPTS.length];
    scriptBtn.disabled = true;
    try {
      await applyScript(quran, next.id);
      settings.script = next.id;
      saveSettings();
      const ayah = settings.lastRead?.surah === s.id ? settings.lastRead.ayah : undefined;
      renderSurah(s, ayah);
      setStatus(`Script: ${next.label}`, "idle");
      setTimeout(() => {
        if ($status.textContent === `Script: ${next.label}`) setStatus("");
      }, 1500);
    } catch (err) {
      setStatus(`Couldn't load ${next.label}: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      scriptBtn.disabled = false;
    }
  });
  const back = h("a", { class: "icon", href: "#/", "aria-label": "All surahs" }, "‹");

  const header = h(
    "header",
    { class: "top reader-top" },
    back,
    h("div", { class: "title" }, h("b", {}, `${s.id}. ${s.transliteration}`), h("small", {}, s.translation)),
    fontBtn("A−", -0.1),
    fontBtn("A+", 0.1),
    scriptBtn,
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
        // The Hafs font draws the ayah-end ornament around bare digits itself.
        h("span", { class: "end" }, `${settings.script === "hafs" ? "" : "۝"}${arabicNumber(a.ayah)}`),
      ),
      h("p", { class: "tr" }, h("span", { class: "n" }, `${a.surah}:${a.ayah}`), " ", a.translation),
    ),
  );

  const intro = h("div", { class: "surah-intro" }, h("div", { class: "ar surah-name", lang: "ar" }, s.name));
  // Al-Fatihah's basmala is its first ayah; At-Tawbah has none.
  if (s.id !== 1 && s.id !== 9) {
    intro.append(h("div", { class: "ar basmala", lang: "ar" }, settings.script === "amiri" ? "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ" : basmala(quran)));
  }

  const panel = h("div", { class: "progress-panel" });
  $app.replaceChildren(header, intro, panel, h("section", { class: "ayahs" }, ...ayahs));
  applyReaderPrefs();
  paintProgress(s);

  // Reopening a surah from the list resumes where it was last viewed.
  const lastView = progress.surahProgress(s.id).lastView;
  if (!scrollToAyah && lastView && lastView.ayah > 1) scrollToAyah = lastView.ayah;

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
      progress.recordView(s.id, settings.lastRead.ayah);
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

const MODE_NAMES: Record<progress.SessionMode, string> = { follow: "Follow along", live: "Live correction", review: "Review after" };
const STATUS_TITLES: Record<progress.AyahStatus, string> = {
  recited: "Recited (follow along)",
  clean: "No mistakes found last time",
  mistake: "Possible mistake last time",
};

/** The stored progress for the surah on screen: summary panel and per-ayah markers. */
function paintProgress(s: Surah): void {
  const panel = document.querySelector<HTMLElement>(".progress-panel");
  if (!panel) return;
  const p = progress.surahProgress(s.id);
  document.querySelectorAll<HTMLElement>(".ayah[data-status]").forEach((el) => {
    delete el.dataset.status;
    el.querySelector(".end")?.removeAttribute("title");
  });
  for (const [ayah, status] of p.ayahStatus) {
    const el = document.getElementById(`a-${s.id}-${ayah}`);
    if (!el) continue;
    el.dataset.status = status;
    el.querySelector(".end")?.setAttribute("title", STATUS_TITLES[status]);
  }
  if (!p.sessions) {
    panel.replaceChildren();
    panel.hidden = true;
    return;
  }
  const pct = Math.round((p.recited / s.totalVerses) * 100);
  const sessionRow = (sess: progress.Session) => {
    const nums = sess.ayahs.filter((k) => k.startsWith(`${s.id}:`)).map((k) => Number(k.split(":")[1]));
    const range = nums.length ? (Math.min(...nums) === Math.max(...nums) ? `ayah ${nums[0]}` : `ayat ${Math.min(...nums)}–${Math.max(...nums)}`) : "no ayat located";
    const open = sess.issues.filter((i) => i.surah === s.id && (i.status === "open" || i.status === "deferred")).length;
    const result = sess.mode === "follow" ? "" : open ? ` · ${open} possible mistake${open > 1 ? "s" : ""}` : " · no mistakes found";
    return h("li", {}, h("span", {}, progress.relativeTime(sess.endedAt ?? sess.startedAt)), ` ${MODE_NAMES[sess.mode]} · ${range}${result}`);
  };
  panel.replaceChildren(
    h("div", { class: "progress-head" }, h("b", {}, "Your progress"), h("small", {}, `${p.recited} of ${s.totalVerses} ayat recited · ${p.sessions} session${p.sessions > 1 ? "s" : ""}`)),
    progressBar(pct),
    h("ul", { class: "sessions" }, ...p.recentSessions.map(sessionRow)),
    h(
      "p",
      { class: "legend" },
      h("span", { "data-k": "clean" }, "● no mistakes"),
      h("span", { "data-k": "mistake" }, "● possible mistake"),
      h("span", { "data-k": "recited" }, "● recited"),
    ),
  );
  panel.hidden = false;
}

// ---------------------------------------------------------------------------
// Live recitation tracking
// ---------------------------------------------------------------------------
let recitePos: { surah: number; ayah: number; matched: number[] } | null = null;

/** Clear this session's colouring: heard words, the current ayah and flagged mistakes. */
function clearRecitationMarks(): void {
  recitePos = null;
  issues.clear();
  document.querySelectorAll(".w.heard").forEach((el) => el.classList.remove("heard"));
  document.querySelectorAll(".ayah.current").forEach((el) => el.classList.remove("current"));
  paintIssues();
  $correction.hidden = true;
  $review.hidden = true;
}

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

/**
 * The last ayah was recited. The engine has reset and keeps listening, so show the
 * surah as done and let the reciter carry on with any surah (e.g. the next, after
 * a basmala).
 */
function onSurahComplete(surah: number): void {
  const s = quran.surahs[surah - 1];
  const last = s.totalVerses;
  progress.recordAyah(surah, last);
  if (route.name === "surah" && route.id === surah) {
    highlight(surah, last, s.ayahs[last - 1].words.map((_, i) => i));
  }
  // Forget the position so reciting this surah again still scrolls and highlights.
  recitePos = null;
  $correction.hidden = true;
  setStatus(`${s.transliteration} complete · recite the next surah to carry on`, "live");
  blindComplete(s.transliteration);
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
      showBlind(e.active && settings.mode === "review");
      $mic.classList.toggle("on", e.active);
      $wave.hidden = !e.active;
      document.body.classList.toggle("listening", e.active);
      if (e.active && recognizer.analyser) waveform.start(recognizer.analyser);
      else waveform.stop();
      $mic.setAttribute("aria-pressed", String(e.active));
      setStatus(e.active ? "Listening… start reciting" : "", e.active ? "live" : "idle");
      break;
    case "level":
      break; // the waveform reads the mic directly, every frame
    case "verse_match": {
      const s = quran.surahs[e.surah - 1];
      setStatus(`${s.transliteration} ${e.surah}:${e.ayah}`, "live");
      updateBlind(e.surah, e.ayah);
      progress.recordAyah(e.surah, e.ayah);
      followRecitation(e.surah, e.ayah, recitePos?.surah === e.surah && recitePos.ayah === e.ayah ? recitePos.matched : []);
      break;
    }
    case "word_progress":
      followRecitation(e.surah, e.ayah, e.matched_indices);
      break;
    case "surah_complete":
      onSurahComplete(e.surah);
      break;
    case "issue":
      logIssue(e.issue);
      break;
    case "correction":
      onCorrection(e.state);
      break;
    case "stopped":
      progress.endSession();
      refreshReminders();
      if (route.name === "surah") paintProgress(quran.surahs[route.id - 1]);
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
      clearRecitationMarks();
      $modes.hidden = true;
      progress.startSession(settings.mode);
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
  { id: "review", label: "Review after", desc: "Memorisation test: the text stays hidden while I recite, then possible mistakes are listed when I stop." },
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
        if (settings.mode !== m.id) clearRecitationMarks();
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
type IssueStatus = progress.IssueOutcome;
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
  if (!issues.has(key)) {
    const status = settings.mode === "live" ? "open" : "deferred";
    issues.set(key, { issue, status });
    progress.recordIssue(issue, status);
  }
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
  if (entry) progress.updateIssue(entry.issue, entry.status);
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

// ---------------------------------------------------------------------------
// Blind recitation (Review after): cover the text so it's recited from memory.
// Only what has already been recited is shown: the surah and the last ayah reached.
// ---------------------------------------------------------------------------
const blindHeard = new Set<string>();

function showBlind(on: boolean): void {
  blindHeard.clear();
  document.body.classList.toggle("blind", on);
  $blind.hidden = !on;
  if (on) {
    $blind.replaceChildren(
      h("h2", {}, "Reciting from memory"),
      h("p", { class: "blind-where" }, "Start reciting. The text stays hidden until you stop."),
    );
  }
}

function updateBlind(surah: number, ayah: number): void {
  if ($blind.hidden) return;
  blindHeard.add(`${surah}:${ayah}`);
  const s = quran.surahs[surah - 1];
  $blind.replaceChildren(
    h("h2", {}, "Reciting from memory"),
    h("div", { class: "ar blind-surah", lang: "ar" }, s.name),
    h("p", { class: "blind-where" }, `${s.transliteration} · reached ayah ${ayah} of ${s.totalVerses}`),
    h("p", { class: "fine" }, `${blindHeard.size} ayah${blindHeard.size > 1 ? "s" : ""} recited. Tap stop to reveal the text and your review.`),
  );
}

function blindComplete(name: string): void {
  if ($blind.hidden) return;
  $blind.replaceChildren(
    h("h2", {}, "Reciting from memory"),
    h("p", { class: "blind-where" }, `${name} complete`),
    h("p", { class: "fine" }, "Start the next surah (from the basmala) to carry on, or tap stop to reveal the text and your review."),
  );
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
Promise.all([loadQuran(), progress.loadProgress(), plans.loadPlans()])
  .then(async ([q]) => {
    quran = q;
    await applyScript(q, settings.script).catch(() => {
      settings.script = "amiri";
    });
    setStatus("");
    window.addEventListener("hashchange", render);
    reminders.onTap((hash) => (location.hash = hash));
    refreshReminders();
    renderModeButton();
    render();
  })
  .catch((err) => setStatus(`Failed to load Quran data: ${err.message}`, "error"));
