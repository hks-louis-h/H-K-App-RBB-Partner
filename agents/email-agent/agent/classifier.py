"""Claude Vision: klassifiziert Belege und extrahiert Daten."""
import base64
import json
import os
import anthropic
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

BELEG_TYPEN = ["Eingangsrechnung", "Ausgangsrechnung", "Quittung"]

EXTRACTION_PROMPT = """Du bist ein Experte für deutsche Buchhaltung und Steuerunterlagen.
Du analysierst Dokumente für den Mandanten: {mandant_name}

SCHRITT 1: DOKUMENTTYP
Ist dieses Dokument ein Kontoauszug, Kreditkartenauszug, Bankingauszug oder eine Umsatzübersicht mit MEHREREN Buchungen/Transaktionen?

--> JA:  Antworte NUR mit: {{"dokumenttyp": "kontoauszug"}}
--> NEIN: Weiter mit Schritt 2

SCHRITT 2: BELEGART
Bestimme die Belegart anhand dieser Regeln:

"Ausgangsrechnung" - wenn:
  - {mandant_name} ist der AUSSTELLER / Rechnungssteller / Lieferant
  - Das Dokument wurde VON {mandant_name} an einen Kunden gestellt

"Eingangsrechnung" - wenn:
  - {mandant_name} ist der EMPFÄNGER / Rechnungsempfänger / Käufer
  - Ein fremdes Unternehmen hat die Rechnung ausgestellt
  - Gutschriften und Stornorechnungen von Lieferanten → ebenfalls Eingangsrechnung

"Quittung" - wenn:
  - Kassenbon, POS-Beleg, handschriftliche Quittung
  - Kein formaler Rechnungskopf mit Aussteller-Adresse und Steuernummer
  - Typisch: Supermarkt, Tankstelle, Restaurant (Einzelbeleg, nicht Sammelrechnung)

Bei Unsicherheit → immer "Eingangsrechnung"

SCHRITT 3: DATEN EXTRAHIEREN
Pflichtfelder für ALLE Belegarten (null wenn nicht erkennbar):
  - datum: "DD.MM.YYYY" oder null
  - brutto: Gesamtbetrag inkl. MwSt als Dezimalzahl oder null
  - netto: Betrag exkl. MwSt oder null
  - mwst: MwSt-Satz als Zahl (z.B. 19) oder null
  - rechnungsnummer: Rechnungs-/Belegnummer als String oder null
  - aussteller: Name des Ausstellers oder null
  - empfaenger: Name des Empfängers oder null

Nur bei "Eingangsrechnung" und "Quittung":
  - buchungskategorie: passendste aus dieser Liste:
    waren           = Wareneinkauf, Rohstoffe, Materialien, Handelswaren
    fremdleistungen = Subunternehmer, Freelancer, externe Dienstleister, Honorare
    miete           = Miete, Pacht, Leasing von Räumen oder Geräten
    energie         = Strom, Gas, Wasser, Heizung
    versicherungen  = Betriebs-, KFZ-, Haftpflicht-, Rechtsschutzversicherung
    kfz             = Tankstelle, Werkstatt, Parkgebühren, KFZ-Zubehör, TÜV
    werbung         = Werbung, Marketing, Messen, Drucksachen, Werbeagentur
    reise           = Hotel, Bahn, Flug, Taxi, Verpflegung auf Dienstreise (alleine)
    bewirtung       = Restaurant, Café, Catering mit Kunden oder Mitarbeitern
    telefon         = Mobilfunk, Internet, Festnetz
    porto           = Porto, Pakete, Versand, Kurier, DHL, UPS
    buero           = Büromaterial, Schreibwaren, Druckerpatronen, Papier
    fachliteratur   = Fachzeitschriften, Bücher, Kurse, Weiterbildung, Seminare
    software        = Software-Lizenzen, SaaS, Cloud-Dienste, IT, Hosting
    steuerberatung  = Steuerberater, Buchhalter, Wirtschaftsprüfer, DATEV
    rechtsberatung  = Anwalt, Notar, Gerichtskosten, Abmahnungen
    reparatur       = Reparaturen, Wartung, Instandhaltung
    gwg             = Wirtschaftsgüter unter 800 EUR netto (Laptop, Handy, Möbel, Werkzeug)
    beitraege       = Mitgliedsbeiträge, Verbände, Kammern, Abonnements ohne IT-Bezug
    sonstiges       = Betriebsausgaben die keiner anderen Kategorie zuzuordnen sind

Bei "Ausgangsrechnung": buchungskategorie = null

AUSGABE: NUR valides JSON, kein Markdown, keine Erklärungen.

Beispiele:
{"dokumenttyp":"kontoauszug"}

{"dokumenttyp":"beleg","typ":"Eingangsrechnung","datum":"15.02.2025","brutto":119.00,"netto":100.00,"mwst":19,"rechnungsnummer":"RE-2025-0042","aussteller":"Adobe Systems GmbH","empfaenger":"Musterfirma GmbH","buchungskategorie":"software"}

{"dokumenttyp":"beleg","typ":"Ausgangsrechnung","datum":"03.03.2025","brutto":2380.00,"netto":2000.00,"mwst":19,"rechnungsnummer":"AR-2025-0015","aussteller":"Musterfirma GmbH","empfaenger":"Kunde AG","buchungskategorie":null}

{"dokumenttyp":"beleg","typ":"Quittung","datum":"01.03.2025","brutto":4.80,"netto":null,"mwst":null,"rechnungsnummer":null,"aussteller":"Bäckerei Müller","empfaenger":null,"buchungskategorie":"bewirtung"}"""


MAX_BYTES = 4 * 1024 * 1024  # 4MB Limit (Puffer unter Claude's 5MB)


def _komprimiere_bild(bild_daten: bytes) -> bytes:
    """Komprimiert ein Bild auf unter 4MB falls nötig."""
    import io
    from PIL import Image

    if len(bild_daten) <= MAX_BYTES:
        return bild_daten

    img = Image.open(io.BytesIO(bild_daten))

    # Zu groß? Erst Auflösung halbieren
    while len(bild_daten) > MAX_BYTES:
        w, h = img.size
        img = img.resize((w // 2, h // 2), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        bild_daten = buf.getvalue()

    return bild_daten


def _bild_zu_base64(bild_daten: bytes, mime_typ: str) -> tuple[str, str]:
    """Konvertiert Bilddaten zu base64, komprimiert falls nötig."""
    if mime_typ not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        mime_typ = "image/png"

    bild_daten = _komprimiere_bild(bild_daten)
    # Nach Komprimierung immer JPEG
    if len(bild_daten) < 4 * 1024 * 1024 and mime_typ == "image/jpeg":
        pass
    else:
        mime_typ = "image/jpeg"

    return base64.standard_b64encode(bild_daten).decode("utf-8"), mime_typ


def klassifiziere_beleg(bild_daten: bytes, mime_typ: str, mandant_name: str = "Unbekannt") -> dict:
    """
    Sendet das Bild an Claude und gibt extrahierte Belegdaten zurück.
    Rückgabe: dict mit typ, datum, brutto, netto, mwst, rechnungsnummer, aussteller, empfaenger
    """
    b64_data, media_type = _bild_zu_base64(bild_daten, mime_typ)
    prompt = EXTRACTION_PROMPT.format(mandant_name=mandant_name)

    with client.messages.stream(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        thinking={"type": "adaptive"},
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_data,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    ) as stream:
        response = stream.get_final_message()

    # JSON aus der Antwort extrahieren
    for block in response.content:
        if block.type == "text":
            text = block.text.strip()
            # JSON-Block aus Markdown entfernen falls vorhanden
            if text.startswith("```"):
                lines = text.split("\n")
                text = "\n".join(lines[1:-1])
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                # Fallback: nur Typ zurückgeben
                return {"typ": "Quittung"}

    return {"typ": "Quittung"}
