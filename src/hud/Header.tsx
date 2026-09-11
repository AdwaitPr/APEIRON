// ─── Editorial Header ───
// Displays the central deliberation question with premium typography.

import React from 'react';

interface HeaderProps {
  question: string;
  phase: string;
}

const phaseLabels: Record<string, string> = {
  idle: 'AWAITING',
  seeding: 'SEEDING',
  exploring: 'EXPLORING',
  contradicting: 'DETECTING CONTRADICTIONS',
  pruning: 'PRUNING',
  crystallizing: 'CRYSTALLIZING',
  complete: 'DELIBERATION COMPLETE',
};

const Header: React.FC<HeaderProps> = ({ question, phase }) => {
  return (
    <header className="hud-header">
      <div className="hud-header__phase">
        <span className="hud-header__phase-dot" data-phase={phase} />
        <span className="hud-header__phase-label">
          {phaseLabels[phase] ?? phase.toUpperCase()}
        </span>
      </div>
      <h1 className="hud-header__question">{question}</h1>
      <div className="hud-header__rule" />
    </header>
  );
};

export default Header;
