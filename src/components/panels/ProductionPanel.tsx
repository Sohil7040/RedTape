import {
  AlertTriangle, ArrowDownToLine, CheckCircle2, Download, FastForward, FileCode2, Flame,
  Gauge, Layers3, Move, Pause, PenLine, Play, RotateCcw, RotateCw, Scissors, Sparkles,
  Upload, Wind, Zap, Wifi, WifiOff, RefreshCw, Send, ShieldCheck, ShieldAlert, HardDrive,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, EditorStore } from '../../core/store'
import {
  OPERATION_COLORS, OPERATION_LABELS, OriginCorner, ProductionMode, RDWORKS_PALETTE,
  layerOperation, MATERIAL_PRESETS,
} from '../../core/model'
import { estimateJobTime, formatDuration, getProductionJob, getSimulationStateAt } from '../../core/production'
import { buildJobDXF, buildJobJSON, buildJobPLT, buildJobRD } from '../../core/vectorIO'
import { RUIDA_HARDWARE_LIMITS, ruidaFilename } from '../../core/ruidaIO'
import { bridgeJSON, bytesToBase64, loadMachineProfile, PROFILE_KEY, TRANSFER_KEY, validProfile, prepareLaserJob } from '../../core/laserClient'
import { downloadBlob } from '../../core/exporters'
import { NumField, ProcessNumber, Section, Segmented, SelectField, Switch } from '../ui'

interface Props { state: EditorState; store: EditorStore }

const modeIcons: Record<ProductionMode, typeof Scissors> = {
  cut: Scissors,
  engrave: Flame,
  score: PenLine,
  dot: Sparkles,
  pen: PenLine,
  ignore: Move,
}

export default function ProductionPanel({ state, store }: Props) {
  const prod = state.doc.production
  const job = getProductionJob(state.doc)
  const timeEstimate = estimateJobTime(job, prod.timeAllowancePct ?? 0)
  const [sequenceLimit, setSequenceLimit] = useState(100)
  const [activeTab, setActiveTab] = useState<'machine' | 'layers' | 'sim' | 'output'>('machine')
  const [wifiIP, setWifiIP] = useState(() => loadMachineProfile().ip)
  const [wifiPort, setWifiPort] = useState(() => loadMachineProfile().port)
  const [wifiOnline, setWifiOnline] = useState<boolean | null>(null)
  const [wifiLatency, setWifiLatency] = useState<number | null>(null)
  const [wifiChecking, setWifiChecking] = useState(false)
  const [wifiSending, setWifiSending] = useState(false)
  const [uploadFilename, setUploadFilename] = useState(() => { try { return ruidaFilename(state.doc.name || 'JOB') + '.RD' } catch { return 'JOB.RD' } })
  const [uploadResult, setUploadResult] = useState<string | null>(null)

  const [writesEnabled, setWritesEnabled] = useState(false)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [transferId, setTransferId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(TRANSFER_KEY) } catch { return null }
  })
  const [pollVersion, setPollVersion] = useState(0)
  const [transferUncertain, setTransferUncertain] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const sendLock = useRef(false)
  const profileValid = validProfile({ ip: wifiIP, port: wifiPort })
  const prepared = useMemo(() => prepareLaserJob(state.doc, uploadFilename), [state.doc, uploadFilename])
  useEffect(() => {
    bridgeJSON('/api/ruida/capabilities').then(data => {
      setWritesEnabled(data.writesEnabled === true); setBridgeError(null)
    }).catch(err => setBridgeError(err.message))
  }, [])
  useEffect(() => {
    setWifiOnline(null); setWifiLatency(null)
    if (profileValid) {
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ ip: wifiIP, port: wifiPort })) } catch { /* session still works */ }
    }
  }, [wifiIP, wifiPort])
  useEffect(() => {
    if (!transferId) return
    let disposed = false, failures = 0, timer: ReturnType<typeof setTimeout>
    setWifiSending(true); setTransferUncertain(false)
    const poll = async () => {
      try {
        const transfer = await bridgeJSON(`/api/ruida/transfers/${encodeURIComponent(transferId)}`)
        if (disposed) return
        failures = 0
        setUploadPercent(Math.min(100, Math.round(transfer.bytesSent / transfer.totalBytes * 100)))
        if (transfer.state === 'uploading') { timer = setTimeout(poll, 500); return }
        if (transfer.success) {
          setUploadResult(`✓ ${transfer.filename}${transfer.fileIndex ? ` · file ${transfer.fileIndex}` : ''} ${transfer.verification === 'matched' ? 'stored and readback verified' : 'acknowledged'} on ${transfer.ip}:${transfer.port} (UDP). Job not started. On the cutter: Esc → File → select ${transfer.filename}. Reopen File if the list is stale.${transfer.warning ? ` ${transfer.warning}` : ''}`)
          store.toast(transfer.verification === 'matched' ? `Verified ${transfer.filename}. Cutter: Esc → File → select this file.` : `Download acknowledged; ${transfer.warning ?? 'reopen File on the cutter and check the stored job'}`, transfer.verification === 'matched' ? 'success' : 'warn', 8000)
          setWifiOnline(true)
        } else {
          setUploadResult(`Error: ${transfer.error}. Check the cutter before retrying; no automatic retry was sent.`)
          store.toast('Upload failed. Check transfer details before retrying.', 'warn', 6000)
        }
      } catch (err: any) {
        if (disposed) return
        failures++
        setUploadResult(`Error: ${err.message}. Transfer outcome is uncertain. Status checks never resend file data.`)
        if (failures < 3) { timer = setTimeout(poll, 1000 * failures); return }
        setWifiSending(false); setTransferUncertain(true); return
      }
      setWifiSending(false); sendLock.current = false; setTransferId(null)
      try { sessionStorage.removeItem(TRANSFER_KEY) } catch { /* optional persistence */ }
    }
    poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [transferId, pollVersion, store])

  const selected = store.getSelectedShapes()
  const sheetW = state.doc.page.width, sheetH = state.doc.page.height
  const sheetRatio = sheetW / Math.max(1e-5, sheetH)

  const simInfo = getSimulationStateAt(job, state.sim.progress, {
    x: prod.startX,
    y: prod.startY,
  })

  const pingMachine = async () => {
    if (!profileValid || wifiSending) return
    setWifiChecking(true)
    try {
      const data = await bridgeJSON(`/api/ruida/status?ip=${encodeURIComponent(wifiIP)}&port=${wifiPort}`, { method: 'POST' })
      setWifiOnline(data.online === true); setWifiLatency(data.online ? data.latencyMs : null)
      store.toast(data.online ? `UDP handshake acknowledged at ${wifiIP}:${wifiPort}` : `UDP check failed: ${data.error}`, data.online ? 'success' : 'warn')
    } catch (err: any) { setWifiOnline(false); store.toast(err.message, 'warn') }
    finally { setWifiChecking(false) }
  }

  const sendJobOverWifi = async () => {
    if (sendLock.current || wifiSending || transferId) return
    if (!writesEnabled || !profileValid || !prepared.bytes) return
    sendLock.current = true; setWifiSending(true); setUploadPercent(0); setUploadResult(null)
    const requestId = crypto.randomUUID()
    try { sessionStorage.setItem(TRANSFER_KEY, requestId) } catch { /* optional persistence */ }
    try {
      const result = await bridgeJSON(`/api/ruida/upload-to-storage?ip=${encodeURIComponent(wifiIP)}&port=${wifiPort}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: prepared.filename, fileBase64: bytesToBase64(prepared.bytes), requestId }),
      })
      if (!result.transferId) throw new Error('Bridge did not return a transfer ID')
      try { sessionStorage.setItem(TRANSFER_KEY, result.transferId) } catch { /* optional persistence */ }
      setTransferId(result.transferId)
    } catch (err: any) {
      setTransferId(requestId)
      setUploadResult(`Error: ${err.message}. No automatic retry. If the request reached the bridge, check controller storage first.`)
      store.toast('Upload could not be confirmed. See transfer details.', 'warn', 6500)
    }
  }

  const exportFile = (kind: 'rd' | 'dxf' | 'plt' | 'json') => {
    if (!job.paths.length) { store.toast('No machinable paths to export', 'warn'); return }
    const base = state.doc.name.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'laser-job'

    try {
      if (kind === 'rd') {
        if (!prepared.bytes) throw new Error(prepared.error ?? 'Invalid job')
        const bytes = prepared.bytes
        downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }), prepared.filename)
        store.toast('Ruida DSP Machine Code (.rd) exported', 'success')
      } else if (kind === 'dxf') {
        downloadBlob(new Blob([buildJobDXF(state.doc)], { type: 'application/dxf' }), `${base}.dxf`)
        store.toast('DXF R12 job exported', 'success')
      } else if (kind === 'plt') {
        downloadBlob(new Blob([buildJobPLT(state.doc)], { type: 'application/octet-stream' }), `${base}.plt`)
        store.toast('PLT / HPGL job exported', 'success')
      } else {
        downloadBlob(new Blob([buildJobJSON(state.doc)], { type: 'application/json' }), `${base}.laser-job.json`)
        store.toast('Laser Job JSON package exported', 'success')
      }
    } catch (err: any) { store.toast(`Export blocked: ${err.message}`, 'warn', 7000) }
  }

  const toggleSimulation = () => {
    if (!prod.preview) store.setProductionPreview(true)
    if (state.sim.playing) {
      store.setSimulation({ playing: false })
    } else {
      if (state.sim.progress >= 1) {
        store.setSimulation({ progress: 0, playing: true })
      } else {
        store.setSimulation({ playing: true })
      }
    }
  }

  const resetSimulation = () => {
    store.setSimulation({ playing: false, progress: 0, headPos: null, laserOn: false })
  }

  const onScrub = (v: number) => {
    if (!prod.preview) store.setProductionPreview(true)
    const nextP = Math.max(0, Math.min(1, v))
    const cur = getSimulationStateAt(job, nextP, { x: prod.startX, y: prod.startY })
    store.setSimulation({ progress: nextP, headPos: cur.headPos, laserOn: cur.laserOn })
  }

  const currentOrigin = prod.originCorner || 'top-right'

  return (
    <div className="inspector-stack production-panel">
      <nav className="laser-workflow" aria-label="Laser workflow">
        <button type="button" onClick={() => { store.setTool('select'); store.setProductionPreview(false); store.setRightTab('design') }}>1 Design</button>
        <button type="button" aria-current={activeTab === 'layers' ? 'step' : undefined} onClick={() => setActiveTab('layers')}>2 Prepare</button>
        <button type="button" aria-current={activeTab === 'sim' ? 'step' : undefined} onClick={() => { setActiveTab('sim'); store.setProductionPreview(true) }}>3 Preview</button>
        <button type="button" aria-current={activeTab === 'machine' ? 'step' : undefined} onClick={() => setActiveTab('machine')}>4 Send</button>
        <span role="status">{prepared.error ? 'Needs attention' : 'Export ready'} · {timeEstimate.available ? formatDuration(timeEstimate.estimatedSeconds) : 'Time unavailable'}</span>
      </nav>
      {/* RDWorks / Laser Hero Header */}
      <div className={`prod-hero ${prod.preview ? 'on' : ''}`}>
        <div className="prod-hero-top">
          <span className="eyebrow">RUIDA DSP / RDWORKS CAM</span>
          <span className={`job-state ${prod.preview ? 'live' : ''}`}><i />{prod.preview ? 'PREVIEWING' : 'STANDBY'}</span>
        </div>
        <h2>Laser Production</h2>
        <p>Ruida controller toolpaths, inside-out sequencing, 16-color layer parameters, and live simulation.</p>

        <div className="prod-hero-actions">
          <button className={`prod-preview-btn ${prod.preview ? 'on' : ''}`} onClick={() => store.setProductionPreview(!prod.preview)}>
            <Zap size={14} />{prod.preview ? 'Exit preview' : 'Preview toolpaths'}
          </button>
          <button className="prod-import-mini" onClick={() => document.getElementById('job-import')?.click()} title="Import SVG, DXF, RLD, RD, PLT, image or PDF">
            <Upload size={14} />
          </button>
        </div>

        <div className="prod-mode-legend">
          {(['cut', 'engrave', 'score', 'dot', 'pen'] as ProductionMode[]).map(m => (
            <span key={m}><i style={{ background: OPERATION_COLORS[m] }} />{OPERATION_LABELS[m]}</span>
          ))}
        </div>
      </div>

      {/* Production Telemetrics */}
      <div className="prod-stat-grid">
        <div><span>TOOLPATHS</span><strong>{job.paths.length}</strong><em>{job.contourCount} contours</em></div>
        <div><span>PATH LENGTH</span><strong>{(job.totalLength / 1000).toFixed(2)}<small> m</small></strong><em>{job.hatchCount} hatches</em></div>
        <div><span>JOB ESTIMATE</span><strong>{timeEstimate.available ? formatDuration(timeEstimate.estimatedSeconds) : "—"}</strong><em>includes travel{timeEstimate.allowancePct ? ` + ${timeEstimate.allowancePct}% allowance` : " · theoretical"}</em></div>
        <div><span>OBJECTS</span><strong>{job.objectCount}</strong><em>{prepared.error ? 'needs attention' : job.warnings.length ? `${job.warnings.length} warnings` : 'ready'}</em></div>
      </div>

      <section className="laser-time-card" aria-label="Estimated job time">
        <div className="laser-time-head">
          <div><span className="eyebrow">ESTIMATED JOB TIME</span><strong aria-live="polite">{timeEstimate.available ? formatDuration(timeEstimate.estimatedSeconds) : 'Unavailable'}</strong></div>
          <span className="laser-estimate-badge">{timeEstimate.allowancePct ? `+${timeEstimate.allowancePct}% allowance` : 'Theoretical'}</span>
        </div>
        <p>Includes all passes, leads and travel. Actual time depends on acceleration, corners and controller delays.</p>
        {!timeEstimate.available && <p className="job-warning">Add machinable paths and resolve incomplete-job errors to estimate the design.</p>}
        {prepared.error && timeEstimate.available && <p className="job-warning">Timing covers the generated paths; export is currently blocked by preflight.</p>}
        <details className="laser-time-details">
          <summary>Time breakdown &amp; allowance</summary>
          <dl className="laser-time-breakdown">
            {timeEstimate.byOperation.map(item => <div key={item.mode}><dt>{item.mode === 'cut' ? 'Cutting' : item.mode === 'engrave' ? 'Engraving' : item.mode === 'score' ? 'Scoring' : OPERATION_LABELS[item.mode]}</dt><dd>{formatDuration(item.seconds)}</dd></div>)}
            <div><dt>Travel, laser off</dt><dd>{formatDuration(timeEstimate.travelSeconds)}</dd></div>
            <div><dt>Theoretical total</dt><dd>{formatDuration(timeEstimate.baselineSeconds)}</dd></div>
            <div><dt>Extra allowance</dt><dd>{formatDuration(timeEstimate.allowanceSeconds)}</dd></div>
          </dl>
          <NumField label="Time allowance" value={prod.timeAllowancePct ?? 0} onChange={v => store.setProduction({ timeAllowancePct: v })} min={0} max={300} precision={0} suffix="%" />
          <small>Set an allowance using your measured jobs. This changes the estimate only; machine settings stay the same.</small>
          {!!timeEstimate.byLayer.length && <div className="laser-layer-times" role="table" aria-label="Estimated active time by layer">
            <div role="row"><strong role="columnheader">Layer / operation</strong><strong role="columnheader">Active time</strong></div>
            {timeEstimate.byLayer.map(layer => <div role="row" key={layer.layerId}><span role="cell">{layer.name}<small>{layer.operation} · {layer.speed} mm/s · {layer.passes} pass{layer.passes === 1 ? '' : 'es'}</small></span><span role="cell">{formatDuration(layer.seconds)}</span></div>)}
          </div>}
          <small>Layer times exclude travel; the total above includes it. Simulation uses theoretical motion timing.</small>
        </details>
        <div className="laser-order-note">
          <strong>Engrave → Score → Cut</strong>
          <span>{prod.insideOut ? 'Inner closed cuts before outer cuts.' : 'Inner-first cutting is off.'}</span>
          <button type="button" className="link-btn" onClick={() => setActiveTab('layers')}>Edit layer speed &amp; power</button>
        </div>
      </section>

      {/* Mode Sub-navigation */}
      <div className="prod-subnav">
        <button className={activeTab === 'machine' ? 'active' : ''} onClick={() => setActiveTab('machine')}>Machine</button>
        <button className={activeTab === 'layers' ? 'active' : ''} onClick={() => setActiveTab('layers')}>Layers ({state.doc.layers.length})</button>
        <button className={activeTab === 'sim' ? 'active' : ''} onClick={() => setActiveTab('sim')}>Simulate</button>
        <button className={activeTab === 'output' ? 'active' : ''} onClick={() => setActiveTab('output')}>Export</button>
      </div>

      {activeTab === 'machine' && (
        <>
          {/* Wi-Fi Laser Machine & Controller Hardware Link */}
          <Section
            title="Wi-Fi Laser Machine Link"
            action={
              <span className={`wifi-status-badge ${wifiOnline ? 'online' : 'offline'}`}>
                {wifiOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                {wifiOnline === null ? 'UNCHECKED' : wifiOnline ? 'UDP READY' : 'NO ACK'}
              </span>
            }
          >
            <div className="wifi-machine-card">
              <div className="wifi-status-row">
                <div className="wifi-info">
                  <div className="wifi-title-line">
                    <span className={`wifi-led ${wifiOnline ? 'on' : ''}`} />
                    <strong>EVA II 43 · Ruida UDP</strong>
                  </div>
                  <div className="wifi-sub-line">
                    <input
                      className="wifi-ip-input"
                      value={wifiIP}
                      onChange={e => setWifiIP(e.target.value.trim())}
                      title="Controller IP address" aria-label="Controller IP address" disabled={wifiSending || wifiChecking}
                    />
                    <span>UDP</span><input className="wifi-port-input" type="number" min={1} max={65535} aria-label="UDP port" value={wifiPort} disabled={wifiSending || wifiChecking} onChange={e => setWifiPort(Number(e.target.value))} />
                    {wifiLatency !== null && <span className="wifi-latency">· {wifiLatency}ms</span>}
                  </div>
                </div>
                <button
                  type="button"
                  className="wifi-ping-btn"
                  onClick={pingMachine}
                  disabled={wifiChecking || wifiSending || !profileValid}
                  title="Send a non-motion UDP handshake to verify the upload interface"
                >
                  <RefreshCw size={12} className={wifiChecking ? 'spin' : ''} />
                  <span>Verify</span>
                </button>
              </div>

              <button type="button" className="link-btn" disabled={wifiSending || wifiChecking} onClick={() => { setWifiIP(RUIDA_HARDWARE_LIMITS.defaultDeviceIP); setWifiPort(RUIDA_HARDWARE_LIMITS.ruidaPort) }}>Use verified EVA connection · UDP 50201</button>

              {/* Saved machine profile */}
              <div className="hardware-audit-box">
                <div className="audit-header">
                  <ShieldCheck size={13} className="audit-icon" />
                  <span>Saved EVA II 43 machine profile</span>
                </div>
                <div className="audit-specs-grid">
                  <div><span>Bed Dimensions:</span><strong>{RUIDA_HARDWARE_LIMITS.bedWidth} × {RUIDA_HARDWARE_LIMITS.bedHeight} mm</strong></div>
                  <div><span>Machine Origin:</span><strong>Top-Right (Origin 2)</strong></div>
                  <div><span>Max Rapid Vel:</span><strong>{RUIDA_HARDWARE_LIMITS.maxRapidSpeed} mm/s</strong></div>
                  <div><span>Export Power Limit:</span><strong>{RUIDA_HARDWARE_LIMITS.maxPowerPct}% cap</strong></div>
                </div>
              </div>

              {/* Safe Wi-Fi Machine Storage Transfer (Memory Download Only) */}
              <div className="wifi-storage-box">
                <div className="storage-header">
                  <HardDrive size={13} className="storage-icon" />
                  <span>Send File to Laser Storage (Wi-Fi)</span>
                </div>
                <div className="storage-desc">
                  {bridgeError ?? (writesEnabled ? 'Storage uploads enabled. Uploading never starts a job; start it from the cutter panel.' : 'Read-only bridge: run npm run laser, or npm run laser:preview after a build, to enable storage uploads.')}
                </div>
                <p className="storage-desc">The LCD may keep its current file or an old list after upload. Press Esc, reopen File, then select the uploaded filename to load its preview.</p>
                <div className="storage-input-row">
                  <span className="mini-label">FILE NAME</span>
                  <input
                    className="storage-file-input"
                    value={uploadFilename}
                    disabled={wifiSending}
                    aria-label="Laser file name"
                    onChange={e => setUploadFilename(e.target.value.toUpperCase())}
                    placeholder="DEFAULT.RD"
                  />
                </div>
                <button
                  type="button"
                  className="wifi-send-storage-btn"
                  onClick={sendJobOverWifi}
                  disabled={!writesEnabled || !!transferId || wifiSending || wifiChecking || !profileValid || !prepared.bytes}
                  title="Upload .rd file directly to Ruida internal storage"
                >
                  <Send size={13} className={wifiSending ? 'spin' : ''} />
                  <span>{!writesEnabled ? 'Read-only — Upload Disabled' : wifiSending ? (uploadPercent >= 100 ? 'Verifying stored file…' : `Uploading… ${uploadPercent}%`) : 'Send to Laser Storage'}</span>
                </button>
                <div className="laser-preflight" aria-live="polite">
                  {!profileValid && <p className="job-warning">Enter a valid IPv4 address and UDP port.</p>}
                  {prepared.error ? <p className="job-warning">Export blocked: {prepared.error}</p> : <p>{prepared.filename} · {(prepared.bytes!.length / 1024).toFixed(1)} KB · {job.bounds.w.toFixed(1)} × {job.bounds.h.toFixed(1)} mm · {job.paths.length} paths</p>}
                  {prepared.error?.includes('minimum laser power') && <button type="button" className="safe-export-btn" onClick={() => setActiveTab('layers')}>Review layer minimum / maximum power</button>}
                  {job.errors.some(e => e.includes('text object')) && <button type="button" className="safe-export-btn" onClick={() => void store.convertTextToCurves('job')}>Convert job text to curves</button>}
                  <small>Job-local placement · origin {currentOrigin}. Check the material settings and position before starting at the cutter.</small>
                  {wifiSending && <progress value={uploadPercent} max={100} aria-label="Upload progress" />}
                </div>
                {transferUncertain && <div className="laser-preflight">
                  <button type="button" className="link-btn" onClick={() => setPollVersion(v => v + 1)}>Check transfer status again</button>
                  <p>Uploading is paused until this transfer is resolved. If the bridge restarted, inspect the cutter before clearing this status.</p>
                  <button type="button" className="link-btn" onClick={() => { setTransferId(null); setTransferUncertain(false); sendLock.current = false; try { sessionStorage.removeItem(TRANSFER_KEY) } catch {} }}>I checked the cutter — clear unresolved transfer</button>
                </div>}
                {uploadResult && (
                  <div className={`storage-result-badge ${uploadResult.startsWith('✓') ? 'success' : 'error'}`}>
                    {uploadResult}
                  </div>
                )}
              </div>

              {/* Direct Command Safety Lock Notice - strictly no direct writing */}
              <div className="safety-locked-notice">
                <ShieldAlert size={14} className="lock-icon" />
                <div className="lock-text">
                  <strong>Direct Motion Commands: LOCKED (Safety Mode)</strong>
                  <span>Direct physical motion commands disabled for machine protection. Controller storage writes require explicit opt-in; offline export is active.</span>
                </div>
              </div>

              {/* Safe Export Options */}
              <div className="safe-export-row">
                <button
                  type="button"
                  className="safe-export-btn primary"
                  onClick={() => exportFile('rd')}
                  disabled={!!prepared.error}
                  title="Export Ruida DSP bytecode (.rd) for U-Disk or RDWorks"
                >
                  <Download size={13} />
                  <span>Export .rd File</span>
                </button>
                <button
                  type="button"
                  className="safe-export-btn"
                  onClick={() => exportFile('dxf')}
                  disabled={!job.paths.length}
                  title="Export DXF for import into RDWorks"
                >
                  <Download size={13} />
                  <span>Export RDWorks DXF</span>
                </button>
              </div>
            </div>
          </Section>

          {/* Ruida Machine & Origin Setup */}
          <Section title="Ruida Controller & Origin" action={<span className="section-hint">DSP SETUP</span>}>
            <div className="field-row">
              <span>Machine Zero Corner</span>
              <div className="origin-corner-picker">
                {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as OriginCorner[]).map(corner => (
                  <button
                    key={corner}
                    className={`corner-btn ${currentOrigin === corner ? 'selected' : ''}`}
                    onClick={() => store.setProduction({ originCorner: corner })}
                    title={`Ruida Origin: ${corner}`}
                  >
                    {corner === 'top-left' && '↖ TL'}
                    {corner === 'top-right' && '↗ TR (Ruida)'}
                    {corner === 'bottom-left' && '↙ BL'}
                    {corner === 'bottom-right' && '↘ BR'}
                  </button>
                ))}
              </div>
            </div>

            <div className="num-grid two">
              <NumField label="Rapid Speed" value={prod.rapidSpeed || 300} onChange={v => store.setProduction({ rapidSpeed: Math.max(20, v) })} suffix="mm/s" />
              <NumField label="Kerf" value={prod.kerf} onChange={v => store.setProduction({ kerf: Math.max(0, v) })} min={0} precision={2} suffix="mm" />
            </div>

            <div className="field-row">
              <span>Kerf Side</span>
              <Segmented compact value={prod.kerfMode} onChange={v => store.setProduction({ kerfMode: v })} options={[{ value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }, { value: 'inside', label: 'Inside' }]} />
            </div>

            <div className="field-row">
              <span>Cut entry</span>
              <SelectField ariaLabel="Cut entry mode" value={prod.leadMode ?? 'contour-only'} onChange={v => store.setProduction({ leadMode: v })} options={[
                { value: 'contour-only', label: 'Contour only (no leads)' },
                { value: 'outer-only', label: 'Leads on outer outlines only' },
                { value: 'all', label: 'Leads on all closed contours' },
              ]} />
            </div>
            <small>{(prod.leadMode ?? 'contour-only') === 'contour-only' ? 'Starts and finishes on the design. Saved lead lengths are ignored; travel to the design is laser-off.' : prod.leadMode === 'outer-only' ? 'Internal cuts start on the contour; lead lengths apply only to outer outlines.' : 'Advanced: lead lengths also apply to internal contours and may leave entry marks.'}</small>
            {(prod.leadMode ?? 'contour-only') !== 'contour-only' && <div className="num-grid two">
              <NumField label="Lead-In" value={prod.leadIn} onChange={v => store.setProduction({ leadIn: Math.max(0, v) })} min={0} precision={1} suffix="mm" />
              <NumField label="Lead-Out" value={prod.leadOut} onChange={v => store.setProduction({ leadOut: Math.max(0, v) })} min={0} precision={1} suffix="mm" />
            </div>}

            <div className="num-grid two">
              <NumField label="Overcut (Seal)" value={prod.overcut || 0} onChange={v => store.setProduction({ overcut: Math.max(0, v) })} min={0} precision={1} suffix="mm" />
              <NumField label="Default Scan Pitch" value={prod.hatchSpacing} onChange={v => store.setProduction({ hatchSpacing: Math.max(0.04, v) })} min={0.04} precision={2} suffix="mm" />
            </div>

            <div className="switch-stack">
              <div className="field-row">
                <span>Inside-to-Outside (Cut inner holes first)</span>
                <Switch checked={prod.insideOut} onChange={v => store.setProduction({ insideOut: v })} />
              </div>
              <div className="field-row">
                <span>Optimize Rapid Travel</span>
                <Switch checked={prod.optimizeOrder} onChange={v => store.setProduction({ optimizeOrder: v })} />
              </div>
              <div className="field-row">
                <span>Scan Hatch Fills</span>
                <Switch checked={prod.hatchEngrave} onChange={v => store.setProduction({ hatchEngrave: v })} />
              </div>
              <div className="field-row">
                <span>Show Order Badges</span>
                <Switch checked={prod.showSequence} onChange={v => store.setProduction({ showSequence: v })} />
              </div>
            </div>
          </Section>

          {/* Sheet & Nesting */}
          <Section title="Sheet & Nesting" action={<span className="section-hint">{sheetW} × {sheetH} mm</span>}>
            <div className="sheet-diagram">
              <div className="sheet-paper" style={{ aspectRatio: `${sheetRatio}` }}>
                <div className="sheet-safe" style={{ inset: `${Math.min(38, (prod.margin / Math.max(sheetW, sheetH)) * 100)}%` }} />
                <span className="sheet-dim w">{sheetW} mm</span>
                <span className="sheet-dim h">{sheetH} mm</span>
                <span className="sheet-corner tl" /><span className="sheet-corner tr" /><span className="sheet-corner bl" /><span className="sheet-corner br" />
              </div>
              <div className="sheet-meta">
                <span className="eyebrow">WORK BED</span>
                <strong>{state.doc.page.name}</strong>
                <span>{prod.margin} mm margin · {prod.spacing} mm gap</span>
              </div>
            </div>
            <div className="num-grid two">
              <NumField label="Margin" value={prod.margin} onChange={v => store.setProduction({ margin: Math.max(0, v) })} min={0} suffix="mm" />
              <NumField label="Spacing" value={prod.spacing} onChange={v => store.setProduction({ spacing: Math.max(0, v) })} min={0} suffix="mm" />
            </div>
            <div className="field-row"><span>Allow 90° Rotation</span><Switch checked={prod.allowRotate} onChange={v => store.setProduction({ allowRotate: v })} /></div>
            <button className="apply-btn nest-btn" onClick={() => store.nestProduction(selected.length ? 'selection' : 'all')}>
              <RotateCw size={15} /><span>{selected.length ? `Nest ${selected.length} selected` : 'Nest all job objects'}</span><kbd>SHELF</kbd>
            </button>
          </Section>
        </>
      )}

      {activeTab === 'layers' && (
        <Section title="RDWorks 16-Color Layer Map" action={<span className="section-hint">{state.doc.layers.length} LAYERS</span>}>
          <div className="operation-list">
            {state.doc.layers.map((layer, idx) => {
              const op = layerOperation(prod, layer.id)
              const Icon = modeIcons[op.mode]
              const layerStats = job.byLayer.find(s => s.layerId === layer.id)
              const colorIdx = RDWORKS_PALETTE.findIndex(c => c.toLowerCase() === layer.color.toLowerCase())
              const rdColor = layer.color

              return (
                <div className={`operation-card ${op.mode === 'ignore' ? 'muted' : ''}`} key={layer.id}>
                  <div className="op-head">
                    {/* RDWorks 16 Color Palette Swatch */}
                    <div className="rd-color-picker" title="RDWorks Layer Color">
                      <select
                        value={colorIdx}
                        onChange={e => store.setLayerColor(layer.id, RDWORKS_PALETTE[Number(e.target.value)])}
                        style={{ background: rdColor }}
                        aria-label={`Palette colour for ${layer.name}`}
                      >
                        {colorIdx < 0 && <option value={-1}>Custom ({layer.color})</option>}
                        {RDWORKS_PALETTE.map((c, ci) => (
                          <option key={ci} value={ci} style={{ background: c, color: ci === 0 || ci === 12 || ci === 13 || ci === 15 ? '#fff' : '#000' }}>
                            Layer {ci} ({c})
                          </option>
                        ))}
                      </select>
                    </div>

                    <input
                      className="op-name-input"
                      value={layer.name}
                      onChange={e => store.setLayerName(layer.id, e.target.value)}
                      title="Click to rename layer"
                    />
                    <button type="button" className="op-paths" title={`Select visible artwork in ${layer.name}`} onClick={() => { store.setSelection(layer.visible && !layer.locked ? layer.shapes.filter(s => !s.hidden && !s.locked).map(s => s.id) : []); store.setProductionPreview(true) }}>{layerStats?.paths ?? 0} paths · {formatDuration(layerStats?.time ?? 0)}</button>
                    <select
                      className="op-select"
                      value={op.mode}
                      onChange={e => store.setLayerMode(layer.id, e.target.value as ProductionMode)}
                      title="Layer operation"
                    >
                      <option value="cut">Cut</option>
                      <option value="engrave">Scan (Engrave)</option>
                      <option value="score">Score</option>
                      <option value="dot">Dot (Perforate)</option>
                      <option value="pen">Pen (Mark)</option>
                      <option value="ignore">Ignore</option>
                    </select>
                  </div>

                  <div className={`op-preset-row ${op.mode === 'ignore' ? 'hidden' : ''}`}>
                    <select
                      className="layer-preset-dropdown"
                      onChange={e => {
                        if (e.target.value) {
                          store.applyMaterialPreset(layer.id, e.target.value)
                          e.target.value = ''
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>⚡ Apply Material Preset…</option>
                      {MATERIAL_PRESETS.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.speed} mm/s · {m.power}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={`op-metrics ${op.mode === 'ignore' ? 'hidden' : ''}`}>
                    <label><span><Gauge size={9} />SPEED</span><input type="number" value={op.speed} step={1} onChange={e => store.setLayerOperation(layer.id, { speed: Math.max(1, Number(e.target.value)) })} /><em>mm/s</em></label>
                    <label><span><Zap size={9} />MAX PWR</span><ProcessNumber value={op.maxPower ?? op.power} min={0} max={RUIDA_HARDWARE_LIMITS.maxPowerPct} onChange={v => store.setLayerOperation(layer.id, { maxPower: v })} /><em>%</em></label>
                    <label><span><Zap size={9} />MIN PWR</span><ProcessNumber value={op.minPower ?? op.maxPower ?? op.power} min={0} max={op.maxPower ?? op.power} onChange={v => store.setLayerOperation(layer.id, { minPower: v })} /><em>%</em></label>
                    <label><span>PASSES</span><input type="number" value={op.passes || 1} min={1} max={10} onChange={e => store.setLayerOperation(layer.id, { passes: Math.max(1, Number(e.target.value)) })} /></label>
                  </div>
                  {(op.minPower ?? 0) > (op.maxPower ?? op.power) && <div className="job-warning">
                    <span>Minimum {op.minPower}% is above maximum {op.maxPower ?? op.power}%.</span>
                    <button type="button" className="link-btn" onClick={() => store.setLayerOperation(layer.id, { minPower: op.maxPower ?? op.power })}>Reduce minimum to {op.maxPower ?? op.power}%</button>
                  </div>}
                  {layer.shapes.some(s => s.textInfill?.enabled) && <small>Text infill engraves on this layer using the speed, power and passes above; other shapes keep their layer operation.</small>}
                  {op.mode === 'score' && <div className="laser-preflight">
                    <small>Score uses vector cutting motion. Match RDWorks speed, minimum power, maximum power and passes; maximum power alone is not the full setting. Power edits apply on Enter or leaving the field.</small>
                    <button type="button" className="link-btn" onClick={() => store.setLayerOperation(layer.id, { minPower: op.maxPower ?? op.power })}>Set minimum = maximum ({op.maxPower ?? op.power}%)</button>
                  </div>}

                  {op.mode !== 'ignore' && (
                    <div className="op-extra-row">
                      <button
                        className={`air-btn ${op.blower !== false ? 'on' : ''}`}
                        onClick={() => store.setLayerOperation(layer.id, { blower: op.blower === false ? true : false })}
                        title="Air Assist Solenoid"
                      >
                        <Wind size={11} /> {op.blower !== false ? 'Air ON' : 'Air OFF'}
                      </button>

                      {op.mode === 'engrave' && (
                        <div className="scan-options">
                          <select
                            value={op.scanMode || 'X-swing'}
                            onChange={e => store.setLayerOperation(layer.id, { scanMode: e.target.value as any })}
                          >
                            <option value="X-swing">X-Swing (Bidirectional)</option>
                            <option value="X-unilateral">X-Unilateral</option>
                            <option value="Y-swing">Y-Swing</option>
                            <option value="Y-unilateral">Y-Unilateral</option>
                          </select>
                          <input
                            type="number"
                            step={0.01}
                            min={0.02}
                            max={1.0}
                            value={op.scanInterval || 0.08}
                            onChange={e => store.setLayerOperation(layer.id, { scanInterval: Math.max(0.02, Number(e.target.value)) })}
                            title="Scan Line Pitch (mm)"
                          />
                          <em>mm</em>
                        </div>
                      )}

                      {op.mode === 'dot' && (
                        <div className="dot-options">
                          <label>Time: <input type="number" value={op.dotTime || 15} onChange={e => store.setLayerOperation(layer.id, { dotTime: Number(e.target.value) })} />ms</label>
                          <label>Pitch: <input type="number" value={op.dotInterval || 2} onChange={e => store.setLayerOperation(layer.id, { dotInterval: Number(e.target.value) })} />mm</label>
                        </div>
                      )}

                      {op.mode === 'cut' && (
                        <div className="tab-options">
                          <label className="tab-check">
                            <input
                              type="checkbox"
                              checked={!!op.microLink}
                              onChange={e => store.setLayerOperation(layer.id, { microLink: e.target.checked })}
                            />
                            <span>Micro-Tabs</span>
                          </label>
                          {op.microLink && (
                            <input
                              type="number"
                              step={0.1}
                              min={0.2}
                              max={5}
                              value={op.microLinkWidth || 0.8}
                              onChange={e => store.setLayerOperation(layer.id, { microLinkWidth: Number(e.target.value) })}
                              title="Tab width (mm)"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <span className="op-glyph" style={{ color: rdColor }}><Icon size={12} /></span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {activeTab === 'sim' && (
        <section className="laser-time-card" aria-label="Execution sequence">
          <strong>Execution sequence</strong>
          <p>Engrave → Score → Cut. {prod.insideOut ? 'Nested closed cuts run inner-first.' : 'Inside-to-Outside is off.'} Each entry runs all of its passes before the next entry.</p>
          <p>Solid lines: laser paths. Dashed lines: travel with laser off. Selected artwork is highlighted.</p>
          <details>
            <summary>{job.paths.length} ordered toolpaths</summary>
            <ol className="laser-sequence-list">
              {job.paths.slice(0, sequenceLimit).map(path => <li key={path.id}>
                <button type="button" onClick={() => store.setSelection([path.shapeId])} aria-pressed={state.selection.includes(path.shapeId)}>
                  <strong>{path.order}. {path.shapeName}</strong><span>{path.layerName} · {OPERATION_LABELS[path.operation]} · {path.passes} pass{path.passes === 1 ? '' : 'es'} · {formatDuration(path.time)}</span>
                </button>
              </li>)}
            </ol>
            {job.paths.length > sequenceLimit && <button type="button" className="link-btn" onClick={() => setSequenceLimit(v => v + 100)}>Show next 100</button>}
          </details>
        </section>
      )}
      {activeTab === 'sim' && (
        <Section title="Toolpath Simulation (Theoretical)" action={<span className="section-hint">HEAD TRAIL</span>}>
          <div className="sim-player-card">
            <div className="sim-head-status">
              <span className={`sim-indicator ${simInfo.laserOn ? 'firing' : 'idle'}`}>
                <i /> {simInfo.laserOn ? 'LASER FIRING' : 'RAPID G0 TRAVERSE'}
              </span>
              <span className="sim-air-badge">{simInfo.blower ? 'AIR ASSIST: ON' : 'AIR: OFF'}</span>
            </div>

            <div className="sim-coords">
              <div><span>HEAD X</span><strong>{simInfo.headPos.x.toFixed(2)}<small> mm</small></strong></div>
              <div><span>HEAD Y</span><strong>{simInfo.headPos.y.toFixed(2)}<small> mm</small></strong></div>
              <div><span>SPEED</span><strong>{simInfo.currentSpeed}<small> mm/s</small></strong></div>
              <div><span>POWER</span><strong>{simInfo.currentPower}<small> %</small></strong></div>
            </div>

            {/* Scrub Slider */}
            <div className="sim-scrubber">
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={state.sim.progress}
                onChange={e => onScrub(Number(e.target.value))}
              />
              <div className="sim-time-row">
                <span>{formatDuration(job.totalTime * state.sim.progress)}</span>
                <span>{formatDuration(job.totalTime)}</span>
              </div>
            </div>

            {/* Simulation Controls */}
            <div className="sim-controls">
              <button className="sim-btn play" onClick={toggleSimulation}>
                {state.sim.playing ? <Pause size={15} /> : <Play size={15} />}
                <span>{state.sim.playing ? 'Pause' : 'Play Head'}</span>
              </button>
              <button className="sim-btn reset" onClick={resetSimulation} title="Reset to Origin">
                <RotateCcw size={14} />
              </button>

              <div className="sim-speed-pills">
                {[1, 2, 5, 10, 20].map(s => (
                  <button
                    key={s}
                    className={`speed-pill ${state.sim.speed === s ? 'active' : ''}`}
                    onClick={() => store.setSimulation({ speed: s })}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {activeTab === 'output' && (
        <>
          <Section title="Export Shop & Machine Files" action={<span className="section-hint">RUIDA / SHOP</span>}>
            <div className="output-grid-extended">
              <button className="export-chip primary" onClick={() => exportFile('rd')}>
                <Zap size={15} />
                <div className="chip-text">
                  <strong>Ruida .RD</strong>
                  <small>Controller Bytecode</small>
                </div>
              </button>

              <button className="export-chip" disabled title="Native RLD serialization is not implemented; use DXF in RDWorks">
                <FileCode2 size={15} />
                <div className="chip-text">
                  <strong>RDWorks .RLD</strong>
                  <small>Unavailable — use DXF</small>
                </div>
              </button>

              <button className="export-chip" onClick={() => exportFile('dxf')}>
                <FileCode2 size={14} />
                <div className="chip-text">
                  <strong>DXF</strong>
                  <small>AutoCAD R12</small>
                </div>
              </button>

              <button className="export-chip" onClick={() => exportFile('plt')}>
                <Download size={14} />
                <div className="chip-text">
                  <strong>PLT / HPGL</strong>
                  <small>Vector Plotter</small>
                </div>
              </button>

              <button className="export-chip" onClick={() => exportFile('json')}>
                <ArrowDownToLine size={14} />
                <div className="chip-text">
                  <strong>Job JSON</strong>
                  <small>Handoff Package</small>
                </div>
              </button>
            </div>

            <button className="wide-ghost" onClick={() => document.getElementById('job-import')?.click()}>
              <Upload size={13} />Import vectors / image / PDF
            </button>
            <div className="export-note">
              <CheckCircle2 size={12} />
              <span>Ruida .rd exports compiled binary bytecode matching RDC6442/6445 DSP protocol.</span>
            </div>
          </Section>
        </>
      )}

      <Section title="Job checks" action={<button className="link-btn" onClick={() => { setActiveTab('sim'); store.setProductionPreview(true) }}>View sequence</button>}>
        {[...job.errors, ...job.warnings].map((w, i) => (
          <div className="job-warning" key={i}><AlertTriangle size={13} /><span>{w}</span></div>
        ))}

      </Section>

      <div className="inspector-foot">
        <span>{prepared.error ? 'JOB BLOCKED' : prod.preview ? 'PREVIEW ACTIVE' : 'JOB READY'}</span>
        <span>{job.paths.length} PATHS</span>
      </div>
    </div>
  )
}
