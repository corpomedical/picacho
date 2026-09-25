The Producer's speech detector (src/components/producer/use-hands-free.ts),
self-hosted so the browser never loads it from a third party. Loaded only when
someone starts a voice conversation.

Files and where they came from (cdn.jsdelivr.net/npm/…, 2026-09-25):

  bundle.min.js                 @ricky0123/vad-web 0.0.31 dist/bundle.min.js     ISC licence
  vad.worklet.bundle.min.js     @ricky0123/vad-web 0.0.31 dist/                  ISC licence
  silero_vad_v5.onnx            @ricky0123/vad-web 0.0.31 dist/ (Silero VAD v5)  MIT licence (snakers4/silero-vad)
  ort.wasm.min.js               onnxruntime-web 1.23.2 dist/                     MIT licence (Microsoft)
  ort-wasm-simd-threaded.mjs    onnxruntime-web 1.23.2 dist/                     MIT licence (Microsoft)
  ort-wasm-simd-threaded.wasm   onnxruntime-web 1.23.2 dist/                     MIT licence (Microsoft)

The WebAssembly needs 'wasm-unsafe-eval' in the page's script-src (middleware.ts).
If any of these fail to load, voice falls back to a loudness-based detector
(voice-engine.ts EnergySegmenter) with the same rules.
