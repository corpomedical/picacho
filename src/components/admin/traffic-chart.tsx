import { Card } from "@/components/ui/card";

// Hand-built SVG rather than a charting library. Recharts/Chart.js would
// each add a few hundred KB to the bundle for one chart on one admin page,
// and neither would match the rest of the app's flat, hairline styling
// without a pile of overrides. This is ~100 lines and themes for free.

export type TrafficDay = { day: string; views: number; visitors: number };

const W = 760;
const H = 220;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

export function TrafficChart({ data }: { data: TrafficDay[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-neutral-900">Traffic</h2>
        <p className="mt-3 text-sm text-neutral-500">No page views recorded yet.</p>
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
  const x = (i: number) => PAD_L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;

  const linePoints = data.map((d, i) => `${x(i)},${y(d.views)}`).join(" ");
  // Same path closed along the baseline to make the filled area.
  const areaPath = `M ${x(0)},${PAD_T + plotH} L ${linePoints.split(" ").join(" L ")} L ${x(data.length - 1)},${PAD_T + plotH} Z`;

  // Four horizontal gridlines, labelled with rounded values.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const uniqueTicks = Array.from(new Set(ticks));

  // Only label a handful of dates — one per day is unreadable at 30 days.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Traffic</h2>
        <p className="text-xs text-neutral-500">
          {totalViews.toLocaleString()} views · peak {peakVisitors} visitors/day · last {data.length} days
        </p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-4 w-full"
        role="img"
        aria-label={`Daily page views over the last ${data.length} days, totalling ${totalViews} views.`}
      >
        {uniqueTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              className="stroke-neutral-100"
              strokeWidth={1}
            />
            <text
              x={PAD_L - 8}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-neutral-400"
              style={{ fontSize: 9 }}
            >
              {t}
            </text>
          </g>
        ))}

        <path d={areaPath} className="fill-neutral-900/[0.06]" />
        <polyline
          points={linePoints}
          fill="none"
          className="stroke-neutral-900"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((d, i) => (
          <g key={d.day}>
            {/* Dots only on days with traffic — a row of dots along zero
                reads as data that isn't there. */}
            {d.views > 0 && <circle cx={x(i)} cy={y(d.views)} r={2.5} className="fill-neutral-900" />}
            {/* Full-height hit area so the native tooltip works anywhere in
                the column, not just on the 2.5px dot. */}
            <rect
              x={x(i) - plotW / (data.length * 2)}
              y={PAD_T}
              width={Math.max(plotW / data.length, 4)}
              height={plotH}
              fill="transparent"
            >
              <title>{`${d.day}: ${d.views} views, ${d.visitors} visitors`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-neutral-400"
                style={{ fontSize: 9 }}
              >
                {d.day.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </Card>
  );
}
