import en, { type Messages } from "./en";
import es from "./es";
import pt from "./pt";
import it from "./it";
import type { Locale } from "@/lib/i18n/locales";

export type { Messages };

const DICTS: Record<Locale, Messages> = { en, es, pt, it };

export function getMessages(locale: Locale): Messages {
  return DICTS[locale] ?? en;
}
