"""Datei-Manager: speichert Belege in der Ordnerstruktur und erstellt Bild-Previews."""
import os
import io
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

STORAGE_PATH = os.getenv("STORAGE_PATH", "./data/belege")

# Unterordner je Belegtyp
ORDNER_MAP = {
    "Eingangsrechnung": "eingangsrechnungen",
    "Ausgangsrechnung": "ausgangsrechnungen",
    "Bankbeleg": "bankbelege",
    "Quittung": "quittungen",
}


def _mandant_ordner(mandant_id: str, belegtyp: str) -> Path:
    """Gibt den Pfad für einen Mandanten + Belegtyp zurück und erstellt ihn."""
    unterordner = ORDNER_MAP.get(belegtyp, "sonstiges")
    pfad = Path(STORAGE_PATH) / mandant_id / unterordner
    pfad.mkdir(parents=True, exist_ok=True)
    return pfad


def speichere_beleg(
    beleg_id: str,
    mandant_id: str,
    belegtyp: str,
    daten: bytes,
    original_dateiname: str,
    mime_typ: str,
) -> tuple[str, str | None]:
    """
    Speichert den Beleg im Ordner.
    Gibt (datei_pfad, vorschau_pfad) zurück.
    vorschau_pfad ist None wenn kein Preview erstellt werden konnte.
    """
    ordner = _mandant_ordner(mandant_id, belegtyp)
    ext = Path(original_dateiname).suffix.lower() or _mime_zu_ext(mime_typ)
    dateiname = f"{beleg_id}{ext}"
    datei_pfad = ordner / dateiname

    # Original speichern
    datei_pfad.write_bytes(daten)

    # Bild-Preview erstellen
    vorschau_pfad = _erstelle_preview(beleg_id, ordner, daten, mime_typ)

    return str(datei_pfad), vorschau_pfad


def _erstelle_preview(beleg_id: str, ordner: Path, daten: bytes, mime_typ: str) -> str | None:
    """Erstellt ein PNG-Preview des Belegs. Gibt den Pfad zurück oder None."""
    vorschau_pfad = ordner / f"{beleg_id}_preview.png"

    try:
        if mime_typ == "application/pdf":
            # PDF → erste Seite als Bild
            from pdf2image import convert_from_bytes
            seiten = convert_from_bytes(daten, first_page=1, last_page=1, dpi=150)
            if seiten:
                seiten[0].save(str(vorschau_pfad), "PNG")
                return str(vorschau_pfad)

        elif mime_typ.startswith("image/"):
            # Bild direkt als PNG speichern
            from PIL import Image
            img = Image.open(io.BytesIO(daten))
            img.save(str(vorschau_pfad), "PNG")
            return str(vorschau_pfad)

    except Exception:
        pass  # Preview ist optional

    return None


def _mime_zu_ext(mime_typ: str) -> str:
    mapping = {
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/tiff": ".tiff",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    return mapping.get(mime_typ, ".bin")
