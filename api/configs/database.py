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

engine       = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base         = declarative_base()


class PrediksiLog(Base):
    __tablename__ = "prediksi_log"

    id         = Column(Integer, primary_key=True, index=True)
    wilayah    = Column(String(100))
    komoditas  = Column(String(200))
    n_bulan    = Column(Integer)
    hasil      = Column(Text)
    created_at = Column(DateTime, default=datetime.now)


def init_db() -> bool:
    """Create tables if MySQL reachable. Returns True on success, False otherwise.
    API tetap bisa jalan tanpa DB; logging prediksi saja yang dilewati."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("MySQL connected, tables ready.")
        return True
    except SQLAlchemyError as e:
        logger.warning("MySQL tidak tersedia (%s). API jalan tanpa logging prediksi.", e)
        return False


def get_db():
    """Yield a DB session, atau None jika MySQL tidak tersedia."""
    try:
        db = SessionLocal()
    except SQLAlchemyError:
        yield None
        return
    try:
        yield db
    finally:
        db.close()
