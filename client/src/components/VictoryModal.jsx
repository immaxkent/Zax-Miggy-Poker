import { motion, AnimatePresence } from 'framer-motion';

const G = '#00e676';
const P = '#ff0070';

function fmtUsdc(raw) {
  if (raw == null) return '—';
  const n = Number(raw) / 1e6;
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} USDC`;
}

function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString();
}

export default function VictoryModal({ victory, onClose }) {
  const open = !!victory;
  const txHash = victory?.txHash || null;
  const summary = victory?.summary || {};

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
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 220, damping: 20 }}
            style={{
              width: 'min(560px, 100%)',
              borderRadius: 18,
              border: `1px solid ${G}55`,
              background: 'linear-gradient(160deg,#07121d 0%,#0b0f1d 56%,#130b1e 100%)',
              boxShadow: `0 20px 90px ${G}20, 0 0 0 1px rgba(255,255,255,0.03) inset`,
              padding: 22,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <motion.div
              animate={{ rotate: [0, 2, -2, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                width: 98,
                height: 98,
                margin: '0 auto 14px',
                borderRadius: '50%',
                border: `2px solid ${G}99`,
                background: `radial-gradient(circle at 30% 30%, ${G}77 0%, ${P}55 46%, rgba(0,0,0,0.15) 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#04150a',
                fontWeight: 900,
                fontSize: 22,
                textShadow: '0 1px 0 rgba(255,255,255,0.35)',
                boxShadow: `0 0 40px ${G}40`,
              }}
            >
              YOU
            </motion.div>

            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ color: G, fontWeight: 900, fontSize: 30, letterSpacing: '0.08em' }}>YOU WON</div>
              <div style={{ color: '#8ea5b9', fontSize: 11, letterSpacing: '0.18em' }}>
                {victory?.status === 'mined' ? 'SETTLED ON-CHAIN' : victory?.status === 'failed' ? 'SETTLEMENT FAILED' : 'SETTLING ON-CHAIN...'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { k: 'HANDS PLAYED', v: fmtNum(summary.handsPlayed) },
                { k: 'CHIPS WON', v: `≡ ${fmtNum(summary.chipsWonInGame)}` },
                { k: 'USDC WON', v: fmtUsdc(summary.usdcWon) },
                { k: 'GAME ID', v: victory?.gameId ?? '—' },
              ].map(item => (
                <div key={item.k} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.015)' }}>
                  <div style={{ color: '#4b6175', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 5 }}>{item.k}</div>
                  <div style={{ color: '#d7e2ec', fontSize: 14, fontWeight: 800 }}>{item.v}</div>
                </div>
              ))}
            </div>

            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', marginBottom: 16, background: 'rgba(2,12,20,0.7)' }}>
              <div style={{ color: '#4b6175', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 4 }}>TX RECEIPT</div>
              <div style={{ color: '#9fb3c7', fontSize: 12, fontFamily: 'Space Mono,monospace', wordBreak: 'break-all' }}>
                {txHash || (victory?.status === 'failed' ? (victory?.error || 'No tx hash.') : 'Waiting for transaction hash...')}
              </div>
              {txHash && (
                <a
                  href={`https://basescan.org/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: G, fontSize: 12, fontWeight: 700, marginTop: 6, display: 'inline-block', textDecoration: 'none' }}
                >
                  View on BaseScan
                </a>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={onClose}
                style={{
                  height: 36,
                  padding: '0 18px',
                  borderRadius: 8,
                  border: `1px solid ${G}55`,
                  background: `${G}18`,
                  color: G,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                }}
              >
                AWESOME
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
