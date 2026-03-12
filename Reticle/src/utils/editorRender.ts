import type { ArrowObject, EmojiSticker, BlurObject } from '../stores/editor';
import type { ShaderParams } from './shaderBackground';
import { renderShaderFrame } from './shaderBackground';

export interface EditorRenderState {
  imageData: string | null;
  padding: number;
  borderRadius: number;
  background: string;
  backgroundImage: string | null;
  backgroundBlur: number;
  shaderEnabled: boolean;
  shaderParams: ShaderParams;
  shadowX: number;
  shadowY: number;
  shadowBlur: number;
  shadowSpread: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowInset: boolean;
  blurs: BlurObject[];
  arrows: ArrowObject[];
  stickers: EmojiSticker[];
}

export async function renderEditorImageAsBytes(state: EditorRenderState): Promise<Uint8Array> {
  if (!state.imageData) {
    throw new Error('No image data');
  }

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = state.imageData!;
  });

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const pad = state.padding;
  const totalW = iw + pad * 2;
  const totalH = ih + pad * 2;

  const offscreen = document.createElement('canvas');
  offscreen.width = totalW;
  offscreen.height = totalH;
  const ctx = offscreen.getContext('2d')!;

  if (state.shaderEnabled && state.shaderParams) {
    const shaderOffscreen = new OffscreenCanvas(totalW, totalH);
    const shaderCtx = shaderOffscreen.getContext('2d')!;
    renderShaderFrame(shaderCtx, totalW, totalH, performance.now() / 1000, state.shaderParams);
    ctx.drawImage(shaderOffscreen, 0, 0);
  } else if (state.backgroundImage) {
    const bgImg = new Image();
    await new Promise<void>((resolve) => {
      bgImg.onload = () => resolve();
      bgImg.onerror = () => resolve();
      bgImg.src = state.backgroundImage!;
    });
    ctx.save();
    if (state.backgroundBlur > 0) ctx.filter = `blur(${state.backgroundBlur}px)`;
    const sc = Math.max(totalW / bgImg.naturalWidth, totalH / bgImg.naturalHeight);
    const sw = bgImg.naturalWidth * sc;
    const sh = bgImg.naturalHeight * sc;
    ctx.drawImage(bgImg, (totalW - sw) / 2, (totalH - sh) / 2, sw, sh);
    ctx.restore();
  } else {
    ctx.fillStyle = parseCssBackground(ctx, state.background, totalW, totalH);
    ctx.fillRect(0, 0, totalW, totalH);
  }

  const clampedR = Math.min(state.borderRadius, iw / 2, ih / 2);
  if (!state.shadowInset && state.shadowOpacity > 0) {
    const hex = state.shadowColor.startsWith('#') ? state.shadowColor.slice(1) : '000000';
    const sr = parseInt(hex.substring(0, 2), 16);
    const sg = parseInt(hex.substring(2, 4), 16);
    const sb = parseInt(hex.substring(4, 6), 16);
    const farAway = totalW + totalH + state.shadowBlur * 4 + 9999;

    ctx.save();
    ctx.shadowColor = `rgba(${sr},${sg},${sb},${state.shadowOpacity})`;
    ctx.shadowBlur = state.shadowBlur;
    ctx.shadowOffsetX = state.shadowX + farAway;
    ctx.shadowOffsetY = state.shadowY;
    ctx.fillStyle = 'rgba(0,0,0,1)';
    roundRect(
      ctx,
      pad - state.shadowSpread - farAway,
      pad - state.shadowSpread,
      iw + state.shadowSpread * 2,
      ih + state.shadowSpread * 2,
      clampedR,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundRect(ctx, pad, pad, iw, ih, clampedR);
  ctx.clip();
  ctx.drawImage(img, pad, pad, iw, ih);

  const { pixelate } = await import('./canvasEffects');
  state.blurs.forEach((b) => pixelate(ctx, pad + b.x, pad + b.y, b.w, b.h));
  ctx.restore();

  state.arrows.forEach((a) => drawArrow(ctx, pad + a.x1, pad + a.y1, pad + a.x2, pad + a.y2, a.color, a.width || 5));

  for (const s of state.stickers) {
    ctx.save();
    ctx.translate(pad + s.x * iw, pad + s.y * ih);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.font = `${s.size * iw}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.emoji, 0, 0);
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  return new Uint8Array(await blob.arrayBuffer());
}

function parseCssBackground(ctx: CanvasRenderingContext2D, bg: string, w: number, h: number): string | CanvasGradient {
  const linear = bg.match(/^linear-gradient\((.+)\)$/s);
  if (linear) {
    return parseCssLinearGradient(ctx, linear[1].trim(), w, h) ?? bg;
  }
  const radial = bg.match(/^radial-gradient\((.+)\)$/s);
  if (radial) {
    return parseCssRadialGradient(ctx, radial[1].trim(), w, h) ?? bg;
  }
  return bg;
}

function parseCssLinearGradient(
  ctx: CanvasRenderingContext2D,
  inner: string,
  w: number,
  h: number,
): CanvasGradient | null {
  try {
    const parts = splitTopLevel(inner);
    let angle = 135;
    let stopStart = 0;

    const first = parts[0].trim();
    if (first.startsWith('to ') || /^-?\d/.test(first)) {
      stopStart = 1;
      if (first.startsWith('to ')) {
        const dir = first.slice(3).trim();
        const dirMap: Record<string, number> = {
          top: 0, 'right top': 45, right: 90, 'right bottom': 135,
          bottom: 180, 'left bottom': 225, left: 270, 'left top': 315,
        };
        angle = dirMap[dir] ?? 135;
      } else {
        angle = parseFloat(first);
      }
    }

    const rad = ((angle - 90) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const len = Math.abs(w * cos) + Math.abs(h * sin);
    const cx = w / 2;
    const cy = h / 2;
    const x0 = cx - (cos * len) / 2;
    const y0 = cy - (sin * len) / 2;
    const x1 = cx + (cos * len) / 2;
    const y1 = cy + (sin * len) / 2;

    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    const stops = parts.slice(stopStart);
    addColorStops(grad, stops);
    return grad;
  } catch {
    return null;
  }
}

function parseCssRadialGradient(
  ctx: CanvasRenderingContext2D,
  inner: string,
  w: number,
  h: number,
): CanvasGradient | null {
  try {
    const parts = splitTopLevel(inner);
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
    addColorStops(grad, parts);
    return grad;
  } catch {
    return null;
  }
}

function addColorStops(grad: CanvasGradient, stops: string[]) {
  const n = stops.length;
  stops.forEach((stop, i) => {
    const s = stop.trim();
    const posMatch = s.match(/\s+([\d.]+%|[\d.]+px)$/);
    let color = s;
    let pos = i / Math.max(n - 1, 1);
    if (posMatch) {
      color = s.slice(0, s.length - posMatch[0].length).trim();
      pos = posMatch[1].endsWith('%') ? parseFloat(posMatch[1]) / 100 : parseFloat(posMatch[1]);
    }
    grad.addColorStop(Math.min(1, Math.max(0, pos)), color);
  });
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') depth -= 1;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  const headLength = 20 + width;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lineEndX = x2 - headLength * 0.7 * Math.cos(angle);
  const lineEndY = y2 - headLength * 0.7 * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lineEndX, lineEndY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
  ctx.lineTo(x2, y2);
  ctx.fill();
  ctx.restore();
}
