import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api")
def root():
    return {"status": "ok"}

@app.get("/api/debug")
def debug():
    import os
    api_dir = Path(__file__).resolve().parent
    root_dir = api_dir.parent
    return {
        "files_root": os.listdir(str(root_dir)),
        "files_api": os.listdir(str(api_dir)),
        "model_exists": (api_dir / "models" / "lgbm_final.joblib").exists(),
        "csv_exists": (root_dir / "data" / "processed" / "harga_gabungan.csv").exists(),
    }
