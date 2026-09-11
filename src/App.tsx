// ─── App Root ───
// Assembles: WebGL Canvas + DOM HUD + Deliberation Stream

import { useEffect, useRef, useCallback } from 'react';
import KnowledgeGraphCanvas, { type KnowledgeGraphCanvasHandle } from './canvas/KnowledgeGraphCanvas';
import HUD from './hud/HUD';
import { useDeliberationStream } from './hooks/useDeliberationStream';

export default function App() {
  const canvasRef = useRef<KnowledgeGraphCanvasHandle>(null);
  const hasStarted = useRef(false);

  const {
    start,
    attachScene,
    question,
    phase,
    telemetry,
    insights,
  } = useDeliberationStream();

  const initializeStream = useCallback(() => {
    if (hasStarted.current) return;
    const scene = canvasRef.current?.getScene();
    if (!scene) return;

    hasStarted.current = true;
    attachScene(scene);
    start();
  }, [attachScene, start]);

  useEffect(() => {
    // Small delay to ensure Scene is fully initialized
    const timer = setTimeout(initializeStream, 300);
    return () => clearTimeout(timer);
  }, [initializeStream]);

  return (
    <>
      <KnowledgeGraphCanvas ref={canvasRef} />
      <HUD
        question={question}
        phase={phase}
        telemetry={telemetry}
        insights={insights}
      />
    </>
  );
}
