
/**
 * Correlation matrix / generic heat grid.
 *
 * A `null` cell means the pair was never measured (Gold computes a curated pair
 * list, not a full clique) and renders as an empty well — distinct from a
 * measured zero, which renders as a near-transparent tinted cell.
 */
export function CorrelationMatrix({ labels, values, height = 280, className }: { labels: string[]; values: (number | null)[][]; height?: number; className?: string }) {
  const n = labels.length;
  const cell = Math.min(height / (n + 1), 30);
  const color = (v: number | null) => {
    if (v === null) return "rgba(255,255,255,0.03)";
    if (v >= 0) return `rgba(46,204,113,${(0.12 + Math.abs(v) * 0.7).toFixed(3)})`;
    return `rgba(255,59,59,${(0.12 + Math.abs(v) * 0.7).toFixed(3)})`;
  };
  const W = cell * (n + 1.4);
  const H = cell * (n + 1.4);
  // Rotated column headers overhang the top-right of the grid; reserve room for
  // the longest one so they aren't clipped by the viewBox.
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  const pad = (longest * cell * 0.34 * 0.62) / Math.SQRT2;
  return (
    <svg viewBox={`0 ${-pad} ${W + pad} ${H + pad}`} className={className} style={{ width: "100%", height }}>
      {labels.map((l, i) => (
        <text key={`r${i}`} x={cell * 1.3} y={cell * (i + 2) - cell / 2 + 3} textAnchor="end" fontSize={cell * 0.34} fill="#9A9AA3" fontFamily="var(--font-mono)">
          {l}
        </text>
      ))}
      {labels.map((l, j) => {
        // Column headers are rotated so long identifiers (FRED series ids, not
        // just 3-letter tickers) don't collide with their neighbours.
        const cx = cell * 1.4 + cell * (j + 0.5);
        return (
          <text
            key={`c${j}`}
            x={cx}
            y={cell}
            textAnchor="start"
            fontSize={cell * 0.34}
            fill="#9A9AA3"
            fontFamily="var(--font-mono)"
            transform={`rotate(-45,${cx},${cell})`}
          >
            {l}
          </text>
        );
      })}
      {values.map((row, i) =>
        row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={cell * 1.4 + cell * j} y={cell * 1.4 + cell * i} width={cell - 1} height={cell - 1} fill={color(v)} />
            {cell > 18 && v !== null && (
              <text x={cell * 1.4 + cell * j + cell / 2} y={cell * 1.4 + cell * i + cell / 2 + 3} textAnchor="middle" fontSize={cell * 0.3} fill="#E6E6E6" fontFamily="var(--font-mono)">
                {v.toFixed(2)}
              </text>
            )}
          </g>
        ))
      )}
    </svg>
  );
}

/** Generic value heat grid with row/column labels. */
export function HeatGrid({
  rows,
  cols,
  values,
  fmt,
  height = 280,
  className,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  fmt?: (n: number) => string;
  height?: number;
  className?: string;
}) {
  const max = Math.max(...values.flat().map(Math.abs), 1e-9);
  return (
    <div className={className} style={{ maxHeight: height, overflow: "auto" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-term-panel-2 px-2 py-1 text-left text-2xs text-term-text-mute" />
            {cols.map((c) => (
              <th key={c} className="px-1 py-1 text-center text-3xs font-semibold text-term-text-mute">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r, i) => (
            <tr key={r}>
              <td className="sticky left-0 z-10 bg-term-panel px-2 py-1 text-left text-2xs text-term-text-dim">{r}</td>
              {cols.map((c, j) => {
                const v = values[i]?.[j] ?? 0;
                const t = Math.abs(v) / max;
                return (
                  <td key={c} className="px-1 py-1 text-center text-3xs" style={{ background: `rgba(255,140,0,${(t * 0.6).toFixed(3)})` }}>
                    {fmt ? fmt(v) : v.toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
