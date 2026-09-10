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
      data: { path: data.path || "/app" },
      icon: "/icon-192-maskable.png",
      badge: "/icon-192-maskable.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/app";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ("focus" in win) {
          win.focus();
          if ("navigate" in win) win.navigate(path).catch(() => undefined);
          return;
        }
      }
      return clients.openWindow(path);
    }),
  );
});
