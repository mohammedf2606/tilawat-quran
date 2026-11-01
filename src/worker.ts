// Runs the Tilawa Zipformer engine off the UI thread. Everything is loaded from
// files bundled in the APK — no network.
import * as ort from "onnxruntime-web/wasm";
import { ZipformerSession } from "@tilawa/core";

export type WorkerIn =
  | { type: "init" }
  | { type: "audio"; samples: Float32Array }
  | { type: "stop" }
  | { type: "reset" };

export type WorkerOut =
  | { type: "loading"; message: string; percent?: number }
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "verse_match"; surah: number; ayah: number; confidence: number }
  | { type: "word_progress"; surah: number; ayah: number; matched_indices: number[]; total_words: number };

const MODEL_URL = "/models/zipformer_a0w_ep1_a05.int8.onnx";
const CORPUS_URL = "/models/zipformer_quran.json";

let session: ZipformerSession | null = null;

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
  const model = await loadModel();
  post({ type: "loading", message: "Starting engine" });
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  session = await ZipformerSession.create({ ort, model, corpus, executionProviders: ["wasm"] });
  post({ type: "ready" });
}

function forward(msgs: { type: string }[]): void {
  for (const m of msgs) {
    if (m.type === "verse_match") {
      const { surah, ayah, confidence } = m as Extract<WorkerOut, { type: "verse_match" }>;
      post({ type: "verse_match", surah, ayah, confidence });
    } else if (m.type === "word_progress") {
      const { surah, ayah, matched_indices, total_words } = m as Extract<WorkerOut, { type: "word_progress" }>;
      post({ type: "word_progress", surah, ayah, matched_indices, total_words });
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
      if (session) forward(await session.stop());
      session?.reset();
      return;
    case "reset":
      session?.reset();
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
