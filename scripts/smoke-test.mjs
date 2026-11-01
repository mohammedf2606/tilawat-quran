// Node smoke test: feed 16 kHz mono WAVs through the Tilawa engine and print matches.
// Usage: node scripts/smoke-test.mjs <assetsDir> <file.wav>...
// Needs `npm i --no-save onnxruntime-node` (desktop-only, not an app dependency).
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import { createZipformerSession } from "@tilawa/core";

const [assetsDir, ...wavs] = process.argv.slice(2);

function wavToFloat32(buf) {
  const dataAt = buf.indexOf("data") + 8;
  const pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + dataAt, buf.byteOffset + buf.length - ((buf.length - dataAt) % 2)));
  return Float32Array.from(pcm, (s) => s / 32768);
}

const session = await createZipformerSession({
  ort,
  model: () => readFile(path.join(assetsDir, "zipformer_a0w_ep1_a05.int8.onnx")),
  corpus: async () => JSON.parse(await readFile(path.join(assetsDir, "zipformer_quran.json"), "utf8")),
  quran: async () => JSON.parse(await readFile(path.join(assetsDir, "quran.json"), "utf8")),
});

const log = (msgs) => {
  for (const m of msgs) {
    if (m.type === "verse_match") console.log(`verse_match ${m.surah}:${m.ayah} (${m.confidence.toFixed(2)})`);
    if (m.type === "word_progress") console.log(`  words ${m.surah}:${m.ayah} ${m.matched_indices.length}/${m.total_words}`);
  }
};

const CHUNK = 4800;
for (const wav of wavs) {
  const pcm = wavToFloat32(await readFile(wav));
  for (let i = 0; i < pcm.length; i += CHUNK) log(await session.feed(pcm.subarray(i, i + CHUNK)));
}
log(await session.stop());
