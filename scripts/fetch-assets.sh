#!/usr/bin/env bash
# Downloads the Tilawa model + corpora into public/ so they ship inside the APK.
# Model and phoneme corpus are NPL-1.2 (non-commercial) — see NOTICE.md.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/models

fetch() {
  local url=$1 out=$2 sha=$3
  if [[ -f $out ]] && echo "$sha  $out" | shasum -a 256 -c --status; then return; fi
  echo "Downloading $out"
  curl -sSfL -o "$out" "$url"
  echo "$sha  $out" | shasum -a 256 -c
}

base=https://github.com/yazinsai/tilawa/releases/download
fetch "$base/zipformer-a0w-ep1-a0.5/zipformer_a0w_ep1_a05.int8.onnx" public/models/zipformer_a0w_ep1_a05.int8.onnx bfb5b712695634a6099b45a6a78003bd5103417c4eae6338277d54679254905a
fetch "$base/v0.3.0/zipformer_quran.json" public/models/zipformer_quran.json 24360c05ec88fcacf3419c1fe6cd81d69e653326a0bf0e4fb507e7b98fc88127
