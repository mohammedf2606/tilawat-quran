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
  if (!current.ayahs.includes(key)) current.ayahs.push(key);
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
