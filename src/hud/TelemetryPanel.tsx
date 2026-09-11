// ─── Telemetry Panel ───
// Monospace real-time simulation metrics, upper-right corner.

import React from 'react';
import type { TelemetryData } from '../worker/types';

interface TelemetryPanelProps {
  telemetry: TelemetryData;
}

function pad(value: string, len: number): string {
  return value.padStart(len, ' ');
}

const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ telemetry }) => {
  const {
    iteration,
    entropy,
    tensionIndex,
    convergence,
    nodeCount,
    edgeCount,
  } = telemetry;

  return (
    <div className="telemetry-panel">
      <div className="telemetry-panel__title">SYS TELEMETRY</div>
      <div className="telemetry-panel__grid">
        <TelRow label="ITERATION" value={pad(iteration.toString(), 6)} />
        <TelRow label="NODES" value={pad(nodeCount.toString(), 6)} />
        <TelRow label="EDGES" value={pad(edgeCount.toString(), 6)} />
        <TelRow
          label="ENTROPY"
          value={pad(entropy.toFixed(4), 8)}
          highlight={entropy > 1.0}
        />
        <TelRow
          label="TENSION IDX"
          value={pad(tensionIndex.toFixed(2), 8)}
          highlight={tensionIndex > 10}
          amber
        />
        <TelRow
          label="CONVERGENCE"
          value={pad(convergence.toFixed(1) + '%', 7)}
          highlight={convergence > 90}
          gold
        />
      </div>
    </div>
  );
};

interface TelRowProps {
  label: string;
  value: string;
  highlight?: boolean;
  amber?: boolean;
  gold?: boolean;
}

const TelRow: React.FC<TelRowProps> = ({ label, value, highlight, amber, gold }) => (
  <div className="telemetry-row">
    <span className="telemetry-row__label">{label}</span>
    <span
      className={[
        'telemetry-row__value',
        highlight ? 'telemetry-row__value--highlight' : '',
        amber ? 'telemetry-row__value--amber' : '',
        gold ? 'telemetry-row__value--gold' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {value}
    </span>
  </div>
);

export default TelemetryPanel;
