"""Kontoauszug-Checker: extrahiert Transaktionen und findet fehlende Belege."""
import base64
import json
import os
import re
from datetime import datetime

import anthropic as _anthropic

from agent.db import SessionLocal, Kontoauszug, KontoauszugFlag, Beleg

client = _anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Zu generische Wörter für Merchant-Matching herausfiltern
STOPWOERTER = {"gmbh", "ag", "kg", "ohg", "gbr", "ug", "inc", "ltd", "co", "und",
               "der", "die", "das", "des", "dem", "den", "via", "fuer", "fur"}

ANALYSE_PROMPT = """Du analysierst einen Kontoauszug oder Kreditkartenauszug für den Mandanten: {mandant_name}

SCHRITT 1: ALLE TRANSAKTIONEN EXTRAHIEREN
Extrahiere jede einzelne Buchung/Transaktion vollständig.

SCHRITT 2: FÜR JEDE TRANSAKTION BESTIMMEN OB EIN BELEG BENÖTIGT WIRD
Setze "beleg_erforderlich": true oder false.

Kein Beleg nötig (false) wenn eindeutig:
- Gehalt/Lohn/Salary → false
- Eigene Umbuchung → false wenn "{mandant_name}" als Empfänger im Text steht
- Finanzamt/Bundeskasse/Steuerzahlung → false
- Kreditkartensammelzahlung → false wenn Visa, Mastercard, Amex als Empfänger
- Bankgebühr/Kontoführungsentgelt → false
- Sozialversicherungsbeiträge/Krankenkasse → false

Im Zweifel → true. Lieber einen Flag zu viel als einen zu wenig.

SCHRITT 3: BELEG-KATEGORIE BESTIMMEN
Nur wenn beleg_erforderlich = true. Setze "beleg_kategorie":

"eingang" → Mandant hat etwas GEKAUFT / bezahlt (Geld geht raus)
  - Einkauf bei Lieferant, Amazon, Tankstelle, Software-Abo
  - Der Mandant ist der Rechnungsempfänger
  - Merkhilfe: Ausgabe auf dem Konto = fehlende Eingangsrechnung

"ausgang" → Mandant hat etwas VERKAUFT / eine Leistung erbracht (Geld kommt rein)
  - Kunde hat bezahlt aber keine passende Ausgangsrechnung vorhanden
  - Der Mandant ist der Rechnungssteller
  - Merkhilfe: Einnahme auf dem Konto = fehlende Ausgangsrechnung

"sonstiges" → unklar oder nicht eindeutig zuzuordnen

SCHRITT 4: MERCHANT-NAME BEREINIGEN
Extrahiere den sauberen Handelsnamen.
Beispiele:
  "AMAZON PAYMENTS EUROPE SARL 2025-01-15 DE89XXX" → "Amazon"
  "REWE SAGT DANKE 1234//BERLIN/DE" → "REWE"
  "PayPal *NETFLIX 01234567890" → "Netflix"
  "Miete Januar 2025 Ref. 8821" → "Miete"
  "FINANZAMT MUENCHEN ST.-NR 12345" → "Finanzamt"

SCHRITT 5: DATUM KORREKT SETZEN
WICHTIG: Erfinde NIEMALS ein Datum. Nur Daten verwenden die explizit im Dokument dieser Transaktion zugeordnet sind.
Wenn kein Datum erkennbar → "datum": "" (leerer String, niemals das heutige Datum)

AUSGABE NUR als valides JSON, kein Markdown:
{{
  "zusammenfassung": "X Transaktionen vom TT.MM. bis TT.MM., Y ohne Beleg",
  "dateiname": "Bank_Typ_Monat_Jahr",
  "transaktionen": [
    {{
      "datum": "TT.MM.JJJJ oder leerer String",
      "merchant": "Bereinigter Händlername",
      "betrag": 99.99,
      "beschreibung": "Originaler Buchungstext",
      "beleg_erforderlich": true,
      "beleg_kategorie": "eingang"
    }}
  ]
}}"""


def _datum_zu_date(datum_str: str):
    """Parst deutsches Datumsformat TT.MM.JJJJ zu datetime.date."""
    if not datum_str:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d.%m.%y"):
        try:
            return datetime.strptime(datum_str, fmt).date()
        except ValueError:
            pass
    return None


def _referenzdatum(transaktionen: list):
    """Bestimmt ein Referenzdatum aus allen Transaktionen mit Datum (Median)."""
    daten = sorted(filter(None, (_datum_zu_date(t.get("datum")) for t in transaktionen)))
    if not daten:
        return None
    return daten[len(daten) // 2]


def _merchant_woerter(text: str) -> set:
    """Extrahiert relevante Wörter aus einem Merchant-Namen (min. 3 Zeichen, ohne Stopwörter)."""
    return set(
        w for w in re.split(r'\W+', text.lower())
        if len(w) >= 3 and w not in STOPWOERTER
    )


def _belege_passen_zusammen(transaktion: dict, beleg: "Beleg") -> bool:
    """Prüft ob eine Transaktion zu einem vorhandenen Beleg passt."""
    # Mindestanforderung: Betrag muss auf beiden Seiten vorhanden sein
    if not transaktion.get("betrag") or not beleg.brutto:
        return False

    # Betrag-Match: Abweichung max. ±€0.50 oder ±1% (je nachdem was größer ist)
    t_betrag = abs(float(transaktion["betrag"]))
    b_betrag = abs(float(beleg.brutto))
    toleranz = max(0.50, b_betrag * 0.01)
    if abs(t_betrag - b_betrag) > toleranz:
        return False

    # Datum-Match: ±30 Tage (nur wenn Transaktionsdatum vorhanden)
    if transaktion.get("datum") and beleg.datum:
        t_datum = _datum_zu_date(transaktion["datum"])
        b_datum = _datum_zu_date(beleg.datum)
        if t_datum and b_datum:
            if abs((t_datum - b_datum).days) > 30:
                return False

    # Merchant-Match: mind. 1 gemeinsames relevantes Wort (≥3 Zeichen, kein Stopwort)
    if transaktion.get("merchant") and beleg.aussteller:
        t_words = _merchant_woerter(transaktion["merchant"])
        b_words = _merchant_woerter(beleg.aussteller)
        if t_words and b_words and not t_words & b_words:
            return False

    return True


def analysiere_und_vergleiche(kontoauszug_id: str, mandant_name: str = "Unbekannt") -> dict:
    """
    Analysiert einen Kontoauszug und erstellt Flags für fehlende Belege.
    Gibt dict mit summary und flag_count zurück.
    """
    db = SessionLocal()
    try:
        kontoauszug = db.query(Kontoauszug).filter(Kontoauszug.id == kontoauszug_id).first()
        if not kontoauszug:
            return {"error": "Kontoauszug nicht gefunden"}

        # Datei einlesen — PDF oder Bild
        with open(kontoauszug.datei_pfad, "rb") as f:
            datei_bytes = f.read()
        datei_b64 = base64.b64encode(datei_bytes).decode()

        # Dateityp bestimmen
        ext = kontoauszug.datei_pfad.lower().rsplit(".", 1)[-1]
        bild_exts = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                     "gif": "image/gif", "webp": "image/webp"}
        ist_bild = ext in bild_exts

        if ist_bild:
            medien_block = {
                "type": "image",
                "source": {"type": "base64", "media_type": bild_exts[ext], "data": datei_b64},
            }
        else:
            medien_block = {
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": datei_b64},
            }

        # Claude Sonnet analysiert Kontoauszug
        prompt = ANALYSE_PROMPT.format(mandant_name=mandant_name)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3000,
            messages=[{
                "role": "user",
                "content": [medien_block, {"type": "text", "text": prompt}],
            }],
        )

        raw = msg.content[0].text
        try:
            match = re.search(r"\{[\s\S]*\}", raw)
            ergebnis = json.loads(match.group(0) if match else raw)
        except Exception:
            ergebnis = {"zusammenfassung": "Analyse abgeschlossen", "transaktionen": []}

        transaktionen = ergebnis.get("transaktionen", [])
        zusammenfassung = ergebnis.get("zusammenfassung", "")

        # Prüfen ob KEINE Transaktion im gesamten Kontoauszug ein Datum hat → unbrauchbar
        alle_daten = [_datum_zu_date(t.get("datum")) for t in transaktionen]
        alle_daten = [d for d in alle_daten if d]

        if len(transaktionen) > 0 and len(alle_daten) == 0:
            zusammenfassung = "FEHLER: Kein Datum erkennbar – Mandant muss Kontoauszug erneut einreichen"
            kontoauszug.analysiert_am = datetime.utcnow()
            kontoauszug.analyse_zusammenfassung = zusammenfassung
            db.query(KontoauszugFlag).filter(KontoauszugFlag.kontoauszug_id == kontoauszug_id).delete()
            db.commit()
            print(f"⚠ Kontoauszug unbrauchbar: kein Datum erkennbar")
            return {"zusammenfassung": zusammenfassung, "transaktionen": len(transaktionen), "fehlende_belege": 0}

        # Referenzdatum aus allen datierten Transaktionen bestimmen (für datumlose Transaktionen)
        ref_datum = _referenzdatum(transaktionen)
        ref_datum_str = ref_datum.strftime("%d.%m.%Y") if ref_datum else None

        # Vorhandene Belege des Mandanten laden
        belege = db.query(Beleg).filter(Beleg.user_id == kontoauszug.user_id).all()

        # Alte Flags löschen
        db.query(KontoauszugFlag).filter(KontoauszugFlag.kontoauszug_id == kontoauszug_id).delete()

        fehlende = 0
        for t in transaktionen:
            if not t.get("beleg_erforderlich", True):
                continue

            # Für Matching: echtes Datum oder Referenzdatum aus anderen Transaktionen
            # Im Flag gespeichert: nur das echte Datum (leer = "kein Datum" im Frontend)
            hat_datum = bool(t.get("datum"))
            match_datum = t.get("datum") if hat_datum else ref_datum_str

            transaktion_fuer_match = {
                "datum": match_datum,  # Referenzdatum für Matching, nicht für Anzeige
                "merchant": t.get("merchant"),
                "betrag": t.get("betrag"),
            }

            # Mehrdeutigkeits-Check: alle passenden Belege sammeln
            treffer = [b for b in belege if _belege_passen_zusammen(transaktion_fuer_match, b)]
            # Nur bei exakt einem Treffer zuordnen — bei 0 oder >1 bleibt Flag offen
            matched_beleg = treffer[0] if len(treffer) == 1 else None

            flag = KontoauszugFlag(
                kontoauszug_id=kontoauszug_id,
                user_id=kontoauszug.user_id,
                datum=t.get("datum") or ref_datum_str or "",  # echtes Datum oder Median für Matching
                datum_geschaetzt=0 if hat_datum else 1,       # 1 = kein echtes Datum → "kein Datum" im Frontend
                merchant=t.get("merchant"),
                betrag=t.get("betrag"),
                beschreibung=t.get("beschreibung", ""),
                beleg_kategorie=t.get("beleg_kategorie", "eingang"),
                status="erledigt" if matched_beleg else "offen",
                matched_beleg_id=matched_beleg.id if matched_beleg else None,
            )
            db.add(flag)
            if not matched_beleg:
                fehlende += 1

        kontoauszug.analysiert_am = datetime.utcnow()
        kontoauszug.analyse_zusammenfassung = zusammenfassung
        db.commit()

        print(f"✓ Kontoauszug analysiert: {len(transaktionen)} Transaktionen, {fehlende} fehlende Belege")
        return {
            "zusammenfassung": zusammenfassung,
            "transaktionen": len(transaktionen),
            "fehlende_belege": fehlende,
        }

    finally:
        db.close()


def matche_beleg_gegen_offene_flags(db, beleg: "Beleg"):
    """
    Nach Beleg-Upload: passende offene Flags suchen und als erledigt markieren.
    Datumlose Flags (kein datum gespeichert) werden nur per Betrag+Merchant gematcht.
    Wird innerhalb einer bestehenden DB-Session aufgerufen – kein eigenes commit.
    Mehrdeutig = kein Match (lieber offen lassen als falsch zuordnen).
    """
    offene_flags = db.query(KontoauszugFlag).filter(
        KontoauszugFlag.user_id == beleg.user_id,
        KontoauszugFlag.status == "offen"
    ).all()

    beleg_datum = _datum_zu_date(beleg.datum) if beleg.datum else None

    passende_flags = []
    for flag in offene_flags:
        # Datum-Vorfilter nur wenn BEIDE Seiten ein Datum haben
        if flag.datum and beleg_datum:
            flag_datum = _datum_zu_date(flag.datum)
            if flag_datum and abs((beleg_datum - flag_datum).days) > 30:
                continue

        transaktion = {
            "datum": flag.datum,
            "merchant": flag.merchant,
            "betrag": flag.betrag,
        }
        if _belege_passen_zusammen(transaktion, beleg):
            passende_flags.append(flag)

    # Nur bei exakt einem Treffer zuordnen — bei >1 bleibt alles offen
    if len(passende_flags) == 1:
        passende_flags[0].status = "erledigt"
        passende_flags[0].matched_beleg_id = beleg.id
