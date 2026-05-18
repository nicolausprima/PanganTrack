import os
import logging
from datetime import datetime

from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DB_USER     = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST     = os.getenv("DB_HOST", "localhost")
DB_PORT     = os.getenv("DB_PORT", "3306")
DB_NAME     = os.getenv("DB_NAME", "pbl_forecast")

DATABASE_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

Base = declarative_base()

class PrediksiLog(Base):
    __tablename__ = "prediksi_log"
    id         = Column(Integer, primary_key=True, index=True)
    wilayah    = Column(String(100))
    komoditas  = Column(String(200))
    n_bulan    = Column(Integer)
    hasil      = Column(Text)
    created_at = Column(DateTime, default=datetime.now)

# Lazy — engine dibuat hanya saat diperlukan
_engine       = None
_SessionLocal = None

def _get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3}  # timeout cepat
        )
        _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)
    return _engine, _SessionLocal

def init_db() -> bool:
    try:
        engine, _ = _get_engine()
        Base.metadata.create_all(bind=engine)
        logger.info("MySQL connected.")
        return True
    except Exception as e:
        logger.warning("MySQL tidak tersedia: %s", e)
        return False

def get_db():
    try:
        _, SessionLocal = _get_engine()
        db = SessionLocal()
        yield db
        db.close()
    except Exception:
        yield None
