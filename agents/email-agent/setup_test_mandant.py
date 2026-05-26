"""Hilfsskript: legt einen Test-Mandanten in der DB an."""
from agent.db import init_db, SessionLocal, Mandant

init_db()

db = SessionLocal()

# Beispiel-Mandant anlegen
mandant = Mandant(
    id="mueller_gmbh",
    name="Müller GmbH",
    email="svenkonstantinow111@gmail.com",  # ← E-Mail-Adresse von der Belege kommen
    steuernummer="123/456/78901",
)

existing = db.query(Mandant).filter(Mandant.id == mandant.id).first()
if not existing:
    db.add(mandant)
    db.commit()
    print(f"✓ Mandant angelegt: {mandant.name} ({mandant.email})")
else:
    print(f"Mandant existiert bereits: {mandant.name}")

db.close()
