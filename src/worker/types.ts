// ─── Shared types between Physics Worker and Main Thread ───
// Zero-dependency, no DOM references

export const MAX_NODES = 500;
export const MAX_EDGES = 1000;
export const STRIDE = 6; // [x, y, z, scale, stateId, alpha]
export const BUFFER_SIZE = MAX_NODES * STRIDE;

// ─── Node Phase States ───
export const STATE_ACTIVE = 0;
export const STATE_EXPLORING = 1;
export const STATE_CONTRADICTING = 2;
export const STATE_PRUNED = 3;
export const STATE_CRYSTALLIZED = 4;
export const STATE_SEED = 5;

// ─── Edge Relationship Types ───
export const EDGE_SPRING = 0;
export const EDGE_CONTRADICTION = 1;
export const EDGE_GRAVITY = 2;
export const EDGE_DERIVES = 3;

// ─── Node descriptor (for insertion messages) ───
export interface NodeDescriptor {
  id: string;
  x: number;
  y: number;
  z: number;
  label: string;
  stateId: number;
}

// ─── Edge descriptor ───
export interface EdgeDescriptor {
  sourceId: string;
  targetId: string;
  type: number;
  restLength?: number;
}

// ─── Worker → Main Thread messages ───
export interface TickMessage {
  type: 'TICK';
  buffer: ArrayBuffer;
  iteration: number;
  entropy: number;
  tensionIndex: number;
  convergence: number;
  nodeCount: number;
}

// ─── Main Thread → Worker messages ───
export interface InitGraphMessage {
  type: 'INIT_GRAPH';
  nodes: NodeDescriptor[];
  edges: EdgeDescriptor[];
  bufferA: ArrayBuffer;
  bufferB: ArrayBuffer;
}

export interface AppendNodesMessage {
  type: 'APPEND_NODES';
  nodes: NodeDescriptor[];
}

export interface AddEdgesMessage {
  type: 'ADD_EDGES';
  edges: EdgeDescriptor[];
}

export interface SetPhaseStateMessage {
  type: 'SET_PHASE_STATE';
  nodeId: string;
  stateId: number;
  targetScale?: number;
  targetAlpha?: number;
}

export interface ReturnBufferMessage {
  type: 'RETURN_BUFFER';
  buffer: ArrayBuffer;
}

export type WorkerInMessage =
  | InitGraphMessage
  | AppendNodesMessage
  | AddEdgesMessage
  | SetPhaseStateMessage
  | ReturnBufferMessage;

export type WorkerOutMessage = TickMessage;

// ─── Scene-side edge data (for rendering) ───
export interface SceneEdge {
  sourceIndex: number;
  targetIndex: number;
  type: number;
  tension: number;
}

// ─── HUD telemetry state ───
export interface TelemetryData {
  iteration: number;
  entropy: number;
  tensionIndex: number;
  convergence: number;
  nodeCount: number;
  edgeCount: number;
}

// ─── Insight data ───
export interface Insight {
  id: string;
  title: string;
  body: string;
  timestamp: number;
}

// ─── Deliberation event types ───
export const DELIB_SEED_PROMPT = 'SEED_PROMPT';
export const DELIB_EXPLORE_BRANCH = 'EXPLORE_BRANCH';
export const DELIB_DETECT_CONTRADICTION = 'DETECT_CONTRADICTION';
export const DELIB_PRUNE_BRANCH = 'PRUNE_BRANCH';
export const DELIB_CRYSTALLIZE_INSIGHT = 'CRYSTALLIZE_INSIGHT';

export interface DeliberationEvent {
  type: string;
  nodeId?: string;
  label?: string;
  parentId?: string;
  targetId?: string;
  insightTitle?: string;
  insightBody?: string;
}
