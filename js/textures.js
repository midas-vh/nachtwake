// Procedurele textures (geen externe beelden nodig): steen, natte strepen, plassen, glas-in-lood, gezicht.
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Tegelbare value-noise met fbm
function makeNoise(period, seed) {
  const r = rng(seed), lat = new Float32Array(period * period);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const at = (x, y) => lat[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(size, basePeriod, octaves, seed, sx = 1, sy = 1) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise(basePeriod << o, seed + o * 101));
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 0.5, tot = 0;
    for (let o = 0; o < octaves; o++) {
      const p = basePeriod << o;
      v += layers[o]((x / size) * p * sx, (y / size) * p * sy) * amp; tot += amp; amp *= 0.5;
    }
    out[y * size + x] = v / tot;
  }
  return out;
}
function toTexture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

// Steen: albedo met blokken en vuil (sRGB) + natheid (R) met verticale druipstrepen
export function stoneTextures(size = 512) {
  const n = fbm(size, 4, 6, 7);
  const grime = fbm(size, 2, 5, 33);
  const streak = fbm(size, 8, 4, 91, 1, 0.12);   // uitgerekt in v -> verticale strepen
  const ca = canvas(size), cw = canvas(size);
  const A = ca.getContext('2d').createImageData(size, size), W = cw.getContext('2d').createImageData(size, size);
  const rows = 4, cols = 2;  // 2 m per tegel bij uScale 0.5: lagen van 0,5 m, blokken van 1 m
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const row = Math.floor(y / size * rows);
    const off = (row % 2) * 0.5;
    const fu = (x / size * cols + off) % 1, fv = (y / size * rows) % 1;
    const joint = Math.min(fu, 1 - fu) * (size / cols) < 2.2 || Math.min(fv, 1 - fv) * (size / rows) < 2.2;
    const blockTone = 0.92 + 0.16 * makeBlockTone(row, Math.floor(x / size * cols + off));
    let v = (0.55 + 0.45 * n[i]) * blockTone * (0.7 + 0.3 * grime[i]);
    if (joint) v *= 0.45;
    const r = 0.58 * v, g = 0.55 * v, b = 0.50 * v;
    A.data[i * 4] = r * 255; A.data[i * 4 + 1] = g * 255; A.data[i * 4 + 2] = b * 255; A.data[i * 4 + 3] = 255;
    const wet = Math.max(0, Math.min(1, (streak[i] - 0.47) * 4.5)) * (0.6 + 0.4 * grime[i]) + (joint ? 0.25 : 0);
    W.data[i * 4] = Math.min(255, wet * 255); W.data[i * 4 + 1] = n[i] * 255; W.data[i * 4 + 2] = 0; W.data[i * 4 + 3] = 255;
  }
  ca.getContext('2d').putImageData(A, 0, 0); cw.getContext('2d').putImageData(W, 0, 0);
  return { albedo: toTexture(ca, true), wet: toTexture(cw, false) };
}
const blockR = rng(5); const blockCache = {};
function makeBlockTone(r, c) { const k = r + ':' + c; if (!(k in blockCache)) blockCache[k] = blockR() - 0.5; return blockCache[k]; }

// Plassen: R = plasmasker, G/B = rimpel-ruis voor vervorming van de weerspiegeling
export function puddleTexture(size = 512) {
  const a = fbm(size, 3, 5, 222), b = fbm(size, 16, 3, 7), c = fbm(size, 16, 3, 8);
  const cv = canvas(size), D = cv.getContext('2d').createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    D.data[i * 4] = a[i] * 255; D.data[i * 4 + 1] = b[i] * 255; D.data[i * 4 + 2] = c[i] * 255; D.data[i * 4 + 3] = 255;
  }
  cv.getContext('2d').putImageData(D, 0, 0);
  return toTexture(cv, false);
}

// Glas-in-lood: Voronoi-cellen met loodlijnen
export function stainedGlassTexture(palette, size = 256, cells = 46, seed = 3) {
  const r = rng(seed), pts = [];
  for (let i = 0; i < cells; i++) pts.push([r() * size, r() * size, palette[Math.floor(r() * palette.length)]]);
  const cv = canvas(size), D = cv.getContext('2d').createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let d1 = 1e9, d2 = 1e9, col = null;
    for (const [px, py, c] of pts) {
      for (let ox = -size; ox <= size; ox += size) for (let oy = -size; oy <= size; oy += size) {
        const dx = x - px - ox, dy = y - py - oy, d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; col = c; } else if (d < d2) d2 = d;
      }
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1);
    const lead = edge < 1.8 ? 0.03 : 1;
    const i = (y * size + x) * 4;
    D.data[i] = col[0] * lead; D.data[i + 1] = col[1] * lead; D.data[i + 2] = col[2] * lead; D.data[i + 3] = 255;
  }
  cv.getContext('2d').putImageData(D, 0, 0);
  return toTexture(cv, true);
}

// Gezicht van het wezen (ook gebruikt voor de schrik-overlay)
export function faceCanvas(size = 512) {
  const cv = canvas(size), g = cv.getContext('2d');
  const r = rng(666);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size * 0.52;
  // huid
  const skin = g.createRadialGradient(cx, cy - 40, 30, cx, cy, size * 0.42);
  skin.addColorStop(0, '#c9c6b8'); skin.addColorStop(0.55, '#8f8b7c'); skin.addColorStop(1, '#1a1814');
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(cx, cy, size * 0.3, size * 0.44, 0, 0, Math.PI * 2); g.fill();
  // aders en barsten
  g.strokeStyle = 'rgba(40,30,35,0.55)';
  for (let k = 0; k < 26; k++) {
    g.lineWidth = 0.6 + r() * 1.6; g.beginPath();
    let x = cx + (r() - 0.5) * size * 0.5, y = cy + (r() - 0.5) * size * 0.7; g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (r() - 0.5) * 40; y += (r() - 0.3) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  // oogkassen
  for (const sx of [-1, 1]) {
    const ex = cx + sx * size * 0.12, ey = cy - size * 0.09;
    const eg = g.createRadialGradient(ex, ey, 2, ex, ey, size * 0.11);
    eg.addColorStop(0, '#000'); eg.addColorStop(0.6, 'rgba(0,0,0,0.95)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = eg; g.beginPath(); g.ellipse(ex, ey, size * 0.1, size * 0.08, sx * 0.25, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,250,235,0.95)';
    g.beginPath(); g.arc(ex + sx * 3, ey + 4, size * 0.009, 0, Math.PI * 2); g.fill();
    // bloedtranen
    g.strokeStyle = 'rgba(70,4,6,0.85)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ex, ey + size * 0.06);
    g.bezierCurveTo(ex + sx * 4, ey + size * 0.15, ex - sx * 3, ey + size * 0.22, ex + sx * 2, ey + size * 0.3); g.stroke();
  }
  // neus: twee spleten
  g.fillStyle = '#0a0808';
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * 9, cy + size * 0.06, 4, 11, sx * 0.3, 0, Math.PI * 2); g.fill(); }
  // gapende mond
  const my = cy + size * 0.22;
  const mg = g.createRadialGradient(cx, my, 4, cx, my, size * 0.14);
  mg.addColorStop(0, '#000'); mg.addColorStop(0.8, '#120404'); mg.addColorStop(1, 'rgba(18,4,4,0)');
  g.fillStyle = mg; g.beginPath(); g.ellipse(cx, my, size * 0.085, size * 0.15, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#bdb59a';
  for (let k = 0; k < 9; k++) {   // tanden
    const a = -0.9 + k * 0.225, tx = cx + Math.sin(a) * size * 0.075, ty = my - Math.cos(a) * size * 0.13;
    g.beginPath(); g.moveTo(tx - 4, ty); g.lineTo(tx + 4, ty); g.lineTo(tx, ty + 10 + r() * 14); g.fill();
  }
  return cv;
}

export function faceTexture(cv) { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }

// Zachte gloed-sprite
export function glowTexture(size = 128) {
  const cv = canvas(size), g = cv.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
