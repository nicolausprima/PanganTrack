import os
import joblib
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.preprocessing import LabelEncoder, RobustScaler

# Setup Paths
BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data" / "processed" / "harga_gabungan.csv"
API_MODELS_DIR = BASE_DIR / "api" / "models" / "per_komoditas"
MODELS_DIR = BASE_DIR / "models" / "per_komoditas"

# 1. Load raw dataset
print("Loading dataset...")
df = pd.read_csv(DATA_PATH)
df["tanggal"] = pd.to_datetime(df["tanggal"])
df = df.sort_values(["wilayah", "komoditas", "tanggal"]).reset_index(drop=True)

# 2. Handle missing values
df["harga"] = df.groupby(["wilayah", "komoditas"])["harga"].transform("ffill")
df = df.dropna(subset=["harga"]).reset_index(drop=True)

# 3. Feature Engineering
print("Generating features...")
df["tahun"] = df["tanggal"].dt.year
df["bulan"] = df["tanggal"].dt.month
df["kuartal"] = df["tanggal"].dt.quarter

df["harga_lag1"] = df.groupby(["wilayah", "komoditas"])["harga"].shift(1)
df["harga_lag2"] = df.groupby(["wilayah", "komoditas"])["harga"].shift(2)
df["harga_lag3"] = df.groupby(["wilayah", "komoditas"])["harga"].shift(3)
df["harga_rolling3"] = df.groupby(["wilayah", "komoditas"])["harga"].transform(
    lambda x: x.shift(1).rolling(3).mean()
)
df["harga_lag12"] = df.groupby(["wilayah", "komoditas"])["harga"].shift(12)

df["sin_bulan"] = np.sin(2 * np.pi * df["bulan"] / 12)
df["cos_bulan"] = np.cos(2 * np.pi * df["bulan"] / 12)

# Lebaran Month mapping
lebaran_months = {
    2019: 6, 2020: 5, 2021: 5, 2022: 5, 2023: 4, 2024: 4, 2025: 3, 2026: 3, 2027: 2, 2028: 2
}
df["is_lebaran_month"] = df.apply(
    lambda r: 1 if lebaran_months.get(int(r["tahun"])) == int(r["bulan"]) else 0, axis=1
)

df["tren_index"] = df.groupby(["wilayah", "komoditas"]).cumcount()
df["harga_rolling12"] = df.groupby(["wilayah", "komoditas"])["harga"].transform(
    lambda x: x.shift(1).rolling(12).mean()
)

# Drop missing values after shifts/rolls
df = df.dropna().reset_index(drop=True)

# Label encode Wilayah (consistent with global Encoder)
le_wilayah = LabelEncoder()
df["wilayah_enc"] = le_wilayah.fit_transform(df["wilayah"])

# Filter training set using cutoff
df_train = df[df["tanggal"] < "2024-11-01"].copy()

FITUR = [
    "tahun", "bulan", "kuartal", "wilayah_enc",
    "harga_lag1", "harga_lag2", "harga_lag3", "harga_rolling3",
    "harga_lag12", "sin_bulan", "cos_bulan", "is_lebaran_month",
    "tren_index", "harga_rolling12"
]

print("Fitting and saving per-commodity RobustScalers...")
commodities = df["komoditas"].unique()
for kom in commodities:
    folder_name = kom.replace(' ', '_').replace('/', '-')
    df_k = df_train[df_train["komoditas"] == kom]
    
    if len(df_k) == 0:
        print(f"Warning: No training data for commodity '{kom}' before cutoff.")
        continue
        
    scaler = RobustScaler()
    scaler.fit(df_k[FITUR])
    
    # Save to api/models/per_komoditas/...
    api_folder = API_MODELS_DIR / folder_name
    api_folder.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, api_folder / "scaler.joblib")
    
    # Save to models/per_komoditas/...
    models_folder = MODELS_DIR / folder_name
    models_folder.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, models_folder / "scaler.joblib")
    
    print(f"Saved RobustScaler for '{kom}' ({folder_name})")

print("All per-commodity RobustScalers reconstructed successfully!")
