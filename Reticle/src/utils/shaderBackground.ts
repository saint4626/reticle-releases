/**
 * Layered shader background — soft glowing blobs like shaders.app / Apple mesh gradient.
 * Layers: Blob1, Blob2, Swirl, ChromaticAberration, FilmGrain
 */

export interface BlobLayer {
  enabled: boolean;
  colorA: string;
  colorB: string;
  size: number;       // 0.2 – 2.0
  deformation: number; // 0.0 – 3.0
}

export interface SwirlLayer {
  enabled: boolean;
  strength: number; // 0.0 – 3.0
  speed: number;    // 0.1 – 2.0
}

export interface HalftoneLayer {
  enabled: boolean;
  strength: number; // 0.0 – 1.0  (dot contrast)
  size: number;     // 2.0 – 20.0 (dot grid size in px)
}

export interface ShaderParams {
  speed: number;
  baseColor: string; // hex — background base color
  blob1: BlobLayer;
  blob2: BlobLayer;
  swirl: SwirlLayer;
  halftone: HalftoneLayer;
}

export const DEFAULT_SHADER_PARAMS: ShaderParams = {
  speed: 0.4,
  baseColor: '#0a0812',
  blob1: { enabled: true,  colorA: '#6366f1', colorB: '#a855f7', size: 1.1, deformation: 1.4 },
  blob2: { enabled: true,  colorA: '#ec4899', colorB: '#06b6d4', size: 1.0, deformation: 1.6 },
  swirl: { enabled: true,  strength: 1.4, speed: 0.5 },
  halftone: { enabled: false, strength: 0.6, size: 6.0 },
};

// Palette of visually pleasing colors for randomization
const RAND_COLORS = [
  '#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e',
  '#06b6d4','#0ea5e9','#3b82f6','#10b981','#84cc16',
  '#f59e0b','#ef4444','#14b8a6','#e879f9','#fb923c',
  '#ffffff','#f0f9ff','#fdf4ff','#fff7ed','#f0fdf4',
];

function randColor() {
  return RAND_COLORS[Math.floor(Math.random() * RAND_COLORS.length)];
}
function randFloat(min: number, max: number) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

export function randomizeShaderParams(): ShaderParams {
  // Pick a base color — 50% chance light, 50% dark for variety
  const lightBases = ['#ffffff','#f8f8ff','#fff0f5','#f0f8ff','#fffaf0','#f5f5f5'];
  const darkBases  = ['#0a0812','#0d0d1a','#0f0a1e','#050510','#0a1628','#1a0a0a'];
  const bases = Math.random() > 0.5 ? lightBases : darkBases;
  const baseColor = bases[Math.floor(Math.random() * bases.length)];

  return {
    speed: randFloat(0.2, 1.2),
    baseColor,
    blob1: {
      enabled: true,
      colorA: randColor(),
      colorB: randColor(),
      size: randFloat(0.6, 1.8),
      deformation: randFloat(0.5, 2.5),
    },
    blob2: {
      enabled: Math.random() > 0.2,
      colorA: randColor(),
      colorB: randColor(),
      size: randFloat(0.6, 1.6),
      deformation: randFloat(0.5, 2.5),
    },
    swirl: {
      enabled: Math.random() > 0.3,
      strength: randFloat(0.5, 2.5),
      speed: randFloat(0.2, 1.5),
    },
    halftone: {
      enabled: Math.random() > 0.6,
      strength: randFloat(0.3, 0.8),
      size: randFloat(4.0, 12.0),
    },
  };
}

// ---- GLSL ----

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Key visual technique from the reference screenshot:
// - Each blob is a large smooth radial gradient (gaussian-like falloff)
// - Blobs are composited with SCREEN blending: out = 1-(1-a)*(1-b)
//   This makes overlapping areas brighter and more saturated, not averaged
// - Dark base background so colors pop
// - Swirl = rotational warp that tightens toward center
// - No normalization — let colors accumulate and saturate naturally
const FRAG_SRC = `#version 300 es
precision highp float;

uniform vec2  u_res;
uniform float u_time;

uniform int   u_b1_on;
uniform vec3  u_b1_ca;
uniform vec3  u_b1_cb;
uniform float u_b1_size;
uniform float u_b1_def;

uniform int   u_b2_on;
uniform vec3  u_b2_ca;
uniform vec3  u_b2_cb;
uniform float u_b2_size;
uniform float u_b2_def;

uniform int   u_sw_on;
uniform float u_sw_str;
uniform float u_sw_spd;

uniform int   u_ht_on;
uniform float u_ht_str;
uniform float u_ht_size;

uniform vec3  u_base;

in vec2 v_uv;
out vec4 fragColor;

// ---- Noise ----
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(dot(hash2(i+vec2(0,0)),f-vec2(0,0)), dot(hash2(i+vec2(1,0)),f-vec2(1,0)),u.x),
             mix(dot(hash2(i+vec2(0,1)),f-vec2(0,1)), dot(hash2(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);
}
float fbm(vec2 p) {
  mat2 r = mat2(0.8,0.6,-0.6,0.8);
  float v=0.0, a=0.5;
  for(int i=0;i<3;i++){v+=a*gnoise(p);p=r*p*2.0;a*=0.5;}
  return v;
}

// Gaussian blob — large, soft, glowing
float gblob(vec2 uv, vec2 center, float radius) {
  float d2 = dot(uv-center, uv-center);
  // Gaussian falloff: e^(-d²/r²) — much softer than smoothstep, no hard edge
  return exp(-d2 / (radius * radius * 0.5));
}

// Screen blend: makes overlaps brighter (like light mixing)
vec3 screen(vec3 a, vec3 b) {
  return 1.0 - (1.0-a)*(1.0-b);
}

// True mesh-gradient composite: directly interpolates base toward blob color.
// Works on ANY background (dark or light) because it's pure lerp, not a blend mode.
// Multiple blobs accumulate by each pulling the color toward themselves weighted by strength.
vec3 blendBlob(vec3 base, vec3 blobColor, float weight) {
  return mix(base, blobColor, clamp(weight * 0.85, 0.0, 1.0));
}

// Swirl: rotate UV around center, angle decreases with distance
vec2 swirl(vec2 uv, vec2 center, float angle) {
  vec2 d = uv - center;
  float dist = length(d);
  float a = angle * exp(-dist * 2.8); // tight center, loose edges
  float s = sin(a), c = cos(a);
  return center + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
}

// High-quality white noise — uniform distribution, no banding
float whiteNoise(vec2 co, float seed) {
  return fract(sin(dot(co + seed, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 renderScene(vec2 uv, float t) {
  float aspect = u_res.x / u_res.y;
  vec2 uvAR = vec2(uv.x * aspect, uv.y);

  // ---- Swirl domain warp ----
  vec2 wuv = uv;
  if (u_sw_on == 1) {
    // Animate swirl center
    vec2 sc = vec2(0.5 + 0.12*sin(t*u_sw_spd*0.3), 0.5 + 0.10*cos(t*u_sw_spd*0.25));
    float sa = u_sw_str * 1.8 * sin(t * u_sw_spd * 0.18);
    wuv = swirl(uv, sc, sa);

    // Organic FBM on top
    float wx = fbm(wuv*2.0 + vec2(t*0.06, t*0.04));
    float wy = fbm(wuv*2.0 + vec2(4.7-t*0.05, 1.1+t*0.07));
    wuv += vec2(wx,wy) * u_sw_str * 0.08;
  }
  vec2 wAR = vec2(wuv.x * aspect, wuv.y);

  // Base color
  vec3 col = u_base;

  // Accumulated blob color and total weight for weighted-average composite.
  // This is the correct mesh-gradient approach: each blob contributes its color
  // proportional to its gaussian weight. The final result is a weighted mix of
  // all blob colors blended into the base — works identically on dark AND light backgrounds.
  vec3  blobAccum = vec3(0.0);
  float blobTotal = 0.0;

  // ---- Blob 1 — two large gaussian blobs ----
  if (u_b1_on == 1) {
    float r = u_b1_size * 0.55;

    // Lissajous paths — smooth, never repeat
    vec2 c1 = vec2(aspect*(0.30 + 0.32*sin(t*0.37)),       0.35 + 0.30*cos(t*0.29));
    vec2 c2 = vec2(aspect*(0.70 + 0.28*cos(t*0.41+1.57)),  0.65 + 0.28*sin(t*0.33+2.09));

    // Deformation: FBM shifts blob center
    vec2 d1 = vec2(fbm(wAR*1.5 + vec2(0.0, t*0.08)),
                   fbm(wAR*1.5 + vec2(3.3, t*0.10))) * u_b1_def * 0.15;
    vec2 d2 = vec2(fbm(wAR*1.3 + vec2(1.1, t*0.07)),
                   fbm(wAR*1.3 + vec2(6.7, t*0.09))) * u_b1_def * 0.15;

    float w1 = gblob(wAR, c1+d1, r);
    float w2 = gblob(wAR, c2+d2, r*0.85);

    blobAccum += u_b1_ca * w1 + u_b1_cb * w2;
    blobTotal += w1 + w2;
  }

  // ---- Blob 2 ----
  if (u_b2_on == 1) {
    float r = u_b2_size * 0.52;

    vec2 c3 = vec2(aspect*(0.50 + 0.30*cos(t*0.31+3.14)),  0.50 + 0.28*sin(t*0.43+1.05));
    vec2 c4 = vec2(aspect*(0.38 + 0.24*sin(t*0.53+0.52)),  0.58 + 0.24*cos(t*0.61+3.67));

    vec2 d3 = vec2(fbm(wAR*1.4 + vec2(2.0, t*0.11)),
                   fbm(wAR*1.4 + vec2(4.4, t*0.08))) * u_b2_def * 0.15;
    vec2 d4 = vec2(fbm(wAR*1.2 + vec2(6.1, t*0.06)),
                   fbm(wAR*1.2 + vec2(0.8, t*0.12))) * u_b2_def * 0.15;

    float w3 = gblob(wAR, c3+d3, r);
    float w4 = gblob(wAR, c4+d4, r*0.9);

    blobAccum += u_b2_ca * w3 + u_b2_cb * w4;
    blobTotal += w3 + w4;
  }

  // Composite: where blobs are present, lerp base toward weighted-average blob color.
  // Clamp blend factor so overlapping blobs don't over-saturate.
  if (blobTotal > 0.001) {
    vec3 avgBlob = blobAccum / blobTotal;
    float blendFactor = clamp(blobTotal * 0.6, 0.0, 0.92);
    col = mix(col, avgBlob, blendFactor);
  }

  // Adaptive vignette: on dark base darkens corners, on light base lightens them slightly
  // so the effect is always a subtle inward focus, not a harsh dark ring on light backgrounds.
  float baseLuma = dot(u_base, vec3(0.299, 0.587, 0.114));
  vec2 vig = uv*2.0-1.0;
  float vigAmt = dot(vig,vig) * 0.18;
  col = mix(col, u_base, vigAmt * (1.0 - baseLuma * 0.6));

  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  uv.y = 1.0 - uv.y;
  float t = u_time;

  vec3 col = renderScene(uv, t);

  // ---- Halftone post-process ----
  // Classic dot-screen halftone: divides screen into a grid of cells,
  // each cell gets a dot whose radius is proportional to local luminance.
  // The dot pattern replaces the color in that cell — darker areas get
  // smaller dots (more base color shows through), brighter areas get
  // larger dots. This modulates all layers below it naturally.
  if (u_ht_on == 1) {
    // Cell size in UV space (u_ht_size is in logical pixels)
    vec2 cellSize = vec2(u_ht_size) / u_res;

    // Which cell this fragment belongs to
    vec2 cell = floor(gl_FragCoord.xy / u_ht_size);
    vec2 cellCenter = (cell + 0.5) * u_ht_size / u_res;
    // Flip Y to match UV orientation
    cellCenter.y = 1.0 - cellCenter.y;

    // Sample the scene color at the cell center to get the "representative" color
    vec3 cellCol = renderScene(cellCenter, t);
    float luma = dot(cellCol, vec3(0.299, 0.587, 0.114));

    // Distance from this fragment to its cell center (in UV space, aspect-corrected)
    vec2 toCenter = (gl_FragCoord.xy / u_res) - (cell + 0.5) * cellSize;
    toCenter.x *= u_res.x / u_res.y;
    float dist = length(toCenter / cellSize); // 0..~0.7 within cell

    // Dot radius scales with luminance: bright → big dot, dark → small dot
    float maxRadius = 0.5 * u_ht_str;
    float dotRadius = luma * maxRadius;

    // Anti-aliased dot edge
    float aa = 1.5 / (u_ht_size);
    float dot = 1.0 - smoothstep(dotRadius - aa, dotRadius + aa, dist);

    // Inside dot: use cell color. Outside dot: darken toward base (halftone shadow)
    vec3 outside = mix(col, u_base * 0.5, u_ht_str * 0.6);
    col = mix(outside, cellCol, dot);
  }

  fragColor = vec4(col, 1.0);
}
`;

// ---- Helpers ----
function hexToVec3(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
}

interface ShaderCtx {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)!);
  return s;
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)!);
  return p;
}

const UNIFORMS = [
  'u_res','u_time',
  'u_b1_on','u_b1_ca','u_b1_cb','u_b1_size','u_b1_def',
  'u_b2_on','u_b2_ca','u_b2_cb','u_b2_size','u_b2_def',
  'u_sw_on','u_sw_str','u_sw_spd',
  'u_ht_on','u_ht_str','u_ht_size',
  'u_base',
];

function initCtx(canvas: HTMLCanvasElement | OffscreenCanvas): ShaderCtx {
  const gl = (canvas as any).getContext('webgl2', { antialias: false, alpha: false }) as WebGL2RenderingContext;
  if (!gl) throw new Error('WebGL2 not available');
  const program = buildProgram(gl);
  gl.useProgram(program);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of UNIFORMS) uniforms[n] = gl.getUniformLocation(program, n);
  return { gl, program, uniforms };
}

function drawFrame(ctx: ShaderCtx, w: number, h: number, time: number, p: ShaderParams) {
  const { gl: g, uniforms: u } = ctx;
  g.viewport(0, 0, w, h);
  g.uniform2f(u.u_res, w, h);
  g.uniform1f(u.u_time, time);
  g.uniform1i(u.u_b1_on, p.blob1.enabled?1:0);
  g.uniform3fv(u.u_b1_ca, hexToVec3(p.blob1.colorA));
  g.uniform3fv(u.u_b1_cb, hexToVec3(p.blob1.colorB));
  g.uniform1f(u.u_b1_size, p.blob1.size);
  g.uniform1f(u.u_b1_def, p.blob1.deformation);
  g.uniform1i(u.u_b2_on, p.blob2.enabled?1:0);
  g.uniform3fv(u.u_b2_ca, hexToVec3(p.blob2.colorA));
  g.uniform3fv(u.u_b2_cb, hexToVec3(p.blob2.colorB));
  g.uniform1f(u.u_b2_size, p.blob2.size);
  g.uniform1f(u.u_b2_def, p.blob2.deformation);
  g.uniform1i(u.u_sw_on, p.swirl.enabled?1:0);
  g.uniform1f(u.u_sw_str, p.swirl.strength);
  g.uniform1f(u.u_sw_spd, p.swirl.speed);
  g.uniform1i(u.u_ht_on, p.halftone.enabled?1:0);
  g.uniform1f(u.u_ht_str, p.halftone.strength);
  g.uniform1f(u.u_ht_size, p.halftone.size);
  g.uniform3fv(u.u_base, hexToVec3(p.baseColor ?? '#0a0812'));
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
}

// ---- Live preview ----
export class ShaderRenderer {
  private ctx: ShaderCtx;
  private raf: number | null = null;
  private startTime = performance.now();
  public params: ShaderParams;

  constructor(canvas: HTMLCanvasElement, params: ShaderParams) {
    this.ctx = initCtx(canvas);
    this.params = { ...params };
  }

  start() {
    if (this.raf !== null) return;
    const loop = () => {
      const t = ((performance.now() - this.startTime) / 1000) * this.params.speed;
      drawFrame(this.ctx, this.ctx.gl.canvas.width, this.ctx.gl.canvas.height, t, this.params);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf !== null) { cancelAnimationFrame(this.raf); this.raf = null; }
  }

  destroy() {
    this.stop();
    this.ctx.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// ---- Export renderer ----
let _exportCtx: ShaderCtx | null = null;
let _exportCanvas: OffscreenCanvas | null = null;

export function renderShaderFrame(
  destCtx: OffscreenCanvasRenderingContext2D,
  w: number, h: number,
  time: number,
  params: ShaderParams
) {
  if (!_exportCanvas || _exportCanvas.width !== w || _exportCanvas.height !== h) {
    _exportCanvas = new OffscreenCanvas(w, h);
    _exportCtx = null;
  }
  if (!_exportCtx) _exportCtx = initCtx(_exportCanvas);
  drawFrame(_exportCtx, w, h, time * params.speed, params);
  destCtx.drawImage(_exportCanvas, 0, 0);
}

export function disposeExportShader() {
  _exportCtx?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  _exportCtx = null;
  _exportCanvas = null;
}
