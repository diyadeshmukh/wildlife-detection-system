"""Central configuration for the Leopard Detection API."""
from pathlib import Path

# Resolve paths relative to this source file rather than the working directory.
BACKEND_DIR = Path(__file__).resolve().parent
MODEL_PATH = BACKEND_DIR / "models" / "best.pt"
UPLOAD_DIR = BACKEND_DIR / "uploads"
OUTPUT_DIR = BACKEND_DIR / "outputs"

# 250 MiB limit protects student laptops from extremely large demo uploads.
MAX_UPLOAD_BYTES = 250 * 1024 * 1024
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}

# Uploads and generated videos stay on the student's laptop.
for directory in (UPLOAD_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)
