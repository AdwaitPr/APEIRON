// ─── WebGL Rendering Engine ───
// Vanilla Three.js scene class (NO @react-three/fiber).
// Mounted onto a canvas element and driven imperatively.
//
// Architecture:
//   • InstancedMesh (pre-allocated 500 cap) for nodes
//   • troika-three-text labels with per-frame billboard rotation
//   • Custom ShaderMaterial edges with per-vertex aEdgeType/aTension
//   • EffectComposer → RenderPass → UnrealBloomPass → Vignette ShaderPass
//   • Zero allocations inside the rAF loop

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Text } from 'troika-three-text';
import {
  edgeVertexShader,
  edgeFragmentShader,
  vignetteVertexShader,
  vignetteFragmentShader,
} from './edgeShader';
import {
  MAX_NODES,
  MAX_EDGES,
  STRIDE,
  STATE_ACTIVE,
  STATE_EXPLORING,
  STATE_CONTRADICTING,
  STATE_PRUNED,
  STATE_CRYSTALLIZED,
  STATE_SEED,
  EDGE_SPRING,
  EDGE_CONTRADICTION,
  EDGE_GRAVITY,
  type SceneEdge,
} from '../worker/types';

// ─── Color palette (mapped to stateId) ───
const STATE_COLORS: Record<number, [number, number, number]> = {
  [STATE_ACTIVE]:        [0.918, 0.918, 0.933],   // #EAEAEE
  [STATE_EXPLORING]:     [0.290, 0.565, 0.851],   // #4A90D9
  [STATE_CONTRADICTING]: [0.831, 0.627, 0.314],   // #D4A050
  [STATE_PRUNED]:        [0.200, 0.200, 0.240],   // dimmed
  [STATE_CRYSTALLIZED]:  [0.831, 0.722, 0.290],   // #D4B84A
  [STATE_SEED]:          [1.000, 1.000, 1.000],   // white
};

const STATE_EMISSIVE: Record<number, number> = {
  [STATE_ACTIVE]: 0.3,
  [STATE_EXPLORING]: 0.5,
  [STATE_CONTRADICTING]: 0.6,
  [STATE_PRUNED]: 0.0,
  [STATE_CRYSTALLIZED]: 0.8,
  [STATE_SEED]: 0.9,
};

export class Scene {
  // ─── Three.js core ───
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;

  // ─── Node rendering ───
  private nodeGeometry: THREE.SphereGeometry;
  private nodeMaterial: THREE.MeshStandardMaterial;
  private instancedMesh: THREE.InstancedMesh;

  // ─── Edge rendering ───
  private edgeGeometry: THREE.BufferGeometry;
  private edgeMaterial: THREE.ShaderMaterial;
  private edgeLines: THREE.LineSegments;
  private edgePositionAttr: THREE.BufferAttribute;
  private edgeTypeAttr: THREE.BufferAttribute;
  private edgeTensionAttr: THREE.BufferAttribute;
  private sceneEdges: SceneEdge[] = [];

  // ─── Text labels ───
  private textMeshes: Map<number, Text> = new Map();

  // ─── Pre-allocated temp objects (zero-alloc in rAF) ───
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _pos = new THREE.Vector3();
  private readonly _scl = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _col = new THREE.Color();

  // ─── State ───
  private latestBuffer: Float32Array | null = null;
  private latestNodeCount: number = 0;
  private consumedBuffer: ArrayBuffer | null = null;
  private animationId: number = 0;
  private disposed = false;
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement) {
    // ─── Renderer ───
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setClearColor(0x0E0E10, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // ─── Scene ───
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0E0E10, 0.008);

    // ─── Camera ───
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 500);
    this.camera.position.set(0, 8, 30);

    // ─── Controls ───
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 120;
    this.controls.target.set(0, 0, 0);

    // ─── Lighting ───
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(10, 20, 15);
    this.scene.add(directional);
    const point = new THREE.PointLight(0xD4B84A, 0.4, 60);
    point.position.set(-5, 5, -5);
    this.scene.add(point);

    // ─── Node InstancedMesh (pre-allocated to MAX_NODES) ───
    this.nodeGeometry = new THREE.SphereGeometry(0.35, 24, 16);
    this.nodeMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.35,
      roughness: 0.55,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.3,
      transparent: true,
    });
    this.instancedMesh = new THREE.InstancedMesh(
      this.nodeGeometry,
      this.nodeMaterial,
      MAX_NODES
    );
    this.instancedMesh.count = 0; // Start with 0 visible
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Initialize instance colors
    const colors = new Float32Array(MAX_NODES * 3);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.instancedMesh);

    // ─── Edge line segments ───
    const maxEdgeVerts = MAX_EDGES * 2; // 2 vertices per edge
    const edgePosArray = new Float32Array(maxEdgeVerts * 3);
    const edgeTypeArray = new Float32Array(maxEdgeVerts);
    const edgeTensionArray = new Float32Array(maxEdgeVerts);

    this.edgeGeometry = new THREE.BufferGeometry();
    this.edgePositionAttr = new THREE.BufferAttribute(edgePosArray, 3);
    this.edgePositionAttr.setUsage(THREE.DynamicDrawUsage);
    this.edgeTypeAttr = new THREE.BufferAttribute(edgeTypeArray, 1);
    this.edgeTypeAttr.setUsage(THREE.DynamicDrawUsage);
    this.edgeTensionAttr = new THREE.BufferAttribute(edgeTensionArray, 1);
    this.edgeTensionAttr.setUsage(THREE.DynamicDrawUsage);

    this.edgeGeometry.setAttribute('position', this.edgePositionAttr);
    this.edgeGeometry.setAttribute('aEdgeType', this.edgeTypeAttr);
    this.edgeGeometry.setAttribute('aTension', this.edgeTensionAttr);
    this.edgeGeometry.setDrawRange(0, 0);

    this.edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: edgeVertexShader,
      fragmentShader: edgeFragmentShader,
      uniforms: {
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.edgeLines = new THREE.LineSegments(this.edgeGeometry, this.edgeMaterial);
    this.scene.add(this.edgeLines);

    // ─── Post-processing ───
    this.composer = new EffectComposer(this.renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.2, // strength
      0.4, // radius
      0.85 // threshold
    );
    this.composer.addPass(bloomPass);

    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uDarkness: { value: 1.5 },
        uOffset: { value: 1.2 },
      },
      vertexShader: vignetteVertexShader,
      fragmentShader: vignetteFragmentShader,
    });
    this.composer.addPass(vignettePass);

    // ─── Resize handler ───
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  // ══════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════

  /**
   * Called from the worker message handler.
   * Stores the buffer reference; actual matrix updates happen in rAF.
   */
  updateFromBuffer(buffer: Float32Array, nodeCount: number): void {
    // If we had a previous buffer, queue it for return
    if (this.latestBuffer) {
      this.consumedBuffer = this.latestBuffer.buffer;
    }
    this.latestBuffer = buffer;
    this.latestNodeCount = nodeCount;
  }

  /**
   * Returns the last consumed ArrayBuffer for ping-pong back to the worker.
   * Returns null if no buffer has been consumed yet.
   */
  getConsumedBuffer(): ArrayBuffer | null {
    const buf = this.consumedBuffer;
    this.consumedBuffer = null;
    return buf;
  }

  /**
   * Add a 3D text label for a node at the given index.
   */
  addNodeLabel(index: number, label: string, _stateId: number): void {
    if (this.textMeshes.has(index)) return;

    const text = new Text();
    text.text = label;
    text.fontSize = 0.3;
    text.color = 0xEAEAEE;
    text.anchorX = 'center';
    text.anchorY = 'bottom';
    text.outlineWidth = 0.015;
    text.outlineColor = 0x0E0E10;
    text.outlineOpacity = 0.8;
    text.fillOpacity = 0.85;
    text.letterSpacing = -0.01;
    text.depthOffset = -0.5;
    (text.material as THREE.Material).depthTest = true;
    (text.material as THREE.Material).transparent = true;
    text.sync();

    this.scene.add(text);
    this.textMeshes.set(index, text);
  }

  /**
   * Remove a text label for a node at the given index.
   */
  removeNodeLabel(index: number): void {
    const text = this.textMeshes.get(index);
    if (text) {
      this.scene.remove(text);
      text.dispose();
      this.textMeshes.delete(index);
    }
  }

  /**
   * Update the edge topology (called when edges change, not every frame).
   */
  setEdges(edges: SceneEdge[]): void {
    this.sceneEdges = edges;
  }

  /**
   * Start the render loop.
   */
  start(): void {
    this.clock.start();
    this.render();
  }

  /**
   * Stop the render loop.
   */
  stop(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);

    // Dispose text meshes
    this.textMeshes.forEach((text) => {
      this.scene.remove(text);
      text.dispose();
    });
    this.textMeshes.clear();

    // Dispose geometry/material
    this.nodeGeometry.dispose();
    this.nodeMaterial.dispose();
    this.instancedMesh.dispose();
    this.edgeGeometry.dispose();
    this.edgeMaterial.dispose();

    // Dispose composer
    this.composer.dispose();

    // Dispose renderer
    this.renderer.dispose();
  }

  // ══════════════════════════════════════════════════════════
  // Render Loop (zero allocations)
  // ══════════════════════════════════════════════════════════

  private render = (): void => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.render);

    const elapsed = this.clock.getElapsedTime();

    // ─── Update controls ───
    this.controls.update();

    // ─── Update node instances from buffer ───
    const buf = this.latestBuffer;
    const count = this.latestNodeCount;
    if (buf && count > 0) {
      this.instancedMesh.count = count;

      for (let i = 0; i < count; i++) {
        const offset = i * STRIDE;
        const x = buf[offset];
        const y = buf[offset + 1];
        const z = buf[offset + 2];
        const s = buf[offset + 3];
        const sid = buf[offset + 4];
        const a = buf[offset + 5];

        // Update instance matrix (no new objects)
        this._pos.set(x, y, z);
        this._scl.set(s, s, s);
        this._mat4.compose(this._pos, this._quat, this._scl);
        this.instancedMesh.setMatrixAt(i, this._mat4);

        // Update instance color based on stateId
        const stateColors = STATE_COLORS[sid] ?? STATE_COLORS[STATE_ACTIVE];
        this._col.setRGB(
          stateColors[0] * a,
          stateColors[1] * a,
          stateColors[2] * a
        );
        this.instancedMesh.setColorAt(i, this._col);

        // Update text label position + billboard
        const textMesh = this.textMeshes.get(i);
        if (textMesh) {
          textMesh.position.set(x, y + s * 0.5 + 0.4, z);
          textMesh.quaternion.copy(this.camera.quaternion); // Billboard
          textMesh.fillOpacity = a * 0.85;
        }
      }

      this.instancedMesh.instanceMatrix.needsUpdate = true;
      if (this.instancedMesh.instanceColor) {
        this.instancedMesh.instanceColor.needsUpdate = true;
      }

      // ─── Update edge positions from buffer ───
      this.updateEdgeGeometry(buf);
    }

    // ─── Update edge shader time uniform ───
    this.edgeMaterial.uniforms.uTime.value = elapsed;

    // ─── Render with post-processing ───
    this.composer.render();
  };

  // ══════════════════════════════════════════════════════════
  // Edge Geometry Update (reads positions from buffer)
  // ══════════════════════════════════════════════════════════

  private updateEdgeGeometry(buf: Float32Array): void {
    const posArr = this.edgePositionAttr.array as Float32Array;
    const typeArr = this.edgeTypeAttr.array as Float32Array;
    const tensArr = this.edgeTensionAttr.array as Float32Array;

    const edgeCount = Math.min(this.sceneEdges.length, MAX_EDGES);
    let vi = 0;

    for (let e = 0; e < edgeCount; e++) {
      const edge = this.sceneEdges[e];
      const aOff = edge.sourceIndex * STRIDE;
      const bOff = edge.targetIndex * STRIDE;

      // Vertex A
      posArr[vi * 3]     = buf[aOff];
      posArr[vi * 3 + 1] = buf[aOff + 1];
      posArr[vi * 3 + 2] = buf[aOff + 2];
      typeArr[vi] = edge.type;
      tensArr[vi] = edge.tension;
      vi++;

      // Vertex B
      posArr[vi * 3]     = buf[bOff];
      posArr[vi * 3 + 1] = buf[bOff + 1];
      posArr[vi * 3 + 2] = buf[bOff + 2];
      typeArr[vi] = edge.type;
      tensArr[vi] = edge.tension;
      vi++;
    }

    this.edgeGeometry.setDrawRange(0, vi);
    this.edgePositionAttr.needsUpdate = true;
    this.edgeTypeAttr.needsUpdate = true;
    this.edgeTensionAttr.needsUpdate = true;
  }

  // ══════════════════════════════════════════════════════════
  // Resize
  // ══════════════════════════════════════════════════════════

  private onResize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    const w = parent.clientWidth;
    const h = parent.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
  }
}
