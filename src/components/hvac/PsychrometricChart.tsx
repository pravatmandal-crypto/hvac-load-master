import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { calculatePsychrometrics } from '../../lib/hvac-logic';

interface PsychPoint {
  id?: string;
  temp: number;
  rh: number;
  label: string;
  color: string;
}

interface PsychSegment {
  fromId: string;
  toId: string;
  color?: string;
  dashed?: boolean;
  label?: string;
}

interface PsychrometricChartProps {
  points: PsychPoint[];
  segments?: PsychSegment[];
  showGuides?: boolean;
  showLegend?: boolean;
  altitude?: number;
  width?: number;
  height?: number;
}

export default function PsychrometricChart({ 
  points, 
  segments = [],
  showGuides = false,
  showLegend = false,
  altitude = 0, 
  width = 600, 
  height = 400 
}: PsychrometricChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const margin = { top: 20, right: 40, bottom: 40, left: 50 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Dynamic Scales based on points
    const temps = points.map(p => p.temp);
    const minT = Math.min(30, ...temps) - 5;
    const maxT = Math.max(120, ...temps) + 5;

    const xScale = d3.scaleLinear()
      .domain([minT, maxT]) // Dry Bulb Temp °F
      .range([0, chartWidth]);

    // Calculate max humidity ratio for Y scale
    const psychs = points.map(p => calculatePsychrometrics(p.temp, p.rh, altitude));
    const maxW_data = Math.max(...psychs.map(p => p.humidityRatio));
    const maxW = Math.max(0.02, maxW_data * 1.2);

    const yScale = d3.scaleLinear()
      .domain([0, maxW]) // Humidity Ratio lb/lb
      .range([chartHeight, 0]);

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale).ticks(10).tickFormat(d => `${d}°F`))
      .append("text")
      .attr("x", chartWidth / 2)
      .attr("y", 35)
      .attr("fill", "currentColor")
      .attr("text-anchor", "middle")
      .attr("class", "text-[10px] font-bold uppercase tracking-wider")
      .text("Dry Bulb Temperature (°F)");

    g.append("g")
      .call(d3.axisLeft(yScale).ticks(8).tickFormat(d3.format(".3f")))
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -40)
      .attr("x", -chartHeight / 2)
      .attr("fill", "currentColor")
      .attr("text-anchor", "middle")
      .attr("class", "text-[10px] font-bold uppercase tracking-wider")
      .text("Humidity Ratio (lb/lb)");

    // Draw Saturation Curve (100% RH)
    const saturationLine = d3.line<number>()
      .x(d => xScale(d))
      .y(d => {
        const psych = calculatePsychrometrics(d, 100, altitude);
        return yScale(psych.humidityRatio);
      })
      .curve(d3.curveBasis);

    const curveTemps = d3.range(minT, maxT + 1, 1);

    g.append("path")
      .datum(curveTemps)
      .attr("fill", "none")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 2)
      .attr("d", saturationLine);

    // Draw RH lines (10% to 90%)
    [10, 20, 30, 40, 50, 60, 70, 80, 90].forEach(rh => {
      const rhLine = d3.line<number>()
        .x(d => xScale(d))
        .y(d => {
          const psych = calculatePsychrometrics(d, rh, altitude);
          return yScale(psych.humidityRatio);
        })
        .curve(d3.curveBasis);

      g.append("path")
        .datum(curveTemps)
        .attr("fill", "none")
        .attr("stroke", "#e2e8f0")
        .attr("stroke-width", 1)
        .attr("d", rhLine);

      // Label RH lines
      const labelTemp = minT + (maxT - minT) * 0.8;
      const psych = calculatePsychrometrics(labelTemp, rh, altitude);
      if (yScale(psych.humidityRatio) > 0 && yScale(psych.humidityRatio) < chartHeight) {
        g.append("text")
          .attr("x", xScale(labelTemp))
          .attr("y", yScale(psych.humidityRatio) - 5)
          .attr("fill", "#94a3b8")
          .attr("font-size", "8px")
          .text(`${rh}%`);
      }
    });

    const pointMap = new Map(
      points.map((p, index) => {
        const psych = calculatePsychrometrics(p.temp, p.rh, altitude);
        return [p.id || `point-${index}`, { point: p, x: xScale(p.temp), y: yScale(psych.humidityRatio), psych }];
      })
    );

    const fallbackSegments = points.length >= 2
      ? points.slice(0, -1).map((point, index) => ({
          fromId: point.id || `point-${index}`,
          toId: points[index + 1].id || `point-${index + 1}`,
          color: '#64748b',
          dashed: true,
        }))
      : [];

    const resolvedSegments = segments.length > 0 ? segments : fallbackSegments;

    resolvedSegments.forEach((segment) => {
      const from = pointMap.get(segment.fromId);
      const to = pointMap.get(segment.toId);
      if (!from || !to) return;

      const segmentLine = d3.line<{ x: number; y: number }>()
        .x(d => d.x)
        .y(d => d.y);

      g.append('path')
        .datum([{ x: from.x, y: from.y }, { x: to.x, y: to.y }])
        .attr('fill', 'none')
        .attr('stroke', segment.color || '#64748b')
        .attr('stroke-width', 1.75)
        .attr('stroke-dasharray', segment.dashed ? '5,3' : null)
        .attr('opacity', 0.95)
        .attr('d', segmentLine);

      if (segment.label) {
        g.append('text')
          .attr('x', (from.x + to.x) / 2)
          .attr('y', (from.y + to.y) / 2 - 6)
          .attr('fill', segment.color || '#64748b')
          .attr('font-size', '8px')
          .attr('font-weight', '600')
          .attr('text-anchor', 'middle')
          .text(segment.label);
      }
    });

    // Draw Points
    points.forEach((p, index) => {
      const key = p.id || `point-${index}`;
      const data = pointMap.get(key);
      if (!data) return;
      const x = data.x;
      const y = data.y;

      if (showGuides) {
        g.append('line')
          .attr('x1', x)
          .attr('x2', x)
          .attr('y1', chartHeight)
          .attr('y2', y)
          .attr('stroke', p.color)
          .attr('stroke-width', 0.8)
          .attr('stroke-dasharray', '2,3')
          .attr('opacity', 0.4);

        g.append('line')
          .attr('x1', 0)
          .attr('x2', x)
          .attr('y1', y)
          .attr('y2', y)
          .attr('stroke', p.color)
          .attr('stroke-width', 0.8)
          .attr('stroke-dasharray', '2,3')
          .attr('opacity', 0.4);
      }

      g.append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", 5)
        .attr("fill", p.color)
        .attr("stroke", "white")
        .attr("stroke-width", 2);

      if (!showLegend) {
        g.append("text")
          .attr("x", x + 8)
          .attr("y", y + 4)
          .attr("fill", p.color)
          .attr("font-size", "10px")
          .attr("font-weight", "bold")
          .text(p.label);

        g.append("text")
          .attr("x", x + 8)
          .attr("y", y + 16)
          .attr("fill", "#64748b")
          .attr("font-size", "8px")
          .text(`${p.temp}°F / ${p.rh}%`);
      }
    });

    if (showLegend) {
      const legend = svg.append('g')
        .attr('transform', `translate(${width - 170}, 16)`);

      legend.append('rect')
        .attr('width', 154)
        .attr('height', 18 + points.length * 16)
        .attr('rx', 6)
        .attr('fill', '#ffffff')
        .attr('stroke', '#cbd5e1')
        .attr('stroke-width', 1);

      legend.append('text')
        .attr('x', 10)
        .attr('y', 13)
        .attr('fill', '#475569')
        .attr('font-size', '9px')
        .attr('font-weight', '700')
        .text('Legend');

      points.forEach((p, index) => {
        const y = 26 + index * 16;
        legend.append('circle')
          .attr('cx', 12)
          .attr('cy', y)
          .attr('r', 4)
          .attr('fill', p.color);

        legend.append('text')
          .attr('x', 22)
          .attr('y', y + 3)
          .attr('fill', '#334155')
          .attr('font-size', '8px')
          .text(`${p.label}: ${p.temp.toFixed(1)}F / ${p.rh.toFixed(1)}%`);
      });
    }

  }, [points, segments, showGuides, showLegend, altitude, width, height]);

  return (
    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm overflow-hidden w-full">
      <svg 
        ref={svgRef} 
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
      />
    </div>
  );
}
