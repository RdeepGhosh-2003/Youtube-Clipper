# 🎬 YouTube Video Clipper & Batch Equal Splitter

A full-stack web application designed to clip, trim, and batch-split YouTube videos into as many parts as you want — including **equal division** (e.g., dividing a 27-minute video into 25 equal slices) or custom timestamped highlights.

---

## 🎁 Sharing with a Friend (Zero-Setup 1-Click Launch)

This project is completely ready to share with non-technical users!

### What your friend needs to do:
1. **Unzip / Open the project folder**.
2. **Double-click [`start.bat`](file:///c:/Users/KIIT/Documents/antigravity/lively-galileo/start.bat)**. That's it!

### What `start.bat` automatically does behind the scenes:
- ✅ **Python Verification & Auto-Install**: Checks if Python 3 is installed. If missing, it automatically downloads and installs Python 3.11 silently in the background (via Windows Package Manager `winget` or direct official installer from python.org).
- ✅ **Isolated Environment**: Automatically creates a dedicated `.venv` virtual environment so it never touches or conflicts with system packages.
- ✅ **Package Installation**: Automatically installs all requirements (`FastAPI`, `uvicorn`, `yt-dlp`, `pydantic`).
- ✅ **Self-Contained FFmpeg**: Includes `imageio-ffmpeg` which automatically supplies a high-performance FFmpeg binary—your friend **never** has to download FFmpeg manually or edit system PATH environment variables!
- ✅ **Pre-compiled Web App**: The production frontend bundle (`frontend/dist`) is already pre-built—no Node.js or npm needed on their computer!
- ✅ **Port Cleanup**: Frees port 8000 if an old zombie process was left running.
- ✅ **Background Launch**: Starts the server in a minimized background process and automatically opens **http://127.0.0.1:8000** in their default web browser.

---

## 🛑 How to Stop the App

Your friend has two super simple ways to stop the server:
1. **In the Web Browser**: Click the red **"⏻ Stop Server (Exit App)"** button located at the top right of the navigation bar.
2. **From the Folder**: Double-click [`stop.bat`](file:///c:/Users/KIIT/Documents/antigravity/lively-galileo/stop.bat).

---

## ✨ Features

- ✂️ **Equal Split Mode**:
  - Automatically divides any video into **$N$ equal parts** (e.g., 25 slices of a 27-minute video).
  - Configurable start/end range (clip only a segment of the video into equal parts or the full duration).
  - Select / deselect individual slices to export only what you need.
- 🎯 **Custom Multi-Part Mode**:
  - Add unlimited clips with custom start and end timestamps (`HH:MM:SS` or `MM:SS`).
  - Name and organize each highlight before exporting.
- ⚡ **Optimized Video Processing**:
  - Uses `yt-dlp` to download the source stream once, avoiding repetitive connections and YouTube throttling.
  - Slices all parts concurrently using multi-threaded `ffmpeg`.
  - **Ultra-Fast Cut Mode**: Stream-copy (`-c copy`) for near-instant slicing without re-encoding.
  - **Frame-Accurate Mode**: Re-encoded (`h.264 + aac`) for perfect cut points.
- 📱 **Social Media Formats**:
  - Original 16:9 Landscape.
  - Vertical 9:16 Crop (YouTube Shorts, TikTok, Instagram Reels).
  - MP4 Video or MP3 Audio Only.
- 📦 **One-Click ZIP Export**:
  - Compresses all generated parts into a single `.zip` file for instant batch download.
  - Individual download links and built-in video preview player for each clip.
- ⏸️ **Pause, Resume & Individual Part Controls**:
  - **Individual Parallel Progress Bars**: Every single part (even 20+ parts) has its own progress bar and status indicator.
  - **Stop Individual Parts**: Stop or skip any specific part while all other parallel clipping workers continue slicing without interruption.
  - **Resume Individual Parts**: If you stopped a part, click **"▶ Resume Part"** at any time — even after clipping finishes. It uses the cached source video to slice that part in <1 second and automatically updates the ZIP archive!
  - **Global Pause & Resume**: Pause and resume downloads or slicing with a single click.

---

## 📁 Project Structure

```text
├── backend/
│   ├── main.py               # FastAPI server & static file host
│   ├── requirements.txt      # Python dependencies (fastapi, yt-dlp, uvicorn, imageio-ffmpeg)
│   └── services/
│       └── clipper.py        # yt-dlp downloading, ffmpeg slicing, zip packaging
├── frontend/
│   ├── src/                  # React + Vite source files
│   └── dist/                 # Pre-built production bundle (ready for zero-setup distribution)
├── run_app.py                # Server launcher script with automatic browser open
├── start.bat                 # 1-click zero-setup installer & launcher for Windows
├── stop.bat                  # Clean 1-click shutdown script
└── README.md
```
