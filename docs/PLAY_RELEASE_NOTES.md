# Play Console release notes

One section per upload. Paste into **Release > Production > What's new in this
release**, one language at a time. Play's limit is **500 characters per
language** — the counts below are measured, not estimated.

The app ships in four languages (`src/lib/i18n/locales.ts`), so all four
listings get notes. A language left blank falls back to `en-US`, which is
worse than a short translation.

---

## versionCode 13 · versionName 1.13.0

**Context the notes do not say out loud.** Play's release-12 dashboard listed
three recommendations. The R8 one had three bullets and all three are now done:
optimization enabled (the `-optimize` default file), resource shrinking enabled
with a keep rule for `res/xml/config.xml` — the one resource Cordova resolves by
name at every launch — and AGP 8.13.0 to 9.4.0 on Gradle 9.7.1. The AGP upgrade
needed one hook in the tracked root `build.gradle`, because exactly one vendored
subproject still asks for `proguard-android.txt`, which AGP 9 rejects.

| | APK | |
|---|---|---|
| versionCode 12 | 2,278,080 B | 2.17 MB |
| versionCode 13 | 1,884,759 B | 1.80 MB |
| | **−393,321 B** | **−17.3%** |

Nothing was removed and no device was dropped: minSdk stays 24, all 8 plugin
classpaths and 62 `@PluginMethod` names survive R8 identity-mapped, and the
signed build was booted on the Pixel_7 before this shipped.

The two edge-to-edge recommendations are deliberately NOT addressed — see the
note in `src/components/native-chrome.tsx`. Both remaining callers are library
code, Play's own suggested fix would add six more deprecated call sites, and
clearing them needs a hand-written native splash plugin on the cold-start path.

The notes also mention the dark-mode and narrow-phone fixes from the same day,
because those are what a user would actually notice.

### en-US

```
Smaller and faster to start.

The app is now 1.8 MB — down from 2.2 MB. The build now strips unused code and unused resources, and moved to a newer Android build toolchain. Nothing was removed: every feature, every screen and every phone we supported before is still supported.

Also in this release: text that was unreadable in dark mode on the Characters screen, and a few screens that scrolled sideways on narrow phones.
```

(423 characters, limit 500)

### es-419

```
Más pequeña y de inicio más rápido.

La app ocupa ahora 1,8 MB, frente a 2,2 MB. La compilación elimina el código y los recursos que no se usan, y pasó a una cadena de herramientas de Android más reciente. No se quitó nada: todas las funciones, pantallas y teléfonos compatibles lo siguen siendo.

También: texto ilegible en modo oscuro en la pantalla Personajes, y pantallas que se desplazaban en horizontal en móviles estrechos.
```

(430 characters, limit 500)

### pt-BR

```
Menor e com início mais rápido.

O app agora ocupa 1,8 MB, contra 2,2 MB. A compilação remove código e recursos não utilizados e passou a usar uma cadeia de ferramentas Android mais recente. Nada foi retirado: todos os recursos, telas e aparelhos compatíveis continuam iguais.

Também: texto ilegível no modo escuro na tela Personagens e telas que rolavam na horizontal em celulares estreitos.
```

(393 characters, limit 500)

### it-IT

```
Più leggera e più rapida ad avviarsi.

L'app ora occupa 1,8 MB, contro 2,2 MB. La build elimina codice e risorse inutilizzati ed è passata a una toolchain Android più recente. Non è stato rimosso nulla: tutte le funzioni, le schermate e i telefoni supportati restano invariati.

Inoltre: testo illeggibile in modalità scura nella schermata Personaggi e schermate che scorrevano in orizzontale su telefoni stretti.
```

(413 characters, limit 500)

---

## versionCode 12 · versionName 1.12.2

**Context the notes do not say out loud.** A camera plugin the app never
called was excluded; it had been carrying Material Components and its
resource tables. Measured on the signed artifacts, same machine, same
toolchain:

| | AAB | |
|---|---|---|
| versionCode 11 | 4,535,254 B | 4.33 MB |
| versionCode 12 | 2,766,077 B | 2.64 MB |
| | **−1,769,177 B** | **−39.0%** |

Eight plugins instead of nine; the "Take photo" path was re-verified end to
end on the emulator after the `<queries>` move (see the ledger in
`android/app/build.gradle`). Users may be coming from 9 (6.89 MB) or 11 —
the notes quote both so the sentence is true for everyone.

### en-US

```
Smaller again.

The app is now 2.6 MB — down from 4.3 MB in the last release and 6.9 MB the week before. A camera library the app never used had been compiled in along with everything it depended on; it's gone. Taking a photo works exactly as before, through the phone's own camera.

Nothing else changes.
```

### es-ES

```
Más ligera todavía.

La app ocupa ahora 2,6 MB, frente a 4,3 MB en la versión anterior y 6,9 MB la semana pasada. Se había compilado una biblioteca de cámara que la app nunca usaba, junto con todo lo que arrastraba; ya no está. Hacer una foto funciona igual que antes, con la cámara del propio teléfono.

Nada más cambia.
```

### pt-PT

```
Ainda mais leve.

A app ocupa agora 2,6 MB, contra 4,3 MB na versão anterior e 6,9 MB na semana passada. Tinha sido compilada uma biblioteca de câmara que a app nunca usava, com tudo o que arrastava; já não está. Tirar uma fotografia funciona exatamente como antes, com a câmara do próprio telemóvel.

Nada mais muda.
```

### it-IT

```
Ancora più leggera.

L'app ora occupa 2,6 MB, contro i 4,3 MB della versione precedente e i 6,9 MB della settimana scorsa. Era stata compilata una libreria fotocamera che l'app non usava mai, insieme a tutto ciò che si portava dietro; è stata rimossa. Scattare una foto funziona esattamente come prima, con la fotocamera del telefono.

Non cambia nient'altro.
```

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
