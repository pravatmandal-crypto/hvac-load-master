import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { UAssembly, WallCategory, GroundParams } from '../data/ubuilder-seed';
import { WALL_CATEGORY_LABELS } from '../data/ubuilder-seed';
import type { UValueResult, LayerResult } from '../lib/ubuilder/calculations';

const BRAND_BLUE: [number, number, number] = [30, 64, 175];
const LIGHT_GRAY: [number, number, number] = [248, 250, 252];
const MID_GRAY: [number, number, number] = [100, 116, 139];
const DARK: [number, number, number] = [15, 23, 42];

// ─── Layer style lookup ───────────────────────────────────────────────────────
type Pattern = 'solid' | 'diagonal' | 'horizontal' | 'brick' | 'cross';

interface LayerStyle {
  fill: [number, number, number];
  stroke: [number, number, number];
  hatch: [number, number, number];
  pattern: Pattern;
}

function getLayerStyle(materialName: string): LayerStyle {
  const n = materialName.toLowerCase();

  if (n.includes('brick'))
    return { fill: [205, 133, 63], stroke: [160, 82, 30], hatch: [139, 69, 19], pattern: 'brick' };
  if (n.includes('stone') || n.includes('granite') || n.includes('limestone') || n.includes('sandstone') || n.includes('slate'))
    return { fill: [148, 163, 184], stroke: [100, 116, 139], hatch: [71, 85, 105], pattern: 'cross' };
  if (n.includes('aac') || n.includes('autoclaved'))
    return { fill: [214, 219, 226], stroke: [148, 163, 184], hatch: [100, 116, 139], pattern: 'horizontal' };
  if (n.includes('concrete') || n.includes('rcc') || n.includes('reinforced') || n.includes('screed'))
    return { fill: [156, 163, 175], stroke: [107, 114, 128], hatch: [75, 85, 99], pattern: 'diagonal' };
  if (n.includes('block'))
    return { fill: [176, 185, 197], stroke: [120, 132, 149], hatch: [90, 100, 115], pattern: 'horizontal' };
  if (n.includes('mineral wool') || n.includes('glass wool') || n.includes('stone wool') || n.includes('rockwool') || n.includes('cellulose'))
    return { fill: [253, 224, 71], stroke: [202, 138, 4], hatch: [161, 98, 7], pattern: 'diagonal' };
  if (n.includes('eps') || n.includes('xps') || n.includes('pur') || n.includes('pir') || n.includes('phenol') || n.includes('perlite') || n.includes('cellular glass') || n.includes('insul'))
    return { fill: [254, 240, 138], stroke: [202, 138, 4], hatch: [161, 98, 7], pattern: 'diagonal' };
  if (n.includes('timber') || n.includes('softwood') || n.includes('hardwood') || n.includes('pine') || n.includes('oak') || n.includes('floor board'))
    return { fill: [188, 143, 90], stroke: [133, 100, 50], hatch: [101, 70, 30], pattern: 'horizontal' };
  if (n.includes('plywood') || n.includes('osb') || n.includes('mdf') || n.includes('chipboard'))
    return { fill: [210, 170, 110], stroke: [160, 120, 70], hatch: [120, 85, 45], pattern: 'horizontal' };
  if (n.includes('gypsum board') || n.includes('plasterboard'))
    return { fill: [245, 245, 245], stroke: [180, 180, 180], hatch: [150, 150, 150], pattern: 'solid' };
  if (n.includes('plaster') || n.includes('render'))
    return { fill: [238, 240, 242], stroke: [172, 178, 185], hatch: [140, 148, 158], pattern: 'solid' };
  if (n.includes('steel') || n.includes('alum') || n.includes('copper') || n.includes('zinc') || n.includes('metal'))
    return { fill: [75, 85, 99], stroke: [31, 41, 55], hatch: [15, 23, 42], pattern: 'cross' };
  if (n.includes('air gap') || n.includes('still air') || n.includes('air space'))
    return { fill: [219, 234, 254], stroke: [147, 197, 253], hatch: [96, 165, 250], pattern: 'solid' };
  if (n.includes('membrane') || n.includes('felt') || n.includes('damp') || n.includes('vapour') || n.includes('vcl') || n.includes('breather'))
    return { fill: [51, 65, 85], stroke: [15, 23, 42], hatch: [0, 0, 0], pattern: 'solid' };
  if (n.includes('tile') || n.includes('ceramic') || n.includes('vinyl') || n.includes('carpet'))
    return { fill: [196, 181, 253], stroke: [139, 92, 246], hatch: [109, 40, 217], pattern: 'solid' };
  if (n.includes('bituminous') || n.includes('asphalt') || n.includes('roofing'))
    return { fill: [55, 65, 81], stroke: [30, 41, 59], hatch: [0, 0, 0], pattern: 'solid' };

  return { fill: [209, 213, 219], stroke: [148, 163, 184], hatch: [100, 116, 139], pattern: 'solid' };
}

// ─── Pattern drawing helpers ──────────────────────────────────────────────────

// Clip a diagonal line (45° going lower-left → upper-right) to a rectangle
function drawDiagonalHatch(
  pdf: jsPDF, rx: number, ry: number, rw: number, rh: number,
  color: [number, number, number], spacing = 3.5,
) {
  pdf.setDrawColor(...color);
  pdf.setLineWidth(0.15);
  for (let d = -(rh % spacing); d <= rw + rh; d += spacing) {
    // parametric line: P(t) = (rx+d + t*rh,  ry+rh - t*rh),  t ∈ [0,1]
    const ax = rx + d, ay = ry + rh, bx = rx + d + rh, by = ry;
    const dx = bx - ax, dy = by - ay; // dx=rh, dy=-rh

    // clamp t to [0,1] intersected with rect on each side
    let t0 = 0, t1 = 1;
    if (dx !== 0) { t0 = Math.max(t0, (rx - ax) / dx);       t1 = Math.min(t1, (rx + rw - ax) / dx); }
    if (dy !== 0) { t0 = Math.max(t0, (ry - ay) / dy);       t1 = Math.min(t1, (ry + rh - ay) / dy); }
    if (t0 >= t1) continue;
    pdf.line(ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy);
  }
}

function drawHorizontalHatch(
  pdf: jsPDF, rx: number, ry: number, rw: number, rh: number,
  color: [number, number, number], spacing = 4,
) {
  pdf.setDrawColor(...color);
  pdf.setLineWidth(0.15);
  for (let y = ry + spacing; y < ry + rh; y += spacing) {
    pdf.line(rx, y, rx + rw, y);
  }
}

function drawCrossHatch(
  pdf: jsPDF, rx: number, ry: number, rw: number, rh: number,
  color: [number, number, number],
) {
  drawDiagonalHatch(pdf, rx, ry, rw, rh, color, 3);
  // second pass: reverse diagonal (upper-left → lower-right)
  pdf.setDrawColor(...color);
  pdf.setLineWidth(0.15);
  for (let d = -(rh % 3); d <= rw + rh; d += 3) {
    const ax = rx + d + rh, ay = ry + rh, bx = rx + d, by = ry;
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    if (dx !== 0) { t0 = Math.max(t0, (rx - ax) / dx);       t1 = Math.min(t1, (rx + rw - ax) / dx); }
    if (dy !== 0) { t0 = Math.max(t0, (ry - ay) / dy);       t1 = Math.min(t1, (ry + rh - ay) / dy); }
    if (t0 >= t1) continue;
    pdf.line(ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy);
  }
}

function drawBrickPattern(
  pdf: jsPDF, rx: number, ry: number, rw: number, rh: number,
  color: [number, number, number],
) {
  pdf.setDrawColor(...color);
  pdf.setLineWidth(0.2);
  const courseH = Math.max(5, Math.min(8, rh / 4));
  const brickW = Math.max(12, Math.min(22, rw / Math.max(1, Math.floor(rw / 18))));
  // Horizontal course lines
  for (let cy = ry + courseH; cy < ry + rh - 0.1; cy += courseH) {
    pdf.line(rx, cy, rx + rw, cy);
  }
  // Vertical joints — alternating offset per course
  let course = 0;
  for (let cy = ry; cy < ry + rh; cy += courseH) {
    const offset = course % 2 === 0 ? 0 : brickW / 2;
    for (let vx = rx + offset; vx <= rx + rw; vx += brickW) {
      const jointY1 = cy;
      const jointY2 = Math.min(cy + courseH, ry + rh);
      pdf.line(vx, jointY1, vx, jointY2);
    }
    course++;
  }
}

// ─── Main cross-section drawing ───────────────────────────────────────────────
function drawCrossSection(
  pdf: jsPDF,
  layers: LayerResult[],
  startY: number,
  wallCategory: WallCategory,
  groundParams?: GroundParams,
): number {
  const pw = pdf.internal.pageSize.getWidth();
  const BOX_W = 140;
  const BOX_X = 14 + (pw - 28 - BOX_W) / 2; // centered in page margins
  const SEC_H = 54;
  const RSE_W = 8;
  const RSI_W = 8;
  const EARTH_W = wallCategory === 'below_ground' ? 22 : 0;

  const layersTotalW = BOX_W - EARTH_W - RSE_W - RSI_W;
  const MIN_LAYER_W = 10;
  const totalMm = layers.reduce((s, l) => s + l.thicknessMm, 0);
  const rawRatios = layers.map(l => Math.max(l.thicknessMm / totalMm, MIN_LAYER_W / layersTotalW));
  const sumRatios = rawRatios.reduce((s, r) => s + r, 0);
  const widths = rawRatios.map(r => (r / sumRatios) * layersTotalW);

  const dimH = 9;
  const legendRowH = 6;
  const legendRows = Math.ceil(layers.length / 2);
  const totalBlockH = 11 + SEC_H + dimH + 7 + legendRows * legendRowH + 4;

  if (startY + totalBlockH > 270) { pdf.addPage(); startY = 20; }

  let y = startY;
  y = sectionTitle(pdf, '2. Wall Section — Schematic (Not to Scale)', y);

  // OUTSIDE / INSIDE labels
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  pdf.setTextColor(...MID_GRAY);
  pdf.text('◀ OUTSIDE', BOX_X, y + 3.5);
  pdf.text('INSIDE ▶', BOX_X + BOX_W, y + 3.5, { align: 'right' });
  y += 6;

  const boxY = y;

  // Background
  pdf.setFillColor(...LIGHT_GRAY);
  pdf.rect(BOX_X, boxY, BOX_W, SEC_H, 'F');

  let curX = BOX_X;

  // ── Earth Zone (below_ground assemblies) ──────────────────────────────────
  if (wallCategory === 'below_ground') {
    const earthX = curX;
    const EARTH_FILL: [number, number, number] = [196, 164, 120];
    const EARTH_STROKE: [number, number, number] = [139, 90, 43];

    pdf.setFillColor(...EARTH_FILL);
    pdf.setDrawColor(...EARTH_STROKE);
    pdf.setLineWidth(0.25);
    pdf.rect(earthX, boxY, EARTH_W, SEC_H, 'FD');

    // X-mark soil texture
    pdf.setDrawColor(110, 70, 20);
    pdf.setLineWidth(0.12);
    for (let gx = earthX + 3; gx < earthX + EARTH_W - 1; gx += 4.5) {
      for (let gy = boxY + 3; gy < boxY + SEC_H - 1; gy += 4.5) {
        pdf.line(gx - 1.5, gy - 1.5, gx + 1.5, gy + 1.5);
        pdf.line(gx + 1.5, gy - 1.5, gx - 1.5, gy + 1.5);
      }
    }

    // Slope indicator line across the earth zone
    // 1:2 slope → tan(angle) = 0.5, angle ≈ 26.6°
    const slopeAngle = groundParams?.slopeAngle ?? 27;
    const angleRad = (slopeAngle * Math.PI) / 180;
    // Start from top-right of earth zone, go left & down at slope angle
    const run = EARTH_W;
    const rise = run * Math.tan(angleRad);
    const slX1 = earthX + EARTH_W;
    const slY1 = boxY + 4;
    const slX2 = Math.max(earthX, slX1 - run);
    const slY2 = Math.min(boxY + SEC_H - 2, slY1 + rise);

    pdf.setDrawColor(55, 25, 5);
    pdf.setLineWidth(0.7);
    pdf.line(slX1, slY1, slX2, slY2);

    // Second slope line lower in the zone for clarity
    const slY3 = slY1 + SEC_H * 0.35;
    const slY4 = Math.min(boxY + SEC_H - 2, slY3 + rise);
    if (slY3 < boxY + SEC_H - 4) {
      pdf.line(slX1, slY3, slX2, slY4);
    }

    // Angle label near the first slope line
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5.5);
    pdf.setTextColor(55, 25, 5);
    pdf.text(`${slopeAngle}°`, earthX + EARTH_W - 1.5, slY1 + 5, { align: 'right' });

    // "EARTH BACKFILL" label
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5);
    pdf.setTextColor(70, 40, 10);
    const ex = earthX + EARTH_W / 2;
    pdf.text('EARTH', ex, boxY + SEC_H * 0.62, { align: 'center' });
    pdf.text('BACKFILL', ex, boxY + SEC_H * 0.62 + 5, { align: 'center' });

    // Depth annotation
    if (groundParams) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(4.5);
      pdf.setTextColor(...MID_GRAY);
      pdf.text(`${groundParams.depthTop}-${groundParams.depthBottom}m`, ex, boxY + SEC_H - 1.5, { align: 'center' });
    }

    curX += EARTH_W;
  }

  // ── Rse Strip — External Surface Resistance ───────────────────────────────
  const RSE_FILL: [number, number, number] = [219, 234, 254];
  const RSE_STROKE: [number, number, number] = [147, 197, 253];
  pdf.setFillColor(...RSE_FILL);
  pdf.setDrawColor(...RSE_STROKE);
  pdf.setLineWidth(0.3);
  pdf.rect(curX, boxY, RSE_W, SEC_H, 'FD');

  const rseMidX = curX + RSE_W / 2;
  const rseMidY = boxY + SEC_H / 2;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6);
  pdf.setTextColor(...BRAND_BLUE);
  pdf.text('Rse', rseMidX, rseMidY - 1, { angle: 90, align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(4.8);
  pdf.setTextColor(...MID_GRAY);
  pdf.text('0.04', rseMidX, rseMidY + 5, { angle: 90, align: 'center' });

  curX += RSE_W;

  // ── Material Layers ────────────────────────────────────────────────────────
  const layersStartX = curX;
  layers.forEach((layer, i) => {
    const w = widths[i];
    const s = getLayerStyle(layer.materialName);

    pdf.setFillColor(...s.fill);
    pdf.setDrawColor(...s.stroke);
    pdf.setLineWidth(0.25);
    pdf.rect(curX, boxY, w, SEC_H, 'FD');

    switch (s.pattern) {
      case 'diagonal':   drawDiagonalHatch(pdf, curX, boxY, w, SEC_H, s.hatch); break;
      case 'horizontal': drawHorizontalHatch(pdf, curX, boxY, w, SEC_H, s.hatch); break;
      case 'brick':      drawBrickPattern(pdf, curX, boxY, w, SEC_H, s.hatch); break;
      case 'cross':      drawCrossHatch(pdf, curX, boxY, w, SEC_H, s.hatch); break;
    }

    pdf.setDrawColor(...s.stroke);
    pdf.setLineWidth(0.25);
    pdf.rect(curX, boxY, w, SEC_H, 'S');

    const midX = curX + w / 2;
    const midY = boxY + SEC_H / 2;
    const badgeR = Math.max(2.2, Math.min(4, w * 0.25));

    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...BRAND_BLUE);
    pdf.setLineWidth(0.4);
    pdf.circle(midX, midY, badgeR, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(Math.min(6.5, badgeR * 1.9));
    pdf.setTextColor(...BRAND_BLUE);
    pdf.text(String(i + 1), midX, midY + badgeR * 0.38, { align: 'center' });

    curX += w;
  });

  // ── Rsi Strip — Internal Surface Resistance ───────────────────────────────
  pdf.setFillColor(...RSE_FILL);
  pdf.setDrawColor(...RSE_STROKE);
  pdf.setLineWidth(0.3);
  pdf.rect(curX, boxY, RSI_W, SEC_H, 'FD');

  const rsiMidX = curX + RSI_W / 2;
  const rsiMidY = boxY + SEC_H / 2;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6);
  pdf.setTextColor(...BRAND_BLUE);
  pdf.text('Rsi', rsiMidX, rsiMidY - 1, { angle: 90, align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(4.8);
  pdf.setTextColor(...MID_GRAY);
  const rsiVal = wallCategory === 'roof' ? '0.10' : wallCategory === 'floor' ? '0.17' : '0.13';
  pdf.text(rsiVal, rsiMidX, rsiMidY + 5, { angle: 90, align: 'center' });

  curX += RSI_W;

  // ── Outer border ──────────────────────────────────────────────────────────
  pdf.setDrawColor(...BRAND_BLUE);
  pdf.setLineWidth(0.6);
  pdf.rect(BOX_X, boxY, BOX_W, SEC_H, 'S');

  // ── Dimension line spanning material layers only ───────────────────────────
  const dimY = boxY + SEC_H + 2;
  pdf.setDrawColor(...MID_GRAY);
  pdf.setLineWidth(0.25);
  pdf.line(layersStartX, dimY, layersStartX + layersTotalW, dimY);

  let dimX = layersStartX;
  layers.forEach((layer, i) => {
    const w = widths[i];
    const midX = dimX + w / 2;

    pdf.setDrawColor(...MID_GRAY);
    pdf.setLineWidth(0.25);
    pdf.line(dimX, dimY - 1, dimX, dimY + 1.5);

    if (w >= 7) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(5.5);
      pdf.setTextColor(...DARK);
      pdf.text(`${layer.thicknessMm}`, midX, dimY + 4.5, { align: 'center' });
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(4.5);
      pdf.setTextColor(...MID_GRAY);
      pdf.text('mm', midX, dimY + 7.5, { align: 'center' });
    }
    dimX += w;
  });
  pdf.setDrawColor(...MID_GRAY);
  pdf.line(dimX, dimY - 1, dimX, dimY + 1.5);

  y = dimY + dimH;

  // ── Legend ────────────────────────────────────────────────────────────────
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  pdf.setTextColor(...BRAND_BLUE);
  pdf.text('Key:', BOX_X, y + 4);
  y += 6;

  const colW = BOX_W / 2;
  layers.forEach((layer, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = BOX_X + col * colW;
    const ly = y + row * legendRowH;
    const s = getLayerStyle(layer.materialName);

    pdf.setFillColor(...s.fill);
    pdf.setDrawColor(...s.stroke);
    pdf.setLineWidth(0.2);
    pdf.rect(lx, ly - 3.2, 5, 4, 'FD');

    if (s.pattern === 'diagonal')
      drawDiagonalHatch(pdf, lx, ly - 3.2, 5, 4, s.hatch, 2);
    else if (s.pattern === 'brick')
      drawBrickPattern(pdf, lx, ly - 3.2, 5, 4, s.hatch);
    else if (s.pattern === 'horizontal')
      drawHorizontalHatch(pdf, lx, ly - 3.2, 5, 4, s.hatch, 2);

    pdf.setDrawColor(...s.stroke);
    pdf.setLineWidth(0.2);
    pdf.rect(lx, ly - 3.2, 5, 4, 'S');

    const label = `${i + 1}.  ${layer.materialName}  (${layer.thicknessMm} mm)`;
    const truncated = label.length > 44 ? label.slice(0, 42) + '…' : label;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(...DARK);
    pdf.text(truncated, lx + 6.5, ly, { maxWidth: colW - 8 });
  });

  y += legendRows * legendRowH + 2;
  return y;
}

// ─── PDF page helpers ─────────────────────────────────────────────────────────
function pageHeader(pdf: jsPDF, title: string, subtitle: string) {
  const pw = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...BRAND_BLUE);
  pdf.rect(0, 0, pw, 28, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text('HVAC Load Master', 14, 11);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.text('Thermal Assembly Report — U Builder', 14, 17);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title, pw - 14, 10, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.text(subtitle, pw - 14, 16, { align: 'right' });
  pdf.text(`Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`, pw - 14, 22, { align: 'right' });
  pdf.setTextColor(...DARK);
}

function sectionTitle(pdf: jsPDF, text: string, y: number): number {
  pdf.setFillColor(...LIGHT_GRAY);
  pdf.rect(14, y, pdf.internal.pageSize.getWidth() - 28, 7, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8.5);
  pdf.setTextColor(...BRAND_BLUE);
  pdf.text(text.toUpperCase(), 16, y + 5);
  pdf.setTextColor(...DARK);
  return y + 11;
}

function infoRow(pdf: jsPDF, label: string, value: string, y: number, x1 = 14, x2 = 55): number {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...MID_GRAY);
  pdf.text(label, x1, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...DARK);
  pdf.text(value, x2, y);
  return y + 5.5;
}

function pageFooter(pdf: jsPDF, pageNum: number) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  pdf.setDrawColor(220, 226, 232);
  pdf.setLineWidth(0.3);
  pdf.line(14, ph - 12, pw - 14, ph - 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(...MID_GRAY);
  pdf.text('HVAC Load Master — U Builder  |  Generated by Creative Concept', 14, ph - 7);
  pdf.text(`Page ${pageNum}`, pw - 14, ph - 7, { align: 'right' });
}

// ─── Main PDF Generator ───────────────────────────────────────────────────────
export function generateAssemblyPDF(assembly: UAssembly, result: UValueResult) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  let y = 34;
  let pageNum = 1;

  pageHeader(pdf, assembly.name, WALL_CATEGORY_LABELS[assembly.wallCategory] ?? assembly.wallCategory);

  // ── 1. Assembly Overview ───────────────────────────────────────────────────
  y = sectionTitle(pdf, '1. Assembly Overview', y);
  y = infoRow(pdf, 'Assembly Name:', assembly.name, y);
  y = infoRow(pdf, 'Element Type:', WALL_CATEGORY_LABELS[assembly.wallCategory] ?? assembly.wallCategory, y);
  y = infoRow(pdf, 'Calculation Method:', result.method === 'ISO_13370' ? 'ISO 13370:2017 (Below-Ground)' : 'ISO 6946:2017 (Above-Ground)', y);
  if (assembly.ashraeReference) y = infoRow(pdf, 'Reference:', assembly.ashraeReference, y);
  if (assembly.description)     y = infoRow(pdf, 'Description:', assembly.description, y);
  y += 4;

  // ── 2. Wall Section Schematic ──────────────────────────────────────────────
  y = drawCrossSection(pdf, result.layerResults, y, assembly.wallCategory, assembly.groundParams);
  y += 4;

  // ── 3. Construction Layers ─────────────────────────────────────────────────
  if (y > 230) { pdf.addPage(); pageNum++; pageHeader(pdf, assembly.name, 'continued'); y = 34; }
  y = sectionTitle(pdf, '3. Construction Layers (Outside → Inside)', y);

  autoTable(pdf, {
    startY: y,
    head: [['#', 'Material', 'Thickness (mm)', 'λ (W/mK)', 'R (m²K/W)']],
    body: result.layerResults.map((l, i) => [
      i + 1,
      l.materialName,
      l.thicknessMm.toString(),
      l.lambda.toFixed(3),
      l.r.toFixed(4),
    ]),
    headStyles: { fillColor: BRAND_BLUE, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: DARK },
    alternateRowStyles: { fillColor: LIGHT_GRAY },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 32, fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [220, 226, 232],
    tableLineWidth: 0.2,
  });
  y = (pdf as any).lastAutoTable.finalY + 6;

  // ── 4. Thermal Resistance Summary ─────────────────────────────────────────
  if (y > 230) { pdf.addPage(); pageNum++; pageHeader(pdf, assembly.name, 'continued'); y = 34; }
  y = sectionTitle(pdf, '4. Thermal Resistance Summary', y);

  const rRows: [string, string, string][] = [
    ['Internal Surface Resistance (R_si)', 'ISO 6946 / element type', result.rsi.toFixed(4)],
    ...result.layerResults.map(l => [`  ${l.materialName} (${l.thicknessMm} mm)`, 'd / λ', l.r.toFixed(4)] as [string, string, string]),
    ['External Surface Resistance (R_se)', 'ISO 6946 / element type', result.rse.toFixed(4)],
  ];

  autoTable(pdf, {
    startY: y,
    head: [['Component', 'Formula / Basis', 'R (m²K/W)']],
    body: rRows,
    foot: [['TOTAL Thermal Resistance (R_total)', '', result.rTotal.toFixed(4)]],
    headStyles: { fillColor: BRAND_BLUE, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: DARK },
    footStyles: { fillColor: BRAND_BLUE, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: LIGHT_GRAY },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 50 },
      2: { halign: 'right', cellWidth: 32, fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [220, 226, 232],
    tableLineWidth: 0.2,
  });
  y = (pdf as any).lastAutoTable.finalY + 6;

  // ── 5. U-Value Result ──────────────────────────────────────────────────────
  if (y > 230) { pdf.addPage(); pageNum++; pageHeader(pdf, assembly.name, 'continued'); y = 34; }
  y = sectionTitle(pdf, '5. U-Value Result', y);

  pdf.setFillColor(239, 246, 255);
  pdf.setDrawColor(...BRAND_BLUE);
  pdf.setLineWidth(0.5);
  pdf.roundedRect(14, y, pw - 28, 22, 3, 3, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.setTextColor(...BRAND_BLUE);
  pdf.text('U-Value  =  1 / R_total', 20, y + 9);

  pdf.setFontSize(18);
  pdf.text(`${result.uValue.toFixed(3)} W/m²K`, pw - 18, y + 12, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MID_GRAY);
  pdf.text(`1 / ${result.rTotal.toFixed(4)} = ${result.uValue.toFixed(3)} W/m²K`, 20, y + 17);
  pdf.text(
    result.method === 'ISO_13370'
      ? 'ISO 13370:2017 weighted average of depth strips'
      : 'ISO 6946:2017 one-dimensional steady-state method',
    pw - 18, y + 17, { align: 'right' },
  );
  y += 28;

  // ── 6 & 7. Ground Contact + Strip Table (ISO 13370 only) ──────────────────
  if (result.method === 'ISO_13370' && assembly.groundParams && result.strips?.length) {
    if (y > 200) { pdf.addPage(); pageNum++; pageHeader(pdf, assembly.name, 'continued'); y = 34; }
    y = sectionTitle(pdf, '6. Ground Contact Parameters (ISO 13370)', y);

    const gp = assembly.groundParams;
    y = infoRow(pdf, 'Soil Type:', gp.soilName, y);
    y = infoRow(pdf, 'Soil Conductivity (λ_soil):', `${gp.soilLambda} W/mK`, y);
    y = infoRow(pdf, 'Backfill Depth — Top:', `${gp.depthTop} m below ground surface`, y);
    y = infoRow(pdf, 'Backfill Depth — Bottom:', `${gp.depthBottom} m below ground surface`, y);
    y = infoRow(pdf, 'Slope Angle:', gp.slopeAngle > 0 ? `${gp.slopeAngle}° (sloped backfill face)` : '0° (vertical backfill face)', y);
    y += 4;

    y = sectionTitle(pdf, '7. Depth Strip Breakdown (ISO 13370 §9.3.2)', y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...MID_GRAY);
    pdf.text('U(z) = (2λ_soil / π) × (1 / (z + dt)) × ln(z/dt + 1)    where dt = wall thickness + λ_soil × (R_si + R_wall + R_se)', 14, y);
    y += 6;

    autoTable(pdf, {
      startY: y,
      head: [['Depth Midpoint (m)', 'Strip Height (m)', 'U at Depth (W/m²K)', 'Weighted Contribution']],
      body: result.strips.map(s => [
        s.depthMidpoint.toFixed(2),
        s.stripHeight.toFixed(2),
        s.uAtDepth.toFixed(3),
        (s.uAtDepth * s.area).toFixed(4),
      ]),
      foot: [['Weighted Average U-Value', '', `${result.weightedU?.toFixed(3)} W/m²K`, '']],
      headStyles: { fillColor: [180, 83, 9] as [number, number, number], textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.5, textColor: DARK },
      footStyles: { fillColor: [180, 83, 9] as [number, number, number], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255, 251, 235] as [number, number, number] },
      columnStyles: {
        0: { halign: 'center' },
        1: { halign: 'center' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });
    y = (pdf as any).lastAutoTable.finalY + 6;
  }

  // ── Standards & Notes ──────────────────────────────────────────────────────
  if (y > 250) { pdf.addPage(); pageNum++; pageHeader(pdf, assembly.name, 'continued'); y = 34; }
  const notesNum = result.method === 'ISO_13370' ? '8' : '6';
  y = sectionTitle(pdf, `${notesNum}. Standards & Notes`, y);

  const notes = [
    '• Material thermal conductivity (λ) values sourced from ASHRAE Handbook of Fundamentals 2021, Chapter 26.',
    result.method === 'ISO_13370'
      ? '• Below-ground U-value calculated per ISO 13370:2017 — Heat transfer via the ground.'
      : '• U-value calculated per ISO 6946:2017 — Building components and building elements.',
    '• Surface resistances: Walls R_si=0.13, R_se=0.04 m²K/W (ISO 6946 Table 1). Roofs R_si=0.10. Floors R_si=0.17.',
    '• Section diagram is schematic and not to scale. Layer widths are proportional to actual thickness with a minimum display width.',
    '• This report is for design reference only. Site conditions and thermal bridging effects may alter actual performance.',
  ];

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(...MID_GRAY);
  notes.forEach(note => { pdf.text(note, 14, y); y += 5; });

  // ── Footer on each page ────────────────────────────────────────────────────
  pageFooter(pdf, pageNum);

  const safeName = assembly.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  pdf.save(`u_value_${safeName}.pdf`);
}
