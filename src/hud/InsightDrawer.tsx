// ─── Insight Drawer ───
// Collapsible bottom-right drawer showing crystallized findings.
// Uses Framer Motion for smooth transitions.

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Insight } from '../worker/types';

interface InsightDrawerProps {
  insights: Insight[];
}

const InsightDrawer: React.FC<InsightDrawerProps> = ({ insights }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="insight-drawer">
      {/* Toggle button — pointer-events: auto */}
      <button
        className="insight-drawer__toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close insights' : 'Open insights'}
      >
        <span className="insight-drawer__toggle-icon">
          {isOpen ? '▾' : '▴'}
        </span>
        <span className="insight-drawer__toggle-label">
          INSIGHTS ({insights.length})
        </span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="insight-drawer__content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] },
              opacity: { duration: 0.25 },
            }}
          >
            {insights.length === 0 ? (
              <div className="insight-drawer__empty">
                <span className="insight-drawer__empty-icon">◇</span>
                <span>Awaiting crystallization…</span>
              </div>
            ) : (
              <ul className="insight-drawer__list">
                {insights.map((insight) => (
                  <motion.li
                    key={insight.id}
                    className="insight-card"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="insight-card__header">
                      <span className="insight-card__diamond">◆</span>
                      <h3 className="insight-card__title">{insight.title}</h3>
                    </div>
                    <p className="insight-card__body">{insight.body}</p>
                    <time className="insight-card__time">
                      {new Date(insight.timestamp).toLocaleTimeString()}
                    </time>
                  </motion.li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default InsightDrawer;
