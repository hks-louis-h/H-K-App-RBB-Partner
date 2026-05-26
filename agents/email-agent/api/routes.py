"""REST API Endpunkte (FastAPI)."""
import os
import csv
import io
import base64
import json
import anthropic as _anthropic
from fastapi import FastAPI, HTTPException, Security, UploadFile, File, Form
from fastapi.security.api_key import APIKeyHeader
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from agent.db import SessionLocal, Mandant, Beleg, Kontoauszug, KontoauszugFlag, init_db
from agent.processor import verarbeite_emails

app = FastAPI(
    title="Email Beleg Agent",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# DB beim Start initialisieren
init_db()

# ── Authentifizierung ─────────────────────────────────────────────────────────

API_KEY = os.getenv("API_KEY", "")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(key: str = Security(api_key_header)):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API_KEY nicht konfiguriert")
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Ungültiger API Key")
    return key


# ── Schemas ──────────────────────────────────────────────────────────────────

class MandantCreate(BaseModel):
    id: str
    name: str
    email: str
    steuernummer: str | None = None


# ── Mandanten ─────────────────────────────────────────────────────────────────

@app.post("/mandanten", summary="Neuen Mandanten anlegen")
def mandant_anlegen(data: MandantCreate, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        if db.query(Mandant).filter(Mandant.id == data.id).first():
            raise HTTPException(status_code=409, detail="Mandant existiert bereits")
        mandant = Mandant(**data.model_dump())
        db.add(mandant)
        db.commit()
        return {"ok": True, "mandant_id": mandant.id}
    finally:
        db.close()


@app.get("/mandanten", summary="Alle Mandanten auflisten")
def mandanten_liste(_: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        mandanten = db.query(Mandant).all()
        return [
            {"id": m.id, "name": m.name, "email": m.email}
            for m in mandanten
        ]
    finally:
        db.close()


# ── Belege ────────────────────────────────────────────────────────────────────

@app.get("/mandanten/{mandant_id}/belege", summary="Belege eines Mandanten")
def belege_liste(mandant_id: str, typ: str | None = None, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        query = db.query(Beleg).filter(Beleg.user_id == int(mandant_id))
        if typ:
            query = query.filter(Beleg.typ == typ)
        belege = query.order_by(Beleg.erstellt_am.desc()).all()
        return [_beleg_zu_dict(b) for b in belege]
    finally:
        db.close()


@app.get("/belege/{beleg_id}", summary="Einzelnen Beleg abrufen")
def beleg_detail(beleg_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        beleg = db.query(Beleg).filter(Beleg.id == beleg_id).first()
        if not beleg:
            raise HTTPException(status_code=404, detail="Beleg nicht gefunden")
        return _beleg_zu_dict(beleg)
    finally:
        db.close()


@app.get("/belege/{beleg_id}/vorschau", summary="Bild-Preview des Belegs")
def beleg_vorschau(beleg_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        beleg = db.query(Beleg).filter(Beleg.id == beleg_id).first()
        if not beleg:
            raise HTTPException(status_code=404, detail="Beleg nicht gefunden")
        pfad = beleg.vorschau_pfad or beleg.datei_pfad
        if not pfad or not os.path.exists(pfad):
            raise HTTPException(status_code=404, detail="Datei nicht gefunden")
        return FileResponse(pfad)
    finally:
        db.close()


@app.get("/belege/{beleg_id}/datei", summary="Original-Datei herunterladen")
def beleg_datei(beleg_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        beleg = db.query(Beleg).filter(Beleg.id == beleg_id).first()
        if not beleg:
            raise HTTPException(status_code=404, detail="Beleg nicht gefunden")
        if not beleg.datei_pfad or not os.path.exists(beleg.datei_pfad):
            raise HTTPException(status_code=404, detail="Datei nicht gefunden")
        return FileResponse(beleg.datei_pfad, filename=beleg.original_dateiname)
    finally:
        db.close()


@app.delete("/belege/{beleg_id}", summary="Beleg löschen")
def beleg_loeschen(beleg_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        beleg = db.query(Beleg).filter(Beleg.id == beleg_id).first()
        if not beleg:
            raise HTTPException(status_code=404, detail="Beleg nicht gefunden")
        # Verknüpfte Flags zurück auf offen setzen bevor der Beleg gelöscht wird
        verknuepfte_flags = db.query(KontoauszugFlag).filter(
            KontoauszugFlag.matched_beleg_id == beleg_id
        ).all()
        for flag in verknuepfte_flags:
            flag.status = "offen"
            flag.matched_beleg_id = None
        # Dateien vom Dateisystem löschen
        for pfad in [beleg.datei_pfad, beleg.vorschau_pfad]:
            if pfad and os.path.exists(pfad):
                os.remove(pfad)
        db.delete(beleg)
        db.commit()
        return {"ok": True, "geloescht": beleg_id}
    finally:
        db.close()


# ── Kontoauszüge ──────────────────────────────────────────────────────────────

@app.get("/mandanten/{mandant_id}/kontoauszuege", summary="Kontoauszüge eines Mandanten")
def kontoauszuege_liste(mandant_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        konto_list = db.query(Kontoauszug).filter(
            Kontoauszug.user_id == int(mandant_id)
        ).order_by(Kontoauszug.erstellt_am.desc()).all()
        return [_kontoauszug_zu_dict(k) for k in konto_list]
    finally:
        db.close()


@app.delete("/kontoauszuege/{kontoauszug_id}", summary="Kontoauszug löschen")
def kontoauszug_loeschen(kontoauszug_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        k = db.query(Kontoauszug).filter(Kontoauszug.id == kontoauszug_id).first()
        if not k:
            raise HTTPException(status_code=404, detail="Kontoauszug nicht gefunden")
        if k.datei_pfad and os.path.exists(k.datei_pfad):
            os.remove(k.datei_pfad)
        db.delete(k)
        db.commit()
        return {"ok": True, "geloescht": kontoauszug_id}
    finally:
        db.close()


@app.get("/kontoauszuege/{kontoauszug_id}/datei", summary="Kontoauszug-Datei herunterladen")
def kontoauszug_datei(kontoauszug_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        k = db.query(Kontoauszug).filter(Kontoauszug.id == kontoauszug_id).first()
        if not k:
            raise HTTPException(status_code=404, detail="Kontoauszug nicht gefunden")
        if not k.datei_pfad or not os.path.exists(k.datei_pfad):
            raise HTTPException(status_code=404, detail="Datei nicht gefunden")
        return FileResponse(k.datei_pfad, filename=k.original_dateiname)
    finally:
        db.close()


@app.get("/mandanten/{mandant_id}/kontoauszug-flags", summary="Fehlende Belege für Mandant")
def kontoauszug_flags(mandant_id: str, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        flags = db.query(KontoauszugFlag).filter(
            KontoauszugFlag.user_id == int(mandant_id)
        ).order_by(KontoauszugFlag.erstellt_am.desc()).all()
        return [_flag_zu_dict(f) for f in flags]
    finally:
        db.close()


@app.patch("/kontoauszug-flags/{flag_id}", summary="Flag-Status aktualisieren")
def flag_status_aendern(flag_id: int, body: dict, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        flag = db.query(KontoauszugFlag).filter(KontoauszugFlag.id == flag_id).first()
        if not flag:
            raise HTTPException(status_code=404, detail="Flag nicht gefunden")
        status = body.get("status")
        if status not in ("offen", "kontaktiert", "erledigt", "ignoriert"):
            raise HTTPException(status_code=400, detail="Ungültiger Status")
        flag.status = status
        db.commit()
        return {"ok": True, "id": flag_id, "status": status}
    finally:
        db.close()


@app.post("/kontoauszuege/{kontoauszug_id}/neu-analysieren", summary="Kontoauszug erneut analysieren")
def kontoauszug_neu_analysieren(kontoauszug_id: str, _: str = Security(require_api_key)):
    from agent.kontoauszug_checker import analysiere_und_vergleiche
    ergebnis = analysiere_und_vergleiche(kontoauszug_id)
    if "error" in ergebnis:
        raise HTTPException(status_code=404, detail=ergebnis["error"])
    return {"ok": True, **ergebnis}


# ── Manueller Upload ──────────────────────────────────────────────────────────

@app.post("/mandanten/{mandant_id}/upload", summary="Datei manuell hochladen (Beleg oder Kontoauszug)")
async def manueller_upload(
    mandant_id: str,
    datei: UploadFile = File(...),
    belegtyp: str | None = Form(None),
    _: str = Security(require_api_key),
):
    """
    Nimmt eine PDF oder Bilddatei, lässt Claude klassifizieren ob es ein
    Beleg oder Kontoauszug ist, und speichert es entsprechend.
    """
    from agent.processor import _pdf_zu_bild_bytes, BILD_MIME_TYPEN
    from agent.classifier import klassifiziere_beleg
    from agent.file_manager import speichere_beleg
    from agent.kontoauszug_checker import analysiere_und_vergleiche
    import uuid, io

    db = SessionLocal()
    try:
        mandant = db.query(Mandant).filter(Mandant.id == mandant_id).first()
        if not mandant:
            raise HTTPException(status_code=404, detail="Mandant nicht gefunden")

        daten = await datei.read()
        mime_typ = datei.content_type or "application/octet-stream"
        dateiname = datei.filename or "upload"

        # Für Claude vorbereiten
        if mime_typ == "application/pdf":
            bild_daten = _pdf_zu_bild_bytes(daten)
            if not bild_daten:
                raise HTTPException(status_code=422, detail="PDF konnte nicht verarbeitet werden")
            claude_mime = "image/png"
        elif mime_typ in BILD_MIME_TYPEN or mime_typ.startswith("image/"):
            bild_daten = daten
            claude_mime = mime_typ
        else:
            raise HTTPException(status_code=415, detail="Nur PDF und Bilddateien werden unterstützt")

        extrahiert = klassifiziere_beleg(bild_daten, claude_mime)

        if extrahiert.get("dokumenttyp") == "kontoauszug":
            kontoauszug_id = str(uuid.uuid4())
            storage_dir = os.path.join(os.getenv("STORAGE_PATH", "./data/belege"), mandant_id, "kontoauszuege")
            os.makedirs(storage_dir, exist_ok=True)
            datei_pfad = os.path.join(storage_dir, f"{kontoauszug_id}_{dateiname}")
            with open(datei_pfad, "wb") as f:
                f.write(daten)
            k = Kontoauszug(
                id=kontoauszug_id, user_id=int(mandant_id), kanzlei_id=1,
                kategorie="kontoauszug", datei_pfad=datei_pfad,
                original_dateiname=dateiname, absender_email="manuell",
            )
            db.add(k)
            db.commit()
            analysiere_und_vergleiche(kontoauszug_id)
            return {"ok": True, "typ": "kontoauszug", "id": kontoauszug_id}

        else:
            beleg_id = str(uuid.uuid4())
            # Manuell gewählte Kategorie hat Vorrang vor Claude's Klassifikation
            belegtyp = belegtyp if belegtyp in ("Eingangsrechnung", "Ausgangsrechnung", "Quittung") else extrahiert.get("typ", "Quittung")
            datei_pfad, vorschau_pfad = speichere_beleg(
                beleg_id=beleg_id, mandant_id=mandant_id, belegtyp=belegtyp,
                daten=daten, original_dateiname=dateiname, mime_typ=mime_typ,
            )
            b = Beleg(
                id=beleg_id, user_id=int(mandant_id), kanzlei_id=1, typ=belegtyp,
                datum=extrahiert.get("datum"), brutto=extrahiert.get("brutto"),
                netto=extrahiert.get("netto"), mwst=extrahiert.get("mwst"),
                rechnungsnummer=extrahiert.get("rechnungsnummer"),
                aussteller=extrahiert.get("aussteller"), empfaenger=extrahiert.get("empfaenger"),
                datei_pfad=datei_pfad, vorschau_pfad=vorschau_pfad,
                original_dateiname=dateiname, absender_email="manuell",
            )
            db.add(b)
            db.commit()
            # Passende offene Flags finden und als erledigt markieren
            try:
                matche_beleg_gegen_offene_flags(db, b)
                db.commit()
            except Exception as _e:
                print(f"⚠ Flag-Matching Fehler (nicht kritisch): {_e}")
            return {"ok": True, "typ": "beleg", "id": beleg_id, "belegtyp": belegtyp}

    finally:
        db.close()


# ── DATEV Export ──────────────────────────────────────────────────────────────

@app.get("/mandanten/{mandant_id}/datev-export", summary="DATEV CSV Export")
def datev_export(mandant_id: str, beleg_ids: str | None = None, _: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        mandant = db.query(Mandant).filter(Mandant.id == mandant_id).first()
        if not mandant:
            raise HTTPException(status_code=404, detail="Mandant nicht gefunden")

        query = db.query(Beleg).filter(Beleg.user_id == int(mandant_id))
        if beleg_ids:
            ids = [b.strip() for b in beleg_ids.split(",")]
            query = query.filter(Beleg.id.in_(ids))

        belege = query.all()

        output = io.StringIO()
        writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_MINIMAL)

        writer.writerow([
            "Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz",
            "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto",
            "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum",
            "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext",
        ])

        for b in belege:
            soll_haben = "S" if b.typ in ("Eingangsrechnung", "Bankbeleg") else "H"
            writer.writerow([
                str(b.brutto or "").replace(".", ","), soll_haben, "EUR",
                "", "", "", "", "", "",
                b.datum or "", b.rechnungsnummer or b.id[:8], "", "",
                f"{b.typ} - {b.aussteller or ''}",
            ])

        # Belege als exportiert markieren
        for b in belege:
            b.datev_exportiert = 1
        db.commit()

        output.seek(0)
        dateiname = f"datev_export_{mandant_id}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={dateiname}"},
        )
    finally:
        db.close()


# ── Kontoauszug-Analyse ───────────────────────────────────────────────────────

@app.post("/kontoauszug/analyze", summary="Kontoauszug analysieren und fehlende Belege finden")
async def kontoauszug_analyze(
    mandant_id: str = Form(...),
    kategorie: str = Form("kontoauszug"),
    datei: UploadFile = File(...),
    _: str = Security(require_api_key),
):
    db = SessionLocal()
    try:
        mandant = db.query(Mandant).filter(Mandant.id == mandant_id).first()
        if not mandant:
            raise HTTPException(status_code=404, detail="Mandant nicht gefunden")

        # Vorhandene Belege des Mandanten als Kontext
        belege = db.query(Beleg).filter(Beleg.user_id == int(mandant_id)).all()
        belege_kontext = "\n".join(
            f"- {b.typ}: {b.aussteller or b.empfaenger or '?'}, "
            f"{b.brutto or '?'} EUR, {b.datum or '?'} ({b.original_dateiname or b.id})"
            for b in belege
        ) or "Keine"

        kat_label = {
            "kontoauszug": "Kontoauszug",
            "kreditkarte": "Kreditkarten-/Online-Abrechnung",
            "ausgangsrechnungen": "Ausgangsrechnungsliste",
        }.get(kategorie, kategorie)

        pdf_bytes = await datei.read()
        pdf_b64 = base64.b64encode(pdf_bytes).decode()

        client = _anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2000,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
                    },
                    {
                        "type": "text",
                        "text": (
                            f"Analysiere diesen {kat_label} für Mandant: {mandant.name}.\n\n"
                            f"Bereits vorhandene Belege:\n{belege_kontext}\n\n"
                            "Aufgabe:\n"
                            "1. Extrahiere alle Transaktionen/Positionen aus dem Dokument\n"
                            "2. Prüfe für jede Transaktion ob ein passender Beleg bereits vorhanden ist "
                            "(Fuzzy-Match: ±20% Betrag, ±7 Tage Datum, ähnlicher Händlername)\n"
                            "3. Melde alle Transaktionen für die KEIN passender Beleg vorliegt\n\n"
                            "Antwort NUR als JSON:\n"
                            '{"summary":"Kurze Zusammenfassung (1 Satz)","flags":['
                            '{"date":"TT.MM.JJJJ","merchant":"Händlername","amount":99.99,'
                            '"description":"Buchungstext","beleg_category":"eingang|ausgang|intern"}]}'
                        ),
                    },
                ],
            }],
        )

        raw = msg.content[0].text
        try:
            match = __import__("re").search(r"\{[\s\S]*\}", raw)
            result = json.loads(match.group(0) if match else raw)
        except Exception:
            result = {"summary": "Analyse abgeschlossen", "flags": []}

        return {"ok": True, "summary": result.get("summary", ""), "flags": result.get("flags", [])}

    finally:
        db.close()


# ── Agent auslösen ────────────────────────────────────────────────────────────

@app.post("/agent/run", summary="E-Mails jetzt abrufen und verarbeiten")
def agent_run(_: str = Security(require_api_key)):
    try:
        ergebnis = verarbeite_emails()
        return {"ok": True, "verarbeitet": len(ergebnis), "belege": ergebnis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/agent/status", summary="Zeigt Statistiken")
def agent_status(_: str = Security(require_api_key)):
    db = SessionLocal()
    try:
        from agent.scheduler import INTERVALL_SEKUNDEN
        return {
            "polling_intervall_minuten": INTERVALL_SEKUNDEN // 60,
            "mandanten_gesamt": db.query(Mandant).count(),
            "belege_gesamt": db.query(Beleg).count(),
            "belege_pro_typ": {
                typ: db.query(Beleg).filter(Beleg.typ == typ).count()
                for typ in ["Eingangsrechnung", "Ausgangsrechnung", "Bankbeleg", "Quittung"]
            },
        }
    finally:
        db.close()


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def _kontoauszug_zu_dict(k: Kontoauszug) -> dict:
    return {
        "id": k.id,
        "mandant_id": k.user_id,
        "kategorie": k.kategorie,
        "original_dateiname": k.original_dateiname,
        "absender_email": k.absender_email,
        "analyse_zusammenfassung": k.analyse_zusammenfassung,
        "erstellt_am": k.erstellt_am.isoformat() if k.erstellt_am else None,
        "analysiert_am": k.analysiert_am.isoformat() if k.analysiert_am else None,
        "datei_url": f"/kontoauszuege/{k.id}/datei",
    }


def _flag_zu_dict(f: KontoauszugFlag) -> dict:
    return {
        "id": f.id,
        "kontoauszug_id": f.kontoauszug_id,
        "mandant_id": f.user_id,
        "datum": f.datum,
        "datum_geschaetzt": bool(f.datum_geschaetzt),
        "merchant": f.merchant,
        "betrag": f.betrag,
        "beschreibung": f.beschreibung,
        "beleg_kategorie": f.beleg_kategorie,
        "status": f.status,
        "erstellt_am": f.erstellt_am.isoformat() if f.erstellt_am else None,
    }


def _beleg_zu_dict(b: Beleg) -> dict:
    return {
        "id": b.id,
        "mandant_id": b.user_id,
        "typ": b.typ,
        "datum": b.datum,
        "brutto": b.brutto,
        "netto": b.netto,
        "mwst": b.mwst,
        "rechnungsnummer": b.rechnungsnummer,
        "aussteller": b.aussteller,
        "empfaenger": b.empfaenger,
        "original_dateiname": b.original_dateiname,
        "absender_email": b.absender_email,
        "erstellt_am": b.erstellt_am.isoformat() if b.erstellt_am else None,
        "vorschau_url": f"/belege/{b.id}/vorschau",
        "datei_url": f"/belege/{b.id}/datei",
        "datev_exportiert": b.datev_exportiert or 0,
    }
