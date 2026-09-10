// Web Push service worker for signed-in users (2026-09-11) — the browser
// twin of the native shell's FCM channel. Kept deliberately tiny: show the
// notification, and take a tap to the deep link the server sent.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // An unreadable payload still shows something rather than nothing.
  }
  const title = data.title || "Picacho";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      data: { path: data.path || null },
      icon: "/icon-192-maskable.png",
      badge: "/icon-192-maskable.png",
    }),
  );
});

// A tap goes where the push said, and only then. The composer also shows
// its own "ready" notification through this worker's registration (it has
// no path): that tap must bring the tab forward WITHOUT navigating, or it
// unmounts the very chat the result just arrived in (2026-09-11 review).
// An uncontrolled tab cannot be navigated by the worker, so a tap with a
// path opens that path in a new window rather than silently only focusing.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.path;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => "focus" in w);
      if (!path) {
        if (win) return win.focus();
        return clients.openWindow("/app");
      }
      if (win && "navigate" in win) {
        return win
          .focus()
          .then((w) => (w || win).navigate(path))
          .catch(() => clients.openWindow(path));
      }
      return clients.openWindow(path);
    }),
  );
});
