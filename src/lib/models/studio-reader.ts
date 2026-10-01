// The Studio and Recast readers' model: the Models page's pick
// (studio_readers), else the reader's own constant. SERVER ONLY: the server
// actions call this and hand the answer to the reader (opts.model). The
// readers themselves (recast-read, recce-read, shot-words, rig-check,
// look-people) are also loaded in the browser, and the pick reads the
// database (next/headers), so a reader importing this broke every build
// from 1ce100f to 64964b2 (Turbopack: "importing a module that depends on
// next/headers").

export async function studioReaderModel(fallback: string): Promise<string> {
  try {
    return await (await import("@/lib/models/pick")).modelForJob("studio_readers");
  } catch {
    return fallback;
  }
}
