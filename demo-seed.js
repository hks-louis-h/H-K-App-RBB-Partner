/**
 * Demo-Seed für Müller & Partner Steuerberatung
 * Erstellt eine vollständige Demo-Kanzlei für Verkaufsgespräche.
 *
 * Ausführen: node demo-seed.js
 * Login:     demo@mueller-partner-stb.de / Demo2024!
 */
require('dotenv').config();
const crypto   = require('crypto');
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = process.env.HK_DATA_DIR || __dirname;
const db = new Database(path.join(DATA_DIR, 'hk.db'));

// Minimales gültiges PDF für Demo-Platzhalter
function makePlaceholderPdf(title) {
  const content = `BT /F1 14 Tf 50 780 Td (${title.slice(0,60)}) Tj 50 760 Td (Platzhalter fuer Demo-Zwecke) Tj ET`;
  const streamLen = Buffer.byteLength(content);
  const objects = [
    `1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n`,
    `2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n`,
    `3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n`,
    `4 0 obj\n<</Length ${streamLen}>>\nstream\n${content}\nendstream\nendobj\n`,
    `5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objects) { offsets.push(body.length); body += obj; }
  const xrefPos = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  body += xref + `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body);
}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ─── KANZLEI ─────────────────────────────────────────────────────────────────
const KANZLEI_PWD   = 'Demo2024!';
const KANZLEI_EMAIL = 'demo@mueller-partner-stb.de';
const KANZLEI_NAME  = 'Müller & Partner Steuerberatungsgesellschaft mbH';
const KANZLEI_SLUG  = 'demo';

db.exec(`
  CREATE TABLE IF NOT EXISTS kanzleien (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_sha256 TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT DEFAULT 'starter',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Alte Demo-Kanzlei löschen und neu anlegen
const existingKanzlei = db.prepare('SELECT id FROM kanzleien WHERE slug=?').get(KANZLEI_SLUG);
if (existingKanzlei) {
  const kid = existingKanzlei.id;
  db.prepare('DELETE FROM zeiterfassung WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM rechnungen WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM fristen WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM aufgaben WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM kalender_termine WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM posteingang WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM bescheide WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM bwa_analysen WHERE kanzlei_id=?').run(kid);
  // Documents + Submissions + Users
  const users = db.prepare('SELECT id FROM users WHERE kanzlei_id=?').all(kid);
  for (const u of users) {
    const subs = db.prepare('SELECT id FROM submissions WHERE user_id=?').all(u.id);
    for (const s of subs) db.prepare('DELETE FROM documents WHERE submission_id=?').run(s.id);
    db.prepare('DELETE FROM submissions WHERE user_id=?').run(u.id);
  }
  db.prepare('DELETE FROM users WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM kanzleien WHERE id=?').run(kid);
}

const kanzleiRes = db.prepare(
  'INSERT INTO kanzleien (name, email, password_sha256, slug, plan) VALUES (?,?,?,?,?)'
).run(KANZLEI_NAME, KANZLEI_EMAIL, sha256(KANZLEI_PWD), KANZLEI_SLUG, 'professional');

const KID = kanzleiRes.lastInsertRowid;
console.log(`✓ Kanzlei angelegt: ${KANZLEI_NAME} (id=${KID})`);

// ─── MANDANTEN ────────────────────────────────────────────────────────────────
function insertMandant({ email, name, pwd, answers, docs }) {
  const userRes = db.prepare(
    'INSERT INTO users (email, name, password_sha256, kanzlei_id) VALUES (?,?,?,?)'
  ).run(email, name, sha256(pwd), KID);
  const uid = userRes.lastInsertRowid;

  const docList = docs.map((d, i) => ({ key: `doc${i}`, name: d.name, must: d.must !== false }));
  const subRes = db.prepare(
    'INSERT INTO submissions (user_id, answers, doc_checklist, submitted_at) VALUES (?,?,?,?)'
  ).run(uid, JSON.stringify(answers), JSON.stringify(docList), answers._submitted_at || new Date().toISOString());
  const sid = subRes.lastInsertRowid;

  docs.forEach((d, i) => {
    const hasFile = d.status && d.status !== 'pending';
    const filename = hasFile
      ? d.name.replace(/[^a-zA-Z0-9äöüÄÖÜß\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') + '_2024.pdf'
      : null;

    db.prepare(
      `INSERT INTO documents (submission_id, doc_key, doc_name, is_required, status, ai_result, kanzlei_note, uploaded_at, filename, original_name, filesize, mimetype)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(sid, `doc${i}`, d.name, d.must !== false ? 1 : 0,
      d.status || 'pending', d.ai_result || null, d.note || null,
      hasFile ? d.uploaded_at || new Date(Date.now() - 5 * 86400000).toISOString() : null,
      filename, filename, filename ? 350000 : null, filename ? 'application/pdf' : null
    );

    if (filename) {
      const uploadDir = path.join(DATA_DIR, 'uploads', String(uid));
      fs.mkdirSync(uploadDir, { recursive: true });
      const filepath = path.join(uploadDir, filename);
      if (!fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, makePlaceholderPdf(d.name));
      }
    }
  });
  return { uid, sid };
}

// Hilfsfunktion: Datum relativ zu heute
function daysAgo(n)   { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); }
function daysAhead(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); }
function dtAgo(n)     { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }

const aiOk   = (detected) => JSON.stringify({ ok: true,  confidence: 0.95, detected, message: 'Dokument entspricht dem erwarteten Typ.' });
const aiWarn = (detected, msg) => JSON.stringify({ ok: false, confidence: 0.71, detected, message: msg });

// ── 1. Thomas Berger ─ IT-Berater, Selbstständig ─────────────────────────────
insertMandant({
  email: 't.berger@berger-itconsulting.de', name: 'Thomas Berger', pwd: 'Berger2024',
  answers: {
    _submitted_at: dtAgo(42),
    vorname: 'Thomas', nachname: 'Berger', geburtsdatum: '1979-04-12',
    strasse: 'Theodor-Heuss-Str. 28', plz: '80336', ort: 'München',
    steuer_id: '67 891 234 567', steuernummer: '143/234/56789',
    mandant_typ: 'freiberufler', beschaeftigung: 'selbststaendig',
    familienstand: 'ledig', kinder: 'nein', kirchensteuer: 'nein',
    krankenversicherung: 'pkv',
    einkuenfte_weitere: ['kapital'],
    wk_posten: ['homeoffice', 'fahrtkosten', 'fortbildung', 'arbeitsmittel'],
    ust_pflichtig: 'ja', kleinunternehmer: 'nein',
    firmenwagen_selbst: 'ja', firmenwagen_selbst_methode: 'liste',
    iab_selbst: 'ja',
    wer_hat_gemacht: 'steuerber', offene_bescheide: 'nein', steuerrueckstand: 'nein',
    jahresumsatz: '148500', jahresgewinn_geschaetzt: '94200',
    iban: 'DE89 3704 0044 0532 0130 00',
    freitext: 'Bitte IAB für geplante Server-Investition (ca. 18.000 €) berücksichtigen.'
  },
  docs: [
    { name: 'Einnahmen-Überschuss-Rechnung (EÜR) oder BWA', status: 'approved', ai_result: aiOk('BWA 2024 – Thomas Berger IT Consulting'), note: 'Geprüft, alles vollständig.' },
    { name: 'Kontoauszüge des Geschäftskontos (letztes Jahr)', status: 'approved', ai_result: aiOk('Kontoauszüge Commerzbank 01–12/2024') },
    { name: 'Belege über Betriebsausgaben (Rechnungen, Quittungen)', status: 'ai_ok', ai_result: aiOk('Betriebsausgaben-Sammlung 2024') },
    { name: 'USt-Voranmeldungen des letzten Jahres', status: 'approved', ai_result: aiOk('USt-Voranmeldungen 2024 komplett') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'ai_ok', ai_result: aiOk('Jahressteuerbescheinigung ING 2024') },
    { name: 'Belege Homeoffice (Raumgröße, Nebenkosten, Miete)', status: 'approved', ai_result: aiOk('Mietvertrag + Nebenkostenabrechnung') },
    { name: 'Jahresbescheinigung PKV über geleistete Beiträge', status: 'ai_ok', ai_result: aiOk('Debeka PKV Jahresbescheinigung 2024') },
    { name: 'Investitionsplanung / Angebote für geplante Anschaffungen', status: 'uploaded', must: false },
    { name: 'Letzte Steuererklärung und zugehöriger Steuerbescheid', status: 'approved', ai_result: aiOk('Einkommensteuerbescheid 2022'), must: false },
  ]
});

// ── 2. Familie Schneider ─ Angestellter + Ehefrau ────────────────────────────
insertMandant({
  email: 'h.schneider@web.de', name: 'Hans Schneider', pwd: 'Schneider2024',
  answers: {
    _submitted_at: dtAgo(28),
    vorname: 'Hans', nachname: 'Schneider', geburtsdatum: '1975-09-23',
    strasse: 'Kirchenweg 14', plz: '81543', ort: 'München',
    steuer_id: '45 678 901 234', steuernummer: '143/189/23456',
    mandant_typ: 'privatperson', beschaeftigung: 'angestellt',
    familienstand: 'verheiratet', ehepartner_name: 'Maria Schneider',
    ehepartner_steuer_id: '55 123 456 789',
    kinder: 'ja', kinder_anzahl: 2, kinder_ausbildung: 'nein',
    kirchensteuer: 'ja', confession: 'rk',
    krankenversicherung: 'gesetzlich', kv_name: 'TK',
    einkuenfte_weitere: ['vermietung'],
    wk_posten: ['fahrtkosten', 'homeoffice', 'handwerker', 'riester'],
    mehrere_ag: 'nein',
    wer_hat_gemacht: 'selbst', offene_bescheide: 'nein',
    arbeitgeber_name: 'Siemens AG München',
    arbeitstage_pro_woche: 5, entfernung_km: 18,
    wohnflaeche: 95, homeoffice_tage: 110,
    freitext: 'Wir haben in 2024 die Dachreparatur an der vermieteten Wohnung machen lassen (4.800 €).'
  },
  docs: [
    { name: 'Lohnsteuerbescheinigung(en) aller Arbeitgeber', status: 'approved', ai_result: aiOk('LSt-Bescheinigung Siemens AG 2024') },
    { name: 'Steuer-ID des Ehepartners / eingetr. Lebenspartners', status: 'approved', ai_result: aiOk('Steuer-ID Maria Schneider') },
    { name: 'Geburtsurkunden der Kinder', status: 'approved', ai_result: aiOk('2 Geburtsurkunden vollständig') },
    { name: 'Mietverträge aller vermieteten Objekte', status: 'approved', ai_result: aiOk('Mietvertrag Giesing, gültig ab 01.03.2021') },
    { name: 'Nachweise Mieteinnahmen (Kontoauszüge)', status: 'approved', ai_result: aiOk('Kontoauszüge 12 Monate Mieteinnahmen') },
    { name: 'Belege für Werbungskosten: Reparaturen, Zinsen, Hausgeld', status: 'ai_warn', ai_result: aiWarn('Rechnungsbeleg', 'Lohnanteil auf Rechnung nicht separat ausgewiesen – bitte korrigierte Rechnung anfordern.') },
    { name: 'Zinsbescheinigung(en) der finanzierenden Bank(en)', status: 'approved', ai_result: aiOk('Zinsbescheinigung Sparkasse 2024') },
    { name: 'Jahresbescheinigung Riester / Rürup / bAV-Vertrag', status: 'ai_ok', ai_result: aiOk('Riester-Jahresbescheinigung DWS 2024') },
    { name: 'Nachweis Entfernungen Wohnung–Arbeitsstätte', status: 'approved', ai_result: aiOk('Entfernungsnachweis + Arbeitstage-Bestätigung Siemens') },
    { name: 'Heiratsurkunde', status: 'approved', ai_result: aiOk('Heiratsurkunde 2004'), must: false },
  ]
});

// ── 3. Dr. Sabine Hoffmann ─ Ärztin / Freiberuflerin ─────────────────────────
insertMandant({
  email: 's.hoffmann@praxis-hoffmann.de', name: 'Dr. Sabine Hoffmann', pwd: 'Hoffmann2024',
  answers: {
    _submitted_at: dtAgo(19),
    vorname: 'Sabine', nachname: 'Hoffmann', titel: 'Dr. med.',
    geburtsdatum: '1971-02-28', strasse: 'Nymphenburger Str. 56', plz: '80335', ort: 'München',
    steuer_id: '23 456 789 012', steuernummer: '143/456/78901',
    mandant_typ: 'freiberufler', beschaeftigung: 'selbststaendig',
    beruf: 'Ärztin (Allgemeinmedizin)', praxis_name: 'Gemeinschaftspraxis Hoffmann & Kollegen',
    familienstand: 'geschieden', kinder: 'ja', kinder_anzahl: 1, kinder_ausbildung: 'ja',
    kirchensteuer: 'nein', krankenversicherung: 'pkv',
    einkuenfte_weitere: ['kapital', 'vermietung'],
    wk_posten: ['fahrtkosten', 'fortbildung', 'arbeitsmittel'],
    ust_pflichtig: 'nein',
    verlustvortraege: 'nein', offene_bescheide: 'ja',
    wer_hat_gemacht: 'steuerber',
    jahresumsatz: '387000', jahresgewinn_geschaetzt: '198000',
    freitext: 'Einkommensteuerbescheid 2022 wurde angefochten – Einspruch läuft noch.'
  },
  docs: [
    { name: 'Einnahmen-Überschuss-Rechnung (EÜR) oder BWA', status: 'approved', ai_result: aiOk('EÜR Praxis Hoffmann & Kollegen 2024') },
    { name: 'Kontoauszüge des Geschäftskontos (letztes Jahr)', status: 'approved', ai_result: aiOk('Kontoauszüge Praxiskonto HypoVereinsbank 2024') },
    { name: 'Belege über Betriebsausgaben (Rechnungen, Quittungen)', status: 'ai_ok', ai_result: aiOk('Praxisausgaben 2024 – 47 Belege') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('Comdirect + DKB Steuerbescheinigungen 2024') },
    { name: 'Mietverträge aller vermieteten Objekte', status: 'approved', ai_result: aiOk('Mietvertrag Wohnungen Bogenhausen') },
    { name: 'Nachweise Mieteinnahmen (Kontoauszüge)', status: 'approved', ai_result: aiOk('Mieteinnahmen Nachweise 2024') },
    { name: 'Belege für Werbungskosten: Reparaturen, Zinsen, Hausgeld', status: 'approved' },
    { name: 'Zinsbescheinigung(en) der finanzierenden Bank(en)', status: 'ai_ok', ai_result: aiOk('Zinsbescheinigung DZ HYP 2024') },
    { name: 'Jahresbescheinigung PKV über geleistete Beiträge', status: 'approved', ai_result: aiOk('AXA PKV Jahresbescheinigung 2024') },
    { name: 'Schulbescheinigung / Immatrikulationsbescheinigung', status: 'approved', ai_result: aiOk('Immatrikulationsbescheinigung TU München WS 2025/26') },
    { name: 'Offene Steuerbescheide (mit Einspruchsfrist)', status: 'approved', ai_result: aiOk('ESt-Bescheid 2022 mit Einspruch v. 14.02.2024') },
    { name: 'Letzte Steuererklärung und zugehöriger Steuerbescheid', status: 'approved', ai_result: aiOk('ESt-Erklärung 2022 und Bescheid'), must: false },
  ]
});

// ── 4. TechWave Solutions GmbH ─ IT-Startup ──────────────────────────────────
insertMandant({
  email: 'm.weber@techwave.de', name: 'Max Weber (TechWave Solutions GmbH)', pwd: 'TechWave2024',
  answers: {
    _submitted_at: dtAgo(35),
    vorname: 'Max', nachname: 'Weber', titel: '',
    geburtsdatum: '1988-06-15', strasse: 'Rosenheimer Str. 145', plz: '81671', ort: 'München',
    steuer_id: '78 012 345 678', steuernummer: '143/567/89012',
    mandant_typ: 'unternehmen', rechtsform: 'gmbh',
    firma_name: 'TechWave Solutions GmbH',
    firma_hrb: 'HRB 245891', firma_gruendung: '2019-03-01',
    firma_strasse: 'Rosenheimer Str. 145', firma_plz: '81671', firma_ort: 'München',
    beschaeftigung: 'geschaeftsfuehrer',
    gf_gehalt: 'ja', gf_gehalt_betrag: '84000',
    familienstand: 'ledig', kinder: 'nein', kirchensteuer: 'nein',
    krankenversicherung: 'pkv',
    einkuenfte_weitere: ['kapital'],
    wk_posten: ['homeoffice', 'fortbildung', 'arbeitsmittel'],
    lohnbuchhaltung: 'ja', mitarbeiter_anzahl: 8,
    jahresumsatz_gmbh: '1240000', jahresergebnis_gmbh: '187000',
    ust_pflichtig: 'ja', kleinunternehmer: 'nein',
    iab: 'ja', verlustvortraege: 'nein',
    wer_hat_gemacht: 'steuerber', offene_bescheide: 'nein',
    freitext: 'Wir planen im Q2 2025 eine Investition in neue Serverinfrastruktur (ca. 85.000 €). Bitte IAB prüfen.'
  },
  docs: [
    { name: 'Jahresabschluss 2024 (Bilanz + GuV)', status: 'approved', ai_result: aiOk('TechWave Solutions GmbH Jahresabschluss 2024') },
    { name: 'Körperschaftsteuererklärung 2024', status: 'ai_ok', ai_result: aiOk('KSt-Erklärung 2024 – TechWave Solutions GmbH') },
    { name: 'Gewerbesteuererklärung 2024', status: 'ai_ok', ai_result: aiOk('GewSt-Erklärung 2024') },
    { name: 'USt-Jahreserklärung 2024', status: 'approved', ai_result: aiOk('USt-Jahreserklärung 2024 vollständig') },
    { name: 'Aktuelle Lohnlisten / Arbeitsverträge', status: 'approved', ai_result: aiOk('Lohnlisten 01–12/2024 (8 Mitarbeiter)') },
    { name: 'Anstellungsvertrag als Geschäftsführer', status: 'approved', ai_result: aiOk('GF-Anstellungsvertrag Max Weber') },
    { name: 'Lohnsteuerbescheinigung GF-Gehalt', status: 'approved', ai_result: aiOk('LSt-Bescheinigung GF-Gehalt 2024') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('comdirect Steuerbescheinigung 2024') },
    { name: 'Investitionsplanung / Angebote für geplante Anschaffungen', status: 'uploaded', must: false },
  ]
});

// ── 5. Andreas Koch ─ Immobilieninvestor ────────────────────────────────────
insertMandant({
  email: 'a.koch@gmx.de', name: 'Andreas Koch', pwd: 'Koch2024',
  answers: {
    _submitted_at: dtAgo(12),
    vorname: 'Andreas', nachname: 'Koch', geburtsdatum: '1965-11-08',
    strasse: 'Isartalstr. 38', plz: '80469', ort: 'München',
    steuer_id: '34 567 890 123', steuernummer: '143/678/90123',
    mandant_typ: 'privatperson', beschaeftigung: 'rentner',
    familienstand: 'verheiratet', ehepartner_name: 'Ursula Koch',
    ehepartner_steuer_id: '98 765 432 101',
    kinder: 'ja', kinder_anzahl: 3, kinder_ausbildung: 'nein',
    kirchensteuer: 'ja', confession: 'rk',
    krankenversicherung: 'gesetzlich', kv_name: 'AOK Bayern',
    einkuenfte_weitere: ['vermietung', 'kapital', 'rente_priv'],
    wk_posten: ['handwerker', 'haushaltsnahe', 'riester', 'spenden'],
    verlustvortraege: 'nein', offene_bescheide: 'nein',
    wer_hat_gemacht: 'steuerber',
    immobilien_anzahl: 4,
    freitext: 'Besitze 4 Mietwohnungen in München. Eigentumswohnung Schwabing wurde 2024 renoviert (32.000 €).'
  },
  docs: [
    { name: 'Rentenbescheid / jüngste Rentenanpassungsmitteilung', status: 'approved', ai_result: aiOk('DRV Rentenanpassungsmitteilung 2024') },
    { name: 'Jahresbescheinigung der Rentenversicherung', status: 'approved', ai_result: aiOk('DRV Jahresbescheinigung 2024') },
    { name: 'Mietverträge aller vermieteten Objekte', status: 'approved', ai_result: aiOk('4 Mietverträge München – vollständig') },
    { name: 'Nachweise Mieteinnahmen (Kontoauszüge)', status: 'approved', ai_result: aiOk('Kontoauszüge Mieteinnahmen 2024') },
    { name: 'Belege für Werbungskosten: Reparaturen, Zinsen, Hausgeld, Abschreibungen', status: 'ai_ok', ai_result: aiOk('Reparatur- u. Renovierungsbelege 2024') },
    { name: 'Zinsbescheinigung(en) der finanzierenden Bank(en)', status: 'approved', ai_result: aiOk('3 Zinsbescheinigungen (Volksbank, Sparkasse, ING)') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('Depot-Jahressteuerbescheinigung Consorsbank 2024') },
    { name: 'Jahresbescheinigung der privaten Rentenversicherung', status: 'ai_ok', ai_result: aiOk('Allianz Privatrente Jahresbescheinigung 2024') },
    { name: 'Spendenquittungen (gemeinnützige Organisationen)', status: 'approved', ai_result: aiOk('Spendenquittungen 2024 – 3 Belege'), must: false },
    { name: 'Rechnungen Handwerkerleistungen (Lohnanteil separat ausgewiesen)', status: 'approved', ai_result: aiOk('Handwerkerrechnungen 2024 – Lohnanteil ausgewiesen') },
  ]
});

// ── 6. Bäckerei Mayer KG ─────────────────────────────────────────────────────
insertMandant({
  email: 'j.mayer@baeckerei-mayer.de', name: 'Josef Mayer (Bäckerei Mayer KG)', pwd: 'Baeckerei2024',
  answers: {
    _submitted_at: dtAgo(55),
    vorname: 'Josef', nachname: 'Mayer', geburtsdatum: '1962-03-17',
    strasse: 'Viktualienmarkt 3', plz: '80331', ort: 'München',
    steuer_id: '56 789 012 345', steuernummer: '143/789/01234',
    mandant_typ: 'unternehmen', rechtsform: 'kg',
    firma_name: 'Bäckerei Mayer KG',
    firma_strasse: 'Viktualienmarkt 3', firma_plz: '80331', firma_ort: 'München',
    beschaeftigung: 'selbststaendig',
    familienstand: 'verheiratet', kinder: 'ja', kinder_anzahl: 2,
    kirchensteuer: 'ja', confession: 'rk',
    krankenversicherung: 'gesetzlich',
    ust_pflichtig: 'ja', kleinunternehmer: 'nein',
    lohnbuchhaltung: 'ja', mitarbeiter_anzahl: 12,
    jahresumsatz: '890000', jahresgewinn_geschaetzt: '68000',
    datev_nr: 'DATEV-10045712',
    wer_hat_gemacht: 'steuerber', offene_bescheide: 'nein',
    firmenwagen_selbst: 'ja', firmenwagen_selbst_methode: 'liste',
    freitext: 'Neue Backanlage 2024 angeschafft (68.000 €). Bitte degressive AfA berechnen.'
  },
  docs: [
    { name: 'Jahresabschluss 2024 (Bilanz + GuV)', status: 'approved', ai_result: aiOk('Bäckerei Mayer KG Jahresabschluss 2024') },
    { name: 'Einnahmen-Überschuss-Rechnung (EÜR) oder BWA', status: 'approved', ai_result: aiOk('BWA Bäckerei Mayer KG 12/2024') },
    { name: 'USt-Voranmeldungen des letzten Jahres', status: 'approved', ai_result: aiOk('USt-Voranmeldungen 2024 komplett') },
    { name: 'Aktuelle Lohnlisten / Arbeitsverträge', status: 'approved', ai_result: aiOk('Lohnlisten 01–12/2024 (12 Mitarbeiter)') },
    { name: 'Belege über Betriebsausgaben (Rechnungen, Quittungen)', status: 'ai_ok', ai_result: aiOk('Betriebsausgaben 2024 – Investitionen und lfd. Kosten') },
    { name: 'Kontoauszüge des Geschäftskontos (letztes Jahr)', status: 'approved', ai_result: aiOk('Geschäftskonto Stadtsparkasse München 2024') },
    { name: 'DATEV-Mandantennummer: DATEV-10045712', status: 'approved', ai_result: aiOk('DATEV-Exportdaten 2024'), must: false },
  ]
});

// ── 7. Petra Schulz ─ Lehrerin (Beamtin) ──────────────────────────────────
insertMandant({
  email: 'p.schulz@outlook.de', name: 'Petra Schulz', pwd: 'Schulz2024',
  answers: {
    _submitted_at: dtAgo(8),
    vorname: 'Petra', nachname: 'Schulz', geburtsdatum: '1981-07-04',
    strasse: 'Franziskanerstr. 22', plz: '81669', ort: 'München',
    steuer_id: '89 123 456 789', steuernummer: '143/890/12345',
    mandant_typ: 'privatperson', beschaeftigung: 'beamter',
    beruf: 'Gymnasiallehrerin (Deutsch / Geschichte)',
    familienstand: 'ledig', kinder: 'nein',
    kirchensteuer: 'ja', confession: 'evang',
    krankenversicherung: 'pkv',
    wk_posten: ['fahrtkosten', 'homeoffice', 'fortbildung', 'arbeitsmittel', 'riester'],
    einkuenfte_weitere: [],
    offene_bescheide: 'nein', wer_hat_gemacht: 'selbst',
    arbeitgeber_name: 'Freistaat Bayern / Max-Gymnasium München',
    arbeitstage_pro_woche: 5, entfernung_km: 6,
    homeoffice_tage: 45,
    freitext: 'Habe 2024 einen neuen Laptop (1.299 €) und Fachliteratur für ca. 380 € gekauft.'
  },
  docs: [
    { name: 'Bezügemitteilung / Jahresabrechnung', status: 'approved', ai_result: aiOk('Jahresbezügemitteilung Freistaat Bayern 2024') },
    { name: 'Nachweis Entfernungen Wohnung–Arbeitsstätte', status: 'approved', ai_result: aiOk('Adressnachweis + Google Maps Entfernung') },
    { name: 'Rechnungen / Quittungen Fortbildungen, Fachliteratur', status: 'ai_ok', ai_result: aiOk('Quittungen Fachliteratur + Online-Fortbildung 2024') },
    { name: 'Rechnungen Arbeitsmittel (PC, Schreibtisch, etc.)', status: 'approved', ai_result: aiOk('Rechnung Laptop Cyberport 1.299 €, Sept. 2024') },
    { name: 'Jahresbescheinigung PKV über geleistete Beiträge', status: 'approved', ai_result: aiOk('Beihilfe + PKV Debeka Jahresbescheinigung 2024') },
    { name: 'Jahresbescheinigung Riester / Rürup / bAV-Vertrag', status: 'uploaded' },
  ]
});

// ── 8. Florian Braun ─ Freelancer / Webdesigner ───────────────────────────
insertMandant({
  email: 'f.braun@creativcode.de', name: 'Florian Braun', pwd: 'Braun2024',
  answers: {
    _submitted_at: dtAgo(3),
    vorname: 'Florian', nachname: 'Braun', geburtsdatum: '1993-12-01',
    strasse: 'Schellingstr. 65', plz: '80799', ort: 'München',
    steuer_id: '12 345 678 901', steuernummer: '143/901/23456',
    mandant_typ: 'freiberufler', beschaeftigung: 'selbststaendig',
    beruf: 'Webdesigner / UI-UX Designer',
    familienstand: 'ledig', kinder: 'nein', kirchensteuer: 'nein',
    krankenversicherung: 'gesetzlich', kv_name: 'Barmer',
    ust_pflichtig: 'ja', kleinunternehmer: 'nein',
    einkuenfte_weitere: ['kapital'],
    wk_posten: ['homeoffice', 'arbeitsmittel', 'fortbildung'],
    offene_bescheide: 'nein', wer_hat_gemacht: 'selbst',
    jahresumsatz: '76400', jahresgewinn_geschaetzt: '52100',
    freitext: 'Bin 2024 von Kleinunternehmer zu Regelbesteuerung gewechselt. Erste Steuererklärung mit USt.'
  },
  docs: [
    { name: 'Einnahmen-Überschuss-Rechnung (EÜR) oder BWA', status: 'pending' },
    { name: 'Kontoauszüge des Geschäftskontos (letztes Jahr)', status: 'uploaded' },
    { name: 'Belege über Betriebsausgaben (Rechnungen, Quittungen)', status: 'pending' },
    { name: 'USt-Voranmeldungen des letzten Jahres', status: 'ai_warn', ai_result: aiWarn('Dokument unlesbar', 'Scan zu niedrige Auflösung – bitte erneut hochladen.') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'pending' },
    { name: 'Belege Homeoffice (Raumgröße, Nebenkosten, Miete)', status: 'pending' },
  ]
});

// ── 9. Dipl.-Ing. Klaus Zimmermann ─ Architekt ────────────────────────────
insertMandant({
  email: 'k.zimmermann@zimmermann-architekten.de', name: 'Klaus Zimmermann', pwd: 'Zimmermann2024',
  answers: {
    _submitted_at: dtAgo(21),
    vorname: 'Klaus', nachname: 'Zimmermann', titel: 'Dipl.-Ing.',
    geburtsdatum: '1968-05-30', strasse: 'Widenmayerstr. 19', plz: '80538', ort: 'München',
    steuer_id: '01 234 567 890', steuernummer: '143/012/34567',
    mandant_typ: 'freiberufler', beschaeftigung: 'selbststaendig',
    beruf: 'Architekt / Stadtplaner',
    firma_name: 'Zimmermann Architekten GmbH',
    familienstand: 'verheiratet', ehepartner_name: 'Claudia Zimmermann',
    ehepartner_steuer_id: '11 222 333 444',
    kinder: 'ja', kinder_anzahl: 2, kinder_ausbildung: 'ja',
    kirchensteuer: 'nein', krankenversicherung: 'pkv',
    ust_pflichtig: 'ja', kleinunternehmer: 'nein',
    einkuenfte_weitere: ['kapital', 'vermietung'],
    wk_posten: ['fahrtkosten', 'homeoffice', 'fortbildung', 'arbeitsmittel'],
    verlustvortraege: 'ja', offene_bescheide: 'nein',
    wer_hat_gemacht: 'steuerber',
    jahresumsatz: '410000', jahresgewinn_geschaetzt: '156000',
    freitext: 'Verlustfeststellungsbescheid 2020 liegt vor (Verlust 28.000 €). Bürorenovierung 2024: 14.500 €.'
  },
  docs: [
    { name: 'Einnahmen-Überschuss-Rechnung (EÜR) oder BWA', status: 'approved', ai_result: aiOk('EÜR Zimmermann Architekten 2024') },
    { name: 'Kontoauszüge des Geschäftskontos (letztes Jahr)', status: 'approved', ai_result: aiOk('Kontoauszüge HVB 2024') },
    { name: 'Belege über Betriebsausgaben (Rechnungen, Quittungen)', status: 'ai_ok', ai_result: aiOk('Betriebsausgaben inkl. Bürorenovierung 2024') },
    { name: 'USt-Voranmeldungen des letzten Jahres', status: 'approved', ai_result: aiOk('USt-Voranmeldungen 2024') },
    { name: 'Steuer-ID des Ehepartners / eingetr. Lebenspartners', status: 'approved', ai_result: aiOk('Steuer-ID Claudia Zimmermann') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('Depot-Steuerbescheinigung 2024') },
    { name: 'Schulbescheinigung / Immatrikulationsbescheinigung', status: 'approved', ai_result: aiOk('Immatr.-Bescheinigung LMU 2025/26') },
    { name: 'Verlustfeststellungsbescheide der Vorjahre', status: 'approved', ai_result: aiOk('Verlustfeststellungsbescheid 2020 – 28.000 €') },
    { name: 'Zinsbescheinigung(en) der finanzierenden Bank(en)', status: 'ai_ok', ai_result: aiOk('Zinsbescheinigung Postbank 2024') },
    { name: 'Jahresbescheinigung PKV über geleistete Beiträge', status: 'approved', ai_result: aiOk('Signal Iduna PKV 2024') },
  ]
});

// ── 10. Maria Winkler ─ Rentnerin ─────────────────────────────────────────
insertMandant({
  email: 'm.winkler@t-online.de', name: 'Maria Winkler', pwd: 'Winkler2024',
  answers: {
    _submitted_at: dtAgo(60),
    vorname: 'Maria', nachname: 'Winkler', geburtsdatum: '1952-08-19',
    strasse: 'Sendlinger Str. 48', plz: '80331', ort: 'München',
    steuer_id: '90 123 456 789', steuernummer: '143/123/45678',
    mandant_typ: 'privatperson', beschaeftigung: 'rentner',
    familienstand: 'verwitwet', kinder: 'ja', kinder_anzahl: 2, kinder_ausbildung: 'nein',
    kirchensteuer: 'ja', confession: 'rk',
    krankenversicherung: 'gesetzlich', kv_name: 'BKK VBU',
    einkuenfte_weitere: ['kapital', 'rente_priv'],
    wk_posten: ['haushaltsnahe', 'handwerker', 'krankheit'],
    offene_bescheide: 'nein', wer_hat_gemacht: 'steuerber',
    freitext: 'Habe 2024 hohe Zahnarztrechnung (4.200 €) gehabt. Bitte außergewöhnliche Belastungen prüfen.'
  },
  docs: [
    { name: 'Rentenbescheid / jüngste Rentenanpassungsmitteilung', status: 'approved', ai_result: aiOk('DRV Rentenanpassungsmitteilung Juli 2024') },
    { name: 'Jahresbescheinigung der Rentenversicherung', status: 'approved', ai_result: aiOk('DRV Jahresbescheinigung 2024') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('Sparkasse München Jahressteuerbescheinigung 2024') },
    { name: 'Jahresbescheinigung der privaten Rentenversicherung', status: 'approved', ai_result: aiOk('Generali Lebensversicherung Jahresbescheinigung 2024') },
    { name: 'Rechnungen haushaltsnahe Dienstleistungen', status: 'approved', ai_result: aiOk('Haushaltshilfe-Rechnungen 2024 (12 Monate)') },
    { name: 'Rechnungen Handwerkerleistungen (Lohnanteil separat ausgewiesen)', status: 'approved', ai_result: aiOk('Sanitärreparatur + Malerarbeiten 2024') },
    { name: 'Ärztliche Rechnungen, Rezepte, Zuzahlungsbelege', status: 'approved', ai_result: aiOk('Zahnarzt + Brille + Rezepte 2024') },
  ]
});

// ── 11. Stefan Richter ─ GmbH-Geschäftsführer ─────────────────────────────
insertMandant({
  email: 's.richter@richter-holding.de', name: 'Stefan Richter', pwd: 'Richter2024',
  answers: {
    _submitted_at: dtAgo(14),
    vorname: 'Stefan', nachname: 'Richter', geburtsdatum: '1970-01-22',
    strasse: 'Maximilianstr. 35', plz: '80539', ort: 'München',
    steuer_id: '45 012 345 678', steuernummer: '143/234/56789',
    mandant_typ: 'unternehmen', rechtsform: 'gmbh',
    firma_name: 'Richter Immobilien Holding GmbH',
    firma_hrb: 'HRB 189345',
    familienstand: 'verheiratet', kinder: 'ja', kinder_anzahl: 2,
    kirchensteuer: 'nein', krankenversicherung: 'pkv',
    beschaeftigung: 'geschaeftsfuehrer',
    gf_gehalt: 'ja', gf_gehalt_betrag: '120000',
    einkuenfte_weitere: ['vermietung', 'kapital'],
    wk_posten: ['fahrtkosten', 'homeoffice', 'arbeitsmittel'],
    ust_pflichtig: 'ja', kleinunternehmer: 'nein',
    lohnbuchhaltung: 'ja', mitarbeiter_anzahl: 3,
    verlustvortraege: 'nein', offene_bescheide: 'ja',
    jahresumsatz_gmbh: '520000', jahresergebnis_gmbh: '94000',
    firmenwagen_selbst: 'ja', firmenwagen_selbst_methode: '1prozent',
    wer_hat_gemacht: 'steuerber',
    freitext: 'Gewerbesteuerbescheid 2022 erscheint fehlerhaft (Hinzurechnung Dauerschuldzinsen). Bitte prüfen.'
  },
  docs: [
    { name: 'Jahresabschluss 2024 (Bilanz + GuV)', status: 'ai_ok', ai_result: aiOk('Richter Immobilien Holding GmbH – Jahresabschluss 2024') },
    { name: 'Körperschaftsteuererklärung 2024', status: 'pending' },
    { name: 'Gewerbesteuererklärung 2024', status: 'pending' },
    { name: 'USt-Jahreserklärung 2024', status: 'ai_ok', ai_result: aiOk('USt-Jahreserklärung 2024') },
    { name: 'Anstellungsvertrag als Geschäftsführer', status: 'approved', ai_result: aiOk('GF-Anstellungsvertrag Richter') },
    { name: 'Lohnsteuerbescheinigung GF-Gehalt', status: 'approved', ai_result: aiOk('LSt-Bescheinigung GF-Gehalt 2024 – 120.000 €') },
    { name: 'Offene Steuerbescheide (mit Einspruchsfrist)', status: 'approved', ai_result: aiOk('GewSt-Bescheid 2022 vom 18.11.2023') },
    { name: 'Mietverträge aller vermieteten Objekte', status: 'approved', ai_result: aiOk('3 Gewerbemietverträge 2024') },
    { name: 'Zinsbescheinigung(en) der finanzierenden Bank(en)', status: 'approved', ai_result: aiOk('BayernLB Zinsbescheinigung 2024') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('Comdirect + DKB Steuerbescheinigungen 2024') },
  ]
});

// ── 12. Dr. Juliane Fischer ─ Ärztin Gemeinschaftspraxis ─────────────────
insertMandant({
  email: 'j.fischer@gemeinschaftspraxis-nord.de', name: 'Dr. Juliane Fischer', pwd: 'Fischer2024',
  answers: {
    _submitted_at: dtAgo(48),
    vorname: 'Juliane', nachname: 'Fischer', titel: 'Dr. med.',
    geburtsdatum: '1982-10-14', strasse: 'Leopoldstr. 142', plz: '80804', ort: 'München',
    steuer_id: '67 890 123 456', steuernummer: '143/345/67890',
    mandant_typ: 'freiberufler', beschaeftigung: 'selbststaendig',
    beruf: 'Fachärztin für Innere Medizin (Gemeinschaftspraxis)',
    familienstand: 'verheiratet', ehepartner_name: 'Markus Fischer',
    ehepartner_steuer_id: '22 333 444 555',
    kinder: 'ja', kinder_anzahl: 2, kinder_ausbildung: 'nein',
    kirchensteuer: 'nein', krankenversicherung: 'pkv',
    ust_pflichtig: 'nein',
    einkuenfte_weitere: ['kapital'],
    wk_posten: ['fahrtkosten', 'fortbildung', 'arbeitsmittel', 'riester'],
    verlustvortraege: 'nein', offene_bescheide: 'nein',
    wer_hat_gemacht: 'steuerber',
    jahresumsatz: '268000', jahresgewinn_geschaetzt: '141000',
    freitext: 'Anteil an der Gemeinschaftspraxis: 40 %. Fortbildungskosten 2024 ca. 6.200 € (Kongresse).'
  },
  docs: [
    { name: 'Einnahmen-Überschuss-Rechnung (EÜR) oder BWA', status: 'approved', ai_result: aiOk('Gewinnanteil Fischer aus Gemeinschaftspraxis 2024') },
    { name: 'Kontoauszüge des Geschäftskontos (letztes Jahr)', status: 'approved', ai_result: aiOk('Praxiskonto HVB 2024') },
    { name: 'Belege über Betriebsausgaben (Rechnungen, Quittungen)', status: 'approved', ai_result: aiOk('Fortbildungs- und Praxisausgaben 2024') },
    { name: 'Jahressteuerbescheinigung(en) aller Banken / Depots', status: 'approved', ai_result: aiOk('Depot DKB Steuerbescheinigung 2024') },
    { name: 'Steuer-ID des Ehepartners / eingetr. Lebenspartners', status: 'approved', ai_result: aiOk('Steuer-ID Markus Fischer') },
    { name: 'Jahresbescheinigung PKV über geleistete Beiträge', status: 'approved', ai_result: aiOk('Allianz PKV Jahresbescheinigung 2024') },
    { name: 'Jahresbescheinigung Riester / Rürup / bAV-Vertrag', status: 'approved', ai_result: aiOk('Rürup-Jahresbescheinigung Allianz 2024') },
    { name: 'Geburtsurkunden der Kinder', status: 'approved', ai_result: aiOk('2 Geburtsurkunden') },
    { name: 'Letzte Steuererklärung und zugehöriger Steuerbescheid', status: 'approved', ai_result: aiOk('ESt-Erklärung 2023 und Bescheid'), must: false },
  ]
});

console.log('✓ 12 Mandanten angelegt');

// ─── FRISTEN ─────────────────────────────────────────────────────────────────
const fristen = [
  { mandant_name: 'Thomas Berger',            titel: 'Einkommensteuererklärung 2024 einreichen',        typ: 'steuererklaerung', faellig_am: daysAhead(38), notiz: 'EÜR liegt vor. KSt-Vorauszahlungen anpassen.' },
  { mandant_name: 'Familie Schneider',         titel: 'Einkommensteuererklärung 2024 – Handwerkerbeleg klären', typ: 'steuererklaerung', faellig_am: daysAhead(52), notiz: 'Korrigierte Rechnung Klempner anfordern.' },
  { mandant_name: 'Dr. Sabine Hoffmann',       titel: 'Einspruch Einkommensteuerbescheid 2022 – Begründung nachreichen', typ: 'einspruch', faellig_am: daysAhead(14), notiz: 'Einspruch fristgerecht am 14.02.2024 eingelegt. Begründung bis 31.03.2026.' },
  { mandant_name: 'TechWave Solutions GmbH',   titel: 'Körperschaftsteuererklärung 2024 abgeben',       typ: 'steuererklaerung', faellig_am: daysAhead(67), notiz: 'Jahresabschluss noch in Erstellung.' },
  { mandant_name: 'TechWave Solutions GmbH',   titel: 'USt-Voranmeldung März 2026 (Fälligkeit 10.04.)', typ: 'ust', faellig_am: daysAhead(35), notiz: '' },
  { mandant_name: 'Bäckerei Mayer KG',         titel: 'Jahresabschluss 2024 fertigstellen und einreichen', typ: 'jahresabschluss', faellig_am: daysAhead(28), notiz: 'DATEV-Buchführung vollständig. AfA neue Backanlage einarbeiten.' },
  { mandant_name: 'Bäckerei Mayer KG',         titel: 'Lohnsteueranmeldung Q1 2026 (bis 10.04.2026)',   typ: 'lohnsteuer', faellig_am: daysAhead(35), notiz: '12 Mitarbeiter, Lohnlisten vollständig.' },
  { mandant_name: 'Andreas Koch',              titel: 'Einkommensteuererklärung 2024 – Vermietungseinkünfte', typ: 'steuererklaerung', faellig_am: daysAhead(44), notiz: 'Renovierungskosten Schwabing: Erhaltungsaufwand vs. Herstellungskosten prüfen.' },
  { mandant_name: 'Klaus Zimmermann',          titel: 'Gewerbesteuererklärung 2024 (Zimmermann Architekten GmbH)', typ: 'steuererklaerung', faellig_am: daysAhead(72), notiz: '' },
  { mandant_name: 'Stefan Richter',            titel: 'Einspruchsbegründung GewSt-Bescheid 2022',       typ: 'einspruch', faellig_am: daysAhead(7),  notiz: 'Hinzurechnung Dauerschuldzinsen § 8 Nr. 1a GewStG – Berechnung prüfen.' },
  { mandant_name: 'Florian Braun',             titel: 'Einkommensteuererklärung 2024 – Unterlagen vollständig einfordern', typ: 'steuererklaerung', faellig_am: daysAhead(21), notiz: 'EÜR und USt-Voranmeldungen fehlen noch.' },
  { mandant_name: 'Dr. Juliane Fischer',       titel: 'Einkommensteuererklärung 2024 abgeben',          typ: 'steuererklaerung', faellig_am: daysAhead(58), notiz: 'Gewinnanteil Gemeinschaftspraxis: 40 %.' },
  { mandant_name: '',                          titel: 'USt-Jahreserklärung 2024 – Fristablauf alle USt-Pflichtigen', typ: 'ust', faellig_am: daysAhead(81), notiz: 'Betrifft: Berger, TechWave, Mayer, Zimmermann, Richter' },
  { mandant_name: 'Maria Winkler',             titel: 'Einkommensteuererklärung 2024 einreichen',        typ: 'steuererklaerung', faellig_am: daysAhead(90), notiz: 'Außergewöhnliche Belastungen Zahnarzt: 4.200 € – Zumutbarkeitsgrenze berechnen.' },
];
const insertFrist = db.prepare('INSERT INTO fristen (mandant_name, titel, typ, faellig_am, notiz, kanzlei_id) VALUES (?,?,?,?,?,?)');
for (const f of fristen) insertFrist.run(f.mandant_name, f.titel, f.typ, f.faellig_am, f.notiz, KID);
console.log(`✓ ${fristen.length} Fristen angelegt`);

// ─── AUFGABEN ─────────────────────────────────────────────────────────────────
const aufgaben = [
  { mandant_name: 'Thomas Berger',            titel: 'Investitionsangebot Server prüfen und IAB berechnen', beschreibung: 'Angebot Hetzner Cloud liegt vor (18.200 €). IAB 50 % nach § 7g EStG → 9.100 € sofort abzugsfähig.', prioritaet: 'hoch',   status: 'offen',       faellig_am: daysAhead(5) },
  { mandant_name: 'Familie Schneider',         titel: 'Handwerkerrechnung korrigierte Fassung anfordern',   beschreibung: 'Klempner Müller GmbH – Lohnanteil muss separat ausgewiesen sein (§ 35a Abs. 3 EStG).', prioritaet: 'mittel', status: 'offen',       faellig_am: daysAhead(10) },
  { mandant_name: 'Dr. Sabine Hoffmann',       titel: 'Einspruchsbegründung 2022 ausarbeiten',              beschreibung: 'Praxiskosten-Aufteilung (privat/betrieblich) belegen. Fahrtenbuch Prüfung.', prioritaet: 'hoch',   status: 'in_bearbeitung', faellig_am: daysAhead(14) },
  { mandant_name: 'TechWave Solutions GmbH',   titel: 'Jahresabschluss mit WP abstimmen',                  beschreibung: 'Wirtschaftsprüfer Termin: 18.03.2026, 14:00 Uhr. Unterlagen vorab senden.', prioritaet: 'hoch',   status: 'in_bearbeitung', faellig_am: daysAhead(12) },
  { mandant_name: 'Bäckerei Mayer KG',         titel: 'Degressive AfA Backanlage (68.000 €) berechnen',    beschreibung: 'Degressive AfA 25 % nach § 7 Abs. 2 EStG (WCG 2024). Jahr 1: 17.000 €.', prioritaet: 'mittel', status: 'erledigt',    faellig_am: daysAgo(5) },
  { mandant_name: 'Stefan Richter',            titel: 'GewSt-Bescheid 2022 – Einspruchsbegründung',        beschreibung: 'Dauerschuldzinsen: 240.000 € × 25 % = 60.000 € Hinzurechnung. Prüfen ob Schuldzinsen aus Betriebserwerb.', prioritaet: 'hoch', status: 'in_bearbeitung', faellig_am: daysAhead(7) },
  { mandant_name: 'Florian Braun',             titel: 'USt-Voranmeldungen 2024 anfordern und neu hochladen', beschreibung: 'Scan unleserlich. Per E-Mail korrektes PDF anfordern.', prioritaet: 'mittel', status: 'offen', faellig_am: daysAhead(3) },
  { mandant_name: 'Andreas Koch',              titel: 'Renovierungskosten Schwabing: Erhaltung vs. Herstellungskosten', beschreibung: '32.000 € Dacherneuerung: Prüfung ob anschaffungsnahe Herstellungskosten (§ 6 Abs. 1 Nr. 1a EStG, 15%-Grenze) oder Erhaltungsaufwand.', prioritaet: 'hoch', status: 'offen', faellig_am: daysAhead(8) },
  { mandant_name: 'Klaus Zimmermann',          titel: 'Verlustabzug 2020 in Erklärung 2024 einarbeiten',   beschreibung: 'Verlustvortrag 28.000 € (Bescheid 2020). In ESt 2024 mindernd berücksichtigen.', prioritaet: 'niedrig', status: 'offen', faellig_am: daysAhead(30) },
  { mandant_name: '',                          titel: 'Mandantenzufriedenheitsbefragung Q1/2026 vorbereiten', beschreibung: 'E-Mail an alle 12 Mandanten mit Feedback-Link. Termin: Ende März 2026.', prioritaet: 'niedrig', status: 'offen', faellig_am: daysAhead(25) },
  { mandant_name: 'Dr. Juliane Fischer',       titel: 'Kongress-Fortbildungskosten zusammenstellen',       beschreibung: 'Ca. 6.200 € Fortbildungen (ESC Madrid, DGIM München, Online-Fortbildungen). Rechnungen vollständig vorhanden.', prioritaet: 'niedrig', status: 'erledigt', faellig_am: daysAgo(3) },
  { mandant_name: 'Maria Winkler',             titel: 'Außergewöhnliche Belastungen Zahnarzt berechnen',   beschreibung: 'Einkommen ~22.000 €, Zumutbarkeit 2 % = 440 €. Abzugsfähig: 4.200 – 440 = 3.760 €.', prioritaet: 'mittel', status: 'offen', faellig_am: daysAhead(15) },
];
const insertAufgabe = db.prepare('INSERT INTO aufgaben (mandant_name, titel, beschreibung, prioritaet, status, faellig_am, kanzlei_id) VALUES (?,?,?,?,?,?,?)');
for (const a of aufgaben) insertAufgabe.run(a.mandant_name, a.titel, a.beschreibung, a.prioritaet, a.status, a.faellig_am, KID);
console.log(`✓ ${aufgaben.length} Aufgaben angelegt`);

// ─── RECHNUNGEN ──────────────────────────────────────────────────────────────
const rechnungen = [
  { mandant_name: 'Thomas Berger',            mandant_email: 't.berger@berger-itconsulting.de', beschreibung: 'Steuererklärung 2024 – Einkommensteuer Freiberufler inkl. EÜR, USt und ESt-Erklärung', betrag: 1850.00, status: 'bezahlt', faellig_am: daysAgo(30) },
  { mandant_name: 'Thomas Berger',            mandant_email: 't.berger@berger-itconsulting.de', beschreibung: 'Steuerberatung Unterjährig Q1 2026 – USt-Voranmeldungen Januar & Februar', betrag: 480.00, status: 'offen', faellig_am: daysAhead(18) },
  { mandant_name: 'Familie Schneider',         mandant_email: 'h.schneider@web.de',             beschreibung: 'Einkommensteuererklärung 2024 (zusammen veranlagt, 2 Kinder, Vermietung)', betrag: 1420.00, status: 'bezahlt', faellig_am: daysAgo(14) },
  { mandant_name: 'Dr. Sabine Hoffmann',       mandant_email: 's.hoffmann@praxis-hoffmann.de', beschreibung: 'Steuererklärung 2024 inkl. Praxisgewinnermittlung, Anlage S, Anlage KAP', betrag: 2380.00, status: 'offen', faellig_am: daysAhead(10) },
  { mandant_name: 'Dr. Sabine Hoffmann',       mandant_email: 's.hoffmann@praxis-hoffmann.de', beschreibung: 'Einspruchsbearbeitung Einkommensteuerbescheid 2022 – Begründung und Schriftverkehr', betrag: 780.00, status: 'bezahlt', faellig_am: daysAgo(45) },
  { mandant_name: 'TechWave Solutions GmbH',   mandant_email: 'm.weber@techwave.de',           beschreibung: 'Jahresabschluss 2024 – GmbH Bilanz, GuV, Körperschaftsteuer, Gewerbesteuer', betrag: 4200.00, status: 'offen', faellig_am: daysAhead(21) },
  { mandant_name: 'TechWave Solutions GmbH',   mandant_email: 'm.weber@techwave.de',           beschreibung: 'Monatliche Buchführung und Lohnabrechnung Q4 2025 (8 Mitarbeiter)', betrag: 1860.00, status: 'bezahlt', faellig_am: daysAgo(60) },
  { mandant_name: 'TechWave Solutions GmbH',   mandant_email: 'm.weber@techwave.de',           beschreibung: 'Monatliche Buchführung und Lohnabrechnung Q1 2026 (8 Mitarbeiter)', betrag: 1860.00, status: 'offen', faellig_am: daysAhead(25) },
  { mandant_name: 'Andreas Koch',              mandant_email: 'a.koch@gmx.de',                beschreibung: 'Einkommensteuererklärung 2024 – Rente, 4 Mietobjekte, Kapitalerträge', betrag: 1680.00, status: 'bezahlt', faellig_am: daysAgo(7) },
  { mandant_name: 'Bäckerei Mayer KG',         mandant_email: 'j.mayer@baeckerei-mayer.de',   beschreibung: 'Jahresabschluss 2024 – KG-Bilanz, Feststellungserklärung, GewSt, USt-Jahreserklärung', betrag: 5640.00, status: 'offen', faellig_am: daysAhead(14) },
  { mandant_name: 'Bäckerei Mayer KG',         mandant_email: 'j.mayer@baeckerei-mayer.de',   beschreibung: 'Monatliche Buchführung + Lohnabrechnung Januar 2026 (12 Mitarbeiter)', betrag: 2100.00, status: 'bezahlt', faellig_am: daysAgo(35) },
  { mandant_name: 'Bäckerei Mayer KG',         mandant_email: 'j.mayer@baeckerei-mayer.de',   beschreibung: 'Monatliche Buchführung + Lohnabrechnung Februar 2026 (12 Mitarbeiter)', betrag: 2100.00, status: 'bezahlt', faellig_am: daysAgo(3) },
  { mandant_name: 'Petra Schulz',              mandant_email: 'p.schulz@outlook.de',          beschreibung: 'Einkommensteuererklärung 2024 – Beamtin, Werbungskosten, Riester', betrag: 680.00, status: 'offen', faellig_am: daysAhead(8) },
  { mandant_name: 'Klaus Zimmermann',          mandant_email: 'k.zimmermann@zimmermann-architekten.de', beschreibung: 'Steuererklärung 2024 – Architekt, EÜR, Anlage S, Anlage V, Verlustvortrag', betrag: 2140.00, status: 'bezahlt', faellig_am: daysAgo(20) },
  { mandant_name: 'Maria Winkler',             mandant_email: 'm.winkler@t-online.de',        beschreibung: 'Einkommensteuererklärung 2024 – Rente, Kapitalerträge, außergewöhnl. Belastungen', betrag: 590.00, status: 'bezahlt', faellig_am: daysAgo(40) },
  { mandant_name: 'Stefan Richter',            mandant_email: 's.richter@richter-holding.de', beschreibung: 'GmbH Jahresabschluss 2024 – Bilanz, GuV, KSt, GewSt, USt', betrag: 3890.00, status: 'offen', faellig_am: daysAhead(16) },
  { mandant_name: 'Stefan Richter',            mandant_email: 's.richter@richter-holding.de', beschreibung: 'Einspruchsbearbeitung GewSt-Bescheid 2022 – Analyse Hinzurechnungen § 8 GewStG', betrag: 1240.00, status: 'offen', faellig_am: daysAhead(5) },
  { mandant_name: 'Dr. Juliane Fischer',       mandant_email: 'j.fischer@gemeinschaftspraxis-nord.de', beschreibung: 'Einkommensteuererklärung 2024 – Ärztin, EÜR Gewinnanteil, Anlage S, KAP', betrag: 1980.00, status: 'bezahlt', faellig_am: daysAgo(18) },
  { mandant_name: 'Florian Braun',             mandant_email: 'f.braun@creativcode.de',       beschreibung: 'Einkommensteuererklärung 2024 – Erstjahr Regelbesteuerung, EÜR, USt', betrag: 890.00, status: 'offen', faellig_am: daysAhead(30) },
];
const insertRechnung = db.prepare('INSERT INTO rechnungen (mandant_name, mandant_email, beschreibung, betrag, status, faellig_am, kanzlei_id) VALUES (?,?,?,?,?,?,?)');
for (const r of rechnungen) insertRechnung.run(r.mandant_name, r.mandant_email, r.beschreibung, r.betrag, r.status, r.faellig_am, KID);
console.log(`✓ ${rechnungen.length} Rechnungen angelegt`);

// ─── KALENDER ────────────────────────────────────────────────────────────────
const kalender = [
  { titel: 'Beratungsgespräch Thomas Berger – IAB Serverinvestition',   mandant_name: 'Thomas Berger',          datum: daysAhead(5),  uhrzeit: '10:00', uhrzeit_ende: '11:00', typ: 'termin', ort: 'Kanzlei, Besprechungsraum 1',      notiz: 'Angebote liegen vor. IAB-Berechnung vorbereiten.' },
  { titel: 'Telefonat Dr. Hoffmann – Einspruchsstrategie',              mandant_name: 'Dr. Sabine Hoffmann',    datum: daysAhead(3),  uhrzeit: '14:30', uhrzeit_ende: '15:00', typ: 'telefonat', ort: 'Telefon',                       notiz: 'Begründung § 4 Abs. 5 EStG besprechen.' },
  { titel: 'Jahresabschlussbesprechung TechWave Solutions GmbH',        mandant_name: 'TechWave Solutions GmbH',datum: daysAhead(12), uhrzeit: '14:00', uhrzeit_ende: '16:00', typ: 'termin', ort: 'TechWave Büro, Rosenheimer Str. 145', notiz: 'WP Herr Schreiber nimmt teil. Vorabzahlen prüfen.' },
  { titel: 'Jahresabschlussbesprechung Bäckerei Mayer KG',              mandant_name: 'Bäckerei Mayer KG',      datum: daysAhead(8),  uhrzeit: '09:00', uhrzeit_ende: '10:30', typ: 'termin', ort: 'Kanzlei, Besprechungsraum 2',      notiz: 'AfA Backanlage, Investitionsabzugsbetrag klären.' },
  { titel: 'Besprechung Stefan Richter – GewSt Einspruch',              mandant_name: 'Stefan Richter',         datum: daysAhead(6),  uhrzeit: '11:00', uhrzeit_ende: '12:00', typ: 'termin', ort: 'Kanzlei, Besprechungsraum 1',      notiz: 'Bescheid 2022 mitbringen. Einspruchsbegründung § 8 Nr. 1a GewStG.' },
  { titel: 'USt-Voranmeldung Fristablauf (Mayer, TechWave, Berger)',    mandant_name: '',                       datum: daysAhead(35), uhrzeit: '10.04. – Letzter Einreichungstag', uhrzeit_ende: '', typ: 'frist', ort: '', notiz: 'Elektronisch via ELSTER einreichen.' },
  { titel: 'Mandantenfrühstück Q2/2026 – Steuerrecht aktuell',          mandant_name: '',                       datum: daysAhead(30), uhrzeit: '08:30', uhrzeit_ende: '10:30', typ: 'veranstaltung', ort: 'Kanzlei, Großer Besprechungsraum', notiz: 'Thema: Jahressteuergesetz 2024, degressive AfA, Photovoltaik.' },
  { titel: 'Erstgespräch Neumandant Herr Bauer (Empfehlung von Berger)', mandant_name: '',                      datum: daysAhead(9),  uhrzeit: '16:00', uhrzeit_ende: '17:00', typ: 'termin', ort: 'Kanzlei, Besprechungsraum 1',      notiz: 'Selbstständig, IT-Branche. Erstes Treffen zur Auftragsklärung.' },
  { titel: 'Telefonat Familie Schneider – Handwerkerbeleg',             mandant_name: 'Familie Schneider',      datum: daysAhead(2),  uhrzeit: '09:30', uhrzeit_ende: '09:45', typ: 'telefonat', ort: 'Telefon',                       notiz: 'Korrigierte Rechnung Klempner anfordern.' },
  { titel: 'Lohnsteuerberatung Bäckerei Mayer – neuer Mitarbeiter',     mandant_name: 'Bäckerei Mayer KG',      datum: daysAhead(15), uhrzeit: '11:30', uhrzeit_ende: '12:00', typ: 'telefonat', ort: 'Telefon',                       notiz: 'Azubi ab 01.04.2026 – SV-Beurteilung, Lohngruppe.' },
  { titel: 'Einreichung ESt-Erklärung Dr. Fischer',                     mandant_name: 'Dr. Juliane Fischer',    datum: daysAhead(58), uhrzeit: '', uhrzeit_ende: '', typ: 'frist', ort: 'ELSTER online',                       notiz: '' },
  { titel: 'Interne Teambesprechung – Auslastung Q2/2026',              mandant_name: '',                       datum: daysAhead(1),  uhrzeit: '13:00', uhrzeit_ende: '14:00', typ: 'intern', ort: 'Kanzlei, Küche',                  notiz: 'Kapazitätsplanung April–Juni 2026. Priorisierung Jahresabschlüsse.' },
];
const insertKalender = db.prepare('INSERT INTO kalender_termine (titel, mandant_name, datum, uhrzeit, uhrzeit_ende, typ, notiz, ort, kanzlei_id) VALUES (?,?,?,?,?,?,?,?,?)');
for (const k of kalender) insertKalender.run(k.titel, k.mandant_name, k.datum, k.uhrzeit, k.uhrzeit_ende||'', k.typ, k.notiz, k.ort, KID);
console.log(`✓ ${kalender.length} Kalendertermine angelegt`);

// ─── POSTEINGANG ─────────────────────────────────────────────────────────────
const posteingang = [
  {
    von: 't.berger@berger-itconsulting.de', von_name: 'Thomas Berger',
    betreff: 'AW: IAB Serverinvestition – Angebot liegt vor',
    inhalt: `Sehr geehrte Damen und Herren,\n\nwie besprochen sende ich Ihnen das Angebot von Hetzner für die neue Server-Infrastruktur anbei (Gesamtkosten: 18.200 € netto).\n\nKönnen Sie bitte prüfen, ob ich den Investitionsabzugsbetrag nach § 7g EStG für die Anschaffung im Q3 2026 bereits in der Steuererklärung 2025 geltend machen kann?\n\nMit freundlichen Grüßen\nThomas Berger`,
    mandant_name: 'Thomas Berger', status: 'ungelesen',
    datum: dtAgo(1)
  },
  {
    von: 's.hoffmann@praxis-hoffmann.de', von_name: 'Dr. Sabine Hoffmann',
    betreff: 'Einspruch ESt 2022 – ergänzende Unterlagen',
    inhalt: `Guten Tag,\n\nich habe die von Ihnen angeforderten Belege zur Praxiskosten-Aufteilung zusammengestellt und im Portal hochgeladen.\n\nMein Hauptargument: Der Behandlungsraum (22 m²) wird ausschließlich beruflich genutzt, da er in den Praxisräumlichkeiten liegt und keinerlei private Nutzung stattfindet.\n\nBitte teilen Sie mir mit, ob die Belege ausreichend sind.\n\nFreundliche Grüße\nDr. Sabine Hoffmann`,
    mandant_name: 'Dr. Sabine Hoffmann', status: 'bearbeitet',
    ki_antwort: `Sehr geehrte Frau Dr. Hoffmann,\n\nvielen Dank für die übermittelten Unterlagen. Die Belege zur Praxiskostenaufteilung sind vollständig und überzeugend.\n\nWir werden den Einspruch mit folgenden Argumenten weiterführen: Der Behandlungsraum ist aufgrund seiner baulichen und funktionalen Zweckbestimmung ausschließlich der freiberuflichen Tätigkeit zuzuordnen (§ 4 Abs. 5 S. 1 Nr. 6b EStG ist nicht anwendbar). Die Abzugsfähigkeit ergibt sich unmittelbar aus § 4 Abs. 4 EStG.\n\nWir melden uns zeitnah mit dem Schreiben ans Finanzamt.\n\nMit freundlichen Grüßen\nMüller & Partner Steuerberatungsgesellschaft mbH`,
    datum: dtAgo(3)
  },
  {
    von: 'm.weber@techwave.de', von_name: 'Max Weber',
    betreff: 'Termin Jahresabschluss – Verfügbarkeit bestätigen',
    inhalt: `Hallo,\n\nder vorgeschlagene Termin am ${daysAhead(12)} um 14:00 Uhr passt uns sehr gut. Herr Schreiber (Wirtschaftsprüfer) ist ebenfalls für diesen Termin verfügbar.\n\nSollen wir die vorläufige Bilanz vorab als PDF zusenden, oder überarbeiten Sie diese direkt auf Basis unserer DATEV-Daten?\n\nViele Grüße\nMax Weber\nTechWave Solutions GmbH`,
    mandant_name: 'TechWave Solutions GmbH', status: 'ungelesen',
    datum: dtAgo(0)
  },
  {
    von: 'j.mayer@baeckerei-mayer.de', von_name: 'Josef Mayer',
    betreff: 'Neue Backanlage – Finanzierungsvertrag',
    inhalt: `Guten Morgen,\n\ndie neue Backanlage (Wachtel Backmaster Pro 680, 68.000 € netto) wurde am 15.02.2026 geliefert und in Betrieb genommen. Den Finanzierungsvertrag mit der DZ Bank (5 Jahre, 3,8 % p.a.) schicke ich separat per Post.\n\nDie Rechnung habe ich bereits im Mandantenportal hochgeladen.\n\nMit freundlichen Grüßen\nJosef Mayer`,
    mandant_name: 'Bäckerei Mayer KG', status: 'bearbeitet',
    ki_antwort: `Sehr geehrter Herr Mayer,\n\nvielen Dank für die Information. Die Inbetriebnahme der Backanlage am 15.02.2026 ist für die steuerliche Beurteilung entscheidend.\n\nFür die Steuererklärung 2026 gilt: Die degressive Abschreibung nach § 7 Abs. 2 EStG beträgt 25 %, also 17.000 € im ersten Jahr. Die Zinsen aus dem DZ Bank Finanzierungsvertrag sind als Betriebsausgabe abzugsfähig (ca. 2.584 € im Jahr 1). Bitte senden Sie den Finanzierungsvertrag baldmöglichst zu.\n\nMit freundlichen Grüßen\nMüller & Partner Steuerberatungsgesellschaft mbH`,
    datum: dtAgo(7)
  },
  {
    von: 'a.koch@gmx.de', von_name: 'Andreas Koch',
    betreff: 'Frage zur Renovierung Schwabing – Steuerliche Einordnung',
    inhalt: `Sehr geehrte Damen und Herren,\n\nmeine Wohnung in München-Schwabing (Kauf: Januar 2022, Kaufpreis: 480.000 €) wurde 2024 komplett renoviert. Kosten: 32.000 € für Dach, Fenster und Elektrik.\n\nIch habe gehört, dass Renovierungskosten in den ersten 3 Jahren nach Kauf als Herstellungskosten gewertet werden könnten. Da wir 2024 noch im 3-Jahres-Zeitraum waren – gilt das auch für mich?\n\nMit freundlichen Grüßen\nAndreas Koch`,
    mandant_name: 'Andreas Koch', status: 'ungelesen',
    datum: dtAgo(2)
  },
  {
    von: 'p.schulz@outlook.de', von_name: 'Petra Schulz',
    betreff: 'Riester-Bescheinigung – anbei',
    inhalt: `Guten Tag,\n\ndie Riester-Jahresbescheinigung der DWS habe ich soeben im Portal hochgeladen. Entschuldigung für die Verzögerung – das Dokument wurde mir erst letzte Woche nachgesandt.\n\nKann ich für 2024 noch Kinderzulage beantragen? Meine Schwester hat mir gesagt, dass auch Nichten und Neffen berücksichtigt werden können. Stimmt das?\n\nViele Grüße\nPetra Schulz`,
    mandant_name: 'Petra Schulz', status: 'ungelesen',
    datum: dtAgo(0)
  },
  {
    von: 's.richter@richter-holding.de', von_name: 'Stefan Richter',
    betreff: 'GewSt-Bescheid 2022 – Kopie anbei',
    inhalt: `Sehr geehrte Damen und Herren,\n\nwie vereinbart übersende ich den Gewerbesteuerbescheid 2022 im Anhang. Das Finanzamt hat Dauerschuldzinsen von 240.000 € zu 25 % hinzugerechnet (60.000 €), was zu einer Gewerbesteuer von 38.400 € führt.\n\nMeines Erachtens handelt es sich dabei um Finanzierungskosten für den Erwerb des Grundstücks in Pasing, die nicht der Hinzurechnung unterliegen sollten.\n\nBitte prüfen Sie dies schnellstmöglich – die Einspruchsfrist läuft in 7 Tagen ab.\n\nMit freundlichen Grüßen\nStefan Richter`,
    mandant_name: 'Stefan Richter', status: 'bearbeitet',
    ki_antwort: `Sehr geehrter Herr Richter,\n\ndie Situation ist steuerlich relevant und wir werden den Einspruch fristgerecht einlegen.\n\nZur Rechtslage: Nach § 8 Nr. 1a GewStG werden Entgelte für Schulden dem Gewerbeertrag zu 25 % hinzugerechnet. Eine Ausnahme besteht jedoch bei Schulden, die der Finanzierung eines zum Betriebsvermögen gehörenden Wirtschaftsguts dienen, das der Erzielung von Mieterträgen gewidmet ist. Da das Grundstück in Pasing für Gewerbeimmobilien genutzt wird, könnte diese Ausnahme greifen.\n\nWir werden den Einspruch heute noch einlegen und die Begründung bis zum vorgesehenen Termin ausarbeiten.\n\nMit freundlichen Grüßen\nMüller & Partner Steuerberatungsgesellschaft mbH`,
    datum: dtAgo(4), gesendet: 1
  },
];
const insertPost = db.prepare('INSERT INTO posteingang (von, von_name, betreff, inhalt, mandant_name, status, ki_antwort, datum, gesendet, kanzlei_id) VALUES (?,?,?,?,?,?,?,?,?,?)');
for (const p of posteingang) insertPost.run(p.von, p.von_name, p.betreff, p.inhalt, p.mandant_name, p.status, p.ki_antwort||null, p.datum, p.gesendet||0, KID);
console.log(`✓ ${posteingang.length} Posteingang-Einträge angelegt`);

// ─── BESCHEIDE ───────────────────────────────────────────────────────────────
const bescheide = [
  {
    mandant_name: 'Thomas Berger', mandant_email: 't.berger@berger-itconsulting.de',
    jahr: 2022, art: 'Einkommensteuerbescheid', betrag: 28450.00, datum: daysAgo(180),
    finanzamt: 'Finanzamt München 1', absender_typ: 'finanzamt', status: 'analysiert',
    vorlaeufigkeit: '§164 AO',
    ki_analyse: `Bescheid-Übersicht: Einkommensteuer 2022 über 28.450 € unter Vorbehalt der Nachprüfung (§ 164 AO). Steuerpflichtiger Gewinn laut Bescheid: 87.200 €.\n\nFestgestellte Abweichungen: Das Finanzamt hat Betriebsausgaben für Homeoffice (2.520 €) nicht anerkannt, da kein separater Raum angegeben. Außerdem wurde der IAB aus 2021 nicht vollständig aufgelöst.\n\nEinspruchspotenzial: Mittel. Bei Nachweis der ausschließlichen beruflichen Nutzung des Homeoffice-Bereichs könnten 2.520 € zusätzlich absetzbar sein (Steuerersparnis ca. 1.100 €). Die § 164 AO-Vorläufigkeit ermöglicht jederzeit einen Änderungsantrag.\n\nEmpfehlung: Nachweis der Homeoffice-Nutzung für 2022 zusammenstellen. Ggf. Änderungsantrag stellen.`
  },
  {
    mandant_name: 'Dr. Sabine Hoffmann', mandant_email: 's.hoffmann@praxis-hoffmann.de',
    jahr: 2022, art: 'Einkommensteuerbescheid', betrag: 89340.00, datum: daysAgo(390),
    finanzamt: 'Finanzamt München-Schwabing', absender_typ: 'finanzamt', status: 'einspruch',
    vorlaeufigkeit: null,
    einspruch_ja: 1, einspruch_datum: daysAgo(360),
    einspruch_begruendung: 'Praxiskosten-Aufteilung fehlerhaft. Behandlungsraum ausschließlich beruflich genutzt (§ 4 Abs. 4 EStG). FA hat 8.400 € Praxisausgaben als privat eingestuft.',
    ki_analyse: `Bescheid-Übersicht: Einkommensteuer 2022 über 89.340 € (Gewinn Praxis: 198.000 €). Zu versteuerndes Einkommen laut FA: 161.200 €.\n\nKritischer Punkt: Das Finanzamt hat Praxisausgaben von 8.400 € (Behandlungsraum-Kosten) als nicht abzugsfähig eingestuft. Begründung FA: "gemischte Nutzung nicht ausreichend nachgewiesen".\n\nEinspruchspotenzial: Hoch. Behandlungsräume in Praxisgebäuden sind per Definition ausschließlich beruflich genutzt. § 4 Abs. 5 S. 1 Nr. 6b EStG (häusliches Arbeitszimmer) ist nicht anwendbar. Steuerersparnis bei Erfolg: ca. 3.780 € (42 % Grenzsteuersatz).\n\nEinspruch wurde bereits eingelegt. Begründung ist zwingend zu ergänzen.`
  },
  {
    mandant_name: 'Bäckerei Mayer KG', mandant_email: 'j.mayer@baeckerei-mayer.de',
    jahr: 2023, art: 'Gewerbesteuerbescheid', betrag: 12840.00, datum: daysAgo(120),
    finanzamt: 'Landeshauptstadt München – Stadtkämmerei', absender_typ: 'gemeinde', status: 'analysiert',
    vorlaeufigkeit: '§164 AO',
    ki_analyse: `Bescheid-Übersicht: Gewerbesteuer 2023 über 12.840 € (Hebesatz München: 490 %). Gewerbeertrag laut Bescheid: 52.200 €.\n\nBewertung: Bescheid erscheint korrekt. Freibetrag 24.500 € (§ 11 GewStG) wurde berücksichtigt. Steuermesszahl 3,5 % korrekt angewendet.\n\nHinweis für ESt-Anrechnung: Die Gewerbesteuer-Anrechnung auf die ESt der Gesellschafter nach § 35 EStG (Faktor 4,0 × Messbetrag = 4,0 × 1.827 € = 7.308 €) bitte in der ESt-Erklärung geltend machen.\n\nEmpfehlung: Kein Handlungsbedarf. Bescheid als erledigt markieren.`
  },
  {
    mandant_name: 'Stefan Richter', mandant_email: 's.richter@richter-holding.de',
    jahr: 2022, art: 'Gewerbesteuerbescheid', betrag: 38400.00, datum: daysAgo(840),
    finanzamt: 'Landeshauptstadt München – Stadtkämmerei', absender_typ: 'gemeinde', status: 'einspruch',
    vorlaeufigkeit: null,
    einspruch_ja: 1, einspruch_datum: daysAgo(820),
    einspruch_begruendung: 'Hinzurechnung Dauerschuldzinsen § 8 Nr. 1a GewStG – Zinsen stammen aus Grundstückserwerb für Vermietungszwecke. Ausnahme von der Hinzurechnung beantragt.',
    ki_analyse: `Bescheid-Übersicht: GewSt 2022 über 38.400 € (Hebesatz 490 %). Hinzurechnung Dauerschuldzinsen: 240.000 € × 25 % = 60.000 €. Daraus resultierendes Mehr an Gewerbesteuer: ca. 11.760 €.\n\nProblem: FA rechnet Finanzierungszinsen für Grundstückserwerb Pasing hinzu. Das Grundstück dient ausschließlich Vermietungszwecken.\n\nEinspruchspotenzial: Hoch. Nach BFH-Urteil vom 04.06.2014 (I R 21/13) sind Schulden, die der Finanzierung eines dem Betrieb dienenden Grundstücks dienen, dessen Ertrag der Gewerbesteuer unterliegt, von der Hinzurechnung ausgenommen. Steuerersparnis bei Erfolg: 11.760 €.\n\nDringend: Einspruchsbegründung mit BFH-Urteil I R 21/13 bis zum Ablauf der Frist in 7 Tagen einreichen.`
  },
  {
    mandant_name: 'TechWave Solutions GmbH', mandant_email: 'm.weber@techwave.de',
    jahr: 2023, art: 'Körperschaftsteuerbescheid', betrag: 44880.00, datum: daysAgo(95),
    finanzamt: 'Finanzamt München für Körperschaften', absender_typ: 'finanzamt', status: 'analysiert',
    vorlaeufigkeit: '§164 AO',
    ki_analyse: `Bescheid-Übersicht: Körperschaftsteuer 2023 über 44.880 € (KSt-Satz 15 % + SolZ 5,5 %). Zu versteuerndes Einkommen: 282.000 €. Solidaritätszuschlag: 2.468 €.\n\nBewertung: Bescheid ist unter Vorbehalt der Nachprüfung (§ 164 AO). KSt-Vorauszahlungen für 2024/2025 wurden entsprechend angepasst.\n\nOptimierungspotenzial: IAB für geplante Serverinfrastruktur (85.000 €) in der KSt-Erklärung 2025 einplanen → 50 % sofort abzugsfähig = 42.500 € Gewinnminderung → KSt-Ersparnis ca. 6.375 €.\n\nEmpfehlung: Investitionsplanung für 2025 dokumentieren und IAB nach § 7g Abs. 1 KStG i.V.m. § 7g EStG geltend machen.`
  },
  {
    mandant_name: 'Maria Winkler', mandant_email: 'm.winkler@t-online.de',
    jahr: 2023, art: 'Einkommensteuerbescheid', betrag: 2140.00, datum: daysAgo(60),
    finanzamt: 'Finanzamt München 3', absender_typ: 'finanzamt', status: 'analysiert',
    vorlaeufigkeit: null,
    ki_analyse: `Bescheid-Übersicht: Einkommensteuer 2023 über 2.140 €. Einkünfte: Rente 22.400 €, Kapitalerträge 1.800 €, Haushaltsnahe Dienstleistungen und Handwerkerleistungen wurden berücksichtigt.\n\nBewertung: Bescheid erscheint korrekt. Haushaltsnahe Dienstleistungen § 35a Abs. 2 EStG: 3.200 € × 20 % = 640 € Steuerermäßigung. Handwerker § 35a Abs. 3 EStG: 2.800 € Lohnanteil × 20 % = 560 € Ermäßigung. Beide Positionen wurden korrekt berücksichtigt.\n\nFür 2024: Zahnarztkosten 4.200 € – Zumutbarkeit 2 % von ca. 22.000 € = 440 €. Abzugsfähig: 3.760 €. Steuerersparnis ca. 585 €.\n\nKein Handlungsbedarf für 2023-Bescheid.`
  },
];
const insertBescheid = db.prepare(`INSERT INTO bescheide
  (mandant_name, mandant_email, jahr, art, betrag, datum, finanzamt, absender_typ, status, vorlaeufigkeit, einspruch_ja, einspruch_datum, einspruch_begruendung, ki_analyse, kanzlei_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const b of bescheide) {
  insertBescheid.run(
    b.mandant_name, b.mandant_email, b.jahr, b.art, b.betrag, b.datum,
    b.finanzamt, b.absender_typ, b.status, b.vorlaeufigkeit||null,
    b.einspruch_ja||0, b.einspruch_datum||null, b.einspruch_begruendung||null,
    b.ki_analyse||null, KID
  );
}
console.log(`✓ ${bescheide.length} Bescheide angelegt`);

// ─── ZEITERFASSUNG ───────────────────────────────────────────────────────────
const zeiten = [
  { mandant_name: 'Thomas Berger',            beschreibung: 'EÜR 2024 erstellen und prüfen',                                   minuten: 120, datum: daysAgo(5) },
  { mandant_name: 'Thomas Berger',            beschreibung: 'USt-Erklärung 2024 vorbereiten',                                   minuten: 90,  datum: daysAgo(4) },
  { mandant_name: 'Familie Schneider',         beschreibung: 'Beleg-Prüfung Mieteinnahmen und Handwerkerrechnungen 2024',         minuten: 75,  datum: daysAgo(6) },
  { mandant_name: 'Familie Schneider',         beschreibung: 'ESt-Erklärung 2024 erstellen (Anlage S, V, Kind, Sonderausgaben)', minuten: 180, datum: daysAgo(3) },
  { mandant_name: 'Dr. Sabine Hoffmann',       beschreibung: 'Einspruchsbegründung 2022 ausarbeiten und Schriftverkehr FA',      minuten: 150, datum: daysAgo(2) },
  { mandant_name: 'Dr. Sabine Hoffmann',       beschreibung: 'Prüfung EÜR Praxis 2024, Gewinnermittlung',                        minuten: 135, datum: daysAgo(7) },
  { mandant_name: 'TechWave Solutions GmbH',   beschreibung: 'Vorläufiger Jahresabschluss 2024 prüfen',                         minuten: 240, datum: daysAgo(10) },
  { mandant_name: 'TechWave Solutions GmbH',   beschreibung: 'KSt-Erklärung 2024 vorbereiten',                                  minuten: 120, datum: daysAgo(8) },
  { mandant_name: 'TechWave Solutions GmbH',   beschreibung: 'Lohnabrechnung Februar 2026 (8 Mitarbeiter)',                      minuten: 90,  datum: daysAgo(15) },
  { mandant_name: 'Bäckerei Mayer KG',         beschreibung: 'DATEV-Daten importieren und prüfen',                               minuten: 60,  datum: daysAgo(12) },
  { mandant_name: 'Bäckerei Mayer KG',         beschreibung: 'Jahresabschluss 2024 erstellen (Bilanz, GuV, Anhang)',             minuten: 300, datum: daysAgo(9) },
  { mandant_name: 'Bäckerei Mayer KG',         beschreibung: 'AfA-Plan Backanlage erstellen (degressive AfA 25 %)',              minuten: 45,  datum: daysAgo(4) },
  { mandant_name: 'Bäckerei Mayer KG',         beschreibung: 'Lohnabrechnung Februar 2026 (12 Mitarbeiter)',                     minuten: 110, datum: daysAgo(14) },
  { mandant_name: 'Andreas Koch',              beschreibung: 'Prüfung Renovierungskosten – anschaffungsnahe Herstellungskosten', minuten: 60,  datum: daysAgo(1) },
  { mandant_name: 'Andreas Koch',              beschreibung: 'ESt-Erklärung 2024 – Anlage V, 4 Objekte bearbeiten',              minuten: 195, datum: daysAgo(5) },
  { mandant_name: 'Petra Schulz',              beschreibung: 'ESt-Erklärung 2024 – Anlage N, Werbungskosten',                   minuten: 75,  datum: daysAgo(2) },
  { mandant_name: 'Klaus Zimmermann',          beschreibung: 'ESt-Erklärung 2024 – Anlage S, G, V, Verlustabzug',               minuten: 165, datum: daysAgo(8) },
  { mandant_name: 'Klaus Zimmermann',          beschreibung: 'USt-Erklärung 2024 prüfen und einreichen',                        minuten: 60,  datum: daysAgo(6) },
  { mandant_name: 'Stefan Richter',            beschreibung: 'GewSt-Bescheid Analyse und Einspruchsstrategie',                  minuten: 120, datum: daysAgo(3) },
  { mandant_name: 'Stefan Richter',            beschreibung: 'GmbH Jahresabschluss 2024 – erste Durchsicht',                    minuten: 150, datum: daysAgo(11) },
  { mandant_name: 'Maria Winkler',             beschreibung: 'ESt-Erklärung 2024 – Anlage R, KAP, außergewöhnl. Belastungen',  minuten: 90,  datum: daysAgo(4) },
  { mandant_name: 'Dr. Juliane Fischer',       beschreibung: 'EÜR Gewinnanteil Gemeinschaftspraxis 2024 prüfen',                minuten: 105, datum: daysAgo(6) },
  { mandant_name: 'Dr. Juliane Fischer',       beschreibung: 'ESt-Erklärung 2024 erstellen (Anlage S, KAP, Sonderausgaben)',    minuten: 150, datum: daysAgo(3) },
  { mandant_name: 'Florian Braun',             beschreibung: 'Erstberatung Regelbesteuerung – Wechsel Kleinunternehmer',        minuten: 60,  datum: daysAgo(15) },
];
const insertZeit = db.prepare('INSERT INTO zeiterfassung (mandant_name, beschreibung, minuten, datum, kanzlei_id) VALUES (?,?,?,?,?)');
for (const z of zeiten) insertZeit.run(z.mandant_name, z.beschreibung, z.minuten, z.datum, KID);
console.log(`✓ ${zeiten.length} Zeiterfassungs-Einträge angelegt`);

// ─── FERTIG ──────────────────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║  DEMO ERFOLGREICH ERSTELLT                               ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log(`║  Kanzlei:   ${KANZLEI_NAME.padEnd(44)} ║`);
console.log(`║  Login:     ${KANZLEI_EMAIL.padEnd(44)} ║`);
console.log(`║  Passwort:  ${KANZLEI_PWD.padEnd(44)} ║`);
console.log(`║  Kanzlei-ID: ${String(KID).padEnd(43)} ║`);
console.log('╚══════════════════════════════════════════════════════════╝\n');

db.close();
