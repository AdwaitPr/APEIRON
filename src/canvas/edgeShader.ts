// ─── Custom Shader Material for Edge Splines ───
// Per-vertex attributes: aEdgeType, aTension
// Uniforms: uTime
// Contradiction edges get high-frequency visual vibration.
// Other edge types get static rendering with type-based coloring.

export const edgeVertexShader = /* glsl */ `
  attribute float aEdgeType;
  attribute float aTension;

  varying float vEdgeType;
  varying float vTension;
  varying float vAlpha;

  uniform float uTime;

  void main() {
    vEdgeType = aEdgeType;
    vTension = aTension;
    vAlpha = 1.0;

    vec3 pos = position;

    // High-frequency vibration for contradiction edges (type == 1)
    if (aTension > 0.01) {
      float freq = 25.0;
      float amp = aTension * 0.06;

      // Multi-axis displacement for organic jitter
      pos.x += amp * sin(uTime * freq + pos.y * 7.0 + pos.z * 3.0);
      pos.y += amp * cos(uTime * freq * 1.3 + pos.z * 5.0 + pos.x * 4.0);
      pos.z += amp * sin(uTime * freq * 0.9 + pos.x * 6.0 + pos.y * 2.0);
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const edgeFragmentShader = /* glsl */ `
  varying float vEdgeType;
  varying float vTension;
  varying float vAlpha;

  uniform float uTime;

  void main() {
    vec3 color;
    float a = 0.3;

    // Edge type coloring
    if (vEdgeType < 0.5) {
      // SPRING — subtle warm gray
      color = vec3(0.45, 0.45, 0.50);
      a = 0.12;
    } else if (vEdgeType < 1.5) {
      // CONTRADICTION — tension amber with pulsing alpha
      color = vec3(0.831, 0.627, 0.314);
      a = 0.45 + 0.35 * sin(uTime * 6.0);
    } else if (vEdgeType < 2.5) {
      // GRAVITY — insight gold
      color = vec3(0.831, 0.722, 0.290);
      a = 0.35;
    } else {
      // DERIVES — cool blue
      color = vec3(0.29, 0.565, 0.851);
      a = 0.20;
    }

    gl_FragColor = vec4(color, a * vAlpha);
  }
`;

// ─── Fullscreen Vignette Shader Pass ───
export const vignetteVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const vignetteFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uDarkness;
  uniform float uOffset;

  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);

    // Radial distance from center
    vec2 uv = (vUv - vec2(0.5)) * vec2(uOffset);
    float vignette = clamp(1.0 - dot(uv, uv), 0.0, 1.0);
    vignette = pow(vignette, uDarkness);

    gl_FragColor = vec4(texel.rgb * vignette, texel.a);
  }
`;
