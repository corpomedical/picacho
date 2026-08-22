"use client";

import { useMemo } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";

// The Stripe form itself, mounted in-page (ui_mode: "embedded" — see
// lib/stripe/checkout-core.ts). Card fields stay inside Stripe's iframe, so
// PCI scope stays theirs; the page around it is ours. The publishable key
// arrives as a prop from the server component rather than being read here,
// so the page — not the bundle — decides the configuration.

export function CheckoutEmbed({
  clientSecret,
  publishableKey,
}: {
  clientSecret: string;
  publishableKey: string;
}) {
  // loadStripe must be called exactly once per key for the page's lifetime —
  // recreating it on re-render tears down and re-mounts the iframe mid-typing.
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
