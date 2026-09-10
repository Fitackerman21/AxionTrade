export interface SparklineProps {
  /** Series of prices, oldest -> newest */
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  /** Fill under the line with low opacity of stroke color */
  fill?: boolean;
  className?: string;
  /** Base value (e.g. previous close) — draws a dashed reference line */
  baseline?: number;
}

export function Sparkline({
  data,
  width = 96,
  height = 32,
  stroke,
  strokeWidth = 1.5,
  fill = true,
  className = "",
  baseline,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }

  const min = Math.min(...data, baseline ?? Infinity);
  const max = Math.max(...data, baseline ?? -Infinity);
  const range = max - min || 1;
  const pad = 2;

  const x = (i: number) => pad + (i / (data.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - pad * 2);

  const points = data.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(2)},${height - pad} L${x(0).toFixed(2)},${height - pad} Z`;

  const up = baseline != null ? data[data.length - 1] >= baseline : data[data.length - 1] >= data[0];
  const color = stroke ?? (up ? "#00c896" : "#f6465d");

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      {fill && <path d={areaPath} fill={color} opacity={0.12} />}
      {baseline != null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="#868e96"
          strokeDasharray="3 3"
          strokeWidth={1}
          opacity={0.5}
        />
      )}
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
