# Google Play listing — Picacho

Store metadata for the Play listing in the app's four supported languages (en, es, it, pt-BR).
Every claim below is taken from the site's own copy in `src/lib/i18n/messages/*.ts`
(`marketing.home`, `marketing.pricing`, `marketing.compare`, `pricingTiers`) — nothing is
invented. The claim → source map at the bottom lets you defend any line at review.

**Play hard limits:** App name ≤ 30 chars · Short description ≤ 80 chars · Full description ≤ 4000 chars.
Counts in the headings below are Unicode character counts, measured programmatically
(newlines included for the full description). Verify anytime with
`python3 scripts/verify-play-listing.py` (or re-count by hand — the fenced blocks are the exact text).

Per Play metadata policy, no competitor names appear anywhere in the listing copy.

---

## English (en-US)

### App name — 28/30

<!-- count:en.name -->
```text
Picacho — AI Character Video
```

### Short description — 71/80

<!-- count:en.short -->
```text
The same face, in every single frame — every render scored to prove it.
```

### Full description — 2372/4000

<!-- count:en.full -->
```text
The same face, in every single frame.

Picacho makes images and videos of your characters — the same person, every single time. Set up a character once, with a photo and a few traits, and from then on you just describe scenes in plain words. One photo is all it takes to anchor a character across images and video.

And your character acts, not just presents: action shots, multi-angle takes, scenes with other characters, spoken dialogue with lip-sync — all locked to the same look.

THE PROOF
Most tools hope the face carries over. Picacho checks. A vision model compares every result against your character's identity photo and prints the match score under the image — so you see the number before your audience does.

THE PIPELINE
Every generation runs the full pipeline: one AI model drafts your prompt, a second reviews it against your character's rulebook, then the result is generated and validated before it reaches you. Failed attempts retry automatically — and failed generations never use your credits.

BRAND RULES
Give your character a rulebook — what it must always, or must never, appear with — and every prompt is drafted and reviewed against it before anything is generated. Your mascot stays on-brand everywhere it shows up.

DIALOGUE AND MULTI-ANGLE
Type what your character says, pick a voice, and the lips are synced to it. Multi-angle renders the same scene from several camera angles at once — same scene, same character, different cameras.

A FREE GENERATION EVERY DAY
Every account gets one free generation a day on our fastest model — no credit card required. It resets daily and doesn't stack, so over a few days you'll see the same character stay consistent across outputs.

SIMPLE, CREDIT-BASED PLANS
Paid plans start at $9/month (Basic, 12 credits). A standard video or image costs one credit; premium models cost a few — the exact cost is always shown before you confirm. No watermarks on any plan, free trial included. Cancel anytime — you keep full access until the end of the period you've paid for.

GOOD TO KNOW
• Picacho requires an internet connection — generation runs in the cloud.
• An account is required. Paid plans are optional monthly or annual subscriptions, managed and cancellable from your account settings.
• Picacho is AI and can make mistakes — every result shows its pipeline log, so you can see exactly what happened.
```

---

## Español (es-ES)

### App name — 30/30

<!-- count:es.name -->
```text
Picacho: personaje IA en vídeo
```

### Short description — 75/80

<!-- count:es.short -->
```text
La misma cara en cada fotograma — cada resultado puntuado para demostrarlo.
```

### Full description — 2612/4000

<!-- count:es.full -->
```text
La misma cara, en cada fotograma.

Picacho crea imágenes y vídeos de tus personajes — la misma persona, siempre. Configura tu personaje una vez, con una foto y unos pocos rasgos, y a partir de ahí solo describes escenas en lenguaje sencillo. Una foto es todo lo que hace falta para anclar un personaje en imágenes y vídeo.

Y tu personaje actúa, no solo presenta: tomas de acción, planos multiángulo, escenas con otros personajes y diálogo hablado con sincronización labial — todo fiel al mismo aspecto.

LA PRUEBA
La mayoría de herramientas esperan que la cara se mantenga. Picacho lo comprueba: un modelo de visión compara cada resultado con la foto de identidad de tu personaje e imprime la puntuación de coincidencia bajo la imagen — para que tú veas el número antes que tu audiencia.

EL PIPELINE
Cada generación recorre el pipeline completo: un modelo de IA redacta tu prompt, un segundo lo revisa contra el reglamento de tu personaje, y el resultado se genera y se valida antes de llegar a ti. Los intentos fallidos se reintentan automáticamente — y las generaciones fallidas nunca consumen tus créditos.

REGLAS DE MARCA
Dale a tu personaje un reglamento — con qué debe, o no debe, aparecer — y cada prompt se redacta y se revisa contra él antes de generar nada. Tu mascota se mantiene fiel a la marca allí donde aparezca.

DIÁLOGO Y MULTIÁNGULO
Escribe lo que dice tu personaje, elige una voz, y los labios se sincronizan con ella. El modo multiángulo genera la misma escena desde varios ángulos de cámara a la vez — misma escena, mismo personaje, distintas cámaras.

UNA GENERACIÓN GRATIS CADA DÍA
Cada cuenta recibe una generación gratis al día en nuestro modelo más rápido — sin tarjeta de crédito. Se renueva cada día y no se acumula, así que en unos días verás al mismo personaje mantenerse consistente en varios resultados.

PLANES SIMPLES, BASADOS EN CRÉDITOS
Los planes de pago empiezan en $9/mes (Basic, 12 créditos). Un vídeo o imagen estándar cuesta un crédito; los modelos premium cuestan algunos más — el coste exacto se muestra siempre antes de confirmar. Sin marcas de agua en ningún plan, prueba gratuita incluida. Cancela cuando quieras — mantienes el acceso completo hasta el final del período pagado.

A TENER EN CUENTA
• Picacho necesita conexión a internet — la generación se ejecuta en la nube.
• Se requiere una cuenta. Los planes de pago son suscripciones opcionales, mensuales o anuales, que puedes gestionar y cancelar en los ajustes de tu cuenta.
• Picacho es IA y puede cometer errores — cada resultado muestra su registro del pipeline, para que veas exactamente qué ocurrió.
```

---

## Italiano (it-IT)

### App name — 28/30

<!-- count:it.name -->
```text
Picacho: video personaggi IA
```

### Short description — 69/80

<!-- count:it.short -->
```text
La stessa faccia in ogni fotogramma — e un punteggio che lo dimostra.
```

### Full description — 2723/4000

<!-- count:it.full -->
```text
La stessa faccia, in ogni singolo fotogramma.

Picacho crea immagini e video dei tuoi personaggi — la stessa persona, ogni volta. Configura il tuo personaggio una volta, con una foto e qualche tratto, e da lì in poi descrivi le scene in linguaggio semplice. Una foto è tutto ciò che serve per ancorare un personaggio su immagini e video.

E il tuo personaggio recita, non si limita a presentare: riprese d'azione, inquadrature multi-angolo, scene con altri personaggi e dialoghi con sincronizzazione labiale — tutto fedele allo stesso aspetto.

LA PROVA
La maggior parte degli strumenti spera che il volto si mantenga. Picacho verifica: un modello di visione confronta ogni risultato con la foto identità del personaggio e stampa il punteggio di somiglianza sotto l'immagine — così vedi il numero prima del tuo pubblico.

LA PIPELINE
Ogni generazione percorre la pipeline completa: un modello IA scrive la bozza del prompt, un secondo la rivede confrontandola con il regolamento del personaggio, poi il risultato viene generato e validato prima di arrivare a te. I tentativi falliti vengono ripetuti automaticamente — e le generazioni fallite non consumano mai i tuoi crediti.

REGOLE DI BRAND
Dai al tuo personaggio un regolamento — con cosa deve, o non deve, apparire — e ogni prompt viene scritto e revisionato rispetto a esso prima di generare qualsiasi cosa. La tua mascotte resta fedele al brand ovunque compaia.

DIALOGHI E MULTI-ANGOLAZIONE
Scrivi cosa dice il tuo personaggio, scegli una voce, e le labbra si sincronizzano. La modalità multi-angolazione genera la stessa scena da più angolazioni di ripresa contemporaneamente — stessa scena, stesso personaggio, inquadrature diverse.

UNA GENERAZIONE GRATUITA OGNI GIORNO
Ogni account riceve una generazione gratuita al giorno sul nostro modello più veloce — senza carta di credito. Si rinnova ogni giorno e non si accumula, quindi in pochi giorni vedrai lo stesso personaggio restare coerente in più risultati.

PIANI SEMPLICI, A CREDITI
I piani a pagamento partono da $9/mese (Basic, 12 crediti). Un video o un'immagine standard costa un credito; i modelli premium ne costano qualcuno in più — il costo esatto è sempre mostrato prima della conferma. Nessun watermark su nessun piano, prova gratuita inclusa. Disdici quando vuoi — mantieni l'accesso completo fino alla fine del periodo pagato.

DA SAPERE
• Picacho richiede una connessione a internet — la generazione avviene nel cloud.
• Serve un account. I piani a pagamento sono abbonamenti facoltativi, mensili o annuali, gestibili e disdicibili dalle impostazioni del tuo account.
• Picacho è un'IA e può commettere errori — ogni risultato mostra il log della pipeline, così vedi esattamente cosa è successo.
```

---

## Português (pt-BR)

### App name — 28/30

<!-- count:pt.name -->
```text
Picacho: vídeo personagem IA
```

### Short description — 67/80

<!-- count:pt.short -->
```text
O mesmo rosto em cada quadro — cada resultado pontuado para provar.
```

### Full description — 2554/4000

<!-- count:pt.full -->
```text
O mesmo rosto, em cada quadro.

O Picacho cria imagens e vídeos dos seus personagens — a mesma pessoa, todas as vezes. Configure seu personagem uma vez, com uma foto e algumas características, e daí em diante é só descrever cenas em linguagem simples. Uma foto é tudo o que é preciso para ancorar um personagem em imagens e vídeo.

E o seu personagem atua, não só apresenta: cenas de ação, tomadas multi-ângulo, cenas com outros personagens e diálogo falado com sincronização labial — tudo fiel ao mesmo visual.

A PROVA
A maioria das ferramentas torce para o rosto se manter. O Picacho confere: um modelo de visão compara cada resultado com a foto de identidade do personagem e imprime a pontuação de correspondência sob a imagem — para você ver o número antes do seu público.

O PIPELINE
Cada geração percorre o pipeline completo: um modelo de IA redige seu prompt, um segundo o revisa contra o regulamento do seu personagem, e o resultado é gerado e validado antes de chegar até você. Tentativas com falha são refeitas automaticamente — e gerações com falha nunca consomem seus créditos.

REGRAS DE MARCA
Dê ao seu personagem um regulamento — com o que ele deve, ou nunca deve, aparecer — e cada prompt é redigido e revisado contra ele antes de qualquer geração. Seu mascote continua fiel à marca onde quer que apareça.

DIÁLOGO E MULTI-ÂNGULO
Escreva o que seu personagem diz, escolha uma voz, e os lábios são sincronizados com ela. O modo multi-ângulo gera a mesma cena de vários ângulos de câmera ao mesmo tempo — mesma cena, mesmo personagem, câmeras diferentes.

UMA GERAÇÃO GRÁTIS POR DIA
Toda conta recebe uma geração grátis por dia no nosso modelo mais rápido — sem cartão de crédito. Ela se renova a cada dia e não acumula, então em poucos dias você verá o mesmo personagem se manter consistente em vários resultados.

PLANOS SIMPLES, BASEADOS EM CRÉDITOS
Os planos pagos começam em $9/mês (Basic, 12 créditos). Um vídeo ou imagem padrão custa um crédito; modelos premium custam alguns a mais — o custo exato é sempre mostrado antes de confirmar. Sem marca d'água em nenhum plano, incluindo o teste grátis. Cancele quando quiser — você mantém o acesso completo até o fim do período pago.

BOM SABER
• O Picacho precisa de conexão com a internet — a geração roda na nuvem.
• É necessária uma conta. Os planos pagos são assinaturas opcionais, mensais ou anuais, que você gerencia e cancela nas configurações da sua conta.
• O Picacho é IA e pode cometer erros — cada resultado mostra o log do pipeline, para você ver exatamente o que aconteceu.
```

---

## Claim → source map

Every marketing claim in the listing copy above maps to the site's own published copy.
Keys are in `src/lib/i18n/messages/en.ts` (each locale file carries the same keys with its
own translation, so the es/it/pt listings map to the same keys in their own file).

| Listing claim | Source key(s) |
|---|---|
| "The same face, in every single frame." | `marketing.home.heroTitle` + `heroAccent` |
| One photo anchors a character across images and video | `marketing.home.stat3` + `stat3Caption` |
| Acts, not just presents: action shots, multi-angle takes, multi-character scenes, lip-synced dialogue, same look | `marketing.compare.picFormat`, `marketing.home.diffFormatsDetail`, `marketing.compare.heygen.choosePicacho[0]` |
| Vision model scores every result against the identity photo; number shown before your audience sees it | `marketing.home.scoreBandTitle/scoreBandBody`, `heroSubtitle`, `marketing.compare.picScoring` |
| Two AI models: one drafts, a second reviews against the character's rulebook | `marketing.home.diffModelsTitle/diffModelsDetail` |
| Full pipeline: draft → review → generate → validate | `marketing.pricing.subtitle`, `marketing.home.step1–step4` |
| Failed attempts retry automatically | `marketing.home.stat2Caption`, `step4Detail` |
| Failed generations never use your credits | `pricingTiers.*.features`, `marketing.pricing.faq[1]`, `marketing.compare.picFailures` |
| Brand rules: every prompt drafted and reviewed against the rulebook before generation | `marketing.home.diffRulesTitle/diffRulesDetail`, `generate.promptLevelNote` — prompt-level checks (nothing generated, nothing charged when a rule blocks; deliberately NOT an output gate, per the 2026-08-20 economics decision). Requires the `brand_rules_enforcement` flag ON (Admin → Feature flags) — flip it before submitting for review, or rules aren't applied at all (`brandRules.pausedNotice`) |
| Dialogue: type the line, pick a voice, lips synced | `character.dialogueVoiceSubtitle`, `generate.dialogueCreditNote` |
| Multi-angle: same scene, several camera angles at once | `onboarding.multiAngleBody`, `marketing.home.diffFormatsDetail` — paid-plan feature per `generate.multiAngleLocked`; the listing describes it without claiming it's free. (Heads-up: `tutorial.s5p3` says "Studio plan" while `generate.multiAngleLocked` says "any paid plan" — reconcile before review.) |
| A free generation every day, fastest model, no credit card, resets daily, doesn't stack | `marketing.home.heroFreeTrialNote`, `marketing.pricing.faq[2]` |
| Paid plans from $9/month (Basic, 12 credits) | `marketing.compare.picEntry`, `pricingTiers.basic.features` (EU visitors billed the same numbers in euros, per `picEntry`) |
| Standard video/image = 1 credit; premium costs more; exact cost shown before you confirm | `marketing.pricing.subtitle`, `marketing.pricing.faq[0]`, `marketing.compare.picCost` |
| No watermarks on any plan, free trial included | `marketing.compare.picWatermark` |
| Cancel anytime; keep access until end of paid period | `marketing.pricing.faq[4]` |
| "Picacho is AI and can make mistakes" | `common.aiDisclaimer` (exact string reused in each locale) |
| Every result shows its pipeline log | `history.pipelineLog`, `tutorial.s7p3` |
| Requires an internet connection / account required / optional subscriptions | Not marketing claims — honesty lines Play expects; generation runs server-side (cloud providers), auth is required for the app shell, and plans are Stripe subscriptions managed in Settings → Usage & plan. |

---

## Screenshot shot-list (phone, portrait)

**Play constraints (all screenshots):** JPEG or 24-bit PNG, no alpha; each side 320–3840 px;
the longer side must be no more than 2× the shorter side — so a raw modern phone capture
(e.g. 1080×2400) will be REJECTED. Crop or letterbox each shot to **1080×1920 (9:16)** or
higher (e.g. 1440×2560); 9:16 portrait at 1080×1920+ is also what Play wants to feature the
listing. Max 8 MB each; minimum 2, maximum 8 per device type. Take them in the redesigned
Atelier app (paper/ink theme), light mode, clean status bar (full battery, no notification
icons — enable Do Not Disturb first).

1. **Dashboard with credits meter** — the "Hey {name}" greeting, the characters row, and the
   "Credits this month" meter clearly readable.
   Blur/avoid: your account email anywhere in view; hide the **Admin** nav item (regular
   users never see it — shoot from the demo account instead of your admin account and it
   disappears on its own). Avoid any real-customer content in "Recent creations".

2. **Composer with a prompt typed** — a plain-language prompt in the composer with the model
   pill and credit-cost pill visible (e.g. the site's own demo line: "Nova in a red jacket,
   walking through Tokyo at night, cinematic lighting").
   Blur/avoid: personal prompts in the recent/saved lists; keep the insufficient-credits
   banner out of frame (top up the demo account first).

3. **A finished render with its identity-score chip** — one strong render with the
   "Identity match: NN%" chip readable; pick a high scorer (90%+) so the screenshot matches
   the proof story.
   Blur/avoid: only use renders of your own demo character — never a character anchored to a
   real person's photo you don't have rights to show in advertising.

4. **History with the pipeline log** — an opened generation showing Drafted → Reviewed →
   Generating → Validated, ideally one that passed on a retry so the "failed attempts didn't
   use your allowance" line is visible.
   Blur/avoid: other rows in the History list — crop tight or make sure every visible row is
   demo content.

5. **Gallery grid of a character** — the Images grid filtered to one character: the same face
   across many scenes in one screen. This is the "same face, every frame" money shot.
   Blur/avoid: nothing extra, just ensure every tile is the demo character.

6. **Character page with reference photos** — the character's identity photo, the reference
   gallery, and the fixed traits (hair / outfit / personality) visible.
   Blur/avoid: reference photos must be images you own outright (the demo character's own
   generated photos are safest); avoid any uploaded photo of a real person.

Since it's your own admin account, there's little customer data at risk — the two real
hazards are the **Admin** nav item appearing in shots and your own **email address** in
Settings/menus. Shooting everything from the demo account below solves both.

**Demo account for Play review (do this before submitting):** Play requires working login
credentials for any login-gated app (App content → App access in Play Console). Create a
dedicated `reviewer@` demo login (e.g. reviewer+play@yourdomain) on a paid-equivalent plan,
NOT an admin role, and pre-populate it before submission: one character with reference
photos and traits set, a dozen finished generations in History (include one multi-angle set,
one with spoken dialogue, and one that passed on attempt 2 so the retry story is visible),
plus enough credits that the reviewer can generate freely. Keep the daily free generation
available, don't rotate the password, and use this same account to take the six screenshots
above.
