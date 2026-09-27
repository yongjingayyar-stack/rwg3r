/* =====================================================
   game.js — orchestration: renderer, scene, waves,
   combat resolution (hit/parry/dodge), HUD, time-stop.
   ===================================================== */
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { spawnRager, spawnBrute, spawnBoss } from './enemies.js';
import { Particles, Rings, Flashes, PostFX, ResGovernor } from './fx.js';
import { createAgentRig, createRagerRig, createBruteRig, createBossRig } from './characters.js';
import { Input } from './input.js';
import { sfx, setAudioEnabled } from './audio.js';
import { clamp, toScreen, damp } from './util.js';

const WAVES = [
  { ragers: 3, brutes: 0 },
  { ragers: 2, brutes: 2 },
  { ragers: 1, brutes: 2, boss: true },
];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    /* ---------- renderer tuned for high-res + fps ---------- */
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping; // handled in composite shader
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#0a1428', .0075);
    this.camera = new THREE.PerspectiveCamera(62, 1, .1, 900);

    this.post = new PostFX(this.renderer);
    window.__postfx = this.post;
    this.governor = new ResGovernor(this.renderer, document.getElementById('res-label'));
    addEventListener('resize', () => this.governor.resize());
    this.governor.resize();

    /* ---------- world & fx singletons ---------- */
    this.world = new World(this.scene);
    this.fx = {
      parts: new Particles(this.scene),
      rings: new Rings(this.scene),
      flashes: new Flashes(this.scene),
      post: this.post,
      gameTimeStop: 0,
    };
    this.rigs = {
      agent: () => createAgentRig(),
      rager: () => createRagerRig(),
      brute: () => createBruteRig(),
      boss: () => createBossRig(),
    };
    this.fx.agentRig = this.rigs.agent();

    /* ---------- player ---------- */
    this.player = new Player(this.scene, this.world, this.fx, this.camera);

    /* ---------- secondary motion springs (scarf/ponytail) ---------- */
    this.springs = [];
    const mkSpring = (obj) => ({
      obj, prev: obj.getWorldPosition(new THREE.Vector3()),
      vx: 0, vy: 0, vz: 0, px: 0, pz: 0,
    });
    for (const j of this.fx.agentRig.scarf) this.springs.push(mkSpring(j));
    for (const j of this.fx.agentRig.tail) this.springs.push(mkSpring(j));

    /* ---------- state ---------- */
    this.enemies = [];
    this.waveIdx = -1;
    this.phase = 'explore';              // explore | battle | victory | defeat
    this.combo = 0; this.comboT = 0;
    this.lockTarget = null;
    this.time = 0;
    this.paused = false; this.started = false;
    this.battleTimer = 0;
    this.sfx = sfx;
    this.floaters = document.getElementById('floaters');
    this.hud = {
      hpFill: document.getElementById('hp-fill'),
      hpText: document.getElementById('hp-text'),
      hpBar: document.querySelector('.bar.hp'),
      enFill: document.getElementById('en-fill'),
      ddCd: document.getElementById('dd-cd'),
      dpCd: document.getElementById('dp-cd'),
      fps: document.getElementById('fps'),
      wave: document.getElementById('zone-wave'),
      combo: document.getElementById('combo'),
      comboN: document.getElementById('combo-n'),
      reticle: document.getElementById('reticle'),
      bossBar: document.getElementById('boss-bar'),
      bossFill: document.getElementById('boss-fill'),
      toast: document.getElementById('toast'),
      skDodge: document.getElementById('sk-dodge'),
      skParry: document.getElementById('sk-parry'),
      skBurst: document.getElementById('sk-burst'),
    };
    this._fpsAcc = 0; this._fpsN = 0;
  }

  /* ================= lifecycle ================= */
  start(opts) {
    this.started = true;
    setAudioEnabled(opts.sound);
    this.post.enabled = opts.bloom;
    this.renderer.shadowMap.enabled = opts.shadow;
    this.scene.fog = opts.fog ? new THREE.FogExp2('#0a1428', .0075) : null;
    this.scene.traverse(o => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
    this.player.respawn();
    this.setWave(0);
    Input.lock(this.canvas);
  }
  reset() {
    for (const e of this.enemies) if (!e.dead) e.dispose();
    this.enemies.length = 0;
    this.waveIdx = -1; this.phase = 'explore';
    this.combo = 0; this.lockTarget = null;
    this.hud.bossBar.classList.add('hidden');
  }

  setWave(i) {
    this.waveIdx = i;
    const W = WAVES[i];
    const spawnPos = (r, aBase) => {
      const a = aBase + Math.random() * .8;
      return new THREE.Vector3(Math.cos(a) * r, 1.4, Math.sin(a) * r);
    };
    for (let k = 0; k < W.ragers; k++) this.enemies.push(spawnRager(this, spawnPos(16 + Math.random() * 8, k / W.ragers * Math.PI * 2)));
    for (let k = 0; k < W.brutes; k++) this.enemies.push(spawnBrute(this, spawnPos(18 + Math.random() * 6, k / Math.max(1, W.brutes) * Math.PI * 2 + 1)));
    if (W.boss) {
      const b = spawnBoss(this, new THREE.Vector3(0, 1.4, -18));
      this.enemies.push(b);
      this.hud.bossBar.classList.remove('hidden');
      this.sfx.bossRoar();
      this.toast('ELITE ETHEREAL APPROACHES', 'red', 1800);
    }
    this.sfx.waveStart();
    if (!W.boss || W.ragers + W.brutes > 0) this.toast(`WAVE ${i + 1} / ${WAVES.length}`, 'gold', 1400);
    this.phase = 'battle';
  }

  toast(text, cls = '', ms = 1200) {
    const t = this.hud.toast;
    t.textContent = text;
    t.className = 'show ' + cls;
    clearTimeout(this._toastTO);
    this._toastTO = setTimeout(() => t.className = '', ms);
  }

  floatText(worldPos, text, cls = '') {
    const p = toScreen(worldPos, this.camera, innerWidth, innerHeight);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'flt ' + cls;
    el.style.left = p[0] + 'px'; el.style.top = p[1] + 'px';
    el.textContent = text;
    this.floaters.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  /* ================= combat plumbing ================= */
  aliveEnemies() { return this.enemies.filter(e => e.alive && !e.dead); }

  /** one swing hitbox test per frame */
  onPlayerAttackFrame(player, S) {
    const origin = player.pos.clone().setY(player.pos.y + 1);
    const fwd = player.fwd;
    for (const e of this.aliveEnemies()) {
      if (player.attackHits.has(e)) continue;
      const to = e.center().sub(origin); to.y *= .6;
      const d = to.length();
      if (d > 4.6 + e.cfg.radius) continue;            // reach check
      const dot = to.clone().normalize().dot(fwd);
      if (dot < .45) continue;                     // ~130° frontal arc
      player.attackHits.add(e);
      const isFinisher = !!S.finisher;
      const crit = Math.random() < .18 || (e.stagger > 0);
      let dmg = S.dmg * (crit ? 1.8 : 1) * (isFinisher ? 1.2 : 1);
      const styleKill = e.hp - dmg <= 0 && player.stats && this.combo >= 8;
      e.takeDamage(dmg, player.pos, {
        kb: isFinisher ? 8 : 3.5,
        stagger: isFinisher ? .9 : (crit ? .35 : 0),
        knockdown: isFinisher && (e.cfg.type !== 'rager' || Math.random() < .5),
        styleKill,
      });
      // impact FX at contact point
      const cp = origin.clone().addScaledVector(to.clone().normalize(), Math.min(d, 2.2));
      cp.y = e.eyeY - .2;
      this.fx.parts.sparks(cp, fwd, crit ? 22 : 12, crit ? '#ff6ec7' : '#ffe9a8');
      this.fx.flashes.spawn(cp, crit ? '#ff9adf' : '#fff2b0', crit ? 2.2 : 1.3, .16);
      crit ? this.sfx.crit() : this.sfx.hit();
      player.shake = Math.max(player.shake, crit ? .5 : .28);
      this.post.params.tint = 0;
      player.energy = Math.min(player.maxEnergy, player.energy + 4);
      player.stats.hits++; player.stats.dmgDealt += dmg;
      this.addCombo(crit ? 2 : 1);
      this.floatText(cp, Math.round(dmg) + (crit ? '!' : ''), crit ? 'crit' : '');
      if (this.lockTarget === e && isFinisher) this.breakLock();
    }
  }
  onSpecialSwing() { this._spHitDone = false; }
  onSpecialActive(player) {
    if (this._spHitDone) return;
    this._spHitDone = true;
    const origin = player.pos.clone();
    for (const e of this.aliveEnemies()) {
      const d = e.pos.distanceTo(origin);
      if (d > 7) continue;
      e.takeDamage(38, origin, { kb: 9, stagger: 1.1, knockdown: e.cfg.type !== 'rager' });
      this.floatText(e.center(), 38, 'crit');
      this.addCombo(2);
    }
    this.fx.parts.ring(origin.clone().setY(origin.y + .6), '#7fe7ff', 46, 13, .2);
    this.fx.rings.spawn(origin.clone().setY(origin.y + .1), '#5ce1ff', 7.5, .55);
    this.fx.flashes.spawn(origin.clone().setY(origin.y + 1.2), '#bffcff', 4, .25);
    player.shake = 1.3;
  }
  onDodge() {
    this.player.stats.dodges++;
    // ZZZ-style "flash dodge" bonus: dodging right before a hit → extra energy
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 3);
  }

  /** enemy attack reaches its hit moment */
  tryHitPlayer(enemy, A) {
    const p = this.player;
    if (!p.alive) return;
    const toP = p.pos.clone().sub(enemy.pos).setY(0);
    const d = toP.length();
    if (d > A.range + .6) return;                       // whiffed
    const dot = toP.normalize().dot(new THREE.Vector3(Math.sin(enemy.yaw), 0, Math.cos(enemy.yaw)));
    if (dot < .35) return;                               // out of facing cone
    const hitPos = p.pos.clone().setY(p.pos.y + 1);
    const unparryable = A.kind === 'bigslam';            // boss slam must be dodged
    p.takeHit(A.dmg, enemy.center(), {
      heavy: A.dmg >= 18 || unparryable,
      unparryable,
      onStagger: () => enemy.onParried(),                // perfect parry staggers attacker
    });
    if (p.state === 'hurt') {
      this.combo = 0; this.updateComboHud();
      this.floatText(hitPos, '-' + A.dmg, 'player');
    } else if (p.state === 'block') {
      this.floatText(hitPos, 'BLOCK', 'heal');
    }
  }

  onEnemyAggro(e) {
    if (!this._aggroSoundLock) {
      this._aggroSoundLock = true;
      setTimeout(() => this._aggroSoundLock = false, 400);
    }
  }
  onEnemyKilled(e, styleKill) {
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 18);
    this.floatText(e.center(), styleKill ? 'STYLE KILL!' : 'DESTROYED', styleKill ? 'crit' : 'heal');
    if (styleKill) { this.toast('STYLE KILL', 'gold'); this.sfx.crit(); }
    if (e.isBoss) {
      this.hud.bossBar.classList.add('hidden');
      this.onVictory();
      return;
    }
    if (this.aliveEnemies().length === 0 && this.phase === 'battle') {
      if (this.waveIdx < WAVES.length - 1) {
        setTimeout(() => { if (this.phase === 'battle') this.setWave(this.waveIdx + 1); }, 1600);
        this.toast('WAVE CLEARED', '', 1300);
      }
    }
    if (this.lockTarget === e) this.breakLock();
  }

  addCombo(n) {
    this.combo += n;
    this.comboT = 2.6;
    this.updateComboHud();
  }
  updateComboHud() {
    const c = this.hud.combo;
    if (this.combo < 2) { c.classList.remove('show'); return; }
    c.classList.add('show');
    c.classList.toggle('tier2', this.combo >= 10);
    c.classList.toggle('tier3', this.combo >= 20);
    this.hud.comboN.textContent = this.combo;
  }

  /* ---------------- smart lock-on ---------------- */
  updateLock(dt) {
    const p = this.player;
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.dead ||
      this.lockTarget.pos.distanceTo(p.pos) > 14)) this.breakLock();
    if (!this.lockTarget) {
      // auto-soft-lock nearest aggro'd enemy in front of camera for reticle feedback
      let best = null, bestScore = -1;
      const camF = new THREE.Vector3();
      this.camera.getWorldDirection(camF);
      for (const e of this.aliveEnemies()) {
        const to = e.center().sub(this.camera.position);
        const d = to.length();
        if (d > 26) continue;
        const dot = to.normalize().dot(camF);
        if (dot < .965) continue;
        const score = dot * 10 - d * .1;
        if (score > bestScore) { bestScore = score; best = e; }
      }
      this.reticleOn = !!best;
    } else this.reticleOn = true;
    this.hud.reticle.classList.toggle('lock', !!this.reticleOn);
  }
  breakLock() { this.lockTarget = null; }

  /* ---------------- interact ---------------- */
  tryInteract(player) {
    const tp = this.world.teleporter;
    if (player.pos.distanceTo(tp.pos) < 3.5) {
      if (this.phase === 'explore' || this.phase === 'victory') {
        this.reset();
        this.setWave(0);
        this.toast('ENTERING THE HOLLOW…', '', 1000);
      } else {
        this.toast('COMBAT IN PROGRESS', 'red', 800);
      }
      return;
    }
    // quick heal pad check: standing still on teleporter heals
  }

  onVictory() {
    this.phase = 'victory';
    this.sfx.victory();
    const s = this.player.stats;
    document.getElementById('vic-stats').textContent =
      `Hits: ${s.hits} · Parries: ${s.parries} · Dodges: ${s.dodges} · Damage: ${Math.round(s.dmgDealt)} · Max combo: ${this.maxCombo | 0}`;
    document.getElementById('victory').classList.remove('hidden');
    Input.unlock();
  }
  onDefeat() {
    if (this.phase === 'defeat') return;
    this.phase = 'defeat';
    document.getElementById('defeat').classList.remove('hidden');
    Input.unlock();
  }

  /* ================= main loop ================= */
  loop() {
    const raw = Math.min(this.clock.getDelta(), .05);
    if (!this.started) { this.menuCamSpin(raw); return; }
    if (this.paused) return;

    // time-stop (parry drama) & slow-mo
    let dt = raw;
    if (this.fx.gameTimeStop > 0) {
      this.fx.gameTimeStop -= raw;
      dt = raw * .06;
      this.post.params.slowmoTint = damp(this.post.params.slowmoTint, 1, 20, raw);
    } else {
      this.post.params.slowmoTint = damp(this.post.params.slowmoTint, 0, 6, raw);
    }
    this.time += dt;

    // sun follows player for tight shadow frustum (quality + perf)
    this.sunFollow();

    this.world.update(dt);
    this.player.update(dt, this);
    for (const e of this.enemies) if (!e.dead) e.update(dt, this.player);
    this.enemies = this.enemies.filter(e => !e.dead);

    this.fx.parts.update(dt);
    this.fx.rings.update(dt);
    this.fx.flashes.update(dt);
    this.updateLock(dt);

    // decay combo & damage tint
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.maxCombo = Math.max(this.maxCombo | 0, this.combo); this.combo = 0; this.updateComboHud(); } }
    this.post.params.tint = Math.max(0, this.post.params.tint - dt * 1.4);
    this.post.params.whiteFlash = Math.max(0, this.post.params.whiteFlash - dt * 3.2);

    if (!this.player.alive && this.phase !== 'defeat') this.onDefeat();

    // HUD
    this.updateHud(raw);
    this.post.render(this.scene, this.camera, this.time);
    this.governor.report(raw);
  }

  menuCamSpin(dt) {
    this.menuA = (this.menuA ?? 0) + dt * .12;
    const R = 46;
    this.camera.position.set(Math.cos(this.menuA) * R, 16 + Math.sin(this.menuA * .7) * 4, Math.sin(this.menuA) * R);
    this.camera.lookAt(0, 6, 0);
    this.world.update(dt);
    this.fx.parts.update(dt);
    this.post.render(this.scene, this.camera, this.time += dt);
  }

  sunFollow() {
    const p = this.player.pos;
    this.world.sunTarget.position.set(p.x, p.y, p.z);
    this.world.sun.position.set(p.x + 55, p.y + 85, p.z - 40);
  }

  updateHud(raw) {
    const p = this.player;
    this.hud.hpFill.style.width = (p.hp / p.maxHp * 100) + '%';
    this.hud.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.hud.hpBar.classList.toggle('low', p.hp < 30);
    this.hud.enFill.style.width = (p.energy / p.maxEnergy * 100) + '%';
    this.hud.ddCd.style.setProperty('--r', String(1 - p.dashCd / .62));
    this.hud.dpCd.style.setProperty('--r', String(clamp(p.parryWin / .4, 0, 1)));
    const boss = this.enemies.find(e => e.isBoss && e.alive);
    if (boss) this.hud.bossFill.style.width = (boss.hp / boss.maxHp * 100) + '%';
    const alive = this.aliveEnemies().length;
    this.hud.wave.textContent = this.phase === 'battle'
      ? `Wave ${this.waveIdx + 1}/${WAVES.length} · Enemies: ${alive}`
      : this.phase === 'victory' ? 'SECTOR CLEAR · Free Roam' : `Enemies: ${alive}`;
    // skill icons
    this.hud.skDodge.classList.toggle('ready', p.dashCd <= 0);
    this.hud.skDodge.querySelector('i.cd').style.setProperty('--r', String(p.dashCd / .62));
    this.hud.skParry.classList.toggle('ready', p.state !== 'block');
    this.hud.skParry.querySelector('i.cd').style.setProperty('--r', String(clamp(1 - p.parryWin / .4, 0, 1)));
    this.hud.skBurst.classList.toggle('ready', p.energy >= 60);
    this.hud.skBurst.querySelector('i.cd').style.setProperty('--r', String(1 - p.energy / 60));
    // fps
    this._fpsAcc += raw; this._fpsN++;
    if (this._fpsAcc >= .5) {
      this.hud.fps.textContent = Math.round(this._fpsN / this._fpsAcc) + ' FPS';
      this._fpsAcc = 0; this._fpsN = 0;
    }
  }

  /* ---- scarf / ponytail spring bones ---- */
  updateSecondary(rig, dt) {
    rig.root.updateMatrixWorld(true);
    for (const s of this.springs) {
      const cur = s.obj.getWorldPosition(_tmp1);
      const dx = cur.x - s.prev.x, dy = cur.y - s.prev.y, dz = cur.z - s.prev.z;
      // velocity-driven sag: rotate joint opposite to motion
      s.vx = damp(s.vx, -dx / Math.max(dt, 1e-4) * .012, 18, dt);
      s.vy = damp(s.vy, -dy / Math.max(dt, 1e-4) * .012, 18, dt);
      s.vz = damp(s.vz, -dz / Math.max(dt, 1e-4) * .012, 18, dt);
      s.obj.rotation.x += clamp(s.vz, -.5, .5);
      s.obj.rotation.z += clamp(-s.vx, -.5, .5);
      s.prev.copy(cur);
    }
  }
}
const _tmp1 = new THREE.Vector3();
