// The Studio and Recast readers' model: the Models page's pick
// (studio_readers), else the reader's own constant. Relative-import files
// call this; the "@/" chain is loaded late so their fake-fetch tests, which
// can't resolve it, read the constant.

export async function studioReaderModel(fallback: string): Promise<string> {
  try {
    return await (await import("@/lib/models/pick")).modelForJob("studio_readers");
  } catch {
    return fallback;
  }
}
