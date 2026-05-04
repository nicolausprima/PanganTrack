from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from schemas.predict import PredictRequest, PredictResponse, HistoryResponse
from configs.database import get_db, PrediksiLog
import pandas as pd
import numpy as np
import json
from dateutil.relativedelta import relativedelta
import joblib
import os

router = APIRouter()

# ── Load model & encoder ─────────────────────────────────────────────────────
BASE_DIR  = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "data", "processed", "harga_gabungan.csv")
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")

model        = joblib.load(os.path.join(MODEL_DIR, "lgbm_final.joblib"))
scaler       = joblib.load(os.path.join(MODEL_DIR, "scaler.joblib"))
le_wilayah   = joblib.load(os.path.join(MODEL_DIR, "le_wilayah.joblib"))
le_komoditas = joblib.load(os.path.join(MODEL_DIR, "le_komoditas.joblib"))

FITUR = ["tahun", "bulan", "kuartal", "wilayah_enc", "komoditas_enc",
         "harga_lag1", "harga_lag2", "harga_lag3", "harga_rolling3"]

dataset = pd.read_csv(DATA_PATH)
dataset["tanggal"] = pd.to_datetime(dataset["tanggal"])


def _get_last_prices(wilayah: str, komoditas: str, n: int = 3) -> list:
    subset = (
        dataset[(dataset["wilayah"] == wilayah) & (dataset["komoditas"] == komoditas)]
        .sort_values("tanggal")
        .dropna(subset=["harga"])
    )
    if len(subset) < n:
        raise HTTPException(
            status_code=404,
            detail=f"Data historis tidak cukup untuk {komoditas} di {wilayah}"
        )
    return subset["harga"].iloc[-n:].tolist()


# ── GET /wilayah ──────────────────────────────────────────────────────────────
@router.get("/wilayah", summary="List semua wilayah")
def get_wilayah():
    return {"wilayah": sorted(dataset["wilayah"].unique().tolist())}


# ── GET /komoditas ────────────────────────────────────────────────────────────
@router.get("/komoditas", summary="List semua komoditas")
def get_komoditas():
    return {"komoditas": sorted(dataset["komoditas"].unique().tolist())}


# ── GET /history ──────────────────────────────────────────────────────────────
@router.get("/history", response_model=HistoryResponse, summary="History harga aktual")
def get_history(wilayah: str, komoditas: str):
    subset = (
        dataset[(dataset["wilayah"] == wilayah) & (dataset["komoditas"] == komoditas)]
        .sort_values("tanggal")
        .dropna(subset=["harga"])
    )
    if subset.empty:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan")

    history = [
        {"tanggal": row["tanggal"].strftime("%Y-%m-%d"), "harga": row["harga"]}
        for _, row in subset.iterrows()
    ]
    return {"wilayah": wilayah, "komoditas": komoditas, "history": history}


# ── GET /prediksi-log ─────────────────────────────────────────────────────────
@router.get("/prediksi-log", summary="History prediksi yang pernah dibuat")
def get_prediksi_log(
    wilayah: str = None,
    komoditas: str = None,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    query = db.query(PrediksiLog).order_by(PrediksiLog.created_at.desc())
    if wilayah:
        query = query.filter(PrediksiLog.wilayah == wilayah)
    if komoditas:
        query = query.filter(PrediksiLog.komoditas == komoditas)
    logs = query.limit(limit).all()

    return [
        {
            "id"        : log.id,
            "wilayah"   : log.wilayah,
            "komoditas" : log.komoditas,
            "n_bulan"   : log.n_bulan,
            "hasil"     : json.loads(log.hasil),
            "created_at": log.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        }
        for log in logs
    ]


# ── POST /predict ─────────────────────────────────────────────────────────────
@router.post("/predict", response_model=PredictResponse, summary="Prediksi harga ke depan")
def predict(req: PredictRequest, db: Session = Depends(get_db)):
    if req.wilayah not in le_wilayah.classes_:
        raise HTTPException(status_code=400, detail=f"Wilayah '{req.wilayah}' tidak dikenali")
    if req.komoditas not in le_komoditas.classes_:
        raise HTTPException(status_code=400, detail=f"Komoditas '{req.komoditas}' tidak dikenali")

    wilayah_enc   = int(le_wilayah.transform([req.wilayah])[0])
    komoditas_enc = int(le_komoditas.transform([req.komoditas])[0])

    harga_history = _get_last_prices(req.wilayah, req.komoditas, n=3)
    lag1, lag2, lag3 = harga_history[-1], harga_history[-2], harga_history[-3]
    rolling3 = float(np.mean(harga_history))

    last_date = (
        dataset[(dataset["wilayah"] == req.wilayah) & (dataset["komoditas"] == req.komoditas)]
        .dropna(subset=["harga"])["tanggal"]
        .max()
    )
    start_date = (last_date + relativedelta(months=1)).replace(day=1)

    hasil = []
    for i in range(req.n_bulan):
        tgl = start_date + relativedelta(months=i)

        row = pd.DataFrame([{
            "tahun"         : tgl.year,
            "bulan"         : tgl.month,
            "kuartal"       : (tgl.month - 1) // 3 + 1,
            "wilayah_enc"   : wilayah_enc,
            "komoditas_enc" : komoditas_enc,
            "harga_lag1"    : lag1,
            "harga_lag2"    : lag2,
            "harga_lag3"    : lag3,
            "harga_rolling3": rolling3,
        }])

        row_scaled = pd.DataFrame(scaler.transform(row[FITUR]), columns=FITUR)
        pred_harga = float(model.predict(row_scaled)[0])

        hasil.append({
            "tanggal"       : tgl.strftime("%Y-%m-%d"),
            "harga_prediksi": round(pred_harga, 0),
        })

        lag3     = lag2
        lag2     = lag1
        lag1     = pred_harga
        rolling3 = float(np.mean([lag1, lag2, lag3]))

    # Simpan ke MySQL
    log = PrediksiLog(
        wilayah   = req.wilayah,
        komoditas = req.komoditas,
        n_bulan   = req.n_bulan,
        hasil     = json.dumps(hasil),
    )
    db.add(log)
    db.commit()

    return {
        "wilayah"  : req.wilayah,
        "komoditas": req.komoditas,
        "n_bulan"  : req.n_bulan,
        "prediksi" : hasil,
    }