# PanganTrack

Dashboard prediksi harga komoditas pangan nasional & daerah berbasis **LightGBM**.

## Struktur

```
PanganTrack/
├─ api/              # FastAPI: endpoint prediksi & bootstrap data
├─ frontend/         # Static dashboard (HTML/CSS/JS vanilla)
├─ data/processed/   # Dataset hasil preprocessing
├─ models/           # (legacy) folder model — gunakan api/models/ saja
├─ notebooks/        # 01..04: convert, EDA, preprocessing, forecasting
└─ requirements.txt
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # isi DB_PASSWORD jika MySQL aktif
```

## Jalankan

```bash
uvicorn api.main:app --reload --port 8000
```

Buka **http://127.0.0.1:8000/** — frontend di-serve oleh FastAPI di host yang sama,
sehingga tidak perlu live-server terpisah dan tidak ada masalah CORS.

> MySQL **opsional**. Jika tidak tersedia, API tetap jalan; logging prediksi saja
> yang dilewati.

## Endpoint API

| Method | Path | Keterangan |
|---|---|---|
| GET  | `/api/bootstrap`     | Bulk data untuk dashboard (labels, areas, komoditas, harga nasional & daerah) |
| GET  | `/api/wilayah`       | List wilayah unik di dataset |
| GET  | `/api/komoditas`     | List komoditas unik di dataset |
| GET  | `/api/history`       | History harga aktual `(?wilayah=&komoditas=)` |
| POST | `/api/predict`       | Prediksi 1 (wilayah, komoditas, n_bulan) |
| POST | `/api/predict-bulk`  | Batch prediksi banyak request sekaligus |
| GET  | `/api/prediksi-log`  | History prediksi (butuh MySQL) |

Dokumentasi interaktif Swagger: **http://127.0.0.1:8000/docs**
