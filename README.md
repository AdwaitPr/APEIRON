# APEIRON

> *Anaximander held that all things emerge from the boundless — ἄπειρον — and return to it when they are destroyed.*
>
> **APEIRON makes that premise executable.**

---

A real-time physics simulation of AI deliberation — premises emerge from void, repel under Coulomb forces, vibrate across contradiction edges, and crystallize into insight as a 3D force-directed knowledge graph.

---

## What It Is

APEIRON is a spatial knowledge graph where artificial reasoning unfolds as Newtonian physics. Each idea is a node with **mass**, **position**, and **velocity**. Premises attract one another through Hooke spring forces. Opposing arguments repel each other via **Coulomb's law**, partitioned by a **Barnes-Hut Octree** running entirely inside a Web Worker at 60 Hz. Contradictions don't just exist — they *oscillate*, vibrating with a sinusoidal tension force along every edge that connects irreconcilable claims.

Pruned branches don't die; they **tombstone** — fading in mass and opacity but persisting in space. When enough contradictions resolve, surviving nodes are pulled by gravitational attraction toward a **crystallized insight**: a truth the simulation arrived at under force.

The canvas never stops. The physics never sleeps. The question asked is always the same:

> *Can consciousness emerge from computation?*

APEIRON answers by becoming the thing it asks about.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     React App Shell                          │
│  ┌──────────────────────┐   ┌──────────────────────────┐    │
│  │   DOM HUD Layer       │   │   Three.js WebGL Canvas   │    │
│  │  (pointer-events:none)│   │   (Scene.ts)              │    │
│  │  • Editorial Header   │   │   • InstancedMesh nodes   │    │
│  │  • Telemetry Panel    │   │   • troika-three-text     │    │
│  │  • Insight Drawer     │   │   • Shader edge splines   │    │
│  └──────────────────────┘   │   • Bloom + Vignette       │    │
│                             └──────────────────────────┘    │
│              ↕ useDeliberationStream.ts                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        Physics Web Worker  (physics.worker.ts)        │   │
│  │  Barnes-Hut Octree · Spring · Coulomb · Tension       │   │
│  │  → Float32Array [x,y,z,scale,stateId,alpha] · 60Hz    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. `useDeliberationStream` emits deliberation events at **5–8 Hz**
2. Events dispatch `APPEND_NODES` / `ADD_EDGES` / `SET_PHASE_STATE` to the Worker
3. Worker runs physics at **~60 Hz**, transfers `Float32Array` (6-float stride) via zero-copy transferable
4. `Scene.ts` reads the buffer **directly in `rAF`** — zero React reconciliation at render frequency
5. React receives HUD telemetry updates at **~10 Hz** only

---

## Physics Model

| Force | Formula | Notes |
|---|---|---|
| Spring attraction | `F = -ks(d - L₀) - c·v` | Hooke's Law + velocity damping (0.85) |
| Coulomb repulsion | `F = kr / d²` | Barnes-Hut Octree, θ = 0.6 |
| Oscillatory tension | `F = A·sin(ωt)·û` | Applied only to contradiction edges |
| Centering sink | `F = -kg·p` | Soft gravitational pull toward origin |
| Crystallize gravity | `F = 0.02·Δp` | Pull toward crystallized insight node |

---

## Technical Decisions

| Problem | Solution |
|---|---|
| 3D Coulomb repulsion | **Barnes-Hut Octree** (not Quadtree — 3D requires 8 octants) |
| Buffer detachment crash | **Double-buffered ping-pong** — main thread returns consumed buffer |
| React 60Hz state trap | **Worker → Scene direct pipeline** bypasses reconciliation entirely |
| Global tension uniform | **Per-vertex `aEdgeType` + `aTension` attributes** on custom ShaderMaterial |
| InstancedMesh resize | Pre-allocated **500 node capacity**; `mesh.count` adjusted dynamically |
| Text in 3D | `troika-three-text` with `quaternion.copy(camera.quaternion)` billboarding |
| Pruned node indexing | **Tombstoning** (mass→0.001, not array splice) preserves edge indices |
| Post-processing | Pure `three/examples/jsm/postprocessing/*` — no `@react-three/fiber` |

---

## Stack

- **Vite** + **React 18** + **TypeScript**
- **Three.js v0.170+** (vanilla, no R3F)
- **troika-three-text** — GPU-rendered MSDF text labels in 3D
- **Framer Motion** — Insight Drawer animations
- **Tailwind CSS v4** — HUD styling
- **Web Worker** with ES module format — physics entirely off-thread

---

## Deliberation Events

```
SEED_PROMPT          → Spawns central question node (mass=1, STATE_SEED)
EXPLORE_BRANCH       → Spawns premise cluster with spring edge to parent
DETECT_CONTRADICTION → Connects tension edge; triggers Coulomb repulsion burst
PRUNE_BRANCH         → Tombstones node (targetScale=0, targetAlpha=0.1, mass=0.001)
CRYSTALLIZE_INSIGHT  → Creates gold insight node + gravity pull + adds to HUD drawer
```

---

## Running Locally

```bash
git clone https://github.com/AdwaitPr/APEIRON.git
cd APEIRON
npm install
npm run dev
```

Open `http://localhost:5173` and watch a mind deliberate.

---

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| Canvas | `#0E0E10` | Background / scene clear color |
| Panel | `#18181C` | HUD glassmorphic panels |
| Border | `#32323E` | Panel borders |
| Titanium | `#EAEAEE` | Primary text / active nodes |
| Tension Amber | `#D4A050` | Contradiction edges / tension index |
| Insight Gold | `#D4B84A` | Crystallized nodes / insights |

---

## Etymology

> **ἄπειρον** *(apeiron)* — Ancient Greek, Anaximander (~600 BC).
> "The Boundless." The infinite, undifferentiated substrate from which all defined things emerge — and into which destroyed things dissolve.

In APEIRON, every idea begins as coordinates in void. The physics decide what survives.

---

*Built with Three.js, physics, and a genuine interest in whether computation can think.*
