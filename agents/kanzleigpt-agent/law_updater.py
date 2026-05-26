#!/usr/bin/env python3
"""
Automatischer Gesetzestext-Updater für KanzleiGPT — H&K Automation
Läuft alle 2 Wochen als Cron-Job auf Hetzner.

Ablauf:
1. Lädt offizielle XML-Texte von gesetze-im-internet.de
2. Vergleicht Hashes mit letztem Stand
3. Bei Änderung → Claude analysiert Diff und updated agent.md
4. PM2 Restart damit die neue agent.md sofort aktiv ist
"""

import os, json, hashlib, zipfile, io, subprocess, logging
from datetime import datetime
from pathlib import Path
import requests
import anthropic

# ── Pfade ──────────────────────────────────────────────────────────────────────
BASE     = Path(__file__).parent
AGENT_MD = BASE / "agent.md"
HASH_FILE= BASE / "law_hashes.json"
LOG_FILE = BASE / "updater.log"

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger(__name__)

# ── Claude ─────────────────────────────────────────────────────────────────────
client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# ── Gesetze: (Anzeigename, Slug auf gesetze-im-internet.de) ───────────────────
LAWS = [
    ("EStG",      "estg"),
    ("UStG",      "ustg_1980"),
    ("KStG",      "KStG_1977"),
    ("GewStG",    "gewstg"),
    ("AO",        "ao_1977"),
    ("ErbStG",    "erbstg"),
    ("GrEStG",    "grestg"),
    ("GrStG",     "grstg"),
    ("UmwStG",    "umwstg_2006"),
    ("AStG",      "astg"),
    ("InvStG",    "invstg_2018"),
    ("SolZG",     "solzg_1995"),
    ("HGB",       "hgb"),
    ("GmbHG",     "gmbhg"),
    ("AktG",      "aktg"),
    ("FGO",       "fgo"),
    ("StBerG",    "stberg"),
    ("InsO",      "inso"),
    ("BGB",       "bgb"),
    ("FKAustG",   "fkaustg"),
    ("MinStG",    "minstg"),
    ("PStTG",     "psttg"),
    ("UmwG",      "umwg"),
    ("StBVV",     "stbvv"),
    ("BewG",      "bewg"),
    ("ErbStDV",   "erbstdv"),
]

# ── Hilfsfunktionen ────────────────────────────────────────────────────────────

def download_law(slug: str) -> str | None:
    """Lädt XML-ZIP von gesetze-im-internet.de, gibt Rohtext zurück."""
    url = f"https://www.gesetze-im-internet.de/{slug}/xml.zip"
    try:
        r = requests.get(url, timeout=45, headers={"User-Agent": "HK-LawUpdater/1.0"})
        if r.status_code == 404:
            log.warning(f"{slug}: Gesetz nicht gefunden (404), überspringe")
            return None
        if r.status_code != 200:
            log.warning(f"{slug}: HTTP {r.status_code}")
            return None
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            xml_files = [n for n in zf.namelist() if n.endswith(".xml")]
            if not xml_files:
                log.warning(f"{slug}: Kein XML im ZIP")
                return None
            return zf.read(xml_files[0]).decode("utf-8", errors="replace")
    except Exception as e:
        log.error(f"{slug}: Download-Fehler — {e}")
        return None


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def load_hashes() -> dict:
    if HASH_FILE.exists():
        try:
            return json.loads(HASH_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_hashes(hashes: dict):
    HASH_FILE.write_text(json.dumps(hashes, indent=2, ensure_ascii=False))


def update_agent_md(name: str, old_sample: str | None, new_text: str, current_md: str) -> str:
    """
    Nutzt Claude um die agent.md mit den gesetzlichen Änderungen zu updaten.
    Gibt die aktualisierte agent.md zurück.
    """
    heute = datetime.now().strftime("%d.%m.%Y")
    new_sample = new_text[:12000]  # Erste 12k Zeichen reichen für Kern-Paragrafen

    if old_sample is None:
        prompt = f"""Du bist ein Experte für deutsches Steuerrecht und pflegst den System-Prompt eines KI-Steuerberaters.

Hier ist die aktuelle agent.md:
<agent_md>
{current_md}
</agent_md>

Das Gesetz {name} wurde frisch geladen. Hier ist der offizielle Text (Auszug):
<gesetz name="{name}">
{new_sample}
</gesetz>

Prüfe: Sind alle Informationen zu {name} in der agent.md korrekt und aktuell?
- Wenn ja: Gib die agent.md exakt unverändert zurück.
- Wenn nein: Update nur den betroffenen Abschnitt. Ergänze bei geänderten Werten den Hinweis "(Stand {heute})".

Gib AUSSCHLIESSLICH die vollständige agent.md zurück. Kein Kommentar, keine Erklärung."""

    else:
        prompt = f"""Du bist ein Experte für deutsches Steuerrecht und pflegst den System-Prompt eines KI-Steuerberaters.

Das Gesetz {name} hat sich geändert. Hier ist die aktuelle agent.md:
<agent_md>
{current_md}
</agent_md>

Alter Text {name} (Auszug, Stand zuletzt gespeichert):
<alt>
{old_sample[:6000]}
</alt>

Neuer offizieller Text {name} (Auszug):
<neu>
{new_sample}
</neu>

Identifiziere was sich geändert hat (neue Paragrafen, geänderte Beträge, neue Regelungen).
Update NUR den betroffenen Abschnitt in der agent.md.
Alle anderen Abschnitte bleiben exakt unverändert.
Ergänze bei geänderten Stellen: "(aktualisiert {heute})"

Gib AUSSCHLIESSLICH die vollständige agent.md zurück. Kein Kommentar, keine Erklärung."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text.strip()


def restart_pm2():
    try:
        subprocess.run(
            ["pm2", "restart", "hk-app", "--update-env"],
            check=True, capture_output=True
        )
        log.info("PM2 erfolgreich neu gestartet")
    except Exception as e:
        log.error(f"PM2 Restart fehlgeschlagen: {e}")


# ── Hauptlogik ─────────────────────────────────────────────────────────────────

def main():
    log.info("=" * 60)
    log.info("Gesetzestext-Update gestartet")
    log.info("=" * 60)

    hashes      = load_hashes()
    current_md  = AGENT_MD.read_text(encoding="utf-8")
    changed     = []

    for name, slug in LAWS:
        log.info(f"Prüfe {name} ({slug}) ...")
        new_text = download_law(slug)

        if not new_text:
            continue

        new_hash  = sha256(new_text)
        entry     = hashes.get(slug, {})
        old_hash  = entry.get("hash")

        # Immer last_checked updaten
        hashes[slug] = {
            **entry,
            "hash":         new_hash,
            "last_checked": datetime.now().isoformat(),
        }

        if old_hash == new_hash:
            log.info(f"{name}: Keine Änderung")
            continue

        # Änderung erkannt
        log.info(f"{name}: ÄNDERUNG ERKANNT — aktualisiere agent.md ...")
        old_sample = entry.get("text_sample")

        try:
            new_md = update_agent_md(name, old_sample, new_text, current_md)

            # Sanity check: neue MD darf nicht drastisch kürzer sein
            if len(new_md) < len(current_md) * 0.80:
                log.error(f"{name}: Neue agent.md zu kurz ({len(new_md)} vs {len(current_md)}), verwerfe")
                continue

            current_md = new_md
            changed.append(name)

            hashes[slug]["last_changed"]  = datetime.now().isoformat()
            hashes[slug]["text_sample"]   = new_text[:5000]

            log.info(f"{name}: agent.md erfolgreich aktualisiert")

        except Exception as e:
            log.error(f"{name}: Claude-Fehler — {e}")

    # Hashes immer speichern (last_checked)
    save_hashes(hashes)

    if changed:
        # Backup der alten agent.md
        backup_name = f"agent.md.bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        (BASE / backup_name).write_text(AGENT_MD.read_text(encoding="utf-8"), encoding="utf-8")
        log.info(f"Backup erstellt: {backup_name}")

        # Neue agent.md speichern
        AGENT_MD.write_text(current_md, encoding="utf-8")
        log.info(f"agent.md gespeichert — Änderungen: {', '.join(changed)}")

        # PM2 restart
        restart_pm2()
    else:
        log.info("Keine Gesetzesänderungen — kein Restart nötig")

    log.info("Update abgeschlossen")
    log.info("=" * 60)


if __name__ == "__main__":
    main()
