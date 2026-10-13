"""Tests that work without a trained leopard model."""
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.detection.video_processor import process_video

client = TestClient(app)


def _make_video(path: Path, frames: int = 8):
    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (96, 64)
    )
    assert writer.isOpened(), "OpenCV MP4 codec not available"
    for i in range(frames):
        frame = np.full((64, 96, 3), 15 + i, dtype=np.uint8)
        writer.write(frame)
    writer.release()


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_video_inspection_without_model(tmp_path):
    sample = tmp_path / "test.mp4"
    _make_video(sample)
    with sample.open("rb") as stream:
        response = client.post(
            "/api/videos/inspect", files={"file": ("test.mp4", stream, "video/mp4")}
        )
    assert response.status_code == 200
    info = response.json()
    assert info["width"] == 96 and info["height"] == 64
    assert info["total_frames"] == 8
    assert "No AI detection" in info["message"]


def test_reject_invalid_extension():
    response = client.post(
        "/api/videos/inspect",
        files={"file": ("test.txt", b"not a video", "text/plain")},
    )
    assert response.status_code == 400


def test_model_missing_returns_503(monkeypatch, tmp_path):
    import backend.main as main
    monkeypatch.setattr(main, "MODEL_PATH", tmp_path / "missing.pt")
    response = client.post(
        "/api/videos/process",
        files={"file": ("test.mp4", b"not relevant", "video/mp4")},
    )
    assert response.status_code == 503
    assert "Custom leopard model" in response.json()["detail"]


def test_video_processing_with_mock_detections(tmp_path):
    # This test validates the video pipeline ONLY, not model detection quality.
    class MockDetector:
        device = "test-mock"

        def predict(self, frame, confidence):
            return [{
                "x1": 15, "y1": 12, "x2": 75, "y2": 51,
                "confidence": 0.92, "class_name": "leopard",
            }]

    sample = tmp_path / "input.mp4"
    output = tmp_path / "output.mp4"
    report = tmp_path / "report.json"
    _make_video(sample)

    result = process_video(
        sample, output, report, MockDetector(), confidence=0.5, frame_stride=1
    )
    assert output.exists() and output.stat().st_size > 0
    assert report.exists()
    assert result["total_frames"] == 8
    assert result["presence_event_count"] == 1
    assert result["first_detection_timestamp"] == "00:00:00"
