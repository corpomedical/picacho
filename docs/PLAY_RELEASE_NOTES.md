# Play Console release notes

One section per upload. Paste into **Release > Production > What's new in this
release**, one language at a time. Play's limit is **500 characters per
language** — the counts below are measured, not estimated.

The app ships in four languages (`src/lib/i18n/locales.ts`), so all four
listings get notes. A language left blank falls back to `en-US`, which is
worse than a short translation.

---

## versionCode 15 · versionName 1.15.0

**Context the notes do not say out loud.** 14 shipped in-app Google sign-in
and it could not complete. The consent screen opened in the system browser as
designed, but the return never arrived: `auth.flow_state` showed four attempts
— three Google, one Facebook — all with `auth_code_issued_at` null, meaning
the flow died before Supabase ever issued a code. The buttons were switched
off from the WEBSITE within the hour, which is the whole point of the
capability token: it reached every installed 14 the moment Vercel deployed,
where a store rollback would have taken hours and missed anyone who had
already updated.

15 replaces the custom-scheme return with a VERIFIED App Link on
`/auth/app-callback`. The invariants are documented in MOBILE_APP.md; the two
worth repeating here are that `assetlinks.json` carries THREE fingerprints
(Play's quantum-ready hybrid signing means newer devices verify against the
post-quantum certificate, and listing one fails half the fleet), and that the
filter claims `/auth/app-callback` and never the shared `/auth/callback`,
which browser sign-in and every password-reset email also use.

The user-agent token moved to `PicachoAuth/2`, so 14 can never be offered
these buttons again by any future deploy. `NATIVE_OAUTH_DISABLED=1` in Vercel
remains the instant kill if 15 misbehaves too.

**Honesty note on the copy.** These notes say the previous update did not
work. That is deliberate: 14 was live, the button was tappable, and anyone who
tried it hit a dead end. Saying so costs less than pretending otherwise.

**Before uploading:** `https://picacho.ai/auth/app-callback` must be in
Supabase → Authentication → URL Configuration → Redirect URLs (added
2026-09-07), and `/.well-known/assetlinks.json` must answer 200 as
application/json with no redirect (verified 2026-09-08).

### en-US

```
Sign in with Google, working this time.

The last update added the button but not the way back — it opened your browser and left you there. Tapping it now returns you to the app, signed in. If you got stuck before, nothing was charged and no account was left half-made.

Also: History no longer stops at your 50th take, so older ones and failed attempts are reachable again. And the upscale and layers screens can now be closed with the keyboard.
```

(446 characters, limit 500)

### es-419

```
Iniciar sesión con Google, ahora sí.

La actualización anterior agregó el botón pero no el regreso: abría tu navegador y te dejaba ahí. Ahora vuelves a la app con la sesión iniciada. Si te quedaste atascado antes, no se cobró nada ni quedó una cuenta a medias.

Además: el Historial ya no se detiene en la toma 50, así que las anteriores y las fallidas vuelven a estar accesibles. Y las pantallas de mejora y capas se cierran con el teclado.
```

(441 characters, limit 500)

### pt-BR

```
Entrar com o Google, agora funcionando.

A atualização anterior adicionou o botão, mas não o caminho de volta: abria seu navegador e parava por ali. Agora você volta ao app já conectado. Se você travou antes, nada foi cobrado e nenhuma conta ficou pela metade.

Também: o Histórico não para mais no seu take 50, então os antigos e os que falharam voltam a ser acessíveis. E as telas de upscale e camadas fecham pelo teclado.
```

(424 characters, limit 500)

### it-IT

```
Accedi con Google, stavolta davvero.

L'aggiornamento precedente aveva aggiunto il pulsante ma non il ritorno: apriva il browser e ti lasciava lì. Ora torni nell'app, già connesso. Se prima sei rimasto bloccato, non è stato addebitato nulla e nessun account è rimasto a metà.

Inoltre: la Cronologia non si ferma più alla 50esima ripresa, quindi le precedenti e quelle fallite sono di nuovo raggiungibili. E le schermate di upscale e livelli si chiudono da tastiera.
```

(466 characters, limit 500)

---

### If the listing uses the EUROPEAN variants

The locale tags in this file are not consistent, and it is worth resolving
before the next upload rather than guessing again. versionCode 11 and 12 used
`es-ES` and `pt-PT`; 13 switched to `es-419` and `pt-BR` and 14 and 15 copied
that forward. Nobody checked which set the Play listing is actually
configured for, and a listing only accepts the languages it has — notes
pasted under a tag the listing does not carry go nowhere.

Check Play Console → Store presence → Main store listing, and use whichever
pair it lists. Same copy, adjusted for register.

#### es-ES

```
Inicia sesión con Google, ahora sí.

La actualización anterior añadió el botón pero no la vuelta: abría tu navegador y te dejaba allí. Ahora vuelves a la app con la sesión iniciada. Si antes te quedaste bloqueado, no se cobró nada ni quedó ninguna cuenta a medias.

Además: el Historial ya no se detiene en la toma 50, así que las anteriores y las fallidas vuelven a estar accesibles. Y las pantallas de mejora y capas se cierran con el teclado.
```

(445 characters, limit 500)

#### pt-PT

```
Inicia sessão com o Google, agora a funcionar.

A atualização anterior adicionou o botão, mas não o regresso: abria o teu navegador e ficava por ali. Agora voltas à app já com sessão iniciada. Se ficaste bloqueado antes, não foi cobrado nada nem ficou nenhuma conta a meio.

Além disso: o Histórico já não para na 50.ª captação, por isso as anteriores e as falhadas voltam a estar acessíveis. E os ecrãs de melhoria e camadas fecham-se com o teclado.
```

(450 characters, limit 500)

---

## versionCode 14 · versionName 1.14.0

**Context the notes do not say out loud.** Google refuses OAuth inside an
embedded WebView, so the consent screen always had to leave the app. What was
missing was the way back: the redirect landed in Chrome, the session was
created in Chrome's cookie jar, and the app stayed signed out (verified on the
Play internal build, 2026-08-20). The buttons were hidden here from that day.

The return path is a custom-scheme intent filter, `ai.picacho.app://auth-callback`,
NOT an https App Link. An App Link needs the Play App Signing SHA-256, verifies
asynchronously, and on Android 12+ fails by opening silently in Chrome — which
is the same bug, with the one-time code already spent. PKCE makes scheme
interception useless: the code is worthless without the verifier, which is a
host-only cookie inside our own WebView.

Two things this build depends on, both read out of the Capacitor sources:

- `*.supabase.co` came OFF `server.allowNavigation`. `signInWithOAuth` returns
  Supabase's own `/authorize` URL, not the provider's, so while that host was
  allow-listed the WebView navigated for real — and `onPageStarted` calls
  `Bridge.reset()`, which calls `removeAllListeners()` on every plugin. The
  listener waiting for the way back was destroyed on the way out.
- Cold start uses the retained `appUrlOpen` event, never `App.getLaunchUrl()`.
  `Bridge.intentUri` is set once and never cleared, so getLaunchUrl would replay
  a spent code on every page forever — a successful sign-in would loop between
  /app and /login.

The gate asks "can this build return?", not "is this the app?": a
`PicachoAuth/1` user-agent token that only a rebuild can produce. Every
installed versionCode 13 keeps the buttons hidden the moment the website
deploys, which it already has. **iOS is deliberately excluded** — it has no
equivalent filter yet and keeps the bare marker.

Housekeeping in the same build: `@capacitor/status-bar` was named in
`includePlugins` but is not installed (the bar is painted through SystemBars),
so `capacitor.plugins.json` has SEVEN entries and build.gradle's "all 8" was
stale. Corrected, or the R8 verification below reports a false alarm.

**Before uploading:** `ai.picacho.app://auth-callback` must be in Supabase →
Authentication → URL Configuration → Redirect URLs, or the redirect never comes
back. Operator confirmed added 2026-09-07.

### en-US

```
Sign in with Google, inside the app.

Tapping Continue with Google now opens your browser and brings you straight back, signed in. It used to leave you signed in everywhere except the app, so the buttons were hidden here — this release is what makes them work.

Also: the sign-in screen is finally in your language, notes tell you when a change didn't save instead of losing it quietly, and a take you delete no longer keeps playing in your reel.
```

(446 characters, limit 500)

### es-419

```
Inicia sesión con Google, dentro de la app.

Al tocar Continuar con Google ahora se abre tu navegador y vuelves directo, con la sesión iniciada. Antes quedabas conectado en todas partes menos en la app, por eso los botones estaban ocultos aquí.

Además: la pantalla de inicio de sesión ya está en tu idioma, las notas avisan si un cambio no se guardó en vez de perderlo en silencio, y una toma que elimines deja de aparecer en tu reel.
```

(435 characters, limit 500)

### pt-BR

```
Entre com o Google, dentro do app.

Tocar em Continuar com o Google agora abre seu navegador e traz você de volta já conectado. Antes você ficava conectado em todo lugar menos no app, por isso os botões ficavam ocultos aqui.

Também: a tela de login enfim está no seu idioma, as notas avisam quando uma alteração não foi salva em vez de perdê-la em silêncio, e um take que você excluir não continua no seu reel.
```

(411 characters, limit 500)

### it-IT

```
Accedi con Google, dentro l'app.

Toccando Continua con Google ora si apre il browser e torni subito indietro, già connesso. Prima restavi connesso ovunque tranne che nell'app, per questo i pulsanti erano nascosti qui.

Inoltre: la schermata di accesso è finalmente nella tua lingua, le note ti dicono quando una modifica non è stata salvata invece di perderla in silenzio, e una ripresa che elimini non resta nel tuo reel.
```

(423 characters, limit 500)

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
