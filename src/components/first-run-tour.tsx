"use client";

import { useEffect, useState } from "react";
import { OnboardingTour, type TourStep } from "@/components/onboarding-tour";
import { useLocale } from "@/lib/i18n/provider";

// The welcome tour a brand-new account actually sees.
//
// The original walkthrough lives inside GenerateForm — but /app returns an
// early "set up your first character" empty state when the account has no
// characters yet, so GenerateForm (and therefore the entire tour) was never
// rendered for exactly the people it exists for. A new user reached the app
// and got no guidance at all. This is the missing first leg: it runs on that
// empty state, points at the one thing there is to do, and hands off.
//
// Deliberately does NOT flip profiles.has_completed_onboarding: that flag
// belongs to the composer walkthrough, which a new user should still get
// once they have a character and the composer finally renders. Dismissal is
// kept in localStorage so this intro shows once per browser rather than
// nagging on every visit while the account is still empty.
const SEEN_KEY = "picacho.firstRunTour.v1";

export function FirstRunTour() {
  const { t } = useLocale();
  const ob = t.onboarding;
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // localStorage is read in an effect, never during render — the server has
  // no localStorage, and reading it inline would hydrate-mismatch.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== "1") setActive(true);
    } catch {
      // Private mode / storage disabled — showing the intro is the safer
      // failure, so fall through to showing it.
      setActive(true);
    }
  }, []);

  if (!active) return null;

  const steps: TourStep[] = [
    { targetId: null, title: ob.welcomeTitle, body: ob.firstRunWelcomeBody },
    { targetId: "tour-create-character", title: ob.firstRunCreateTitle, body: ob.firstRunCreateBody },
    { targetId: "tour-characters", title: ob.charactersTitle, body: ob.charactersBody },
    { targetId: null, title: ob.firstRunDoneTitle, body: ob.firstRunDoneBody },
  ];

  function finish() {
    setActive(false);
    setStepIndex(0);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Nothing to do — worst case the intro shows again next visit.
    }
  }

  return (
    <OnboardingTour
      steps={steps}
      stepIndex={stepIndex}
      onNext={() => setStepIndex((i) => i + 1)}
      onFinish={finish}
      next={ob.next}
      skip={ob.skip}
      finish={ob.firstRunFinish}
    />
  );
}
