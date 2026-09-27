/* =====================================================
   fx.js — particles, blade trails, shockwaves, hit-flare,
           after-images and the custom post-processing stack
   (HDR bloom + radial chromatic aberration + film grain
    + vignette + damage tint) — all hand-written shaders.
   ===================================================== */
import * as THREE from 'three';
import { glowSprite, clamp } from './util.js';

/* =====================================================
   Particle pool — one Points draw call for everything
   ===================================================== */
export class Particles {
  constructor(scene, max = 2600) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.siz = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: glowSprite('#ffffff') }, uScale: { value: 480 } },
      vertexShader: /*glsl*/`
        attribute vec3 aColor; attribute float aSize;
        varying vec3 vCol;
        uniform float uScale;
        void main(){
          vCol = aColor;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /*glsl*/`
        uniform sampler2D uTex; varying vec3 vCol;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vCol * t.rgb * 2.2, t.a);
          if (gl_FragColor.a < .01) discard;
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.geo = g;
  }
  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 2.5) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    const c = color.isColor ? color : new THREE.Color(color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.siz[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag;
  }
  remove(i) {
    const last = --this.count;
    if (i !== last) {
      for (let k = 0; k < 3; k++) {
        this.pos[i * 3 + k] = this.pos[last * 3 + k];
        this.vel[i * 3 + k] = this.vel[last * 3 + k];
        this.col[i * 3 + k] = this.col[last * 3 + k];
      }
      this.siz[i] = this.siz[last]; this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last]; this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last];
    }
  }
  update(dt) {
    for (let i = this.count - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.remove(i); continue; }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.siz[i] *= (f < .4 ? .965 : .995);
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
  /* ---- canned effects ---- */
  burst(p, n, color, speed = 6, size = .12, life = .5, spreadY = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - .5) * spreadY;
      const s = speed * (.4 + Math.random() * .8);
      this.spawn(p.x, p.y, p.z,
        Math.cos(a) * s, (Math.random() * .7 + .15) * s * e + s * .25, Math.sin(a) * s,
        color, size * (.5 + Math.random()), life * (.6 + Math.random() * .6), -14, 3.5);
    }
  }
  sparks(p, dir, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const v = new THREE.Vector3(Math.cos(a) * r, Math.random() * 1.4, Math.sin(a) * r)
        .multiplyScalar(5 + Math.random() * 7).addScaledVector(dir, 3);
      this.spawn(p.x, p.y, p.z, v.x, v.y, v.z, color, .07 + Math.random() * .06, .35 + Math.random() * .3, -18, 2);
    }
  }
  ring(p, color, n = 26, speed = 7, y = .1) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn(p.x, p.y + y, p.z, Math.cos(a) * speed, .5, Math.sin(a) * speed, color, .12, .45, -4, 5);
    }
  }
  dust(p, n = 10, color = '#9fb4d0') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(p.x, p.y + .05, p.z, Math.cos(a) * 2.2, Math.random() * 2.5, Math.sin(a) * 2.2,
        color, .16 + Math.random() * .12, .5 + Math.random() * .4, -3, 4);
    }
  }
}

/* =====================================================
   Blade trail — ribbon between sword tip/base samples
   ===================================================== */
export class BladeTrail {
  constructor(scene, color = '#7fe7ff', width = .16, samples = 14) {
    this.n = samples;
    this.pts = [];
    this.free = [];
    for (let i = 0; i < samples; i++) this.free.push({ base: new THREE.Vector3(), tip: new THREE.Vector3() });
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(samples * 2 * 3);
    const uv = new Float32Array(samples * 2 * 2);
    const idx = [];
    for (let i = 0; i < samples - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < samples; i++) { uv[i * 4] = uv[i * 4 + 2] = i / (samples - 1); }
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
    this.active = false;
    this.fade = 0;
  }
  begin() {
    this.active = true; this.pts.length = 0;
    this.mesh.material.opacity = .95;
  }
  sample(base, tip) {
    if (!this.active) return;
    const p = this.free.pop() || { base: new THREE.Vector3(), tip: new THREE.Vector3() };
    p.base.copy(base); p.tip.copy(tip);
    this.pts.unshift(p);
    if (this.pts.length > this.n) this.free.push(this.pts.pop());
  }
  end(keepFading = true) { this.active = false; if (!keepFading) this.pts.forEach(p => this.free.push(p)), this.pts.length = 0; }
  update(dt) {
    const pos = this.mesh.geometry.attributes.position.array;
    const L = this.pts.length;
    if (!this.active && L === 0) { this.mesh.material.opacity = 0; return; }
    if (!this.active) {
      this.mesh.material.opacity = Math.max(0, this.mesh.material.opacity - dt * 6);
      if (this.mesh.material.opacity === 0) { this.pts.forEach(p => this.free.push(p)); this.pts.length = 0; }
    }
    // widen middle of the ribbon for a tapered streak
    for (let i = 0; i < this.n; i++) {
      const src = this.pts[Math.min(i, L - 1)];
      let b, t2;
      if (src && L > 1) {
        const w = .35 + .65 * Math.sin((i / (this.n - 1)) * Math.PI * .9);
        b = new THREE.Vector3().copy(src.base);
        t2 = new THREE.Vector3().copy(src.tip);
        const mid = b.clone().lerp(t2, .5);
        b.lerp(mid, 1 - w); t2.lerp(mid, 1 - w);
      } else { b = t2 = src ? src.tip : new THREE.Vector3(0, -999, 0); }
      pos[i * 6] = b.x; pos[i * 6 + 1] = b.y; pos[i * 6 + 2] = b.z;
      pos[i * 6 + 3] = t2.x; pos[i * 6 + 4] = t2.y; pos[i * 6 + 5] = t2.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

/* =====================================================
   Shockwave rings (ground pound / parry flare)
   ===================================================== */
export class Rings {
  constructor(scene) {
    this.list = [];
    this.geo = new THREE.RingGeometry(.7, 1, 48);
    this.geo.rotateX(-Math.PI / 2);
  }
  spawn(p, color = '#ffd166', maxR = 4, dur = .5, yOff = .06) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: .9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const m = new THREE.Mesh(this.geo, mat);
    m.position.set(p.x, p.y + yOff, p.z);
    m.scale.setScalar(.2);
    m.renderOrder = 8;
    scene.add(m);
    this.list.push({ m, mat, t: 0, dur, maxR });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.m.parent.remove(r.m); r.mat.dispose();
        this.list.splice(i, 1); continue;
      }
      const s = .2 + k * r.maxR;
      r.m.scale.set(s, 1, s);
      r.mat.opacity = .9 * (1 - k) * (1 - k);
    }
  }
}

/* =====================================================
   After-images (ghost steps during dash) — silhouettes
   ===================================================== */
export class Ghosts {
  constructor(scene) { this.pool = []; this.live = []; this.scene = scene; }
  spawnFrom(objectRoot, tint = '#5ce1ff', life = .3) {
    let node = this.pool.pop();
    if (!node) {
      node = { group: new THREE.Group(), mats: [] };
      this.scene.add(node.group);
    }
    node.group.clear(); node.mats.length = 0;
    objectRoot.updateWorldMatrix(true, true);
    objectRoot.traverse((o) => {
      if (o.isMesh && o.visible) {
        const src = o.material;
        const flat = new THREE.MeshBasicMaterial({
          color: tint, transparent: true, opacity: .5,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(o.geometry, flat);
        m.matrixAutoUpdate = false;
        m.matrix.copy(o.matrixWorld);
        m.matrixWorldNeedsUpdate = true;
        node.group.add(m);
        node.mats.push(flat);
      }
    });
    node.group.visible = true;
    this.live.push({ node, t: 0, life });
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.t += dt;
      const k = 1 - g.t / g.life;
      if (k <= 0) {
        g.node.group.visible = false;
        g.node.mats.forEach(m => m.dispose());
        this.pool.push(g.node);
        this.live.splice(i, 1);
        continue;
      }
      g.node.mats.forEach(m => m.opacity = .5 * k * k);
    }
  }
}

/* =====================================================
   Hit flash sprite (big stylized impact star)
   ===================================================== */
export class Flashes {
  constructor(scene) { this.scene = scene; this.list = []; }
  spawn(p, color = '#fff2b0', size = 1.4, dur = .18) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowSprite(color), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    spr.position.copy(p);
    spr.scale.setScalar(size * .3);
    spr.renderOrder = 11;
    this.scene.add(spr);
    this.list.push({ spr, t: 0, dur, size });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        this.scene.remove(f.spr); f.spr.material.dispose();
        this.list.splice(i, 1); continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      f.spr.scale.setScalar(f.size * (.4 + e * 1.6));
      f.spr.material.opacity = 1 - k;
    }
  }
}

/* =====================================================
   Post-processing pipeline (custom shaders)
   HDR-ish bloom (bright-pass + separable blur) →
   composite: chromatic aberration, filmic tonemap,
   saturation, vignette, grain, red damage pulse,
   white parry-flash overlay.
   ===================================================== */
class FSQuad {
  constructor(material) {
    this.mat = material;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
}
const VS = /*glsl*/`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.params = {
      exposure: 1.06, sat: 1.12, vignette: .38, grain: .05,
      ca: .0028, bloom: 1.0, tint: 0, tintCol: new THREE.Color('#ff2233'),
      whiteFlash: 0, slowmoTint: 0,
    };
    const rtOpts = { type: THREE.HalfFloatType, samples: 4 };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtA = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, samples: 0 });
    this.rtB = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, samples: 0 });
    this.rtC = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, samples: 0 });
    this.rtD = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, samples: 0 });

    this.bright = new FSQuad(new THREE.ShaderMaterial({
      vertexShader: VS,
      uniforms: { tSrc: { value: null }, uThresh: { value: .82 } },
      fragmentShader: /*glsl*/`
        varying vec2 vUv; uniform sampler2D tSrc; uniform float uThresh;
        void main(){
          vec3 c = texture2D(tSrc, vUv).rgb;
          float l = dot(c, vec3(.2126,.7152,.0722));
          float k = smoothstep(uThresh, uThresh + .55, l);
          gl_FragColor = vec4(c * k, 1.);
        }`,
    }));
    this.blur = new FSQuad(new THREE.ShaderMaterial({
      vertexShader: VS,
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uRadius: { value: 1 } },
      fragmentShader: /*glsl*/`
        varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uDir; uniform float uRadius;
        void main(){
          vec3 s = texture2D(tSrc, vUv).rgb * .227;
          s += texture2D(tSrc, vUv + uDir * 1.384 * uRadius).rgb * .31622776;
          s += texture2D(tSrc, vUv - uDir * 1.384 * uRadius).rgb * .31622776;
          s += texture2D(tSrc, vUv + uDir * 3.2307 * uRadius).rgb * .07027022;
          s += texture2D(tSrc, vUv - uDir * 3.2307 * uRadius).rgb * .07027022;
          gl_FragColor = vec4(s, 1.);
        }`,
    }));
    this.comp = new FSQuad(new THREE.ShaderMaterial({
      vertexShader: VS,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uExposure: { value: 1 }, uSat: { value: 1.1 }, uVig: { value: .38 },
        uGrain: { value: .05 }, uCA: { value: .0028 }, uBloom: { value: 1 },
        uTime: { value: 0 }, uTint: { value: 0 }, uTintCol: { value: new THREE.Color(1, 0, 0) },
        uWhite: { value: 0 }, uSlow: { value: 0 },
      },
      fragmentShader: /*glsl*/`
        varying vec2 vUv;
        uniform sampler2D tScene, tBloom;
        uniform float uExposure,uSat,uVig,uGrain,uCA,uBloom,uTime,uTint,uWhite,uSlow;
        uniform vec3 uTintCol;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        vec3 aces(vec3 x){
          return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.);
        }
        void main(){
          vec2 uv = vUv;
          // radial chromatic aberration
          vec2 d = (uv - .5);
          float r2 = dot(d,d);
          vec3 col;
          col.r = texture2D(tScene, uv + d * uCA * (1.+r2*4.)).r;
          col.g = texture2D(tScene, uv).g;
          col.b = texture2D(tScene, uv - d * uCA * (1.+r2*4.)).b;
          // bloom add
          col += texture2D(tBloom, uv).rgb * uBloom;
          // filmic tonemap
          col = aces(col * uExposure);
          // saturation
          float l = dot(col, vec3(.2126,.7152,.0722));
          col = mix(vec3(l), col, uSat);
          // hollow-time cyan duotone when slowed
          col = mix(col, col * vec3(.75,1.05,1.25) + vec3(.02,.05,.09), uSlow * .6);
          // damage tint pulse
          col = mix(col, uTintCol * .9 + col * .35, uTint * (.55 + .45*sin(uTime*30.)));
          // vignette
          float vig = smoothstep(.95, .28, length(d) * (1. + uVig));
          col *= mix(1., vig, uVig * 1.6);
          // film grain
          col += (hash(uv * vec2(1920.,1080.) + uTime * 60.) - .5) * uGrain;
          // parry white flash
          col += vec3(uWhite);
          gl_FragColor = vec4(col, 1.);
        }`,
    }));
  }
  setSize(w, h) {
    const hw = Math.max(2, Math.floor(w / 2)), hh = Math.max(2, Math.floor(h / 2));
    this.rtScene.setSize(w, h);
    this.rtA.setSize(hw, hh); this.rtB.setSize(hw, hh);
    this.rtC.setSize(Math.max(2, hw >> 2), Math.max(2, hh >> 2));
    this.rtD.setSize(Math.max(2, hw >> 2), Math.max(2, hh >> 2));
    this.w = w; this.h = h;
  }
  render(scene, camera, time) {
    const R = this.renderer;
    if (!this.enabled) {
      R.setRenderTarget(null);
      R.render(scene, camera);
      return;
    }
    const p = this.params;
    // 1. scene → HDR target
    R.setRenderTarget(this.rtScene);
    R.clear();
    R.render(scene, camera);
    // 2. bright pass → half res A
    this.bright.mat.uniforms.tSrc.value = this.rtScene.texture;
    R.setRenderTarget(this.rtA); R.render(this.bright.scene, this.bright.camera);
    // 3. blur H/V at half res
    const px = 1 / this.rtA.width, py = 1 / this.rtA.height;
    this.blur.mat.uniforms.tSrc.value = this.rtA.texture;
    this.blur.mat.uniforms.uDir.value.set(px, 0); this.blur.mat.uniforms.uRadius.value = 1;
    R.setRenderTarget(this.rtB); R.render(this.blur.scene, this.blur.camera);
    this.blur.mat.uniforms.tSrc.value = this.rtB.texture;
    this.blur.mat.uniforms.uDir.value.set(0, py);
    R.setRenderTarget(this.rtA); R.render(this.blur.scene, this.blur.camera);
    // 4. wide blur at quarter res then upmix
    this.blur.mat.uniforms.tSrc.value = this.rtA.texture;
    this.blur.mat.uniforms.uDir.value.set(px * 4, 0); this.blur.mat.uniforms.uRadius.value = 2;
    R.setRenderTarget(this.rtC); R.render(this.blur.scene, this.blur.camera);
    this.blur.mat.uniforms.tSrc.value = this.rtC.texture;
    this.blur.mat.uniforms.uDir.value.set(0, py * 4);
    R.setRenderTarget(this.rtD); R.render(this.blur.scene, this.blur.camera);
    // 5. composite to screen
    const u = this.comp.mat.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloom.value = this.rtA.texture;   // additive sampling of both sizes approximated by half-res
    u.uExposure.value = p.exposure; u.uSat.value = p.sat; u.uVig.value = p.vignette;
    u.uGrain.value = p.grain; u.uCA.value = p.ca * (p.tint > 0 ? 2.2 : 1);
    u.uBloom.value = p.bloom; u.uTime.value = time;
    u.uTint.value = p.tint; u.uTintCol.value.copy(p.tintCol);
    u.uWhite.value = p.whiteFlash; u.uSlow.value = p.slowmoTint;
    R.setRenderTarget(null);
    R.render(this.comp.scene, this.comp.camera);
  }
}

/* =====================================================
   Dynamic resolution governor — keeps FPS high on any GPU
   ===================================================== */
export class ResGovernor {
  constructor(renderer, label) {
    this.r = renderer; this.label = label;
    this.scale = Math.min(devicePixelRatio || 1, 2);
    this.max = this.scale; this.min = .55;
    this.fpsAvg = 60; this.acc = 0;
  }
  report(frameDt) {
    const fps = 1 / Math.max(frameDt, 1e-4);
    this.fpsAvg = this.fpsAvg * .95 + fps * .05;
    this.acc += frameDt;
    if (this.acc < 1) return;
    this.acc = 0;
    if (this.fpsAvg < 45 && this.scale > this.min) this.scale = Math.max(this.min, this.scale - .1);
    else if (this.fpsAvg > 58 && this.scale < this.max) this.scale = Math.min(this.max, this.scale + .05);
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.r.setPixelRatio(1);
    this.r.setSize(Math.floor(w * this.scale), Math.floor(h * this.scale), false);
    const c = this.r.domElement;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    if (window.__postfx) window.__postfx.setSize(Math.floor(w * this.scale), Math.floor(h * this.scale));
    if (this.label) this.label.textContent =
      `${Math.floor(w * this.scale)}×${Math.floor(h * this.scale)} @${this.scale.toFixed(2)}x`;
  }
}
