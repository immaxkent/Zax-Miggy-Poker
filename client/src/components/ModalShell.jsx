import { AnimatePresence, motion } from 'framer-motion';

export default function ModalShell({
  open,
  children,
  maxWidth = '560px',
  borderColor = 'rgba(0,230,118,0.35)',
  background = 'linear-gradient(160deg,#07121d 0%,#0b0f1d 56%,#130b1e 100%)',
  glow = 'rgba(0,230,118,0.2)',
  pointerEvents = 'auto',
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            background: 'rgba(2,6,12,0.72)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
            pointerEvents,
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20 }}
            style={{
              width: `min(${maxWidth}, 100%)`,
              borderRadius: 18,
              border: `1px solid ${borderColor}`,
              background,
              boxShadow: `0 20px 90px ${glow}, 0 0 0 1px rgba(255,255,255,0.03) inset`,
              padding: 22,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
