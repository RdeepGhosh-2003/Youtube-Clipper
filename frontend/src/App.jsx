import React, { useState, useEffect, useRef } from "react";
import {
  Scissors,
  Download,
  Play,
  RotateCcw,
  Plus,
  Trash2,
  Clock,
  Sparkles,
  Layers,
  Settings,
  Film,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  FolderArchive,
  Volume2,
  Video,
  Pause,
  Square,
  Power
} from "lucide-react";
import "./App.css";


// Helper: Convert seconds to HH:MM:SS or MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const secs = Math.floor(seconds);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const ms = Math.floor((seconds - secs) * 10);

  const parts = [];
  if (h > 0) parts.push(h.toString().padStart(2, "0"));
  parts.push(m.toString().padStart(2, "0"));
  parts.push(s.toString().padStart(2, "0"));

  return parts.join(":") + (ms > 0 ? `.${ms}` : "");
}

// Helper: Parse MM:SS or HH:MM:SS or raw seconds to float seconds
function parseTime(str) {
  if (typeof str === "number") return str;
  if (!str) return 0;
  const parts = str.trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

// Helper: Extract YouTube Video ID
function extractVideoId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [error, setError] = useState(null);

  // Mode: "equal" or "custom"
  const [mode, setMode] = useState("equal");

  // Equal Split state
  const [numParts, setNumParts] = useState(25);
  const [splitRangeStart, setSplitRangeStart] = useState("00:00");
  const [splitRangeEnd, setSplitRangeEnd] = useState("");
  const [equalClips, setEqualClips] = useState([]);

  // Custom Clips state
  const [customClips, setCustomClips] = useState([
    { id: "1", title: "Clip 1", start: 0, end: 60, selected: true }
  ]);

  // Settings
  const [quality, setQuality] = useState("1080p");
  const [format, setFormat] = useState("mp4");
  const [aspectRatio, setAspectRatio] = useState("original");
  const [fastCut, setFastCut] = useState(true);


  // Job status
  const [currentJobId, setCurrentJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activePreviewUrl, setActivePreviewUrl] = useState(null);
  const [serverShutdown, setServerShutdown] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [rightView, setRightView] = useState("setup");

  const playerRef = useRef(null);
  const lastLoadedIdRef = useRef(null);

  // Fetch video metadata
  const handleFetchInfo = async (overrideUrl) => {
    const targetUrl = (overrideUrl || url).trim();
    if (!targetUrl) return;
    const detectedId = extractVideoId(targetUrl);
    if (!detectedId) return;

    if (lastLoadedIdRef.current === detectedId && videoInfo) {
      return; // Already loaded
    }

    setLoadingInfo(true);
    setError(null);
    try {
      const res = await fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to fetch video info");

      lastLoadedIdRef.current = detectedId;
      setVideoInfo(data.data);
      if (data.data.id) setVideoId(data.data.id);
      setSplitRangeEnd(formatTime(data.data.duration));

      // Re-generate equal parts with actual duration
      generateEqualParts(numParts, 0, data.data.duration);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  // Immediate paste auto-load
  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").trim();
    const id = extractVideoId(pasted);
    if (id) {
      setUrl(pasted);
      setVideoId(id);
      handleFetchInfo(pasted);
    }
  };

  // Debounced auto-fetch on typing or editing URL
  const handleUrlChange = (e) => {
    const val = e.target.value;
    setUrl(val);
    const id = extractVideoId(val);
    if (id) {
      setVideoId(id);
      if (id !== lastLoadedIdRef.current) {
        handleFetchInfo(val);
      }
    }
  };

  // Generate equal parts logic
  const generateEqualParts = (partsCount, startSec, endSec) => {
    const totalDuration = endSec - startSec;
    if (totalDuration <= 0 || partsCount <= 0) return;


    const step = totalDuration / partsCount;
    const generated = [];

    for (let i = 0; i < partsCount; i++) {
      const pStart = startSec + i * step;
      const pEnd = i === partsCount - 1 ? endSec : startSec + (i + 1) * step;
      generated.push({
        id: `equal-${i + 1}`,
        title: `Part ${i + 1}`,
        start: pStart,
        end: pEnd,
        selected: true
      });
    }
    setEqualClips(generated);
  };

  // Recalculate equal parts when inputs change
  useEffect(() => {
    if (videoInfo && videoInfo.duration) {
      const startSec = parseTime(splitRangeStart) || 0;
      const endSec = splitRangeEnd ? parseTime(splitRangeEnd) : videoInfo.duration;
      generateEqualParts(numParts, startSec, Math.min(videoInfo.duration, endSec));
    }
  }, [numParts, splitRangeStart, splitRangeEnd, videoInfo]);

  // Polling job status
  useEffect(() => {
    let interval = null;
    if (currentJobId && isProcessing) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${currentJobId}`);
          if (res.ok) {
            const data = await res.json();
            setJobStatus(data);
            if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
              setIsProcessing(false);
              clearInterval(interval);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [currentJobId, isProcessing]);

  const handlePause = async () => {
    if (!currentJobId) return;
    try {
      await fetch(`/api/jobs/${currentJobId}/pause`, { method: "POST" });
      setJobStatus((prev) => ({ ...prev, status: "paused", is_paused: true }));
    } catch (e) {
      console.error("Pause error", e);
    }
  };

  const handleResume = async () => {
    if (!currentJobId) return;
    try {
      await fetch(`/api/jobs/${currentJobId}/resume`, { method: "POST" });
      setJobStatus((prev) => ({ ...prev, status: "clipping", is_paused: false }));
    } catch (e) {
      console.error("Resume error", e);
    }
  };

  const handleStop = async () => {
    if (!currentJobId) return;
    try {
      await fetch(`/api/jobs/${currentJobId}/cancel`, { method: "POST" });
      setJobStatus((prev) => ({
        ...prev,
        status: "cancelled",
        is_cancelled: true,
        message: "Stopping clipping and packaging completed parts..."
      }));
    } catch (e) {
      console.error("Stop error", e);
    }
  };

  const handleSkipPart = async (partIndex) => {
    if (!currentJobId) return;
    try {
      await fetch(`/api/jobs/${currentJobId}/parts/${partIndex}/skip`, { method: "POST" });
      setJobStatus((prev) => {
        if (!prev || !prev.parts_status) return prev;
        const updatedParts = prev.parts_status.map((p, idx) =>
          idx === partIndex ? { ...p, status: "skipped" } : p
        );
        return { ...prev, parts_status: updatedParts };
      });
    } catch (e) {
      console.error("Skip part error", e);
    }
  };

  const handleResumePart = async (partIndex) => {
    if (!currentJobId) return;
    setIsProcessing(true);
    setRightView("progress");
    setJobStatus((prev) => {
      if (!prev || !prev.parts_status) return prev;
      const updatedParts = prev.parts_status.map((p, idx) =>
        idx === partIndex ? { ...p, status: "clipping" } : p
      );
      return { ...prev, status: "clipping", stage: "clipping", parts_status: updatedParts };
    });

    try {
      await fetch(`/api/jobs/${currentJobId}/parts/${partIndex}/resume`, { method: "POST" });
    } catch (e) {
      console.error("Resume part error", e);
    }
  };

  const handleShutdownServer = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to stop the background YouTube Clipper server?\n\nThis completely shuts down the app (so you don't need to run stop.bat)."
    );
    if (!confirmed) return;

    setShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch (e) {
      // Ignore network drop when server terminates
    }
    setServerShutdown(true);
  };




  // Add custom clip
  const addCustomClip = () => {
    const lastClip = customClips[customClips.length - 1];
    const newStart = lastClip ? lastClip.end : 0;
    const newEnd = videoInfo ? Math.min(videoInfo.duration, newStart + 60) : newStart + 60;
    setCustomClips([
      ...customClips,
      {
        id: Date.now().toString(),
        title: `Clip ${customClips.length + 1}`,
        start: newStart,
        end: newEnd,
        selected: true
      }
    ]);
  };

  const removeCustomClip = (id) => {
    if (customClips.length === 1) return;
    setCustomClips(customClips.filter((c) => c.id !== id));
  };

  const updateCustomClip = (id, field, value) => {
    setCustomClips(
      customClips.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    );
  };

  // Submit clipping job
  const handleStartClipping = async () => {
    const rawClips = mode === "equal" ? equalClips : customClips;
    const selectedClips = rawClips
      .filter((c) => c.selected)
      .map((c) => ({
        id: c.id,
        title: c.title,
        start: typeof c.start === "number" ? c.start : parseTime(c.start),
        end: typeof c.end === "number" ? c.end : parseTime(c.end)
      }));

    if (selectedClips.length === 0) {
      alert("Please select at least one clip to export.");
      return;
    }

    setIsProcessing(true);
    setRightView("progress");
    setJobStatus({
      status: "queued",
      stage: "queued",
      progress: 0,
      message: "Sending clipping request to server...",
      total_parts: selectedClips.length,
      completed_clips: 0,
      parts_status: selectedClips.map((c, i) => ({
        index: i + 1,
        title: c.title || `Part ${i + 1}`,
        range: `${formatTime(c.start)} - ${formatTime(c.end)}`,
        status: "pending"
      }))
    });

    try {
      const res = await fetch("/api/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          video_title: videoInfo ? videoInfo.title : "YouTube Clip",
          clips: selectedClips,
          quality,
          format,
          aspect_ratio: aspectRatio,
          fast_cut: fastCut
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start clipping job");

      setCurrentJobId(data.job_id);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  const activeClips = mode === "equal" ? equalClips : customClips;
  const selectedCount = activeClips.filter((c) => c.selected).length;

  if (serverShutdown) {
    return (
      <div className="shutdown-screen">
        <div className="shutdown-card">
          <div className="shutdown-icon">🛑</div>
          <h2>Server Stopped Successfully</h2>
          <p>The background YouTube Clipper server has been terminated.</p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", margin: "1rem 0" }}>
            You can now safely close this browser window.
          </p>
          <div className="shutdown-tip">
            <span>💡 To restart the clipper anytime, simply double-click <strong>start_silent.vbs</strong></span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="clipper-container">
      {/* Top Application Bar: Brand + Unified URL Input + Server Status & Stop Server */}
      <div className="top-nav-bar">
        <div className="top-brand">
          <div className="brand-badge"><Sparkles size={14} /> YouTube Clipper</div>
          <h1 className="brand-title">Clip & Split</h1>
        </div>

        <form
          className="top-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleFetchInfo();
          }}
        >
          <div className="url-input-wrapper">
            <Film className="url-icon" size={17} />
            <input
              type="text"
              className="input-field top-input-field"
              placeholder="Paste YouTube Video URL (e.g. https://www.youtube.com/watch?v=...)"
              value={url}
              onChange={handleUrlChange}
              onPaste={handlePaste}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-load-url"
            disabled={loadingInfo || !url.trim()}
          >
            {loadingInfo ? "⚡ Loading..." : (videoInfo ? "✓ Loaded" : "Load Video")}
          </button>
        </form>

        <div className="top-actions">
          <div className="server-status-pill">
            <span className="server-live-dot"></span>
            <span className="server-port-text">Port 8000</span>
          </div>
          <button
            className="btn-shutdown-server"
            onClick={handleShutdownServer}
            title="Stop background server (replaces stop.bat)"
            disabled={shuttingDown}
          >
            <Power size={14} /> {shuttingDown ? "Stopping..." : "Stop Server"}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main 2-Column Responsive Dashboard */}
      <div className="dashboard-grid">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: Video Preview, Export Controls, Overall Progress & ZIP */}
        {/* ========================================================================= */}
        <div className="dash-left-col">
          {/* Video Preview Card */}
          <div className="glass-panel video-player-card">
            {activePreviewUrl ? (
              <div className="preview-player-box">
                <div className="preview-player-header">
                  <span style={{ fontWeight: 700, color: "var(--accent-cyan)", display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.88rem" }}>
                    <Play size={14} fill="currentColor" /> Clip Preview
                  </span>
                  <button onClick={() => setActivePreviewUrl(null)} className="btn-close-preview">
                    Close Preview ✕
                  </button>
                </div>
                <video src={activePreviewUrl} controls autoPlay className="preview-video-element" />
              </div>
            ) : videoId ? (
              <div className="player-wrapper">
                <iframe
                  id="yt-player"
                  src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`}
                  title="YouTube Video Preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="player-placeholder">
                <Film size={36} color="var(--text-muted)" />
                <p>Paste a YouTube video URL above to preview and carve into slices.</p>
              </div>
            )}

            {videoInfo && (
              <div className="video-card-meta">
                <h3 className="video-card-title" title={videoInfo.title}>{videoInfo.title}</h3>
                <div className="video-meta-badges">
                  {videoInfo.duration_formatted && (
                    <span className="badge badge-highlight">
                      <Clock size={13} /> {videoInfo.duration_formatted} ({Math.round(videoInfo.duration)}s)
                    </span>
                  )}
                  {videoInfo.uploader && (
                    <span className="badge">
                      Channel: {videoInfo.uploader}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Export Settings Card */}
          <div className="glass-panel export-settings-card">
            <div className="export-card-title">
              <Settings size={16} /> Export Settings
            </div>

            <div className="export-options-grid">
              <div className="option-item">
                <label>Format</label>
                <select className="option-select" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="mp4">MP4 (Video)</option>
                  <option value="mp3">MP3 (Audio Only)</option>
                </select>
              </div>

              {format === "mp4" && (
                <>
                  <div className="option-item">
                    <label>Quality</label>
                    <select className="option-select" value={quality} onChange={(e) => setQuality(e.target.value)}>
                      <option value="1080p">1080p Full HD</option>
                      <option value="720p">720p HD</option>
                      <option value="480p">480p SD</option>
                      <option value="best">Best (2K/4K)</option>
                    </select>
                  </div>

                  <div className="option-item">
                    <label>Aspect Ratio</label>
                    <select className="option-select" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                      <option value="original">Original 16:9</option>
                      <option value="shorts_9_16">Vertical 9:16 (Shorts/TikTok)</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {format === "mp4" && (
              <label className="fastcut-toggle">
                <input
                  type="checkbox"
                  checked={fastCut}
                  onChange={(e) => setFastCut(e.target.checked)}
                  disabled={aspectRatio !== "original"}
                />
                <span>⚡ Ultra-Fast Cut (Lossless Stream Copy)</span>
              </label>
            )}

            <button
              className="btn btn-primary btn-clip-action"
              onClick={handleStartClipping}
              disabled={isProcessing || selectedCount === 0 || !url.trim()}
            >
              <Scissors size={18} />
              {isProcessing
                ? "Slicing in Progress..."
                : `Clip & Export ${selectedCount} Part${selectedCount !== 1 ? "s" : ""}`}
            </button>
          </div>

          {/* Master Job Progress & ZIP Download Card (when job is active or completed) */}
          {jobStatus && (
            <div className={`glass-panel master-job-card ${jobStatus.status === "paused" ? "job-paused" : ""}`}>
              <div className="master-job-header">
                {jobStatus.status === "failed" ? (
                  <div className="job-status-title error">
                    <AlertCircle size={20} color="#ef4444" />
                    <span>Failed: {jobStatus.error || jobStatus.message}</span>
                  </div>
                ) : jobStatus.status === "completed" ? (
                  <div className="job-status-title success">
                    <CheckCircle2 size={20} color="#10b981" />
                    <span>Slicing Complete ({jobStatus.files?.length || 0} Parts Ready)</span>
                  </div>
                ) : jobStatus.status === "cancelled" ? (
                  <div className="job-status-title warning">
                    <Square size={18} color="#f59e0b" fill="#f59e0b" />
                    <span>Clipping Stopped ({jobStatus.files?.length || 0} Parts Saved)</span>
                  </div>
                ) : jobStatus.status === "paused" ? (
                  <div className="job-status-title warning">
                    <Pause size={18} color="#f59e0b" />
                    <span>Clipping Paused</span>
                  </div>
                ) : (
                  <div className="job-status-title active">
                    <Sparkles size={18} color="var(--accent-purple)" />
                    <span>{jobStatus.stage === "queued" ? "Preparing Job..." : jobStatus.stage === "downloading" ? "Downloading Video..." : "Slicing in Parallel..."}</span>
                  </div>
                )}

                <span className="master-pct-badge">{jobStatus.progress || 0}%</span>
              </div>

              {/* Master Progress Bar */}
              <div className="progress-bar-container" style={{ margin: "0.5rem 0" }}>
                <div
                  className={`progress-bar-fill ${jobStatus.status === "paused" ? "progress-bar-paused" : ""}`}
                  style={{ width: `${jobStatus.progress || 0}%` }}
                />
              </div>

              <div className="master-job-stats">
                <span>Completed: <strong>{jobStatus.completed_clips || jobStatus.files?.length || 0} of {jobStatus.total_parts || jobStatus.parts_status?.length || 0}</strong> parts</span>
                {jobStatus.message && <span className="master-message-text">{jobStatus.message}</span>}
              </div>

              {/* Master Job Actions */}
              <div className="master-job-actions">
                {jobStatus.status === "failed" ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setIsProcessing(false)}>
                    <RotateCcw size={14} /> Reset
                  </button>
                ) : (jobStatus.status === "completed" || jobStatus.status === "cancelled") && jobStatus.zip_url ? (
                  <a href={jobStatus.zip_url} className="btn btn-primary btn-zip-download" download>
                    <FolderArchive size={17} /> Download All ({jobStatus.files?.length || 0}) as ZIP
                  </a>
                ) : (
                  <div className="job-control-btn-group">
                    <button
                      className="btn btn-sm btn-pause"
                      onClick={handlePause}
                      disabled={jobStatus.status === "paused"}
                    >
                      <Pause size={14} /> Pause
                    </button>
                    <button
                      className="btn btn-sm btn-resume"
                      onClick={handleResume}
                      disabled={jobStatus.status !== "paused"}
                    >
                      <Play size={14} /> Resume
                    </button>
                    <button
                      className="btn btn-danger btn-sm btn-stop"
                      onClick={handleStop}
                    >
                      <Square size={13} fill="currentColor" /> Stop
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: Mode Selector, Parts Configuration OR Live Progress */}
        {/* ========================================================================= */}
        <div className="dash-right-col">
          {/* Top Panel Tabs (if job exists, allow switching between Live Progress & Setup) */}
          <div className="panel-tab-bar">
            {jobStatus ? (
              <div className="view-switcher-tabs">
                <button
                  className={`view-tab-btn ${rightView === "progress" ? "active" : ""}`}
                  onClick={() => setRightView("progress")}
                >
                  <Sparkles size={15} /> Live Slicing Progress ({jobStatus.parts_status?.length || 0} Parts)
                </button>
                <button
                  className={`view-tab-btn ${rightView === "setup" ? "active" : ""}`}
                  onClick={() => setRightView("setup")}
                >
                  <Layers size={15} /> Slices Setup & Editor
                </button>
              </div>
            ) : (
              <div className="tabs-header" style={{ marginBottom: 0 }}>
                <button
                  className={`tab-btn ${mode === "equal" ? "active" : ""}`}
                  onClick={() => setMode("equal")}
                >
                  <Layers size={16} /> Equal Split Mode (e.g. 25 Parts)
                </button>
                <button
                  className={`tab-btn ${mode === "custom" ? "active" : ""}`}
                  onClick={() => setMode("custom")}
                >
                  <Scissors size={16} /> Custom Multi-Part Mode
                </button>
              </div>
            )}
          </div>

          {/* VIEW 1: LIVE SLICING PROGRESS & PARTS LIST */}
          {jobStatus && rightView === "progress" ? (
            <div className="glass-panel parts-progress-panel">
              <div className="parts-bars-header">
                <div>
                  <span className="parts-header-title">Individual Part Clippers</span>
                  <span className="parts-header-count">({jobStatus.parts_status?.length || 0} parts)</span>
                </div>
                <div className="parts-bars-metrics">
                  <span>Active: <strong style={{ color: "#c4b5fd" }}>{jobStatus.parts_status?.filter(p => p.status === "clipping").length || 0}</strong></span>
                  <span>Done: <strong style={{ color: "#34d399" }}>{jobStatus.parts_status?.filter(p => p.status === "done").length || 0}</strong></span>
                  <span>Queued: <strong style={{ color: "var(--text-muted)" }}>{jobStatus.parts_status?.filter(p => p.status === "pending").length || 0}</strong></span>
                  <span>Skipped: <strong style={{ color: "#f87171" }}>{jobStatus.parts_status?.filter(p => p.status === "skipped").length || 0}</strong></span>
                </div>
              </div>

              {/* Scrollable list of individual part bars */}
              <div className="parts-bars-list widescreen-list">
                {jobStatus.parts_status?.map((part) => {
                  const partIdx = part.index - 1;
                  const file = jobStatus.files?.find((f) => f.index === partIdx);
                  const isDone = part.status === "done" || !!file;
                  const isSkipped = part.status === "skipped";
                  const isClipping = part.status === "clipping" && !isDone;
                  const isPaused = (part.status === "paused" || (jobStatus.status === "paused" && isClipping)) && !isDone && !isSkipped;

                  const downloadUrl = file?.download_url || part.download_url || `/api/download/${currentJobId}/clip/${partIdx}`;
                  const filename = file?.filename || part.filename || `clip_${part.index}.mp4`;
                  const sizeBytes = file?.size_bytes || part.size_bytes;
                  const sizeFormatted = sizeBytes ? (sizeBytes / (1024 * 1024)).toFixed(1) + " MB" : "";

                  return (
                    <div
                      key={part.index}
                      className={`part-bar-row ${
                        isDone ? "part-row-done" : isSkipped ? "part-row-skipped" : isPaused ? "part-row-paused" : isClipping ? "part-row-active" : "part-row-pending"
                      }`}
                    >
                      {/* Part Info */}
                      <div className="part-bar-info">
                        <span className="part-bar-idx">#{part.index}</span>
                        <div className="part-bar-meta">
                          <div className="part-bar-title" title={part.title}>{part.title}</div>
                          <div className="part-bar-range">{part.range}</div>
                        </div>
                      </div>

                      {/* Progress Bar Track */}
                      <div className="part-bar-track-wrap">
                        <div className={`part-bar-track ${
                          isDone ? "track-done" : isSkipped ? "track-skipped" : isPaused ? "track-paused" : isClipping ? "track-active" : "track-pending"
                        }`}>
                          <div
                            className={`part-bar-fill ${
                              isDone ? "fill-done" : isSkipped ? "fill-skipped" : isPaused ? "fill-paused" : isClipping ? "fill-active" : "fill-pending"
                            }`}
                            style={{ width: isDone ? "100%" : (isClipping || isPaused) ? "85%" : "0%" }}
                          />
                        </div>
                        <span className="part-bar-pct">
                          {isDone ? "100%" : isClipping ? "Slicing..." : isPaused ? "Paused" : isSkipped ? "Skipped" : "Queued"}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="part-bar-actions">
                        {isDone ? (
                          <>
                            <span className="badge-status done">✓ Done</span>
                            {sizeFormatted && <span className="part-size-pill">{sizeFormatted}</span>}
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setActivePreviewUrl(downloadUrl)}
                              title="Preview this clipped part"
                            >
                              <Play size={12} /> Preview
                            </button>
                            <a
                              href={downloadUrl}
                              className="btn btn-primary btn-sm btn-part-download"
                              download={filename}
                              title="Download this clip"
                            >
                              <Download size={12} /> Download
                            </a>
                          </>
                        ) : isSkipped ? (
                          <>
                            <span className="badge-status skipped">🚫 Skipped</span>
                            <button
                              className="btn btn-resume-part"
                              onClick={() => handleResumePart(partIdx)}
                              title="Resume slicing this part"
                            >
                              <Play size={12} fill="currentColor" /> Resume Part
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={`badge-status ${isPaused ? "paused" : isClipping ? "active" : "pending"}`}>
                              {isPaused ? "⏸ Paused" : isClipping ? "⚡ Slicing" : "⏳ Queued"}
                            </span>
                            {jobStatus.status === "cancelled" || jobStatus.status === "completed" ? (
                              <button
                                className="btn btn-resume-part"
                                onClick={() => handleResumePart(partIdx)}
                                title="Clip this part"
                              >
                                <Play size={12} fill="currentColor" /> Clip Part
                              </button>
                            ) : (
                              <button
                                className="btn btn-danger btn-sm btn-part-stop"
                                onClick={() => handleSkipPart(partIdx)}
                                title="Stop this part only (continue remaining parts)"
                              >
                                <Square size={11} fill="currentColor" /> Stop
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* VIEW 2: SETUP & SLICE CONFIGURATION (Equal or Custom) */
            <div className="glass-panel setup-panel">
              {/* If in jobStatus, show sub mode switch */}
              {jobStatus && (
                <div className="tabs-header" style={{ marginBottom: "1rem" }}>
                  <button className={`tab-btn ${mode === "equal" ? "active" : ""}`} onClick={() => setMode("equal")}>
                    <Layers size={16} /> Equal Split Mode
                  </button>
                  <button className={`tab-btn ${mode === "custom" ? "active" : ""}`} onClick={() => setMode("custom")}>
                    <Scissors size={16} /> Custom Multi-Part Mode
                  </button>
                </div>
              )}

              {mode === "equal" ? (
                <>
                  <div className="equal-split-controls-compact">
                    <div className="control-group">
                      <label>Parts Count</label>
                      <input
                        type="number"
                        min="2"
                        max="100"
                        value={numParts}
                        onChange={(e) => setNumParts(Math.max(2, parseInt(e.target.value) || 2))}
                        className="control-input"
                      />
                    </div>
                    <div className="control-group">
                      <label>Start Range</label>
                      <input
                        type="text"
                        value={splitRangeStart}
                        onChange={(e) => setSplitRangeStart(e.target.value)}
                        placeholder="00:00"
                        className="control-input"
                      />
                    </div>
                    <div className="control-group">
                      <label>End Range</label>
                      <input
                        type="text"
                        value={splitRangeEnd}
                        onChange={(e) => setSplitRangeEnd(e.target.value)}
                        placeholder="End of video"
                        className="control-input"
                      />
                    </div>
                    <div className="control-group slice-length-group">
                      <label>Each Slice Length</label>
                      <div className="slice-length-pill">
                        {videoInfo?.duration
                          ? `${((parseTime(splitRangeEnd || videoInfo.duration) - parseTime(splitRangeStart)) / numParts).toFixed(1)}s each`
                          : "Load video"}
                      </div>
                    </div>
                  </div>

                  <div className="clips-list-header">
                    <span>
                      Generated <strong>{equalClips.length} slices</strong> ({selectedCount} selected for export)
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        const allSelected = equalClips.every((c) => c.selected);
                        setEqualClips(equalClips.map((c) => ({ ...c, selected: !allSelected })));
                      }}
                    >
                      {equalClips.every((c) => c.selected) ? "Deselect All" : "Select All"}
                    </button>
                  </div>

                  <div className="clips-list widescreen-list">
                    {equalClips.map((clip, index) => (
                      <div key={clip.id} className="clip-row">
                        <input
                          type="checkbox"
                          checked={clip.selected}
                          onChange={(e) =>
                            setEqualClips(
                              equalClips.map((c) => (c.id === clip.id ? { ...c, selected: e.target.checked } : c))
                            )
                          }
                          style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--accent-purple)" }}
                        />
                        <span className="clip-index-badge">#{index + 1}</span>
                        <input
                          type="text"
                          className="clip-title-input"
                          value={clip.title}
                          onChange={(e) =>
                            setEqualClips(
                              equalClips.map((c) => (c.id === clip.id ? { ...c, title: e.target.value } : c))
                            )
                          }
                        />
                        <div className="time-inputs">
                          <span className="time-box">{formatTime(clip.start)}</span>
                          <span className="time-arrow">→</span>
                          <span className="time-box">{formatTime(clip.end)}</span>
                        </div>
                        <span className="duration-pill">{(clip.end - clip.start).toFixed(1)}s</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="clips-list-header">
                    <span>Custom Segments ({customClips.length} created)</span>
                    <button className="btn btn-primary btn-sm" onClick={addCustomClip}>
                      <Plus size={15} /> Add Another Clip
                    </button>
                  </div>

                  <div className="clips-list widescreen-list">
                    {customClips.map((clip, index) => {
                      const startSec = typeof clip.start === "number" ? clip.start : parseTime(clip.start);
                      const endSec = typeof clip.end === "number" ? clip.end : parseTime(clip.end);
                      const duration = Math.max(0, endSec - startSec);

                      return (
                        <div key={clip.id} className="clip-row">
                          <input
                            type="checkbox"
                            checked={clip.selected}
                            onChange={(e) => updateCustomClip(clip.id, "selected", e.target.checked)}
                            style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "var(--accent-purple)" }}
                          />
                          <span className="clip-index-badge">#{index + 1}</span>
                          <input
                            type="text"
                            className="clip-title-input"
                            value={clip.title}
                            onChange={(e) => updateCustomClip(clip.id, "title", e.target.value)}
                            placeholder="Clip Label"
                          />
                          <div className="time-inputs">
                            <input
                              type="text"
                              className="time-box"
                              value={typeof clip.start === "string" ? clip.start : formatTime(clip.start)}
                              onChange={(e) => updateCustomClip(clip.id, "start", e.target.value)}
                              placeholder="00:00"
                            />
                            <span className="time-arrow">→</span>
                            <input
                              type="text"
                              className="time-box"
                              value={typeof clip.end === "string" ? clip.end : formatTime(clip.end)}
                              onChange={(e) => updateCustomClip(clip.id, "end", e.target.value)}
                              placeholder="01:00"
                            />
                          </div>
                          <span className="duration-pill">{duration.toFixed(1)}s</span>

                          {customClips.length > 1 && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => removeCustomClip(clip.id)}
                              title="Remove Clip"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
