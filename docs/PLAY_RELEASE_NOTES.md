# Play Console release notes

One section per upload. Paste into **Release > Production > What's new in this
release**, one language at a time. Play's limit is **500 characters per
language** — the counts below are measured, not estimated.

The app ships in four languages (`src/lib/i18n/locales.ts`), so all four
listings get notes. A language left blank falls back to `en-US`, which is
worse than a short translation.

---

## versionCode 11 · versionName 1.12.1

**Context the notes do not say out loud.** The version users are upgrading
FROM is versionCode 9 / 1.8.3 — versionCode 10 was built and signed but never
uploaded. So the change they actually receive is the R8 minification that
landed with 10, not the billing-plugin removal: versionCode 9 never carried
that plugin either. Measured on the same machine, same toolchain:

| | AAB | |
|---|---|---|
| versionCode 9 (live on Play, `minifyEnabled false`) | 7,220,513 B | 6.89 MB |
| versionCode 11 (this upload, R8 on) | 4,535,254 B | 4.33 MB |
| | **−2,685,259 B** | **−37.2%** |

Both builds carry the **same nine Capacitor plugins** — verified by comparing
`capacitor.plugins.json` from each artifact. The native surface a user touches
is unchanged, which is why the notes promise no new behaviour.

The versionName jumps 1.8.3 → 1.12.1 because it tracks `CURRENT_VERSION` in
`src/lib/changelog.ts` — the website's version, not the shell's. Four minors of
site work shipped to these users without an app update, which is the whole
point of a shell. Nothing to explain to Play; worth knowing if anyone asks why
the number moved so far.

### en-US

```
Smaller download.

This build is 37% smaller than the version you have — 4.3 MB against 6.9 — because the release build is now properly optimised and shrunk. Crash reports arrive readable too, so anything that does go wrong gets fixed faster.

Nothing else changes. Every part of the app works exactly as before.
```

### es-ES

```
Descarga más ligera.

Esta versión ocupa un 37% menos que la que tienes: 4,3 MB frente a 6,9, porque la compilación ya está optimizada y reducida. Los informes de errores también llegan legibles, así que lo que falle se corrige antes.

Nada más cambia. Todo funciona exactamente igual que antes.
```

### pt-PT

```
Download mais leve.

Esta versão ocupa menos 37% do que a que tem: 4,3 MB em vez de 6,9, porque a compilação passou a ser otimizada e reduzida. Os relatórios de erro também chegam legíveis, por isso o que correr mal é corrigido mais depressa.

Nada mais muda. Tudo funciona exatamente como antes.
```

### it-IT

```
Download più leggero.

Questa versione occupa il 37% in meno di quella che hai: 4,3 MB invece di 6,9, perché la build è ora ottimizzata e compressa. Anche i rapporti sugli errori arrivano leggibili, così ciò che non funziona viene corretto prima.

Non cambia nient'altro. Tutto funziona esattamente come prima.
```

### Notes on the wording

- **No number is claimed that was not measured.** "37%" and the two MB figures
  come from the table above, from two builds made on the same machine.
- **"Crash reports arrive readable"** is a real user benefit, not filler: the
  AAB carries its ProGuard mapping, so Play de-obfuscates stack traces instead
  of showing `a.b.c(Unknown Source)`. It is the honest way to say "we can now
  fix what breaks".
- **Nothing mentions the billing plugin.** It would be true of the repo and
  false of the user's experience — they never had it. Release notes describe
  what changed for the reader.
- **Nothing promises speed.** A smaller binary is not a faster app, and the
  claim would be unverified.
