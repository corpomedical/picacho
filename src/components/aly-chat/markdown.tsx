"use client";

import { Fragment, useState, type ReactNode } from "react";

// Aly's answers, shown as the Markdown she writes (2026-09-29): headings,
// lists, tables, quotes, code blocks with a copy button, bold, italic,
// inline code and links. Built as React elements, never as HTML strings, so
// nothing a brain writes can reach the page as markup. Links open in a new
// tab and only for http(s) and mailto.
//
// Deliberately small: a chat answer, not a document format. Anything it
// doesn't recognise shows as the text it is.

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "code"; lang: string; text: string }
  | { t: "ul" | "ol"; items: string[]; start: number }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const close = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(close)) body.push(lines[i++]);
      i++;
      out.push({ t: "code", lang: fence[2] || "", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ t: "h", level: h[1].length, text: h[2].replace(/\s#+\s*$/, "") });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push({ t: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ t: "quote", text: body.join("\n") });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/;
    const ol = /^\s*(\d+)[.)]\s+(.*)$/;
    if (ul.test(line) || ol.test(line)) {
      const ordered = ol.test(line);
      const start = ordered ? Number(ol.exec(line)![1]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? ol.exec(lines[i]) : ul.exec(lines[i]);
        if (m) {
          items.push(ordered ? m[2] : m[1]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
          i++;
        } else break;
      }
      out.push({ t: ordered ? "ol" : "ul", items, start });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      body.push(lines[i++]);
    }
    out.push({ t: "p", text: body.join("\n") });
  }
  return out;
}

function safeHref(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(h) ? h : null;
}

/** Bold, italic, inline code, links and bare URLs. */
export function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const push = (n: ReactNode) => out.push(<Fragment key={`${keyBase}-${k++}`}>{n}</Fragment>);
  while ((m = re.exec(text))) {
    if (m.index > last) push(breaks(text.slice(last, m.index)));
    if (m[2] !== undefined) push(<code className="rounded bg-atelier-ink/[0.07] px-1 py-0.5 font-mono text-[0.9em]">{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined) push(<strong className="font-semibold">{inline(m[3] ?? m[4], `${keyBase}-b${k}`)}</strong>);
    else if (m[5] !== undefined || m[6] !== undefined) push(<em>{inline(m[5] ?? m[6], `${keyBase}-e${k}`)}</em>);
    else if (m[7] !== undefined) {
      const href = safeHref(m[8]);
      push(
        href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-atelier-accent underline underline-offset-2">
            {inline(m[7], `${keyBase}-l${k}`)}
          </a>
        ) : (
          m[7]
        ),
      );
    } else if (m[9] !== undefined) {
      push(
        <a href={m[9]} target="_blank" rel="noopener noreferrer" className="break-all text-atelier-accent underline underline-offset-2">
          {m[9]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) push(breaks(text.slice(last)));
  return out;
}

function breaks(s: string): ReactNode {
  const parts = s.split("\n");
  return parts.map((p, i) => (
    <Fragment key={i}>
      {p}
      {i < parts.length - 1 && <br />}
    </Fragment>
  ));
}

function CodeBlock({ lang, text, copyLabel, copiedLabel }: { lang: string; text: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-media border border-atelier-rule bg-atelier-ink/[0.04]">
      <div className="flex items-center justify-between border-b border-atelier-rule px-3 py-1.5 text-[11px] text-atelier-muted">
        <span className="font-mono">{lang || "text"}</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-atelier-ink/[0.06] hover:text-atelier-ink"
          onClick={() => {
            navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
        >
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code className="font-mono">{text}</code>
      </pre>
    </div>
  );
}

export function Markdown({
  text,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  size = "md",
}: {
  text: string;
  copyLabel?: string;
  copiedLabel?: string;
  /** "sm" in the side-by-side answers, where three share a row. */
  size?: "sm" | "md";
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={`min-w-0 break-words text-atelier-ink ${size === "sm" ? "text-[13.5px] leading-6" : "text-[15px] leading-7"}`}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.t) {
          case "h": {
            const size = b.level <= 1 ? "text-xl" : b.level === 2 ? "text-lg" : "text-base";
            return (
              <p key={key} role="heading" aria-level={b.level} className={`${size} mb-2 mt-5 font-semibold first:mt-0`}>
                {inline(b.text, key)}
              </p>
            );
          }
          case "p":
            return (
              <p key={key} className="my-3 first:mt-0 last:mb-0">
                {inline(b.text, key)}
              </p>
            );
          case "code":
            return <CodeBlock key={key} lang={b.lang} text={b.text} copyLabel={copyLabel} copiedLabel={copiedLabel} />;
          case "ul":
            return (
              <ul key={key} className="my-3 list-disc space-y-1 pl-6">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} start={b.start} className="my-3 list-decimal space-y-1 pl-6">
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={key} className="my-3 border-l-2 border-atelier-accent/60 pl-3 text-atelier-muted">
                {inline(b.text, key)}
              </blockquote>
            );
          case "table":
            return (
              <div key={key} className="my-3 overflow-x-auto rounded-media border border-atelier-rule">
                <table className="w-full border-collapse text-sm tabular-nums">
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} className="border-b border-atelier-rule bg-atelier-ink/[0.04] px-3 py-2 text-left font-semibold">
                          {inline(c, `${key}-h${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-b border-atelier-rule last:border-0">
                        {r.map((c, n) => (
                          <td key={n} className="px-3 py-2 align-top">
                            {inline(c, `${key}-${j}-${n}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "hr":
            return <hr key={key} className="my-5 border-atelier-rule" />;
        }
      })}
    </div>
  );
}
