type Point = { date: string; count: number };

export function Sparkline({ timeline }: { timeline: Point[] }) {
  if (!timeline || timeline.length === 0) return null;

  const width = 280;
  const height = 56;
  const pad = 4;
  const max = Math.max(...timeline.map((p) => p.count), 1);
  const stepX = timeline.length > 1 ? (width - pad * 2) / (timeline.length - 1) : 0;

  const points = timeline.map((p, i) => {
    const x = pad + i * stepX;
    const y = height - pad - (p.count / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Post count over time, ${timeline[0].date} to ${timeline[timeline.length - 1].date}`}
        className="overflow-visible"
      >
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {timeline.map((p, i) => {
          const [x, y] = points[i].split(',');
          return <circle key={p.date} cx={x} cy={y} r="1.6" fill="#5aa87a" />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-silver-dim">
        <span>{timeline[0].date}</span>
        <span>{timeline[timeline.length - 1].date}</span>
      </div>
    </div>
  );
}
