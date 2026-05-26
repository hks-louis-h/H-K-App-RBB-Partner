# Email Beleg Agent — H&K Automation

## Rolle
Automatischer Beleg-Erfassungsagent für die H&K Steuerkanzlei.
Überwacht ein IMAP-Postfach, klassifiziert eingehende Belege per KI und speichert sie strukturiert in der Datenbank.

## Betrieb
- **Läuft auf:** Hetzner Server `178.104.23.187`
- **API erreichbar unter:** `https://belege.hks-automation.de`
- **Prüfintervall:** alle 5 Minuten (288x täglich)
- **Services:** `email-agent-api` (FastAPI, Port 8001) + `email-agent-scheduler` (Polling)

## Überwachtes Postfach
- **IMAP:** `rechnungen@hks-automation.de` bei IONOS (`imap.ionos.de:993`)
- Verarbeitet: PDF, PNG, JPG, JPEG als Anhang

## Was der Agent tut

### 1. E-Mails abrufen (`email_reader.py`)
Verbindet sich per IMAP, liest ungesehene E-Mails und extrahiert Anhänge.

### 2. Klassifizieren & Extrahieren (`classifier.py`)
Sendet jeden Anhang an **Claude Sonnet 4.6** und extrahiert:
- Belegtyp (Eingangsrechnung, Ausgangsrechnung, Bankbeleg, Quittung)
- Datum, Brutto, Netto, MwSt, Rechnungsnummer
- Aussteller, Empfänger

### 3. Mandanten-Zuordnung (`processor.py`)
Weist den Beleg per Absender-E-Mail dem richtigen Mandanten zu.

### 4. Speichern (`file_manager.py` + `db.py`)
- Datei wird in Ordnerstruktur gespeichert: `/data/belege/{mandant_id}/{typ}/`
- PNG-Vorschau wird generiert
- Eintrag in PostgreSQL (`belegdb`, Tabelle `belege`)

### 5. Kontoauszug-Abgleich (`api/routes.py` → `/kontoauszug/analyze`)
Nimmt einen Kontoauszug als PDF, gleicht Transaktionen mit vorhandenen Belegen ab
(±20% Betrag, ±7 Tage Datum, ähnlicher Händlername) und gibt fehlende Belege zurück.

## API-Endpunkte

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/mandanten` | Alle Mandanten auflisten |
| POST | `/mandanten` | Neuen Mandanten anlegen |
| GET | `/mandanten/{id}/belege` | Belege eines Mandanten |
| GET | `/belege/{id}/vorschau` | Bild-Preview |
| GET | `/belege/{id}/datei` | Original-Datei herunterladen |
| DELETE | `/belege/{id}` | Beleg löschen (DB + Dateisystem) |
| POST | `/kontoauszug/analyze` | Kontoauszug analysieren, fehlende Belege finden |
| GET | `/mandanten/{id}/datev-export` | DATEV CSV Export |
| POST | `/agent/run` | E-Mails jetzt manuell verarbeiten |
| GET | `/agent/status` | Statistiken und Polling-Intervall |

## Authentifizierung
Alle Endpunkte erfordern Header: `X-API-Key: hyymD-HMkr2QM6PEabQiu2uJzW1TDIWO0v4eHpFNkyc`

## Datenbankstruktur
- **DB:** PostgreSQL `belegdb` auf `127.0.0.1`
- **Tabellen:** `mandanten`, `belege`
- **Mandant-Matching:** per Absender-E-Mail-Adresse

## KI-Stack
- **Claude Sonnet 4.6** — Klassifikation und Datenextraktion aus Belegen
- **Claude Haiku 4.5** — Kontoauszug-Analyse (günstiger, schneller)

## Dateipfade (Server)
```
/opt/email-agent/
├── main.py
├── requirements.txt
├── .env
├── agent/
│   ├── db.py           ← SQLAlchemy Modelle
│   ├── email_reader.py ← IMAP Reader
│   ├── classifier.py   ← KI-Klassifikation
│   ├── file_manager.py ← Dateispeicherung + Preview
│   ├── processor.py    ← Hauptlogik
│   └── scheduler.py    ← 5-Min Polling
├── api/
│   └── routes.py       ← FastAPI Endpunkte
└── data/
    └── belege/         ← Gespeicherte Belege
```

## Neustart / Logs (SSH)
```bash
systemctl restart email-agent-api
systemctl restart email-agent-scheduler
journalctl -u email-agent-scheduler -f
```
