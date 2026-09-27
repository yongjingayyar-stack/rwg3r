/* =====================================================
   enemies.js — Ethereal AI: aggro, chase, telegraphed
   attacks (red flash → strike), stagger, death bursts.
   Attack timing windows interlock with player parry/dodge.
   ===================================================== */
import * as THREE from 'three';
import { clamp, lerp, angleLerp, damp, mulberry32 } from './util.js';
import {
  PoseBlender, ragerRun, ragerIdle, ragerAttack,
  bruteSwing, bruteSlam, bossBreath, animHitReact, animKnockdown,
} from './animations.js';
import { shadowBlobTexture } from './util.js';

const blobTex = shadowBlobTexture();
const G = 26;

/** attack spec helper: windup until hitAt, active hitAt..hitEnd */
function atk(windup, active, recover, dmg, range, kind) {
  return { windup, active, recover, dmg, range, kind, t: 0 };
}

export class Enemy {
  constructor(game, rigFactory, cfg) {
    this.game = game;
    this.scene = game.scene;
    this.rig = rigFactory();
    this.scene.add(this.rig.root);
    this.blender = new PoseBlender(this.rig);
    this.cfg = cfg;
    Object.assign(this, {
      pos: cfg.pos.clone(), vel: new THREE.Vector3(), yaw: Math.random() * 6,
      hp: cfg.hp, maxHp: cfg.hp, alive: true, grounded: false,
      state: 'idle', stateT: 0, aggro: false, home: cfg.pos.clone(),
      attack: null, cd: 1 + Math.random() * 2, stagger: 0, hitFlash: 0,
      hitReactT: -1, knockdownT: -1, vy: 0, wanderT: 0, wanderDir: new THREE.Vector3(),
      telegraphMat: null, animT: Math.random() * 9, dieT: -1,
      lastParried: 0,
    });
    // fake drop-shadow blob
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2 * cfg.scale, 2.2 * cfg.scale),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    this.blob = blob; this.scene.add(blob);
    // red telegraph flash material overlay for core
    if (this.rig.mats.glow) {
      this.glowBase = this.rig.mats.glow.emissiveIntensity;
    }
    this.anim = cfg.anim;// which animation set
  }

  get eyeY() { return this.pos.y + 1.1 * this.cfg.scale; }
  center() { return new THREE.Vector3(this.pos.x, this.eyeY, this.pos.z); }

  /* ---------------- per-frame ---------------- */
  update(dt, player) {
    if (this.dieT >= 0) { this.updateDeath(dt); return; }
    if (!this.alive) return;
    this.animT += dt;
    this.stateT += dt;
    this.cd -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    if (this.stagger > 0) this.stagger -= dt;
    if (this.hitReactT >= 0) { this.hitReactT += dt; if (this.hitReactT > .3) this.hitReactT = -1; }

    const toP = player.pos.clone().sub(this.pos).setY(0);
    const dist = toP.length();
    const sight = dist < this.cfg.aggroRange && player.alive;
    if (sight && !this.aggro && dist < this.cfg.aggroRange) {
      this.aggro = true;
      this.game.onEnemyAggro(this);
    }
    if (!sight && dist > this.cfg.aggroRange * 1.6) this.aggro = false;

    if (this.stagger > 0) {
      this.state = 'stagger';
      this.vel.x *= Math.exp(-8 * dt); this.vel.z *= Math.exp(-8 * dt);
    } else if (this.attack) {
      this.updateAttack(dt, player, dist, toP);
    } else if (this.aggro && player.alive) {
      this.updateChase(dt, player, dist, toP);
    } else {
      this.updateWander(dt);
    }

    // physics
    this.vy -= G * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    const gy = this.game.world.groundAt(this.pos.x, this.pos.z, this.pos.y + .5);
    if (this.pos.y <= gy) { this.pos.y = gy; this.vy = 0; this.grounded = true; }
    else this.grounded = false;
    // soft separation from other enemies
    for (const o of this.game.enemies) {
      if (o === this || !o.alive) continue;
      const d = this.pos.clone().sub(o.pos); d.y = 0;
      const L = d.length();
      const minD = (this.cfg.radius + o.cfg.radius);
      if (L > .01 && L < minD) {
        d.multiplyScalar((minD - L) / L * .5);
        this.pos.add(d);
      }
    }
    this.animate(dt);
    // glow pulse when attacking/telegraphing
    if (this.rig.mats.glow) {
      let k = 1;
      if (this.attack) {
        const A = this.attack;
        k = A.t < A.windup ? 1 + 3.5 * Math.abs(Math.sin(A.t * 22)) : (A.t < A.windup + A.active ? 6 : 1.4);
      }
      this.rig.mats.glow.emissiveIntensity = this.glowBase * k;
    }
  }

  updateChase(dt, player, dist, toP) {
    const cfg = this.cfg;
    const dir = toP.clone().normalize();
    this.yaw = angleLerp(this.yaw, Math.atan2(dir.x, dir.z), 1 - Math.exp(-7 * dt));
    if (dist > cfg.atkRange * .8) {
      const spd = cfg.speed * (this.aggro ? 1 : .5);
      this.vel.x = damp(this.vel.x, dir.x * spd, 10, dt);
      this.vel.z = damp(this.vel.z, dir.z * spd, 10, dt);
      this.state = 'chase';
    } else {
      this.vel.x *= Math.exp(-8 * dt); this.vel.z *= Math.exp(-8 * dt);
      this.state = 'engage';
      if (this.cd <= 0) this.beginAttack(player, dir);
    }
  }

  beginAttack(player, dir) {
    const pick = this.cfg.attacks[Math.floor(Math.random() * this.cfg.attacks.length)];
    this.attack = { ...pick, t: 0, hasHit: false, dir: dir.clone() };
    this.state = 'attack';
    this.stateT = 0;
    this.game.sfx.enemyTelegraph?.();
    // small hop-in on pounces
    if (this.attack.kind === 'pounce') this.vy = 6;
  }

  updateAttack(dt, player, dist, toP) {
    const A = this.attack;
    A.t += dt;
    const face = toP.clone().normalize();
    this.yaw = angleLerp(this.yaw, Math.atan2(face.x, face.z), 1 - Math.exp(-10 * dt));
    // drive-in during strike for lunges
    if (A.kind === 'pounce' && A.t > A.windup && A.t < A.windup + A.active) {
      this.vel.copy(face).multiplyScalar(11);
    } else if (A.kind !== 'slam') {
      this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
    }
    // hit moment
    if (!A.hasHit && A.t >= A.windup + A.active * .45) {
      A.hasHit = true;
      this.game.tryHitPlayer(this, A);
    }
    if (A.t >= A.windup + A.active + A.recover) {
      this.attack = null;
      this.cd = this.cfg.cdMin + Math.random() * this.cfg.cdMax;
      this.state = 'engage';
    }
  }

  updateWander(dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = 2 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      this.wanderDir.set(Math.cos(a), 0, Math.sin(a));
      this._wanderMove = Math.random() > .45;
    }
    if (this._wanderMove) {
      const stay = this.home.distanceTo(this.pos) > 14;
      const d = stay ? this.home.clone().sub(this.pos).setY(0).normalize() : this.wanderDir;
      this.vel.x = damp(this.vel.x, d.x * this.cfg.speed * .35, 6, dt);
      this.vel.z = damp(this.vel.z, d.z * this.cfg.speed * .35, 6, dt);
      this.yaw = angleLerp(this.yaw, Math.atan2(d.x, d.z), 1 - Math.exp(-4 * dt));
      this.state = 'wander';
    } else {
      this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
      this.state = 'idle';
    }
  }

  /* ---------------- combat interface ---------------- */
  takeDamage(amount, fromPos, opts = {}) {
    if (!this.alive) return 0;
    this.hp -= amount;
    this.hitFlash = 1;
    this.hitReactT = 0;
    const kb = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(opts.kb ?? 3.5);
    this.vel.x += kb.x; this.vel.z += kb.z;
    if (opts.stagger) { this.stagger = opts.stagger; this.attack = null; }
    if (opts.knockdown) { this.knockdownT = 0; this.stagger = Math.max(this.stagger, 1.6); this.attack = null; }
    if (this.hp <= 0) { this.kill(opts.styleKill); }
    return amount;
  }

  /** player successfully parried our attack */
  onParried() {
    this.lastParried = performance.now();
    this.attack = null;
    this.stagger = 1.7;                    // long punish window (ZZZ-style)
    this.vy = 4;
    this.cd = .6;
    this.vel.multiplyScalar(-.4);
  }

  kill(styleKill) {
    if (!this.alive) return;
    this.alive = false;
    this.dieT = 0;
    this.game.onEnemyKilled(this, styleKill);
  }
  updateDeath(dt) {
    this.dieT += dt;
    const k = this.dieT / .8;
    this.rig.root.scale.setScalar(Math.max(.01, 1 - k * k));
    this.rig.root.rotation.y += dt * 6;
    this.blob.visible = false;
    if (!this._burstDone) {
      this._burstDone = true;
      const c = this.cfg.coreColor;
      this.game.fx.parts.burst(this.center(), 40, c, 8, .18, .8);
      this.game.fx.parts.ring(this.center(), '#ffffff', 20, 6, 0);
      this.game.fx.flashes.spawn(this.center(), c, 3, .3);
      this.game.fx.rings.spawn(this.pos.clone(), c, 4.5, .5);
      this.game.sfx.enemyDie();
    }
    if (this.dieT > .85) this.dispose();
  }
  dispose() {
    this.scene.remove(this.rig.root);
    this.scene.remove(this.blob);
    this.dead = true;
  }

  /* ---------------- animation ---------------- */
  animate(dt) {
    const rig = this.rig, B = this.blender;
    B.start();
    rig.root.rotation.y = this.yaw;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const t = this.animT;

    if (this.knockdownT >= 0) {
      const dur = 2.2;
      B.add((r) => animKnockdown(r, this.knockdownT / dur), 1);
      this.knockdownT += dt;
      if (this.knockdownT > dur) this.knockdownT = -1;
    } else if (this.hitReactT >= 0) {
      B.add((r) => animHitReact(r, this.hitReactT / .3, this.cfg.heavy), 1);
      if (speed > .5) this.baseLoco(B, t, speed);
    } else if (this.attack) {
      const A = this.attack;
      const total = A.windup + A.active + A.recover;
      const p = clamp(A.t / total, 0, 1);
      this.animatedAttack(B, p, A.kind, t, speed);
    } else if (this.stagger > 0) {
      B.add((r) => {
        r.torso.rotation.x += -.2 + Math.sin(t * 24) * .08;
        r.head.rotation.x += .3;
        if (r.armR) r.armR.sh.rotation.x += -.5;
        if (r.armL) r.armL.sh.rotation.x += -.5;
      }, 1);
      if (speed > .5) this.baseLoco(B, t, speed);
    } else {
      this.baseLoco(B, t, speed);
    }

    // hit-flash emissive
    if (this.rig.mats.body) {
      this.rig.mats.body.emissive = this.rig.mats.body.emissive || new THREE.Color();
      const f = this.hitFlash;
      this.rig.mats.body.emissive.setRGB(f * .8, f * .1, f * .2);
      this.rig.mats.body.emissiveIntensity = f * 2;
    }
    // shadow blob follows ground
    const gy = this.game.world.groundAt(this.pos.x, this.pos.z, Infinity);
    this.blob.position.set(this.pos.x, gy + .02, this.pos.z);
    const h = clamp(1 - (this.pos.y - gy) * .25, .2, 1);
    this.blob.scale.set(h, h, 1);
    this.blob.material.opacity = .55 * h * (this.alive ? 1 : Math.max(0, 1 - this.dieT));
  }

  baseLoco(B, t, speed) {
    const rig = this.rig;
    if (this.cfg.type === 'rager') {
      if (speed > .8) B.add((r) => ragerRun(r, t, speed), 1);
      else B.add((r) => ragerIdle(r, t), 1);
    } else {
      if (speed > .8) B.add((r) => {
        const w = t * 5;
        r.torso.rotation.x += .06;
        r.legR.hp.rotation.x += Math.sin(w) * .4;
        r.legL.hp.rotation.x += Math.sin(w + Math.PI) * .4;
        r.legR.kn.rotation.x += Math.max(0, -Math.sin(w)) * -.5;
        r.legL.kn.rotation.x += Math.max(0, Math.sin(w)) * -.5;
        r.armR.sh.rotation.x += Math.sin(w + Math.PI) * .3 - .1;
        r.armL.sh.rotation.x += Math.sin(w) * .3 - .1;
      }, 1);
      else B.add((r) => {
        if (this.cfg.type === 'boss') bossBreath(r, t);
        else {
          r.torso.rotation.x += sin0(t) * .03;
          r.head.rotation.y += Math.sin(t * .7) * .15;
          r.armR.sh.rotation.x += -.05; r.armL.sh.rotation.x += -.05;
        }
      }, 1);
    }
  }
  animatedAttack(B, p, kind, t, speed) {
    const rig = this.rig;
    if (this.cfg.type === 'rager') {
      B.add((r) => ragerAttack(r, p, kind === 'bite' ? 'bite' : 'pounce'), 1);
    } else if (kind === 'slam') {
      B.add((r) => bruteSlam(r, p), 1);
    } else if (kind === 'combo') {
      // alternating double swing
      const half = p < .5 ? p * 2 : (p - .5) * 2;
      B.add((r) => bruteSwing(r, half, p < .5 ? 'R' : 'L'), 1);
    } else {
      B.add((r) => bruteSwing(r, p, 'R'), 1);
    }
    if (this.cfg.type === 'boss') {
      B.add((r) => bossBreath(r, t), .5);
      if (kind === 'slam') B.add((r) => {
        const k = clamp(p * 2, 0, 1);
        r.wingR.rotation.z += -.6 * k; r.wingL.rotation.z += .6 * k;
      }, 1);
    }
  }
}
function sin0(t) { return Math.sin(t * 1.4); }

/* ---------------- factory configs ---------------- */
export function spawnRager(game, pos) {
  const e = new Enemy(game, () => game.rigs.rager(), {
    type: 'rager', pos, scale: 1,
    hp: 42, speed: 6.2, radius: .8, aggroRange: 26, atkRange: 2.4,
    cdMin: .9, cdMax: 1.8, heavy: false, coreColor: '#ff4fa0',
    attacks: [
      atk(.5, .22, .5, 10, 2.6, 'pounce'),
      atk(.4, .2, .45, 8, 2.4, 'bite'),
    ],
  });
  return e;
}
export function spawnBrute(game, pos) {
  const e = new Enemy(game, () => game.rigs.brute(), {
    type: 'brute', pos, scale: 1.15,
    hp: 90, speed: 3.6, radius: 1.1, aggroRange: 30, atkRange: 3.4,
    cdMin: 1.6, cdMax: 2.6, heavy: true, coreColor: '#ffaa33',
    attacks: [
      atk(.75, .25, .8, 16, 3.6, 'swing'),
      atk(.95, .3, 1.0, 22, 3.4, 'slam'),
      atk(.7, .5, .9, 13, 3.5, 'combo'),
    ],
  });
  return e;
}
export function spawnBoss(game, pos) {
  const e = new Enemy(game, () => game.rigs.boss(), {
    type: 'boss', pos, scale: 1.6,
    hp: 460, speed: 4.6, radius: 1.6, aggroRange: 60, atkRange: 4.6,
    cdMin: 1.1, cdMax: 2.0, heavy: true, coreColor: '#ff3d6e',
    attacks: [
      atk(.7, .25, .7, 20, 4.6, 'swing'),
      atk(.9, .32, 1.05, 26, 4.4, 'slam'),
      atk(.65, .55, .8, 16, 4.6, 'combo'),
      atk(1.05, .35, 1.2, 30, 5.2, 'bigslam'),
    ],
  });
  e.isBoss = true;
  return e;
}
