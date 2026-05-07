import os
import json
from typing import List, Optional, Dict

import joblib
import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, HTTPException, Depends, Query, Body
from sqlalchemy.orm import Session

from schemas.predict import (
    PredictRequest,
    PredictResponse,
    HistoryResponse,
)
from configs.database import get_db, PrediksiLog

router = APIRouter()

# ── Path dataset & model ─────────────────────────────────────────────────────
BASE_DIR  = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "data", "processed", "harga_gabungan.csv")
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")

# ── Load model & encoder (sekali saat import) ────────────────────────────────
model        = joblib.load(os.path.join(MODEL_DIR, "lgbm_final.joblib"))
scaler       = joblib.load(os.path.join(MODEL_DIR, "scaler.joblib"))
le_wilayah   = joblib.load(os.path.join(MODEL_DIR, "le_wilayah.joblib"))
le_komoditas = joblib.load(os.path.join(MODEL_DIR, "le_komoditas.joblib"))

WILAYAH_SET   = set(le_wilayah.classes_.tolist())
KOMODITAS_SET = set(le_komoditas.classes_.tolist())

FITUR = [
    "tahun", "bulan", "kuartal",
    "wilayah_enc", "komoditas_enc",
    "harga_lag1", "harga_lag2", "harga_lag3", "harga_rolling3",
]

# ── Load dataset ──────────────────────────────────────────────────────────────
dataset = pd.read_csv(DATA_PATH)
dataset["tanggal"] = pd.to_datetime(dataset["tanggal"])

# Mapping ikon untuk komoditas — dipakai frontend.
KOMODITAS_ICON: Dict[str, str] = {
    "Bawang Merah":  "🧅",
    "Bawang Putih":  "🧄",
    "Beras":         "🍚",
    "Cabai":         "🌶️",
    "Daging Ayam":   "🍗",
    "Daging Sapi":   "🥩",
    "Gula":          "🍬",
    "Ikan":          "🐟",
    "Jagung":        "🌽",
    "Kedelai":       "🫘",
    "Minyak":        "🛢️",
    "Telur":         "🥚",
    "Tepung":        "🌾",
}


def _icon_for(kom: str) -> str:
    for prefix, icon in KOMODITAS_ICON.items():
        if kom.lower().startswith(prefix.lower()):
            return icon
    return "📦"


def _get_last_prices(wilayah: str, komoditas: str, n: int = 3) -> List[float]:
    subset = (
        dataset[(dataset["wilayah"] == wilayah) & (dataset["komoditas"] == komoditas)]
        .sort_values("tanggal")
        .dropna(subset=["harga"])
    )
    if len(subset) < n:
        raise HTTPException(
            status_code=404,
            detail=f"Data historis tidak cukup untuk {komoditas} di {wilayah}",
        )
    return subset["harga"].iloc[-n:].tolist()


def _forecast(wilayah: str, komoditas: str, n_bulan: int) -> List[dict]:
    """Inti prediksi rekursif LightGBM. Diekspos ke endpoint /predict & /predict-bulk."""
    if wilayah not in WILAYAH_SET:
        raise HTTPException(status_code=400, detail=f"Wilayah '{wilayah}' tidak dikenali")
    if komoditas not in KOMODITAS_SET:
        raise HTTPException(status_code=400, detail=f"Komoditas '{komoditas}' tidak dikenali")

    wilayah_enc   = int(le_wilayah.transform([wilayah])[0])
    komoditas_enc = int(le_komoditas.transform([komoditas])[0])

    harga_history = _get_last_prices(wilayah, komoditas, n=3)
    lag1, lag2, lag3 = harga_history[-1], harga_history[-2], harga_history[-3]
    rolling3 = float(np.mean(harga_history))

    last_date = (
        dataset[(dataset["wilayah"] == wilayah) & (dataset["komoditas"] == komoditas)]
        .dropna(subset=["harga"])["tanggal"]
        .max()
    )
    start_date = (last_date + relativedelta(months=1)).replace(day=1)

    hasil = []
    for i in range(n_bulan):
        tgl = start_date + relativedelta(months=i)
        row = pd.DataFrame([{
            "tahun":          tgl.year,
            "bulan":          tgl.month,
            "kuartal":        (tgl.month - 1) // 3 + 1,
            "wilayah_enc":    wilayah_enc,
            "komoditas_enc":  komoditas_enc,
            "harga_lag1":     lag1,
            "harga_lag2":     lag2,
            "harga_lag3":     lag3,
            "harga_rolling3": rolling3,
        }])

        row_scaled = pd.DataFrame(scaler.transform(row[FITUR]), columns=FITUR)
        pred_harga = float(model.predict(row_scaled)[0])

        hasil.append({
            "tanggal":        tgl.strftime("%Y-%m-%d"),
            "harga_prediksi": round(pred_harga, 0),
        })

        lag3, lag2, lag1 = lag2, lag1, pred_harga
        rolling3 = float(np.mean([lag1, lag2, lag3]))

    return hasil


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


# ── GET /bootstrap ────────────────────────────────────────────────────────────
@router.get("/bootstrap", summary="Bulk data untuk dashboard frontend")
def bootstrap(nasional_label: str = Query("Nasional", description="Nama wilayah yang dianggap 'Nasional'")):
    """Mengembalikan struktur data lengkap yang dipakai dashboard:
    - labels: array 'YYYY-MM' (urut menaik)
    - areas: list daerah selain Nasional
    - komoditas_list: list komoditas
    - komoditas_icon: dict nama→emoji
    - nasional: dict komoditas→array harga (sejajar dengan labels, nilai NaN→null)
    - daerah: dict daerah→komoditas→array harga
    """
    df = dataset.copy()
    df["label"] = df["tanggal"].dt.strftime("%Y-%m")

    labels = sorted(df["label"].unique().tolist())
    all_wilayah   = sorted(df["wilayah"].unique().tolist())
    komoditas_list = sorted(df["komoditas"].unique().tolist())
    areas = [w for w in all_wilayah if w != nasional_label]

    pivot = (
        df.pivot_table(
            index=["wilayah", "komoditas"],
            columns="label",
            values="harga",
            aggfunc="mean",
        )
        .reindex(columns=labels)
    )

    def _series_for(wilayah: str, komoditas: str) -> List[Optional[float]]:
        try:
            row = pivot.loc[(wilayah, komoditas)]
        except KeyError:
            return [None] * len(labels)
        return [
            None if pd.isna(v) else round(float(v), 2)
            for v in row.tolist()
        ]

    nasional_data: Dict[str, List[Optional[float]]] = {
        kom: _series_for(nasional_label, kom) for kom in komoditas_list
    }

    daerah_data: Dict[str, Dict[str, List[Optional[float]]]] = {
        area: {kom: _series_for(area, kom) for kom in komoditas_list}
        for area in areas
    }

    icon_map = {kom: _icon_for(kom) for kom in komoditas_list}

    return {
        "labels":          labels,
        "areas":           areas,
        "nasional_label":  nasional_label,
        "komoditas_list":  komoditas_list,
        "komoditas_icon":  icon_map,
        "nasional":        nasional_data,
        "daerah":          daerah_data,
    }


# ── POST /predict ─────────────────────────────────────────────────────────────
@router.post("/predict", response_model=PredictResponse, summary="Prediksi harga ke depan")
def predict(req: PredictRequest, db: Optional[Session] = Depends(get_db)):
    hasil = _forecast(req.wilayah, req.komoditas, req.n_bulan)

    if db is not None:
        try:
            log = PrediksiLog(
                wilayah   = req.wilayah,
                komoditas = req.komoditas,
                n_bulan   = req.n_bulan,
                hasil     = json.dumps(hasil),
            )
            db.add(log)
            db.commit()
        except Exception:
            db.rollback()

    return {
        "wilayah":   req.wilayah,
        "komoditas": req.komoditas,
        "n_bulan":   req.n_bulan,
        "prediksi":  hasil,
    }


# ── POST /predict-bulk ────────────────────────────────────────────────────────
@router.post("/predict-bulk", summary="Prediksi banyak (wilayah, komoditas) sekaligus")
def predict_bulk(
    items: List[PredictRequest] = Body(..., description="Daftar permintaan prediksi"),
):
    """Versi efisien untuk dashboard yang butuh prediksi banyak komoditas/daerah sekaligus
    tanpa banyak round-trip HTTP. Tidak melakukan logging ke DB."""
    out = []
    for it in items:
        try:
            hasil = _forecast(it.wilayah, it.komoditas, it.n_bulan)
            out.append({
                "wilayah":   it.wilayah,
                "komoditas": it.komoditas,
                "n_bulan":   it.n_bulan,
                "prediksi":  hasil,
                "error":     None,
            })
        except HTTPException as e:
            out.append({
                "wilayah":   it.wilayah,
                "komoditas": it.komoditas,
                "n_bulan":   it.n_bulan,
                "prediksi":  [],
                "error":     e.detail,
            })
    return {"results": out}


# ── GET /prediksi-log ─────────────────────────────────────────────────────────
@router.get("/prediksi-log", summary="History prediksi yang pernah dibuat")
def get_prediksi_log(
    wilayah: Optional[str] = None,
    komoditas: Optional[str] = None,
    limit: int = 20,
    db: Optional[Session] = Depends(get_db),
):
    if db is None:
        return []

    query = db.query(PrediksiLog).order_by(PrediksiLog.created_at.desc())
    if wilayah:
        query = query.filter(PrediksiLog.wilayah == wilayah)
    if komoditas:
        query = query.filter(PrediksiLog.komoditas == komoditas)
    logs = query.limit(limit).all()

    return [
        {
            "id":         log.id,
            "wilayah":    log.wilayah,
            "komoditas":  log.komoditas,
            "n_bulan":    log.n_bulan,
            "hasil":      json.loads(log.hasil),
            "created_at": log.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        }
        for log in logs
    ]
