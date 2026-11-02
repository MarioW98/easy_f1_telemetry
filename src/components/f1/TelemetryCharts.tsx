import { memo, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { LapData, TelSample } from "@/lib/telemetry";
import { telemetryAt } from "@/lib/telemetry";

export type SeriesKey = "speed" | "throttle" | "brake" | "rpm" | "gear" | "drsOpen";
export const SERIES: {
  key: SeriesKey;
  label: string;
  unit: string;
  domain: [number, number] | ["auto", "auto"];
  step?: boolean;
  h: number;
  fmt: (v: number) => string;
}[] = [
  {
    key: "speed",
    label: "Velocità",
    unit: "km/h",
    domain: [0, 360],
    h: 110,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "throttle",
    label: "Acceleratore",
    unit: "%",
    domain: [0, 100],
    h: 70,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "brake",
    label: "Freno",
    unit: "on/off",
    domain: [0, 1],
    step: true,
    h: 44,
    fmt: (v) => (v ? "ON" : "OFF"),
  },
  {
    key: "rpm",
    label: "RPM",
    unit: "giri/min",
    domain: [4000, 13000],
    h: 70,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "gear",
    label: "Marcia",
    unit: "",
    domain: [0, 8],
    step: true,
    h: 60,
    fmt: (v) => v.toFixed(0),
  },
  {
    key: "drsOpen",
    label: "DRS",
    unit: "aperto",
    domain: [0, 1],
    step: true,
    h: 40,
    fmt: (v) => (v ? "APERTO" : "CHIUSO"),
  },
];

export interface ChartDriver {
  lap: LapData;
  color: string;
  label: string;
  dash?: string | undefined;
}

const Y_W = 48;
const R_M = 10;

// Insert null breaks across gaps > 1s so missing data is never bridged or zero-filled.
function withBreaks(tel: TelSample[], duration: number): (TelSample | { t: number })[] {
  const out: (TelSample | { t: number })[] = [];
  const s = tel.filter((x) => x.t >= -0.5 && x.t <= duration + 0.5);
  for (let i = 0; i < s.length; i++) {
    const cur = s[i]!,
      prev = s[i - 1];
    if (prev && cur.t - prev.t > 1) out.push({ t: (cur.t + prev.t) / 2 });
    out.push(cur);
  }
  return out;
}

const ChartRow = memo(function ChartRow({
  series,
  drivers,
  duration,
  data,
  height,
}: {
  series: (typeof SERIES)[number];
  drivers: ChartDriver[];
  duration: number;
  data: (TelSample | { t: number })[][];
  height: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart margin={{ top: 4, right: R_M, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" vertical={false} />
        <XAxis type="number" dataKey="t" domain={[0, duration]} allowDataOverflow hide />
        <YAxis
          width={Y_W}
          domain={series.domain}
          allowDataOverflow
          tick={{
            fontSize: 10,
            fill: "var(--color-muted-foreground)",
            fontFamily: "var(--font-mono)",
          }}
          tickCount={series.step && series.domain[1] === 1 ? 2 : 3}
          tickFormatter={(v) => (series.domain[1] === 1 ? (v ? "1" : "0") : String(v))}
          stroke="var(--color-border)"
        />
        {drivers.map((d, i) => (
          <Line
            key={i}
            data={data[i]}
            dataKey={series.key}
            type={series.step ? "stepAfter" : "linear"}
            stroke={d.color}
            strokeWidth={1.5}
            strokeDasharray={d.dash}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});

export function TelemetryCharts({
  drivers,
  duration,
  time,
  onSeek,
  visible,
  scale = 1,
  focus = null,
  onFocus,
}: {
  drivers: ChartDriver[];
  duration: number;
  time: number;
  onSeek: (t: number) => void;
  visible: Record<SeriesKey, boolean>;
  scale?: number;
  focus?: SeriesKey | null;
  onFocus?: (k: SeriesKey | null) => void;
}) {
  const data = useMemo(
    () => drivers.map((d) => withBreaks(d.lap.tel, duration)),
    [drivers, duration],
  );
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ t: number; px: number } | null>(null);

  const tAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = (clientX - r.left - Y_W) / (r.width - Y_W - R_M);
    return { t: Math.max(0, Math.min(1, f)) * duration, px: clientX - r.left };
  };
  const frac = (t: number) =>
    `calc(${Y_W}px + (100% - ${Y_W + R_M}px) * ${Math.min(1, Math.max(0, t / duration))})`;
  const rows = SERIES.filter((s) => visible[s.key]);

  return (
    <div className="relative">
      <div
        ref={ref}
        className="relative cursor-crosshair"
        onMouseMove={(e) => setHover(tAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSeek(tAt(e.clientX).t)}
      >
        {rows.map((s) => (
          <div key={s.key} className="relative border-b border-border/60 last:border-b-0">
            <div className="pointer-events-none relative z-10 flex flex-wrap gap-x-3 pl-1 pr-8 pt-1 font-mono text-[11px] sm:absolute sm:left-14 sm:right-10 sm:top-0.5 sm:p-0 sm:text-[10px]">
              <span className="text-muted-foreground">
                {s.label}
                {s.unit && ` (${s.unit})`}
              </span>
              {drivers.map((d, i) => {
                const v = telemetryAt(d.lap.tel, time)?.s[s.key];
                return (
                  <span key={i} style={{ color: d.color }}>
                    {d.label} {v === null || v === undefined ? "n/d" : s.fmt(v)}
                  </span>
                );
              })}
            </div>
            {onFocus && (
              <button
                aria-label={focus === s.key ? "Riduci grafico" : "Espandi grafico"}
                title={focus === s.key ? "Riduci grafico" : "Espandi grafico"}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocus(focus === s.key ? null : s.key);
                }}
                className="absolute right-3 top-0.5 z-20 rounded border border-border bg-secondary p-0.5 text-muted-foreground hover:text-foreground"
              >
                {focus === s.key ? (
                  <Minimize2 className="h-3 w-3" />
                ) : (
                  <Maximize2 className="h-3 w-3" />
                )}
              </button>
            )}
            <ChartRow
              series={s}
              drivers={drivers}
              duration={duration}
              data={data}
              height={Math.round(
                focus
                  ? focus === s.key
                    ? Math.max(s.h * 3, 220) * scale
                    : Math.max(36, s.h * 0.7)
                  : s.h * scale,
              )}
            />
          </div>
        ))}
        {/* shared playback cursor */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: frac(time) }}
        />
        {hover && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-muted-foreground/50"
            style={{ left: hover.px }}
          />
        )}
        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-20 rounded border border-border bg-popover px-2 py-1 font-mono text-[10px] shadow"
            style={{ left: Math.min(hover.px + 10, (ref.current?.clientWidth ?? 400) - 170) }}
          >
            <div className="mb-0.5 text-muted-foreground">t = {hover.t.toFixed(2)} s</div>
            {drivers.map((d, i) => {
              const r = telemetryAt(d.lap.tel, hover.t)?.s;
              return (
                <div key={i} style={{ color: d.color }}>
                  {d.label}:{" "}
                  {r
                    ? `${r.speed ?? "n/d"} km/h · ${r.throttle ?? "n/d"}% · G${r.gear ?? "-"} · ${r.brake ? "FRENO" : "—"}`
                    : "nessun dato"}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex justify-between pl-12 pr-2.5 font-mono text-[10px] text-muted-foreground">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{(duration * f).toFixed(1)} s</span>
        ))}
      </div>
    </div>
  );
}
