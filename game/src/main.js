/* =====================================================
   main.js — boot: construct game, wire menus & loop
   ===================================================== */
import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './input.js';

const canvas = document.getElementById('gl');
const $ = (id) => document.getElementById(id);

const game = new Game(canvas);
game.clock = new THREE.Clock();

/* ---------- pause management ---------- */
let paused = false;
function pause(on) {
  if (!game.started || game.phase === 'defeat' || game.phase === 'victory') return;
  if (paused === on) return;
  paused = on;
  game.paused = on;
  $('pause').classList.toggle('hidden', !on);
  if (on) Input.unlock();
}

/* ---------- input wiring ---------- */
Input.init(canvas, {
  onLockChange: (locked) => {
    // releasing the mouse mid-game pauses (unless an overlay is up)
    if (!locked && game.started) pause(true);
  },
});

/* resume by clicking the canvas while paused */
canvas.addEventListener('click', () => {
  if (game.started && paused && !Input.locked) {
    pause(false);
    Input.lock(canvas);
  }
});

/* ---------- menu / overlays ---------- */
function readOpts() {
  return {
    bloom: $('opt-bloom').checked,
    shadow: $('opt-shadow').checked,
    fog: $('opt-fog').checked,
    sound: $('opt-sound').checked,
  };
}
$('btn-start').addEventListener('click', () => {
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  game.start(readOpts());
  Input.lock(canvas);
  game.toast('SECTOR 04 — SURVEY THE HOLLOW', 'gold', 2000);
});

$('btn-resume').addEventListener('click', () => {
  pause(false);
  Input.lock(canvas);
});
$('btn-quit').addEventListener('click', () => location.reload());
$('btn-quit2').addEventListener('click', () => location.reload());
$('btn-quit3').addEventListener('click', () => location.reload());
$('btn-retry').addEventListener('click', () => {
  $('defeat').classList.add('hidden');
  paused = false; game.paused = false;
  game.reset();
  game.player.respawn();
  game.setWave(0);
  Input.lock(canvas);
});
$('btn-again').addEventListener('click', () => {
  $('victory').classList.add('hidden');
  game.phase = 'explore';
  Input.lock(canvas);
});

/* Escape toggles pause while playing */
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.started) pause(!paused);
});

/* ---------- run the loop ---------- */
(function tick() {
  requestAnimationFrame(tick);
  game.loop();
})();
