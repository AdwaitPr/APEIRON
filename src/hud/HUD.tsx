// ─── HUD Container ───
// Root overlay for all DOM HUD elements.
// pointer-events: none so all mouse events pass through to WebGL canvas.

import React from 'react';
import Header from './Header';
import TelemetryPanel from './TelemetryPanel';
import InsightDrawer from './InsightDrawer';
import type { TelemetryData, Insight } from '../worker/types';

interface HUDProps {
  question: string;
  telemetry: TelemetryData;
  insights: Insight[];
  phase: string;
}

const HUD: React.FC<HUDProps> = ({ question, telemetry, insights, phase }) => {
  return (
    <div className="hud-container">
      <Header question={question} phase={phase} />
      <TelemetryPanel telemetry={telemetry} />
      <InsightDrawer insights={insights} />
    </div>
  );
};

export default HUD;
