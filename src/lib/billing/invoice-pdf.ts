import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { InvoiceDoc } from "./invoice-document";

// The invoice PDF, look I "Ledger" (operator's pick on the Settings &
// Invoices canvas, 2026-09-19). Places what invoice-document.ts wrote; it
// decides nothing about money or words.
//
// Measurements are the canvas board's, converted from CSS px at 96 dpi to
// PDF points (× 0.75): 56/60 px margins → 42/45 pt, the 38 px title → 28.5 pt,
// 13.5 px body → 10.1 pt, 12 px labels → 9 pt. The page is white, not the
// board's #fbfaf7: an invoice gets printed and filed.
//
// The top-right corner is left empty on purpose. From 1 January 2027 the
// tax agency's VERI*FACTU QR code (30–40 mm) belongs at the top of every
// invoice (Orden HAC/1177/2024); that corner is where it goes.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M_X = 45;
const M_TOP = 42;
const M_BOTTOM = 33;
const CONTENT_W = PAGE_W - M_X * 2;

const INK = rgb(0x1d / 255, 0x1b / 255, 0x18 / 255);
const MUTED = rgb(0x5f / 255, 0x58 / 255, 0x50 / 255);
const RULE = rgb(0xd6 / 255, 0xd0 / 255, 0xc6 / 255);

const BODY = 10.1;
const BODY_LEADING = 14.7;
const LABEL = 9;
const LABEL_SPACING = 0.72; // 0.08em of 9 pt
const NUMBER = 11.25;

type Fonts = {
  marquee: PDFFont;
  body: PDFFont;
  bodyStrong: PDFFont;
  mono: PDFFont;
  numeral: PDFFont;
  numeralStrong: PDFFont;
  numeralTotal: PDFFont;
};

// Read once per server instance. The files ship with the invoice route only
// (next.config.ts outputFileTracingIncludes).
const FONT_DIR = path.join(process.cwd(), "src/lib/billing/fonts");
const LOGO_PATH = path.join(process.cwd(), "public/logo.png");
let assets: Promise<{ fonts: Record<keyof Fonts, Uint8Array>; logo: Uint8Array }> | null = null;

function loadAssets() {
  assets ??= (async () => {
    const read = (name: string) => readFile(path.join(FONT_DIR, name));
    const [marquee, body, bodyStrong, mono, numeral, numeralTotal, numeralStrong, logo] = await Promise.all([
      read("Archivo-ExpandedExtraBold.ttf"),
      read("Archivo-Regular.ttf"),
      read("Archivo-SemiBold.ttf"),
      read("DMMono-Regular.ttf"),
      read("Newsreader-Regular.ttf"),
      read("Newsreader-Medium.ttf"),
      read("Newsreader-SemiBold.ttf"),
      readFile(LOGO_PATH),
    ]);
    return { fonts: { marquee, body, bodyStrong, mono, numeral, numeralTotal, numeralStrong }, logo };
  })().catch((err) => {
    // A failed read must not stick: the next request tries again.
    assets = null;
    throw err;
  });
  return assets;
}

/** Break text into lines no wider than maxWidth. A word longer than the line is cut. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let piece = word;
      while (font.widthOfTextAtSize(piece, size) > maxWidth && piece.length > 1) {
        let cut = piece.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(piece.slice(0, cut), size) > maxWidth) cut--;
        out.push(piece.slice(0, cut));
        piece = piece.slice(cut);
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  constructor(
    private pdf: PDFDocument,
    readonly f: Fonts,
  ) {}

  addPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
  }

  /** Draws text with its TOP at yTop (points from the top edge); returns its width. */
  text(
    str: string,
    x: number,
    yTop: number,
    font: PDFFont,
    size: number,
    color = INK,
    spacing = 0,
    page = this.page,
  ): number {
    const ascent = font.heightAtSize(size, { descender: false });
    if (spacing) page.pushOperators(setCharacterSpacing(spacing));
    page.drawText(str, { x, y: PAGE_H - yTop - ascent, font, size, color });
    if (spacing) page.pushOperators(setCharacterSpacing(0));
    return this.width(str, font, size, spacing);
  }

  /** Draws text sitting ON a baseline `baseline` points below the top edge. */
  onBaseline(str: string, x: number, baseline: number, font: PDFFont, size: number, color = INK) {
    this.page.drawText(str, { x, y: PAGE_H - baseline, font, size, color });
  }

  rightOnBaseline(str: string, rightX: number, baseline: number, font: PDFFont, size: number, color = INK) {
    this.onBaseline(str, rightX - font.widthOfTextAtSize(str, size), baseline, font, size, color);
  }

  width(str: string, font: PDFFont, size: number, spacing = 0) {
    return font.widthOfTextAtSize(str, size) + spacing * Math.max(0, str.length - 1);
  }

  right(str: string, rightX: number, yTop: number, font: PDFFont, size: number, color = INK, spacing = 0) {
    this.text(str, rightX - this.width(str, font, size, spacing), yTop, font, size, color, spacing);
  }

  label(str: string, x: number, yTop: number, color = MUTED) {
    return this.text(str.toUpperCase(), x, yTop, this.f.mono, LABEL, color, LABEL_SPACING);
  }

  labelRight(str: string, rightX: number, yTop: number) {
    this.right(str.toUpperCase(), rightX, yTop, this.f.mono, LABEL, MUTED, LABEL_SPACING);
  }

  rule(yTop: number, thickness: number, color = RULE, x1 = M_X, x2 = M_X + CONTENT_W) {
    this.page.drawLine({
      start: { x: x1, y: PAGE_H - yTop },
      end: { x: x2, y: PAGE_H - yTop },
      thickness,
      color,
    });
  }
}

export async function renderInvoicePdf(doc: InvoiceDoc): Promise<Uint8Array> {
  const { fonts: bytes, logo } = await loadAssets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`${doc.title} ${doc.numberLine}`);
  pdf.setAuthor("Picacho");
  pdf.setCreator("Picacho");
  pdf.setProducer("Picacho");

  const embed = (b: Uint8Array) => pdf.embedFont(b, { subset: true });
  const f: Fonts = {
    marquee: await embed(bytes.marquee),
    body: await embed(bytes.body),
    bodyStrong: await embed(bytes.bodyStrong),
    mono: await embed(bytes.mono),
    numeral: await embed(bytes.numeral),
    numeralStrong: await embed(bytes.numeralStrong),
    numeralTotal: await embed(bytes.numeralTotal),
  };
  const logoImage: PDFImage = await pdf.embedPng(logo);
  const w = new Writer(pdf, f);

  // The footer's top edge; nothing but the footer goes below it.
  const footerLines = wrap(doc.footer, f.body, LABEL, CONTENT_W - 60);
  const footerTop = PAGE_H - M_BOTTOM - footerLines.length * 12 - 12;

  // Columns of the lines table, right edges from the right margin. Each is
  // at least as wide as its own label: "PRECIO UNITARIO" is wider than
  // "UNIT PRICE", and a label must never run into its neighbour.
  const labelW = (str: string) => w.width(str.toUpperCase(), f.mono, LABEL, LABEL_SPACING);
  const gap = 14;
  const amountW = Math.max(82.5, labelW(doc.columns.amount));
  const unitW = Math.max(82.5, labelW(doc.columns.unitPrice));
  const qtyW = Math.max(42, labelW(doc.columns.quantity));
  const amountRight = M_X + CONTENT_W;
  const unitRight = amountRight - amountW - gap;
  const qtyRight = unitRight - unitW - gap;
  const descWidth = qtyRight - qtyW - gap - M_X;

  const logoH = 22.5;
  const logoW = (logoImage.width / logoImage.height) * logoH;

  const drawTableHeader = (y: number) => {
    w.label(doc.columns.description, M_X, y);
    w.labelRight(doc.columns.quantity, qtyRight, y);
    w.labelRight(doc.columns.unitPrice, unitRight, y);
    w.labelRight(doc.columns.amount, amountRight, y);
    const ruleY = y + LABEL + 6;
    w.rule(ruleY, 1.1, INK);
    return ruleY;
  };

  // A page after the first carries a short masthead: whose, which invoice.
  const continuationPage = () => {
    w.addPage();
    w.page.drawImage(logoImage, { x: M_X, y: PAGE_H - M_TOP - logoH * 0.8, width: logoW * 0.8, height: logoH * 0.8 });
    w.right(doc.numberLine, M_X + CONTENT_W, M_TOP + 4, f.mono, 9.4, MUTED);
    return M_TOP + logoH * 0.8 + 24;
  };

  // ── Page one: masthead ────────────────────────────────────────────────
  w.addPage();
  let y = M_TOP;
  w.page.drawImage(logoImage, { x: M_X, y: PAGE_H - y - logoH, width: logoW, height: logoH });
  y += logoH + 16.5;
  w.text(doc.title.toUpperCase(), M_X, y, f.marquee, 28.5, INK, 0.14);
  y += 28.5 * 1.0 + 3;
  w.text(doc.numberLine, M_X, y, f.mono, 9.4, MUTED, 0.38);
  y += 9.4 + 19.5;
  w.rule(y, 1.1, INK);
  y += 16.5;

  // ── Who and when: three columns ───────────────────────────────────────
  const colGap = 21;
  const colW = (CONTENT_W - colGap * 2) / 3;
  const colX = [M_X, M_X + colW + colGap, M_X + (colW + colGap) * 2];
  let bottom = y;

  let cy = y;
  for (const block of doc.meta) {
    w.label(block.label, colX[0], cy);
    cy += LABEL + 4;
    for (const line of block.lines) {
      for (const piece of wrap(line, f.body, BODY, colW)) {
        w.text(piece, colX[0], cy, f.body, BODY, block === doc.meta[doc.meta.length - 1] && line !== block.lines[0] ? MUTED : INK);
        cy += BODY_LEADING;
      }
    }
    cy += 9;
  }
  bottom = Math.max(bottom, cy - 9);

  const party = (p: { label: string; name: string; lines: string[]; note: string | null }, x: number) => {
    let py = y;
    w.label(p.label, x, py);
    py += LABEL + 7;
    for (const piece of wrap(p.name, f.bodyStrong, BODY, colW)) {
      w.text(piece, x, py, f.bodyStrong, BODY);
      py += BODY_LEADING;
    }
    for (const line of p.lines) {
      for (const piece of wrap(line, f.body, BODY, colW)) {
        w.text(piece, x, py, f.body, BODY);
        py += BODY_LEADING;
      }
    }
    if (p.note) {
      py += 4.5;
      for (const piece of wrap(p.note, f.body, BODY, colW)) {
        w.text(piece, x, py, f.body, BODY, MUTED);
        py += BODY_LEADING;
      }
    }
    return py;
  };
  bottom = Math.max(bottom, party(doc.seller, colX[1]), party(doc.buyer, colX[2]));

  // ── The lines ─────────────────────────────────────────────────────────
  y = bottom + 30;
  y = drawTableHeader(y);
  for (const line of doc.lines) {
    const titleLines = wrap(line.title, f.bodyStrong, 10.5, descWidth);
    const detailLines = line.detail ? wrap(line.detail, f.body, BODY, descWidth) : [];
    const rowH = 10.5 + titleLines.length * 14 + detailLines.length * BODY_LEADING + 10.5;
    if (y + rowH > footerTop - 16) {
      y = continuationPage();
      y = drawTableHeader(y);
    }
    // The title's first line and the three numbers share one baseline.
    const firstBaseline = y + 10.5 + 10.5 * 0.82;
    let baseline = firstBaseline;
    for (const t of titleLines) {
      w.onBaseline(t, M_X, baseline, f.bodyStrong, 10.5);
      baseline += 14;
    }
    for (const d of detailLines) {
      w.onBaseline(d, M_X, baseline, f.body, BODY, MUTED);
      baseline += BODY_LEADING;
    }
    w.rightOnBaseline(line.quantity, qtyRight, firstBaseline, f.numeral, NUMBER);
    w.rightOnBaseline(line.unitPrice, unitRight, firstBaseline, f.numeral, NUMBER);
    w.rightOnBaseline(line.amount, amountRight, firstBaseline, f.numeral, NUMBER);
    y += rowH;
    w.rule(y, 0.75);
  }

  // ── Totals, right-aligned under the amounts ───────────────────────────
  const totalsW = 240;
  const tx = amountRight - totalsW;
  const totalsH = doc.preTotal.length * 18 + 36 + doc.postTotal.length * 18 + 8;
  y += 13.5;
  if (y + totalsH > footerTop - 16) y = continuationPage();
  // Label and figure of every row share a baseline, as on the board.
  for (const row of doc.preTotal) {
    const base = y + 12.5;
    w.onBaseline(row.label, tx, base, f.body, BODY, MUTED);
    w.rightOnBaseline(row.value, amountRight, base, f.numeral, NUMBER);
    y += 18;
  }
  y += 3;
  w.rule(y, 1.1, INK, tx, amountRight);
  const totalBase = y + 7.5 + 17;
  w.onBaseline(doc.total.label, tx, totalBase, f.bodyStrong, NUMBER);
  w.rightOnBaseline(doc.total.value, amountRight, totalBase, f.numeralTotal, 21);
  y = totalBase + 9;
  doc.postTotal.forEach((row, i) => {
    if (i === 0) w.rule(y, 0.75, RULE, tx, amountRight);
    const last = i === doc.postTotal.length - 1;
    const base = y + 13;
    w.onBaseline(row.label, tx, base, last ? f.bodyStrong : f.body, BODY, last ? INK : MUTED);
    w.rightOnBaseline(row.value, amountRight, base, last ? f.numeralStrong : f.numeral, NUMBER, last ? INK : MUTED);
    y += 18;
  });

  // ── Notes, sitting on the footer ──────────────────────────────────────
  const notesW = 390;
  const noteLines = doc.notes.flatMap((n) => wrap(n, f.body, BODY, notesW));
  const questionLines = wrap(doc.questions, f.body, BODY, notesW);
  const notesH = LABEL + 6 + (noteLines.length + questionLines.length) * BODY_LEADING;
  let ny = footerTop - 21 - notesH;
  if (ny < y + 18) {
    // The totals ran long: the notes follow them on a page of their own.
    ny = continuationPage();
  }
  w.label(doc.notesLabel, M_X, ny);
  ny += LABEL + 6;
  for (const line of noteLines) {
    w.text(line, M_X, ny, f.body, BODY);
    ny += BODY_LEADING;
  }
  for (const line of questionLines) {
    w.text(line, M_X, ny, f.body, BODY, MUTED);
    ny += BODY_LEADING;
  }

  // ── Every page's footer, with its number ──────────────────────────────
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    page.drawLine({
      start: { x: M_X, y: PAGE_H - footerTop },
      end: { x: M_X + CONTENT_W, y: PAGE_H - footerTop },
      thickness: 0.75,
      color: RULE,
    });
    let fy = footerTop + 10.5;
    for (const line of footerLines) {
      w.text(line, M_X, fy, f.body, LABEL, MUTED, 0, page);
      fy += 12;
    }
    const pageLabel = doc.pageTemplate.replace("{n}", String(i + 1)).replace("{total}", String(total));
    const pw = w.width(pageLabel, f.mono, LABEL, 0.54);
    w.text(pageLabel, M_X + CONTENT_W - pw, footerTop + 10.5, f.mono, LABEL, MUTED, 0.54, page);
  });

  return pdf.save();
}
