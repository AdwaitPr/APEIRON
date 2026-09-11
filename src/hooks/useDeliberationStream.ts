// ─── Deliberation Stream Orchestration Hook ───
// Bridges Physics Worker ↔ Scene.ts ↔ DOM HUD.
//
// Architecture:
//   • Simulates SSE stream of reasoning events at 5–8 Hz
//   • Dispatches graph mutations to the Web Worker
//   • Connects worker TICK directly to Scene.updateFromBuffer (bypasses React)
//   • Updates React state only for low-frequency HUD data
//
// Event types:
//   SEED_PROMPT → spawns central question node
//   EXPLORE_BRANCH → spawns premise clusters
//   DETECT_CONTRADICTION → adds high-tension edges
//   PRUNE_BRANCH → tombstones a node (scale→0, alpha→0.1)
//   CRYSTALLIZE_INSIGHT → creates insight node with gravitational pull

import { useEffect, useRef, useState, useCallback } from 'react';
import { Scene } from '../canvas/Scene';
import {
  BUFFER_SIZE,
  STRIDE,
  STATE_SEED,
  STATE_EXPLORING,
  STATE_CONTRADICTING,
  STATE_PRUNED,
  STATE_CRYSTALLIZED,
  EDGE_SPRING,
  EDGE_CONTRADICTION,
  EDGE_GRAVITY,
  EDGE_DERIVES,
  DELIB_SEED_PROMPT,
  DELIB_EXPLORE_BRANCH,
  DELIB_DETECT_CONTRADICTION,
  DELIB_PRUNE_BRANCH,
  DELIB_CRYSTALLIZE_INSIGHT,
  type TelemetryData,
  type Insight,
  type DeliberationEvent,
  type SceneEdge,
} from '../worker/types';

// ─── Mock Deliberation Script ───
const DELIBERATION_SCRIPT: DeliberationEvent[] = [
  {
    type: DELIB_SEED_PROMPT,
    nodeId: 'q0',
    label: 'Can consciousness emerge\nfrom computation?',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p1',
    parentId: 'q0',
    label: 'Integrated Information\nTheory (IIT)',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p2',
    parentId: 'q0',
    label: 'Global Workspace\nTheory',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p3',
    parentId: 'q0',
    label: 'Chinese Room\nArgument',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p4',
    parentId: 'p1',
    label: 'Phi (Φ) as a\nmeasure of consciousness',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p5',
    parentId: 'p2',
    label: 'Attention as\nglobal broadcast',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p6',
    parentId: 'p3',
    label: 'Syntax ≠ Semantics',
  },
  {
    type: DELIB_DETECT_CONTRADICTION,
    nodeId: 'p4',
    targetId: 'p6',
    label: 'IIT requires intrinsic\ncausation vs. functional\nreduction',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p7',
    parentId: 'p1',
    label: 'Panpsychism\nimplications',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p8',
    parentId: 'p5',
    label: 'Recurrent Processing\nTheory',
  },
  {
    type: DELIB_DETECT_CONTRADICTION,
    nodeId: 'p7',
    targetId: 'p3',
    label: 'Ubiquitous experience\nvs. grounding problem',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p9',
    parentId: 'p2',
    label: 'Neural correlates\nof consciousness',
  },
  {
    type: DELIB_PRUNE_BRANCH,
    nodeId: 'p7',
    label: 'Panpsychism: explanatory\ngap remains',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p10',
    parentId: 'p8',
    label: 'Feedback loops as\nproto-awareness',
  },
  {
    type: DELIB_DETECT_CONTRADICTION,
    nodeId: 'p9',
    targetId: 'p6',
    label: 'Correlation ≠ causation\nin NCC studies',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p11',
    parentId: 'p10',
    label: 'Predictive Processing\nFramework',
  },
  {
    type: DELIB_PRUNE_BRANCH,
    nodeId: 'p6',
    label: 'Syntax-semantics gap:\nunderdetermined by\nevidence',
  },
  {
    type: DELIB_CRYSTALLIZE_INSIGHT,
    nodeId: 'insight1',
    parentId: 'q0',
    label: 'Consciousness as\nEmergent Integration',
    insightTitle: 'Emergent Integration Hypothesis',
    insightBody:
      'Consciousness likely emerges from the integration of information across recurrent processing loops, not from any single computational primitive. IIT\'s Φ provides a necessary but insufficient metric.',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p12',
    parentId: 'insight1',
    label: 'Testable predictions\nfor artificial Φ',
  },
  {
    type: DELIB_EXPLORE_BRANCH,
    nodeId: 'p13',
    parentId: 'insight1',
    label: 'Graded consciousness\nspectrum',
  },
  {
    type: DELIB_CRYSTALLIZE_INSIGHT,
    nodeId: 'insight2',
    parentId: 'insight1',
    label: 'Computation as\nNecessary Substrate',
    insightTitle: 'Computational Substrate Thesis',
    insightBody:
      'Computation is a necessary but not sufficient substrate for consciousness. The architecture of recurrence, the capacity for self-modeling, and the integration bandwidth collectively determine the degree of experiential awareness.',
  },
];

// ─── Spatial positioning helpers ───
function randomSpread(base: number, spread: number): number {
  return base + (Math.random() - 0.5) * spread;
}

const nodePositions: Map<string, [number, number, number]> = new Map();

function getParentPosition(parentId: string): [number, number, number] {
  return nodePositions.get(parentId) ?? [0, 0, 0];
}

// ─── Hook ───
export function useDeliberationStream() {
  const workerRef = useRef<Worker | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const eventIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeCountRef = useRef(0);
  const edgesRef = useRef<SceneEdge[]>([]);

  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState('idle');
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    iteration: 0,
    entropy: 0,
    tensionIndex: 0,
    convergence: 0,
    nodeCount: 0,
    edgeCount: 0,
  });
  const [insights, setInsights] = useState<Insight[]>([]);

  // Attach the Scene instance (called imperatively from App)
  const attachScene = useCallback((scene: Scene) => {
    sceneRef.current = scene;
  }, []);

  // ─── Process a single deliberation event ───
  const processEvent = useCallback((event: DeliberationEvent) => {
    const worker = workerRef.current;
    const scene = sceneRef.current;
    if (!worker) return;

    switch (event.type) {
      case DELIB_SEED_PROMPT: {
        setQuestion(event.label?.replace(/\n/g, ' ') ?? '');
        setPhase('seeding');

        const pos: [number, number, number] = [0, 0, 0];
        nodePositions.set(event.nodeId!, pos);

        worker.postMessage({
          type: 'APPEND_NODES',
          nodes: [{
            id: event.nodeId!,
            x: pos[0], y: pos[1], z: pos[2],
            label: event.label!,
            stateId: STATE_SEED,
          }],
        });

        if (scene) {
          scene.addNodeLabel(nodeCountRef.current, event.label!, STATE_SEED);
        }
        nodeCountRef.current++;
        break;
      }

      case DELIB_EXPLORE_BRANCH: {
        setPhase('exploring');
        const parent = getParentPosition(event.parentId!);
        const pos: [number, number, number] = [
          randomSpread(parent[0], 10),
          randomSpread(parent[1], 6),
          randomSpread(parent[2], 10),
        ];
        nodePositions.set(event.nodeId!, pos);

        const nodeIdx = nodeCountRef.current;
        worker.postMessage({
          type: 'APPEND_NODES',
          nodes: [{
            id: event.nodeId!,
            x: pos[0], y: pos[1], z: pos[2],
            label: event.label!,
            stateId: STATE_EXPLORING,
          }],
        });

        // Add spring edge to parent
        worker.postMessage({
          type: 'ADD_EDGES',
          edges: [{
            sourceId: event.parentId!,
            targetId: event.nodeId!,
            type: EDGE_SPRING,
            restLength: 5.0,
          }],
        });

        const parentIdx = [...nodePositions.keys()].indexOf(event.parentId!);
        edgesRef.current = [
          ...edgesRef.current,
          {
            sourceIndex: parentIdx,
            targetIndex: nodeIdx,
            type: EDGE_SPRING,
            tension: 0,
          },
        ];

        if (scene) {
          scene.addNodeLabel(nodeIdx, event.label!, STATE_EXPLORING);
          scene.setEdges(edgesRef.current);
        }
        nodeCountRef.current++;
        break;
      }

      case DELIB_DETECT_CONTRADICTION: {
        setPhase('contradicting');

        // Set both nodes to contradicting state
        worker.postMessage({
          type: 'SET_PHASE_STATE',
          nodeId: event.nodeId!,
          stateId: STATE_CONTRADICTING,
        });
        worker.postMessage({
          type: 'SET_PHASE_STATE',
          nodeId: event.targetId!,
          stateId: STATE_CONTRADICTING,
        });

        // Add contradiction edge
        worker.postMessage({
          type: 'ADD_EDGES',
          edges: [{
            sourceId: event.nodeId!,
            targetId: event.targetId!,
            type: EDGE_CONTRADICTION,
            restLength: 12.0, // Longer rest length for contradictions
          }],
        });

        const sourceIdx = [...nodePositions.keys()].indexOf(event.nodeId!);
        const targetIdx = [...nodePositions.keys()].indexOf(event.targetId!);
        edgesRef.current = [
          ...edgesRef.current,
          {
            sourceIndex: sourceIdx,
            targetIndex: targetIdx,
            type: EDGE_CONTRADICTION,
            tension: 1.0,
          },
        ];

        if (scene) {
          scene.setEdges(edgesRef.current);
        }
        break;
      }

      case DELIB_PRUNE_BRANCH: {
        setPhase('pruning');

        worker.postMessage({
          type: 'SET_PHASE_STATE',
          nodeId: event.nodeId!,
          stateId: STATE_PRUNED,
          targetScale: 0.0,
          targetAlpha: 0.1,
        });
        break;
      }

      case DELIB_CRYSTALLIZE_INSIGHT: {
        setPhase('crystallizing');

        const parent = getParentPosition(event.parentId!);
        const pos: [number, number, number] = [
          randomSpread(parent[0], 3),
          randomSpread(parent[1], 2),
          randomSpread(parent[2], 3),
        ];
        nodePositions.set(event.nodeId!, pos);

        const nodeIdx = nodeCountRef.current;
        worker.postMessage({
          type: 'APPEND_NODES',
          nodes: [{
            id: event.nodeId!,
            x: pos[0], y: pos[1], z: pos[2],
            label: event.label!,
            stateId: STATE_CRYSTALLIZED,
          }],
        });

        // Gravity edge to parent
        worker.postMessage({
          type: 'ADD_EDGES',
          edges: [{
            sourceId: event.parentId!,
            targetId: event.nodeId!,
            type: EDGE_GRAVITY,
            restLength: 3.0,
          }],
        });

        const parentIdx = [...nodePositions.keys()].indexOf(event.parentId!);
        edgesRef.current = [
          ...edgesRef.current,
          {
            sourceIndex: parentIdx,
            targetIndex: nodeIdx,
            type: EDGE_GRAVITY,
            tension: 0,
          },
        ];

        // Set crystallized state (triggers gravitational pull in worker)
        worker.postMessage({
          type: 'SET_PHASE_STATE',
          nodeId: event.nodeId!,
          stateId: STATE_CRYSTALLIZED,
          targetScale: 1.5,
          targetAlpha: 1.0,
        });

        if (scene) {
          scene.addNodeLabel(nodeIdx, event.label!, STATE_CRYSTALLIZED);
          scene.setEdges(edgesRef.current);
        }
        nodeCountRef.current++;

        // Add insight to HUD
        if (event.insightTitle && event.insightBody) {
          setInsights(prev => [
            ...prev,
            {
              id: event.nodeId!,
              title: event.insightTitle!,
              body: event.insightBody!,
              timestamp: Date.now(),
            },
          ]);
        }
        break;
      }
    }
  }, []);

  // ─── Stream events at 5–8 Hz ───
  const scheduleNextEvent = useCallback(() => {
    if (eventIndexRef.current >= DELIBERATION_SCRIPT.length) {
      setPhase('complete');
      return;
    }

    // Random delay between 125ms (8Hz) and 200ms (5Hz)
    const delay = 125 + Math.random() * 75;

    timerRef.current = setTimeout(() => {
      const event = DELIBERATION_SCRIPT[eventIndexRef.current];
      eventIndexRef.current++;
      processEvent(event);
      scheduleNextEvent();
    }, delay);
  }, [processEvent]);

  // ─── Initialize ───
  const start = useCallback(() => {
    // Create worker
    const worker = new Worker(
      new URL('../worker/physics.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    // Pre-allocate double buffers
    const bufferA = new ArrayBuffer(BUFFER_SIZE * 4); // Float32 = 4 bytes
    const bufferB = new ArrayBuffer(BUFFER_SIZE * 4);

    // ─── Worker message handler ───
    // Routes TICK directly to Scene (bypasses React state)
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'TICK') {
        const scene = sceneRef.current;
        if (scene) {
          // Direct pipeline: Worker → Scene (no React reconciliation)
          const buf = new Float32Array(msg.buffer);
          scene.updateFromBuffer(buf, msg.nodeCount);

          // Return the consumed buffer to the worker for reuse
          const consumed = scene.getConsumedBuffer();
          if (consumed) {
            worker.postMessage({ type: 'RETURN_BUFFER', buffer: consumed }, [consumed]);
          }
        }

        // Low-frequency HUD update (throttled to ~10Hz by batching)
        if (msg.iteration % 6 === 0) {
          setTelemetry({
            iteration: msg.iteration,
            entropy: msg.entropy,
            tensionIndex: msg.tensionIndex,
            convergence: msg.convergence,
            nodeCount: msg.nodeCount,
            edgeCount: edgesRef.current.length,
          });
        }
      }
    };

    // Init graph with empty state + both buffers
    worker.postMessage(
      {
        type: 'INIT_GRAPH',
        nodes: [],
        edges: [],
        bufferA,
        bufferB,
      },
      [bufferA, bufferB]
    );

    // Start streaming deliberation events after a brief delay
    setTimeout(() => {
      scheduleNextEvent();
    }, 800);
  }, [scheduleNextEvent]);

  // Cleanup
  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  // Auto-cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    start,
    stop,
    attachScene,
    question,
    phase,
    telemetry,
    insights,
  };
}
