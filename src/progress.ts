// Long-term recitation progress, kept across app launches in native storage
// (Capacitor Preferences: SharedPreferences on Android, UserDefaults on iOS).
//
// The source of truth is a log of recitation sessions plus the last position
// viewed in each surah; per-surah stats are derived from it on demand.
import { Preferences } from "@capacitor/preferences";
import type { CorrectionIssue } from "@tilawa/core";

export type SessionMode = "follow" | "live" | "review";
export type IssueOutcome = "open" | "deferred" | "dismissed" | "corrected";

export interface SessionIssue {
  surah: number;
  ayah: number;
  word: number;
  words: number;
  kind: CorrectionIssue["kind"];
  status: IssueOutcome;
}

export interface Session {
  id: string;
  mode: SessionMode;
  startedAt: number;
  endedAt: number | null;
  /** "surah:ayah" keys the engine matched, in order. */
  ayahs: string[];
  issues: SessionIssue[];
}

interface Store {
  version: 1;
  sessions: Session[];
  /** Last ayah on screen per surah, and when. */
  views: Record<number, { ayah: number; at: number }>;
  /** Ayat recited with the mic per local day ("YYYY-MM-DD"). Outlives the session cap. */
  days?: Record<string, number>;
}

/** Latest known state of an ayah, from the most recent session that touched it. */
export type AyahStatus = "recited" | "clean" | "mistake";

export interface SurahProgress {
  /** Distinct ayat ever recited. */
  recited: number;
  sessions: number;
  lastRecitedAt: number | null;
  lastView: { ayah: number; at: number } | null;
  ayahStatus: Map<number, AyahStatus>;
  /** Most recent first. */
  recentSessions: Session[];
}

const KEY = "tilawat.progress.v1";
const MAX_SESSIONS = 1000;

let store: Store = { version: 1, sessions: [], views: {} };
let current: Session | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadProgress(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) {
      const parsed = JSON.parse(value) as Store;
      if (parsed.version === 1) store = parsed;
      store.days ??= backfillDays(store.sessions);
    }
  } catch (err) {
    console.warn("progress: could not load, starting fresh", err);
  }
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    Preferences.set({ key: KEY, value: JSON.stringify(store) }).catch((err) =>
      console.warn("progress: save failed", err),
    );
  }, 400);
}

const issueKey = (i: { surah: number; ayah: number; word: number; kind: string }) =>
  `${i.surah}:${i.ayah}:${i.word}:${i.kind}`;

export function startSession(mode: SessionMode): void {
  current = { id: Date.now().toString(36), mode, startedAt: Date.now(), endedAt: null, ayahs: [], issues: [] };
  store.sessions.push(current);
  if (store.sessions.length > MAX_SESSIONS) store.sessions.splice(0, store.sessions.length - MAX_SESSIONS);
}

export function recordAyah(surah: number, ayah: number): void {
  if (!current) return;
  const key = `${surah}:${ayah}`;
  if (!current.ayahs.includes(key)) {
    current.ayahs.push(key);
    const days = (store.days ??= {});
    const today = ymd(new Date());
    days[today] = (days[today] ?? 0) + 1;
  }
  persist();
}

export function recordIssue(issue: CorrectionIssue, status: IssueOutcome): void {
  if (!current) return;
  const key = issueKey(issue);
  if (current.issues.some((i) => issueKey(i) === key)) return;
  current.issues.push({
    surah: issue.surah,
    ayah: issue.ayah,
    word: issue.word,
    words: issue.words ?? 1,
    kind: issue.kind,
    status,
  });
  persist();
}

export function updateIssue(issue: CorrectionIssue, status: IssueOutcome): void {
  const found = current?.issues.find((i) => issueKey(i) === issueKey(issue));
  if (found) {
    found.status = status;
    persist();
  }
}

export function endSession(): void {
  if (!current) return;
  current.endedAt = Date.now();
  // A session that never located anything isn't progress.
  if (!current.ayahs.length && !current.issues.length) store.sessions = store.sessions.filter((s) => s !== current);
  current = null;
  persist();
}

export function recordView(surah: number, ayah: number): void {
  store.views[surah] = { ayah, at: Date.now() };
  persist();
}

export function surahProgress(surah: number): SurahProgress {
  const prefix = `${surah}:`;
  const recited = new Set<number>();
  const ayahStatus = new Map<number, AyahStatus>();
  const touched: Session[] = [];
  let lastRecitedAt: number | null = null;

  // Oldest to newest so later sessions overwrite each ayah's status.
  for (const s of store.sessions) {
    const ayahs = s.ayahs.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length)));
    const issues = s.issues.filter((i) => i.surah === surah);
    if (!ayahs.length && !issues.length) continue;
    touched.push(s);
    lastRecitedAt = s.endedAt ?? s.startedAt;
    for (const a of ayahs) {
      recited.add(a);
      ayahStatus.set(a, s.mode === "follow" ? "recited" : "clean");
    }
    for (const i of issues) {
      if (i.status === "open" || i.status === "deferred") ayahStatus.set(i.ayah, "mistake");
    }
  }

  return {
    recited: recited.size,
    sessions: touched.length,
    lastRecitedAt,
    lastView: store.views[surah] ?? null,
    ayahStatus,
    recentSessions: touched.reverse().slice(0, 5),
  };
}

export function relativeTime(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(at).toLocaleDateString();
}

/** "surah:ayah" keys recited in any session that started at or after `since`. */
export function recitedSince(since: number): Set<string> {
  const out = new Set<string>();
  for (const s of store.sessions) if (s.startedAt >= since) for (const k of s.ayahs) out.add(k);
  return out;
}

// ---------------------------------------------------------------------------
// Daily tracker
// ---------------------------------------------------------------------------
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function backfillDays(sessions: Session[]): Record<string, number> {
  const days: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.ayahs.length) continue;
    const k = ymd(new Date(s.startedAt));
    days[k] = (days[k] ?? 0) + s.ayahs.length;
  }
  return days;
}

/** Ayat recited with the mic on the given day (0 if none). */
export const ayahsOn = (d: Date): number => store.days?.[ymd(d)] ?? 0;

export interface Streak {
  /** Consecutive days up to today, or up to yesterday while today is still open. */
  current: number;
  best: number;
  /** Days with any recitation in the last 365. */
  daysThisYear: number;
  today: boolean;
}

export function streak(now = new Date()): Streak {
  const days = store.days ?? {};
  const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  const today = !!days[ymd(now)];
  let current = 0;
  for (let n = today ? 0 : 1; days[ymd(day(n))]; n++) current++;
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const k of Object.keys(days).filter((k) => days[k] > 0).sort()) {
    const [y, m, d] = k.split("-").map(Number);
    const t = new Date(y, m - 1, d).getTime();
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  let daysThisYear = 0;
  for (let n = 0; n < 365; n++) if (days[ymd(day(n))]) daysThisYear++;
  return { current, best: Math.max(best, current), daysThisYear, today };
}
