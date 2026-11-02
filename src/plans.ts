// Study plans: split a range of the Qur'an into daily portions to read or
// memorise, persisted in native storage like progress.ts.
import { Preferences } from "@capacitor/preferences";
import type { QuranData } from "./quran";

export type PlanGoal = "read" | "memorise";
export interface AyahRef {
  surah: number;
  ayah: number;
}
export type Pace = { kind: "days"; days: number } | { kind: "ayahs"; perDay: number };

export interface Plan {
  id: string;
  name: string;
  goal: PlanGoal;
  from: AyahRef;
  to: AyahRef;
  pace: Pace;
  /** Local date the plan starts, YYYY-MM-DD. */
  start: string;
  /** Day indices ticked off by hand. */
  done: number[];
  createdAt: number;
}

export interface Portion {
  day: number;
  date: Date;
  from: AyahRef;
  to: AyahRef;
  ayahs: number;
  /** "Juz 3" when the portion is exactly whole juz. */
  juzLabel: string | null;
}

/** First ayah of each juz (1-30). */
export const JUZ_STARTS: AyahRef[] = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1],
].map(([surah, ayah]) => ({ surah, ayah }));

// ---------------------------------------------------------------------------
// Flat ayah index
// ---------------------------------------------------------------------------
interface Flat {
  refs: AyahRef[];
  words: number[];
  /** "surah:ayah" → flat index */
  index: Map<string, number>;
}
let flat: Flat | null = null;

function flatten(q: QuranData): Flat {
  if (flat) return flat;
  const refs: AyahRef[] = [];
  const words: number[] = [];
  const index = new Map<string, number>();
  for (const s of q.surahs) {
    for (const a of s.ayahs) {
      index.set(`${s.id}:${a.ayah}`, refs.length);
      refs.push({ surah: s.id, ayah: a.ayah });
      words.push(a.uthmani.length);
    }
  }
  return (flat = { refs, words, index });
}

const key = (r: AyahRef) => `${r.surah}:${r.ayah}`;
export const flatIndex = (q: QuranData, r: AyahRef) => flatten(q).index.get(key(r)) ?? 0;
export const refAt = (q: QuranData, i: number) => flatten(q).refs[i];

/** Juz number (1-30) an ayah falls in. */
export function juzOf(q: QuranData, r: AyahRef): number {
  const i = flatIndex(q, r);
  let juz = 1;
  JUZ_STARTS.forEach((s, k) => {
    if (flatIndex(q, s) <= i) juz = k + 1;
  });
  return juz;
}

/** Range covering juz `from`..`to` inclusive. */
export function juzRange(q: QuranData, from: number, to: number): { from: AyahRef; to: AyahRef } {
  const end = to >= 30 ? flatten(q).refs.length - 1 : flatIndex(q, JUZ_STARTS[to]) - 1;
  return { from: JUZ_STARTS[from - 1], to: refAt(q, end) };
}

/** Juz boundary indices inside [a, b], when the range is whole juz; else null. */
function wholeJuz(q: QuranData, a: number, b: number): number[] | null {
  const starts = JUZ_STARTS.map((s) => flatIndex(q, s));
  const total = flatten(q).refs.length;
  const first = starts.indexOf(a);
  const endsAt = (k: number) => (k + 1 < starts.length ? starts[k + 1] - 1 : total - 1);
  if (first < 0) return null;
  for (let k = first; k < starts.length; k++) {
    if (endsAt(k) === b) return starts.slice(first, k + 1);
    if (endsAt(k) > b) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------
export function parseDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Days from `start` to the same date `n` units later (calendar-aware for months/years). */
export function durationDays(start: Date, n: number, unit: "days" | "weeks" | "months" | "years"): number {
  if (unit === "days") return n;
  if (unit === "weeks") return n * 7;
  const end = new Date(start);
  if (unit === "months") end.setMonth(end.getMonth() + n);
  else end.setFullYear(end.getFullYear() + n);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/**
 * Split the plan's range into daily portions. A day-count pace balances by word
 * count (ayat vary a lot in length), breaking only between ayat; when the range
 * is whole juz and the days divide them evenly, it follows juz boundaries.
 */
export function schedule(q: QuranData, plan: Pick<Plan, "from" | "to" | "pace" | "start">): Portion[] {
  const { refs, words } = flatten(q);
  let a = flatIndex(q, plan.from);
  let b = flatIndex(q, plan.to);
  if (a > b) [a, b] = [b, a];
  const count = b - a + 1;
  const cuts: number[] = []; // flat index where each portion starts

  if (plan.pace.kind === "ayahs") {
    const per = Math.max(1, Math.floor(plan.pace.perDay));
    for (let i = a; i <= b; i += per) cuts.push(i);
  } else {
    const days = Math.max(1, Math.min(count, Math.floor(plan.pace.days)));
    const juz = wholeJuz(q, a, b);
    if (juz && juz.length >= days && juz.length % days === 0) {
      const per = juz.length / days;
      for (let k = 0; k < juz.length; k += per) cuts.push(juz[k]);
    } else {
      let total = 0;
      for (let i = a; i <= b; i++) total += words[i];
      cuts.push(a);
      let acc = 0;
      for (let i = a; i <= b && cuts.length < days; i++) {
        const target = (total * cuts.length) / days;
        // Cut before ayah i when that lands nearer the target than cutting after it.
        if (i > cuts[cuts.length - 1] && Math.abs(acc - target) <= Math.abs(acc + words[i] - target)) cuts.push(i);
        acc += words[i];
        // Leave at least one ayah for each remaining day.
        const left = days - cuts.length;
        if (left > 0 && b - i <= left) {
          for (let j = i + 1; j <= b && cuts.length < days; j++) cuts.push(j);
          break;
        }
      }
    }
  }

  const starts = new Map(JUZ_STARTS.map((s, k) => [flatIndex(q, s), k + 1]));
  const start = parseDate(plan.start);
  return cuts.map((from, day) => {
    const to = day + 1 < cuts.length ? cuts[day + 1] - 1 : b;
    const juzA = starts.get(from);
    const juzB = to === refs.length - 1 ? 30 : (starts.get(to + 1) ?? 0) - 1;
    const juzLabel =
      juzA && juzB >= juzA ? (juzA === juzB ? `Juz ${juzA}` : `Juz ${juzA}–${juzB}`) : null;
    return { day, date: addDays(start, day), from: refs[from], to: refs[to], ayahs: to - from + 1, juzLabel };
  });
}

/** Every ayah of a portion, as "surah:ayah" keys. */
export function portionKeys(q: QuranData, p: Portion): string[] {
  const { refs } = flatten(q);
  const out: string[] = [];
  for (let i = flatIndex(q, p.from); i <= flatIndex(q, p.to); i++) out.push(key(refs[i]));
  return out;
}

/** Index of today's portion (may be < 0 before the start, or ≥ length after the end). */
export function todayIndex(plan: Plan, today = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((t.getTime() - parseDate(plan.start).getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
const KEY = "tilawat.plans.v1";
let plans: Plan[] = [];

export async function loadPlans(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) {
      const parsed = JSON.parse(value);
      if (parsed?.version === 1 && Array.isArray(parsed.plans)) plans = parsed.plans;
    }
  } catch (err) {
    console.warn("plans: could not load", err);
  }
}

function persist(): void {
  Preferences.set({ key: KEY, value: JSON.stringify({ version: 1, plans }) }).catch((err) =>
    console.warn("plans: save failed", err),
  );
}

export const allPlans = (): readonly Plan[] => plans;
export const getPlan = (id: string) => plans.find((p) => p.id === id);

export function addPlan(p: Omit<Plan, "id" | "done" | "createdAt">): Plan {
  const plan: Plan = { ...p, id: Date.now().toString(36), done: [], createdAt: Date.now() };
  plans.push(plan);
  persist();
  return plan;
}

export function setDone(plan: Plan, day: number, done: boolean): void {
  plan.done = plan.done.filter((d) => d !== day);
  if (done) plan.done.push(day);
  persist();
}

export function deletePlan(id: string): void {
  plans = plans.filter((p) => p.id !== id);
  persist();
}
