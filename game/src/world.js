/* =====================================================
   world.js — open-world generation + collision queries
   Neon post-apocalyptic city ruins ("The Hollow"):
   towers, rooftops you can jump onto, ramps, neon signs,
   fog walls, floating debris, interactive teleporter.
   ===================================================== */
import * as THREE from 'three';
import { groundTexture, concreteTexture, neonPanelTexture, skyGradient, mulberry32, glowSprite } from './util.js';

export const WORLD_R = 150;          // playable radius (fog wall beyond)

/** AABB collider: {min:Vector3, max:Vector3, oneWay?} */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.ramps = [];                 // sloped walkable surfaces {p0,p1,topY,width,dir}
    this.interactives = [];
    this.anims = [];                 // per-frame animated props
    this.time = 0;
    this.build();
  }

  addBox(x, y, z, w, h, d, mat, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = opts.noShadow !== true;
    m.receiveShadow = true;
    this.scene.add(m);
    if (!opts.noCollider) {
      this.colliders.push({
        min: new THREE.Vector3(x - w / 2, y, z - d / 2),
        max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
        oneWay: opts.oneWay || false,
        mesh: m,
      });
    }
    return m;
  }

  build() {
    const rnd = mulberry32(2077);
    /* ---------- lighting ---------- */
    const hemi = new THREE.HemisphereLight('#4a6b9e', '#0c0f18', .85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffd9a8', 2.6);
    sun.position.set(60, 90, -40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
    const S = 90;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = .035;
    this.scene.add(sun); this.sun = sun;
    const rim = new THREE.DirectionalLight('#3fa8ff', 1.1);
    rim.position.set(-50, 40, 60);
    this.scene.add(rim);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    sun.target = this.sunTarget;

    /* ---------- sky dome ---------- */
    const skyTex = skyGradient('#03060f', '#0d1b34', '#33143a');
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
    this.scene.add(sky);
    // distant "sun/moon" disc glow
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite('#ffe9c4'), transparent: true, depthWrite: false, fog: false, opacity: .95,
    }));
    moon.position.set(150, 120, -260); moon.scale.setScalar(90);
    this.scene.add(moon);

    /* ---------- ground ---------- */
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTexture(48), roughness: .82, metalness: .25, color: '#8fa3c0',
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_R + 60, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    /* ---------- arena platform with ramps & rooftops ---------- */
    const platMat = new THREE.MeshStandardMaterial({ map: concreteTexture(6), roughness: .9, color: '#aab6cc' });
    const metalMat = new THREE.MeshStandardMaterial({ color: '#39445c', roughness: .35, metalness: .85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#161c2b', roughness: .6, metalness: .5 });
    this.mats = { platMat, metalMat, darkMat };

    // main raised arena block (rooftop of a fallen megastructure)
    this.addBox(0, 0, 0, 58, 1.2, 58, platMat);
    // decorative ring lights around arena edge
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      this.addBox(Math.cos(a) * 28, 1.2, Math.sin(a) * 28, .5, .35, .5,
        new THREE.MeshStandardMaterial({ color: '#54e6ff', emissive: '#2bd8ff', emissiveIntensity: 3 }), { noShadow: true });
    }
    // four ramps up to the arena (walk + run + jump routes).
    // Each ramp climbs toward the center along its inward axis.
    const RAMP_LEN = 9, RAMP_W = 7, ARENA_EDGE = 29, RAMP_TOP = 1.45;
    const rampDefs = [
      { cx: 0, cz: 34, ix: 0, iz: -1 },   // south ramp, inward = -Z
      { cx: -34, cz: 0, ix: 1, iz: 0 },   // west ramp,  inward = +X
      { cx: 34, cz: 0, ix: -1, iz: 0 },   // east ramp,  inward = -X
      { cx: 0, cz: -34, ix: 0, iz: 1 },   // north ramp, inward = +Z
    ];
    for (const r of rampDefs) {
      const tilt = Math.atan2(RAMP_TOP, RAMP_LEN);
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(RAMP_W, .3, RAMP_LEN + 2), metalMat);
      // position so inner end overlaps arena edge slightly
      const midIn = (ARENA_EDGE - 1 + (ARENA_EDGE + RAMP_LEN)) / 2;
      ramp.position.set(r.ix * midIn, RAMP_TOP / 2 - .1, r.iz * midIn);
      ramp.rotation.set(0, Math.atan2(r.ix, r.iz), 0);   // face inward
      ramp.rotateX(-tilt);                                // climb toward center
      ramp.castShadow = ramp.receiveShadow = true;
      this.scene.add(ramp);
      this.ramps.push({
        cx: r.ix * midIn, cz: r.iz * midIn,      // ramp center
        ix: r.ix, iz: r.iz,                       // inward unit axis
        len: RAMP_LEN + 2, width: RAMP_W,
        topY: RAMP_TOP, tilt,
      });
    }

    /* ---------- towers / buildings ---------- */
    const winMat = new THREE.MeshStandardMaterial({
      map: neonPanelTexture(195), emissiveMap: neonPanelTexture(195),
      emissive: '#3fc8ff', emissiveIntensity: 1.6, roughness: .5,
    });
    const winMat2 = new THREE.MeshStandardMaterial({
      map: neonPanelTexture(320), emissiveMap: neonPanelTexture(320),
      emissive: '#ff5ecf', emissiveIntensity: 1.2, roughness: .5,
    });
    const towerCount = 26;
    for (let i = 0; i < towerCount; i++) {
      const a = (i / towerCount) * Math.PI * 2 + rnd() * .2;
      const dist = 62 + rnd() * 74;
      const w = 7 + rnd() * 11, d = 7 + rnd() * 11;
      const h = 12 + rnd() * 46;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      const mat = i % 2 ? platMat : darkMat;
      const t = this.addBox(x, 0, z, w, h, d, mat);
      // glowing window strips
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w * .8, h * .85), i % 3 ? winMat : winMat2);
      face.position.set(x, h / 2 + .4, z + d / 2 + .05);
      this.scene.add(face);
      const face2 = face.clone(); face2.position.z = z - d / 2 - .05; face2.rotation.y = Math.PI;
      this.scene.add(face2);
      // antenna on some
      if (rnd() > .5) {
        this.addBox(x, h, z, .3, 6 + rnd() * 5, .3, metalMat, { noCollider: true });
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(.4, 8, 8),
          new THREE.MeshBasicMaterial({ color: '#ff4455' }));
        beacon.position.set(x, h + 11, z);
        this.scene.add(beacon);
        this.anims.push({ type: 'blink', obj: beacon, seed: rnd() * 9 });
      }
    }
    // inner cover blocks (arena-level crates & pillars)
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, dist = 6 + rnd() * 22;
      const s = 1.4 + rnd() * 2.4;
      this.addBox(Math.cos(a) * dist, 1.2, Math.sin(a) * dist, s, s * (.7 + rnd()), s,
        rnd() > .5 ? metalMat : platMat);
    }
    // elevated sniper platforms connected conceptually by double-jump
    for (const p of [[-18, 4.6, -18], [18, 5.4, -16], [16, 4.0, 18], [-16, 6.2, 16]]) {
      this.addBox(p[0], p[1], p[2], 6, .5, 6, metalMat);
      this.addBox(p[0], p[1] + .5, p[2], 6.2, .12, 6.2,
        new THREE.MeshStandardMaterial({ color: '#123', emissive: '#1e90ff', emissiveIntensity: .7 }), { noCollider: true });
    }

    /* ---------- neon signage arches ---------- */
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + .4;
      const R = 46;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const hue = [190, 320, 45, 265, 150][i];
      const signMat = new THREE.MeshStandardMaterial({
        color: `hsl(${hue},90%,60%)`, emissive: `hsl(${hue},100%,55%)`, emissiveIntensity: 2.4, roughness: .3,
      });
      this.addBox(x - 2.6, 0, z, .6, 9, .6, darkMat, { noCollider: true });
      this.addBox(x + 2.6, 0, z, .6, 9, .6, darkMat, { noCollider: true });
      const bar = this.addBox(x, 8.4, z, 6.4, 1.5, .4, signMat, { noCollider: true });
      bar.lookAt(0, 8.4, 0);
      const light = new THREE.PointLight(`hsl(${hue},100%,60%)`, 60, 26, 2);
      light.position.set(x, 8.6, z);
      this.scene.add(light);
      this.anims.push({ type: 'flicker', mat: signMat, light, seed: rnd() * 13 });
    }

    /* ---------- floating hollow debris ---------- */
    const debMat = new THREE.MeshStandardMaterial({ color: '#242e45', roughness: .5, metalness: .6,
      emissive: '#10345c', emissiveIntensity: .35 });
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2, dist = 20 + rnd() * 110;
      const s = .5 + rnd() * 2.2;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), debMat);
      m.position.set(Math.cos(a) * dist, 8 + rnd() * 26, Math.sin(a) * dist);
      m.castShadow = true;
      this.scene.add(m);
      this.anims.push({ type: 'float', obj: m, base: m.position.y, amp: .6 + rnd() * 1.6,
        spd: .3 + rnd() * .5, ph: rnd() * 9, rot: (rnd() - .5) * .4 });
    }

    /* ---------- fog-wall boundary (gameplay limit) ---------- */
    const wallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color('#2bd8ff') } },
      vertexShader: /*glsl*/`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: /*glsl*/`
        varying vec2 vUv; uniform float uTime; uniform vec3 uCol;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
        void main(){
          float f = sin(vUv.x*90.+uTime*.8)*.5+.5;
          float scan = smoothstep(.4,.5,fract(vUv.y*26.-uTime*.35));
          float noise = hash(floor(vUv*vec2(140.,40.))+floor(uTime*6.));
          float a = (.10 + f*.05 + scan*.10 + noise*.06) * smoothstep(1.1,.15,vUv.y);
          gl_FragColor = vec4(uCol*(1.2+scan), a);
        }`,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(WORLD_R, WORLD_R, 70, 64, 1, true), wallMat);
    wall.position.y = 30;
    this.scene.add(wall);
    this.wallMat = wallMat;

    /* ---------- teleporter / interactable ---------- */
    const tpGroup = new THREE.Group();
    tpGroup.position.set(0, 1.2, 0);
    const padMat = new THREE.MeshStandardMaterial({ color: '#0a121f', emissive: '#2bd8a8', emissiveIntensity: 1.2, roughness: .3, metalness: .7 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, .3, 8), padMat);
    pad.receiveShadow = true;
    tpGroup.add(pad);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#5cffd0', transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 14, 16, 1, true), beamMat);
    beam.position.y = 7;
    tpGroup.add(beam);
    const ringsG = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(2 + i * .35, .05, 8, 40),
        new THREE.MeshBasicMaterial({ color: '#7dffe0', transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }));
      r.rotation.x = Math.PI / 2; r.position.y = .3 + i * 1.2;
      tpGroup.add(r); ringsG.push(r);
    }
    const tpLight = new THREE.PointLight('#3dffc0', 40, 20, 2);
    tpLight.position.y = 2;
    tpGroup.add(tpLight);
    this.scene.add(tpGroup);
    this.teleporter = { pos: new THREE.Vector3(0, 1.5, 0), group: tpGroup, rings: ringsG, light: tpLight };
    this.anims.push({ type: 'tp', rings: ringsG, light: tpLight, beam });
  }

  /* ================= collision helpers ================= */

  /** sloped surface height at (x,z), or null if not on a ramp */
  rampHeightAt(x, z) {
    for (const r of this.ramps) {
      const dx = x - r.cx, dz = z - r.cz;
      const along = dx * r.ix + dz * r.iz;         // + inward toward arena center
      const across = -dx * r.iz + dz * r.ix;       // lateral
      if (Math.abs(along) > r.len / 2 || Math.abs(across) > r.width / 2) continue;
      // along ranges -len/2 (outer, y≈0) .. +len/2 (inner, y≈topY)
      const h = r.topY * (along + r.len / 2) / r.len + .15;
      return Math.max(0, Math.min(r.topY + .15, h));
    }
    return null;
  }

  /** ground height under a point (platform tops, ramps, base plane) */
  groundAt(x, z, prevY = Infinity) {
    let best = 0;                       // base plane y=0
    const rh = this.rampHeightAt(x, z);
    if (rh !== null && rh <= prevY + .35 && rh > best) best = rh;
    for (const c of this.colliders) {
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      const top = c.max.y;
      if (top <= prevY + .001 && top > best) best = top;
    }
    return best;
  }

  /** push a cylinder (x,z,radius) out of solid boxes between feetY..headY */
  resolve(x, z, radius, feetY, headY) {
    let px = x, pz = z;
    for (const c of this.colliders) {
      if (c.oneWay) continue;
      if (c.max.y <= feetY + .02 || c.min.y >= headY - .02) continue;
      const nx = Math.max(c.min.x, Math.min(px, c.max.x));
      const nz = Math.max(c.min.z, Math.min(pz, c.max.z));
      const dx = px - nx, dz = pz - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        px = nx + (dx / d) * radius;
        pz = nz + (dz / d) * radius;
      } else {
        // center inside box: push along smallest penetration axis
        const l = px - c.min.x + radius, rt = c.max.x - px + radius;
        const b = pz - c.min.z + radius, t = c.max.z - pz + radius;
        const m = Math.min(l, rt, b, t);
        if (m === l) px = c.min.x - radius;
        else if (m === rt) px = c.max.x + radius;
        else if (m === b) pz = c.min.z - radius;
        else pz = c.max.z + radius;
      }
    }
    // keep inside fog wall
    const dist = Math.hypot(px, pz);
    if (dist > WORLD_R - 1) {
      px *= (WORLD_R - 1) / dist;
      pz *= (WORLD_R - 1) / dist;
    }
    return [px, pz];
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.wallMat.uniforms.uTime.value = t;
    for (const a of this.anims) {
      switch (a.type) {
        case 'float':
          a.obj.position.y = a.base + Math.sin(t * a.spd + a.ph) * a.amp;
          a.obj.rotation.y += a.rot * dt;
          break;
        case 'blink':
          a.obj.visible = Math.sin(t * 3 + a.seed) > -.4;
          break;
        case 'flicker': {
          const n = Math.sin(t * 37 + a.seed) * Math.sin(t * 11 + a.seed * 2);
          const k = n > -.75 ? 1 : .15;
          a.mat.emissiveIntensity = 2.4 * k;
          a.light.intensity = 60 * k;
          break;
        }
        case 'tp':
          a.rings.forEach((r, i) => {
            r.position.y = .3 + ((t * (.6 + i * .25) + i * .4) % 1) * 3.2;
            r.material.opacity = .8 * (1 - ((t * (.6 + i * .25) + i * .4) % 1));
            r.rotation.z = t * (i % 2 ? -1 : 1) * .6;
          });
          a.light.intensity = 34 + Math.sin(t * 5) * 10;
          break;
      }
    }
  }
}
