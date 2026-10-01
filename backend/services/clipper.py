import os
import re
import time
import uuid
import zipfile
import threading
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any
from concurrent.futures import ThreadPoolExecutor

import yt_dlp

BASE_DOWNLOAD_DIR = Path(__file__).resolve().parent.parent / "downloads"
BASE_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# In-memory stores
jobs: Dict[str, Dict[str, Any]] = {}
pause_events: Dict[str, threading.Event] = {}
cancel_flags: Dict[str, bool] = {}
active_subprocesses: Dict[tuple, subprocess.Popen] = {}

executor = ThreadPoolExecutor(max_workers=6)



def get_ffmpeg_binary() -> str:
    """Resolves FFmpeg executable: local backend/bin, imageio_ffmpeg bundled binary, or system PATH."""
    # 1. Local backend/bin directory
    local_bin = Path(__file__).resolve().parent.parent / "bin" / "ffmpeg.exe"
    if local_bin.exists():
        return str(local_bin)

    # 2. Bundled binary via imageio_ffmpeg
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).exists():
            return str(exe)
    except Exception:
        pass

    # 3. System PATH fallback
    import shutil
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg

    return "ffmpeg"


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    return cleaned.strip()[:60] or "clip"


def format_seconds(seconds: float) -> str:
    secs = int(seconds)
    hours = secs // 3600
    minutes = (secs % 3600) // 60
    rem_secs = secs % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{rem_secs:02d}"
    return f"{minutes:02d}:{rem_secs:02d}"


def pause_job_service(job_id: str):
    """Pause downloading or parallel clipping instantly."""
    if job_id in pause_events:
        pause_events[job_id].clear()  # Clear = paused
    if job_id in jobs:
        jobs[job_id]["is_paused"] = True
        jobs[job_id]["status"] = "paused"
        for p in jobs[job_id].get("parts_status", []):
            if p["status"] == "clipping":
                p["status"] = "paused"


def resume_job_service(job_id: str):
    """Resume downloading or parallel clipping instantly."""
    if job_id in pause_events:
        pause_events[job_id].set()  # Set = running
    if job_id in jobs:
        jobs[job_id]["is_paused"] = False
        stage = jobs[job_id].get("stage", "clipping")
        jobs[job_id]["status"] = "downloading_source" if stage == "downloading" else "clipping"
        for p in jobs[job_id].get("parts_status", []):
            if p["status"] == "paused":
                p["status"] = "clipping"


def cancel_job_service(job_id: str):
    """Stop/cancel downloading or parallel clipping and release wait locks."""
    cancel_flags[job_id] = True
    if job_id in pause_events:
        pause_events[job_id].set()  # Unblock any waiting thread
    if job_id in jobs:
        jobs[job_id]["is_cancelled"] = True
        jobs[job_id]["is_paused"] = False
        jobs[job_id]["status"] = "cancelled"


def skip_part_service(job_id: str, part_index: int):
    """Cancel / skip an individual part while allowing all other parts to continue."""
    if job_id not in jobs:
        return False
    job = jobs[job_id]
    if "skipped_parts" not in job:
        job["skipped_parts"] = set()
    job["skipped_parts"].add(part_index)

    # Update parts_status
    if "parts_status" in job and 0 <= part_index < len(job["parts_status"]):
        job["parts_status"][part_index]["status"] = "skipped"

    # If this part has an active ffmpeg subprocess, terminate it
    key = (job_id, part_index)
    proc = active_subprocesses.get(key)
    if proc and proc.poll() is None:
        try:
            proc.kill()
        except Exception:
            pass
    return True


def update_zip_archive(job_id: str):
    """Regenerate the ZIP file containing all currently completed clips."""
    job = jobs.get(job_id)
    if not job:
        return
    job_dir = BASE_DOWNLOAD_DIR / job_id
    payload = job.get("payload", {})
    files = job.get("files", [])
    if not files:
        return

    files.sort(key=lambda x: x["index"])
    zip_filename = f"{sanitize_filename(payload.get('video_title', 'clips'))}_all_parts.zip"
    zip_path = job_dir / zip_filename
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in files:
                fpath = job_dir / item["filename"]
                if fpath.exists():
                    zf.write(fpath, arcname=item["filename"])
        job["zip_url"] = f"/api/download/{job_id}/zip"
        job["zip_filename"] = zip_filename
    except Exception as e:
        print(f"Error updating zip archive: {e}")


def execute_slice_clip(job_id: str, idx: int, pause_event: threading.Event) -> Optional[Dict[str, Any]]:
    """Slices a single clip with FFmpeg using frame-accurate stream-copy or encoding."""
    job = jobs.get(job_id)
    if not job:
        return None
    job_dir = BASE_DOWNLOAD_DIR / job_id
    payload = job.get("payload", {})
    clips = payload.get("clips", [])
    if idx < 0 or idx >= len(clips):
        return None
    clip = clips[idx]

    format_type = payload.get("format", "mp4")
    aspect_ratio = payload.get("aspect_ratio", "original")
    fast_cut = payload.get("fast_cut", True)

    downloaded_files = list(job_dir.glob("source.*"))
    if not downloaded_files:
        if 0 <= idx < len(job.get("parts_status", [])):
            job["parts_status"][idx]["status"] = "failed"
        return None
    actual_source = downloaded_files[0]

    # Wait if paused before starting
    pause_event.wait()
    if cancel_flags.get(job_id, False) or idx in job.get("skipped_parts", set()):
        if 0 <= idx < len(job.get("parts_status", [])):
            job["parts_status"][idx]["status"] = "skipped"
        return None

    if 0 <= idx < len(job.get("parts_status", [])):
        job["parts_status"][idx]["status"] = "clipping"

    start = float(clip["start"])
    end = float(clip["end"])
    duration = max(0.1, end - start)
    clip_title = clip.get("title") or f"Part {idx + 1}"
    safe_title = sanitize_filename(clip_title)
    ext = "mp3" if format_type == "mp3" else "mp4"
    output_filename = f"{idx + 1:03d}_{safe_title}.{ext}"
    output_path = job_dir / output_filename

    # Build FFmpeg command
    ffmpeg_bin = get_ffmpeg_binary()
    if format_type == "mp3":
        cmd = [
            ffmpeg_bin, "-y",
            "-ss", str(start),
            "-i", str(actual_source),
            "-t", str(duration),
            "-vn", "-c:a", "libmp3lame", "-b:a", "192k",
            str(output_path)
        ]
    elif fast_cut and aspect_ratio == "original":
        cmd = [
            ffmpeg_bin, "-y",
            "-ss", str(start),
            "-i", str(actual_source),
            "-t", str(duration),
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            str(output_path)
        ]
    else:
        filters = []
        if aspect_ratio == "shorts_9_16":
            filters.append("crop=ih*(9/16):ih,scale=1080:1920")

        cmd = [
            ffmpeg_bin, "-y",
            "-ss", str(start),
            "-i", str(actual_source),
            "-t", str(duration)
        ]
        if filters:
            cmd.extend(["-vf", ",".join(filters)])
        cmd.extend([
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "128k",
            str(output_path)
        ])

    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    active_subprocesses[(job_id, idx)] = proc
    try:
        proc.wait()
    finally:
        active_subprocesses.pop((job_id, idx), None)

    # Check if user cancelled/skipped this part while running
    if idx in job.get("skipped_parts", set()):
        if 0 <= idx < len(job.get("parts_status", [])):
            job["parts_status"][idx]["status"] = "skipped"
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return None

    # Wait if paused before registering completion
    pause_event.wait()

    if output_path.exists() and idx not in job.get("skipped_parts", set()):
        file_info = {
            "index": idx,
            "title": clip_title,
            "filename": output_filename,
            "size_bytes": output_path.stat().st_size,
            "duration": duration,
            "duration_formatted": format_seconds(duration),
            "download_url": f"/api/download/{job_id}/clip/{idx}"
        }
        if 0 <= idx < len(job.get("parts_status", [])):
            job["parts_status"][idx]["status"] = "done"
            job["parts_status"][idx]["download_url"] = file_info["download_url"]
            job["parts_status"][idx]["filename"] = file_info["filename"]
            job["parts_status"][idx]["size_bytes"] = file_info["size_bytes"]
            job["parts_status"][idx]["duration_formatted"] = file_info["duration_formatted"]
        return file_info
    return None


def resume_part_service(job_id: str, part_index: int) -> bool:
    """Resume / slice an individual part that was previously skipped, paused, or after clipping is done."""
    if job_id not in jobs:
        return False
    job = jobs[job_id]
    if "skipped_parts" in job and part_index in job["skipped_parts"]:
        job["skipped_parts"].remove(part_index)

    cancel_flags[job_id] = False

    if job_id not in pause_events:
        pe = threading.Event()
        pe.set()
        pause_events[job_id] = pe
    else:
        pause_events[job_id].set()

    job["is_paused"] = False

    if 0 <= part_index < len(job.get("parts_status", [])):
        job["parts_status"][part_index]["status"] = "clipping"

    job["status"] = "clipping"
    job["stage"] = "clipping"
    job["message"] = f"Resuming part {part_index + 1}..."

    def resume_worker():
        try:
            file_info = execute_slice_clip(job_id, part_index, pause_events[job_id])
            if file_info:
                existing = [f for f in job.get("files", []) if f.get("index") != part_index]
                existing.append(file_info)
                existing.sort(key=lambda x: x["index"])
                job["files"] = existing
                update_zip_archive(job_id)

            done_count = len([p for p in job.get("parts_status", []) if p.get("status") == "done"])
            job["completed_clips"] = done_count
            total_parts = job.get("total_parts", len(job.get("parts_status", [])))
            skipped_count = len(job.get("skipped_parts", set()))

            if (done_count + skipped_count) >= total_parts:
                job["status"] = "completed"
                job["progress"] = 100
                job["message"] = f"All {done_count} parts sliced and ready!"
            else:
                job["progress"] = int(35 + (((done_count + skipped_count) / total_parts) * 58))
                job["message"] = f"Parallel clipping: {done_count} done of {total_parts} parts..."
        except Exception as e:
            print(f"Error resuming part {part_index}: {e}")

    executor.submit(resume_worker)
    return True



def extract_video_info(url: str) -> Dict[str, Any]:
    """Fetch metadata of the video without downloading."""
    ydl_opts = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        duration = info.get("duration", 0)
        return {
            "id": info.get("id", ""),
            "title": info.get("title", "Unknown Title"),
            "uploader": info.get("uploader", "Unknown Channel"),
            "duration": duration,
            "duration_formatted": format_seconds(duration),
            "thumbnail": info.get("thumbnail", ""),
            "description": (info.get("description") or "")[:200],
        }


def process_clipping_job(job_id: str, payload: Dict[str, Any]):
    """Background worker for multi-threaded download and TRUE parallel slicing."""
    completed_files = []
    try:
        job = jobs.get(job_id)
        if not job:
            return
        job["payload"] = payload
        job_dir = BASE_DOWNLOAD_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        # Initialize pause event: Set = running, Clear = paused
        pause_event = threading.Event()
        pause_event.set()
        pause_events[job_id] = pause_event
        cancel_flags[job_id] = False

        url = payload["url"]
        clips = payload["clips"]  # list of {title, start, end}
        quality = payload.get("quality", "1080p")
        format_type = payload.get("format", "mp4")
        aspect_ratio = payload.get("aspect_ratio", "original")
        fast_cut = payload.get("fast_cut", True)

        total_clips = len(clips)
        job["total_parts"] = total_clips
        job["completed_clips"] = 0
        job["stage"] = "downloading"
        job["is_paused"] = False
        job["is_cancelled"] = False
        if "skipped_parts" not in job:
            job["skipped_parts"] = set()

        # Initialize per-part live status
        job["parts_status"] = [
            {
                "index": idx + 1,
                "title": clip.get("title") or f"Part {idx + 1}",
                "range": f"{format_seconds(float(clip['start']))} - {format_seconds(float(clip['end']))}",
                "status": "skipped" if idx in job["skipped_parts"] else "pending",
            }
            for idx, clip in enumerate(clips)
        ]

        job["status"] = "downloading_source"
        job["message"] = "Connecting to YouTube and downloading source video..."
        job["progress"] = 5

        # Progress hook with responsive Pause and Cancel support during download!
        def ydl_progress_hook(d):
            # 1. Check for cancel/stop
            if cancel_flags.get(job_id, False):
                raise RuntimeError("Download stopped by user.")

            # 2. Check for pause (hangs loop until resumed or cancelled)
            if not pause_event.is_set():
                job["status"] = "paused"
                job["message"] = f"Paused during video download ({job.get('download_pct', 0):.0f}%). Click Resume to continue."
                while not pause_event.is_set():
                    if cancel_flags.get(job_id, False):
                        raise RuntimeError("Download stopped by user.")
                    time.sleep(0.2)
                job["status"] = "downloading_source"

            # 3. Update download progress
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                speed = d.get("speed") or 0
                speed_str = f" ({speed / (1024 * 1024):.1f} MB/s)" if speed else ""

                if total > 0:
                    pct = (downloaded / total) * 100
                    job["download_pct"] = pct
                    job["progress"] = int(5 + (pct * 0.30))
                    job["message"] = f"Downloading source video from YouTube: {pct:.0f}%{speed_str}..."
                else:
                    job["message"] = f"Downloading source video{speed_str}..."

        ffmpeg_loc = get_ffmpeg_binary()

        if format_type == "mp3":
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": str(job_dir / "source.%(ext)s"),
                "concurrent_fragment_downloads": 4,
                "retries": 10,
                "fragment_retries": 10,
                "nocheckcertificate": True,
                "quiet": True,
                "no_warnings": True,
                "ffmpeg_location": ffmpeg_loc,
                "progress_hooks": [ydl_progress_hook],
            }
        else:
            if quality == "480p":
                h_limit = 480
            elif quality == "720p":
                h_limit = 720
            elif quality == "1080p":
                h_limit = 1080
            else:
                h_limit = 2160

            ydl_opts = {
                "format": (
                    f"bestvideo[height<={h_limit}][ext=mp4]+bestaudio[ext=m4a]/"
                    f"best[height<={h_limit}][ext=mp4]/"
                    f"bestvideo[height<={h_limit}]+bestaudio/"
                    f"best[height<={h_limit}]/best"
                ),
                "outtmpl": str(job_dir / "source.%(ext)s"),
                "merge_output_format": "mp4",
                "concurrent_fragment_downloads": 4,
                "retries": 10,
                "fragment_retries": 10,
                "nocheckcertificate": True,
                "quiet": True,
                "no_warnings": True,
                "ffmpeg_location": ffmpeg_loc,
                "progress_hooks": [ydl_progress_hook],
            }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        if cancel_flags.get(job_id, False):
            job["status"] = "cancelled"
            job["message"] = "Job stopped by user."
            return

        # Locate downloaded source video
        downloaded_files = list(job_dir.glob("source.*"))
        if not downloaded_files:
            raise RuntimeError("Source video could not be downloaded from YouTube.")

        # Stage: PARALLEL CLIPPING
        job["stage"] = "clipping"
        job["status"] = "clipping"
        job["message"] = f"Slicing all {total_clips} parts in parallel..."
        job["progress"] = 35

        completed_files = []
        completed_lock = threading.Lock()

        # Dynamic parallel worker pool: 4 to 16 threads
        worker_threads = min(16, max(4, min(total_clips, (os.cpu_count() or 4) * 2)))

        def clip_worker(idx: int):
            file_info = execute_slice_clip(job_id, idx, pause_event)
            if file_info:
                with completed_lock:
                    completed_files.append(file_info)
                    existing = [f for f in job.get("files", []) if f.get("index") != idx]
                    existing.append(file_info)
                    existing.sort(key=lambda x: x["index"])
                    job["files"] = existing

            with completed_lock:
                done_count = len(completed_files)
                skipped_count = len(job.get("skipped_parts", set()))
                job["completed_clips"] = done_count
                processed_total = done_count + skipped_count
                job["progress"] = int(35 + ((processed_total / total_clips) * 58))
                job["message"] = f"Parallel clipping: {done_count} done, {skipped_count} skipped of {total_clips} parts..."

        # Launch all clips concurrently in the thread pool!
        with ThreadPoolExecutor(max_workers=worker_threads) as clip_pool:
            futures = [clip_pool.submit(clip_worker, idx) for idx in range(total_clips)]
            for f in futures:
                f.result()

        was_cancelled = cancel_flags.get(job_id, False)

        if completed_files:
            job["stage"] = "zipping"
            job["message"] = f"Packaging {len(completed_files)} parts into ZIP archive..."
            job["progress"] = 96
            update_zip_archive(job_id)

        job["progress"] = 100
        if was_cancelled and len(completed_files) < total_clips:
            job["status"] = "cancelled"
            job["message"] = f"Clipping stopped. Saved {len(completed_files)} of {total_clips} parts."
        else:
            job["status"] = "completed"
            job["message"] = f"All {len(completed_files)} parts sliced and ready!"

    except Exception as e:
        if cancel_flags.get(job_id, False):
            job["status"] = "cancelled"
            job["message"] = f"Job stopped by user. Saved {len(completed_files or [])} parts."
        else:
            job["status"] = "failed"
            job["message"] = f"Error: {str(e)}"
            job["error"] = str(e)
            print(f"Job {job_id} error: {e}")
    finally:
        # Cleanup events
        pause_events.pop(job_id, None)
        cancel_flags.pop(job_id, None)
