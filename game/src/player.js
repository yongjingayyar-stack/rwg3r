/* =====================================================
   player.js — the Agent: locomotion, combat states,
   dodge i-frames, double jump, block/parry, combo chain.
   Combat timing modelled on ZZZ-style action flow:
   snappy windups, cancel windows, reactive dodges.
   ===================================================== */
import * as THREE from 'three';
import { Input } from './input.js';
import { clamp, lerp, angleLerp, damp, easeOutCubic } from './util.js';
import {
  COMBO, comboDuration, PoseBlender,
  animIdle, animWalk, animRun, animAir, animLand, animAttack,
  animDodge, animBlock, animParrySuccess, animSpecial, animHitReact,
} from './animations.js';
import { BladeTrail, Ghosts } from './fx.js';
import { sfx } from './audio.js';

const G = 26;                       // gravity
export class Player {
  constructor(scene, world, fx, camera) {
    this.world = world; this.fx = fx; this.camera = camera;
    this.rig = fx.agentRig;
    scene.add(this.rig.root);
    this.blender = new PoseBlender(this.rig);
    this.trail = new BladeTrail(scene, '#7fe7ff');
    this.ghosts = new Ghosts(scene);
    this.scarfSprings = fx.scarfSprings;

    /* transform */
    this.pos = new THREE.Vector3(0, 1.2, 14);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;                    // facing
    this.rootY = 0;                        // animation root offset
    this.grounded = false;
    this.walkMode = false;                 // Shift toggles run/walk

    /* stats */
    this.maxHp = 100; this.hp = 100;
    this.maxEnergy = 100; this.energy = 0;
    this.alive = true;
    this.invuln = 0;                       // i-frame timer
    this.knockback = new THREE.Vector3();

    /* state machine */
    this.state = 'idle';                   // idle|run|walk|air|attack|dash|block|parryFx|special|hurt
    this.stateT = 0;
    this.comboStep = 0; this.comboWindow = 0; this.queued = false;
    this.dashCd = 0; this.parryWin = 0; this.blockHold = 0;
    this.jumpCount = 0; this.landT = -1;
    this.attackHits = new Set();           // enemies hit by current swing
    this.lastMoveDir = new THREE.Vector3(0, 0, -1);
    this.speedBlend = 0;                   // 0..1 walk→run blend for anim
    this.camYaw = Math.PI; this.camPitch = .32; this.camDist = 5.4; this.camDistTarget = 5.4;
    this.shake = 0;
    this.stats = { hits: 0, parries: 0, dodges: 0, dmgDealt: 0 };
  }

  get eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z); }
  get fwd() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  canAct() {
    return this.alive && ['idle', 'run', 'walk', 'air'].includes(this.state);
  }

  /* ================= main update ================= */
  update(dt, game) {
    if (!this.alive) { this.animateLoco(dt, game, 0); return; }
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.parryWin = Math.max(0, this.parryWin - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    if (this.comboWindow <= 0 && this.state !== 'attack') this.comboStep = 0;
    this.stateT += dt;

    this.handleCamera(dt);
    this.handleActions(game);
    this.handleMovement(dt, game);
    this.physics(dt);
    this.animateLoco(dt, game, this.vel.length());
    this.trail.update(dt);
    this.ghosts.update(dt);
    Input.poll();
  }

  handleCamera(dt) {
    if (Input.locked) {
      this.camYaw -= Input.mouseDX * Input.sensitivity;
      this.camPitch = clamp(this.camPitch + Input.mouseDY * Input.sensitivity, -.55, 1.25);
      if (Input.wheel) this.camDistTarget = clamp(this.camDistTarget + Input.wheel * .6, 3.2, 9);
    }
    if (Input.hit('KeyC')) this.camDistTarget = this.camDistTarget > 4 ? 8.5 : 3.6;
    this.camDist = damp(this.camDist, this.camDistTarget, 8, dt);

    const cam = this.camera;
    const pivot = this.eyePos.clone().add(new THREE.Vector3(0, .35, 0));
    // lag: yaw eases toward target for that smooth 3rd-person follow
    this.yawCamShown = angleLerp(this.yawCamShown ?? this.camYaw, this.camYaw, 1 - Math.exp(-14 * dt));
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const dir = new THREE.Vector3(
      Math.sin(this.yawCamShown) * cp, sp, Math.cos(this.yawCamShown) * cp);
    let desired = pivot.clone().addScaledVector(dir, this.camDist);
    // keep camera above ground / out of solid
    const gy = this.world.groundAt(desired.x, desired.z, Infinity) + .4;
    desired.y = Math.max(desired.y, gy);
    [desired.x, desired.z] = this.world.resolve(desired.x, desired.z, .5, this.pos.y, this.pos.y + 2);
    cam.position.lerp(desired, 1 - Math.exp(-20 * dt));
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.6);
      const s = this.shake * this.shake * .35;
      cam.position.x += (Math.random() - .5) * s;
      cam.position.y += (Math.random() - .5) * s;
      cam.position.z += (Math.random() - .5) * s;
    }
    cam.lookAt(pivot.x, pivot.y + .1, pivot.z);
  }

  /* ---------------- actions ---------------- */
  handleActions(game) {
    /* ATTACK (LMB) */
    if (Input.click('left')) {
      if (this.canAct() || (this.state === 'attack' && this.comboWindow > 0)) {
        if (this.state === 'attack' && this.comboWindow > 0) this.queued = true;
        else if (this.canAct()) this.startAttack(game);
      } else if (this.state === 'block') {
        this.releaseBlock(game);          // block → attack cancel (riposte feel)
      }
    }
    /* BLOCK / PARRY (RMB hold) */
    if (Input.click('right') && this.canAct()) this.enterBlock();
    if (this.state === 'block' && !Input.buttons.has('right')) this.releaseBlock(game);

    /* DASH / DODGE (Q) */
    if (Input.hit('KeyQ') && this.dashCd <= 0 &&
      (this.canAct() || this.state === 'block' || (this.state === 'attack' && this.stateT > .1))) {
      this.startDash(game);
    }
    /* JUMP / DOUBLE JUMP (Space) */
    if (Input.hit('Space')) {
      if (this.canAct() || this.state === 'block') {
        if (this.grounded) this.jump(13.2, game);
        else if (this.jumpCount < 2) this.jump(11.5, game, true);
      } else if (this.state === 'attack' && this.grounded && this.stateT > .12) {
        // attack → jump cancel keeps pressure (style move)
        this.endAttackSoft();
        this.jump(12.5, game);
      }
    }
    /* SPECIAL (F) */
    if (Input.hit('KeyF') && this.energy >= 60 && this.canAct()) {
      this.energy -= 60;
      this.setState('special', 0);
      sfx.special();
      this.fx.post.params.whiteFlash = .35;
      this.shake = 1.1;
      game.onSpecialSwing(this);
    }
    /* SHIFT toggle run/walk */
    if (Input.hit('ShiftLeft') || Input.hit('ShiftRight')) {
      this.walkMode = !this.walkMode;
      sfx.ui();
      game.toast(this.walkMode ? 'WALK MODE' : 'RUN MODE', '', 700);
    }
    /* INTERACT (E) */
    if (Input.hit('KeyE')) game.tryInteract(this);

    /* state timers */
    switch (this.state) {
      case 'attack': {
        const S = COMBO[this.comboStep];
        const total = comboDuration(this.comboStep);
        const p = clamp(this.stateT / total, 0, 1);
        // active-window hit detection
        const t = this.stateT;
        if (t >= S.windup && t <= S.windup + S.active + .04) {
          game.onPlayerAttackFrame(this, S);
        }
        if (t >= S.windup && t < S.windup + S.active && !this._trailOn) {
          this._trailOn = true; this.trail.begin(); sfx.swing(this.comboStep);
        }
        if (this._trailOn && t > S.windup + S.active + .06) { this._trailOn = false; this.trail.end(); }
        if (p >= 1) {
          if (this.queued && this.comboStep < COMBO.length - 1) { this.queued = false; this.startAttack(game, true); }
          else { this.queued = false; this.setState(this.grounded ? 'idle' : 'air', 0); this.comboWindow = .3; }
        }
        break;
      }
      case 'dash': {
        const dur = .34;
        const p = this.stateT / dur;
        if (this.stateT < .26) {
          if (this.stateT % .05 < dt) this.ghosts.spawnFrom(this.rig.root, '#5ce1ff', .3);
        }
        if (p >= 1) this.setState(this.grounded ? 'idle' : 'air', 0);
        break;
      }
      case 'parryFx': {
        if (this.stateT > .42) this.setState('idle', 0);
        break;
      }
      case 'special': {
        const dur = .8;
        if (this.stateT > .2 && this.stateT < .6 && !this._spHit) game.onSpecialActive(this);
        if (this.stateT > .2 && !this._trailOn) { this._trailOn = true; this.trail.begin(); }
        if (this.stateT > .6 && this._trailOn) { this._trailOn = false; this.trail.end(); }
        if (this.stateT >= dur) { this._spHit = false; this._trailOn = false; this.setState('idle', 0); }
        break;
      }
      case 'hurt': {
        if (this.stateT > .32) this.setState(this.grounded ? 'idle' : 'air', 0);
        break;
      }
    }
  }

  startAttack(game, chain = false) {
    if (!chain) this.comboStep = this.comboWindow > 0 ? Math.min(this.comboStep + 1, COMBO.length - 1) : 0;
    this.attackHits.clear();
    this._spHit = false;
    this.setState('attack', 0);
    // small lunge during active frames handled in movement
  }
  endAttackSoft() {
    this._trailOn = false; this.trail.end(false);
    this.comboWindow = .25;
    this.setState(this.grounded ? 'idle' : 'air', 0);
  }
  enterBlock() {
    this.setState('block', 0);
    this.blockHold = 0;
    this.parryWin = .4;                     // perfect-parry window after raising guard
  }
  releaseBlock() {
    if (this.state !== 'block') return;
    this.setState(this.grounded ? 'idle' : 'air', 0);
  }
  startDash(game) {
    this.dashCd = .62;
    this.invuln = .3;                       // dodge i-frames
    this.setState('dash', 0);
    this._spHit = false;
    // dash direction: input vector relative to camera, default sideways-back
    const [mx, mz] = Input.moveAxis();
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const d = new THREE.Vector3().addScaledVector(f, -mz).addScaledVector(r, mx);
    if (d.lengthSq() < .01) d.copy(r).multiplyScalar(this.dashSide = -(this.dashSide || 1));
    else d.normalize();
    this.dashDir = d.clone();
    this.yaw = Math.atan2(d.x, d.z);
    this.vel.y = Math.max(this.vel.y, -2);
    sfx.dodge();
    game.onDodge(this);
  }
  jump(v, game, dbl = false) {
    this.vel.y = v;
    this.jumpCount++;
    this.grounded = false;
    this.setState('air', 0);
    sfx.jump();
    if (dbl) {
      this.fx.parts.ring(this.pos.clone().setY(this.pos.y + .3), '#7dffd4', 18, 5, .2);
      this.fx.parts.burst(this.pos.clone().setY(this.pos.y + .2), 10, '#aef4ff', 4, .1, .4);
    }
  }

  setState(s, t = 0) {
    if (this.state === s) return;
    this.state = s; this.stateT = t;
    if (s !== 'attack' && s !== 'special') { this._trailOn = false; this.trail.end(); }
  }

  /* ---------------- movement ---------------- */
  handleMovement(dt, game) {
    const [mx, mz] = Input.moveAxis();
    const moving = mx !== 0 || mz !== 0;
    const f = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const r = new THREE.Vector3(f.z, 0, -f.x);
    const wish = new THREE.Vector3().addScaledVector(f, -mz).addScaledVector(r, mx);
    if (wish.lengthSq() > 0) wish.normalize();
    const RUN = 9.2, WALK = 4.4;
    let speed = this.walkMode ? WALK : RUN;

    if (this.state === 'dash') {
      // ballistic dash slide
      const k = easeOutCubic(clamp(this.stateT / .22, 0, 1));
      this.vel.x = this.dashDir.x * 16 * (1 - k * .75);
      this.vel.z = this.dashDir.z * 16 * (1 - k * .75);
      return;
    }
    if (this.state === 'attack') {
      const S = COMBO[this.comboStep];
      const inStrike = this.stateT > S.windup && this.stateT < S.windup + S.active + .1;
      const drift = inStrike ? 6.5 : 1.2;
      // slight forward drift toward facing while attacking
      this.vel.x = damp(this.vel.x, this.fwd.x * drift, 12, dt);
      this.vel.z = damp(this.vel.z, this.fwd.z * drift, 12, dt);
      if (moving && !inStrike) this.yaw = angleLerp(this.yaw, Math.atan2(wish.x, wish.z), 1 - Math.exp(-6 * dt));
      return;
    }
    if (this.state === 'special') {
      this.vel.x *= Math.exp(-6 * dt); this.vel.z *= Math.exp(-6 * dt);
      return;
    }
    if (this.state === 'block') {
      speed *= .38;
      this.vel.x = damp(this.vel.x, wish.x * speed, 10, dt);
      this.vel.z = damp(this.vel.z, wish.z * speed, 10, dt);
      if (moving) this.yaw = angleLerp(this.yaw, Math.atan2(wish.x, wish.z), 1 - Math.exp(-8 * dt));
      this.blockHold += dt;
      return;
    }
    if (this.state === 'hurt') {
      this.vel.x *= Math.exp(-3 * dt); this.vel.z *= Math.exp(-3 * dt);
      return;
    }
    // free locomotion (idle/run/walk/air)
    const accel = this.grounded ? 42 : 12;
    const fric = this.grounded ? 14 : 1.2;
    const tx = wish.x * speed, tz = wish.z * speed;
    this.vel.x += (tx - this.vel.x) * Math.min(1, accel * dt * .12);
    this.vel.z += (tz - this.vel.z) * Math.min(1, accel * dt * .12);
    if (!moving && this.grounded) {
      this.vel.x *= Math.exp(-fric * dt);
      this.vel.z *= Math.exp(-fric * dt);
    }
    if (moving) {
      this.lastMoveDir.set(wish.x, 0, wish.z);
      this.yaw = angleLerp(this.yaw, Math.atan2(wish.x, wish.z), 1 - Math.exp(-14 * dt));
    }
    // locomotion state for animation
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded) this.setStateIfFree('air');
    else if (hspeed > .6) this.setStateIfFree(this.walkMode ? 'walk' : 'run');
    else this.setStateIfFree('idle');
  }
  setStateIfFree(s) {
    if (['idle', 'run', 'walk', 'air'].includes(this.state)) this.state = s;
  }

  physics(dt) {
    this.vel.y -= G * dt;
    // knockback decay
    this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.knockback, dt);
    this.knockback.multiplyScalar(Math.exp(-6 * dt));

    const prevFeet = this.pos.y;
    [this.pos.x, this.pos.z] = this.world.resolve(this.pos.x, this.pos.z, .42, this.pos.y + .1, this.pos.y + 1.4);
    const gy = this.world.groundAt(this.pos.x, this.pos.z, prevFeet);
    if (this.pos.y <= gy + .001 && this.vel.y <= 0) {
      if (!this.grounded) this.onLand(gy);
      this.pos.y = gy;
      this.vel.y = 0;
      this.grounded = true;
      this.jumpCount = 0;
    } else {
      if (this.grounded && this.pos.y > gy + .05) { this.grounded = false; }
    }
    if (this.landT >= 0) {
      this.landT += dt;
      if (this.landT > .3) this.landT = -1;
    }
  }

  onLand(gy) {
    const fallSpeed = -this.vel.y;
    if (fallSpeed > 4 || !this.grounded) {
      this.landT = 0;
      sfx.land();
      const p = this.pos.clone(); p.y = gy + .05;
      this.fx.parts.dust(p, clamp(Math.floor(fallSpeed), 4, 14));
      if (fallSpeed > 16) this.shake = Math.min(1, fallSpeed / 30);
    }
    this.grounded = true;
  }

  /* ---------------- damage interface ---------------- */
  takeHit(dmg, fromPos, opts = {}) {
    if (!this.alive) return;
    if (this.invuln > 0) return;
    const dirToMe = this.pos.clone().sub(fromPos).setY(0).normalize();
    const facingDot = dirToMe.dot(this.fwd);        // ~-1 when attack comes from front

    if (this.state === 'block' && facingDot < -.25) {
      if (this.parryWin > 0 && !opts.unparryable) {
        this.onParried(fromPos, opts);
        return;
      }
      // normal block: chip damage + pushback
      const chip = dmg * .12;
      this.hp = Math.max(0, this.hp - chip);
      this.knockback.copy(dirToMe).multiplyScalar(4);
      this.energy = Math.min(this.maxEnergy, this.energy + 8);
      sfx.block();
      this.fx.parts.sparks(this.eyePos.clone().addScaledVector(this.fwd, .8), dirToMe.clone().negate(), 10, '#ffd166');
      this.fx.flashes.spawn(this.eyePos.clone().addScaledVector(this.fwd, .9), '#ffe9a8', 1.2, .15);
      this.fx.post.params.tint = Math.max(this.fx.post.params.tint, .12);
      this.shake = .35;
      return;
    }
    // unguarded hit
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = .7;
    this.knockback.copy(dirToMe).multiplyScalar(opts.heavy ? 11 : 6);
    this.vel.y = Math.max(this.vel.y, opts.heavy ? 6 : 3);
    this.setState('hurt', 0);
    this.comboStep = 0; this.comboWindow = 0;
    sfx.hurt();
    this.fx.post.params.tint = Math.min(.5, this.fx.post.params.tint + .25);
    this.shake = opts.heavy ? 1.2 : .7;
    this.fx.parts.burst(this.eyePos, 14, '#ff5e7e', 5, .12, .5);
    if (this.hp <= 0) this.die();
  }

  /** called by game when an enemy attack lands inside our parry window */
  onParried(fromPos, opts = {}) {
    this.parryWin = 0;
    this.setState('parryFx', 0);
    this.energy = Math.min(this.maxEnergy, this.energy + 22);
    this.stats.parries++;
    sfx.parry();
    this.fx.post.params.whiteFlash = .5;
    this.fx.post.params.ca = .006;
    setTimeout(() => { this.fx.post.params.ca = .0028; }, 260);
    this.shake = .8;
    const mid = this.pos.clone().lerp(fromPos, .5); mid.y += 1;
    this.fx.flashes.spawn(mid, '#fff6c8', 3.2, .22);
    this.fx.rings.spawn(mid.clone().setY(this.pos.y + .1), '#ffd166', 5, .45);
    this.fx.parts.ring(mid, '#ffe9a8', 30, 9, .1);
    this.fx.parts.sparks(mid, this.fwd.clone().negate(), 26, '#ffffff');
    if (opts.onStagger) opts.onStagger();
    this.fx.gameTimeStop = .22;            // dramatic freeze on parry
  }

  die() {
    this.alive = false;
    this.setState('hurt', 0);
    sfx.defeat();
  }
  respawn() {
    this.alive = true;
    this.hp = this.maxHp; this.energy = 0;
    this.pos.set(0, 2.4, 14); this.vel.set(0, 0, 0);
    this.knockback.set(0, 0, 0);
    this.invuln = 1.5; this.comboStep = 0;
    this.setState('idle', 0);
  }

  /* ---------------- animation layering ---------------- */
  animateLoco(dt, game, hspeed) {
    const rig = this.rig;
    rig.rootY = this.rootY;
    const B = this.blender;
    B.start();
    rig.root.rotation.y = this.yaw;

    // footstep events
    this.animT = (this.animT ?? 0) + dt * (1 + hspeed * .04);
    const cadence = this.state === 'run' ? .34 : this.state === 'walk' ? .52 : 0;
    if (cadence && this.grounded) {
      this.stepT = (this.stepT ?? 0) + dt;
      if (this.stepT >= cadence) {
        this.stepT = 0;
        const foot = (this._stepFlip = !this._stepFlip) ? rig.footR : rig.footL;
        const p = foot.getWorldPosition(new THREE.Vector3());
        this.fx.parts.dust(p, 3, '#7f93b5');
        sfx.land.call?.(); // subtle
      }
    }

    const w = clamp(hspeed / 6, 0, 1);
    this.speedBlend = damp(this.speedBlend, w, 10, dt);

    // base locomotion layer
    if (!this.grounded && ['idle', 'run', 'walk', 'air', 'attack'].includes(this.state)) {
      B.add((r) => animAir(r, this.vel.y), 1);
    } else {
      B.add((r) => animIdle(r, this.animT), 1 - this.speedBlend);
      if (this.walkMode) B.add((r) => animWalk(r, this.animT, 1), this.speedBlend);
      else B.add((r) => animRun(r, this.animT, 1), this.speedBlend);
    }

    // action overlays
    switch (this.state) {
      case 'attack': {
        const total = comboDuration(this.comboStep);
        const p = clamp(this.stateT / total, 0, 1);
        B.add((r) => animAttack(r, this.comboStep, p), 1);
        break;
      }
      case 'dash':
        B.add((r) => animDodge(r, clamp(this.stateT / .34, 0, 1), this.dashDir ?
          Math.sign(this.dashDir.clone().sub(this.fwd).dot(new THREE.Vector3(-this.fwd.z, 0, this.fwd.x))) : 0), 1);
        break;
      case 'block':
        B.add((r) => animBlock(r, this.blockHold), 1);
        break;
      case 'parryFx':
        B.add((r) => animParrySuccess(r, clamp(this.stateT / .42, 0, 1)), 1);
        break;
      case 'special':
        B.add((r) => animSpecial(r, clamp(this.stateT / .8, 0, 1)), 1);
        break;
      case 'hurt':
        B.add((r) => animHitReact(r, clamp(this.stateT / .32, 0, 1), true), 1);
        break;
    }
    if (this.landT >= 0) B.add((r) => animLand(r, this.landT / .3), 1);

    // sword trail sampling during swings
    if (this._trailOn) {
      rig.root.updateMatrixWorld(true);
      this.trail.sample(rig.swordBase.getWorldPosition(new THREE.Vector3()),
        rig.swordTip.getWorldPosition(new THREE.Vector3()));
    }
    // scarf & ponytail secondary motion
    game.updateSecondary(rig, dt);
  }
}
