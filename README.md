# 🐆 Leopard Detection System — Phase 1 Backend

A documented Python/FastAPI backend for **uploaded-video leopard detection**. This is **not** a CCTV live-stream implementation. Later, an RTSP camera source can feed the same frame-processing code.

## How it works

```text
React frontend (later)
    -> FastAPI upload endpoint
    -> OpenCV reads video frames
    -> Custom YOLO best.pt detects leopard
    -> Bounding boxes and timestamps drawn on frames
    -> Annotated H.264 MP4 (with FFmpeg fallback) + JSON detection report
    -> Frontend fetches job result
```

### Crucial requirement

**The system does not include a trained leopard model.** The user must train one and copy the resulting `best.pt` into `backend/models/best.pt`. A generic YOLO pretrained model is NOT a substitute for a leopard detector. If the file is missing, `/api/videos/process` returns HTTP 503 rather than fabricating detections.

## 1. Installation (Windows + Anaconda)

Open **Anaconda Prompt** or VS Code terminal in the main `leopard-detection-system` folder:

```powershell
conda activate leopard_env
python -m pip install -r backend/requirements.txt
```

Extract this starter ZIP **into the existing `leopard-detection-system` folder** so the resulting path is `leopard-detection-system/backend/main.py`. Keep your existing `frontend/`, `training/`, and `sample_videos/` folders.

### Run the server

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000/docs** for interactive API documentation.

## 2. Test video handling BEFORE model training

1. Visit `/docs`.
2. Expand **GET `/api/health`** -> **Try it out** -> **Execute**. Expect `"status": "ok"`; `"model_available": false` is expected until best.pt is copied.
3. Expand **POST `/api/videos/inspect`** -> **Try it out** -> upload an MP4 video -> **Execute**.
4. Expect video width, height, FPS, duration and frame count. This endpoint **does not perform AI detection**.

Once `best.pt` is copied into `backend/models/`, you can use **POST `/api/videos/process`** to start real leopard detection. The endpoint accepts:

- `file`: MP4, MOV, AVI, MKV video (max 250 MiB)
- `confidence`: `0.10`–`0.95`, default `0.45`
- `frame_stride`: `1`–`5`, default `2`

It returns a `job_id`. Poll **GET `/api/jobs/{job_id}`** until `status` becomes `completed`, then use the video and report URLs from that response.

## 3. Important interpretation of counts

- **Frames analyzed**: number of video frames sent to YOLO.
- **Frames with leopard**: analyzed frames that contained at least one leopard detection.
- **Presence event count**: groups nearby positive frames into approximate presence periods; **NOT unique leopard count**.
- **Confidence**: model-assigned detection confidence, not a verified probability of correctness.
- `frame_stride=2` makes inference faster but can miss short appearances; use `1` for higher temporal accuracy.
- CPU inference is supported but can be considerably slower than GPU inference. Browser playback uses an H.264 conversion when supported; if unavailable, an MP4V fallback can be downloaded and played in VLC.

## 4. Run automated backend tests

```powershell
python -m pip install pytest httpx
python -m pytest backend/tests -q
```

The mock-detection test checks **video reading/writing and reporting only**, not real leopard accuracy. Accuracy must be tested on real held-out videos once `best.pt` is available.

## 5. Device troubleshooting

Your existing `CUDA: False` means your installed PyTorch cannot currently access the NVIDIA GPU. To inspect the cause:

```powershell
python -c "import torch; print('PyTorch:', torch.__version__); print('PyTorch CUDA build:', torch.version.cuda); print('CUDA available:', torch.cuda.is_available())"
nvidia-smi
```

Don't change GPU drivers or reinstall PyTorch during the initial API smoke test. CPU video inspection works already. We can choose a compatible PyTorch CUDA wheel after confirming the installed version, laptop GPU model, and NVIDIA driver.

## 6. Academic / project integrity

Document the dataset license, training configuration, train/validation/test split, and metrics (precision, recall, mAP). Distinguish **algorithm presence events** from unique leopard identities, and test false positives (e.g. jaguars, cheetahs, shadows) with independent video footage.

For final student distribution, package the **React production build** and automate Python environment setup. This first ZIP is a **backend starter, not the entire finished application**.
