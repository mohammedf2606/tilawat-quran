// Runs the Tilawa Zipformer engine off the UI thread. Everything is loaded from
// files bundled in the APK — no network.
import * as ort from "onnxruntime-web/wasm";
import {
  ZipformerSession,
  type CorrectionAction,
  type CorrectionIssue,
  type CorrectionState,
  type WorkerOutbound,
} from "@tilawa/core";

/** follow = tracking only; live = flag mistakes as they happen; review = collect them for the end. */
export type ReciteMode = "follow" | "live" | "review";
export type Passage = { surah: number; ayah: number; ayahEnd: number };

export type WorkerIn =
  | { type: "init" }
  | { type: "audio"; samples: Float32Array }
  | { type: "stop" }
  | { type: "reset" }
  | { type: "set_mode"; mode: ReciteMode }
  | { type: "set_expected"; passage: Passage | null }
  | { type: "correction_action"; action: CorrectionAction };

export type WorkerOut =
  | { type: "loading"; message: string; percent?: number }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "verse_match"; surah: number; ayah: number; confidence: number }
  | { type: "word_progress"; surah: number; ayah: number; matched_indices: number[]; total_words: number }
  /** Live mode: the correction state machine moved (flagged, retrying, corrected, idle). */
  | { type: "correction"; state: CorrectionState }
  /** Any mode except follow: a possible mistake was raised (live flags included). */
  | { type: "issue"; issue: CorrectionIssue }
  | { type: "stopped" };

const MODEL_URL = "/models/zipformer_a0w_ep1_a05.int8.onnx";
const CORPUS_URL = "/models/zipformer_quran.json";

let session: ZipformerSession | null = null;
let mode: ReciteMode = "follow";
let passage: Passage | null = null;
/** Passage locked from the first verse match when none was given (started from the home screen). */
let autoPassage = false;
let ayahCounts: number[] = [];

const post = (msg: WorkerOut) => self.postMessage(msg);

async function loadModel(): Promise<ArrayBuffer> {
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model fetch failed: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) post({ type: "loading", message: "Loading model", percent: Math.round((loaded / total) * 100) });
  }
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

async function init(): Promise<void> {
  if (session) return post({ type: "ready" });
  post({ type: "loading", message: "Loading phoneme corpus" });
  const corpus = await (await fetch(CORPUS_URL)).json();
  ayahCounts = corpus.surahs.map((s: { ayahs: unknown[] }) => s.ayahs.length);
  const model = await loadModel();
  post({ type: "loading", message: "Starting engine" });
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  session = await ZipformerSession.create({ ort, model, corpus, executionProviders: ["wasm"] });
  applyMode();
  post({ type: "ready" });
}

function applyMode(): void {
  if (!session) return;
  forward(session.setMode(mode === "follow" ? "tracking" : "correction"));
  session.setExpected(mode === "follow" ? null : passage);
}

/**
 * Relay engine output to the page. A flag pauses recognition until it is acted
 * on, so in review mode (and for flags raised while stopping, when there is no
 * mic left to retry with) we defer it straight away and just log the issue.
 */
function forward(msgs: WorkerOutbound[], stopping = false): void {
  for (const m of msgs) {
    switch (m.type) {
      case "verse_match":
        post({ type: "verse_match", surah: m.surah, ayah: m.ayah, confidence: m.confidence });
        // The correction rules are much stronger with a known passage, so once
        // we know where the reciter is, hold them to the rest of that surah.
        if (mode !== "follow" && !passage && !autoPassage) {
          autoPassage = true;
          session!.setExpected({ surah: m.surah, ayah: m.ayah, ayahEnd: ayahCounts[m.surah - 1] });
        }
        break;
      case "word_progress":
        post({
          type: "word_progress",
          surah: m.surah,
          ayah: m.ayah,
          matched_indices: m.matched_indices,
          total_words: m.total_words,
        });
        break;
      case "correction_note":
        post({ type: "issue", issue: m.issue });
        break;
      case "correction": {
        const { state } = m;
        if (state.phase === "error" && state.issue) post({ type: "issue", issue: state.issue });
        if (state.phase === "error" && (mode === "review" || stopping)) {
          forward(session!.correct("review_later"), stopping);
        } else if (mode === "live") {
          post({ type: "correction", state });
        }
        break;
      }
    }
  }
}

async function handle(msg: WorkerIn): Promise<void> {
  switch (msg.type) {
    case "init":
      return init();
    case "audio":
      if (session) forward(await session.feed(msg.samples));
      return;
    case "stop":
      if (session) {
        forward(await session.stop(), true);
        session.reset();
        if (autoPassage) session.setExpected(null);
        autoPassage = false;
      }
      post({ type: "stopped" });
      return;
    case "reset":
      session?.reset();
      return;
    case "set_mode":
      mode = msg.mode;
      return applyMode();
    case "set_expected":
      passage = msg.passage;
      return applyMode();
    case "correction_action":
      if (session) forward(session.correct(msg.action));
      return;
  }
}

// The engine is stateful; never let two calls overlap.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<WorkerIn>) => {
  queue = queue
    .then(() => handle(e.data))
    .catch((err) => post({ type: "error", message: err instanceof Error ? err.message : String(err) }));
};
