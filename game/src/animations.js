/* =====================================================
   animations.js — full procedural animation library
   (ZZZ-inspired: snappy attack chains, ghost-step dodge,
    perfect-parry stance, reactive hit reactions)
   ===================================================== */
import { clamp, lerp, easeOutCubic, easeInCubic, easeOutQuad } from './util.js';

const sin = Math.sin;

/* ---------- pose application helpers ---------- */
/** set additive pose values on a rig bone object {sh,el,ha} etc. */
function setArm(rig, side, sx, ex, hx, sz = 0, ez = 0) {
  const a = rig[side];
  a.sh.rotation.x += sx; a.sh.rotation.z += sz;
  a.el.rotation.x += ex; a.el.rotation.z += ez;
  if (a.ha) { a.ha.rotation.x += hx; }
}
function setLeg(rig, side, hx, kx, fx = 0) {
  const l = rig[side];
  l.hp.rotation.x += hx; l.kn.rotation.x += kx;
  if (l.ft) l.ft.rotation.x += fx;
}
const P = (rig) => rig; // readability

/* =====================================================
   LOCOMOTION
   ===================================================== */
export function animIdle(rig, t, speedFactor = 0) {
  const b = sin(t * 1.8), b2 = sin(t * 1.8 + .5);
  rig.moveRoot(-0.02 + b * 0.012);
  P(rig).pelvis.rotation.z += b * .012;
  rig.chest.rotation.x += b2 * .02 - .02;
  rig.chest.rotation.y += sin(t * .9) * .04;
  rig.head.rotation.x += -b * .02;
  rig.head.rotation.y += sin(t * .6) * .06;
  // breathing arms
  setArm(rig, 'armR', .04 + b * .03, -.08, .05, -.06 - b * .02);
  setArm(rig, 'armL', .04 + b2 * .03, -.08, .05, .06 + b2 * .02);
  // weight on legs
  setLeg(rig, 'legR', .03, -.05, 0);
  setLeg(rig, 'legL', -.02, -.03, 0);
  if (rig.sword) rig.sword.rotation.x += sin(t * 1.2) * .03;
}

export function animWalk(rig, t, s = 1) {
  const w = t * 7.5;                        // slower cadence
  const b = sin(w), c = sin(w + Math.PI / 2);
  rig.moveRoot(.015 + Math.abs(b) * .012);
  rig.chest.rotation.x += .04 * s;
  rig.pelvis.rotation.y += b * .05;
  rig.chest.rotation.y += -b * .07;
  rig.head.rotation.x += -.02;
  setLeg(rig, 'legR', b * .45 - .08, -Math.max(0, -c) * .55, Math.max(0, c) * .2);
  setLeg(rig, 'legL', -b * .45 - .08, -Math.max(0, c) * .55, Math.max(0, -c) * .2);
  setArm(rig, 'armR', -b * .3, -.25, -.1, -.05);
  setArm(rig, 'armL', b * .3, -.25, -.1, .05);
}

export function animRun(rig, t, s = 1) {
  const w = t * 11;                          // fast cadence
  const b = sin(w), c = sin(w + Math.PI / 2);
  rig.moveRoot(.03 + Math.abs(b) * .035);
  rig.chest.rotation.x += .22 * s + Math.abs(c) * .03;   // forward lean
  rig.pelvis.rotation.y += b * .1;
  rig.chest.rotation.y += -b * .16;
  rig.head.rotation.x += -.16;                             // head up while leaning
  // big strides
  setLeg(rig, 'legR', b * .8 - .15, -Math.max(0, -c) * 1.1, Math.max(0, c) * .35);
  setLeg(rig, 'legL', -b * .8 - .15, -Math.max(0, c) * 1.1, Math.max(0, -c) * .35);
  // pumping arms (weapon arm keeps blade tucked)
  setArm(rig, 'armR', -b * .7 - .1, -.7, -.3, -.1);
  setArm(rig, 'armL', b * .7, -.5 - Math.max(0, b) * .3, -.4, .12);
  if (rig.sword) { rig.sword.rotation.x += -.15; rig.sword.rotation.z += sin(w) * .06; }
}

export function animAir(rig, vy) {
  const rising = vy > 0;
  rig.moveRoot(0);
  rig.chest.rotation.x += rising ? -.1 : .12;
  setLeg(rig, 'legR', rising ? -.35 : .25, rising ? .8 : .3, 0);
  setLeg(rig, 'legL', rising ? .1 : -.15, rising ? .3 : .5, 0);
  setArm(rig, 'armR', rising ? -.9 : -.4, -.4, -.2, -.25);
  setArm(rig, 'armL', rising ? -.9 : -.4, -.4, -.2, .25);
}

export function animLand(rig, p) {        // p: 0..1 squash recover
  const sq = sin(clamp(p, 0, 1) * Math.PI);
  rig.moveRoot(-.16 * sq);
  rig.chest.rotation.x += .3 * sq;
  setLeg(rig, 'legR', .55 * sq, -.9 * sq, .3 * sq);
  setLeg(rig, 'legL', .55 * sq, -.9 * sq, .3 * sq);
  setArm(rig, 'armR', .4 * sq, .3 * sq, 0, .3 * sq);
  setArm(rig, 'armL', .4 * sq, .3 * sq, 0, -.3 * sq);
}

/* =====================================================
   ATTACK CHAIN — 5 steps with distinct silhouettes
   each: {windup, active, recovery, arc}
   ===================================================== */
export const COMBO = [
  { windup: .14, active: .10, recover: .16, dmg: 9,  name: 'Slash I' },
  { windup: .13, active: .10, recover: .16, dmg: 9,  name: 'Slash II' },
  { windup: .15, active: .12, recover: .18, dmg: 11, name: 'Slash III' },
  { windup: .17, active: .12, recover: .2,  dmg: 13, name: 'Slash IV' },
  { windup: .26, active: .18, recover: .38, dmg: 26, name: 'Finishing Breaker', finisher: true },
];
export function comboDuration(i) { const s = COMBO[i]; return s.windup + s.active + s.recover; }

/** step: combo index, p: 0..1 progress through the step */
export function animAttack(rig, step, p, twist = 0) {
  const S = COMBO[step];
  const total = S.windup + S.active + S.recover;
  const t = p * total;
  let sw = 0;                                   // sword swing phase 0..1
  let punch = 0;                                // body extension
  if (t < S.windup) {                           // anticipation (slow-in)
    const q = easeInCubic(t / S.windup);
    sw = -q * .35; punch = -q * .3;
  } else if (t < S.windup + S.active) {         // strike (explosive out)
    const q = easeOutCubic((t - S.windup) / S.active);
    sw = -.35 + 1.35 * q; punch = q;
  } else {                                      // recovery settle
    const q = (t - S.windup - S.active) / S.recover;
    sw = 1 - easeOutQuad(q) * .15; punch = 1 - q;
  }
  const A = rig.armR, B = rig.armL;

  switch (step) {
    case 0: /* diagonal right-to-left slash */
      A.sh.rotation.x += -1.4 * sw + .2; A.sh.rotation.z += (-.9 + sw * 1.6);
      A.el.rotation.x += -.9 + sw * .7;
      rig.chest.rotation.y += (.5 - sw * 1.0) * .55 + twist;
      rig.chest.rotation.x += .1 * punch;
      B.sh.rotation.x += -.3 * sw; B.sh.rotation.z += .3;
      break;
    case 1: /* reverse horizontal slash */
      A.sh.rotation.x += -.4; A.sh.rotation.z += (1.1 - sw * 2.2);
      A.el.rotation.x += -.7 + sw * .5;
      rig.chest.rotation.y += (-.55 + sw * 1.1) * .55 - twist;
      B.sh.rotation.z += .5 - sw * .3;
      break;
    case 2: /* upward launcher */
      A.sh.rotation.x += 1.2 - sw * 2.6; A.sh.rotation.z += .2;
      A.el.rotation.x += -.9 + sw * .6;
      rig.chest.rotation.x += -.25 * sw + .12 * (1 - sw);
      rig.chest.rotation.y += twist * .4;
      rig.moveRoot(Math.max(0, sw - .5) * .1);
      B.sh.rotation.x += -.4; B.sh.rotation.z += .4;
      break;
    case 3: /* spinning roundhouse cut */
      A.sh.rotation.x += -1.1; A.sh.rotation.z += -.5;
      A.el.rotation.x += -.5;
      rig.chest.rotation.y += sw * Math.PI * 1.6 + twist;
      rig.pelvis.rotation.y += sw * Math.PI * .5;
      setLeg(rig, 'legR', .3 * punch, -.4 * punch, 0);
      B.sh.rotation.z += .8;
      break;
    case 4: /* overhead breaker slam */
      A.sh.rotation.x += -2.4 + sw * 3.3; A.sh.rotation.z += -.1;
      A.el.rotation.x += -.6 + sw * .5;
      rig.chest.rotation.x += -.35 * (sw < .4 ? sw / .4 : 1) + .5 * Math.max(0, sw - .6) * 2.5;
      rig.chest.rotation.y += twist * .3;
      rig.moveRoot(sw > .55 ? -.18 : -.05);
      setLeg(rig, 'legR', .35, -.6, .2);
      setLeg(rig, 'legL', .3, -.5, .2);
      B.sh.rotation.x += -.8 + sw * .6; B.sh.rotation.z += .5;
      break;
  }
  // slight forward drift on strikes handled by player velocity
}

/** special attack (F): 360° aerial spin-burst */
export function animSpecial(rig, p) {
  const spin = easeOutCubic(clamp(p * 1.25, 0, 1)) * Math.PI * 2;
  const rise = sin(clamp(p, 0, 1) * Math.PI);
  rig.moveRoot(rise * .45);
  rig.chest.rotation.y += spin;
  rig.pelvis.rotation.y += spin * .4;
  rig.chest.rotation.x += -.15 * rise;
  const A = rig.armR;
  A.sh.rotation.x += -1.2; A.sh.rotation.z += -.9;
  A.el.rotation.x += -.3;
  const B = rig.armL;
  B.sh.rotation.x += -1.2; B.sh.rotation.z += .9;
  setLeg(rig, 'legR', -.3, .6, 0);
  setLeg(rig, 'legL', .4, -.2, 0);
  if (rig.sword) rig.sword.rotation.z += .4;
}

/* =====================================================
   DODGE / DASH — ZZZ "ghost step": sharp sidestep, low
   profile, brief after-image window (handled in player)
   ===================================================== */
export function animDodge(rig, p, dir = 0) {     // dir: -1 left, 0 back, 1 right
  const e = easeOutCubic(clamp(p * 1.6, 0, 1));   // snap out
  const settle = clamp((p - .55) / .45, 0, 1);
  rig.moveRoot(-.12 * sin(e * Math.PI));
  rig.chest.rotation.x += .45 * sin(e * Math.PI) - .1 * settle;
  rig.chest.rotation.y += dir * (1 - settle) * .8;
  rig.pelvis.rotation.z += dir * .2 * sin(e * Math.PI);
  // roll-like tuck: cross arms, bend hard
  setArm(rig, 'armR', -1.4 * e, -1.5 * e, -.6, .5 * e);
  setArm(rig, 'armL', -1.2 * e, -1.6 * e, -.6, -.5 * e);
  setLeg(rig, 'legR', .8 * e, -1.3 * e, .3 * e);
  setLeg(rig, 'legL', .6 * e, -1.1 * e, .3 * e);
  rig.head.rotation.x += -.3 * sin(e * Math.PI);
  if (rig.sword) { rig.sword.rotation.x += .8 * e; rig.sword.rotation.z += .5 * e; }
}

/* =====================================================
   BLOCK & PARRY
   ===================================================== */
export function animBlock(rig, p) {              // p: hold time
  const raise = easeOutCubic(clamp(p * 6, 0, 1));
  rig.chest.rotation.y += -.55 * raise;
  rig.chest.rotation.x += .08 * raise;
  rig.moveRoot(-.02 * raise);
  // weapon held vertical across chest
  const A = rig.armR;
  A.sh.rotation.x += -1.1 * raise; A.sh.rotation.z += .55 * raise;
  A.el.rotation.x += -1.5 * raise;
  if (rig.sword) { rig.sword.rotation.x += 1.35 * raise; rig.sword.rotation.z += -.5 * raise; }
  const B = rig.armL;
  B.sh.rotation.x += -.7 * raise; B.sh.rotation.z += .35 * raise;
  B.el.rotation.x += -1.1 * raise;
  setLeg(rig, 'legR', .18 * raise, -.25 * raise, 0);
  setLeg(rig, 'legL', -.1 * raise, -.15 * raise, 0);
}

/** parry success flourish: deflect + riposte stance (p 0..1) */
export function animParrySuccess(rig, p) {
  const e = easeOutCubic(clamp(p * 3, 0, 1));
  const back = clamp((p - .4) / .6, 0, 1);
  rig.chest.rotation.y += -.9 * e + 1.5 * back;
  const A = rig.armR;
  A.sh.rotation.x += -1.2 * e; A.sh.rotation.z += .8 * e - 1.4 * back;
  A.el.rotation.x += -1.4 * e + .6 * back;
  if (rig.sword) rig.sword.rotation.x += 1.2 * e;
  rig.moveRoot(-.05 * sin(e * Math.PI));
  setLeg(rig, 'legR', .3, -.4, 0);
}

/* =====================================================
   HIT REACTIONS (used by enemies AND player flinch)
   ===================================================== */
export function animHitReact(rig, p, heavy = false) {
  const e = sin(clamp(p, 0, 1) * Math.PI);
  const m = heavy ? 1.6 : 1;
  rig.chest.rotation.x += -.5 * e * m;
  rig.chest.rotation.z += sin(p * 22) * .12 * e * m;          // shake
  rig.head.rotation.x += .4 * e * m;
  rig.moveRoot(-.05 * e * m);
  setArm(rig, 'armR', -.6 * e * m, -.4 * e, 0, -.4 * e * m);
  setArm(rig, 'armL', -.6 * e * m, -.4 * e, 0, .4 * e * m);
}

/** knockdown → getup (boss/staggered brute) */
export function animKnockdown(rig, p) {
  const fall = clamp(p / .3, 0, 1), rise = clamp((p - .55) / .45, 0, 1);
  const f = easeOutCubic(fall) * (1 - easeInCubic(rise));
  rig.root.rotation.x += f * 1.35;
  rig.moveRoot(-f * .45);
  setLeg(rig, 'legR', -f * .8, f * 1.2, 0);
  setLeg(rig, 'legL', -f * .6, f * 1.0, 0);
  setArm(rig, 'armR', -f * 1.6, -f * .8, 0, -f * .6);
  setArm(rig, 'armL', -f * 1.4, -f * .9, 0, f * .6);
}

/* =====================================================
   ENEMY ANIMATION SETS
   ===================================================== */
export function ragerRun(rig, t, spd) {
  const w = t * (9 + spd * 2);
  const b = sin(w), c = sin(w + 1.6), d = sin(w + 3.1);
  rig.torso.rotation.x += sin(w * 2) * .05;
  rig.torso.rotation.z += sin(w) * .05;
  rig.head.rotation.x += -.08 + sin(w * 2 + 1) * .05;
  const g = .5;
  rig.fl.hp.rotation.x += sin(w) * g;      rig.fl.kn.rotation.x += Math.max(0, -sin(w + .8)) * -.8;
  rig.fr.hp.rotation.x += sin(w + Math.PI) * g; rig.fr.kn.rotation.x += Math.max(0, -sin(w + .8 + Math.PI)) * -.8;
  rig.hl.hp.rotation.x += sin(w + Math.PI * g) * g; rig.hr.hp.rotation.x += sin(w + Math.PI * 1.5) * g;
  rig.tail1.rotation.x += .3 + sin(w * .8) * .2;
  rig.tail2.rotation.x += sin(w * .8 + .6) * .3;
}
export function ragerIdle(rig, t) {
  rig.torso.rotation.x += sin(t * 2) * .04;
  rig.head.rotation.y += sin(t * .8) * .2;
  rig.head.rotation.x += -.05;
  rig.tail1.rotation.x += .35 + sin(t * 1.6) * .15;
  rig.fl.kn.rotation.x += -.1; rig.fr.kn.rotation.x += -.1;
}
/** p: 0..1 over telegraph+strike; kind: 'pounce' | 'bite' */
export function ragerAttack(rig, p, kind) {
  const wind = clamp(p / .45, 0, 1), strike = clamp((p - .45) / .25, 0, 1), rec = clamp((p - .7) / .3, 0, 1);
  if (kind === 'pounce') {
    rig.torso.rotation.x += -.5 * easeInCubic(wind) + .8 * easeOutCubic(strike) * (1 - rec);
    rig.moveRoot(sin(wind * Math.PI) * .18 + strike * .1 * (1 - rec));
    [rig.fl, rig.fr].forEach(l => {
      l.hp.rotation.x += -.9 * easeInCubic(wind) + 1.4 * easeOutCubic(strike) * (1 - rec);
      l.kn.rotation.x += .8 * wind;
    });
    [rig.hl, rig.hr].forEach(l => { l.hp.rotation.x += .5 * wind - .3 * strike; });
    rig.head.rotation.x += -.3 * wind + .4 * strike;
  } else { /* bite swipe */
    rig.head.rotation.z += sin(wind * Math.PI) * .5;
    rig.torso.rotation.y += (wind - strike) * .4;
    rig.fl.hp.rotation.x += -.6 * wind + .8 * strike * (1 - rec);
  }
}
export function bruteSwing(rig, p, which = 'R') {
  const wind = easeInCubic(clamp(p / .5, 0, 1));
  const strike = easeOutCubic(clamp((p - .5) / .22, 0, 1));
  const rec = clamp((p - .72) / .28, 0, 1);
  const a = rig[which === 'R' ? 'armR' : 'armL'];
  const b = rig[which === 'R' ? 'armL' : 'armR'];
  a.sh.rotation.x += -1.9 * wind + 2.6 * strike * (1 - rec * .6);
  a.sh.rotation.z += (which === 'R' ? .6 : -.6) * (1 - strike);
  a.el.rotation.x += -.7 * wind + .5 * strike;
  b.sh.rotation.x += -.4 * wind;
  rig.torso.rotation.y += (which === 'R' ? -.4 : .4) * wind + (which === 'R' ? .7 : -.7) * strike;
  rig.torso.rotation.x += -.15 * wind + .35 * strike;
  rig.moveRoot(-.08 * wind);
  rig.legR.hp.rotation.x += .2 * wind; rig.legL.hp.rotation.x += -.15 * wind;
}
export function bruteSlam(rig, p) {           // both-fist ground pound
  const wind = easeInCubic(clamp(p / .55, 0, 1));
  const strike = easeOutCubic(clamp((p - .55) / .18, 0, 1));
  const rec = clamp((p - .75) / .25, 0, 1);
  for (const s of ['armR', 'armL']) {
    const a = rig[s];
    a.sh.rotation.x += -2.4 * wind + 2.9 * strike * (1 - rec * .5);
    a.sh.rotation.z += (s === 'armR' ? .3 : -.3) * (1 - strike);
    a.el.rotation.x += -.5 * wind;
  }
  rig.torso.rotation.x += -.3 * wind + .55 * strike;
  rig.moveRoot(-.12 * wind - .06 * strike + .1 * strike * rec);
  rig.legR.kn.rotation.x += -.4 * wind; rig.legL.kn.rotation.x += -.4 * wind;
}
export function bossBreath(rig, t) {
  rig.torso.rotation.x += sin(t * 1.4) * .03;
  rig.head.rotation.x += sin(t * 1.1 + 1) * .05;
  if (rig.wingR) {
    rig.wingR.rotation.z += -.15 + sin(t * 2.2) * .1;
    rig.wingL.rotation.z += .15 - sin(t * 2.2) * .1;
  }
}

/* =====================================================
   POSE BLENDER — layer poses with weights onto rest
   ===================================================== */
export class PoseBlender {
  constructor(rig) { this.rig = rig; }
  start() { this.rig.resetPose(); }
  add(fn, w = 1) {
    const rig = this.rig;
    if (w >= .999) { fn(rig); return; }
    // scale contributions: wrap by capturing deltas is costly; instead
    // animate functions use += so we pre-scale via proxy counters:
    const store = [];
    const bones = collectBones(rig);
    for (const b of bones) store.push([b, b.rotation.x, b.rotation.y, b.rotation.z]);
    fn(rig);
    for (const [b, x, y, z] of store) {
      b.rotation.set(x + (b.rotation.x - x) * w, y + (b.rotation.y - y) * w, z + (b.rotation.z - z) * w);
    }
    const ry = rig.root.rotation.y; // keep yaw untouched by blends
    void ry;
  }
}
let _boneCache = new WeakMap();
function collectBones(rig) {
  let b = _boneCache.get(rig);
  if (b) return b;
  b = [];
  const want = ['pelvis', 'chest', 'neck', 'head', 'torso', 'hip', 'armR', 'armL', 'legR', 'legL',
    'fl', 'fr', 'hl', 'hr', 'tail1', 'tail2', 'sword', 'wingR', 'wingL'];
  for (const k of want) {
    const v = rig[k];
    if (!v) continue;
    if (v.rotation) b.push(v);
    if (typeof v === 'object') for (const kk in v) if (v[kk] && v[kk].rotation) b.push(v[kk]);
  }
  if (rig.scarf) b.push(...rig.scarf);
  _boneCache.set(rig, b);
  return b;
}
