import { useState, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import { SERVER_URL, SERVER_API_KEY } from '../utils/web3Config';

const G  = '#00e676';
const BG = '#090d14';

function UploadZone({ file, onFile }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      style={{
        border: `2px dashed ${dragging ? G : file ? `${G}80` : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 12,
        padding: '32px 24px',
        cursor: 'pointer',
        textAlign: 'center',
        background: dragging ? `${G}08` : file ? `${G}06` : 'rgba(255,255,255,0.02)',
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={e => e.target.files[0] && onFile(e.target.files[0])}
      />
      {file ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 28 }}>📦</div>
          <span style={{ color: G, fontSize: 13, fontWeight: 700, fontFamily: 'Space Mono, monospace' }}>{file.name}</span>
          <span style={{ color: '#475569', fontSize: 11 }}>click to replace</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
          <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Drop your bot ZIP here</div>
          <div style={{ color: '#475569', fontSize: 12 }}>or click to browse · accepts <span style={{ color: G, fontFamily: 'Space Mono, monospace' }}>.zip</span></div>
        </>
      )}
    </div>
  );
}

export default function LaunchBot() {
  const navigate = useNavigate();
  const [zipFile, setZipFile]     = useState(null);
  const [password, setPassword]   = useState('');
  const [parsed, setParsed]       = useState(null);  // { keystoreJson, config, botAddress }
  const [parseError, setParseError] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError]         = useState(null);

  async function handleZipFile(file) {
    setZipFile(file);
    setParsed(null);
    setParseError(null);
    setError(null);

    try {
      const zip = await JSZip.loadAsync(file);

      const ksFile = zip.file('keystore.json');
      if (!ksFile) throw new Error('ZIP is missing keystore.json');
      const keystoreJson = await ksFile.async('string');

      let ks;
      try { ks = JSON.parse(keystoreJson); } catch {
        throw new Error('keystore.json is not valid JSON');
      }
      if (!ks.address) throw new Error('keystore.json is missing the "address" field');

      let config = {};
      const cfgFile = zip.file('config.json');
      if (cfgFile) {
        try { config = JSON.parse(await cfgFile.async('string')); } catch {
          throw new Error('config.json is not valid JSON');
        }
      }

      setParsed({ keystoreJson, config, botAddress: ks.address.toLowerCase() });
    } catch (e) {
      setParseError(e.message || 'Failed to read ZIP');
    }
  }

  function clearZip() {
    setZipFile(null);
    setParsed(null);
    setParseError(null);
    setError(null);
    setPassword('');
  }

  async function launch() {
    if (!parsed || !password || launching) return;
    setLaunching(true);
    setError(null);

    try {
      // Extract Anthropic key from config (baked in via wizard) — never falls back to server key
      const anthropicApiKey = parsed.config?.anthropic_api_key || '';
      const configWithoutKey = { ...parsed.config };
      delete configWithoutKey.anthropic_api_key;

      const res = await fetch(`${SERVER_URL}/agent/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Poker-Key': SERVER_API_KEY },
        body: JSON.stringify({
          keystoreJson:     parsed.keystoreJson,
          keystorePassword: password,
          config:           configWithoutKey,
          ...(anthropicApiKey ? { anthropicApiKey } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      sessionStorage.setItem('activeBotAddress', data.botAddress || parsed.botAddress);
      navigate('/lobby');
    } catch (e) {
      setError(e.message || 'Launch failed');
    } finally {
      setLaunching(false);
    }
  }

  const canLaunch = parsed && password && !launching;

  return (
    <div style={{
      minHeight: '100vh', background: BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '80px 24px 40px',
    }}>
      <div style={{ width: '100%', maxWidth: 500 }}>

        <Link to="/" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: '#475569', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em',
          textDecoration: 'none', marginBottom: 32,
        }}>
          ← HOME
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 16,
            background: `${G}14`, border: `1px solid ${G}40`, borderRadius: 24,
            padding: '4px 14px', color: G, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
          }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: G, boxShadow: `0 0 6px ${G}` }} />
            BOT LAUNCHER
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0, lineHeight: 1.15 }}>
            JOIN LOBBY<br /><span style={{ color: G }}>WITH BOT</span>
          </h1>
          <p style={{ color: '#475569', fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
            Upload your bot ZIP to launch your agent into a live USDC game.
          </p>
        </div>

        <div style={{
          background: '#0d1520', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14, padding: 32, display: 'flex', flexDirection: 'column', gap: 20,
        }}>

          {/* ZIP upload */}
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 8 }}>
              BOT ZIP <span style={{ color: G }}>*</span>
            </label>
            <UploadZone file={zipFile} onFile={handleZipFile} />
            {zipFile && (
              <button
                onClick={clearZip}
                style={{ marginTop: 6, background: 'none', border: 'none', color: '#475569', fontSize: 11, cursor: 'pointer', padding: 0 }}
              >
                × clear
              </button>
            )}
          </div>

          {/* Parse error */}
          {parseError && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', fontSize: 13,
            }}>
              {parseError}
            </div>
          )}

          {/* Parsed preview */}
          {parsed && (
            <div style={{
              padding: '12px 16px', borderRadius: 8,
              background: `${G}08`, border: `1px solid ${G}30`,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ color: G, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>ZIP VERIFIED ✓</div>
              <div style={{ color: '#64748b', fontSize: 11, fontFamily: 'Space Mono, monospace', wordBreak: 'break-all' }}>
                {parsed.botAddress}
              </div>
              {parsed.config?.persona && (
                <div style={{ color: '#475569', fontSize: 11 }}>
                  Strategy: <span style={{ color: '#94a3b8', fontWeight: 600 }}>{parsed.config.persona}</span>
                </div>
              )}
            </div>
          )}

          {/* Password */}
          {parsed && (
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 8 }}>
                KEYSTORE PASSWORD <span style={{ color: G }}>*</span>
              </label>
              <input
                type="password"
                placeholder="Password you set when creating the bot"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && launch()}
                autoComplete="current-password"
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '11px 14px', color: '#e2e8f0', fontSize: 14,
                  outline: 'none', fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = `${G}60`}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>
          )}

          {/* Launch error */}
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#f87171', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {/* Launch button */}
          <button
            onClick={launch}
            disabled={!canLaunch}
            style={{
              padding: '14px', borderRadius: 9, border: 'none',
              background: canLaunch
                ? `linear-gradient(135deg, ${G}, #00b4d8)`
                : 'rgba(255,255,255,0.06)',
              color: canLaunch ? '#000' : '#334155',
              fontSize: 14, fontWeight: 800, letterSpacing: '0.12em',
              cursor: canLaunch ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s',
              boxShadow: canLaunch ? `0 0 24px ${G}30` : 'none',
            }}
          >
            {launching ? 'VERIFYING & LAUNCHING…' : 'JOIN LOBBY WITH BOT →'}
          </button>

          <p style={{ color: '#334155', fontSize: 11, textAlign: 'center', margin: 0 }}>
            Don't have a ZIP?{' '}
            <Link to="/bots" style={{ color: G, textDecoration: 'none', fontWeight: 700 }}>Create a bot →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
