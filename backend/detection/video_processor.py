"""Video decoding, frame inference, event grouping, and annotated MP4 export."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Callable

import cv2

from .detector import draw_detections


def get_video_info(video_path: Path) -> dict:
    """Read video metadata without requiring the leopard model."""
    capture = cv2.VideoCapture(str(video_path))
    try:
        if not capture.isOpened():
            raise ValueError("OpenCV could not open the video. Try an H.264 MP4.")

        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

        if not math.isfinite(fps) or fps <= 0 or width <= 0 or height <= 0:
            raise ValueError("Video has invalid FPS or dimensions.")

        # Some containers report unknown frame count. Decoding can still work.
        return {
            "filename": video_path.name,
            "width": width,
            "height": height,
            "fps": round(fps, 3),
            "total_frames": frames if frames > 0 else None,
            "duration_seconds": round(frames / fps, 2) if frames > 0 else None,
        }
    finally:
        capture.release()


def _clock(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 3600:02d}:{(total // 60) % 60:02d}:{total % 60:02d}"


def process_video(
    input_path: Path,
    output_path: Path,
    report_path: Path,
    detector,
    *,
    confidence: float = 0.45,
    frame_stride: int = 2,
    progress_callback: Callable[[int], None] | None = None,
) -> dict:
    """Run detection over an uploaded video and create its output/report.

    frame_stride=2 analyzes every second frame but still writes ALL frames,
    preserving the playback speed. Use stride=1 for best temporal accuracy.

    An "event" here is a period of leopard presence with at most a 1-second
    gap. Events are NOT guaranteed to represent unique individual leopards.
    """
    info = get_video_info(input_path)
    cap = cv2.VideoCapture(str(input_path))

    # Use MP4V for broad compatibility with OpenCV on Windows and Colab.
    raw_output_path = output_path.with_name(output_path.stem + "_raw.mp4")
    writer = cv2.VideoWriter(
        str(raw_output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        info["fps"],
        (info["width"], info["height"]),
    )
    if not writer.isOpened():
        cap.release()
        raise RuntimeError("Could not create output MP4. Check OpenCV codecs.")

    frame_index = 0
    inference_frames = 0
    detected_frames = 0
    max_confidence = 0.0
    first_detection_seconds = None
    last_boxes: list[dict] = []
    events: list[dict] = []
    active_event = None
    last_seen_seconds = None

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            seconds = frame_index / info["fps"]

            if frame_index % frame_stride == 0:
                # IMPORTANT: infer on real video frames, not on filenames.
                last_boxes = detector.predict(frame, confidence)
                inference_frames += 1

                if last_boxes:
                    detected_frames += 1
                    highest = max(box["confidence"] for box in last_boxes)
                    max_confidence = max(max_confidence, highest)
                    if first_detection_seconds is None:
                        first_detection_seconds = seconds

                    # Group nearby positive frames into a presence event.
                    if active_event is None or (
                        last_seen_seconds is not None
                        and seconds - last_seen_seconds > 1.0
                    ):
                        if active_event is not None:
                            events.append(active_event)
                        active_event = {
                            "start_seconds": round(seconds, 2),
                            "end_seconds": round(seconds, 2),
                            "max_confidence": highest,
                        }
                    else:
                        active_event["end_seconds"] = round(seconds, 2)
                        active_event["max_confidence"] = max(
                            active_event["max_confidence"], highest
                        )
                    last_seen_seconds = seconds

            # If inference is skipped, show the most recent boxes on that frame.
            # Frame stride 1 avoids this approximation entirely.
            frame = draw_detections(frame, last_boxes, seconds)
            writer.write(frame)
            frame_index += 1

            if progress_callback and frame_index % 20 == 0:
                if info["total_frames"]:
                    progress_callback(min(99, int(100 * frame_index / info["total_frames"])))

        if frame_index == 0:
            raise ValueError("The video contains no decodable frames.")
        if active_event is not None:
            events.append(active_event)

    finally:
        cap.release()
        writer.release()

    # MP4V written by OpenCV may not play in Chrome/Edge. Convert it to
    # browser-friendly H.264 with the bundled FFmpeg binary when available.
    # If a codec is unavailable, retain the playable-in-VLC MP4V original
    # rather than losing the entire detection result.
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        subprocess.run(
            [ffmpeg_exe, "-y", "-loglevel", "error", "-i", str(raw_output_path),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output_path)],
            check=True, capture_output=True, timeout=600,
        )
        raw_output_path.unlink(missing_ok=True)
    except (ImportError, OSError, subprocess.SubprocessError):
        output_path.unlink(missing_ok=True)
        raw_output_path.replace(output_path)

    # Build a human-readable, JSON-serializable report for React.
    report = {
        "source_video": input_path.name,
        "output_video": output_path.name,
        "device": getattr(detector, "device", "unknown"),
        "model": "best.pt",
        "confidence_threshold": confidence,
        "frame_stride": frame_stride,
        "duration_seconds": round(frame_index / info["fps"], 2),
        "fps": info["fps"],
        "resolution": f"{info['width']}x{info['height']}",
        "total_frames": frame_index,
        "frames_analyzed": inference_frames,
        "frames_with_leopard": detected_frames,
        "presence_event_count": len(events),
        "maximum_confidence": round(max_confidence, 4) if detected_frames else None,
        "first_detection_timestamp": (
            _clock(first_detection_seconds)
            if first_detection_seconds is not None else None
        ),
        "events": [
            {
                **event,
                "start_timestamp": _clock(event["start_seconds"]),
                "end_timestamp": _clock(event["end_seconds"]),
                "max_confidence": round(event["max_confidence"], 4),
            }
            for event in events
        ],
        "note": (
            "Events represent time periods with detections, not individual "
            "leopard identities. All detections require model validation."
        ),
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if progress_callback:
        progress_callback(100)
    return report
