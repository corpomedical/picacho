import { Card } from "@/components/ui/card";

// Hand-built SVG rather than a charting library. Recharts/Chart.js would
// each add a few hundred KB to the bundle for one chart on one admin page,
// and neither would match the rest of the app's flat, hairline styling
// without a pile of overrides. This is ~100 lines and themes for free.
//
// THE LEDGER (operator pick B, 2026-09-03): a wide, low plot — four unlabelled
// hairlines, bottom tick marks, the two date captions set beneath the drawing
// as microlabels, the total in serif at the header's right. Numbers on the
// axis were dropped on purpose: the ledger states the total; the line shows
// the shape. The drawing is a FIXED 140px tall however wide the card is
// (preserveAspectRatio none + non-scaling strokes), so the plot stays low and
// the hairlines stay hairlines; the hollow "today" marker is an HTML ring
// positioned over the last point, since a circle would stretch with the box.

export type TrafficDay = { day: string; views: number; visitors: number };

const W = 688;
const H = 140;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 8;
const PAD_B = 10;

function shortDate(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Microlabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
      {children}
    </p>
  );
}

export function TrafficChart({ data }: { data: TrafficDay[] }) {
  const days = data.length;
  if (days === 0) {
    return (
      <Card>
        <Microlabel>Traffic</Microlabel>
        <p className="mt-3 text-sm text-atelier-muted">No page views recorded yet.</p>
      </Card>
    );
  }

  const totalViews = data.reduce((sum, d) => sum + d.views, 0);
  const peakVisitors = Math.max(...data.map((d) => d.visitors));
  // Headroom so the tallest point never touches the top edge, and a floor of
  // 1 so an all-zero week doesn't divide by zero and collapse the chart.
  const max = Math.max(1, ...data.map((d) => d.views)) * 1.15;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const x = (i: number) => PAD_L + (days === 1 ? plotW / 2 : (i / (days - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  const linePoints = data.map((d, i) => `${x(i)},${y(d.views)}`).join(" ");
  // Same path closed along the baseline to make the filled area.
  const areaPath = `M ${x(0)},${PAD_T + plotH} L ${linePoints.split(" ").join(" L ")} L ${x(days - 1)},${PAD_T + plotH} Z`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Microlabel>Traffic · {days} days</Microlabel>
          <p className="mt-1 text-xs text-atelier-muted" title={`Peak ${peakVisitors} visitors in a day`}>
            Page views, daily
          </p>
        </div>
        <div className="text-right">
          <p className="font-numeral text-[22px] leading-none tabular-nums text-atelier-ink">
            {totalViews.toLocaleString()}
          </p>
          <p className="mt-[3px] text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            views · {days} days
          </p>
        </div>
      </div>

      <div className="relative mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[140px] w-full"
        role="img"
        aria-label={`Daily page views over the last ${days} days, totalling ${totalViews} views.`}
      >
        {[0, 1 / 3, 2 / 3, 1].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(max * f)}
            y2={y(max * f)}
            className="stroke-atelier-rule"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={areaPath} className="fill-atelier-ink/[0.06]" />
        <polyline
          points={linePoints}
          fill="none"
          className="stroke-atelier-ink"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {data.map((d, i) => (
          <g key={d.day}>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={PAD_T + plotH}
              y2={PAD_T + plotH + 4}
              className="stroke-atelier-ink/[0.28]"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {/* Full-height hit area so the native tooltip works anywhere in
                the column, not just on the dot. */}
            <rect
              x={x(i) - plotW / (days * 2)}
              y={PAD_T}
              width={Math.max(plotW / days, 4)}
              height={plotH + PAD_B}
              fill="transparent"
            >
              <title>{`${d.day}: ${d.views} views, ${d.visitors} visitors`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <span
        aria-hidden
        className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-atelier-ink bg-atelier-paper"
        style={{ left: `${(x(days - 1) / W) * 100}%`, top: `${(y(data[days - 1].views) / H) * 100}%` }}
      />
      </div>

      <div className="mt-2 flex justify-between text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
        <span>{shortDate(data[0].day)}</span>
        <span>{shortDate(data[days - 1].day)} · Today</span>
      </div>
    </Card>
  );
}
