"""Einstiegspunkt: startet den API-Server oder den Agenten direkt."""
import sys
import uvicorn
from agent.db import init_db


def main():
    init_db()

    befehl = sys.argv[1] if len(sys.argv) > 1 else "api"

    if befehl == "run":
        # Einmalig manuell ausführen
        from agent.processor import verarbeite_emails
        ergebnis = verarbeite_emails()
        print(f"\n{len(ergebnis)} Beleg(e) verarbeitet.")
        for b in ergebnis:
            print(f"  - [{b['typ']}] {b['datei']} → Mandant: {b['mandant']}")

    elif befehl == "scheduler":
        # Automatisches Polling alle 5 Minuten
        from agent.scheduler import starte_scheduler
        starte_scheduler()

    else:
        # API-Server starten
        uvicorn.run(
            "api.routes:app",
            host="0.0.0.0",
            port=8000,
            reload=False,
        )


if __name__ == "__main__":
    main()
