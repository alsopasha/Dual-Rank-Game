import { CELLS, WIN_EXP, move, isTwo, isThree, packTwo, packThree, countEmpty } from './engine.js';

const CPROB = 0.0001;
const CVAR_FRACTION = 0.2;

const NB = new Int8Array(CELLS * 4);
for (let i = 0; i < CELLS; i++) {
  const col = i % 5;
  const row = (i / 5) | 0;
  NB[i * 4] = col < 4 ? i + 1 : -1;
  NB[i * 4 + 1] = col > 0 ? i - 1 : -1;
  NB[i * 4 + 2] = row < 4 ? i + 5 : -1;
  NB[i * 4 + 3] = row > 0 ? i - 5 : -1;
}

const POW2 = new Float64Array(16);
for (let e = 0; e < 16; e++) POW2[e] = 1 << e;

const probabilityBucket = (probability) => {
  if (probability >= 1) return 0;
  return Math.min(255, Math.max(0, (-Math.log2(probability) * 4) | 0));
};

const isDead = (board) => {
  for (let i = 0; i < CELLS; i++) {
    const cell = board[i];
    if (cell === 0) return false;
    const col = i % 5;
    const row = (i / 5) | 0;
    if (col < 4 && board[i + 1] === cell) return false;
    if (row < 4 && board[i + 5] === cell) return false;
  }
  return true;
};

export const holeFloor = (twoM, threeM) => {
  const stage = twoM < threeM ? twoM : threeM;
  if (stage >= 8) return 4;
  if (stage >= 7) return 4;
  if (stage >= 6) return 5;
  if (stage >= 5) return 6;
  if (stage >= 4) return 7;
  if (stage >= 3) return 8;
  return 3;
};

export class Solver {
  constructor(options = 0) {
    const config = typeof options === 'number' ? { riskStrength: options } : options;
    this.nodes = 0;
    this.deadline = 0;
    this.nodeLimit = Infinity;
    this.useDeadline = true;
    this.timedOut = false;
    this.ply = 0;
    this.riskStrength = config.riskStrength || 0;
    this.valueModel = config.valueModel || null;
    this.learnedWeight = config.learnedWeight ?? 1;
    this.learnedOnly = config.learnedOnly || false;
    this.stack = [];
    for (let i = 0; i < 40; i++) this.stack.push(new Uint8Array(CELLS));
    this.holeStack = [];
    this.outcomeStack = [];
    for (let i = 0; i < 40; i++) {
      this.holeStack.push(new Uint8Array(CELLS));
      this.outcomeStack.push(new Float64Array(CELLS * 2));
    }
    this.ttBits = 20;
    this.ttMask = (1 << this.ttBits) - 1;
    this.ttKey = new Int32Array(1 << this.ttBits);
    this.ttDepth = new Int8Array(1 << this.ttBits);
    this.ttScore = new Float64Array(1 << this.ttBits);
    this.root = new Uint8Array(CELLS);
  }

  buf() {
    let b = this.stack[this.ply];
    if (!b) {
      b = new Uint8Array(CELLS);
      this.stack[this.ply] = b;
    }
    this.ply++;
    return b;
  }

  pop() {
    this.ply--;
  }

  expired() {
    if (this.timedOut) return true;
    if (this.nodes >= this.nodeLimit) {
      this.timedOut = true;
      return true;
    }
    if (this.useDeadline && performance.now() > this.deadline) {
      this.timedOut = true;
      return true;
    }
    return false;
  }

  hash(g) {
    let h = 2166136261;
    for (let i = 0; i < CELLS; i++) {
      h = Math.imul(h ^ g[i], 16777619);
    }
    return h;
  }

  evaluate(g) {
    let empty = 0;
    let twoM = 0;
    let threeM = 0;
    let twoI = -1;
    let threeI = -1;
    let twoN = 0;
    let threeN = 0;
    let ones = 0;

    for (let i = 0; i < CELLS; i++) {
      const c = g[i];
      if (c === 0) {
        empty++;
        continue;
      }
      if (c < 16) {
        twoN++;
        if (c === 1) ones++;
        if (c >= twoM) {
          twoM = c;
          twoI = i;
        }
      } else {
        const e = c - 16;
        threeN++;
        if (e === 1) ones++;
        if (e >= threeM) {
          threeM = e;
          threeI = i;
        }
      }
    }

    if (twoM >= WIN_EXP && threeM >= WIN_EXP) return 1e12;

    let holes = 0;
    let ready = 0;
    let cluster = 0;
    let island = 0;
    let extra2 = 0;
    let extra3 = 0;
    let paired = 0;

    for (let i = 0; i < CELLS; i++) {
      const c = g[i];
      const b = i * 4;

      if (c === 0) {
        for (let d = 0; d < 4; d++) {
          const j = NB[b + d];
          if (j < 0) continue;
          const n = g[j];
          if (n === 0) {
            holes += 3;
            continue;
          }
          const ne = n < 16 ? n : n - 16;
          if (ne === 1) holes += 28;
          else if (ne === 2) holes += 10;
          else if (ne >= 4) holes -= 12;
        }
        continue;
      }

      const two = c < 16;
      const e = two ? c : c - 16;
      const maxE = two ? twoM : threeM;
      const maxI = two ? twoI : threeI;

      let same = 0;
      let touchMax = false;
      for (let d = 0; d < 4; d++) {
        const j = NB[b + d];
        if (j < 0) continue;
        const n = g[j];
        if (n === 0) continue;
        if ((n < 16) !== two) continue;
        same++;
        if (j === maxI) touchMax = true;
      }

      const right = NB[b];
      if (right >= 0) {
        const n = g[right];
        if (n !== 0 && (n < 16) === two) {
          const oe = n < 16 ? n : n - 16;
          if (oe === e) ready += 20 + e * e * 2;
          else if (oe === e + 1 || oe === e - 1) cluster += 8 + e;
          else cluster += 3;
        }
      }
      const down = NB[b + 2];
      if (down >= 0) {
        const n = g[down];
        if (n !== 0 && (n < 16) === two) {
          const oe = n < 16 ? n : n - 16;
          if (oe === e) ready += 20 + e * e * 2;
          else if (oe === e + 1 || oe === e - 1) cluster += 8 + e;
          else cluster += 3;
        }
      }

      if (e >= 4 && same === 0) island += e * 20;

      if (e >= 4 && i !== maxI && maxE >= 5) {
        if (two) extra2++;
        else extra3++;
        if (touchMax && e === maxE) paired++;
        else if (!touchMax) island += e * 6;
      }
    }

    const floor = holeFloor(twoM, threeM);
    let space;
    if (empty < floor) {
      const short = floor - empty;
      space = -34000 * short * short;
    } else {
      space = 9000 + (empty - floor) * 3200;
    }

    let crowded = twoN * twoN + threeN * threeN;
    const gap = twoN > threeN ? twoN - threeN : threeN - twoN;
    if (gap > 1) crowded += gap * gap * 16;

    const diff = twoM > threeM ? twoM - threeM : threeM - twoM;
    let balance = 0;
    if (twoM >= 4 && threeM >= 4 && diff >= 2) balance = -50000 * diff * diff;

    let near = 0;
    if (twoM >= 6 && threeM >= 6) {
      const dc = (twoI % 5) - (threeI % 5);
      const dr = ((twoI / 5) | 0) - ((threeI / 5) | 0);
      const dist = (dc < 0 ? -dc : dc) + (dr < 0 ? -dr : dr);
      near = dist <= 2 ? 22000 : -4000 * dist;
    }

    let crest = paired * 55000;
    if (extra2 > 2) crest -= 12000 * (extra2 - 2);
    if (extra3 > 2) crest -= 12000 * (extra3 - 2);

    const grow = POW2[twoM] * 14 + POW2[threeM] * 14
      + (twoM < threeM ? POW2[twoM] * 8 : 0)
      + (threeM < twoM ? POW2[threeM] * 8 : 0);

    const heuristic = (
      space +
      holes * 16 +
      ready * 70 +
      cluster * 18 -
      island * 140 -
      ones * 200 -
      crowded * 12 +
      grow +
      balance +
      near +
      crest
    );
    if (!this.valueModel) return heuristic;
    const learned = this.valueModel.value(g) * this.learnedWeight;
    return this.learnedOnly ? learned : heuristic + learned;
  }

  moveKick(before, after) {
    let bFill = 0;
    let bOnes = 0;
    let aFill = 0;
    let aOnes = 0;
    let twoM = 0;
    let threeM = 0;
    for (let i = 0; i < CELLS; i++) {
      const x = before[i];
      if (x !== 0) {
        bFill++;
        if (x === 1 || x === 17) bOnes++;
      }
      const y = after[i];
      if (y !== 0) {
        aFill++;
        if (y === 1 || y === 17) aOnes++;
        if (y < 16) {
          if (y > twoM) twoM = y;
        } else if (y - 16 > threeM) threeM = y - 16;
      }
    }
    const glued = bOnes - aOnes;
    const merges = bFill - aFill;
    let s = glued * 140000 + (merges * 2 - glued) * 35000;

    const stage = twoM < threeM ? twoM : threeM;
    if (stage >= 3) {
      const empty = CELLS - aFill;
      const floor = holeFloor(twoM, threeM);
      if (empty < floor) s -= 260000 * (floor - empty);
      else s += empty * 9000;
    }
    return s;
  }

  chance(board, depth, cprob) {
    this.nodes++;
    if (
      this.timedOut
      || this.nodes >= this.nodeLimit
      || (this.useDeadline && (this.nodes & 63) === 0 && performance.now() > this.deadline)
    ) {
      this.timedOut = true;
      return this.evaluate(board);
    }
    if (cprob < CPROB || depth <= 0) {
      return isDead(board) ? -1e9 : this.evaluate(board);
    }

    const key = this.hash(board)
      ^ Math.imul(probabilityBucket(cprob) + 1, 0x9e3779b1);
    const slot = key & this.ttMask;
    if (this.ttKey[slot] === key && this.ttDepth[slot] >= depth) {
      return this.ttScore[slot];
    }

    const holes = this.holeStack[this.ply];
    let nEmpty = 0;
    for (let i = 0; i < CELLS; i++) {
      if (board[i] === 0) holes[nEmpty++] = i;
    }

    let result;
    if (nEmpty === 0) {
      result = this.maxNode(board, depth - 1, cprob);
    } else {
      const outcomes = this.outcomeStack[this.ply];
      const pcell = (cprob / nEmpty) * 0.5;
      let total = 0;
      let nOutcomes = 0;
      for (let k = 0; k < nEmpty; k++) {
        const cell = holes[k];
        board[cell] = packTwo(1);
        const twoScore = this.maxNode(board, depth - 1, pcell);
        if (this.timedOut) {
          board[cell] = 0;
          return this.evaluate(board);
        }
        outcomes[nOutcomes++] = twoScore;
        total += twoScore;
        board[cell] = packThree(1);
        const threeScore = this.maxNode(board, depth - 1, pcell);
        if (this.timedOut) {
          board[cell] = 0;
          return this.evaluate(board);
        }
        outcomes[nOutcomes++] = threeScore;
        total += threeScore;
        board[cell] = 0;
      }

      const mean = total / nOutcomes;
      if (this.riskStrength === 0) {
        result = mean;
      } else {
        const tailCount = Math.max(1, Math.ceil(nOutcomes * CVAR_FRACTION));
        let tail = 0;
        for (let i = 0; i < tailCount; i++) {
          let worst = i;
          for (let j = i + 1; j < nOutcomes; j++) {
            if (outcomes[j] < outcomes[worst]) worst = j;
          }
          const score = outcomes[worst];
          outcomes[worst] = outcomes[i];
          outcomes[i] = score;
          tail += score;
        }
        result = mean * (1 - this.riskStrength)
          + (tail / tailCount) * this.riskStrength;
      }
    }

    if (this.timedOut) return this.evaluate(board);
    this.ttKey[slot] = key;
    this.ttDepth[slot] = depth;
    this.ttScore[slot] = result;
    return result;
  }

  maxNode(board, depth, cprob) {
    this.nodes++;
    if (
      this.timedOut
      || this.nodes >= this.nodeLimit
      || (this.useDeadline && (this.nodes & 63) === 0 && performance.now() > this.deadline)
    ) {
      this.timedOut = true;
      return isDead(board) ? -1e9 : this.evaluate(board);
    }
    let best = -Infinity;
    let any = false;
    const next = this.buf();
    for (let dir = 0; dir < 4; dir++) {
      if (move(board, next, dir)) {
        any = true;
        const s = this.chance(next, depth, cprob) + this.moveKick(board, next);
        if (s > best) best = s;
        if (this.timedOut) {
          this.pop();
          return this.evaluate(board);
        }
      }
    }
    this.pop();
    return any ? best : -1e9;
  }

  depthFor(g) {
    const e = countEmpty(g);
    if (e >= 14) return 3;
    if (e >= 10) return 4;
    if (e >= 7) return 5;
    if (e >= 4) return 6;
    return 8;
  }

  thinkMs(g, budget) {
    let twoM = 0;
    let threeM = 0;
    let e = 0;
    for (let i = 0; i < CELLS; i++) {
      const c = g[i];
      if (c === 0) e++;
      else if (c < 16) {
        if (c > twoM) twoM = c;
      } else if (c - 16 > threeM) threeM = c - 16;
    }
    const stage = twoM < threeM ? twoM : threeM;
    if (stage >= 6) return budget + 280;
    if (e <= 3) return budget + 220;
    if (e <= 6) return budget + 100;
    return budget;
  }

  runSearch(cells, target) {
    this.nodes = 0;
    this.ply = 0;
    this.timedOut = false;
    this.root.set(cells);
    const grid = this.root;

    let bestMove = -1;
    let bestEvals = [null, null, null, null];
    let reached = 0;

    for (let depth = 1; depth <= target; depth++) {
      if (this.expired()) break;
      this.timedOut = false;
      const evals = [null, null, null, null];
      let moveDir = -1;
      let bestScore = -Infinity;
      const next = this.buf();

      for (let dir = 0; dir < 4; dir++) {
        if (this.expired()) break;
        if (move(grid, next, dir)) {
          const score = this.chance(next, depth, 1) + this.moveKick(grid, next);
          evals[dir] = score;
          if (score > bestScore) {
            bestScore = score;
            moveDir = dir;
          }
        }
      }
      this.pop();

      if (moveDir !== -1 && (!this.timedOut || reached === 0)) {
        bestMove = moveDir;
        bestEvals = evals;
        if (!this.timedOut) reached = depth;
      }
      if (this.timedOut) break;
    }

    if (bestMove === -1) {
      const next = this.buf();
      for (let dir = 0; dir < 4; dir++) {
        if (move(grid, next, dir)) {
          bestMove = dir;
          break;
        }
      }
      this.pop();
    }

    return { move: bestMove, evals: bestEvals, depth: reached, nodes: this.nodes };
  }

  search(cells, budget = 520) {
    this.useDeadline = true;
    this.nodeLimit = Infinity;
    this.root.set(cells);
    this.deadline = performance.now() + this.thinkMs(this.root, budget);
    return this.runSearch(cells, this.depthFor(this.root));
  }

  searchNodes(cells, nodeBudget = 100000, maxDepth = 12) {
    this.useDeadline = false;
    this.nodeLimit = Math.max(1, nodeBudget | 0);
    this.deadline = Infinity;
    return this.runSearch(cells, maxDepth);
  }

  afterstateValueNodes(cells, nodeBudget = 100000, maxDepth = 5) {
    this.useDeadline = false;
    this.nodeLimit = Math.max(1, nodeBudget | 0);
    this.deadline = Infinity;
    this.nodes = 0;
    this.ply = 0;
    this.timedOut = false;
    this.root.set(cells);
    let value = this.evaluate(this.root);
    let reached = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      this.timedOut = false;
      const candidate = this.chance(this.root, depth, 1);
      if (this.timedOut) break;
      value = candidate;
      reached = depth;
    }
    return {
      value,
      nodes: this.nodes,
      depth: reached,
      complete: reached === maxDepth
    };
  }
}

export const findMove = (cells, budget) => {
  if (!findMove._s) findMove._s = new Solver();
  return findMove._s.search(cells, budget);
};
