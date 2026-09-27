/* =====================================================
   input.js — keyboard + mouse (pointer-lock) state machine
   ===================================================== */
export const Input = {
  keys: new Set(),
  pressed: new Set(),        // edge-triggered, cleared each frame by poll()
  mouseDX: 0, mouseDY: 0,
  buttons: new Set(),
  clicked: new Set(),        // LMB/RMB press edges
  wheel: 0,
  locked: false,
  sensitivity: 0.0026,

  init(canvas, { onLockChange, onEscape } = {}) {
    window.addEventListener('keydown', (e) => {
      if (['Space','Tab','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyF','ShiftLeft','ShiftRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Escape' && onEscape) onEscape();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const b = e.button === 2 ? 'right' : e.button === 0 ? 'left' : 'mid';
      if (!this.buttons.has(b)) this.clicked.add(b);
      this.buttons.add(b);
    });
    window.addEventListener('mouseup', (e) => {
      const b = e.button === 2 ? 'right' : e.button === 0 ? 'left' : 'mid';
      this.buttons.delete(b);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (onLockChange) onLockChange(this.locked);
    });
  },
  lock(canvas) { canvas.requestPointerLock?.(); },
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); },

  down(code) { return this.keys.has(code); },
  hit(code) { return this.pressed.has(code); },
  click(btn) { return this.clicked.has(btn); },

  /** consume one-frame edges; call at END of update */
  poll() {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheel = 0;
  },
  moveAxis() {
    const x = (this.down('KeyD') ? 1 : 0) - (this.down('KeyA') ? 1 : 0);
    const z = (this.down('KeyS') ? 1 : 0) - (this.down('KeyW') ? 1 : 0);
    return [x, z];
  },
};
