import os
import json
from pathlib import Path
from typing import List, Optional, Dict

import joblib
import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, HTTPException, Depends, Query, Body

from schemas.predict import (
    PredictRequest,
    PredictResponse,
    HistoryResponse,
)

try:
    from sqlalchemy.orm import Session
    from configs.database import get_db, PrediksiLog
    HAS_DB = True
except ImportError:
    HAS_DB = False
    Session = None
    def get_db():
        yield None
    PrediksiLog = None

router = APIRouter()

# ── Path dataset & model ─────────────────────────────────────────────────────
BASE_DIR  = Path(__file__).resolve().parent.parent.parent
DATA_PATH = BASE_DIR / "data" / "processed" / "harga_gabungan.csv"
MODEL_DIR = Path(__file__).resolve().parent.parent / "models"

# ── Load model & encoder (sekali saat import) ────────────────────────────────
le_wilayah   = joblib.load(MODEL_DIR / "le_wilayah.joblib")
le_komoditas = joblib.load(MODEL_DIR / "le_komoditas.joblib")

try:
    with open(MODEL_DIR / "per_komoditas_params.json", "r") as f:
        per_komoditas_params = json.load(f)
except FileNotFoundError:
    per_komoditas_params = {}

WILAYAH_SET   = set(le_wilayah.classes_.tolist())
KOMODITAS_SET = set(le_komoditas.classes_.tolist())

FITUR = [
    "tahun", "bulan", "kuartal",
    "wilayah_enc", "komoditas_enc",
    "harga_lag1", "harga_lag2", "harga_lag3", "harga_rolling3",
    "harga_lag12", "sin_bulan", "cos_bulan", "is_lebaran_month",
    "tren_index", "harga_rolling12",
]

# ── Load dataset ──────────────────────────────────────────────────────────────
dataset = pd.read_csv(DATA_PATH)
dataset["tanggal"] = pd.to_datetime(dataset["tanggal"])

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


def _get_last_prices(wilayah: str, komoditas: str, n: int = 12) -> List[float]:
    subset = (
        dataset[(dataset["wilayah"] == wilayah) & (dataset["komoditas"] == komoditas)]
        .sort_values("tanggal")
        .dropna(subset=["harga"])
    )
    if len(subset) < n:
        raise HTTPException(
            status_code=404,
            detail=f"Data historis tidak cukup untuk {komoditas} di {wilayah} (butuh minimal {n} bulan)",
        )
    return subset["harga"].iloc[-n:].tolist()


def _is_lebaran(tahun: int, bulan: int) -> int:
    lebaran_months = {
        2019: 6, 2020: 5, 2021: 5, 2022: 5, 2023: 4, 2024: 4, 2025: 3, 2026: 3, 2027: 2, 2028: 2
    }
    return 1 if lebaran_months.get(tahun) == bulan else 0


def _forecast(wilayah: str, komoditas: str, n_bulan: int) -> tuple:
    if wilayah not in WILAYAH_SET:
        raise HTTPException(status_code=400, detail=f"Wilayah '{wilayah}' tidak dikenali")
    if komoditas not in KOMODITAS_SET:
        raise HTTPException(status_code=400, detail=f"Komoditas '{komoditas}' tidak dikenali")

    wilayah_enc   = int(le_wilayah.transform([wilayah])[0])
    komoditas_enc = int(le_komoditas.transform([komoditas])[0])

    folder_name = komoditas.replace(' ', '_').replace('/', '-')
    
    # Ambil tipe model
    model_type = "lgbm"
    if komoditas in per_komoditas_params:
        model_type = per_komoditas_params[komoditas].get("model_type", "lgbm")

    # Load Scaler & Model Dinamis berdasarkan tipe model
    if model_type == "naive":
        model_komoditas = None
        scaler_robust = None
        scaler_standard = None
    elif model_type == "ridge":
        # 1. Load RobustScaler
        scaler_robust_path = MODEL_DIR / "per_komoditas" / folder_name / "scaler.joblib"
        if not scaler_robust_path.exists():
            scaler_robust_path = MODEL_DIR / "scaler.joblib"
        if not scaler_robust_path.exists():
            raise HTTPException(status_code=500, detail=f"RobustScaler tidak ditemukan untuk komoditas {komoditas}")
        scaler_robust = joblib.load(scaler_robust_path)

        # 2. Load StandardScaler (ridge_scaler.joblib)
        scaler_standard_path = MODEL_DIR / "per_komoditas" / folder_name / "ridge_scaler.joblib"
        if not scaler_standard_path.exists():
            raise HTTPException(status_code=500, detail=f"Ridge scaler tidak ditemukan untuk komoditas {komoditas}")
        scaler_standard = joblib.load(scaler_standard_path)

        # 3. Load Ridge model
        model_path = MODEL_DIR / "per_komoditas" / folder_name / "ridge_model.joblib"
        if not model_path.exists():
            raise HTTPException(status_code=500, detail=f"Ridge model tidak ditemukan untuk komoditas {komoditas}")
        model_komoditas = joblib.load(model_path)
    else:
        # LGBM expects RobustScaled(features)
        # 1. Load RobustScaler (scaler.joblib)
        scaler_robust_path = MODEL_DIR / "per_komoditas" / folder_name / "scaler.joblib"
        if not scaler_robust_path.exists():
            scaler_robust_path = MODEL_DIR / "scaler.joblib"
        if not scaler_robust_path.exists():
            raise HTTPException(status_code=500, detail=f"RobustScaler tidak ditemukan untuk komoditas {komoditas}")
        scaler_robust = joblib.load(scaler_robust_path)
        scaler_standard = None

        # 2. Load LGBM model
        model_path = MODEL_DIR / "per_komoditas" / folder_name / "lgbm_model.joblib"
        if not model_path.exists():
            model_path = MODEL_DIR / "lgbm_final.joblib"
            if not model_path.exists():
                raise HTTPException(status_code=500, detail=f"Model tidak ditemukan untuk komoditas {komoditas}")
        model_komoditas = joblib.load(model_path)

    harga_history = _get_last_prices(wilayah, komoditas, n=12)

    subset_hist = dataset[
        (dataset["wilayah"] == wilayah) & (dataset["komoditas"] == komoditas)
    ].dropna(subset=["harga"])
    
    start_tren = len(subset_hist)
    last_date = subset_hist["tanggal"].max()
    start_date = (last_date + relativedelta(months=1)).replace(day=1)

    hasil = []
    for i in range(n_bulan):
        tgl = start_date + relativedelta(months=i)
        
        # Hitung fitur musiman & tren secara dinamis
        sin_bulan = float(np.sin(2 * np.pi * tgl.month / 12))
        cos_bulan = float(np.cos(2 * np.pi * tgl.month / 12))
        is_lebaran = _is_lebaran(tgl.year, tgl.month)
        tren = start_tren + i
        rolling12 = float(np.mean(harga_history[-12:]))
        
        row = pd.DataFrame([{
            "tahun":            tgl.year,
            "bulan":            tgl.month,
            "kuartal":          (tgl.month - 1) // 3 + 1,
            "wilayah_enc":      wilayah_enc,
            "komoditas_enc":    komoditas_enc,
            "harga_lag1":       harga_history[-1],
            "harga_lag2":       harga_history[-2],
            "harga_lag3":       harga_history[-3],
            "harga_rolling3":   float(np.mean(harga_history[-3:])),
            "harga_lag12":      harga_history[-12],
            "sin_bulan":        sin_bulan,
            "cos_bulan":        cos_bulan,
            "is_lebaran_month": is_lebaran,
            "tren_index":       tren,
            "harga_rolling12":  rolling12,
        }])

        if model_type == "naive":
            pred_harga = float(harga_history[-1])
        else:
            # 1. Apply RobustScaler
            expected_fitur_robust = list(scaler_robust.feature_names_in_)
            row_robust = pd.DataFrame(scaler_robust.transform(row[expected_fitur_robust]), columns=expected_fitur_robust)

            # 2. Apply StandardScaler if Ridge
            if model_type == "ridge":
                expected_fitur_std = list(scaler_standard.feature_names_in_)
                row_scaled = pd.DataFrame(scaler_standard.transform(row_robust[expected_fitur_std]), columns=expected_fitur_std)
            else:
                row_scaled = row_robust

            # 3. Predict
            if model_type == "ridge":
                pred_harga = float(model_komoditas.predict(row_scaled.values)[0])
            else:
                pred_harga = float(model_komoditas.predict(row_scaled)[0])

        hasil.append({
            "tanggal":        tgl.strftime("%Y-%m-%d"),
            "harga_prediksi": round(pred_harga, 0),
        })

        # Tambahkan prediksi ke histori harga agar bisa digunakan sebagai lag berikutnya
        harga_history.append(pred_harga)

    return hasil, model_type


@router.get("/wilayah", summary="List semua wilayah")
def get_wilayah():
    return {"wilayah": sorted(dataset["wilayah"].unique().tolist())}


@router.get("/komoditas", summary="List semua komoditas")
def get_komoditas():
    return {"komoditas": sorted(dataset["komoditas"].unique().tolist())}


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


@router.get("/bootstrap", summary="Bulk data untuk dashboard frontend")
def bootstrap(nasional_label: str = Query("Nasional")):
    df = dataset.copy()
    df["label"] = df["tanggal"].dt.strftime("%Y-%m")

    labels = sorted(df["label"].unique().tolist())
    all_wilayah    = sorted(df["wilayah"].unique().tolist())
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
        return [None if pd.isna(v) else round(float(v), 2) for v in row.tolist()]

    nasional_data = {kom: _series_for(nasional_label, kom) for kom in komoditas_list}
    daerah_data   = {area: {kom: _series_for(area, kom) for kom in komoditas_list} for area in areas}
    icon_map      = {kom: _icon_for(kom) for kom in komoditas_list}

    # Mapping komoditas -> model_type untuk frontend
    model_types = {}
    for kom in komoditas_list:
        if kom in per_komoditas_params:
            model_types[kom] = per_komoditas_params[kom].get("model_type", "lgbm")
        else:
            model_types[kom] = "lgbm"

    return {
        "labels":         labels,
        "areas":          areas,
        "nasional_label": nasional_label,
        "komoditas_list": komoditas_list,
        "komoditas_icon": icon_map,
        "nasional":       nasional_data,
        "daerah":         daerah_data,
        "model_types":    model_types,
    }


@router.post("/predict", summary="Prediksi harga ke depan")
def predict(req: PredictRequest, db=Depends(get_db)):
    hasil, model_type = _forecast(req.wilayah, req.komoditas, req.n_bulan)

    if HAS_DB and db is not None:
        try:
            log = PrediksiLog(
                wilayah=req.wilayah,
                komoditas=req.komoditas,
                n_bulan=req.n_bulan,
                hasil=json.dumps(hasil),
            )
            db.add(log)
            db.commit()
        except Exception:
            db.rollback()

    return {
        "wilayah":    req.wilayah,
        "komoditas":  req.komoditas,
        "n_bulan":    req.n_bulan,
        "prediksi":   hasil,
        "model_type": model_type,
    }


@router.post("/predict-bulk", summary="Prediksi banyak sekaligus")
def predict_bulk(items: List[PredictRequest] = Body(...)):
    out = []
    for it in items:
        try:
            hasil, model_type = _forecast(it.wilayah, it.komoditas, it.n_bulan)
            out.append({
                "wilayah":    it.wilayah,
                "komoditas":  it.komoditas,
                "n_bulan":    it.n_bulan,
                "prediksi":   hasil,
                "model_type": model_type,
                "error":      None,
            })
        except HTTPException as e:
            out.append({
                "wilayah":    it.wilayah,
                "komoditas":  it.komoditas,
                "n_bulan":    it.n_bulan,
                "prediksi":   [],
                "model_type": None,
                "error":      e.detail,
            })
    return {"results": out}


@router.get("/prediksi-log", summary="History prediksi")
def get_prediksi_log(
    wilayah: Optional[str] = None,
    komoditas: Optional[str] = None,
    limit: int = 20,
    db=Depends(get_db),
):
    if not HAS_DB or db is None:
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