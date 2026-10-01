// What a person agrees to before their own voice is cloned (2026-10-01, the
// voice sheet; operator's pick: cloning "Own voice only"). Shown in their
// language and stored on the voice word for word (voice_presets.consent_text)
// with the time they agreed. Pure: the sheet and the server share it.
export const CLONE_CONSENT: Record<"en" | "es" | "pt" | "it", string> = {
  en: "This recording is my own voice. I agree that Picacho may send it to ElevenLabs to make a digital copy of my voice, which only my characters will use. I can delete the copy at any time, and deleting it removes it from ElevenLabs too.",
  es: "Esta grabación es mi propia voz. Acepto que Picacho la envíe a ElevenLabs para crear una copia digital de mi voz, que solo usarán mis personajes. Puedo borrar la copia cuando quiera, y al borrarla también se elimina de ElevenLabs.",
  pt: "Esta gravação é a minha própria voz. Concordo que o Picacho a envie para a ElevenLabs para criar uma cópia digital da minha voz, que só os meus personagens vão usar. Posso apagar a cópia quando quiser, e apagá-la também a remove da ElevenLabs.",
  it: "Questa registrazione è la mia voce. Accetto che Picacho la invii a ElevenLabs per creare una copia digitale della mia voce, che useranno solo i miei personaggi. Posso eliminare la copia in qualsiasi momento, e così viene eliminata anche da ElevenLabs.",
};

export function cloneConsentFor(locale: unknown): string {
  return CLONE_CONSENT[(typeof locale === "string" && locale in CLONE_CONSENT ? locale : "en") as keyof typeof CLONE_CONSENT];
}
