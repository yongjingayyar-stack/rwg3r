/* =====================================================
   util.js — math helpers, procedural textures & sprites
   ===================================================== */
import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential smoothing */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
/** shortest-arc angle interpolation */
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
export function easeInCubic(t) { return t * t * t; }
export function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
export function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
/** deterministic PRNG for world generation */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _v = new THREE.Vector3();
/** project a world point to CSS screen coords (returns null if behind camera) */
export function toScreen(vec3, camera, w, h) {
  _v.copy(vec3).project(camera);
  if (_v.z > 1) return null;
  return [(_v.x * 0.5 + 0.5) * w, (-_v.y * 0.5 + 0.5) * h];
}

/* ---------------- procedural canvas textures ---------------- */
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function noiseFill(ctx, size, base, speckle, alpha) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(1337);
  for (let i = 0; i < size * size * 0.35; i++) {
    const x = rnd() * size, y = rnd() * size, v = rnd();
    ctx.fillStyle = `rgba(${speckle[0] + v * 40|0},${speckle[1] + v * 40|0},${speckle[2] + v * 40|0},${alpha})`;
    ctx.fillRect(x, y, 1 + v * 2, 1 + v * 2);
  }
}
export function groundTexture(repeat = 24) {
  const S = 512, [c, g] = makeCanvas(S);
  noiseFill(g, S, '#10151f', [30, 40, 55], 0.5);
  // panel seams
  g.strokeStyle = 'rgba(70,90,120,0.28)'; g.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke();
  }
  // hazard stripes accent
  g.save(); g.globalAlpha = .12; g.translate(S * .5, S * .12);
  for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? '#ffb300' : '#12161f'; g.fillRect(i * 14, 0, 8, 26); }
  g.restore();
  // glowing circuit lines
  g.strokeStyle = 'rgba(60,220,255,0.35)'; g.lineWidth = 2;
  const rnd = mulberry32(7);
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    let x = rnd() * S, y = rnd() * S; g.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      if (rnd() > .5) x += (rnd() - .5) * 180; else y += (rnd() - .5) * 180;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function concreteTexture(repeat = 1) {
  const S = 256, [c, g] = makeCanvas(S);
  noiseFill(g, S, '#232a36', [70, 80, 100], 0.55);
  g.fillStyle = 'rgba(10,12,18,0.5)';
  const rnd = mulberry32(99);
  for (let i = 0; i < 26; i++) g.fillRect(rnd() * S, rnd() * S, rnd() * 30, rnd() * 6 + 1);
  g.strokeStyle = 'rgba(140,160,190,0.12)'; g.lineWidth = 2;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(0, i * S / 5); g.lineTo(S, i * S / 5 + 8); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function neonPanelTexture(hue = 190) {
  const S = 256, [c, g] = makeCanvas(S);
  g.fillStyle = '#0a0e16'; g.fillRect(0, 0, S, S);
  const col = (a) => `hsla(${hue},100%,65%,${a})`;
  g.strokeStyle = col(.9); g.lineWidth = 4;
  g.strokeRect(10, 10, S - 20, S - 20);
  g.fillStyle = col(.85);
  for (let i = 0; i < 6; i++) g.fillRect(28, 34 + i * 30, (i % 3 + 1) * 40, 8);
  g.fillStyle = col(.25); g.fillRect(28, 24, S - 56, S - 48);
  g.fillStyle = '#0a0e16';
  for (let i = 0; i < 5; i++) g.fillRect(28, 40 + i * 44, S - 56, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function skyGradient(top = '#050a18', mid = '#12203f', bot = '#2a1436') {
  const [c, g] = makeCanvas(512);
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot);
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(42);
  for (let i = 0; i < 350; i++) {
    const x = rnd() * 512, y = rnd() * 300, r = rnd() * 1.4;
    g.fillStyle = `rgba(200,235,255,${0.15 + rnd() * 0.7})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
/** radial glow sprite used by particles, sparks and flares */
export function glowSprite(color = '#88ddff') {
  const S = 128, [c, g] = makeCanvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, color);
  gr.addColorStop(0.25, color + 'cc');
  gr.addColorStop(0.6, color + '33');
  gr.addColorStop(1, color + '00');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** soft round shadow blob under enemies/props */
export function shadowBlobTexture() {
  const S = 128, [c, g] = makeCanvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
