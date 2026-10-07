"use client";
// [Input] Bounded hourly real observations with nullable success/performance values.
// [Output] Accessible trend chart that preserves unknown gaps and isolated samples.
// [Pos] Routing health visualization; no interpolation across missing observations.
import type { RoutingHealthPoint } from "@/lib/models/routing-health-contract";
import { useEffect, useRef, useState } from "react";

export function healthTime(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
export function healthPercent(value: number | null) { return value === null ? "无数据" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`; }
export function healthDuration(value: number | null) { return value === null ? "无数据" : `${(value / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })} s`; }

export default function RoutingHealthChart({ points, metric, title }: {
  points: RoutingHealthPoint[]; metric: "successRate" | "latency" | "firstToken"; title: string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!plot.current) return;
    const observer = new ResizeObserver(entries => { if (entries[0].contentRect.width > 0) setWidth(entries[0].contentRect.width); });
    observer.observe(plot.current);
    return () => observer.disconnect();
  }, []);
  const lines = metric === "successRate"
    ? [{ name: "成功率", color: "var(--color-success)", values: points.map(point => point.successRate) }]
    : [
      { name: "P50", color: "var(--color-success)", values: points.map(point => point[metric].p50Ms) },
      { name: "P95", color: "var(--color-warning)", values: points.map(point => point[metric].p95Ms) },
    ];
  const measured = lines.flatMap(line => line.values.filter((value): value is number => value !== null));
  const max = metric === "successRate" ? 100 : Math.max(...measured, 1);
  const x = (index: number) => 60 + index / Math.max(points.length - 1, 1) * (width - 85);
  const y = (value: number) => 195 - value / max * 150;
  const format = metric === "successRate" ? healthPercent : healthDuration;
  return <figure className="min-w-0 rounded-xl border border-border bg-bg-surface p-4" aria-label={title}>
    <figcaption className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display text-lg font-semibold">{title}</h3><div className="flex gap-4 text-xs">{lines.map(line => <span key={line.name} style={{ color: line.color }}>{line.name}</span>)}</div></figcaption>
    <div ref={plot}>{!measured.length ? <div role="status" className="flex min-h-48 items-center justify-center text-sm text-text-tertiary">此范围暂无{metric === "firstToken" ? "成功流式首 Token" : "可绘制"}观测数据</div> : <svg role="img" aria-label={`${title}趋势图`} viewBox={`0 0 ${width} 240`} className="mt-3 block w-full">
      <title>{title}趋势图</title><desc>横轴为时间，缺少样本的时段留空；性能分位数只纳入成功请求。</desc>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1={60} x2={width - 25} y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" className="text-border" /><text x={52} y={y(max * fraction) + 4} textAnchor="end" fontSize={11} fill="currentColor" className="text-text-tertiary">{format(max * fraction)}</text></g>)}
      {lines.map(line => {
        let previous = false;
        const path = line.values.map((value, index) => {
          if (value === null) { previous = false; return ""; }
          const part = `${previous ? "L" : "M"}${x(index)} ${y(value)}`; previous = true; return part;
        }).join(" ");
        return <g key={line.name}><path d={path} fill="none" stroke={line.color} strokeWidth={2} />{line.values.map((value, index) => value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={3} fill={line.color}><title>{healthTime(points[index].at)} · {line.name} {format(value)}</title></circle>)}</g>;
      })}
      {(width < 480 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1]).map(index => <text key={index} x={x(index)} y={225} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize={11} fill="currentColor" className="text-text-tertiary">{healthTime(points[index].at)}</text>)}
    </svg>}</div>
  </figure>;
}
