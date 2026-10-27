// 1日 (0〜24時) を横棒で表す「勤務帯ルーラー」。勤務・休憩・時間外を色分けして表示する。
interface Props {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  breaks: Array<{ start: string; end: string | null }>;
  scheduled?: { start: string; end: string } | null;
  nowMin?: number | null; // 現在時刻 (分) — 勤務中の表示用
  height?: number;
  showScale?: boolean;
  leave?: "full" | "am" | "pm" | null;
  overtimeMinutes?: number; // 法定外残業 (勤務の終わり側に色付けする)
}

const DAY = 24 * 60;
const VIEW_START = 5 * 60; // 5:00 始まりで 29:00 (翌5:00) まで
const VIEW = 24 * 60;

function minOf(date: string, dt: string): number {
  const d0 = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const d1 = Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10), +dt.slice(11, 13), +dt.slice(14, 16));
  return (d1 - d0) / 60000;
}

const pct = (m: number) => `${(Math.max(0, Math.min(VIEW, m - VIEW_START)) / VIEW) * 100}%`;
const width = (a: number, b: number) => `${((Math.max(VIEW_START, Math.min(VIEW_START + VIEW, b)) - Math.max(VIEW_START, Math.min(VIEW_START + VIEW, a))) / VIEW) * 100}%`;

export function DayRuler({ date, clockIn, clockOut, breaks, scheduled, nowMin, height = 10, showScale, leave, overtimeMinutes }: Props) {
  const s = clockIn ? minOf(date, clockIn) : null;
  const e = clockOut ? minOf(date, clockOut) : s !== null && nowMin != null ? Math.max(s, nowMin) : null;
  const schedStart = scheduled ? +scheduled.start.slice(0, 2) * 60 + +scheduled.start.slice(3, 5) : null;
  let schedEnd = scheduled ? +scheduled.end.slice(0, 2) * 60 + +scheduled.end.slice(3, 5) : null;
  if (schedStart !== null && schedEnd !== null && schedEnd <= schedStart) schedEnd += DAY;
  const otStart = s !== null && e !== null && overtimeMinutes ? Math.max(s, e - overtimeMinutes) : null;

  return (
    <div className="w-full">
      <div className="relative w-full rounded-[3px] bg-line-2 overflow-hidden" style={{ height }} aria-hidden>
        {/* 22:00〜翌5:00 の深夜帯 */}
        <div className="absolute inset-y-0 bg-ai-100" style={{ left: pct(22 * 60), width: width(22 * 60, 29 * 60) }} />
        {schedStart !== null && schedEnd !== null && (
          <div className="absolute inset-y-0 border-x border-dashed border-ink-3/40" style={{ left: pct(schedStart), width: width(schedStart, schedEnd) }} />
        )}
        {leave && schedStart !== null && schedEnd !== null && (
          <div
            className="absolute inset-y-0 bg-yamabuki-100"
            style={
              leave === "full"
                ? { left: pct(schedStart), width: width(schedStart, schedEnd) }
                : leave === "am"
                  ? { left: pct(schedStart), width: width(schedStart, (schedStart + schedEnd) / 2) }
                  : { left: pct((schedStart + schedEnd) / 2), width: width((schedStart + schedEnd) / 2, schedEnd) }
            }
          />
        )}
        {s !== null && e !== null && (
          <>
            <div className={`absolute inset-y-0 ${clockOut ? "bg-asagi-600" : "bg-asagi-400"}`} style={{ left: pct(s), width: width(s, e) }} />
            {otStart !== null && e > otStart && <div className="absolute inset-y-0 bg-ai-800" style={{ left: pct(otStart), width: width(otStart, e) }} />}
            {breaks.map((b, i) => {
              const bs = minOf(date, b.start);
              const be = b.end ? minOf(date, b.end) : nowMin ?? bs;
              return (
                <div
                  key={i}
                  className="absolute inset-y-0"
                  style={{
                    left: pct(bs),
                    width: width(bs, be),
                    background: "repeating-linear-gradient(135deg, #fff 0 2px, #c4d3e6 2px 4px)",
                  }}
                />
              );
            })}
          </>
        )}
        {nowMin != null && nowMin >= VIEW_START && nowMin <= VIEW_START + VIEW && (
          <div className="absolute inset-y-0 w-px bg-ng" style={{ left: pct(nowMin) }} />
        )}
      </div>
      {showScale && (
        <div className="relative h-4 mt-1 text-[10px] text-ink-3 num">
          {[6, 9, 12, 15, 18, 21, 24, 27].map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: pct(h * 60) }}>
              {h % 24}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function RulerLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-2 rounded-[2px] bg-asagi-600" />勤務</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-2 rounded-[2px] bg-ai-800" />時間外</span>
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block w-3 h-2 rounded-[2px]" style={{ background: "repeating-linear-gradient(135deg, #fff 0 2px, #c4d3e6 2px 4px)" }} />休憩
      </span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-2 rounded-[2px] bg-yamabuki-100 border border-yamabuki-600/30" />休暇</span>
      <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-2 rounded-[2px] bg-ai-100" />深夜帯</span>
    </div>
  );
}
