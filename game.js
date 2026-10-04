import { N, WIN_EXP, packTwo, packThree, anyMove, spawnTargets } from './engine.js';

export class Game {
  constructor(random = Math.random, options = {}) {
    this.size = N;
    this.random = random;
    this.oneFamily = !!options.oneFamily;
    this.grid = Array.from({ length: N }, () => Array(N).fill(null));
    this.score = 0;
    this.won = false;
    this.over = false;
    this.tileId = 1;
    this.moves = 0;
    this.scratch = new Uint8Array(25);
    this.place(true);
    this.place(this.oneFamily);
  }

  encode() {
    const g = new Uint8Array(25);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = this.grid[r][c];
        if (t) g[r * N + c] = t.base === 2 ? packTwo(t.exp) : packThree(t.exp);
      }
    }
    return g;
  }

  cells() {
    const cells = [];
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!this.grid[r][c]) cells.push({ r, c });
      }
    }
    return cells;
  }

  place(two) {
    const spots = spawnTargets(this.encode());
    if (!spots.length) return;
    const i = spots[(this.random() * spots.length) | 0];
    const r = (i / N) | 0;
    const c = i % N;
    this.grid[r][c] = {
      id: this.tileId++,
      base: two ? 2 : 3,
      exp: 1,
      r,
      c,
      isNew: true,
      mergedFrom: null
    };
  }

  clearFlags() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = this.grid[r][c];
        if (t) {
          t.isNew = false;
          t.mergedFrom = null;
        }
      }
    }
  }

  farthest(r, c, dr, dc) {
    let nr = r;
    let nc = c;
    while (
      nr + dr >= 0 && nr + dr < N &&
      nc + dc >= 0 && nc + dc < N &&
      this.grid[nr + dr][nc + dc] === null
    ) {
      nr += dr;
      nc += dc;
    }
    return { r: nr, c: nc };
  }

  move(dir) {
    if (this.over || this.won) return { moved: false };

    this.clearFlags();
    const vec = [
      { dr: -1, dc: 0 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 }
    ][dir];

    const rows = vec.dr === 1 ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
    const cols = vec.dc === 1 ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
    const merged = Array.from({ length: N }, () => Array(N).fill(0));
    let moved = false;
    let gained = 0;

    for (const r of rows) {
      for (const c of cols) {
        const tile = this.grid[r][c];
        if (!tile) continue;
        const far = this.farthest(r, c, vec.dr, vec.dc);
        const nr = far.r + vec.dr;
        const nc = far.c + vec.dc;
        const hit = nr >= 0 && nr < N && nc >= 0 && nc < N ? this.grid[nr][nc] : null;

        if (
          hit &&
          hit.base === tile.base &&
          hit.exp === tile.exp &&
          !merged[nr][nc]
        ) {
          const exp = tile.exp + 1;
          this.grid[nr][nc] = {
            id: this.tileId++,
            base: tile.base,
            exp,
            r: nr,
            c: nc,
            isNew: false,
            mergedFrom: [hit, { ...tile, r: nr, c: nc }]
          };
          this.grid[r][c] = null;
          merged[nr][nc] = 1;
          gained += exp * (tile.base === 2 ? 2 : 3);
          moved = true;
        } else if (far.r !== r || far.c !== c) {
          this.grid[far.r][far.c] = tile;
          tile.r = far.r;
          tile.c = far.c;
          this.grid[r][c] = null;
          moved = true;
        }
      }
    }

    if (!moved) return { moved: false };

    this.score += gained;
    this.moves++;
    this.place(this.oneFamily ? true : this.random() < 0.5);

    const h = this.heights();
    const won = this.oneFamily
      ? h.two >= WIN_EXP
      : h.two >= WIN_EXP && h.three >= WIN_EXP;
    if (won) {
      this.won = true;
    } else if (!this.cells().length && !anyMove(this.encode(), this.scratch)) {
      this.over = true;
    }

    return { moved: true };
  }

  heights() {
    let two = 0;
    let three = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const t = this.grid[r][c];
        if (!t) continue;
        if (t.base === 2 && t.exp > two) two = t.exp;
        if (t.base === 3 && t.exp > three) three = t.exp;
      }
    }
    return { two, three };
  }
}
