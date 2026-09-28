import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, MessageSquareWarning, X } from 'lucide-react';

export function FloatingButtons() {
  const [aiOpen, setAiOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAiOpen(true)}
        aria-label="Open AI assistant"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)] shadow-lg md:bottom-6"
      >
        <Sparkles className="h-6 w-6" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => setReportOpen(true)}
        aria-label="Open report / feedback drawer"
        className="fixed right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-[var(--radius-md)] bg-orange-500 px-2 py-3 text-white shadow-lg"
      >
        <span className="block [writing-mode:vertical-rl] text-xs font-semibold">Report</span>
      </button>

      <AnimatePresence>
        {aiOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed bottom-24 right-4 z-40 flex h-[420px] w-[min(90vw,360px)] flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] md:bottom-24"
            role="dialog"
            aria-label="AI assistant"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-[var(--color-primary)]" /> AI Assistant
              </p>
              <button type="button" onClick={() => setAiOpen(false)} aria-label="Close AI assistant">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-sm text-[var(--color-text-muted)]">
              Ask me anything about your workspace. This panel wires into the AI Suite gateway in a later phase.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reportOpen && (
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed right-0 top-0 z-40 h-full w-[min(90vw,380px)] border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
            role="dialog"
            aria-label="Report an issue"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquareWarning className="h-4 w-4 text-orange-500" /> Report an Issue
              </p>
              <button type="button" onClick={() => setReportOpen(false)} aria-label="Close report drawer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 text-sm text-[var(--color-text-muted)]">
              Bug/feedback form goes here — wired to the support pipeline in a later phase.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
