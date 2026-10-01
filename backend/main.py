import os
import time
import uuid
import threading
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services.clipper import (
    jobs,
    executor,
    format_seconds,
    extract_video_info,
    process_clipping_job,
    pause_job_service,
    resume_job_service,
    cancel_job_service,
    skip_part_service,
    resume_part_service,
    BASE_DOWNLOAD_DIR,
)



app = FastAPI(title="YouTube Video Clipper API", version="1.0.0")

# CORS setup for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class VideoInfoRequest(BaseModel):
    url: str


class ClipItem(BaseModel):
    id: Optional[str] = None
    title: Optional[str] = "Clip"
    start: float
    end: float


class ClipJobRequest(BaseModel):
    url: str
    video_title: Optional[str] = "Video"
    clips: List[ClipItem]
    quality: Optional[str] = "1080p"  # 480p, 720p, 1080p, best
    format: Optional[str] = "mp4"     # mp4 or mp3
    aspect_ratio: Optional[str] = "original"  # original or shorts_9_16
    fast_cut: Optional[bool] = True


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/video-info")
def get_video_info(req: VideoInfoRequest):
    try:
        info = extract_video_info(req.url)
        return {"success": True, "data": info}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch video: {str(e)}")


@app.post("/api/clip")
def create_clip_job(req: ClipJobRequest):
    if not req.clips:
        raise HTTPException(status_code=400, detail="No clips specified.")

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "message": "Job queued...",
        "total_clips": len(req.clips),
        "total_parts": len(req.clips),
        "completed_clips": 0,
        "files": [],
        "zip_url": None,
        "error": None,
        "is_paused": False,
        "is_cancelled": False,
        "parts_status": [
            {
                "index": idx + 1,
                "title": clip.title or f"Part {idx + 1}",
                "range": f"{format_seconds(float(clip.start))} - {format_seconds(float(clip.end))}",
                "status": "pending",
            }
            for idx, clip in enumerate(req.clips)
        ],
    }

    def safe_run():
        try:
            process_clipping_job(job_id, req.model_dump())
        except Exception as exc:
            import traceback
            traceback.print_exc()
            if job_id in jobs:
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["error"] = str(exc)
                jobs[job_id]["message"] = f"Job failed: {exc}"

    executor.submit(safe_run)

    return {"success": True, "job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.post("/api/jobs/{job_id}/pause")
def pause_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    pause_job_service(job_id)
    return {"success": True, "status": "paused"}


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    resume_job_service(job_id)
    return {"success": True, "status": "resumed"}


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    cancel_job_service(job_id)
    return {"success": True, "status": "cancelled"}


@app.post("/api/jobs/{job_id}/parts/{part_index}/skip")
def skip_part(job_id: str, part_index: int):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    success = skip_part_service(job_id, part_index)
    return {"success": success, "part_index": part_index, "status": "skipped"}


@app.post("/api/jobs/{job_id}/parts/{part_index}/resume")
def resume_part(job_id: str, part_index: int):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    success = resume_part_service(job_id, part_index)
    return {"success": success, "part_index": part_index, "status": "resumed"}


@app.post("/api/shutdown")
def shutdown_app():
    """Cleanly terminates the background application server so the user does not have to double-click stop.bat."""
    def kill_server():
        time.sleep(0.5)
        os._exit(0)

    threading.Thread(target=kill_server, daemon=True).start()
    return {"success": True, "message": "Server is shutting down"}



@app.get("/api/download/{job_id}/zip")
def download_zip(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    if job.get("status") not in ("completed", "cancelled") or not job.get("files"):
        raise HTTPException(status_code=400, detail="No files available for download yet")

    job_dir = BASE_DOWNLOAD_DIR / job_id
    zip_filename = job.get("zip_filename", "clips.zip")
    zip_path = job_dir / zip_filename
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail="Zip file not found")

    return FileResponse(
        path=str(zip_path),
        filename=zip_filename,
        media_type="application/zip",
    )



@app.get("/api/download/{job_id}/clip/{clip_index}")
def download_clip(job_id: str, clip_index: int):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    files = job.get("files", [])
    target_file = None
    for f in files:
        if f.get("index") == clip_index:
            target_file = f
            break
    if not target_file and 0 <= clip_index < len(files):
        target_file = files[clip_index]

    if not target_file:
        raise HTTPException(status_code=404, detail="Clip not found")

    file_info = target_file
    job_dir = BASE_DOWNLOAD_DIR / job_id
    file_path = job_dir / file_info["filename"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    media_type = "audio/mpeg" if file_info["filename"].endswith(".mp3") else "video/mp4"
    return FileResponse(
        path=str(file_path),
        filename=file_info["filename"],
        media_type=media_type,
    )


# Serve frontend static assets if dist folder exists
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

