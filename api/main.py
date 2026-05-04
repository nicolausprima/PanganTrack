from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.predict import router
from configs.database import init_db

app = FastAPI(
    title="API Forecast Harga Komoditas",
    description="Prediksi harga komoditas pangan per wilayah menggunakan LightGBM",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # ganti dengan domain frontend saat production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Buat tabel MySQL saat startup ─────────────────────────────────────────────
@app.on_event("startup")
def startup():
    init_db()

# ── Register router ───────────────────────────────────────────────────────────
app.include_router(router, prefix="/api", tags=["Forecast"])


@app.get("/", tags=["Root"])
def root():
    return {"message": "API Forecast Harga Komoditas berjalan ✅"}