"""Datenbank-Setup und Modelle (SQLAlchemy → hk.db via HK_DB_PATH)."""
import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, String, Float, DateTime, Text, ForeignKey, Integer, text
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker, relationship
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("HK_DB_PATH", os.getenv("DB_PATH", "./data/database.db"))
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class Mandant(Base):
    """Kanzlei-Mandant — mapped auf users-Tabelle in hk.db."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, nullable=False)
    name = Column(String, nullable=False)
    kanzlei_id = Column(Integer, default=1)
    belege = relationship("Beleg", back_populates="mandant")
    kontoauszuege = relationship("Kontoauszug", back_populates="mandant")


class MandantEmail(Base):
    """Zusätzliche E-Mail-Adressen eines Mandanten."""
    __tablename__ = "mandant_emails"

    id = Column(Integer, primary_key=True, autoincrement=True)
    kanzlei_id = Column(Integer, default=1)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    email = Column(String, nullable=False)


class Beleg(Base):
    __tablename__ = "agent_belege"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kanzlei_id = Column(Integer, nullable=False, default=1)
    typ = Column(String, nullable=False)
    datum = Column(String, nullable=True)
    brutto = Column(Float, nullable=True)
    netto = Column(Float, nullable=True)
    mwst = Column(Float, nullable=True)
    rechnungsnummer = Column(String, nullable=True)
    aussteller = Column(String, nullable=True)
    empfaenger = Column(String, nullable=True)
    datei_pfad = Column(String, nullable=False)
    vorschau_pfad = Column(String, nullable=True)
    original_dateiname = Column(String, nullable=True)
    absender_email = Column(String, nullable=True)
    buchungskategorie = Column(String, nullable=True)
    datev_exportiert = Column(Integer, default=0)
    erstellt_am = Column(DateTime, default=datetime.utcnow)
    mandant = relationship("Mandant", back_populates="belege")


class Kontoauszug(Base):
    __tablename__ = "agent_kontoauszuege"

    id = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kanzlei_id = Column(Integer, nullable=False, default=1)
    kategorie = Column(String, default="kontoauszug")
    datei_pfad = Column(String, nullable=False)
    original_dateiname = Column(String, nullable=True)
    absender_email = Column(String, nullable=True)
    analyse_zusammenfassung = Column(String, nullable=True)
    transaktionen_json = Column(Text, nullable=True)
    erstellt_am = Column(DateTime, default=datetime.utcnow)
    analysiert_am = Column(DateTime, nullable=True)
    mandant = relationship("Mandant", back_populates="kontoauszuege")
    flags = relationship("KontoauszugFlag", back_populates="kontoauszug", cascade="all, delete-orphan")


class KontoauszugFlag(Base):
    __tablename__ = "agent_kontoauszug_flags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    kontoauszug_id = Column(String, ForeignKey("agent_kontoauszuege.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    datum = Column(String, nullable=True)          # Matching-Datum (kann Median sein)
    datum_geschaetzt = Column(Integer, default=0)  # 1 = kein echtes Datum, Median verwendet → Frontend zeigt "kein Datum"
    merchant = Column(String, nullable=True)
    betrag = Column(Float, nullable=True)
    beschreibung = Column(String, nullable=True)
    beleg_kategorie = Column(String, default="eingang")
    status = Column(String, default="offen")   # offen | kontaktiert | erledigt | ignoriert
    matched_beleg_id = Column(String, nullable=True)  # ID des Belegs der diese Transaktion abdeckt
    erstellt_am = Column(DateTime, default=datetime.utcnow)
    kontoauszug = relationship("Kontoauszug", back_populates="flags")


class VerarbeiteteEmail(Base):
    __tablename__ = "agent_verarbeitete_emails"

    message_id = Column(String, primary_key=True)
    erstellt_am = Column(DateTime, default=datetime.utcnow)


def init_db():
    """Erstellt fehlende Tabellen und führt Migrationen durch."""
    Base.metadata.create_all(engine)
    for migration in [
        "ALTER TABLE agent_kontoauszug_flags ADD COLUMN matched_beleg_id VARCHAR",
        "ALTER TABLE agent_kontoauszug_flags ADD COLUMN datum_geschaetzt INTEGER DEFAULT 0",
    ]:
        try:
            with engine.connect() as conn:
                conn.execute(text(migration))
                conn.commit()
        except Exception:
            pass
