import { Game } from './game.js';
import { UI } from './ui.js';
import { MassStageRolloutSolver } from './rollout.js';

let game;
let ui;
const fallbackSolver = new MassStageRolloutSolver();
let running = false;
let timer = null;
let worker = null;
let wait = false;

const boot = () => {
  try {
    worker = new Worker('./ai.worker.js', { type: 'module' });
    worker.onmessage = (e) => applyEngine(e.data);
  } catch {
    worker = null;
  }

  reset();

  document.getElementById('btn-you').addEventListener('click', () => {
    wait = false;
    ui.setThinking(false);
    setMode(false);
    if (timer) clearTimeout(timer);
  });

  document.getElementById('btn-engine').addEventListener('click', () => {
    setMode(true);
    tick();
  });

  const restart = () => {
    reset();
    if (running) {
      ui.setEngine(true);
      tick();
    }
  };

  document.querySelector('.retry').addEventListener('click', restart);
  document.getElementById('btn-new').addEventListener('click', restart);
  document.addEventListener('keydown', onKey);

  const board = document.querySelector('.board');
  board.addEventListener('touchstart', onTouchStart, { passive: false });
  board.addEventListener('touchend', onTouchEnd, { passive: false });

  for (const nudge of document.querySelectorAll('.nudge')) {
    nudge.addEventListener('click', () => play(Number(nudge.dataset.dir)));
  }
};

const reset = () => {
  if (timer) clearTimeout(timer);
  wait = false;
  game = new Game();
  ui = new UI(game);
  ui.setThinking(false);
  setMode(running);
};

const setMode = (engineOn) => {
  running = engineOn;
  document.getElementById('btn-you').setAttribute('aria-pressed', running ? 'false' : 'true');
  document.getElementById('btn-engine').setAttribute('aria-pressed', running ? 'true' : 'false');
  ui.setEngine(running);
};

const play = (dir) => {
  if (running || game.over || game.won) return;
  if (game.move(dir).moved) ui.render();
};

const onKey = (e) => {
  let dir = -1;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') dir = 0;
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') dir = 1;
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') dir = 2;
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') dir = 3;
  if (dir === -1) return;
  e.preventDefault();
  play(dir);
};

let tx = 0;
let ty = 0;
const onTouchStart = (e) => {
  tx = e.changedTouches[0].screenX;
  ty = e.changedTouches[0].screenY;
};
const onTouchEnd = (e) => {
  const dx = e.changedTouches[0].screenX - tx;
  const dy = e.changedTouches[0].screenY - ty;
  if (Math.abs(dx) < 28 && Math.abs(dy) < 28) return;
  e.preventDefault();
  play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
};

const applyEngine = (result) => {
  wait = false;
  ui.setThinking(false);
  if (!running) return;
  ui.showDir(result.move);
  if (result.move < 0) {
    setMode(false);
    return;
  }
  timer = setTimeout(() => {
    if (game.move(result.move).moved) ui.render();
    timer = setTimeout(tick, 30);
  }, 40);
};

const tick = () => {
  if (!running || game.over || game.won) {
    ui.setThinking(false);
    if (!running) ui.setEngine(false);
    if (game.over || game.won) ui.showDir(-1);
    return;
  }
  if (wait) return;
  wait = true;
  ui.setThinking(true);
  const cells = game.encode();
  if (worker) worker.postMessage({ cells });
  else applyEngine(fallbackSolver.search(cells));
};

document.addEventListener('DOMContentLoaded', boot);
