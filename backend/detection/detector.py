"""YOLO inference wrapper used for individual frames of uploaded videos."""
from __future__ import annotations

from pathlib import Path

import cv2


class LeopardDetector:
    """Loads a *custom leopard* model and detects leopards in video frames.

    A generic COCO model is not accepted as a stand-in for a leopard model.
    """

    def __init__(self, model_path: Path):
        # Keep heavy packages lazy so the video-inspection endpoint can work
        # even before the detection model is available.
        import torch
        from ultralytics import YOLO

        if not model_path.is_file():
            raise FileNotFoundError(
                f"Leopard model not found: {model_path}. "
                "Copy the trained best.pt into backend/models/."
            )

        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = YOLO(str(model_path))

        # Protect against a wrong model file, e.g. a generic COCO detector.
        classes = self.model.names
        if isinstance(classes, dict):
            pairs = classes.items()
        else:
            pairs = enumerate(classes)
        self.leopard_ids = [
            int(class_id)
            for class_id, class_name in pairs
            if str(class_name).strip().lower() == "leopard"
        ]
        if not self.leopard_ids:
            raise ValueError(
                "The supplied YOLO model has no 'leopard' class. "
                f"Available classes: {self.model.names}"
            )

    def predict(self, frame, confidence: float) -> list[dict]:
        """Return leopard bounding boxes for a BGR OpenCV frame.

        Each box contains integer pixel coordinates and a confidence score.
        """
        result = self.model.predict(
            source=frame,
            device=self.device,
            conf=confidence,
            classes=self.leopard_ids,
            imgsz=640,
            verbose=False,
        )[0]

        if result.boxes is None:
            return []

        detections = []
        for box in result.boxes:
            coords = box.xyxy[0].cpu().tolist()
            score = float(box.conf[0].cpu().item())
            detections.append({
                "x1": int(coords[0]),
                "y1": int(coords[1]),
                "x2": int(coords[2]),
                "y2": int(coords[3]),
                "confidence": round(score, 4),
                "class_name": "leopard",
            })
        return detections


def draw_detections(frame, detections: list[dict], seconds: float):
    """Draw annotated leopard boxes and a timestamp on an OpenCV frame."""
    for detection in detections:
        x1, y1, x2, y2 = (
            detection[key] for key in ("x1", "y1", "x2", "y2")
        )
        label = f"LEOPARD {detection['confidence'] * 100:.1f}%"
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 80), 2)
        label_y = max(22, y1 - 8)
        cv2.putText(frame, label, (x1, label_y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 220, 80), 2)

    # Visible timestamp makes the video useful for wildlife incident review.
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = int(seconds % 60)
    timestamp = f"{h:02d}:{m:02d}:{s:02d}"
    cv2.putText(frame, timestamp, (12, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.75, (255, 255, 255), 2)
    return frame
