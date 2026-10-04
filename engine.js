export const N = 5;
export const CELLS = 25;
export const WIN_EXP = 10;

export const DIRS = [0, 1, 2, 3];

export const packTwo = (exp) => exp;
export const packThree = (exp) => 16 + exp;

export const isTwo = (c) => c > 0 && c < 16;
export const isThree = (c) => c > 16;
export const expOf = (c) => (c === 0 ? 0 : c < 16 ? c : c - 16);
export const baseOf = (c) => (c === 0 ? 0 : c < 16 ? 2 : 3);

export const bump = (c) => {
  if (c === 0 || c === 15 || c === 31) return c;
  return c + 1;
};

export const encodeTile = (base, exp) => (base === 2 ? packTwo(exp) : packThree(exp));

export const emptyBoard = () => new Uint8Array(CELLS);

export const idx = (r, c) => r * N + c;

const takeLine = (g, dir, k, out) => {
  if (dir === 3) {
    for (let i = 0; i < N; i++) out[i] = g[k * N + i];
  } else if (dir === 1) {
    for (let i = 0; i < N; i++) out[i] = g[k * N + (4 - i)];
  } else if (dir === 0) {
    for (let i = 0; i < N; i++) out[i] = g[i * N + k];
  } else {
    for (let i = 0; i < N; i++) out[i] = g[(4 - i) * N + k];
  }
};

const putLine = (g, dir, k, line) => {
  if (dir === 3) {
    for (let i = 0; i < N; i++) g[k * N + i] = line[i];
  } else if (dir === 1) {
    for (let i = 0; i < N; i++) g[k * N + (4 - i)] = line[i];
  } else if (dir === 0) {
    for (let i = 0; i < N; i++) g[i * N + k] = line[i];
  } else {
    for (let i = 0; i < N; i++) g[(4 - i) * N + k] = line[i];
  }
};

const POOL = Array.from({ length: 48 }, () => [
  new Uint8Array(N),
  new Uint8Array(N),
  new Uint8Array(N)
]);
let poolAt = 0;

export const slideLine = (src, dst, compact) => {
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (src[i]) compact[n++] = src[i];
  }
  dst.fill(0);
  let w = 0;
  for (let i = 0; i < n; ) {
    const a = compact[i];
    if (i + 1 < n && compact[i + 1] === a && a !== 15 && a !== 31) {
      dst[w++] = a + 1;
      i += 2;
    } else {
      dst[w++] = a;
      i++;
    }
  }
  for (let i = 0; i < N; i++) {
    if (src[i] !== dst[i]) return true;
  }
  return false;
};

export const move = (src, dst, dir) => {
  const bufs = POOL[poolAt++];
  const lineA = bufs[0];
  const lineB = bufs[1];
  const compact = bufs[2];
  dst.set(src);
  let moved = false;
  for (let k = 0; k < N; k++) {
    takeLine(src, dir, k, lineA);
    if (slideLine(lineA, lineB, compact)) {
      putLine(dst, dir, k, lineB);
      moved = true;
    }
  }
  poolAt--;
  return moved;
};

export const empties = (g, out) => {
  let n = 0;
  for (let i = 0; i < CELLS; i++) {
    if (g[i] === 0) out[n++] = i;
  }
  return n;
};

export const maxExp = (g, two) => {
  let m = 0;
  if (two) {
    for (let i = 0; i < CELLS; i++) {
      if (isTwo(g[i]) && g[i] > m) m = g[i];
    }
    return m;
  }
  for (let i = 0; i < CELLS; i++) {
    if (g[i] > 16 && g[i] - 16 > m) m = g[i] - 16;
  }
  return m;
};

export const hasWin = (g) => maxExp(g, true) >= WIN_EXP && maxExp(g, false) >= WIN_EXP;

export const anyMove = (g, scratch) => {
  for (let d = 0; d < 4; d++) {
    if (move(g, scratch, d)) return true;
  }
  return false;
};

export const mixMass = (g) => {
  let m = 0;
  for (let i = 0; i < CELLS; i++) {
    const row = (i / 5) | 0;
    if (isTwo(g[i]) && row <= 1) m += g[i];
    if (isThree(g[i]) && row >= 3) m += g[i] - 16;
  }
  return m;
};

export const spawnTargets = (g) => {
  const any = [];
  for (let i = 0; i < CELLS; i++) if (g[i] === 0) any.push(i);
  return any;
};

export const countEmpty = (g) => {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (g[i] === 0) n++;
  return n;
};

export const maxAt = (g, two) => {
  let m = 0;
  let p = two ? 20 : 4;
  if (two) {
    for (let i = 0; i < CELLS; i++) {
      if (isTwo(g[i]) && g[i] >= m) {
        m = g[i];
        p = i;
      }
    }
  } else {
    for (let i = 0; i < CELLS; i++) {
      if (isThree(g[i]) && g[i] - 16 >= m) {
        m = g[i] - 16;
        p = i;
      }
    }
  }
  return p;
};
