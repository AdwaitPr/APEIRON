// ─── Barnes-Hut 3D Octree ───
// O(n log n) spatial decomposition for Coulomb repulsion.
// Uses an Octree (8 octants) for proper 3D partitioning.
// Zero external dependencies.

const MAX_DEPTH = 20;

class OctNode {
  // Bounding cube center & half-extent
  cx: number;
  cy: number;
  cz: number;
  halfSize: number;

  // Leaf body (-1 = empty or internal)
  bodyIdx: number = -1;
  bodyX: number = 0;
  bodyY: number = 0;
  bodyZ: number = 0;

  // Aggregate center-of-mass
  totalMass: number = 0;
  comX: number = 0;
  comY: number = 0;
  comZ: number = 0;

  // Children (8 octants), null = empty
  children: (OctNode | null)[] | null = null;
  isLeaf: boolean = true;

  constructor(cx: number, cy: number, cz: number, halfSize: number) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.halfSize = halfSize;
  }

  reset(cx: number, cy: number, cz: number, halfSize: number): void {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.halfSize = halfSize;
    this.bodyIdx = -1;
    this.bodyX = 0;
    this.bodyY = 0;
    this.bodyZ = 0;
    this.totalMass = 0;
    this.comX = 0;
    this.comY = 0;
    this.comZ = 0;
    this.children = null;
    this.isLeaf = true;
  }
}

/**
 * Returns which octant (0–7) point (px,py,pz) falls into
 * relative to center (cx,cy,cz).
 *
 * Bit 0 (1) = +X, Bit 1 (2) = +Y, Bit 2 (4) = +Z
 */
function octantOf(px: number, py: number, pz: number, cx: number, cy: number, cz: number): number {
  let idx = 0;
  if (px >= cx) idx |= 1;
  if (py >= cy) idx |= 2;
  if (pz >= cz) idx |= 4;
  return idx;
}

/**
 * Compute the center of the child octant given the parent center, half-size, and octant index.
 */
function childCenter(
  parentCx: number, parentCy: number, parentCz: number,
  parentHalf: number, octant: number,
  out: Float64Array
): void {
  const qs = parentHalf * 0.5; // quarter-size
  out[0] = parentCx + ((octant & 1) ? qs : -qs);
  out[1] = parentCy + ((octant & 2) ? qs : -qs);
  out[2] = parentCz + ((octant & 4) ? qs : -qs);
}

// ─── Reusable scratch arrays ───
const _childPos = new Float64Array(3);

export class Octree {
  private pool: OctNode[] = [];
  private poolIdx: number = 0;
  root: OctNode | null = null;

  private acquireNode(cx: number, cy: number, cz: number, halfSize: number): OctNode {
    if (this.poolIdx < this.pool.length) {
      const n = this.pool[this.poolIdx++];
      n.reset(cx, cy, cz, halfSize);
      return n;
    }
    const n = new OctNode(cx, cy, cz, halfSize);
    this.pool.push(n);
    this.poolIdx++;
    return n;
  }

  /**
   * Rebuild the octree from scratch using Structure-of-Arrays position data.
   */
  build(
    px: Float64Array,
    py: Float64Array,
    pz: Float64Array,
    masses: Float64Array,
    count: number
  ): void {
    this.poolIdx = 0;
    this.root = null;

    if (count === 0) return;

    // Compute bounding cube
    let minX = px[0], maxX = px[0];
    let minY = py[0], maxY = py[0];
    let minZ = pz[0], maxZ = pz[0];

    for (let i = 1; i < count; i++) {
      if (px[i] < minX) minX = px[i];
      else if (px[i] > maxX) maxX = px[i];
      if (py[i] < minY) minY = py[i];
      else if (py[i] > maxY) maxY = py[i];
      if (pz[i] < minZ) minZ = pz[i];
      else if (pz[i] > maxZ) maxZ = pz[i];
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const halfSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + 1.0;

    this.root = this.acquireNode(cx, cy, cz, halfSize);

    for (let i = 0; i < count; i++) {
      this.insert(this.root, i, px[i], py[i], pz[i], masses[i], 0);
    }
  }

  private insert(
    node: OctNode,
    bodyIdx: number,
    bx: number, by: number, bz: number,
    mass: number,
    depth: number
  ): void {
    // Update center-of-mass at this node
    if (node.totalMass === 0) {
      node.comX = bx;
      node.comY = by;
      node.comZ = bz;
      node.totalMass = mass;
    } else {
      const newMass = node.totalMass + mass;
      node.comX = (node.comX * node.totalMass + bx * mass) / newMass;
      node.comY = (node.comY * node.totalMass + by * mass) / newMass;
      node.comZ = (node.comZ * node.totalMass + bz * mass) / newMass;
      node.totalMass = newMass;
    }

    // Case 1: Empty leaf — store body here
    if (node.isLeaf && node.bodyIdx === -1) {
      node.bodyIdx = bodyIdx;
      node.bodyX = bx;
      node.bodyY = by;
      node.bodyZ = bz;
      return;
    }

    // Case 2: Occupied leaf — subdivide
    if (node.isLeaf) {
      if (depth >= MAX_DEPTH) {
        // Max depth reached — just accumulate (avoids infinite subdivision for coincident points)
        return;
      }
      const oldIdx = node.bodyIdx;
      const oldX = node.bodyX;
      const oldY = node.bodyY;
      const oldZ = node.bodyZ;

      node.bodyIdx = -1;
      node.isLeaf = false;
      node.children = [null, null, null, null, null, null, null, null];

      // Re-insert existing body into correct child
      this.insertIntoChild(node, oldIdx, oldX, oldY, oldZ, node.totalMass - mass, depth);
    }

    // Case 3: Internal node — recurse into correct child
    this.insertIntoChild(node, bodyIdx, bx, by, bz, mass, depth);
  }

  private insertIntoChild(
    node: OctNode,
    bodyIdx: number,
    bx: number, by: number, bz: number,
    mass: number,
    depth: number
  ): void {
    const octant = octantOf(bx, by, bz, node.cx, node.cy, node.cz);

    if (!node.children) {
      node.children = [null, null, null, null, null, null, null, null];
    }

    if (!node.children[octant]) {
      childCenter(node.cx, node.cy, node.cz, node.halfSize, octant, _childPos);
      node.children[octant] = this.acquireNode(
        _childPos[0], _childPos[1], _childPos[2],
        node.halfSize * 0.5
      );
    }

    this.insert(node.children[octant]!, bodyIdx, bx, by, bz, mass, depth + 1);
  }

  /**
   * Compute the net Coulomb repulsion force on body `bodyIdx` at position (bx,by,bz).
   * Result written to out[0..2] = (fx, fy, fz).
   */
  computeForce(
    bodyIdx: number,
    bx: number, by: number, bz: number,
    theta: number,
    kr: number,
    out: Float64Array
  ): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    if (this.root) {
      this.traverse(this.root, bodyIdx, bx, by, bz, theta, kr, out);
    }
  }

  private traverse(
    node: OctNode,
    bodyIdx: number,
    bx: number, by: number, bz: number,
    theta: number,
    kr: number,
    out: Float64Array
  ): void {
    if (node.totalMass === 0) return;

    // Skip self
    if (node.isLeaf && node.bodyIdx === bodyIdx) return;

    const dx = bx - node.comX;
    const dy = by - node.comY;
    const dz = bz - node.comZ;
    const distSq = dx * dx + dy * dy + dz * dz;

    // Minimum distance clamp to avoid singularities
    const clampedDistSq = Math.max(distSq, 0.25);

    const nodeSize = node.halfSize * 2;

    // Barnes-Hut criterion: if node is a leaf, or s/d < θ, treat as point mass
    if (node.isLeaf || (nodeSize * nodeSize / clampedDistSq) < (theta * theta)) {
      // Coulomb repulsion: F = kr / d², directed from COM toward body
      const dist = Math.sqrt(clampedDistSq);
      const forceMag = kr / clampedDistSq;
      const invDist = 1.0 / dist;

      out[0] += dx * invDist * forceMag;
      out[1] += dy * invDist * forceMag;
      out[2] += dz * invDist * forceMag;
      return;
    }

    // Recurse into children
    if (node.children) {
      for (let i = 0; i < 8; i++) {
        if (node.children[i]) {
          this.traverse(node.children[i]!, bodyIdx, bx, by, bz, theta, kr, out);
        }
      }
    }
  }
}
