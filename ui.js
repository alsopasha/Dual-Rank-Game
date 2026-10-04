import { N, WIN_EXP } from './engine.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.gridEl = document.getElementById('grid');
    this.tileEl = document.getElementById('tiles');
    this.twoEl = document.getElementById('h-two');
    this.threeEl = document.getElementById('h-three');
    this.movesEl = document.getElementById('moves');
    this.scoreEl = document.getElementById('score');
    this.msg = document.getElementById('game-message');
    this.msgText = this.msg.querySelector('p');
    this.hint = document.getElementById('hint');
    this.arena = document.getElementById('arena');
    this.engineBtn = document.getElementById('btn-engine');
    this.t2Fill = document.getElementById('t2-fill');
    this.t3Fill = document.getElementById('t3-fill');
    this.nudges = [...document.querySelectorAll('.nudge')].sort(
      (a, b) => Number(a.dataset.dir) - Number(b.dataset.dir)
    );
    this.dom = {};
    this.tileEl.innerHTML = '';
    this.buildGrid();
    this.render();
    if (UI._resize) window.removeEventListener('resize', UI._resize);
    UI._resize = () => this.reflow();
    window.addEventListener('resize', UI._resize);
  }

  buildGrid() {
    this.gridEl.innerHTML = '';
    for (let i = 0; i < N * N; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      this.gridEl.appendChild(cell);
    }
  }

  offset() {
    const gap = parseFloat(getComputedStyle(this.gridEl).gap) || 10;
    const cell = this.gridEl.querySelector('.grid-cell');
    return (cell ? cell.offsetWidth : 62) + gap;
  }

  paintTile(el, tile) {
    el.className = `tile t${tile.base} e${tile.exp}${tile.isNew ? ' tile-new' : ''}`;
    el.innerHTML = `<span class="face"><span class="b">${tile.base}</span><span class="e">${tile.exp}</span></span>`;
  }

  place(el, r, c, off) {
    el.style.transform = `translate(${c * off}px, ${r * off}px)`;
  }

  reflow() {
    const off = this.offset();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const tile = this.game.grid[r][c];
        if (!tile || !this.dom[tile.id]) continue;
        this.place(this.dom[tile.id], r, c, off);
      }
    }
  }

  render() {
    const off = this.offset();
    const live = new Set();
    const fading = [];

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const tile = this.game.grid[r][c];
        if (!tile) continue;
        live.add(tile.id);
        if (tile.mergedFrom) {
          for (const m of tile.mergedFrom) live.add(m.id);
          fading.push(...tile.mergedFrom);
        }
        if (!this.dom[tile.id]) {
          const el = document.createElement('div');
          this.paintTile(el, tile);
          this.place(el, r, c, off);
          this.tileEl.appendChild(el);
          this.dom[tile.id] = el;
          if (tile.mergedFrom) el.classList.add('tile-merged');
        } else {
          const el = this.dom[tile.id];
          this.paintTile(el, tile);
          this.place(el, r, c, off);
        }
      }
    }

    for (const child of fading) {
      const el = this.dom[child.id];
      if (!el) continue;
      this.place(el, child.r, child.c, off);
      el.classList.add('tile-gone');
      setTimeout(() => {
        el.remove();
        delete this.dom[child.id];
      }, 140);
    }

    for (const id of Object.keys(this.dom)) {
      if (!live.has(+id)) {
        this.dom[id].remove();
        delete this.dom[id];
      }
    }

    const h = this.game.heights();
    this.twoEl.innerHTML = `<span class="b">2</span><span class="e">${h.two || '—'}</span>`;
    this.threeEl.innerHTML = `<span class="b">3</span><span class="e">${h.three || '—'}</span>`;
    this.movesEl.textContent = this.game.moves;
    this.scoreEl.textContent = this.game.score.toLocaleString();
    this.t2Fill.style.width = `${Math.min(100, (h.two / WIN_EXP) * 100)}%`;
    this.t3Fill.style.width = `${Math.min(100, (h.three / WIN_EXP) * 100)}%`;

    this.msg.className = 'veil';
    if (this.game.won) {
      this.msg.className = 'veil game-won';
      this.msgText.innerHTML = '<span class="b">2</span><span class="e">10</span> <span class="b">3</span><span class="e">10</span>';
    } else if (this.game.over) {
      this.msg.className = 'veil game-over';
      this.msgText.textContent = 'stuck.';
    }
  }

  setEngine(on) {
    this.arena.classList.toggle('engine', on);
    this.hint.textContent = on ? 'engine' : 'arrows · WASD · swipe';
    if (!on) this.showDir(-1);
  }

  setThinking(on) {
    this.engineBtn.classList.toggle('busy', on);
  }

  showDir(dir) {
    for (let i = 0; i < 4; i++) {
      this.nudges[i].classList.toggle('hot', i === dir);
    }
  }
}
