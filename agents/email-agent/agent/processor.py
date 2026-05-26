"""Haupt-Prozessor: verbindet Email-Reader, Classifier, File-Manager und DB."""
import uuid
import io
import os
from dotenv import load_dotenv

from agent.email_reader import fetch_new_emails
from agent.classifier import klassifiziere_beleg
from agent.file_manager import speichere_beleg
from agent.db import SessionLocal, Beleg, Mandant, Kontoauszug
from agent.kontoauszug_checker import analysiere_und_vergleiche

load_dotenv()

BILD_MIME_TYPEN = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}


def _email_adresse_extrahieren(absender: str) -> str:
    """Extrahiert die reine E-Mail-Adresse aus 'Name <email@domain.de>'."""
    if "<" in absender and ">" in absender:
        return absender.split("<")[1].split(">")[0].strip().lower()
    return absender.strip().lower()


def _pdf_zu_bild_bytes(pdf_daten: bytes) -> bytes | None:
    """Konvertiert die erste PDF-Seite zu PNG-Bytes für Claude."""
    try:
        from pdf2image import convert_from_bytes
        seiten = convert_from_bytes(pdf_daten, first_page=1, last_page=1, dpi=150)
        if seiten:
            buf = io.BytesIO()
            seiten[0].save(buf, "PNG")
            return buf.getvalue()
    except Exception:
        pass
    return None


def verarbeite_emails() -> list[dict]:
    """
    Hauptfunktion: holt neue E-Mails, klassifiziert Anhänge und speichert alles.
    Gibt eine Liste der verarbeiteten Belege zurück.
    """
    emails = fetch_new_emails()
    if not emails:
        print("Keine neuen E-Mails.")
        return []

    verarbeitete = []
    db = SessionLocal()

    try:
        for mail in emails:
            absender_email = _email_adresse_extrahieren(mail["absender"])

            # Mandant aus DB suchen
            mandant = db.query(Mandant).filter(
                Mandant.email == absender_email
            ).first()

            if not mandant:
                print(f"Kein Mandant gefunden für: {absender_email} — überspringe.")
                continue

            for anhang in mail["anhaenge"]:
                daten = anhang["daten"]
                mime_typ = anhang["mime_typ"]
                dateiname = anhang["dateiname"]

                # Anhang für Claude vorbereiten: PDF → Bild, Bilder direkt
                if mime_typ == "application/pdf":
                    bild_daten = _pdf_zu_bild_bytes(daten)
                    if not bild_daten:
                        print(f"PDF konnte nicht konvertiert werden: {dateiname} — überspringe.")
                        continue
                    claude_mime = "image/png"
                elif mime_typ in BILD_MIME_TYPEN:
                    bild_daten = daten
                    claude_mime = mime_typ
                else:
                    print(f"Nicht unterstützter Dateityp: {mime_typ} ({dateiname}) — überspringe.")
                    continue

                # Claude klassifiziert: Kontoauszug oder Beleg?
                print(f"Klassifiziere: {dateiname} von {absender_email}...")
                extrahiert = klassifiziere_beleg(bild_daten, claude_mime, mandant_name=mandant.name)

                if extrahiert.get("dokumenttyp") == "kontoauszug":
                    # Als Kontoauszug speichern
                    kontoauszug_id = str(uuid.uuid4())
                    storage_dir = os.path.join(
                        os.getenv("STORAGE_PATH", "./data/belege"),
                        mandant.id, "kontoauszuege"
                    )
                    os.makedirs(storage_dir, exist_ok=True)
                    datei_pfad = os.path.join(storage_dir, f"{kontoauszug_id}_{dateiname}")
                    with open(datei_pfad, "wb") as f:
                        f.write(daten)

                    kontoauszug = Kontoauszug(
                        id=kontoauszug_id,
                        mandant_id=mandant.id,
                        kategorie="kontoauszug",
                        datei_pfad=datei_pfad,
                        original_dateiname=dateiname,
                        absender_email=absender_email,
                    )
                    db.add(kontoauszug)
                    db.commit()

                    analysiere_und_vergleiche(kontoauszug_id, mandant_name=mandant.name)

                    verarbeitete.append({
                        "beleg_id": kontoauszug_id,
                        "mandant": mandant.name,
                        "typ": "Kontoauszug",
                        "datei": dateiname,
                    })
                    print(f"✓ Kontoauszug gespeichert und analysiert: {dateiname} für {mandant.name}")
                    continue

                # Beleg-Verarbeitung
                beleg_id = str(uuid.uuid4())
                belegtyp = extrahiert.get("typ", "Quittung")

                # Datei speichern
                datei_pfad, vorschau_pfad = speichere_beleg(
                    beleg_id=beleg_id,
                    mandant_id=mandant.id,
                    belegtyp=belegtyp,
                    daten=daten,
                    original_dateiname=dateiname,
                    mime_typ=mime_typ,
                )

                # In DB speichern
                beleg = Beleg(
                    id=beleg_id,
                    mandant_id=mandant.id,
                    typ=belegtyp,
                    datum=extrahiert.get("datum"),
                    brutto=extrahiert.get("brutto"),
                    netto=extrahiert.get("netto"),
                    mwst=extrahiert.get("mwst"),
                    rechnungsnummer=extrahiert.get("rechnungsnummer"),
                    aussteller=extrahiert.get("aussteller"),
                    empfaenger=extrahiert.get("empfaenger"),
                    datei_pfad=datei_pfad,
                    vorschau_pfad=vorschau_pfad,
                    original_dateiname=dateiname,
                    absender_email=absender_email,
                )
                db.add(beleg)
                db.commit()

                verarbeitete.append({
                    "beleg_id": beleg_id,
                    "mandant": mandant.name,
                    "typ": belegtyp,
                    "datei": dateiname,
                })
                print(f"✓ Gespeichert: {belegtyp} für {mandant.name}")

    finally:
        db.close()

    return verarbeitete
