"""IMAP Email-Reader: verbindet sich mit dem Postfach und holt neue E-Mails mit Anhängen."""
import os
import ssl
import email
from email import policy
from imapclient import IMAPClient
from dotenv import load_dotenv

load_dotenv()

IMAP_HOST = os.getenv("IMAP_HOST", "imap.ionos.de")
IMAP_PORT = int(os.getenv("IMAP_PORT", 993))
IMAP_USER = os.getenv("IMAP_USER", "")
IMAP_PASSWORD = os.getenv("IMAP_PASSWORD", "")

SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".webp", ".gif"}


def fetch_new_emails() -> list[dict]:
    """
    Verbindet sich per IMAP, holt alle ungelesenen E-Mails mit Anhängen.
    Gibt eine Liste von Dicts zurück:
      {
        "uid": int,
        "absender": str,
        "betreff": str,
        "datum": str,
        "anhaenge": [{"dateiname": str, "daten": bytes, "mime_typ": str}]
      }
    """
    results = []

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    with IMAPClient(IMAP_HOST, port=IMAP_PORT, ssl=True, ssl_context=ssl_ctx) as client:
        client.login(IMAP_USER, IMAP_PASSWORD)
        client.select_folder("INBOX")

        # Nur ungelesene E-Mails holen
        uids = client.search(["UNSEEN"])
        if not uids:
            return []

        messages = client.fetch(uids, ["RFC822"])

        for uid, raw_data in messages.items():
            msg = email.message_from_bytes(raw_data[b"RFC822"], policy=policy.default)
            absender = msg.get("From", "")
            betreff = msg.get("Subject", "")
            datum = msg.get("Date", "")

            anhaenge = []
            for part in msg.walk():
                content_disposition = part.get_content_disposition()
                if content_disposition not in ("attachment", "inline"):
                    continue

                dateiname = part.get_filename() or ""
                ext = os.path.splitext(dateiname)[1].lower()
                if ext not in SUPPORTED_EXTENSIONS:
                    continue

                daten = part.get_payload(decode=True)
                if not daten:
                    continue

                anhaenge.append({
                    "dateiname": dateiname,
                    "daten": daten,
                    "mime_typ": part.get_content_type(),
                })

            if anhaenge:
                results.append({
                    "uid": uid,
                    "absender": absender,
                    "betreff": betreff,
                    "datum": datum,
                    "anhaenge": anhaenge,
                })

                # Als gelesen markieren
                client.set_flags([uid], [b"\\Seen"])

    return results
