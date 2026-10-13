/**
 * LeopardWatch — professional React interface for the FastAPI backend.
 *
 * This UI never invents detections:
 * - /api/videos/inspect returns real OpenCV video metadata, no AI inference.
 * - /api/videos/process needs a custom leopard best.pt to start a job.
 * - /api/jobs/{id} supplies real progress and final statistics.
 *
 * Run: npm install && npm run dev
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, Check, CheckCircle2,
  ChevronDown, CircleAlert, Clock3, CloudUpload, Cpu, FileJson,
  FileVideo, Film, FolderOpen, Gauge, HardDrive, HelpCircle, Info,
  Layers3, Leaf, Menu, MonitorPlay, Pause, Play, Radar,
  RefreshCw, ScanSearch, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Video, X,
} from 'lucide-react';

const API_BASE = ''; // Vite proxies /api to FastAPI; session cookies stay same-origin.
const MAX_FILE_SIZE = 250 * 1024 * 1024;
const ALLOWED = ['.mp4', '.mov', '.avi', '.mkv'];

function formatDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const seconds = Math.floor(Number(value));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatPercent(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}
function formatNumber(value) {
  return value == null ? '—' : Number(value).toLocaleString();
}
async function apiRequest(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch (_) {
    throw new Error('Cannot reach FastAPI. Start your backend at http://127.0.0.1:8000 and try again.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = typeof payload.detail === 'string' ? payload.detail : `Request failed (HTTP ${response.status}).`;
    throw new Error(reason);
  }
  return payload;
}

async function downloadFile(path, filename) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
  const blob = await response.blob();
  const localUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = localUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
}

function StatusDot({ active = false, warn = false }) {
  return <span className={`status-dot ${active ? 'active' : warn ? 'warn' : ''}`} aria-hidden="true" />;
}

function PanelTitle({ eyebrow, title, action }) {
  return <div className="panel-header">
    <div><p className="eyebrow muted">{eyebrow}</p><h2>{title}</h2></div>
    {action}
  </div>;
}

function App({ user, onLogout }) {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [inspection, setInspection] = useState(null);
  const [job, setJob] = useState(null);
  const [mode, setMode] = useState('original');
  const [isDragging, setIsDragging] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confidence, setConfidence] = useState(0.45);
  const [frameStride, setFrameStride] = useState(2);
  const [showSettings, setShowSettings] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [pendingSeek, setPendingSeek] = useState(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);

  const refreshHealth = useCallback(async () => {
    try {
      const value = await apiRequest('/api/health');
      setHealth(value);
      setHealthError('');
    } catch (err) {
      setHealth(null);
      setHealthError(err.message);
    }
  }, []);

  // Periodically re-check backend/model availability. No backend modifications needed.
  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, 12000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  // Dispose each temporary browser video URL when a different file is selected.
  useEffect(() => {
    if (!selectedFile) {
      setOriginalUrl('');
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  // The backend queues one worker and exposes state through GET /api/jobs/{id}.
  useEffect(() => {
    if (!job?.job_id || !['queued', 'processing'].includes(job.status)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await apiRequest(`/api/jobs/${job.job_id}`);
        if (cancelled) return;
        setJob(latest);
        if (latest.status === 'failed') setError(latest.error || 'Video analysis failed.');
        if (latest.status === 'completed') {
          setMode('annotated');
          setMessage('Analysis completed. Annotated video and detection report are ready.');
        }
      } catch (err) {
        if (!cancelled) setError(`Could not retrieve analysis status: ${err.message}`);
      }
    };
    poll();
    const timer = setInterval(poll, 1600);
    return () => { cancelled = true; clearInterval(timer); };
  }, [job?.job_id, job?.status]);

  const finished = job?.status === 'completed' && job.result;
  const running = job && ['queued', 'processing'].includes(job.status);
  const canRun = !!health?.model_available && !!selectedFile && !running && !isSubmitting && !isInspecting;
  const outputUrl = finished ? `${API_BASE}${job.video_url}` : '';
  const shownUrl = mode === 'annotated' && outputUrl ? outputUrl : originalUrl;
  const result = finished ? job.result : null;

  function chooseFile(file) {
    if (!file) return;
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
    if (!ALLOWED.includes(ext)) {
      setError('Unsupported file type. Select an MP4, MOV, AVI or MKV video.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Video is too large. The upload limit is 250 MiB.');
      return;
    }
    if (running) {
      setError('Wait for the current video analysis to finish before selecting another video.');
      return;
    }
    setSelectedFile(file);
    setInspection(null);
    setJob(null);
    setMode('original');
    setError('');
    setMessage('Video selected. Choose “Inspect video” to verify metadata.');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function inspectVideo() {
    if (!selectedFile) return;
    setIsInspecting(true); setError(''); setMessage('');
    const form = new FormData();
    form.append('file', selectedFile);
    try {
      const info = await apiRequest('/api/videos/inspect', { method: 'POST', body: form });
      setInspection(info);
      setMessage('Video inspected successfully. Metadata comes from OpenCV; no AI detection was run.');
    } catch (err) { setError(err.message); }
    finally { setIsInspecting(false); }
  }

  async function startDetection() {
    if (!canRun) return;
    setIsSubmitting(true); setError(''); setMessage(''); setMode('original');
    const form = new FormData();
    form.append('file', selectedFile);
    form.append('confidence', String(confidence));
    form.append('frame_stride', String(frameStride));
    try {
      const queued = await apiRequest('/api/videos/process', { method: 'POST', body: form });
      setJob({ ...queued, progress: 0, result: null });
      setMessage('Detection job queued. Processing speed depends on CPU/GPU and video length.');
    } catch (err) {
      setError(err.message);
      if (err.message.includes('not installed')) refreshHealth();
    } finally { setIsSubmitting(false); }
  }

  async function handleDownload(path, name) {
    try { setError(''); await downloadFile(path, name); }
    catch (err) { setError(err.message); }
  }

  function goToEvent(event) {
    if (!outputUrl) return;
    setPendingSeek(event.start_seconds);
    setMode('annotated');
    if (mode === 'annotated' && videoRef.current) {
      videoRef.current.currentTime = event.start_seconds;
      videoRef.current.play().catch(() => {});
      setPendingSeek(null);
    }
    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-visible' : ''}`}>
      <div className="brand">
        <span className="brand-emblem"><ScanSearch size={25} strokeWidth={1.8}/></span>
        <div><strong>Leopard<span>Watch</span></strong><small>WILDLIFE INTELLIGENCE</small></div>
        <button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={19}/></button>
      </div>

      <div className="sidebar-content">
        <p className="sidebar-label">WORKSPACE</p>
        <nav aria-label="Primary navigation">
          <a href="#overview" className="nav-link selected" onClick={() => setMobileNav(false)}><Layers3 size={18}/> Overview</a>
          <a href="#workspace" className="nav-link" onClick={() => setMobileNav(false)}><MonitorPlay size={18}/> Video analyzer</a>
          <a href="#results" className="nav-link" onClick={() => setMobileNav(false)}><Activity size={18}/> Detection report</a>
        </nav>

        <p className="sidebar-label system-label">SYSTEM</p>
        <div className="system-tile">
          <span className="sys-title"><StatusDot active={!!health && !healthError}/> API CONNECTION</span>
          <strong>{health ? 'Backend online' : 'Backend offline'}</strong>
          <small>{health ? `Device: ${health.device.toUpperCase()}` : 'Start FastAPI on port 8000'}</small>
        </div>
        <div className="system-tile">
          <span className="sys-title"><StatusDot active={!!health?.model_available} warn={!health?.model_available}/> LEOPARD MODEL</span>
          <strong>{health?.model_available ? 'Model file detected' : 'Model not installed'}</strong>
          <small>{health?.model_available ? 'best.pt present (not accuracy-tested)' : 'Waiting for trained best.pt'}</small>
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="project-pill"><Leaf size={18}/><div><span>PROJECT PHASE 01</span><strong>Video-based detection</strong></div></div>
        <p>Research & academic prototype<br/>CCTV integration planned later.</p>
      </div>
    </aside>

    <main className="main-content" id="overview">
      <header className="topbar">
        <div className="topbar-left">
          <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={22}/></button>
          <span className="breadcrumb">Workspace</span><span className="breadcrumb-sep">/</span><span className="breadcrumb active">Overview</span>
        </div>
        <div className="topbar-right">
          <span className="build-tag"><span className="build-dot"/> PHASE 01 · VIDEO INPUT</span>
          <div className="lw-user-account"><span className="lw-user-avatar" aria-hidden="true">{user?.name?.charAt(0)?.toUpperCase() || "U"}</span><span>{user?.name}</span><button type="button" className="lw-logout-button" onClick={onLogout}>Log out</button></div>
          <button onClick={refreshHealth} className="icon-button" title="Refresh backend status" aria-label="Refresh backend status"><RefreshCw size={17}/></button>
        </div>
      </header>

      <div className="content-inner">
        <div className="page-heading"><div><p className="eyebrow">DETECTION COMMAND CENTER</p><h1>Wildlife Monitoring <span>Studio<span className="period">.</span></span></h1><p className="heading-subtitle">Upload surveillance footage, inspect video properties, and analyze leopard presence with a custom YOLO model.</p></div><div className="heading-status"><StatusDot active={!!health}/> {health ? 'Local system connected' : 'Connection required'}</div></div>

        <section className="hero-banner" aria-label="Project information">
          <div className="hero-noise"/>
          <div className="hero-content"><div className="hero-kicker"><Radar size={15}/> COMPUTER VISION · YOLO</div><h2>Every frame tells<br/>a wildlife story.</h2><p>Turn recorded video into actionable leopard presence events, timestamped detections, and annotated footage.</p><a href="#workspace" className="hero-link">Start analysis <ArrowRight size={17}/></a></div>
          <div className="hero-orbit" aria-hidden="true"><div className="orbit outer"/><div className="orbit middle"/><div className="orbit inner"/><div className="orbit-center"><ScanSearch size={74} strokeWidth={1}/></div><div className="orbit-point one"/><div className="orbit-point two"/><div className="orbit-point three"/></div>
          <div className="hero-footnote"><span className="tiny-line"/> VIDEO INPUT ONLY <span className="tiny-line"/></div>
        </section>

        {!health && <div className="notice error-notice" role="alert"><CircleAlert size={19}/><div><strong>Backend connection unavailable</strong><span>{healthError || 'Checking API connection…'} Keep the FastAPI terminal running while you use this page.</span></div><button type="button" onClick={refreshHealth} className="notice-button">Retry</button></div>}
        {health && !health.model_available && <div className="notice warning-notice"><Info size={20}/><div><strong>Inspection mode is ready. AI detection is waiting for best.pt.</strong><span>Upload a video and click <b>Inspect video</b> now. After training, copy <code>best.pt</code> into <code>backend/models/</code> to enable analysis. Do not use a generic COCO checkpoint as a leopard model.</span></div></div>}

        <section className="workspace-grid" id="workspace">
          <div className="card video-card">
            <PanelTitle eyebrow="01 / MEDIA WORKSPACE" title="Footage analyzer" action={<span className="ghost-chip"><Film size={14}/> Uploaded video</span>}/>
            <div className={`video-surface ${selectedFile ? 'with-media' : ''}`}>
              {shownUrl ? <video key={shownUrl} ref={videoRef} className="media-player" controls playsInline preload="metadata" src={shownUrl} onLoadedMetadata={() => {if(pendingSeek != null && videoRef.current){ videoRef.current.currentTime = pendingSeek; setPendingSeek(null); }}}/> : <div className="video-placeholder"><div className="placeholder-icon"><Video size={32}/></div><strong>No footage uploaded yet</strong><span>Choose a video to preview and inspect it here</span></div>}
              <div className="surface-label"><span className="rec-dot"/> {mode === 'annotated' && outputUrl ? 'ANNOTATED OUTPUT' : 'ORIGINAL FOOTAGE'}</div>
            </div>
            <div className="preview-switch" role="group" aria-label="Video preview selection"><button className={mode==='original'?'current':''} onClick={()=>setMode('original')} disabled={!selectedFile}><Film size={15}/> Original video</button><button className={mode==='annotated'?'current':''} onClick={()=>setMode('annotated')} disabled={!outputUrl}><ScanSearch size={15}/> Annotated result {outputUrl && <Check size={14}/>}</button></div>
            <div className="upload-divider"><span>UPLOAD FOOTAGE</span><span>MP4 · MOV · AVI · MKV</span></div>
            <div className={`dropzone ${isDragging?'drag-active':''} ${selectedFile?'has-file':''}`}
              role="button" tabIndex={0} onClick={()=>fileInputRef.current?.click()}
              onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInputRef.current?.click();}}}
              onDragOver={(e)=>{e.preventDefault();setIsDragging(true)}}
              onDragLeave={(e)=>{e.preventDefault();setIsDragging(false)}}
              onDrop={(e)=>{e.preventDefault();setIsDragging(false);chooseFile(e.dataTransfer.files?.[0]);}}>
              <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.mkv,video/*" aria-label="Choose video file" onChange={(e)=>chooseFile(e.target.files?.[0])} hidden/>
              <div className="upload-icon">{selectedFile?<FileVideo size={24}/>:<CloudUpload size={24}/>}</div>
              <div className="drop-text"><strong>{selectedFile ? selectedFile.name : 'Drop your surveillance video here'}</strong><span>{selectedFile ? `${formatBytes(selectedFile.size)} · Click to change video` : 'or click to browse from your computer'}</span></div>
              <span className="browse-button">Browse files <ArrowRight size={14}/></span>
            </div>
            <p className="upload-footnote"><ShieldCheck size={14}/> Local processing. Maximum file size: 250 MiB. Inspection does not perform leopard detection.</p>
            <div className="action-row"><button className="secondary-button" disabled={!selectedFile || isInspecting || isSubmitting || running || !health} onClick={inspectVideo}><ScanSearch size={18}/>{isInspecting ? 'Inspecting…' : 'Inspect video'}</button><button className="primary-button" disabled={!canRun} onClick={startDetection}>{isSubmitting ? <RefreshCw className="spin" size={18}/> : <Play size={18} fill="currentColor"/>}{isSubmitting ? 'Uploading…' : running ? 'Analysis in progress' : 'Run leopard detection'}<ArrowRight size={17}/></button></div>
            {running && <div className="progress-wrap" aria-live="polite"><div className="progress-top"><span><Activity size={15}/> {job.status === 'queued' ? 'Queued for analysis' : 'Analyzing video frames'}</span><strong>{job.progress ?? 0}%</strong></div><div className="progress-track"><span style={{width:`${Math.min(100, Math.max(0, job.progress || 0))}%`}}/></div><p>Keep the backend terminal running. Longer videos may take time on CPU.</p></div>}
            {message && <p className="inline-message success-message" role="status"><CheckCircle2 size={17}/>{message}</p>}
            {error && <p className="inline-message error-message" role="alert"><CircleAlert size={17}/>{error}</p>}
          </div>

          <div className="right-stack">
            <div className="card engine-card"><PanelTitle eyebrow="02 / SYSTEM STATUS" title="Detection engine" action={<button className="refresh-text" onClick={refreshHealth} aria-label="Refresh engine status"><RefreshCw size={16}/></button>}/>
              <div className="engine-block"><span className={`engine-avatar ${health?.model_available?'ready':''}`}><Cpu size={27}/></span><div><p>Custom YOLO leopard model</p><strong>{health?.model_available ? 'Model file available' : 'Model pending'}</strong><small>{health?.model_available ? 'Accuracy still requires evaluation' : 'backend/models/best.pt not found'}</small></div><span className={`engine-indicator ${health?.model_available?'ready':''}`}/></div>
              <div className="engine-properties"><div><span>API connection</span><strong className={health?'text-green':'text-red'}>{health?'Online':'Offline'}</strong></div><div><span>Inference device</span><strong>{health?.device?.toUpperCase()||'—'}</strong></div><div><span>Model status</span><strong>{health?.model_available?'File installed':'Not installed'}</strong></div><div><span>Detection mode</span><strong>Recorded video</strong></div></div>
              <div className="engine-note"><Info size={16}/><span>{health?.model_available?'Model file detected. Verify results on unseen videos before making accuracy claims.':'You can test video inspection now. Leopard detection is disabled until a custom trained model is installed.'}</span></div>
            </div>

            <div className="card settings-card"><button className="settings-heading" onClick={()=>setShowSettings(v=>!v)} aria-expanded={showSettings}><div><p className="eyebrow muted">03 / CONFIGURATION</p><h2>Analysis settings</h2></div><ChevronDown size={19} className={showSettings?'':'collapsed'}/></button>
              {showSettings && <div className="settings-body"><div className="setting-row"><div><strong><Gauge size={16}/> Confidence threshold</strong><small>Minimum confidence required to show a box</small></div><span className="setting-value">{Math.round(confidence*100)}%</span></div><input className="range-input" type="range" min="0.10" max="0.95" step="0.05" value={confidence} onChange={e=>setConfidence(Number(e.target.value))} aria-label="Confidence threshold"/><div className="range-labels"><span>10% · More sensitive</span><span>95% · More selective</span></div><div className="setting-separator"/><div className="setting-row"><div><strong><Settings2 size={16}/> Frame stride</strong><small>Analyze every nth frame of the video</small></div><span className="setting-value">{frameStride}</span></div><div className="stride-options">{[1,2,3,4,5].map(n=><button key={n} className={frameStride===n?'chosen':''} onClick={()=>setFrameStride(n)} title={`Analyze every ${n}${n===1?'st':n===2?'nd':n===3?'rd':'th'} frame`}>{n}</button>)}</div><div className="setting-help"><HelpCircle size={15}/><span>Stride 1 checks every frame but is slower. Stride 2 is faster and may miss very brief appearances.</span></div></div>}
            </div>
          </div>
        </section>

        <section id="results" className="results-section">
          <div className="section-head"><div><p className="eyebrow">04 / INSIGHTS</p><h2>Analysis overview</h2><p>Measurements below are derived from inspected footage or real model output.</p></div>{finished && <span className="result-ready"><CheckCircle2 size={15}/> Analysis complete</span>}</div>
          <div className="stats-grid">
            <MetricCard icon={Clock3} title="Video duration" value={formatDuration(result?.duration_seconds ?? inspection?.duration_seconds)} detail="Recorded footage length" shade="sage"/>
            <MetricCard icon={Film} title="Frames analyzed" value={formatNumber(result?.frames_analyzed)} detail={result ? `of ${formatNumber(result.total_frames)} frames` : 'Available after model inference'} shade="sand"/>
            <MetricCard icon={Radar} title="Presence events" value={formatNumber(result?.presence_event_count)} detail="Not unique leopard count" shade="blue"/>
            <MetricCard icon={Gauge} title="Peak confidence" value={formatPercent(result?.maximum_confidence)} detail="Highest model score" shade="rose"/>
          </div>
          <div className="detail-grid"><div className="card metadata-card"><PanelTitle eyebrow="FILE INFORMATION" title="Video properties" action={<span className="mini-tag"><HardDrive size={14}/> OpenCV</span>}/>
            <div className="metadata-list"><DataRow label="Filename" value={selectedFile?.name||'—'}/><DataRow label="Resolution" value={result?.resolution ?? (inspection ? `${inspection.width} × ${inspection.height}`:'—')}/><DataRow label="Frame rate" value={inspection ? `${inspection.fps} FPS` : (result ? `${result.fps} FPS`:'—')}/><DataRow label="Total frames" value={formatNumber(result?.total_frames??inspection?.total_frames)}/><DataRow label="Video size" value={selectedFile?formatBytes(selectedFile.size):'—'}/><DataRow label="First detection" value={result?.first_detection_timestamp||'—'}/></div>
            {!inspection && !result && <div className="metadata-hint"><FileVideo size={17}/> Inspect a video to populate technical details.</div>}
          </div>
          <div className="card timeline-card"><PanelTitle eyebrow="DETECTION HISTORY" title="Presence timeline" action={<span className="mini-tag"><Activity size={14}/> Event log</span>}/>
            {result?.events?.length ? <div className="event-list">{result.events.map((event,index)=><button onClick={()=>goToEvent(event)} className="event-item" key={`${event.start_seconds}-${index}`}><span className="event-number">{String(index+1).padStart(2,'0')}</span><div className="event-main"><strong>Leopard presence detected</strong><span>{event.start_timestamp} — {event.end_timestamp}</span></div><div className="event-tail"><strong>{formatPercent(event.max_confidence)}</strong><small>Confidence</small></div><Play size={16}/></button>)}</div> : <div className="empty-timeline"><div className="timeline-graphic"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div><Radar size={25}/><strong>{result ? 'No leopard events detected' : 'No detection events yet'}</strong><p>{result?'This video produced no detections at the selected settings. This does not prove no leopard was present.':'Detection timestamps will appear here after you run a model analysis.'}</p></div>}
          </div></div>
          {finished && <div className="export-card"><div className="export-icon"><CheckCircle2 size={25}/></div><div><strong>Video analysis complete</strong><p>Export the annotated MP4 and JSON report. Results are generated by the backend, not estimated by the interface.</p></div><div className="export-actions"><button onClick={()=>handleDownload(job.video_url, 'leopard_annotated.mp4')}><ArrowDownToLine size={16}/> Annotated video</button><button onClick={()=>handleDownload(job.report_url, 'leopard_detection_report.json')}><FileJson size={16}/> JSON report</button></div></div>}
        </section>

        <footer className="app-footer"><div><ScanSearch size={17}/> LEOPARDWATCH <span className="foot-divider"/> Video detection prototype</div><p>Presence events are time periods, not individual leopard identities. All detections require validation.</p></footer>
      </div>
    </main>
  </div>;
}

function MetricCard({ icon: Icon, title, value, detail, shade }) {
  return <div className="metric-card"><div className={`metric-icon ${shade}`}><Icon size={19}/></div><p>{title}</p><strong>{value}</strong><small>{detail}</small></div>;
}
function DataRow({ label, value }) {
  return <div className="data-row"><span>{label}</span><strong title={String(value)}>{value}</strong></div>;
}

export default App;
