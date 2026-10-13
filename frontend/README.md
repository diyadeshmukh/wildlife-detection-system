# LeopardWatch — React Frontend (Phase 1: Uploaded Video)

This frontend uses **your existing FastAPI backend**; no mock detection data is shown. Its functionality is:

1. Upload/drag-and-drop MP4, MOV, AVI or MKV (up to 250 MiB).
2. Preview footage locally in the browser when the browser supports the codec.
3. **Inspect video:** call `POST /api/videos/inspect` and display real OpenCV metadata. This works before model training.
4. **Run leopard detection:** only enabled when `/api/health` reports `model_available: true`. Calls `POST /api/videos/process` with `confidence` and `frame_stride`.
5. Poll `GET /api/jobs/{job_id}` for progress. On completion, play and export `/video` and `/report` files. Display timestamped **presence events** (not unique leopard count).

## Start locally

**Terminal 1 — Backend** (from the project root):

```powershell
conda activate leopard_env
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — React frontend** (from the project root):

```powershell
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. Install Node.js LTS if `npm` is not recognized. You can also run `start_frontend.bat` from the project root after Node.js installation.

## API & configuration

Backend origin: `http://127.0.0.1:8000` (default).

Optional: create `.env.local` in frontend with `VITE_API_URL=http://127.0.0.1:8000` and restart Vite.

The backend includes localhost:5173 CORS authorization for development. Keep it running when using the frontend.

## Video input vs model training

Images with YOLO annotations may be used **during training**. The deployed application itself accepts **recorded videos**. A trained custom leopard `best.pt` must be put into `backend/models/best.pt`. A generic YOLO COCO checkpoint is not equivalent.

## Important limitations

- Video inspection is a real API call, but is **not** AI inference.
- Output stats are visible only after a **real inference job** completes; no invented results.
- `model_available` checks **file existence**, not accuracy or validity. Validate the model before demo claims.
- Jobs are held in backend memory: restarting FastAPI loses job status, even if output files remain on disk.
- No live CCTV input yet. CPU processing may be slow. Some AVI/MKV/MOV codecs might not preview in browsers but can still inspect/process through OpenCV.
- Not a production multi-user/authenticated surveillance service; it is an academic prototype for local use.
