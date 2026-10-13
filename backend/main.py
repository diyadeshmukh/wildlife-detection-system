"""FastAPI backend for the video-based Leopard Detection System.

Endpoints:
    GET  /api/health                    server and model status
    POST /api/videos/inspect            inspect MP4 metadata without a model
    POST /api/videos/process            start a real YOLO detection job
    GET  /api/jobs/{job_id}             job status / progress / summary
    GET  /api/jobs/{job_id}/video       annotated video for browser playback
    GET  /api/jobs/{job_id}/report      detection JSON report

Start with: python -m uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from uuid import uuid4

import cv2
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .auth import (LoginInput, RegisterInput, create_user_and_session, current_user, login_user, logout_user, _validate_origin)
from .config import (ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, MODEL_PATH,
                     OUTPUT_DIR, UPLOAD_DIR)
from .detection.video_processor import get_video_info, process_video

app = FastAPI(
    title="Leopard Detection API",
    description=(
        "Upload videos and analyze them using a custom YOLO leopard model. "
        "No model? Use /api/videos/inspect to verify video uploads."
    ),
    version="1.0.0",
)

# React development servers can call this API when running on localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# One inference job at a time prevents student laptops from exhausting RAM.
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="leopard-detection")
jobs: dict[str, dict] = {}
jobs_lock = Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_job(job_id: str, **updates):
    """Safely update a job from the background worker thread."""
    with jobs_lock:
        jobs[job_id].update(updates)
        jobs[job_id]["updated_at"] = _now()


def _get_job(job_id: str, user_id: int) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job or job["owner_id"] != user_id:
            raise HTTPException(status_code=404, detail="Job not found.")
        return dict(job)


async def _save_video(upload: UploadFile, destination: Path) -> None:
    """Stream an upload to disk with extension and file-size restrictions."""
    original_name = Path(upload.filename or "").name
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Use MP4, MOV, AVI, or MKV.",
        )

    received = 0
    try:
        with destination.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                received += len(chunk)
                if received > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail="Video too large. Maximum size is 250 MiB.",
                    )
                target.write(chunk)
        if received == 0:
            raise HTTPException(status_code=400, detail="Uploaded video is empty.")
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def _inspect_video_or_400(path: Path) -> dict:
    try:
        return get_video_info(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _run_detection(job_id: str, input_path: Path, output_path: Path,
                   report_path: Path, confidence: float, frame_stride: int):
    """Runs on a worker thread so the frontend can poll job progress."""
    try:
        from .detection.detector import LeopardDetector
        _update_job(job_id, status="processing", progress=0)
        detector = LeopardDetector(MODEL_PATH)
        result = process_video(
            input_path, output_path, report_path, detector,
            confidence=confidence,
            frame_stride=frame_stride,
            progress_callback=lambda pct: _update_job(job_id, progress=pct),
        )
        _update_job(job_id, status="completed", progress=100, result=result)
    except Exception as exc:
        # Do not misrepresent a failed job as a successful leopard detection.
        output_path.unlink(missing_ok=True)
        report_path.unlink(missing_ok=True)
        _update_job(job_id, status="failed", error=str(exc))


@app.get("/")
def index():
    return {"message": "Leopard Detection API", "documentation": "/docs"}


@app.get("/api/health")
def health():
    """Check API readiness. 'model_available' is NOT an accuracy guarantee."""
    try:
        import torch
        gpu = bool(torch.cuda.is_available())
        torch_cuda = torch.version.cuda
    except ImportError:
        gpu, torch_cuda = False, None
    return {
        "status": "ok",
        "model_available": MODEL_PATH.is_file(),
        "device": "cuda:0" if gpu else "cpu",
        "torch_cuda_version": torch_cuda,
        "model_location": "backend/models/best.pt",
    }


@app.post("/api/auth/register", status_code=201)
def register_account(data: RegisterInput, response: Response, request: Request):
    """Create an account and sign in using an HttpOnly session cookie."""
    return create_user_and_session(data, response, request)


@app.post("/api/auth/login")
def sign_in(data: LoginInput, response: Response, request: Request):
    return login_user(data, response, request)


@app.get("/api/auth/me")
def signed_in_user(user: dict = Depends(current_user)):
    return {"user": user}


@app.post("/api/auth/logout")
def sign_out(request: Request, response: Response, user: dict = Depends(current_user)):
    return logout_user(request, response, user)


@app.post("/api/videos/inspect")
async def inspect_video(request: Request, file: UploadFile = File(...), user: dict = Depends(current_user)):
    """Inspect uploaded video metadata; works BEFORE model training."""
    _validate_origin(request)
    original_name = Path(file.filename or "").name
    destination = UPLOAD_DIR / f"inspect_{uuid4().hex}{Path(original_name).suffix.lower()}"
    try:
        await _save_video(file, destination)
        info = _inspect_video_or_400(destination)
        info["original_filename"] = original_name
        info["message"] = "Video decoded successfully. No AI detection was run."
        return info
    finally:
        destination.unlink(missing_ok=True)


@app.post("/api/videos/process", status_code=202)
async def start_video_detection(
    request: Request,
    file: UploadFile = File(...),
    confidence: float = Form(0.45, ge=0.10, le=0.95),
    frame_stride: int = Form(2, ge=1, le=5),
    user: dict = Depends(current_user),
):
    """Queue a video detection job. Returns a job ID for React polling."""
    _validate_origin(request)
    if not MODEL_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail=(
                "Custom leopard model is not installed. "
                "Place trained best.pt in backend/models/. "
                "You can use /api/videos/inspect meanwhile."
            ),
        )

    original_name = Path(file.filename or "").name
    job_id = uuid4().hex
    extension = Path(original_name).suffix.lower()
    input_path = UPLOAD_DIR / f"{job_id}{extension}"
    output_path = OUTPUT_DIR / f"{job_id}_annotated.mp4"
    report_path = OUTPUT_DIR / f"{job_id}_report.json"

    await _save_video(file, input_path)
    try:
        _inspect_video_or_400(input_path)
    except Exception:
        input_path.unlink(missing_ok=True)
        raise

    with jobs_lock:
        jobs[job_id] = {
            "job_id": job_id,
            "owner_id": user["id"],
            "status": "queued",
            "progress": 0,
            "original_filename": original_name,
            "created_at": _now(),
            "updated_at": _now(),
            "result": None,
            "error": None,
        }

    executor.submit(
        _run_detection, job_id, input_path, output_path,
        report_path, confidence, frame_stride,
    )
    return {"job_id": job_id, "status": "queued", "status_url": f"/api/jobs/{job_id}"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, user: dict = Depends(current_user)):
    """Poll this endpoint while a video is being processed."""
    job = _get_job(job_id, user["id"])
    job.pop("owner_id", None)
    if job["status"] == "completed":
        job["video_url"] = f"/api/jobs/{job_id}/video"
        job["report_url"] = f"/api/jobs/{job_id}/report"
    return job


@app.get("/api/jobs/{job_id}/video")
def annotated_video(job_id: str, user: dict = Depends(current_user)):
    job = _get_job(job_id, user["id"])
    if job["status"] != "completed":
        raise HTTPException(409, "Video not ready yet.")
    output = OUTPUT_DIR / f"{job_id}_annotated.mp4"
    if not output.is_file():
        raise HTTPException(404, "Output video not found.")
    return FileResponse(output, media_type="video/mp4", filename=output.name,
                        content_disposition_type="inline")


@app.get("/api/jobs/{job_id}/report")
def json_report(job_id: str, user: dict = Depends(current_user)):
    job = _get_job(job_id, user["id"])
    if job["status"] != "completed":
        raise HTTPException(409, "Report not ready yet.")
    report = OUTPUT_DIR / f"{job_id}_report.json"
    if not report.is_file():
        raise HTTPException(404, "Report not found.")
    return FileResponse(report, media_type="application/json", filename=report.name)
