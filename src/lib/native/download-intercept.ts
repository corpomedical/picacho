"use client";

// Every <a download> in the Android app, made to save.
//
// The WebView ignores the download attribute outright: tapping one does
// nothing, no file and no navigation (checked on the emulator, 2026-09-30).
// Many surfaces download that way — Light's result, Recast's take, the
// layer stack, Live's recording, Press Tour's cuts, Helios's film and
// sketch, Aly's documents — some with a real link, some by building one and
// calling a.click(). Rather than rewrite each, the shell routes them all
// through the same save the Download buttons use (lib/native/save-media.ts).
//
// Two doors, because a script's a.click() on a link that was never put in
// the page fires no event anyone can hear:
//   - a capture-phase click listener on the document, for real taps;
//   - HTMLAnchorElement.prototype.click, for scripted clicks, attached or
//     not.
// Only same-origin, blob: and data: links are taken. Anything else keeps
// today's path (the shell hands foreign links to the system browser).

function takes(a: HTMLAnchorElement): boolean {
  if (!a.hasAttribute("download") || !a.href) return false;
  if (a.href.startsWith("blob:") || a.href.startsWith("data:")) return true;
  try {
    return new URL(a.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function nameFor(a: HTMLAnchorElement): string {
  const given = a.getAttribute("download")?.trim();
  if (given) return given;
  try {
    const last = new URL(a.href).pathname.split("/").pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  return "picacho-file";
}

/** Installs both doors; returns the uninstall. `save` does the saving and its own toasts. */
export function installDownloadIntercept(save: (url: string, name: string) => Promise<unknown>): () => void {
  // One save per link at a time — the same guard the Download buttons keep.
  const inFlight = new Set<string>();
  const run = (a: HTMLAnchorElement) => {
    const url = a.href;
    if (inFlight.has(url)) return;
    inFlight.add(url);
    void save(url, nameFor(a))
      .catch(() => {})
      .finally(() => inFlight.delete(url));
  };

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = (e.target as Element | null)?.closest?.("a[download]");
    if (!(a instanceof HTMLAnchorElement) || !takes(a)) return;
    // Not stopPropagation: the link's own onClick (Light records the
    // download there) still runs.
    e.preventDefault();
    run(a);
  };
  document.addEventListener("click", onClick, true);

  const proto = HTMLAnchorElement.prototype;
  const original = proto.click;
  const patched = function (this: HTMLAnchorElement) {
    if (takes(this)) {
      run(this);
      return;
    }
    original.call(this);
  };
  proto.click = patched;

  return () => {
    document.removeEventListener("click", onClick, true);
    if (proto.click === patched) proto.click = original;
  };
}
