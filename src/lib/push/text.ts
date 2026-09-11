// The words of a push, resolved for one device — pure and alias-free so
// every message's copy is unit-testable in all four languages (the vitest
// "@/" gotcha, like prefs.ts). send.ts calls it once per device, with the
// locale that device registered with.
import { getMessages } from "../i18n/messages";
import { formatMsg } from "../i18n/format";
import { DEFAULT_LOCALE, isLocale } from "../i18n/locales";
import type { PushMessage } from "./send";

export function resolvePushText(
  message: PushMessage,
  locale: string | null | undefined,
): { title: string; body: string } {
  const t = getMessages(isLocale(locale) ? locale : DEFAULT_LOCALE).push;
  const params = message.params ?? {};
  switch (message.key) {
    case "videoReady":
      return { title: t.videoReadyTitle, body: t.videoReadyBody };
    case "videoFailed":
      return { title: t.videoFailedTitle, body: t.videoFailedBody };
    case "videoFailedRefunded":
      return { title: t.videoFailedTitle, body: t.videoFailedRefundedBody };
    case "layersReady":
      return { title: t.layersReadyTitle, body: formatMsg(t.layersReadyBody, params) };
    case "lowCredits":
      return {
        title: t.lowCreditsTitle,
        body: Number(params.n) === 1 ? t.lowCreditsBodyOne : formatMsg(t.lowCreditsBody, params),
      };
    case "setReady": {
      // The set's own title, which Astra wrote and the strict-lane words
      // gate passed before it was saved (build-tick.ts). A set without one
      // is still ready: the body then says only where to tap.
      const title = typeof params.title === "string" ? params.title.trim() : "";
      return { title: t.setReadyTitle, body: title ? formatMsg(t.setReadyBody, { title }) : t.setReadyBodyUntitled };
    }
    case "setFailed":
      return { title: t.setFailedTitle, body: t.setFailedBody };
  }
}
