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
- **Review after**: a memorisation test. The text is covered while you recite
  from memory, showing only the surah and the last ayah you've reached. When you
  stop, the text is revealed along with a list of possible mistakes.

Both correction modes use Tilawa's correction engine. It flags only clear cases,
so it misses some mistakes but rarely flags correct recitation. When you start from
a surah page, the app holds the engine to that surah from the ayah on screen. From
the home screen, it locks onto the first surah it recognises.

## Install on your phone (with automatic updates)

Every push to `main` builds a signed APK and publishes it as the latest GitHub
Release. [Obtainium](https://github.com/ImranR98/Obtainium) watches that release
and updates the app for you.

1. Install Obtainium from its GitHub releases or F-Droid.
2. Because this repo is private, create a fine-grained GitHub token with read-only
   **Contents** access to `tilawat-quran`. In Obtainium, go to Settings → GitHub and
   paste it in.
3. In Obtainium, add the app `https://github.com/mohammedf2606/tilawat-quran` and install it.
4. On Android 12 and later, turn on background updates in Obtainium so new builds
   install without a prompt. Otherwise you get a notification and tap to update.

Every build is signed with the same key (repo secrets `ANDROID_KEYSTORE_B64` and
`ANDROID_KEYSTORE_PASSWORD`), so each APK installs over the previous one. Keep
the key safe: if it's lost, the app must be uninstalled before a build signed with
a new key can be installed.

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
