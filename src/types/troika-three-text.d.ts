declare module 'troika-three-text' {
  import { Mesh, Material, Color } from 'three';

  export class Text extends Mesh {
    text: string;
    fontSize: number;
    color: Color | string | number;
    anchorX: string | number;
    anchorY: string | number;
    maxWidth: number;
    textAlign: string;
    font: string | null;
    outlineWidth: number | string;
    outlineColor: Color | string | number;
    outlineOpacity: number;
    fillOpacity: number;
    material: Material;
    clipRect: [number, number, number, number] | null;
    depthOffset: number;
    letterSpacing: number;
    lineHeight: number | string;
    overflowWrap: string;
    whiteSpace: string;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(
    config: { font: string; characters: string },
    callback: () => void
  ): void;
}
