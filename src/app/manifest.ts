import type { MetadataRoute } from "next";

// The web app manifest — what makes Picacho installable from the browser
// (Add to Home Screen) with its own icon and a standalone, no-browser-chrome
// window. This IS the app-store strategy: full app experience on every
// phone, zero 30% platform cut.
//
// start_url points at /app, not the marketing homepage: someone who
// installed Picacho is a user, not a visitor.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Picacho",
    short_name: "Picacho",
    description: "Your character, the same face in every frame — verified.",
    id: "/app",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f7f6f4",
    theme_color: "#f7f6f4",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
