import {
  CELLS,
  move,
  isTwo,
  isThree
} from './engine.js';
import { Solver } from './ai.js';

const randomFor = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const OFFSETS = [1, -1, 5, -5];

const neighborOf = (i, offset) => {
  const col = i % 5;
  if (offset === 1 && col === 4) return -1;
  if (offset === -1 && col === 0) return -1;
  const j = i + offset;
  return j < 0 || j >= CELLS ? -1 : j;
};

const exponentOf = (cell) => (cell < 16 ? cell : cell - 16);

const heightsOf = (board) => {
  let two = 0;
  let three = 0;
  for (let i = 0; i < CELLS; i++) {
    const cell = board[i];
    if (!cell) continue;
    if (isTwo(cell)) {
      if (cell > two) two = cell;
    } else if (cell - 16 > three) three = cell - 16;
  }
  return { two, three };
};

const matchedOf = ({ two, three }) => (
  two > 0 && three > 0 ? Math.min(two, three) : Math.max(two, three)
);

const familyMass = (board) => {
  let two = 0;
  let three = 0;
  for (let i = 0; i < CELLS; i++) {
    const cell = board[i];
    if (!cell) continue;
    const mass = 1 << ((cell < 16 ? cell : cell - 16) - 1);
    if (cell < 16) two += mass;
    else three += mass;
  }
  return { two, three, min: two < three ? two : three };
};

export const firstEightMode = (board) => {
  if (matchedOf(heightsOf(board)) !== 7) return 'baseline';
  return familyMass(board).min >= 128 ? 'assemble' : 'hold';
};

export class RolloutSolver {
  constructor({
    rollouts = 8,
    horizon = 40,
    lateStage = 8,
    lateRollouts = 48,
    lateHorizon = 140,
    targetExponent = 0,
    readinessWeight = 0,
    towerWeight = 0,
    builderWeight = 0,
    leaderBuilderWeight = 0,
    builderActivationMass = 0,
    builderActivationRank = targetExponent - 1,
    carryWeight = 0,
    carryStart = 4,
    snakeWeight = 0,
    pinWeight = 0,
    orphanWeight = 0,
    holeWeight = 0,
    goalRank = 0,
    hitRank = 0,
    policyWeights = null
  } = {}) {
    this.rollouts = rollouts;
    this.horizon = horizon;
    this.lateStage = lateStage;
    this.lateRollouts = lateRollouts;
    this.lateHorizon = lateHorizon;
    this.targetExponent = targetExponent;
    this.readinessWeight = readinessWeight;
    this.towerWeight = towerWeight;
    this.builderWeight = builderWeight;
    this.leaderBuilderWeight = leaderBuilderWeight;
    this.builderActivationMass = builderActivationMass;
    this.builderActivationRank = builderActivationRank;
    this.carryWeight = carryWeight;
    this.carryStart = carryStart;
    this.snakeWeight = snakeWeight;
    this.pinWeight = pinWeight;
    this.orphanWeight = orphanWeight;
    this.holeWeight = holeWeight;
    this.goalRank = goalRank;
    this.hitRank = hitRank;
    this.policyWeights = policyWeights;
    this.evaluator = new Solver();
    this.sim = new Uint8Array(CELLS);
    this.rootAfter = Array.from({ length: 4 }, () => new Uint8Array(CELLS));
    this.policyAfter = Array.from({ length: 4 }, () => new Uint8Array(CELLS));
    this.empty = new Uint8Array(CELLS);
    this.carryTwo = new Uint16Array(16);
    this.carryThree = new Uint16Array(16);
    this.seen = new Uint8Array(CELLS);
    this.queue = new Int16Array(CELLS);
    this.expAt = new Int8Array(CELLS);
  }

  reachedGoal(board) {
    const { two, three } = heightsOf(board);
    return two >= this.goalRank && three >= this.goalRank;
  }

  hash(board) {
    let hash = 2166136261;
    for (let i = 0; i < CELLS; i++) {
      hash = Math.imul(hash ^ board[i], 16777619);
    }
    return hash;
  }

  spawn(random) {
    let count = 0;
    for (let i = 0; i < CELLS; i++) {
      if (this.sim[i] === 0) this.empty[count++] = i;
    }
    if (count === 0) return false;
    const cell = this.empty[(random() * count) | 0];
    this.sim[cell] = random() < 0.5 ? 1 : 17;
    return true;
  }

  builderScore(board) {
    if (this.builderWeight === 0 && this.leaderBuilderWeight === 0) return 0;
    let two = 0;
    let secondTwo = 0;
    let three = 0;
    let secondThree = 0;
    let massTwo = 0;
    let massThree = 0;
    for (let i = 0; i < CELLS; i++) {
      const cell = board[i];
      if (isTwo(cell)) {
        massTwo += 1 << (cell - 1);
        if (cell >= two) {
          secondTwo = two;
          two = cell;
        } else if (cell > secondTwo) {
          secondTwo = cell;
        }
      } else if (isThree(cell)) {
        const exponent = cell - 16;
        massThree += 1 << (exponent - 1);
        if (exponent >= three) {
          secondThree = three;
          three = exponent;
        } else if (exponent > secondThree) {
          secondThree = exponent;
        }
      }
    }
    if (Math.min(two, three) < this.builderActivationRank) return 0;
    if (Math.min(massTwo, massThree) < this.builderActivationMass) return 0;
    const laggingBuilder = secondTwo < secondThree ? secondTwo : secondThree;
    const leadingBuilder = secondTwo > secondThree ? secondTwo : secondThree;
    const balancedScore = (
      (1 << secondTwo)
      + (1 << secondThree)
      + (1 << laggingBuilder) * 2
    ) * this.builderWeight;
    const leaderScore = (
      (1 << leadingBuilder) * 3
      + (1 << laggingBuilder) * 0.25
    ) * this.leaderBuilderWeight;
    return balancedScore + leaderScore;
  }

  policyAdjustment(board) {
    const weights = this.policyWeights;
    if (!weights) return 0;
    let empty = 0;
    let ones = 0;
    let equalEdges = 0;
    let mixedEdges = 0;
    let sameEdges = 0;
    let two = 0;
    let secondTwo = 0;
    let three = 0;
    let secondThree = 0;
    let highIslands = 0;

    for (let i = 0; i < CELLS; i++) {
      const cell = board[i];
      if (cell === 0) {
        empty++;
        continue;
      }
      const cellTwo = isTwo(cell);
      const exponent = cellTwo ? cell : cell - 16;
      if (exponent === 1) ones++;
      if (cellTwo) {
        if (exponent >= two) {
          secondTwo = two;
          two = exponent;
        } else if (exponent > secondTwo) {
          secondTwo = exponent;
        }
      } else if (exponent >= three) {
        secondThree = three;
        three = exponent;
      } else if (exponent > secondThree) {
        secondThree = exponent;
      }

      const row = (i / 5) | 0;
      const col = i % 5;
      if (col < 4) {
        const other = i + 1;
        const neighbour = board[other];
        if (neighbour) {
          if (neighbour === cell) equalEdges++;
          if (isTwo(neighbour) === cellTwo) sameEdges++;
          else mixedEdges++;
        }
      }
      if (row < 4) {
        const neighbour = board[i + 5];
        if (neighbour) {
          if (neighbour === cell) equalEdges++;
          if (isTwo(neighbour) === cellTwo) sameEdges++;
          else mixedEdges++;
        }
      }

      if (exponent >= 5) {
        let adjacentFamily = false;
        if (col > 0 && board[i - 1] && isTwo(board[i - 1]) === cellTwo) {
          adjacentFamily = true;
        }
        if (col < 4 && board[i + 1] && isTwo(board[i + 1]) === cellTwo) {
          adjacentFamily = true;
        }
        if (row > 0 && board[i - 5] && isTwo(board[i - 5]) === cellTwo) {
          adjacentFamily = true;
        }
        if (row < 4 && board[i + 5] && isTwo(board[i + 5]) === cellTwo) {
          adjacentFamily = true;
        }
        if (!adjacentFamily) highIslands++;
      }
    }

    const second = Math.min(secondTwo, secondThree);
    const gap = Math.abs(two - three);
    const features = [
      (empty - 5) * 5000,
      ones * 3000,
      equalEdges * 8000,
      mixedEdges * 5000,
      sameEdges * 2000,
      (1 << second) * 3000,
      gap * 20000,
      highIslands * 5000
    ];
    let score = 0;
    for (let i = 0; i < features.length; i++) {
      score += (weights[i] || 0) * features[i];
    }
    return score;
  }

  carryFamily(counts, maximum, pairAccess) {
    if (!maximum || counts[maximum] === 0) return 0;
    counts[maximum]--;

    const ladderWeights = [4, 2, 1, 0.5];
    let ladder = 0;
    let slot = 0;
    for (let exponent = 15; exponent >= 1 && slot < 4; exponent--) {
      for (let n = 0; n < counts[exponent] && slot < 4; n++) {
        ladder += (1 << exponent) * ladderWeights[slot++];
      }
    }

    let abstractMerges = 0;
    for (let exponent = 1; exponent < 15; exponent++) {
      const pairs = counts[exponent] >> 1;
      if (!pairs) continue;
      counts[exponent] &= 1;
      counts[exponent + 1] += pairs;
      abstractMerges += pairs;
    }
    let reserveTop = 0;
    for (let exponent = 15; exponent >= 1; exponent--) {
      if (counts[exponent]) {
        reserveTop = exponent;
        break;
      }
    }

    return (
      (1 << reserveTop) * 6000
      + ladder * 400
      + pairAccess * 800
      + abstractMerges * 1200
    );
  }

  carryScore(board) {
    if (this.carryWeight === 0) return 0;
    const twoCounts = this.carryTwo;
    const threeCounts = this.carryThree;
    twoCounts.fill(0);
    threeCounts.fill(0);
    let two = 0;
    let three = 0;
    let twoPairs = 0;
    let threePairs = 0;

    for (let i = 0; i < CELLS; i++) {
      const cell = board[i];
      if (!cell) continue;
      const cellTwo = isTwo(cell);
      const exponent = cellTwo ? cell : cell - 16;
      if (cellTwo) {
        twoCounts[exponent]++;
        if (exponent > two) two = exponent;
      } else {
        threeCounts[exponent]++;
        if (exponent > three) three = exponent;
      }

      for (let j = i + 1; j < CELLS; j++) {
        if (board[j] !== cell) continue;
        const rowA = (i / 5) | 0;
        const colA = i % 5;
        const rowB = (j / 5) | 0;
        const colB = j % 5;
        const distance = Math.abs(rowA - rowB) + Math.abs(colA - colB);
        let access = distance === 1 ? exponent * exponent * 8 : 0;

        if (rowA === rowB || colA === colB) {
          let blockers = 0;
          if (rowA === rowB) {
            for (let col = colA + 1; col < colB; col++) {
              const between = board[rowA * 5 + col];
              if (between && isTwo(between) !== cellTwo) blockers++;
            }
          } else {
            for (let row = rowA + 1; row < rowB; row++) {
              const between = board[row * 5 + colA];
              if (between && isTwo(between) !== cellTwo) blockers++;
            }
          }
          access += exponent * exponent * 4 / (distance + blockers * 3);
        }

        if (cellTwo) twoPairs += access;
        else threePairs += access;
      }
    }

    if (Math.min(two, three) < this.carryStart) return 0;
    const twoScore = this.carryFamily(twoCounts, two, twoPairs);
    const threeScore = this.carryFamily(threeCounts, three, threePairs);
    const weaker = Math.min(twoScore, threeScore);
    const stronger = Math.max(twoScore, threeScore);
    return (weaker * 1.5 + stronger * 0.25) * this.carryWeight;
  }

  snakeFamily(board, two) {
    let maxE = 0;
    let maxI = -1;
    for (let i = 0; i < CELLS; i++) {
      const cell = board[i];
      if (!cell) continue;
      if (isTwo(cell) !== two) continue;
      const exponent = exponentOf(cell);
      if (exponent >= maxE) {
        maxE = exponent;
        maxI = i;
      }
    }
    if (maxI < 0) return 0;
    this.seen.fill(0);
    const queue = this.queue;
    const expAt = this.expAt;
    let head = 0;
    let tail = 0;
    queue[tail++] = maxI;
    this.seen[maxI] = 1;
    expAt[maxI] = maxE;
    let length = 0;
    let ready = 0;
    let mass = 0;
    while (head < tail) {
      const i = queue[head++];
      const e = expAt[i];
      for (let k = 0; k < 4; k++) {
        const j = neighborOf(i, OFFSETS[k]);
        if (j < 0 || this.seen[j]) continue;
        const cell = board[j];
        if (!cell || isTwo(cell) !== two) continue;
        const exponent = exponentOf(cell);
        if (exponent > e) continue;
        this.seen[j] = 1;
        expAt[j] = exponent;
        queue[tail++] = j;
        length++;
        mass += 1 << (exponent - 1);
        if (exponent === e) ready += 3;
        else if (exponent === e - 1) ready += 2;
        else ready += 1;
      }
    }
    let fringe = 0;
    for (let i = 0; i < CELLS; i++) {
      if (!this.seen[i] || board[i] === 0) continue;
      for (let k = 0; k < 4; k++) {
        const j = neighborOf(i, OFFSETS[k]);
        if (j >= 0 && board[j] === 0) fringe++;
      }
    }
    return length * 9000 + ready * 14000 + mass * 50 + fringe * 1800;
  }

  snakeScore(board) {
    if (this.snakeWeight === 0) return 0;
    const two = this.snakeFamily(board, true);
    const three = this.snakeFamily(board, false);
    const weaker = two < three ? two : three;
    const stronger = two > three ? two : three;
    return (weaker * 1.5 + stronger * 0.25) * this.snakeWeight;
  }

  crestMask(board, two) {
    let maxE = 0;
    let mask = 0;
    let count = 0;
    for (let i = 0; i < CELLS; i++) {
      const cell = board[i];
      if (!cell || isTwo(cell) !== two) continue;
      const exponent = exponentOf(cell);
      if (exponent > maxE) {
        maxE = exponent;
        mask = 1 << i;
        count = 1;
      } else if (exponent === maxE) {
        mask |= 1 << i;
        count++;
      }
    }
    return { maxE, mask, count };
  }

  pinCost(before, after) {
    if (this.pinWeight === 0) return 0;
    let cost = 0;
    for (const two of [true, false]) {
      const prior = this.crestMask(before, two);
      if (prior.maxE < 8) continue;
      const next = this.crestMask(after, two);
      if (next.maxE > prior.maxE) continue;
      if (next.maxE < prior.maxE) {
        cost += 420000;
        continue;
      }
      if (next.count < prior.count) continue;
      if (next.mask !== prior.mask) cost += 280000;
    }
    return cost * this.pinWeight;
  }

  orphanCost(board) {
    if (this.orphanWeight === 0) return 0;
    let cost = 0;
    for (const two of [true, false]) {
      const crest = this.crestMask(board, two);
      if (crest.maxE < 8) continue;
      const eights = [];
      const nines = [];
      for (let i = 0; i < CELLS; i++) {
        const cell = board[i];
        if (!cell || isTwo(cell) !== two) continue;
        const exponent = exponentOf(cell);
        if (exponent === 8) eights.push(i);
        if (exponent >= 9) nines.push(i);
      }
      if (crest.maxE === 8 && eights.length >= 2) {
        let adjacent = false;
        for (let a = 0; a < eights.length && !adjacent; a++) {
          for (let b = a + 1; b < eights.length; b++) {
            const d = Math.abs(eights[a] - eights[b]);
            const sameRow = ((eights[a] / 5) | 0) === ((eights[b] / 5) | 0);
            if (d === 5 || (d === 1 && sameRow)) {
              adjacent = true;
              break;
            }
          }
        }
        if (!adjacent) cost += 320000 * (eights.length - 1);
      }
      if (crest.maxE >= 9) {
        for (const eight of eights) {
          let beside = false;
          for (const nine of nines) {
            const d = Math.abs(eight - nine);
            const sameRow = ((eight / 5) | 0) === ((nine / 5) | 0);
            if (d === 5 || (d === 1 && sameRow)) {
              beside = true;
              break;
            }
          }
          if (!beside) cost += 260000;
        }
      }
    }
    return cost * this.orphanWeight;
  }

  holeScore(board) {
    if (this.holeWeight === 0) return 0;
    const { two, three } = heightsOf(board);
    let crest = 0;
    let tail = 0;
    for (let i = 0; i < CELLS; i++) {
      if (board[i] !== 0) continue;
      for (let k = 0; k < 4; k++) {
        const j = neighborOf(i, OFFSETS[k]);
        if (j < 0 || board[j] === 0) continue;
        const exponent = exponentOf(board[j]);
        if (
          (isTwo(board[j]) && exponent === two && two >= 8)
          || (!isTwo(board[j]) && exponent === three && three >= 8)
        ) {
          crest++;
        } else if (exponent <= 3) {
          tail++;
        }
      }
    }
    return (tail * 2200 - crest * 4500) * this.holeWeight;
  }

  earlyNineCost(before, after) {
    if (this.pinWeight === 0 && this.snakeWeight === 0) return 0;
    const prior = heightsOf(before);
    const next = heightsOf(after);
    let cost = 0;
    if (next.two >= 9 && prior.two < 9 && prior.two >= prior.three + 2) cost += 240000;
    if (next.three >= 9 && prior.three < 9 && prior.three >= prior.two + 2) cost += 240000;
    return cost;
  }

  ladderKick(before, after) {
    return this.snakeScore(after)
      + this.holeScore(after)
      - this.pinCost(before, after)
      - this.orphanCost(after)
      - this.earlyNineCost(before, after);
  }

  goalKick(before, after) {
    if (this.goalRank <= 0) return 0;
    const prior = heightsOf(before);
    const next = heightsOf(after);
    let bonus = 0;
    if (next.two >= this.goalRank && prior.two < this.goalRank) bonus += 120000;
    if (next.three >= this.goalRank && prior.three < this.goalRank) bonus += 120000;
    return bonus;
  }

  policyMove() {
    let bestDir = -1;
    let bestValue = -Infinity;
    for (let dir = 0; dir < 4; dir++) {
      const after = this.policyAfter[dir];
      if (!move(this.sim, after, dir)) continue;
      const value = this.evaluator.evaluate(after)
        + this.evaluator.moveKick(this.sim, after)
        + this.builderScore(after)
        + this.policyAdjustment(after)
        + this.carryScore(after)
        + this.ladderKick(this.sim, after)
        + this.goalKick(this.sim, after);
      if (value > bestValue) {
        bestValue = value;
        bestDir = dir;
      }
    }
    if (bestDir >= 0) this.sim.set(this.policyAfter[bestDir]);
    return bestDir;
  }

  terminalScore(steps) {
    let empty = 0;
    let two = 0;
    let three = 0;
    let twoIndex = -1;
    let threeIndex = -1;
    for (let i = 0; i < CELLS; i++) {
      const cell = this.sim[i];
      if (cell === 0) {
        empty++;
      } else if (isTwo(cell)) {
        if (cell > two) {
          two = cell;
          twoIndex = i;
        }
      } else if (isThree(cell) && cell - 16 > three) {
        three = cell - 16;
        threeIndex = i;
      }
    }
    const balanced = two < three ? two : three;
    const towerProgress = this.targetExponent > 0
      ? ((1 << two) + (1 << three)) * this.towerWeight
      : 0;
    let readiness = 0;
    if (this.readinessWeight > 0 && balanced >= this.targetExponent - 1) {
      let twoBehind = 0;
      let threeBehind = 0;
      for (let i = 0; i < CELLS; i++) {
        const cell = this.sim[i];
        if (cell === 0) continue;
        const exponent = cell < 16 ? cell : cell - 16;
        const mass = 1 << (exponent - 1);
        if (cell < 16 && i !== twoIndex) twoBehind += mass * mass;
        if (cell > 16 && i !== threeIndex) threeBehind += mass * mass;
      }
      const lagging = twoBehind < threeBehind ? twoBehind : threeBehind;
      readiness = (
        lagging + (twoBehind + threeBehind) * 0.2
      ) * this.readinessWeight;
    }
    let goal = 0;
    if (this.snakeWeight || this.pinWeight) {
      if (two >= 9 && three >= 9) goal = 1e12;
      else if (two >= 9 || three >= 9) goal = 2.2e11;
      goal += this.snakeScore(this.sim);
    }
    return (
      steps * 250000
      + (1 << balanced) * 18000
      + empty * (this.snakeWeight ? 8000 : 6000)
      + readiness
      + towerProgress
      + goal
      + this.evaluator.evaluate(this.sim) * 0.08
    );
  }

  search(cells) {
    let two = 0;
    let three = 0;
    for (let i = 0; i < CELLS; i++) {
      const cell = cells[i];
      if (isTwo(cell) && cell > two) two = cell;
      if (isThree(cell) && cell - 16 > three) three = cell - 16;
    }
    const late = matchedOf({ two, three }) >= this.lateStage;
    const rollouts = late ? this.lateRollouts : this.rollouts;
    const horizon = late ? this.lateHorizon : this.horizon;
    const evals = [null, null, null, null];
    const baseSeed = this.hash(cells);
    let bestMove = -1;
    let bestScore = -Infinity;
    let nodes = 0;

    for (let dir = 0; dir < 4; dir++) {
      const after = this.rootAfter[dir];
      if (!move(cells, after, dir)) continue;

      let total = 0;
      let dualHits = 0;
      let firstHits = 0;
      const rank = this.hitRank || this.goalRank;
      const markGoal = () => {
        if (rank <= 0) return { first: false, dual: false };
        const { two: ht, three: hh } = heightsOf(this.sim);
        return {
          first: ht >= rank || hh >= rank,
          dual: ht >= rank && hh >= rank
        };
      };
      for (let rollout = 0; rollout < rollouts; rollout++) {
        const random = randomFor(baseSeed ^ Math.imul(rollout + 1, 0x9e3779b1));
        this.sim.set(after);
        let steps = 0;
        let first = false;
        let dual = markGoal().dual;
        first = dual || markGoal().first;
        if (!dual && this.spawn(random)) {
          for (; steps < horizon && !dual; steps++) {
            if (this.policyMove() < 0) break;
            nodes++;
            const seen = markGoal();
            first = first || seen.first;
            dual = seen.dual;
            if (dual || !this.spawn(random)) break;
          }
        }
        if (dual) dualHits++;
        if (first) firstHits++;
        total += this.terminalScore(steps);
      }

      const firstWeight = this.hitRank && !this.goalRank ? 0 : 1e7;
      const score = (rank > 0
        ? (dualHits / rollouts) * 1e12 + (firstHits / rollouts) * firstWeight
        : 0)
        + total / rollouts
        + this.evaluator.moveKick(cells, after)
        + this.ladderKick(cells, after);
      evals[dir] = score;
      if (score > bestScore) {
        bestScore = score;
        bestMove = dir;
      }
    }

    return { move: bestMove, evals, depth: horizon, nodes };
  }
}

export class FirstEightSolver {
  constructor() {
    this.hold = new RolloutSolver({
      rollouts: 96,
      horizon: 250,
      lateStage: 99
    });
    this.assemble = new RolloutSolver({
      rollouts: 96,
      horizon: 250,
      lateStage: 99,
      targetExponent: 8,
      builderWeight: 400,
      builderActivationMass: 128,
      builderActivationRank: 7,
      goalRank: 8
    });
  }

  search(cells) {
    if (firstEightMode(cells) === 'assemble') return this.assemble.search(cells);
    return this.hold.search(cells);
  }
}

export class TieredRolloutSolver {
  constructor({
    early = {
      rollouts: 16,
      horizon: 60,
      lateStage: 5,
      lateRollouts: 96,
      lateHorizon: 250
    },
    middle = { rollouts: 96, horizon: 250 },
    endgame = {
      rollouts: 64,
      horizon: 180,
      targetExponent: 9,
      snakeWeight: 1,
      carryWeight: 1,
      carryStart: 6,
      pinWeight: 1,
      orphanWeight: 1,
      holeWeight: 1
    }
  } = {}) {
    this.early = new RolloutSolver(early);
    this.middle = new RolloutSolver({ ...middle, lateStage: 99 });
    this.endgame = new RolloutSolver({ ...endgame, lateStage: 99 });
  }

  search(cells) {
    let two = 0;
    let three = 0;
    for (let i = 0; i < CELLS; i++) {
      const cell = cells[i];
      if (isTwo(cell) && cell > two) two = cell;
      if (isThree(cell) && cell - 16 > three) three = cell - 16;
    }
    const stage = matchedOf({ two, three });
    if (stage >= 8) return this.endgame.search(cells);
    if (stage >= 7) return this.middle.search(cells);
    return this.early.search(cells);
  }
}

const LADDER = {
  lateStage: 99,
  snakeWeight: 1,
  carryWeight: 1,
  carryStart: 6,
  pinWeight: 1,
  orphanWeight: 1,
  holeWeight: 1
};

export class GoalRaceSolver {
  constructor({
    inner,
    target = 'first9',
    minimumSamples = 12,
    maximumSamples = 28,
    batchSize = 4,
    confidence = 1.4
  }) {
    this.inner = inner;
    this.target = target;
    this.minimumSamples = minimumSamples;
    this.maximumSamples = maximumSamples;
    this.batchSize = batchSize;
    this.confidence = confidence;
    this.rootAfter = Array.from({ length: 4 }, () => new Uint8Array(CELLS));
  }

  hit(board) {
    const { two, three } = heightsOf(board);
    if (this.target === 'double9') return two >= 9 && three >= 9;
    if (this.target === 'double10') return two >= 10 && three >= 10;
    return two >= 9 || three >= 9;
  }

  simulate(after, seed) {
    const solver = this.inner;
    const random = randomFor(seed);
    solver.sim.set(after);
    if (this.hit(solver.sim)) {
      return { success: 1, score: solver.terminalScore(0), nodes: 0 };
    }
    let steps = 0;
    let success = 0;
    if (solver.spawn(random)) {
      for (; steps < solver.horizon; steps++) {
        if (solver.policyMove() < 0) break;
        if (this.hit(solver.sim)) {
          success = 1;
          break;
        }
        if (!solver.spawn(random)) break;
      }
    }
    return {
      success,
      score: solver.terminalScore(steps),
      nodes: steps
    };
  }

  search(cells) {
    const base = this.inner.search(cells);
    if (base.move < 0) return base;
    const ranked = [];
    for (let dir = 0; dir < 4; dir++) {
      if (base.evals[dir] == null) continue;
      ranked.push(dir);
    }
    ranked.sort((a, b) => base.evals[b] - base.evals[a]);
    if (ranked.length < 2) return { ...base, raced: false };
    const lead = ranked[0];
    const chase = ranked[1];
    if (base.evals[lead] - base.evals[chase] > 8e10) return { ...base, raced: false };

    for (const dir of [lead, chase]) move(cells, this.rootAfter[dir], dir);
    const successes = [0, 0];
    const totals = [0, 0];
    let samples = 0;
    let nodes = base.nodes;
    const baseSeed = this.inner.hash(cells) ^ 0x27d4eb2d;

    for (let sample = 0; sample < this.maximumSamples; sample++) {
      const seed = baseSeed ^ Math.imul(sample + 1, 0x9e3779b1);
      for (let candidate = 0; candidate < 2; candidate++) {
        const result = this.simulate(this.rootAfter[candidate === 0 ? lead : chase], seed);
        successes[candidate] += result.success;
        totals[candidate] += result.score;
        nodes += result.nodes;
      }
      samples++;
      if (samples < this.minimumSamples || samples % this.batchSize !== 0) continue;
      const p0 = successes[0] / samples;
      const p1 = successes[1] / samples;
      const variance0 = Math.max(0.25 / samples, p0 * (1 - p0)) / samples;
      const variance1 = Math.max(0.25 / samples, p1 * (1 - p1)) / samples;
      const separation = this.confidence * Math.sqrt(variance0 + variance1);
      if (Math.abs(p0 - p1) > separation) break;
    }

    let winner = lead;
    if (successes[0] || successes[1]) {
      const p0 = successes[0] / samples;
      const p1 = successes[1] / samples;
      if (p0 === p1) winner = totals[0] >= totals[1] ? lead : chase;
      else winner = p0 > p1 ? lead : chase;
    }

    const evals = base.evals.slice();
    evals[lead] = (successes[0] / samples) * 1e12 + totals[0] / samples;
    evals[chase] = (successes[1] / samples) * 1e12 + totals[1] / samples;
    return {
      move: winner,
      evals,
      depth: this.inner.horizon,
      nodes,
      raced: true,
      samples
    };
  }
}

export class MassStageRolloutSolver {
  constructor({ strategic = new TieredRolloutSolver() } = {}) {
    this.strategic = strategic;
    this.climb = new RolloutSolver({
      ...LADDER,
      rollouts: 64,
      horizon: 180,
      targetExponent: 9
    });
    this.pair = new RolloutSolver({
      ...LADDER,
      rollouts: 96,
      horizon: 250,
      targetExponent: 9
    });
    this.finish = new RolloutSolver({
      ...LADDER,
      rollouts: 64,
      horizon: 180,
      targetExponent: 10
    });
    this.firstNine = new GoalRaceSolver({
      inner: this.climb,
      target: 'first9'
    });
    this.secondNine = new GoalRaceSolver({
      inner: this.pair,
      target: 'double9'
    });
  }

  search(cells) {
    const { two, three } = heightsOf(cells);
    const stage = matchedOf({ two, three });
    if (stage < 8) return this.strategic.search(cells);
    if (two === 0 || three === 0) {
      return stage >= 9 ? this.finish.search(cells) : this.firstNine.search(cells);
    }
    if (two >= 9 && three >= 9) return this.finish.search(cells);
    if (two >= 9 || three >= 9) return this.secondNine.search(cells);
    return this.firstNine.search(cells);
  }
}

export class RacingRolloutSolver {
  constructor({
    targetStage = 8,
    minimumSamples = 16,
    maximumSamples = 64,
    batchSize = 8,
    confidence = 1.5
  } = {}) {
    this.targetStage = targetStage;
    this.minimumSamples = minimumSamples;
    this.maximumSamples = maximumSamples;
    this.batchSize = batchSize;
    this.confidence = confidence;
    this.strategic = new TieredRolloutSolver();
    this.short = new RolloutSolver({
      rollouts: 64,
      horizon: 180,
      lateStage: 99
    });
    this.long = new RolloutSolver({
      rollouts: 96,
      horizon: 250,
      lateStage: 99
    });
    this.race = new RolloutSolver({
      rollouts: 1,
      horizon: 250,
      lateStage: 99
    });
    this.rootAfter = Array.from({ length: 4 }, () => new Uint8Array(CELLS));
  }

  stage(board) {
    let two = 0;
    let three = 0;
    for (let i = 0; i < CELLS; i++) {
      const cell = board[i];
      if (isTwo(cell) && cell > two) two = cell;
      if (isThree(cell) && cell - 16 > three) three = cell - 16;
    }
    return Math.min(two, three);
  }

  simulate(after, seed) {
    const random = randomFor(seed);
    this.race.sim.set(after);
    if (this.stage(this.race.sim) >= this.targetStage) {
      return { success: 1, score: this.race.terminalScore(0), nodes: 0 };
    }

    let steps = 0;
    let success = 0;
    if (this.race.spawn(random)) {
      for (; steps < this.race.horizon; steps++) {
        if (this.race.policyMove() < 0) break;
        if (this.stage(this.race.sim) >= this.targetStage) {
          success = 1;
          break;
        }
        if (!this.race.spawn(random)) break;
      }
    }
    return {
      success,
      score: this.race.terminalScore(steps),
      nodes: steps
    };
  }

  search(cells) {
    const stage = this.stage(cells);
    if (stage < 7 || stage >= 8) return this.strategic.search(cells);

    const short = this.short.search(cells);
    const long = this.long.search(cells);
    if (short.move < 0) return long;
    if (short.move === long.move) {
      return { ...long, nodes: short.nodes + long.nodes, raced: false };
    }

    const candidates = [short.move, long.move];
    for (const dir of candidates) move(cells, this.rootAfter[dir], dir);
    const successes = [0, 0];
    const totals = [0, 0];
    let samples = 0;
    let nodes = short.nodes + long.nodes;
    const baseSeed = this.race.hash(cells) ^ 0x85ebca6b;

    for (let sample = 0; sample < this.maximumSamples; sample++) {
      const seed = baseSeed ^ Math.imul(sample + 1, 0x9e3779b1);
      for (let candidate = 0; candidate < candidates.length; candidate++) {
        const result = this.simulate(this.rootAfter[candidates[candidate]], seed);
        successes[candidate] += result.success;
        totals[candidate] += result.score;
        nodes += result.nodes;
      }
      samples++;

      if (samples < this.minimumSamples || samples % this.batchSize !== 0) continue;
      const p0 = successes[0] / samples;
      const p1 = successes[1] / samples;
      const variance0 = Math.max(0.25 / samples, p0 * (1 - p0)) / samples;
      const variance1 = Math.max(0.25 / samples, p1 * (1 - p1)) / samples;
      const separation = this.confidence * Math.sqrt(variance0 + variance1);
      if (Math.abs(p0 - p1) > separation) break;
    }

    let winner;
    if (successes[0] === 0 && successes[1] === 0) {
      winner = candidates[1];
    } else {
      const p0 = successes[0] / samples;
      const p1 = successes[1] / samples;
      if (p0 === p1) {
        winner = totals[0] > totals[1] ? candidates[0] : candidates[1];
      } else {
        winner = p0 > p1 ? candidates[0] : candidates[1];
      }
    }

    const evals = [null, null, null, null];
    for (let candidate = 0; candidate < candidates.length; candidate++) {
      evals[candidates[candidate]] = (
        successes[candidate] / samples
      ) * 1e12 + totals[candidate] / samples;
    }
    return {
      move: winner,
      evals,
      depth: this.race.horizon,
      nodes,
      raced: true,
      samples
    };
  }
}
