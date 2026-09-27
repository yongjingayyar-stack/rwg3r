/* =====================================================
   characters.js — procedural stylized action-RPG rigs
   (ZZZ-style anime proportions: big hair, slim frame,
    oversized weapon; enemies = "Ethereal" machines)
   ===================================================== */
import * as THREE from 'three';

const P2 = Math.PI * 2;

/* ---------- helpers ---------- */
function M(opts) {
  return new THREE.MeshStandardMaterial({ roughness: .6, metalness: .1, flatShading: false, ...opts });
}
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function capsule(r, len, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function sphere(r, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
/** pivot group + child offset so joints rotate around their top */
function joint(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function limb(jointParent, r, len, mat) {
  const m = capsule(r, len, mat, 0, -(len / 2 + r * .4), 0);
  jointParent.add(m);
  return m;
}

/* =====================================================
   AGENT RIG — humanoid with weapon & scarf
   ===================================================== */
export function createAgentRig(colors = {}) {
  const c = {
    jacket: '#1b2334', trim: '#54e6ff', pants: '#141a28', skin: '#ffd9bd',
    hair: '#2b3550', accent: '#ffd166', boots: '#0c111d', blade: '#cfeaff',
    grip: '#20242e', ...colors,
  };
  const mats = {
    jacket: M({ color: c.jacket, roughness: .55 }),
    trim: M({ color: c.trim, emissive: c.trim, emissiveIntensity: 1.6, roughness: .3 }),
    pants: M({ color: c.pants, roughness: .7 }),
    skin: M({ color: c.skin, roughness: .6 }),
    hair: M({ color: c.hair, roughness: .45 }),
    accent: M({ color: c.accent, emissive: c.accent, emissiveIntensity: 1.2, roughness: .4 }),
    boots: M({ color: c.boots, roughness: .4, metalness: .3 }),
    blade: M({ color: c.blade, emissive: '#7fd4ff', emissiveIntensity: .9, metalness: .9, roughness: .15 }),
    grip: M({ color: c.grip, roughness: .8 }),
    dark: M({ color: '#0a0e16', roughness: .8 }),
  };

  const root = new THREE.Group();               // feet on y=0
  const pelvis = joint(root, 0, 0.98, 0);       // whole-body bob/lean pivot
  const chest = joint(pelvis, 0, 0.30, 0);      // torso twist pivot

  /* torso */
  const torso = box(.40, .52, .24, mats.jacket, 0, .12, 0);
  chest.add(torso);
  chest.add(box(.42, .07, .25, mats.trim, 0, .30, 0));      // glowing collar strip
  chest.add(box(.10, .30, .26, mats.dark, 0, .02, 0));      // vest core
  chest.add(box(.05, .26, .02, mats.accent, .16, .06, .13)); // side light
  chest.add(box(.05, .26, .02, mats.accent, -.16, .06, .13));

  /* head */
  const neck = joint(chest, 0, .40, 0);
  const head = joint(neck, 0, .17, 0);
  head.add(sphere(.155, mats.skin));
  const helm = box(.30, .17, .30, mats.hair, 0, .07, -.01);
  head.add(helm);
  // spiky anime hair
  for (let i = 0; i < 6; i++) {
    const s = box(.07, .22, .07, mats.hair, Math.sin(i * 1.1) * .12, .13, -Math.cos(i * .9) * .12);
    s.rotation.set(Math.cos(i) * .5, i, Math.sin(i) * .5);
    head.add(s);
  }
  head.add(box(.26, .06, .03, mats.trim, 0, .02, .155));    // visor band
  head.add(box(.05, .09, .06, mats.hair, .1, -.06, .13));   // jaw fringe L
  head.add(box(.05, .09, .06, mats.hair, -.1, -.06, .13));  // jaw fringe R
  // ponytail (secondary motion bone chain)
  const tail1 = joint(head, 0, .05, -.17);
  const tailM1 = capsule(.045, .16, mats.hair, 0, -.1, 0); tail1.add(tailM1);
  const tail2 = joint(tail1, 0, -.2, 0);
  const tailM2 = capsule(.035, .18, mats.hair, 0, -.11, 0); tail2.add(tailM2);
  tail2.add(sphere(.045, mats.accent, 0, -.22, 0));         // hair tie glow

  /* scarf */
  const scarf = [];
  let sp = joint(chest, 0, .34, -.1);
  const scarfMat = M({ color: '#c23a52', roughness: .8 });
  scarf.push(sp);
  for (let i = 0; i < 3; i++) {
    const seg = box(.2 - i * .04, .05, .16, scarfMat, 0, -.02, -.08);
    sp.add(seg);
    const nx = joint(sp, 0, -.02, -.15);
    scarf.push(nx); sp = nx;
  }

  /* arms */
  function makeArm(side) {
    const sh = joint(chest, side * .245, .26, 0);
    sh.add(sphere(.085, mats.jacket));                       // shoulder pad
    limb(sh, .06, .24, mats.jacket);                         // upper arm
    const el = joint(sh, 0, -.30, 0);
    limb(el, .055, .22, mats.jacket);                        // forearm
    el.add(box(.1, .05, .11, mats.trim, 0, -.28, 0));        // gauntlet glow ring
    const ha = joint(el, 0, -.34, 0);
    ha.add(box(.09, .1, .07, mats.skin));                    // hand
    return { sh, el, ha };
  }
  const armR = makeArm(1), armL = makeArm(-1);

  /* legs */
  function makeLeg(side) {
    const hp = joint(pelvis, side * .115, -.02, 0);
    hp.add(sphere(.085, mats.pants));
    limb(hp, .07, .3, mats.pants);                           // thigh
    const kn = joint(hp, 0, -.42, 0);
    limb(kn, .06, .3, mats.pants);                           // shin
    kn.add(box(.09, .05, .1, mats.trim, 0, -.32, .01));      // knee light
    const ft = joint(kn, 0, -.44, 0);
    ft.add(box(.115, .09, .24, mats.boots, 0, -.045, .05));  // boot
    return { hp, kn, ft };
  }
  const legR = makeLeg(1), legL = makeLeg(-1);

  /* oversized great-sword in right hand */
  const sword = new THREE.Group();
  armL.ha.visible; // noop keep linter calm
  const grip = box(.045, .26, .045, mats.grip, 0, -.1, 0);
  sword.add(grip);
  sword.add(box(.16, .04, .06, mats.accent, 0, .04, 0));     // crossguard
  sword.add(box(.03, .05, .03, mats.accent, 0, .09, 0));     // pommel
  const bladeG = joint(sword, 0, .1, 0);
  const bl = box(.11, 1.15, .035, mats.blade, 0, .575, 0);
  bl.rotation.z = 0;
  bladeG.add(bl);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.078, .22, 4), mats.blade);
  tip.position.y = 1.25; tip.rotation.y = Math.PI / 4; tip.castShadow = true;
  bladeG.add(tip);
  sword.add(box(.02, 1.0, .04, mats.trim, 0, .62, 0));       // energy fuller
  armR.ha.add(sword);
  sword.rotation.x = -0.35;                                   // resting angle
  sword.position.set(0, -.05, .02);

  /* FX anchors */
  const swordTip = new THREE.Object3D(); swordTip.position.set(0, 1.36, 0); bladeG.add(swordTip);
  const swordBase = new THREE.Object3D(); swordBase.position.set(0, .12, 0); bladeG.add(swordBase);
  const chestAnchor = new THREE.Object3D(); chestAnchor.position.set(0, .1, .15); chest.add(chestAnchor);
  const footR = new THREE.Object3D(); footR.position.set(0, -.1, .05); legR.ft.add(footR);
  const footL = new THREE.Object3D(); footL.position.set(0, -.1, .05); legL.ft.add(footL);

  const rig = {
    root, pelvis, chest, neck, head,
    armR, armL, legR, legL,
    scarf, tail: [tail1, tail2],
    sword, swordTip, swordBase, chestAnchor, footR, footL,
    mats, colors: c,
    _rest: null,
  };
  rig.captureRest();
  return rig;
}

/* rest-pose capture / blend utilities attached to any humanoid rig */
function attachPoseUtils(rig) {
  const parts = ['pelvis', 'chest', 'neck', 'head'];
  const joints = ['armR', 'armL', 'legR', 'legL'];
  rig.captureRest = function () {
    this._rest = {};
    for (const p of parts) this._rest[p] = this[p].rotation.clone();
    for (const j of joints) {
      this._rest[j] = Object.fromEntries(
        Object.entries(this[j]).map(([k, v]) => [k, v.rotation.clone()]));
    }
    this._rest.sword = this.sword ? this.sword.rotation.clone() : null;
  };
  /** reset every animated bone to rest pose (call before layering poses) */
  rig.resetPose = function () {
    for (const p of parts) this[p].rotation.copy(this._rest[p]);
    for (const j of joints) {
      for (const k in this[j]) if (this[j][k].rotation) this[j][k].rotation.copy(this._rest[j][k]);
    }
    if (this.sword && this._rest.sword) this.sword.rotation.copy(this._rest.sword);
    this.root.rotation.set(0, this.rootYaw || 0, 0);
    this.root.position.y = this.rootY || 0;
  };
  /** additive blend onto current pose */
  rig.pose = function (node, x = 0, y = 0, z = 0, add = true) {
    node.rotation.x += x; node.rotation.y += y; node.rotation.z += z;
  };
  rig.moveRoot = function (y = 0, add = true) {
    this.root.position.y = (add ? (this.rootY || 0) : 0) + y;
  };
  rig.tilt = function (x = 0, z = 0) {
    this.pelvis.rotation.x += x; this.pelvis.rotation.z += z;
  };
}

/* =====================================================
   ENEMY RIGS
   ===================================================== */
function etherealCore(matGlow) {
  const g = new THREE.Group();
  const core = sphere(.09, matGlow);
  g.add(core);
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(.16, 0),
    M({ color: '#141a26', metalness: .8, roughness: .3, transparent: true, opacity: .85 }));
  g.add(shell);
  g.userData.core = core; g.userData.shell = shell;
  return g;
}

/** "Rager" — agile mecha-hound Ethereal */
export function createRagerRig() {
  const body = M({ color: '#2a2438', roughness: .5, metalness: .4 });
  const dark = M({ color: '#151221', roughness: .7, metalness: .3 });
  const glow = M({ color: '#ff4fa0', emissive: '#ff2f8e', emissiveIntensity: 2.2, roughness: .3 });
  const root = new THREE.Group();
  const hip = joint(root, 0, .62, 0);
  const torso = joint(hip, 0, .05, .08);
  torso.add(box(.3, .3, .62, body, 0, 0, 0));
  torso.add(box(.1, .06, .5, glow, 0, .17, -.02));           // spine light
  const neckJ = joint(torso, 0, .12, .34);
  neckJ.add(box(.16, .14, .2, dark, 0, 0, .06));
  const head = joint(neckJ, 0, .04, .18);
  head.add(box(.2, .15, .26, body));
  head.add(box(.05, .05, .12, glow, .06, .02, .14));          // eye L
  head.add(box(.05, .05, .12, glow, -.06, .02, .14));         // eye R
  head.add(box(.12, .04, .1, dark, 0, -.08, .12));            // jaw
  // digitigrade legs
  function leg(side, front) {
    const hp = joint(torso, side * .15, -.1, front ? .22 : -.22);
    limb(hp, .05, .2, dark);
    const kn = joint(hp, 0, -.26, 0); kn.rotation.x = .7;
    limb(kn, .045, .2, body);
    const ft = joint(kn, 0, -.26, 0); ft.rotation.x = -.7;
    ft.add(box(.08, .06, .18, dark, 0, -.02, .03));
    ft.add(box(.02, .1, .02, glow, 0, .04, 0));
    return { hp, kn, ft };
  }
  const fl = leg(1, true), fr = leg(-1, true), hl = leg(1, false), hr = leg(-1, false);
  // tail
  const tail1 = joint(torso, 0, .1, -.32);
  tail1.add(capsule(.03, .16, dark, 0, 0, -.1));
  tail1.children[0].rotation.x = 1.3;
  const tail2 = joint(tail1, 0, 0, -.26);
  tail2.add(sphere(.05, glow));
  const pawR = new THREE.Object3D(); pawR.position.set(0, -.5, .1); fl.ft.add(pawR);
  const pawL = new THREE.Object3D(); pawL.position.set(0, -.5, .1); fr.ft.add(pawL);
  const rig = { root, hip, torso, neckJ, head, fl, fr, hl, hr, tail1, tail2, pawR, pawL, mats: { body, dark, glow } };
  attachPoseUtils(rig);
  return rig;
}

/** "Cauterizer" — heavy two-armed brute Ethereal */
export function createBruteRig() {
  const body = M({ color: '#33243a', roughness: .55, metalness: .45 });
  const dark = M({ color: '#1a1222', roughness: .7, metalness: .3 });
  const glow = M({ color: '#ffaa33', emissive: '#ff8800', emissiveIntensity: 2.2, roughness: .3 });
  const root = new THREE.Group();
  const hip = joint(root, 0, 1.05, 0);
  const torso = joint(hip, 0, .28, 0);
  torso.add(box(.62, .55, .38, body, 0, 0, 0));
  torso.add(box(.2, .1, .4, glow, 0, .1, 0));                 // furnace chest
  const head = joint(torso, 0, .42, 0);
  head.add(box(.26, .2, .26, dark));
  head.add(box(.18, .05, .05, glow, 0, .02, .14));            // visor slit
  head.add(box(.05, .18, .05, body, .1, .14, 0));             // horn L
  head.add(box(.05, .18, .05, body, -.1, .14, 0));            // horn R
  function arm(side) {
    const sh = joint(torso, side * .42, .16, 0);
    sh.add(sphere(.16, body));
    limb(sh, .09, .3, dark);
    const el = joint(sh, 0, -.42, 0);
    limb(el, .085, .3, body);
    const ha = joint(el, 0, -.42, 0);
    // giant claw/fist
    ha.add(box(.24, .22, .24, dark));
    for (let i = 0; i < 3; i++) {
      const f = box(.06, .2, .06, body, (i - 1) * .08, -.18, .06);
      f.rotation.x = -.3 + i * .12;
      ha.add(f);
    }
    ha.add(box(.03, .12, .03, glow, 0, .06, .13));
    return { sh, el, ha };
  }
  const armR = arm(1), armL = arm(-1);
  function leg(side) {
    const hp = joint(hip, side * .18, -.05, 0);
    limb(hp, .1, .3, dark);
    const kn = joint(hp, 0, -.44, 0);
    limb(kn, .09, .28, body);
    const ft = joint(kn, 0, -.46, 0);
    ft.add(box(.18, .1, .3, dark, 0, -.05, .05));
    return { hp, kn, ft };
  }
  const legR = leg(1), legL = leg(-1);
  const fistR = new THREE.Object3D(); fistR.position.set(0, -.2, .1); armR.ha.add(fistR);
  const fistL = new THREE.Object3D(); fistL.position.set(0, -.2, .1); armL.ha.add(fistL);
  const chestAnchor = new THREE.Object3D(); chestAnchor.position.set(0, 0, .2); torso.add(chestAnchor);
  const rig = { root, hip, torso, head, armR, armL, legR, legL, fistR, fistL, chestAnchor, mats: { body, dark, glow } };
  attachPoseUtils(rig);
  return rig;
}

/** boss = bigger brute with extra wings + dual cores */
export function createBossRig() {
  const rig = createBruteRig();
  const glow = M({ color: '#ff3d6e', emissive: '#ff1f57', emissiveIntensity: 2.6, roughness: .3 });
  const dark = M({ color: '#241019', roughness: .6, metalness: .5 });
  rig.mats.glow = glow;
  rig.torso.scale.setScalar(1.35);
  rig.head.scale.setScalar(1.2);
  // back-mounted energy wings
  for (const s of [1, -1]) {
    const w = joint(rig.torso, s * .3, .3, -.2);
    for (let i = 0; i < 3; i++) {
      const feather = box(.06, .5 - i * .1, .1, dark, s * (.18 + i * .16), .12 - i * .06, -.1 - i * .05);
      feather.rotation.z = s * (-.5 + i * .25);
      w.add(feather);
      const lite = box(.02, .42 - i * .1, .03, glow, s * (.18 + i * .16), .12 - i * .06, -.06 - i * .05);
      lite.rotation.z = feather.rotation.z;
      w.add(lite);
    }
    rig['wing' + (s > 0 ? 'R' : 'L')] = w;
  }
  const core = etherealCore(glow);
  core.position.set(0, .1, .22); core.scale.setScalar(1.4);
  rig.torso.add(core);
  rig.mats.body.color.set('#2c1626');
  return rig;
}

/* secondary-motion spring (ponytail/scarf/wings) */
export class Spring {
  constructor() { this.vz = 0; this.vy = 0; }
  update(obj, prevPos, dt, stiff = 90, dampv = 10) {
    const a = obj.getWorldPosition(new THREE.Vector3());
    const vel = a.clone().sub(prevPos).multiplyScalar(1 / Math.max(dt, 1e-4));
    this.vz += (-vel.z) * dt * .5; this.vy += (-vel.y) * dt * .5;
    this.vz *= Math.exp(-dampv * dt); this.vy *= Math.exp(-dampv * dt);
    obj.rotation.x = THREE.MathUtils.clamp(obj.rotation.x + (this.vz - obj.rotation.x) * stiff * dt * .1, -.9, .9);
    prevPos.copy(a);
  }
}

/* re-export attach util for the enemy wrapper */
export { attachPoseUtils };
