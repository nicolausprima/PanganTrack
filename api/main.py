import os
import sys
import logging
from pathlib import Path

API_DIR = Path(__file__).resolve().parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.predict import router
from configs.database import init_db

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")

app = FastAPI(
    title="API Forecast Harga Komoditas",
    description="Prediksi harga komoditas pangan per wilayah menggunakan LightGBM",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    try:
        init_db()
    except Exception:
        pass  # API tetap jalan meski DB gagal

app.include_router(router, prefix="/api", tags=["Forecast"])

@app.get("/api", tags=["Root"])
def api_root():
    return {"message": "API Forecast Harga Komoditas berjalan"}

import os
from pathlib import Path

@app.get("/api/debug")
def debug():
    api_dir = Path(__file__).resolve().parent
    root_dir = api_dir.parent
    return {
        "api_dir": str(api_dir),
        "root_dir": str(root_dir),
        "data_exists": (root_dir / "data" / "processed" / "harga_gabungan.csv").exists(),
        "model_exists": (api_dir / "models" / "lgbm_final.joblib").exists(),
        "files_in_root": os.listdir(str(root_dir)),
        "files_in_api": os.listdir(str(api_dir)),
    }
