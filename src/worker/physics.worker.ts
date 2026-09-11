// ─── Physics Simulation Web Worker ───
// Pure TypeScript, zero DOM references, zero external dependencies.
// Implements:
//   • Hooke spring attraction with critical damping
//   • Coulomb repulsion via Barnes-Hut 3D Octree (θ = 0.6)
//   • Oscillatory tension force on contradiction edges
//   • Soft centering gravitational sink
//   • Double-buffered Float32Array ping-pong (zero-copy transferable)

import { Octree } from './octree';
import {
  MAX_NODES,
  STRIDE,
  BUFFER_SIZE,
  EDGE_CONTRADICTION,
  EDGE_GRAVITY,
  STATE_PRUNED,
  STATE_CRYSTALLIZED,
  type NodeDescriptor,
  type EdgeDescriptor,
  type WorkerInMessage,
} from './types';

// ─── Physics Constants ───
const TICK_MS = 16; // ~60 Hz
const THETA = 0.6; // Barnes-Hut opening angle
const KS = 0.04; // Spring stiffness
const KR = 80.0; // Coulomb repulsion strength
const KG = 0.002; // Centering gravitational pull
const DAMPING = 0.85; // Velocity damping per tick
const TENSION_AMP = 0.35; // Oscillatory tension amplitude
const TENSION_OMEGA = 6.0; // Tension angular frequency
const DT = 1.0; // Timestep (unit)
const MAX_VELOCITY = 3.0; // Velocity clamp
const REST_LENGTH_DEFAULT = 5.0;
const SCALE_LERP = 0.08; // Smooth interpolation for scale changes
const ALPHA_LERP = 0.08; // Smooth interpolation for alpha changes

// ─── Internal State (SoA layout for cache performance) ───
const px = new Float64Array(MAX_NODES);
const py = new Float64Array(MAX_NODES);
const pz = new Float64Array(MAX_NODES);
const vx = new Float64Array(MAX_NODES);
const vy = new Float64Array(MAX_NODES);
const vz = new Float64Array(MAX_NODES);
const mass = new Float64Array(MAX_NODES);
const scale = new Float64Array(MAX_NODES);
const targetScale = new Float64Array(MAX_NODES);
const stateId = new Float64Array(MAX_NODES);
const alpha = new Float64Array(MAX_NODES);
const targetAlpha = new Float64Array(MAX_NODES);
const fx = new Float64Array(MAX_NODES);
const fy = new Float64Array(MAX_NODES);
const fz = new Float64Array(MAX_NODES);

let nodeCount = 0;
const nodeIdToIndex = new Map<string, number>();
const nodeLabelById = new Map<string, string>();

// ─── Edge Storage ───
interface InternalEdge {
  a: number; // source index
  b: number; // target index
  type: number;
  restLength: number;
}
const edges: InternalEdge[] = [];

// ─── Double-Buffered Ping-Pong ───
let writeBuffer: Float32Array | null = null;
let pendingReturnBuffer: Float32Array | null = null;

// ─── Octree ───
const octree = new Octree();
const forceOut = new Float64Array(3);

// ─── Simulation State ───
let iteration = 0;
let running = false;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let simTime = 0;

// ─── Crystallize target position (pulled toward a focal point) ───
let crystallizeTargetX = 0;
let crystallizeTargetY = 0;
let crystallizeTargetZ = 0;

// ══════════════════════════════════════════════════════════════
// Node Management
// ══════════════════════════════════════════════════════════════

function addNode(desc: NodeDescriptor): number {
  if (nodeCount >= MAX_NODES) {
    console.warn('[PhysicsWorker] MAX_NODES reached, cannot add more.');
    return -1;
  }
  const i = nodeCount++;
  nodeIdToIndex.set(desc.id, i);
  nodeLabelById.set(desc.id, desc.label);

  px[i] = desc.x;
  py[i] = desc.y;
  pz[i] = desc.z;
  vx[i] = 0;
  vy[i] = 0;
  vz[i] = 0;
  mass[i] = 1.0;
  scale[i] = 0.0; // Start at zero, animate in
  targetScale[i] = 1.0;
  stateId[i] = desc.stateId;
  alpha[i] = 0.0; // Start transparent, fade in
  targetAlpha[i] = 1.0;

  return i;
}

function addEdge(desc: EdgeDescriptor): void {
  const a = nodeIdToIndex.get(desc.sourceId);
  const b = nodeIdToIndex.get(desc.targetId);
  if (a === undefined || b === undefined) {
    console.warn('[PhysicsWorker] Edge references unknown node:', desc.sourceId, desc.targetId);
    return;
  }
  edges.push({
    a,
    b,
    type: desc.type,
    restLength: desc.restLength ?? REST_LENGTH_DEFAULT,
  });
}

// ══════════════════════════════════════════════════════════════
// Force Computation
// ══════════════════════════════════════════════════════════════

function clearForces(): void {
  for (let i = 0; i < nodeCount; i++) {
    fx[i] = 0;
    fy[i] = 0;
    fz[i] = 0;
  }
}

function applySpringForces(): void {
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e];
    const a = edge.a;
    const b = edge.b;

    // Skip tombstoned nodes
    if (mass[a] < 0.001 || mass[b] < 0.001) continue;

    const dx = px[b] - px[a];
    const dy = py[b] - py[a];
    const dz = pz[b] - pz[a];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.001) continue;

    const invDist = 1.0 / dist;

    // Hooke: F = -ks * (d - L0)
    const displacement = dist - edge.restLength;
    const springMag = KS * displacement;

    // Normalized direction from a → b
    const nx = dx * invDist;
    const ny = dy * invDist;
    const nz = dz * invDist;

    // Damping along the spring axis
    const dvx = vx[b] - vx[a];
    const dvy = vy[b] - vy[a];
    const dvz = vz[b] - vz[a];
    const relVelAlongSpring = dvx * nx + dvy * ny + dvz * nz;
    const dampingForce = 0.1 * relVelAlongSpring;

    const totalForce = springMag + dampingForce;

    fx[a] += totalForce * nx;
    fy[a] += totalForce * ny;
    fz[a] += totalForce * nz;
    fx[b] -= totalForce * nx;
    fy[b] -= totalForce * ny;
    fz[b] -= totalForce * nz;
  }
}

function applyCoulombRepulsion(): void {
  // Build octree from current positions
  octree.build(px, py, pz, mass, nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    if (mass[i] < 0.001) continue; // Skip tombstoned

    octree.computeForce(i, px[i], py[i], pz[i], THETA, KR, forceOut);
    fx[i] += forceOut[0];
    fy[i] += forceOut[1];
    fz[i] += forceOut[2];
  }
}

function applyTensionForces(): void {
  for (let e = 0; e < edges.length; e++) {
    const edge = edges[e];
    if (edge.type !== EDGE_CONTRADICTION) continue;

    const a = edge.a;
    const b = edge.b;
    if (mass[a] < 0.001 || mass[b] < 0.001) continue;

    const dx = px[b] - px[a];
    const dy = py[b] - py[a];
    const dz = pz[b] - pz[a];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.001) continue;

    const invDist = 1.0 / dist;

    // Oscillatory tension: F = A · sin(ωt) · û
    const tensionMag = TENSION_AMP * Math.sin(TENSION_OMEGA * simTime);

    const nx = dx * invDist;
    const ny = dy * invDist;
    const nz = dz * invDist;

    // Apply in opposite directions to push/pull
    fx[a] += tensionMag * nx;
    fy[a] += tensionMag * ny;
    fz[a] += tensionMag * nz;
    fx[b] -= tensionMag * nx;
    fy[b] -= tensionMag * ny;
    fz[b] -= tensionMag * nz;
  }
}

function applyCenteringSink(): void {
  for (let i = 0; i < nodeCount; i++) {
    if (mass[i] < 0.001) continue;

    // Soft pull toward origin: F = -kg · p
    fx[i] -= KG * px[i];
    fy[i] -= KG * py[i];
    fz[i] -= KG * pz[i];
  }
}

function applyGravitationalPull(): void {
  // Crystallize gravity: pull crystallized nodes toward the crystallize target
  for (let i = 0; i < nodeCount; i++) {
    if (stateId[i] !== STATE_CRYSTALLIZED) continue;

    const dx = crystallizeTargetX - px[i];
    const dy = crystallizeTargetY - py[i];
    const dz = crystallizeTargetZ - pz[i];

    // Stronger pull for crystallized nodes
    fx[i] += 0.02 * dx;
    fy[i] += 0.02 * dy;
    fz[i] += 0.02 * dz;
  }
}

// ══════════════════════════════════════════════════════════════
// Integration
// ══════════════════════════════════════════════════════════════

function integrate(): void {
  for (let i = 0; i < nodeCount; i++) {
    if (mass[i] < 0.001) continue; // Tombstoned

    // Euler integration
    vx[i] = (vx[i] + fx[i] * DT) * DAMPING;
    vy[i] = (vy[i] + fy[i] * DT) * DAMPING;
    vz[i] = (vz[i] + fz[i] * DT) * DAMPING;

    // Velocity clamp
    const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    if (speed > MAX_VELOCITY) {
      const s = MAX_VELOCITY / speed;
      vx[i] *= s;
      vy[i] *= s;
      vz[i] *= s;
    }

    px[i] += vx[i] * DT;
    py[i] += vy[i] * DT;
    pz[i] += vz[i] * DT;

    // Smooth interpolation of scale and alpha toward targets
    scale[i] += (targetScale[i] - scale[i]) * SCALE_LERP;
    alpha[i] += (targetAlpha[i] - alpha[i]) * ALPHA_LERP;
  }
}

// ══════════════════════════════════════════════════════════════
// Telemetry Computation
// ══════════════════════════════════════════════════════════════

function computeEntropy(): number {
  // Kinetic entropy: average kinetic energy per node
  if (nodeCount === 0) return 0;
  let totalKE = 0;
  for (let i = 0; i < nodeCount; i++) {
    totalKE += vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i];
  }
  return totalKE / nodeCount;
}

function computeTensionIndex(): number {
  // Sum of tension-magnitude on contradiction edges
  let tension = 0;
  for (let e = 0; e < edges.length; e++) {
    if (edges[e].type === EDGE_CONTRADICTION) {
      const a = edges[e].a;
      const b = edges[e].b;
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const dz = pz[b] - pz[a];
      tension += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }
  return tension;
}

function computeConvergence(): number {
  // Fraction of nodes that have near-zero velocity (converged)
  if (nodeCount === 0) return 100;
  let converged = 0;
  for (let i = 0; i < nodeCount; i++) {
    const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]);
    if (speed < 0.05) converged++;
  }
  return (converged / nodeCount) * 100;
}

// ══════════════════════════════════════════════════════════════
// Buffer Output
// ══════════════════════════════════════════════════════════════

function writeToBuffer(buf: Float32Array): void {
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * STRIDE;
    buf[offset]     = px[i];
    buf[offset + 1] = py[i];
    buf[offset + 2] = pz[i];
    buf[offset + 3] = scale[i];
    buf[offset + 4] = stateId[i];
    buf[offset + 5] = alpha[i];
  }
}

// ══════════════════════════════════════════════════════════════
// Simulation Tick
// ══════════════════════════════════════════════════════════════

function tick(): void {
  if (!running) return;

  // If no write buffer is available, the main thread hasn't returned one yet.
  // Try the pending return buffer.
  if (!writeBuffer && pendingReturnBuffer) {
    writeBuffer = pendingReturnBuffer;
    pendingReturnBuffer = null;
  }

  if (!writeBuffer) {
    // Still no buffer — skip this tick
    tickTimer = setTimeout(tick, TICK_MS);
    return;
  }

  // ─── Simulate ───
  clearForces();
  applySpringForces();
  applyCoulombRepulsion();
  applyTensionForces();
  applyCenteringSink();
  applyGravitationalPull();
  integrate();

  iteration++;
  simTime += DT * 0.016; // Convert to pseudo-seconds

  // ─── Write results to buffer ───
  writeToBuffer(writeBuffer);

  // ─── Transfer buffer to main thread (zero-copy) ───
  const ab = writeBuffer.buffer;
  const msg = {
    type: 'TICK' as const,
    buffer: ab,
    iteration,
    entropy: computeEntropy(),
    tensionIndex: computeTensionIndex(),
    convergence: computeConvergence(),
    nodeCount,
  };

  writeBuffer = null; // Detached after transfer
  (self as unknown as Worker).postMessage(msg, [ab]);

  // ─── Schedule next tick ───
  tickTimer = setTimeout(tick, TICK_MS);
}

// ══════════════════════════════════════════════════════════════
// Message Handler
// ══════════════════════════════════════════════════════════════

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'INIT_GRAPH': {
      // Reset state
      nodeCount = 0;
      edges.length = 0;
      nodeIdToIndex.clear();
      nodeLabelById.clear();
      iteration = 0;
      simTime = 0;

      // Accept both pre-allocated buffers for double-buffering
      writeBuffer = new Float32Array(msg.bufferA);
      pendingReturnBuffer = new Float32Array(msg.bufferB);

      // Add initial nodes
      for (const n of msg.nodes) {
        addNode(n);
      }

      // Add initial edges
      for (const e of msg.edges) {
        addEdge(e);
      }

      // Start the simulation loop
      running = true;
      if (tickTimer !== null) clearTimeout(tickTimer);
      tick();
      break;
    }

    case 'APPEND_NODES': {
      for (const n of msg.nodes) {
        addNode(n);
      }
      break;
    }

    case 'ADD_EDGES': {
      for (const e of msg.edges) {
        addEdge(e);
      }
      break;
    }

    case 'SET_PHASE_STATE': {
      const idx = nodeIdToIndex.get(msg.nodeId);
      if (idx === undefined) {
        console.warn('[PhysicsWorker] SET_PHASE_STATE: unknown node', msg.nodeId);
        break;
      }

      stateId[idx] = msg.stateId;

      if (msg.targetScale !== undefined) {
        targetScale[idx] = msg.targetScale;
      }
      if (msg.targetAlpha !== undefined) {
        targetAlpha[idx] = msg.targetAlpha;
      }

      // Tombstone pruned nodes
      if (msg.stateId === STATE_PRUNED) {
        targetScale[idx] = msg.targetScale ?? 0.0;
        targetAlpha[idx] = msg.targetAlpha ?? 0.1;
        mass[idx] = 0.001; // Near-zero mass, still exists but negligible
      }

      // Crystallized nodes get gravitational pull
      if (msg.stateId === STATE_CRYSTALLIZED) {
        targetScale[idx] = msg.targetScale ?? 1.5;
        targetAlpha[idx] = msg.targetAlpha ?? 1.0;
        // Set crystallize target to this node's position (other crystallized nodes will be pulled here)
        crystallizeTargetX = px[idx];
        crystallizeTargetY = py[idx];
        crystallizeTargetZ = pz[idx];
      }
      break;
    }

    case 'RETURN_BUFFER': {
      // Main thread returning a consumed buffer for reuse
      const returned = new Float32Array(msg.buffer);
      if (!writeBuffer) {
        writeBuffer = returned;
      } else {
        pendingReturnBuffer = returned;
      }
      break;
    }
  }
};
