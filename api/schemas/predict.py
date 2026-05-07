from pydantic import BaseModel, Field
from typing import List


class PredictRequest(BaseModel):
    wilayah: str = Field(..., example="Jakarta")
    komoditas: str = Field(..., example="Beras Kualitas Medium I")
    n_bulan: int = Field(..., ge=1, le=24, example=6)


class PredictItem(BaseModel):
    tanggal: str
    harga_prediksi: float


class PredictResponse(BaseModel):
    wilayah: str
    komoditas: str
    n_bulan: int
    prediksi: List[PredictItem]


class HistoryItem(BaseModel):
    tanggal: str
    harga: float


class HistoryResponse(BaseModel):
    wilayah: str
    komoditas: str
    history: List[HistoryItem]