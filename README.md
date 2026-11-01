# Tilawat

An offline Quran app for Android. Read all 114 surahs in Arabic, with an English
translation, and tap the mic to recite — the on-device [Tilawa](https://github.com/yazinsai/tilawa)
model works out which surah and ayah you're on and highlights each word as you say it.
No network is needed at any point; the text, translation and model all ship inside the APK.

## Recite modes

Tap the mode pill above the mic to choose:

- **Follow along**: finds your place and highlights each word as you recite.
- **Live correction**: pauses at a possible mistake (missed or wrong word, harakah
  slip, repeated word, skipped ayah) so you can retry the ayah, dismiss it, or save
  it for later.
- **Review after**: lets you recite uninterrupted, then lists possible mistakes
  when you stop.

Both correction modes use Tilawa's correction engine. It flags only clear cases,
so it misses some mistakes but rarely flags correct recitation. When you start from
a surah page, the app holds the engine to that surah from the ayah on screen. From
the home screen, it locks onto the first surah it recognises.

## Install on your phone

Every push to `main` builds an APK in GitHub Actions.

1. Open the latest **Build APK** run under the repo's *Actions* tab and download the
   `tilawat-apk` artifact (or `gh run download -n tilawat-apk`).
2. Copy the `.apk` to your phone, open it, and allow installs from that source.

Pushing a `v*` tag (e.g. `git tag v0.1.0 && git push --tags`) also attaches the APK
to a GitHub Release.

## How it's built

| Layer | Tech |
| --- | --- |
| UI, reader, recitation tracking | TypeScript + Vite (`src/`) |
| Recognition | `@tilawa/core` Zipformer engine on `onnxruntime-web` (WASM) in a Web Worker |
| Android shell | Capacitor 8, Kotlin `MainActivity` (`android/`) |
| Quran text | Tilawa phoneme corpus (Arabic words, aligned to the model) + `public/data/quran_en.json` (Saheeh International translation) |

## Develop

```bash
npm install
npm run assets     # downloads the model + corpus into public/models (checksummed)
npm run dev        # browser preview at http://localhost:5173
```

To build an APK locally you need JDK 21 and the Android SDK:

```bash
npm run android:sync
cd android && ./gradlew assembleDebug
```

`scripts/smoke-test.mjs` runs the engine against WAV files in Node
(`npm i --no-save onnxruntime-node` first).

## Licences

App code is MIT. The Tilawa Zipformer model and phoneme corpus are **NPL-1.2**
(non-commercial, share-alike) — see [NOTICE.md](NOTICE.md). Don't ship this app
commercially without replacing them.
