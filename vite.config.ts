import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  // onnxruntime-web resolves its .wasm via import.meta.url; pre-bundling breaks that.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { target: "es2022", chunkSizeWarningLimit: 4096 },
});
