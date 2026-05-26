"""Scheduler: prüft das Postfach automatisch alle 5 Minuten."""
import time
import signal
import sys
from agent.processor import verarbeite_emails

INTERVALL_SEKUNDEN = 5 * 60  # 5 Minuten

_running = True


def _stop(signum, frame):
    global _running
    print("\nScheduler wird gestoppt...")
    _running = False


def starte_scheduler():
    """Läuft dauerhaft und verarbeitet alle 5 Minuten neue E-Mails."""
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    print(f"Scheduler gestartet — prüfe Postfach alle {INTERVALL_SEKUNDEN // 60} Minuten.")
    print("Zum Beenden: CTRL+C\n")

    while _running:
        print("─" * 50)
        print("Prüfe Postfach...")
        try:
            ergebnis = verarbeite_emails()
            if ergebnis:
                print(f"✓ {len(ergebnis)} Beleg(e) verarbeitet:")
                for b in ergebnis:
                    print(f"  [{b['typ']}] {b['datei']} → {b['mandant']}")
            else:
                print("Keine neuen Belege.")
        except Exception as e:
            print(f"Fehler beim Verarbeiten: {e}")

        if _running:
            print(f"Nächste Prüfung in {INTERVALL_SEKUNDEN // 60} Minuten...\n")
            time.sleep(INTERVALL_SEKUNDEN)

    print("Scheduler beendet.")
