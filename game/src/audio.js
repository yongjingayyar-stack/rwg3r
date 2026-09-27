/* =====================================================
   audio.js — fully procedural WebAudio SFX (no assets)
   ===================================================== */
let ctx = null, master = null, noiseBuf = null, enabled = true;

function ensure() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    // white-noise buffer
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function setAudioEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.5 : 0; }

function tone({ type = 'sine', f0 = 440, f1 = f0, t0 = 0, dur = .15, gain = .3, curve = 'exp' }) {
  if (!enabled) return;
  const c = ensure();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, c.currentTime + t0);
  if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), c.currentTime + t0 + dur);
  else o.frequency.linearRampToValueAtTime(Math.max(1, f1), c.currentTime + t0 + dur);
  g.gain.setValueAtTime(gain, c.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
  o.connect(g); g.connect(master);
  o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + .02);
}
function noise({ t0 = 0, dur = .1, gain = .3, hp = 400, lp = 8000, sweep = null }) {
  if (!enabled) return;
  const c = ensure();
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const hf = c.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = hp;
  const lf = c.createBiquadFilter(); lf.type = 'lowpass'; lf.frequency.value = lp;
  if (sweep) lf.frequency.exponentialRampToValueAtTime(sweep, c.currentTime + t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, c.currentTime + t0);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
  s.connect(hf); hf.connect(lf); lf.connect(g); g.connect(master);
  s.start(c.currentTime + t0); s.stop(c.currentTime + t0 + dur + .02);
}

/* ---------------- game events ---------------- */
export const sfx = {
  swing(i = 0) {                       // weapon whoosh (pitched per combo step)
    noise({ dur: .16, gain: .22, hp: 900, lp: 9000, sweep: 300 });
    tone({ type: 'sawtooth', f0: 210 + i * 40, f1: 70, dur: .14, gain: .07 });
  },
  hit() {                              // blade connect
    tone({ type: 'square', f0: 190, f1: 55, dur: .1, gain: .3 });
    noise({ dur: .08, gain: .3, hp: 1800, lp: 12000 });
  },
  crit() {
    tone({ type: 'square', f0: 330, f1: 70, dur: .16, gain: .34 });
    tone({ type: 'sine', f0: 1320, f1: 440, t0: .02, dur: .2, gain: .2 });
    noise({ dur: .12, gain: .3, hp: 2400, lp: 16000 });
  },
  parry() {                            // metallic ZZZ-style ding + time-stop
    tone({ type: 'triangle', f0: 2400, f1: 1200, dur: .35, gain: .32 });
    tone({ type: 'square', f0: 1800, f1: 900, t0: .01, dur: .3, gain: .16 });
    noise({ dur: .3, gain: .22, hp: 4000, lp: 20000 });
    tone({ type: 'sine', f0: 60, f1: 30, dur: .5, gain: .3 });
  },
  block() {
    tone({ type: 'square', f0: 130, f1: 60, dur: .12, gain: .26 });
    noise({ dur: .1, gain: .2, hp: 300, lp: 2500 });
  },
  dodge() {                            // airy dash
    noise({ dur: .22, gain: .24, hp: 500, lp: 7000, sweep: 1800 });
    tone({ type: 'sine', f0: 700, f1: 180, dur: .18, gain: .1 });
  },
  jump() { tone({ type: 'sine', f0: 300, f1: 520, dur: .12, gain: .14 }); },
  land() { noise({ dur: .1, gain: .22, hp: 60, lp: 900 }); tone({ type: 'sine', f0: 90, f1: 40, dur: .12, gain: .2 }); },
  hurt() {
    tone({ type: 'sawtooth', f0: 240, f1: 60, dur: .22, gain: .3 });
    noise({ dur: .18, gain: .2, hp: 200, lp: 3000 });
  },
  enemyDie() {
    tone({ type: 'sawtooth', f0: 400, f1: 40, dur: .5, gain: .22 });
    noise({ dur: .45, gain: .25, hp: 700, lp: 9000, sweep: 200 });
    tone({ type: 'sine', f0: 1200, f1: 200, t0: .05, dur: .3, gain: .12 });
  },
  enemyTelegraph() { tone({ type: 'square', f0: 880, f1: 880, dur: .09, gain: .1 }); },
  bossRoar() {
    tone({ type: 'sawtooth', f0: 70, f1: 34, dur: 1.1, gain: .4 });
    tone({ type: 'square', f0: 140, f1: 60, dur: .9, gain: .12 });
    noise({ dur: 1, gain: .18, hp: 100, lp: 1200 });
  },
  special() {                          // EX / burst
    tone({ type: 'sawtooth', f0: 120, f1: 900, dur: .25, gain: .22, curve: 'lin' });
    noise({ dur: .5, gain: .26, hp: 900, lp: 14000, sweep: 400 });
    tone({ type: 'sine', f0: 1760, f1: 220, t0: .18, dur: .5, gain: .2 });
  },
  ui() { tone({ type: 'square', f0: 1200, f1: 1600, dur: .05, gain: .08 }); },
  waveStart() {
    tone({ type: 'triangle', f0: 440, f1: 880, dur: .3, gain: .16 });
    tone({ type: 'triangle', f0: 660, f1: 1320, t0: .15, dur: .3, gain: .12 });
  },
  victory() {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ type: 'triangle', f0: f, f1: f, t0: i * .14, dur: .4, gain: .18 }));
  },
  defeat() {
    [392, 330, 262, 196].forEach((f, i) =>
      tone({ type: 'sawtooth', f0: f, f1: f * .98, t0: i * .22, dur: .5, gain: .14 }));
  },
};
