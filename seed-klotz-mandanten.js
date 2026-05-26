/**
 * Klotz-Seed: legt die 3 Demo-Mandanten als zentrale DB-Datensätze an,
 * damit ALLE Tools (BWA, Gutachten, Fristen, …) auf dieselbe Mandantenquelle zugreifen.
 *
 * Die Klotz-Kanzlei (id=1) bleibt unangetastet. Idempotent: löscht vor dem Anlegen
 * nur exakt diese 3 Mandanten (per E-Mail) inkl. ihrer Submissions.
 *
 * Ausführen auf dem Server:  cd /opt/hk-app-klotz && node seed-klotz-mandanten.js
 */
require('dotenv').config();
const crypto   = require('crypto');
const Database = require('better-sqlite3');
const path     = require('path');

const DATA_DIR = process.env.HK_DATA_DIR || __dirname;
const db = new Database(path.join(DATA_DIR, 'hk.db'));

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

const KID = 1;            // Kanzlei Andreas Klotz (existiert bereits)
const DUMMY_PWD = 'Klotz2026!';

// staff-IDs (bereits in DB): 1=Louis Honal (admin), 2=Sven Konstantinow (admin), 3=Marc Lichtwald (berater)
const SVEN = 2, LOUIS = 1;

const MANDANTEN = [
  {
    email: 'info@mueller-maschinenbau.de',
    name:  'Müller Maschinenbau GmbH',
    staff: SVEN,
    answers: {
      firmenname: 'Müller Maschinenbau GmbH',
      rechtsform: 'GmbH',
      ort: 'Stuttgart',
      gutachten: {
        typ: 'umwandlung',
        felder: {
          'gu-mandant': 'Müller Maschinenbau GmbH',
          'gu-ort': 'Stuttgart',
          'gu-ausgang': 'GmbH',
          'gu-umsatz': '12.000.000',
          'gu-gewinn': '950.000',
          'gu-eigenkapital': '2.800.000',
          'gu-ma': '65',
          'gu-immo': 'ja',
          'gu-ziel': '',
          'gu-weg': '',
          'gu-stichtag': '',
          'gu-verkauf': '',
          'gutachten-einschaetzung': ''
        }
      }
    }
  },
  {
    email: 'kontakt@bauer-kg.de',
    name:  'Bauer KG',
    staff: LOUIS,
    answers: {
      firmenname: 'Bauer KG',
      rechtsform: 'KG',
      gutachten: {
        typ: 'nachfolge',
        felder: {
          'gn-mandant': 'Bauer KG',
          'gn-rechtsform': 'KG',
          'gn-uebergeber': 'Heinrich Bauer, 62 Jahre',
          'gn-umsatz': '4.800.000',
          'gn-ma': '35',
          'gn-uebernehmer': '',
          'gn-weg': '',
          'gn-gueter': '',
          'gn-wert': '',
          'gn-niessbrauch': '',
          'gn-kinder': '',
          'gutachten-einschaetzung': ''
        }
      }
    }
  },
  {
    email: 'info@schneider-beteiligungs.de',
    name:  'Schneider Beteiligungs GmbH',
    staff: SVEN,
    answers: {
      firmenname: 'Schneider Beteiligungs GmbH',
      rechtsform: 'GmbH',
      gutachten: {
        typ: 'exit',
        felder: {
          'ge-mandant': 'Schneider Beteiligungs GmbH',
          'ge-rechtsform': 'GmbH',
          'ge-umsatz': '22.000.000',
          'ge-ma': '85',
          'ge-immo': 'ja',
          'ge-weg': '',
          'ge-kaeufer': '',
          'ge-zeitrahmen': '',
          'ge-preis': '',
          'gutachten-einschaetzung': ''
        }
      }
    }
  }
];

const delSub  = db.prepare('DELETE FROM submissions WHERE user_id=?');
const findUsr = db.prepare('SELECT id FROM users WHERE kanzlei_id=? AND email=?');
const delUsr  = db.prepare('DELETE FROM users WHERE id=?');
const insUsr  = db.prepare('INSERT INTO users (email, name, password_sha256, kanzlei_id, assigned_staff_id) VALUES (?,?,?,?,?)');
const insSub  = db.prepare('INSERT INTO submissions (user_id, answers, doc_checklist, submitted_at, kanzlei_id) VALUES (?,?,?,?,?)');

const tx = db.transaction(() => {
  for (const m of MANDANTEN) {
    const existing = findUsr.get(KID, m.email);
    if (existing) { delSub.run(existing.id); delUsr.run(existing.id); }

    const u = insUsr.run(m.email, m.name, sha256(DUMMY_PWD), KID, m.staff);
    insSub.run(u.lastInsertRowid, JSON.stringify(m.answers), JSON.stringify([]), new Date().toISOString(), KID);
    console.log(`✓ Mandant angelegt: ${m.name} (userId=${u.lastInsertRowid}, betreut von staff ${m.staff})`);
  }
});
tx();

const cnt = db.prepare('SELECT COUNT(*) AS c FROM users WHERE kanzlei_id=?').get(KID);
console.log(`\nFertig. Mandanten in Kanzlei ${KID}: ${cnt.c}`);
