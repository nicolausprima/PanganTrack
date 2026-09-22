# 🌾 PanganTrack: Sistem Prediksi Harga Komoditas Pangan

[![Python Version](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-009688.svg?style=flat&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com/)
[![LightGBM](https://img.shields.io/badge/LightGBM-4.3+-ff6f00.svg)](https://github.com/microsoft/LightGBM)
[![Platform Vercel](https://img.shields.io/badge/Frontend-Vercel-black.svg?style=flat&logo=vercel&logoColor=white)](https://vercel.com/)
[![Platform Render](https://img.shields.io/badge/Backend-Render-black.svg?style=flat&logo=render&logoColor=white)](https://render.com/)

**PanganTrack** adalah dashboard interaktif berbasis web untuk memantau dan memproyeksikan harga 21 komoditas pangan pokok di 9 wilayah Indonesia (serta tingkat nasional) hingga 24 bulan ke depan. Proyek ini dikembangkan menggunakan model **Machine Learning (LightGBM & Ridge Regression)** yang di-deploy dengan backend **FastAPI** dan frontend **Vanilla HTML/CSS/JS**.

---

## ✨ Fitur Utama

*   **Prediksi Rekursif Multi-Bulan:** Memproyeksikan harga komoditas pangan hingga 24 bulan ke depan dengan metode *recursive forecasting*.
*   **Mekanisme Fallback Cerdas:** Secara otomatis memilih model terbaik per komoditas:
    *   **LightGBM** (model utama dengan akurasi tinggi pada pola non-linear).
    *   **Ridge Regression** (untuk komoditas volatile tinggi untuk mencegah *overfitting*).
    *   **Naive Baseline** (sebagai baseline pembanding).
*   **Dashboard Interaktif:** Visualisasi tren harga historis vs prediksi menggunakan grafik interaktif dan tabel perbandingan wilayah.
*   **Peringatan Dini & Rekomendasi:** Menyediakan insight tren otomatis (naik/turun) untuk membantu pembuat kebijakan mengantisipasi inflasi daerah.
*   **Log Prediksi Real-Time:** Logging otomatis setiap request prediksi ke database MySQL (opsional).

---

## 🛠️ Arsitektur Teknologi

*   **Machine Learning:** LightGBM, Ridge Regression, Scikit-Learn, Joblib, RobustScaler, StandardScaler.
*   **Backend:** FastAPI (Python 3.11), SQLAlchemy, Uvicorn, Pydantic.
*   **Frontend:** Vanilla HTML5, Vanilla CSS3 (modern glassmorphism), Vanilla JavaScript, Chart.js.
*   **Database:** MySQL (opsional untuk menyimpan riwayat prediksi).

---

## 📂 Struktur Proyek

```text
PanganTrack/
├── api/                    # Backend FastAPI
│   ├── configs/            # Konfigurasi database & ORM
│   ├── models/             # Model & Scaler tersimpan (.joblib)
│   ├── routes/             # Endpoint API (predict, bootstrap, dll.)
│   ├── schemas/            # Skema validasi request/response Pydantic
│   └── main.py             # Entrypoint aplikasi FastAPI & static hosting
├── frontend/               # Frontend Dashboard (HTML, CSS, JS)
│   ├── css/                # Styling (Glassmorphism & responsive layout)
│   ├── js/                 # Logika interaktivitas & fetch API
│   └── index.html          # Halaman utama dashboard
├── data/
│   ├── raw/                # Data mentah
│   └── processed/          # Dataset hasil preprocessing & split per komoditas
├── notebooks/              # Jupyter Notebooks (E2E Data Pipeline)
│   ├── 01_Convert_XLSX.ipynb
│   ├── 02_EDA.ipynb
│   ├── 03_Preprocessing.ipynb
│   ├── 04_Forecasting.ipynb
│   └── 05_Train_Per_Komoditas.ipynb
├── Dockerfile              # Docker container untuk Backend (LightGBM & FastAPI)
├── render.yaml             # Konfigurasi deployment service di Render
├── vercel.json             # Konfigurasi deployment frontend di Vercel
├── requirements.txt        # Daftar dependency Python
└── README.md
```

---

## 🚀 Panduan Instalasi & Menjalankan Aplikasi

Ikuti langkah-langkah di bawah ini untuk menjalankan PanganTrack di komputer lokal Anda:

### 1. Prasyarat (Prerequisites)
Pastikan Anda sudah menginstal **Python 3.11** di sistem Anda.

### 2. Kloning Repositori
```bash
git clone https://github.com/nicolausprima/PanganTrack.git
cd PanganTrack
```

### 3. Setup Virtual Environment (Venv)

*   **Windows (Command Prompt / PowerShell):**
    ```bash
    python -m venv .venv
    .venv\Scripts\activate
    ```
*   **Linux / macOS:**
    ```bash
    python -m venv .venv
    source .venv/bin/activate
    ```

### 4. Instalasi Dependency
```bash
pip install -r requirements.txt
```

### 5. Konfigurasi Environment Variable (`.env`)
Salin file `.env.example` menjadi `.env` dan sesuaikan konfigurasinya jika Anda ingin mengaktifkan database MySQL.

*   **Windows:**
    ```cmd
    copy .env.example .env
    ```
*   **Linux / macOS:**
    ```bash
    cp .env.example .env
    ```

> 💡 **Catatan:** Penggunaan MySQL bersifat **opsional**. Jika Anda tidak mengisi konfigurasi database di file `.env`, aplikasi tetap akan berjalan normal dan proses logging prediksi akan dilewati secara otomatis.

### 6. Jalankan Server Aplikasi
Jalankan perintah berikut pada direktori root proyek untuk mengaktifkan server FastAPI:
```bash
uvicorn api.main:app --reload --port 8000
```

Setelah server aktif (lokal):
*   Akses **Dashboard Lokal:** [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
*   Akses **Dokumentasi API Swagger (Lokal):** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

🔗 **Live Production:**
*   Akses **Dashboard Production (Vercel):** [https://pangan-track.vercel.app/](https://pangan-track.vercel.app/)
*   Akses **Backend API Service (Render):** [https://pangantrack.onrender.com/](https://pangantrack.onrender.com/)
*   Akses **Dokumentasi API Swagger (Render Live):** [https://pangantrack.onrender.com/docs](https://pangantrack.onrender.com/docs)

---

## 🔌 Dokumentasi Endpoint API Utama

| Method | Endpoint | Fungsi |
| :--- | :--- | :--- |
| `GET` | `/` | Mengecek status aktif server Backend API. |
| `GET` | `/api/bootstrap` | Memuat semua data awal dashboard (wilayah, komoditas, harga nasional, & daerah). |
| `GET` | `/api/wilayah` | Mengambil daftar wilayah yang tersedia di dataset. |
| `GET` | `/api/komoditas` | Mengambil daftar komoditas pangan yang terdaftar. |
| `GET` | `/api/history` | Mengambil data histori harga aktual berdasarkan wilayah & komoditas. |
| `POST` | `/api/predict` | Melakukan forecasting harga komoditas di wilayah tertentu untuk `N` bulan ke depan. |
| `POST` | `/api/predict-bulk` | Melakukan forecasting dalam jumlah banyak sekaligus (batch prediction). |
| `GET` | `/api/prediksi-log` | Mengambil catatan histori log prediksi yang disimpan (memerlukan MySQL). |

---

## 👥 Anggota Kelompok 9

*   **May Rizky Ardanata** (3324600005) - *Frontend Developer*
*   **Nicolaus Prima Dharma** (3324600016) - *Backend Developer*
*   **Leandro Jovan Falviano** (3324600022) - *Machine Learning & Modeling*

---

## 🌐 Arsitektur Deployment (Vercel & Render)

Proyek ini menggunakan pemisahan layanan (*decoupled architecture*):

*   **Frontend (Vercel):**
    *   URL: [https://pangan-track.vercel.app/](https://pangan-track.vercel.app/)
    *   Dihosting sebagai static web application yang di-deploy otomatis oleh Vercel menggunakan [`vercel.json`](vercel.json).
*   **Backend & ML Inference (Render):**
    *   URL: [https://pangantrack.onrender.com/](https://pangantrack.onrender.com/)
    *   Dihosting menggunakan container **Docker** melalui [`Dockerfile`](Dockerfile) dan konfigurasi [`render.yaml`](render.yaml) untuk memastikan ketersediaan pustaka runtime C++ yang dibutuhkan oleh **LightGBM** (`libgomp1`).
    *   Health check path diset ke `/api`.

