import { MassStageRolloutSolver } from './rollout.js';

const solver = new MassStageRolloutSolver();

onmessage = (e) => {
  const { cells } = e.data;
  const board = new Uint8Array(cells);
  postMessage(solver.search(board));
};
