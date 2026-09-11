// ─── React wrapper for the vanilla Three.js Scene ───
// Mounts the Scene onto a <canvas> ref, handles lifecycle.

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Scene } from './Scene';

export interface KnowledgeGraphCanvasHandle {
  getScene(): Scene | null;
}

const KnowledgeGraphCanvas = forwardRef<KnowledgeGraphCanvasHandle>(
  function KnowledgeGraphCanvas(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<Scene | null>(null);

    useImperativeHandle(ref, () => ({
      getScene: () => sceneRef.current,
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const scene = new Scene(canvas);
      sceneRef.current = scene;
      scene.start();

      return () => {
        scene.dispose();
        sceneRef.current = null;
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        id="knowledge-graph-canvas"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          display: 'block',
          zIndex: 0,
        }}
      />
    );
  }
);

export default KnowledgeGraphCanvas;
