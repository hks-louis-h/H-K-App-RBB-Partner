require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');
const { Resend } = require('resend');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const app = express();
// DATA_DIR: im Electron-Betrieb via HK_DATA_DIR gesetzt → userData; sonst __dirname
const DATA_DIR = process.env.HK_DATA_DIR || __dirname;
const db = new Database(path.join(DATA_DIR, 'hk.db'));
// WAL-Modus: erlaubt gleichzeitige Lesezugriffe und verhindert "database is locked" für andere Prozesse
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || 'H&K Automation <onboarding@resend.dev>';

// Fachwissen Umwandlungsrecht (UmwG + UmwStG + UmwStE) für das Gutachten-Modul.
// Wird einmal beim Start geladen und beim Typ "umwandlung" an den System-Prompt gehängt.
let UMWANDLUNG_KONTEXT = '';
try {
  UMWANDLUNG_KONTEXT = fs.readFileSync(path.join(__dirname, 'gesetz-kontext.md'), 'utf8');
  console.log('Umwandlungsrecht-Kontext geladen:', UMWANDLUNG_KONTEXT.length, 'Zeichen');
} catch (e) {
  console.error('gesetz-kontext.md nicht geladen:', e.message);
}

const LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARoABQAAAAEAAAA+ARsABQAAAAEAAABGASgAAwAAAAEAAgAAh2kABAAAAAEAAABOAAAAAAAAAJAAAAABAAAAkAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAgKADAAQAAAABAAAAgAAAAACaA7zWAAAACXBIWXMAABYlAAAWJQFJUiTwAAACnmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iPgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj4xNDQ8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjE0NDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjEwMjQ8L2V4aWY6UGl4ZWxZRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpQaXhlbFhEaW1lbnNpb24+MTAyNDwvZXhpZjpQaXhlbFhEaW1lbnNpb24+CiAgICAgICAgIDxleGlmOkNvbG9yU3BhY2U+MTwvZXhpZjpDb2xvclNwYWNlPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KOImb9AAAMB9JREFUeAHtfQm4HVWV7jrn3CkTGSCEQJjCEEQZZA5KEAJPwLb9xNluH75uGR0/6e/ZNjymFmz7Oc9MygwCosIDlBgHEFAEZdAAYSbMUwKZc+89561/79q71tpDnTpJFLs/Krm31vD/a6/aU+2qU6dug9bT1ul0ZnCo7YaHR2fyfj/+OWJkdJRGRzvEvqCUUNdu7/WC9mutBJUSI5SiGaFmoYIgxBAb6hE0OtaQYfWIB7MydqjRaFBfX4sG+vtQh+cTNW4aGup/mJEPsO8JG2ndfjfWls7HydzOXsx/2/DwyNx2p7MjUXNSf3+LRrjRV69anQitjjDye68XIkhh0ACveSHH07nuiBoZHSyKbWpf4YWuv2WgSdwAaHBjgDrFmlPc3tVqNs5n4Q+4IqZGnYkqlpw7QGR4+hOekkzjV2Ty706rVXJaoAHMIyeNIGn0e3usF7woEDfCaFwJ4Rv1rNz7SSKYYGSNDmhcEHOLZYXCgj5umcSu7TuNO8FNA6my1OgCffyZxsNNHR9vHdKjZXLVqVRTbpB7nz7ik0fO91wveFQgaoDSlBLRAXW+Nj+OqUW4W4h1eUJmmrQzJOHBcY8aMoYG+Rru/v+9MRv4bd4QlKmhC6doBuPF3Yt55/LPb8hWrEwu6IqdkYkmjT8N7veBdgaABXvNCAM+o663xxayXKcqbkylGxsiQa+dsB4ADUbjRafLECTxM6Q+sfpj1e3wyCaGyA3Djz2HO5Xxqn7Z85Sqs+tTm0/aCdCeNHuC9XvCuQNAApSkloAXqemt8VHONcrMQ7/CCyjRtZUilo8HuEoD+OWH8WBoc7HuW2+y93AluVIUIJWxT7yoa/6rhkfaGq1at4Z7lXV7ID4QyGQ8Wgvd6QTiVqAFe84ICZxULFyQhZkmFQ0HzBxyFUTznVUalOIRoRm+yQhrOPusI3Uh1zJhBGjdm8EVuu8NznSDRrByy03k9//7F8Ehn41WrufFzuYSl5tM3ERRcKUEBMVpH7sot48mRoYOUmJQUF8GW2BhRsxDv8ILipq0MqXToka8Cgsq9YMyYIRo3dvA5bsMDuRP8OcQ0QwOTJvHPRaPtRrLxPT6bmEfkha5cDVCaUvJFwNMDtDoQIq1LsHXhVmZWHbjBQ3flilW0evXIxmhTtG0YLuoA7Xb7DO4pu67o6ZyPRPLJKG8eVuSmAUpTSngoWrcjvyBgV5MbQ9lSgxvzwsNJI9LWIt9kudaY5blqKLjclrR06XI+hMauaFvndns1u3MPOZhnjetXrFzdYtlh/D5hKnwx1pNY8F4vSK+UNUBpSpGcWLZQQRBijNaWCJo/aEWMePAqo1IMN7aIkFmndWTdUblFTFwdTBo/2mo2DuVOMc+V5GcAbvBBvm9/+mi7EzV+vjB4anrzsCIXDVCaUlzq6f36HfndCwYiifLGNMK7w8NIw30pWbeLkwnc6bRp1arh1sjI6Oloawf3HYAN7+TbiXuuXJm4k8hBaw4EF1fvM0mVIA1QmlJKRkrqAZqia1uNYFlI1mGL6OLWeSitC7PS3aAVK1by1VxrTw75ThfWdADuES3+5O64kRF8AuVcVXuUlC9NefOwogANUJpSqvJBNgAXBCFWsyxDF8Najd6uOaIU74DgFQ+ILYUrDfcxsm4XORO45LHEbbuSL+n5M5zj0KCgmhlgN851X1zyyQ31UKMuJEXLmaRKkAYoTSklIyX1AE3Rta1GsCwk69BF9K51CdzFLctbybfx+dPafYmGd4fddABeHf49f+7cctfM+Xjw1PTmYUU+GqA0pRTwzO6/0shPHhaMWYd1VbgzXMkLCuAR3Wy2eC3QeDuqtMlTQZM/5JnLd/zKGz7MeW3kxz0u2RCAZR1xjPoWnIsrAndxZ8thHmZ6bu+5aPs+Bk7nlf+Oo6MjpjjEjbeKRBisvEqJIwXoHrllPDdbGUvXMiWvlK3E5Br8LMQ7vKAKSFsZUumouMMHXkXjl2FLKUxoeBh3d/t2HDM0MB2ngO34AYOJuExAUq+NfFVdRslUZUUjxjHqWypaF0G6uCvLKQ6k04bQmMi/tmvyM3xb9g+08h2yi8dXjhdyKWiA0pSS41u7OufDVJMLmIayVqO3a47Nwfz2Dghe8YC0tYDGcB8Dx5d0u8gZZ1leKTmK2Qe8vr5+3BfYso9H/lzzmFkAsOSkUcVNBe8GUFGVEjOlJYJGBonuIr9a3GxaNYb22uac4OHZwlYfzW3wQqCzdNlKTgsJuC3BcC7eK69SBMiLGqA0pRTwzO6/0shPHhaMWYd1VbgzXMkLCuAR3Wy2eC3QeDuqtMlTQZM/5JnLd/zKGz7MeW3kxz0u2RCAZR1xjPoWnIsrAndxZ8thHmZ6bu+5aPs+Bk7nlf+Oo6MjpjjEjbeKRBisvEqJIwXoHrllPDdbGUvXMiWvlK3E5Br8LMQ7vKAKSFsZUumouMMHXkXjl2FLKUxoeBh3d/t2HDM0MB2ngO34AYOJuExAUq+NfFVdRslUZUUjxjHqWypaF0G6uCvLKQ6k04bQmMi/tmvyM3xb9g+08h2yi8dXjhdyKWiA0pSS41u7OufDVJMLmIayVqO3a47Nwfz2Dghe8YC0tYDGcB8Dx5d0u8gZZ1leKTmK2Qe8vr5+3BfYso9H/lzzmFkAsOSkUcVNBe8GUFGVEjOlJYJGBonuIr9a3GxaNYb22uac4OHZwlYfzW3wQqCzdNlKTgsJuC3BcC7eK69SBMiLGqA0pRTwzO6/0shPHhaMWYd1VbgzXMkLCuAR3Wy2eC3QeDuqtMlTQZM/5JnLd/zKGz7MeW3kxz0u2RCAZR1xjPoWnIsrAndxZ8thHmZ6bu+5aPs+Bk7nlf+Oo6MjpjjEjbeKRBisvEqJIwXoHrllPDdbGUvXMiWvlK3E5Br8LMQ7vKAKSFsZUumouMMHXkXjl2FLKUxoeBh3d/t2HDM0MB2ngO34AYOJuExAUq+NfFVdRslUZUUjxjHqWypaF0G6uCvLKQ6k04bQmMi/tmvyM3xb9g+08h2yi8dXjhdyKWiA0pSS41u7OufDVJMLmIayVqO3a47Nwfz2Dghe8YC0tYDGcB8Dx5d0u8gZZ1leKTmK2Qe8vr5+3BfYso9H/lzzmFkAsOSkUcVNBe8GUFGVEjOlJYJGBonuIr9a3GxaNYb22uac4OHZwlYfzW3wQqCzdNlKTgsJuC3BcC7eK69SBMiLGqA0pRTwzO6/0shPHhaMWYd1VbgzXMkLCuAR3Wy2eC3QeDuqtMlTQZM/5JnLd/zKGz7MeW3kxz0u2RCAZR1xjPoWnIsrAndxZ8thHmZ6bu+5aPs+Bk7nlf+Oo6MjpjjEjbeKRBisvEqJIwXoHrllPDdbGUvXMiWvlK3E5Br8LMQ7vKAKSFsZUumouMMHXkXjl2FLKUxoeBh3d/t2HDM0MB2ngO34AYOJuExAUq+NfFVdRslUZUUjxjHqWypaF0G6uCvLKQ6k04bQmMi/tmvyM3xb9g+08h2yi8dXjhdyKWiA0pSS41u7OufDVJMLmIayVqO3a47Nwfz2Dghe8YC0tYDGcB8Dx5d0u8gZZ1leKTmK2Qe8vr5+3BfYso9H/lzzmFkAsOSkUcVNBe8GUFGVEjOlJYJGBonuIr9a3GxaNYb22uac4OHZwlYfzW3wQqCzdNlKTgsJuC3BcC7eK69SBMiLGqA0pRTwzO6/0shPHhaMWYd1VbgzXMkLCuAR3Wy2eC3QeDuqtMlTQZM/5JnLd/zKGz7MeW3kxz0u2RCAZR1xjPoWnIsrAndxZ8thHmZ6bu+5aPs+Bk7nlf+Oo6MjpjjEjbeKRBisvEqJIwXoHrllPDdbGUvXMiWvlK3E5Br8LMQ7vKAKSFsZUumouMMHXkXjl2FLKUxoeBh3d/t2HDM0MB2ngO34AYOJuExAUq+NfFVdRslUZUUjxjHqWypaF0G6uCvLKQ6k04bQmMi/tmvyM3xb9g+08h2yi8dXjhdyKWiA0pSaNGj6tPHqOp9AgSICK/Mdjq8WJfRIoM6TilVRCE6PwJk3OZCkIjmEVaxbQPv7yH4AMUAsqIyuF44Hzqk5+k3/zmZrOixojED64EPsujcqstt6Jf/upXZjZwMbE22GWXnenww99Ja3hWiOI6YMUeMwkWkv/xhS/wiv5scx9EwrG6x7rjHJ72N9tsM1OO81eXV3gToITJhQz2JRLzXXlbDbDSF5BiNRoXPXARDSPxG9/8Jl1+xRVmMWbKRkaJOGg0LMqqOoHNUJPR0HvvvRcvvj5O//mf/9ffRkaHWrToCb7x85i6DkfjT+Pz8Je+9EWaMnkKrwsSL8yyBVX+Rp5f+9o3uIHPMfHdqQUkLDwnT5lM3/r2t/g+xOaZP6wRhhfHJcQQVakHPKfaTwMzFV8ZUDpdNGnrIqNR77nnT3wb9u4uSOsG3t2xq0UACKtcnobf855308=';

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const STEUER_ART_LABELS = {
  einkommensteuer: 'Einkommensteuer',
  koerperschaftsteuer: 'Körperschaftsteuer',
  gewerbesteuer: 'Gewerbesteuer',
  umsatzsteuer_jahres: 'Umsatzsteuer',
  umsatzsteuer_voranmeldung: 'Umsatzsteuer-Voranmeldung',
  erbschaftsteuer: 'Erbschaftsteuer',
  schenkungsteuer: 'Schenkungsteuer',
};
function buildSteuerTypLabel(typ, steuerArt, istAenderung) {
  const art = STEUER_ART_LABELS[steuerArt];
  if (!art) return null;
  if (typ === 'steuerbescheid') return istAenderung ? `${art}-Änderungsbescheid` : `${art}bescheid`;
  if (typ === 'steuererklaerung') return `${art}erklärung`;
  return null;
}

function getStaffForEmail(staffId) {
  if (!staffId) return null;
  try { return db.prepare('SELECT id,name,email,position,phone,signature_email FROM kanzlei_staff WHERE id=?').get(staffId) || null; } catch(e) { return null; }
}

function buildEmailHtml({ body, staff = null }) {
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Automation Steuerberatungsgesellschaft mbH';
  const logoBlock = `<div style="background:rgba(255,255,255,.18);width:48px;height:48px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;text-align:center"><span style="font-family:Arial,sans-serif;font-size:13px;font-weight:800;color:#fff;line-height:1.1">H&amp;K</span></div>`;
  const header = `<div style="background:#6d7aff;padding:18px 32px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:16px">
    ${logoBlock}
    <div>
      <div style="color:#fff;font-family:Arial,sans-serif;font-size:1rem;font-weight:700;letter-spacing:.3px">${escHtml(kanzleiName)}</div>
      <div style="color:rgba(255,255,255,.7);font-size:.73rem;margin-top:2px">Obere Burghalde 92, 71229 Leonberg</div>
    </div>
  </div>`;
  const sigLogoBlock = `<div style="background:#6d7aff;width:38px;height:38px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;text-align:center"><span style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:#fff;line-height:1.1">H&amp;K</span></div>`;
  const signatureHtml = staff ? `<div style="margin-top:28px;padding-top:20px;border-top:2px solid #f0f0f4">
    <div style="display:flex;align-items:center;gap:14px">
      ${sigLogoBlock}
      <div>
        <div style="font-weight:700;color:#1a1a2e;font-size:.88rem">${escHtml(staff.name)}</div>
        ${staff.position ? `<div style="color:#6d7aff;font-size:.77rem;font-weight:600;margin-top:1px">${escHtml(staff.position)}</div>` : ''}
        <div style="color:#777;font-size:.74rem;margin-top:3px">${staff.phone ? `Tel. ${escHtml(staff.phone)}&nbsp;&nbsp;·&nbsp;&nbsp;` : ''}${escHtml(staff.signature_email || staff.email)}</div>
      </div>
    </div>
  </div>` : '';
  const footer = `<div style="background:#f5f5f8;padding:14px 32px;border-top:1px solid #e8e8ec;border-radius:0 0 12px 12px">
    <div style="font-size:.7rem;color:#999;line-height:1.65">
      <strong style="color:#666">H&amp;K Automation Steuerberatungsgesellschaft mbH</strong> &nbsp;·&nbsp; Obere Burghalde 92, 71229 Leonberg<br>
      Diese Nachricht enthält möglicherweise vertrauliche Informationen und ist ausschließlich für den bezeichneten Empfänger bestimmt. Wenn Sie nicht der beabsichtigte Empfänger sind, löschen Sie diese Nachricht bitte umgehend.<br>
      <span style="color:#bbb">Automatisch generiert mit H&amp;K Automation</span>
    </div>
  </div>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px 16px;background:#ecedf1;font-family:Arial,Helvetica,sans-serif"><div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.10)">${header}<div style="padding:28px 32px;font-size:.9rem;color:#333;line-height:1.75">${body}${signatureHtml}</div>${footer}</div></body></html>`;
}

// Passwort-Reset-Codes (In-Memory, TTL 10 min)
const resetCodes = new Map();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.redirect('/kanzlei.html'));

// ─── DB SCHEMA ───────────────────────────────────────────────────────────────
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

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_sha256 TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    answers TEXT NOT NULL,
    doc_checklist TEXT NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER REFERENCES submissions(id),
    doc_key TEXT NOT NULL,
    doc_name TEXT NOT NULL,
    is_required INTEGER DEFAULT 1,
    filename TEXT,
    original_name TEXT,
    mimetype TEXT,
    filesize INTEGER,
    status TEXT DEFAULT 'pending',
    ai_result TEXT,
    kanzlei_note TEXT,
    uploaded_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fristen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandant_id INTEGER,
    mandant_name TEXT,
    titel TEXT NOT NULL,
    typ TEXT DEFAULT 'sonstige',
    faellig_am DATE NOT NULL,
    erledigt INTEGER DEFAULT 0,
    notiz TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS aufgaben (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandant_id INTEGER,
    mandant_name TEXT,
    titel TEXT NOT NULL,
    beschreibung TEXT,
    status TEXT DEFAULT 'offen',
    prioritaet TEXT DEFAULT 'normal',
    faellig_am DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS zeiterfassung (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandant_id INTEGER,
    mandant_name TEXT,
    beschreibung TEXT NOT NULL,
    minuten INTEGER NOT NULL,
    datum DATE NOT NULL,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rechnungen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandant_name TEXT NOT NULL,
    mandant_email TEXT,
    beschreibung TEXT NOT NULL,
    betrag REAL NOT NULL,
    status TEXT DEFAULT 'offen',
    faellig_am DATE,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kalender_termine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titel TEXT NOT NULL,
    mandant_name TEXT,
    datum DATE NOT NULL,
    uhrzeit TEXT,
    typ TEXT DEFAULT 'termin',
    notiz TEXT,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posteingang (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    von TEXT NOT NULL,
    von_name TEXT,
    betreff TEXT NOT NULL,
    inhalt TEXT NOT NULL,
    datum DATETIME DEFAULT CURRENT_TIMESTAMP,
    mandant_name TEXT,
    status TEXT DEFAULT 'ungelesen',
    ki_antwort TEXT,
    gesendet INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bescheide (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandant_name TEXT NOT NULL,
    mandant_email TEXT,
    jahr INTEGER,
    art TEXT,
    betrag REAL,
    datum DATE,
    ki_analyse TEXT,
    status TEXT DEFAULT 'neu',
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kontoauszug_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER REFERENCES submissions(id),
    category TEXT NOT NULL,
    filename TEXT,
    original_name TEXT,
    filesize INTEGER,
    mimetype TEXT,
    analysis_status TEXT DEFAULT 'pending',
    analysis_result TEXT,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS beleg_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER REFERENCES submissions(id),
    beleg_category TEXT NOT NULL,
    transaction_date TEXT,
    merchant TEXT,
    amount REAL,
    description TEXT,
    deductibility TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bwa_analysen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandant_name TEXT,
    filename TEXT,
    originalname TEXT,
    analyse TEXT NOT NULL,
    gesendet INTEGER DEFAULT 0,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// DB-Migrationen (idempotent)
try { db.exec('ALTER TABLE users ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE fristen ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE aufgaben ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE zeiterfassung ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE kalender_termine ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE posteingang ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN ampel TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN kurzfazit TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN kennzahlen TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN bwa_rows TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN email_betreff TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE bwa_analysen ADD COLUMN email_text TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN bwa_kategorie TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN zeitraum_monat INTEGER DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN zeitraum_jahr INTEGER DEFAULT NULL'); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS bwa_dokumente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_id INTEGER NOT NULL,
  mandant_name TEXT NOT NULL,
  bwa_kategorie TEXT NOT NULL,
  zeitraum_monat INTEGER,
  zeitraum_jahr INTEGER,
  kanzlei_id INTEGER DEFAULT 1,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inbox_id) REFERENCES dokument_inbox(id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS jahresabschluss_analysen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER DEFAULT 1,
  mandant_name TEXT,
  geschaeftsjahr TEXT,
  bilanzstichtag TEXT,
  filename TEXT,
  originalname TEXT,
  analyse_json TEXT NOT NULL,
  format_erkannt INTEGER DEFAULT 1,
  gesendet INTEGER DEFAULT 0,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS mandant_dokumente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_id INTEGER NOT NULL,
  mandant_name TEXT NOT NULL,
  typ TEXT,
  kanzlei_id INTEGER DEFAULT 1,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inbox_id) REFERENCES dokument_inbox(id)
)`);
try { db.exec('ALTER TABLE rechnungen ADD COLUMN mahnung_am DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN mahnung_2_am DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN mahnung_3_am DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN rechnungsnummer TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN positionen TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN gesendet_am DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE rechnungen ADD COLUMN mwst_satz REAL DEFAULT 19'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN erklaerung_file TEXT'); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS mandant_steuererklaerungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER NOT NULL,
  mandant_name TEXT NOT NULL,
  dateiname TEXT NOT NULL,
  dateipfad TEXT NOT NULL,
  steuerjahr INTEGER,
  quelle TEXT DEFAULT 'manuell',
  upload_datum DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('ALTER TABLE bescheide ADD COLUMN erklaerung_inbox_path TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN erklaerung_inbox_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE mandant_steuererklaerungen ADD COLUMN bescheid_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN erklaerung_auswahl_noetig INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN erklaerung_bescheid_optionen TEXT'); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS bescheid_dokumente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bescheid_id INTEGER NOT NULL,
  kanzlei_id INTEGER NOT NULL,
  typ TEXT NOT NULL,
  dateiname TEXT NOT NULL,
  dateipfad TEXT NOT NULL,
  upload_datum DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('ALTER TABLE bescheide ADD COLUMN bescheid_file TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN finanzamt TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN erklaerter_betrag REAL'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN vorlaeufigkeit TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN einspruch_ja INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN einspruch_datum DATE'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN einspruch_begruendung TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN ergebnis TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN ergebnis_betrag REAL'); } catch(e) {}
try { db.exec("ALTER TABLE bescheide ADD COLUMN absender_typ TEXT DEFAULT 'finanzamt'"); } catch(e) {}
try { db.exec('ALTER TABLE kalender_termine ADD COLUMN uhrzeit_ende TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE kalender_termine ADD COLUMN ort TEXT'); } catch(e) {}

// ── Bescheide v2 Migrationen ──
try { db.exec('ALTER TABLE bescheide ADD COLUMN original_filename TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN mime_type TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN file_size INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN storage_path TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN upload_source TEXT DEFAULT "manual"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN document_type TEXT DEFAULT "unbekannt"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN tax_year INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN status TEXT DEFAULT "hochgeladen"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN review_status TEXT DEFAULT "offen"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN analysis_status TEXT DEFAULT "nicht_gestartet"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN deadline_status TEXT DEFAULT "keine"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN analysis_result_json TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN analysis_confidence REAL'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN analysis_version INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN analysis_source TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN analyzed_at DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN assigned_to INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN reviewed_by INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN reviewed_at DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN workflow_priority TEXT DEFAULT "normal"'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN follow_up_required INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN follow_up_note TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN requires_manual_review INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN notes_internal TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN mandant_id INTEGER'); } catch(e) {}

// ── Bescheide v3 Migrationen (Workflow + KI-Felder) ──
try { db.exec("ALTER TABLE bescheide ADD COLUMN bearbeitungsstand TEXT DEFAULT 'neu'"); } catch(e) {}
try { db.exec("ALTER TABLE bescheide ADD COLUMN einspruch_phase TEXT DEFAULT 'pruefung'"); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN ki_quintessenz TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN kernnummer REAL'); } catch(e) {}
try { db.exec("ALTER TABLE bescheide ADD COLUMN ki_einschaetzung TEXT DEFAULT 'nicht_analysiert'"); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN vorlaeufig INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN folgebescheid INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN folgebescheid_typ TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN grundlagenbescheid_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN aktenzeichen TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN bescheid_datum DATE'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN adv_beantragt INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN adv_datum DATE'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN fa_entscheidung TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN klage_status TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN klage_ergebnis TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN frist_bestaetigt INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN frist_bestaetigt_datum DATE'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN einspruchsfrist_datum DATE'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN einspruchsschreiben_entwurf TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN geoeffnet_am DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN einspruch_abgeschickt_am DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN untaetigkeitsklage_hinweis INTEGER DEFAULT 0'); } catch(e) {}

// ── Bescheid/Erklärung Matching v1 ──
try { db.exec('ALTER TABLE bescheide ADD COLUMN steuer_art TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN ist_aenderungsbescheid INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN vorgaenger_bescheid_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN zeitraum_quartal INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE bescheide ADD COLUMN zeitraum_monat_bescheid INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE mandant_steuererklaerungen ADD COLUMN steuer_art TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE mandant_steuererklaerungen ADD COLUMN zeitraum_quartal INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE mandant_steuererklaerungen ADD COLUMN zeitraum_monat_erkl INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN steuer_art TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN ist_aenderungsbescheid INTEGER DEFAULT 0'); } catch(e) {}

db.exec(`CREATE TABLE IF NOT EXISTS bescheid_aktivitaet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bescheid_id INTEGER NOT NULL REFERENCES bescheide(id),
  kanzlei_id INTEGER NOT NULL,
  aktion TEXT NOT NULL,
  details TEXT,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS bescheid_abweichungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bescheid_id INTEGER NOT NULL REFERENCES bescheide(id),
  titel TEXT NOT NULL,
  erklaert TEXT,
  festgesetzt TEXT,
  differenz REAL,
  fuer_einspruch INTEGER DEFAULT 0,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ── Neue Infrastruktur-Tabellen ──
db.exec(`
  CREATE TABLE IF NOT EXISTS bescheid_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bescheid_id INTEGER NOT NULL REFERENCES bescheide(id),
    version INTEGER DEFAULT 1,
    source TEXT DEFAULT 'ai_agent',
    status TEXT DEFAULT 'completed',
    raw_response_json TEXT,
    normalized_result_json TEXT,
    confidence_overall REAL,
    summary TEXT,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bescheid_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bescheid_id INTEGER NOT NULL REFERENCES bescheide(id),
    analysis_id INTEGER REFERENCES bescheid_analysis(id),
    field_name TEXT NOT NULL,
    field_value_json TEXT,
    value_type TEXT DEFAULT 'string',
    confidence REAL,
    source_text TEXT,
    is_user_corrected INTEGER DEFAULT 0,
    corrected_value_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bescheid_deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bescheid_id INTEGER NOT NULL REFERENCES bescheide(id),
    frist_id INTEGER REFERENCES fristen(id),
    deadline_type TEXT,
    suggested_date DATE,
    suggestion_reason TEXT,
    suggestion_confidence REAL,
    status TEXT DEFAULT 'vorgeschlagen',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Staff table
db.exec(`CREATE TABLE IF NOT EXISTS kanzlei_staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_sha256 TEXT NOT NULL,
  role TEXT DEFAULT 'berater',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('ALTER TABLE users ADD COLUMN assigned_staff_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE kanzlei_staff ADD COLUMN position TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE kanzlei_staff ADD COLUMN phone TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE kanzlei_staff ADD COLUMN signature_email TEXT'); } catch(e) {}

// Notifications
db.exec(`CREATE TABLE IF NOT EXISTS staff_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER NOT NULL,
  kanzlei_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Handoff-Anfragen
db.exec(`CREATE TABLE IF NOT EXISTS handoff_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_staff_id INTEGER NOT NULL,
  to_staff_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kanzlei_id INTEGER NOT NULL,
  notiz TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('ALTER TABLE handoff_requests ADD COLUMN notiz TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE handoff_requests ADD COLUMN response_notiz TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE handoff_requests ADD COLUMN seen_by_sender INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN kontenrahmen TEXT DEFAULT 'skr03'"); } catch(e) {}
// Migration: users.email global UNIQUE → UNIQUE(email, kanzlei_id)
try {
  // WICHTIG: autoindex für UNIQUE-Constraints hat sql=NULL in sqlite_master → LIKE-Check immer false.
  // Stattdessen: prüfen ob die UNIQUE-Constraint bereits kanzlei_id enthält via pragma_table_info.
  // Wir prüfen ob kanzlei_id existiert UND ob noch ein veralteter globaler UNIQUE-Index existiert.
  const hasGlobalUniqueIdx = db.prepare(
    `SELECT COUNT(*) as n FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql IS NOT NULL AND sql LIKE '%UNIQUE%email%' AND sql NOT LIKE '%kanzlei_id%'`
  ).get().n;
  const hasKanzleiCol = db.prepare(
    `SELECT COUNT(*) as n FROM pragma_table_info('users') WHERE name='kanzlei_id'`
  ).get().n;
  // Migration nur wenn: kanzlei_id schon vorhanden (wurde per ALTER TABLE hinzugefügt)
  // aber noch der alte globale UNIQUE auf email liegt (expliziter Index, nicht autoindex)
  // OR: für frische DBs prüfen per Schema-Analyse ob wir den inline UNIQUE(email,kanzlei_id) haben
  const hasCompositeConstraint = db.prepare(
    `SELECT COUNT(*) as n FROM sqlite_master WHERE type='table' AND name='users' AND sql LIKE '%UNIQUE(email, kanzlei_id)%'`
  ).get().n;
  if (hasKanzleiCol && !hasCompositeConstraint) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        password_sha256 TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        kanzlei_id INTEGER DEFAULT 1,
        assigned_staff_id INTEGER,
        kontenrahmen TEXT DEFAULT 'skr03',
        UNIQUE(email, kanzlei_id)
      );
      INSERT OR IGNORE INTO users_new SELECT id,email,name,password_sha256,created_at,kanzlei_id,assigned_staff_id,kontenrahmen FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('[Migration] users: email UNIQUE → UNIQUE(email, kanzlei_id) ✓');
  }
} catch(e) { console.error('[Migration] users unique fix:', e.message); }
try { db.exec("ALTER TABLE documents ADD COLUMN extracted_vendor TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE documents ADD COLUMN extracted_amount REAL"); } catch(e) {}
try { db.exec("ALTER TABLE documents ADD COLUMN extracted_date TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE documents ADD COLUMN extracted_doctype TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE documents ADD COLUMN extracted_invoice_nr TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE documents ADD COLUMN scanner_inbox_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE fristen ADD COLUMN reminder_7d_sent INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE fristen ADD COLUMN reminder_3d_sent INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE fristen ADD COLUMN reminder_1d_sent INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE fristen ADD COLUMN bescheid_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE submissions ADD COLUMN last_reminder_sent DATETIME"); } catch(e) {}
try { db.exec("ALTER TABLE submissions ADD COLUMN reminder_count INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE beleg_flags ADD COLUMN upload_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE kanzlei_settings ADD COLUMN scanner_pin TEXT DEFAULT '1234'"); } catch(e) {}

// ── Email-Agent Tabellen (direkt in hk.db, kein separates agent-DB) ──────────
db.exec(`CREATE TABLE IF NOT EXISTS agent_belege (
  id TEXT PRIMARY KEY,
  kanzlei_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL REFERENCES users(id),
  typ TEXT NOT NULL,
  datum TEXT,
  brutto REAL,
  netto REAL,
  mwst REAL,
  rechnungsnummer TEXT,
  aussteller TEXT,
  empfaenger TEXT,
  datei_pfad TEXT NOT NULL,
  vorschau_pfad TEXT,
  original_dateiname TEXT,
  absender_email TEXT,
  buchungskategorie TEXT,
  datev_exportiert INTEGER DEFAULT 0,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec("ALTER TABLE agent_belege ADD COLUMN kanzlei_id INTEGER NOT NULL DEFAULT 1"); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS agent_kontoauszuege (
  id TEXT PRIMARY KEY,
  kanzlei_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kategorie TEXT DEFAULT 'kontoauszug',
  datei_pfad TEXT NOT NULL,
  original_dateiname TEXT,
  absender_email TEXT,
  analyse_zusammenfassung TEXT,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
  analysiert_am DATETIME
)`);
try { db.exec("ALTER TABLE agent_kontoauszuege ADD COLUMN kanzlei_id INTEGER NOT NULL DEFAULT 1"); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS agent_kontoauszug_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kontoauszug_id TEXT NOT NULL REFERENCES agent_kontoauszuege(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  datum TEXT,
  merchant TEXT,
  betrag REAL,
  beschreibung TEXT,
  beleg_kategorie TEXT DEFAULT 'eingang',
  status TEXT DEFAULT 'offen',
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
db.exec(`CREATE TABLE IF NOT EXISTS agent_verarbeitete_emails (
  message_id TEXT PRIMARY KEY,
  erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('ALTER TABLE users ADD COLUMN datev_berater_nr INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN datev_mandant_nr INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN vollmacht_nicht_gewuenscht INTEGER DEFAULT 0'); } catch(e) {}
db.exec(`CREATE TABLE IF NOT EXISTS mandant_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  UNIQUE(kanzlei_id, user_id, email)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS kreditoren (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  konto_nr INTEGER NOT NULL,
  UNIQUE(kanzlei_id, user_id, name)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS debitoren (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  konto_nr INTEGER NOT NULL,
  UNIQUE(kanzlei_id, user_id, name)
)`);

db.exec(`CREATE TABLE IF NOT EXISTS kanzlei_settings (
  kanzlei_id INTEGER PRIMARY KEY,
  name TEXT,
  steuernummer TEXT,
  ust_id TEXT,
  strasse TEXT,
  ort TEXT,
  telefon TEXT,
  email TEXT,
  geschaeftsfuehrer TEXT,
  bank_name TEXT,
  iban TEXT,
  bic TEXT,
  zusatz TEXT
)`);

// Seed staff accounts (INSERT OR IGNORE = safe to run multiple times)
{
  const _crypto = require('crypto');
  const staffSeed = [
    { name: 'Louis Honal', email: 'louis.honal@hks-automation.de', pw: 'Gorilla@2005!', role: 'admin' },
    { name: 'Sven Konstantinow', email: 'sven.konstantinow@hks-automation.de', pw: 'Gorilla@2005!', role: 'berater' },
    { name: 'Marc Lichtwald', email: 'marc.lichtwald@hks-automation.de', pw: 'Gorilla@2005!', role: 'berater' },
  ];
  const insertStaff = db.prepare('INSERT OR IGNORE INTO kanzlei_staff (name, email, password_sha256, role) VALUES (?,?,?,?)');
  for (const s of staffSeed) {
    insertStaff.run(s.name, s.email, _crypto.createHash('sha256').update(s.pw).digest('hex'), s.role);
  }
}

// ─── AUTO-CREATE DEFAULT KANZLEI ─────────────────────────────────────────────
// Falls noch keine Kanzlei in der DB: aus .env-Werten erstellen
{
  const count = db.prepare('SELECT COUNT(*) AS n FROM kanzleien').get().n;
  if (count === 0 && process.env.KANZLEI_PASSWORD) {
    const crypto = require('crypto');
    const pwHash = crypto.createHash('sha256').update(process.env.KANZLEI_PASSWORD).digest('hex');
    const name  = process.env.KANZLEI_NAME  || 'H&K Steuerberatung';
    const email = process.env.KANZLEI_EMAIL || 'kanzlei@hks-automation.de';
    db.prepare('INSERT OR IGNORE INTO kanzleien (id, name, email, password_sha256, slug) VALUES (1,?,?,?,?)')
      .run(name, email, pwHash, 'default');
    console.log('[Multi-Tenant] Default-Kanzlei angelegt:', name, email);
  }
}

// ─── MULTER ──────────────────────────────────────────────────────────────────
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Memory-Storage für synchrone KI-Schnellprüfung (kein Speichern auf Disk)
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'uploads', String(req.userId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.docId}_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// BWA-Upload Storage
const bwaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'bwa_uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `bwa_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const bwaUpload = multer({
  storage: bwaStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf')
});

// Jahresabschluss-Upload Storage (PDF persistent, für Re-Render und Mail-Anhang)
const jaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'ja_uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `ja_${Date.now()}${path.extname(file.originalname)}`);
  }
});
const jaUploadDisk = multer({
  storage: jaStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf')
});

// Bescheid-Upload Storage
const bescheidStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'bescheid_uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `bescheid_${Date.now()}_${file.fieldname}${path.extname(file.originalname)}`);
  }
});
const bescheidUpload = multer({
  storage: bescheidStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf')
});

// ═══ BESCHEID-INFRASTRUKTUR ═══════════════════════════════════════════════════
const DOCUMENT_TYPES = [
  { value: 'einkommensteuerbescheid',     label: 'Einkommensteuerbescheid' },
  { value: 'koerperschaftsteuerbescheid', label: 'Körperschaftsteuerbescheid' },
  { value: 'gewerbesteuerbescheid',       label: 'Gewerbesteuerbescheid' },
  { value: 'umsatzsteuerbescheid',        label: 'Umsatzsteuerbescheid' },
  { value: 'umsatzsteuer_vz',             label: 'Umsatzsteuer-Vorauszahlung' },
  { value: 'feststellungsbescheid',       label: 'Feststellungsbescheid (gesondert)' },
  { value: 'aenderungsbescheid',          label: 'Änderungsbescheid' },
  { value: 'aufhebungsbescheid',          label: 'Aufhebungsbescheid' },
  { value: 'erstattungsbescheid',         label: 'Erstattungsbescheid' },
  { value: 'nachzahlungsbescheid',        label: 'Nachzahlungsbescheid' },
  { value: 'zinsbescheid',                label: 'Zinsbescheid (§233a AO)' },
  { value: 'verspaetungszuschlag',        label: 'Verspätungszuschlag (§152 AO)' },
  { value: 'saeumniszuschlag',            label: 'Säumniszuschlag (§240 AO)' },
  { value: 'pruefungsankuendigung',       label: 'Prüfungsankündigung' },
  { value: 'unterlagenanforderung',       label: 'Unterlagenanforderung' },
  { value: 'mahnbescheid',                label: 'Mahnbescheid' },
  { value: 'rentenbescheid',              label: 'Rentenbescheid (DRV)' },
  { value: 'sonstiges_finanzamt',         label: 'Sonstiges Schreiben (Finanzamt)' },
  { value: 'unbekannt',                   label: 'Unbekannt / Sonstiges' },
];
const BESCHEID_STATUS = ['neu','hochgeladen','in_verarbeitung','analysiert','fehler','archiviert'];
const REVIEW_STATUS = ['offen','zuordnung_pruefen','fachlich_pruefen','manuell_korrigieren','frist_pruefen','mandant_informieren','abgeschlossen'];
const ANALYSIS_STATUS = ['nicht_gestartet','pending','running','completed','failed','partially_completed'];
const DEADLINE_STATUS = ['keine','vorgeschlagen','angelegt','bestaetigt','erledigt'];

// Bescheid v2 Upload (erweitert: PDF + Bilder, bis 20MB)
const bescheidV2Upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(DATA_DIR, 'uploads', 'bescheide');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `bescheid_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf','image/jpeg','image/png','image/tiff'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Kontoauszug-Upload Storage
const kontoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'konto_uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'));
  }
});
const kontoUpload = multer({
  storage: kontoStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['application/pdf','image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif'].includes(file.mimetype))
});

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token ungültig' });
  }
}

function kanzleiMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role === 'kanzlei') {
      req.kanzleiId = payload.kanzleiId;
      req.staffId = null;
      req.staffRole = 'admin';
      next();
    } else if (payload.role === 'staff') {
      req.kanzleiId = payload.kanzleiId;
      req.staffId = payload.staffId;
      req.staffRole = payload.staffRole;
      next();
    } else {
      res.status(403).json({ error: 'Kein Zugriff' });
    }
  } catch {
    res.status(401).json({ error: 'Token ungültig' });
  }
}

// ─── AI CHECK ────────────────────────────────────────────────────────────────
async function runAiCheck(docId, filepath, mimetype, docName) {
  db.prepare("UPDATE documents SET status='ai_checking', updated_at=datetime('now') WHERE id=?").run(docId);
  try {
    let content;
    if (mimetype === 'application/pdf') {
      const buf = fs.readFileSync(filepath);
      const parsed = await pdfParse(buf);
      const text = parsed.text.slice(0, 3000);
      content = [{ type: 'text', text: `Dokumentinhalt (PDF-Text):\n${text}` }];
    } else {
      const b64 = fs.readFileSync(filepath).toString('base64');
      const mediaType = mimetype === 'image/png' ? 'image/png'
        : mimetype === 'image/webp' ? 'image/webp'
        : 'image/jpeg';
      content = [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } }];
    }

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          ...content,
          {
            type: 'text',
            text: `Erwartetes Dokument: "${docName}"\n\nAnalysiere dieses Dokument und antworte NUR als JSON (kein Text drumherum):\n{\n  "ok": true/false,\n  "confidence": 0.0-1.0,\n  "detected": "kurze Beschreibung was du siehst",\n  "message": "kurze Aussage auf Deutsch ob Dokument passt",\n  "vendor": "Aussteller/Lieferant oder null",\n  "amount": 0.00,\n  "date": "YYYY-MM-DD oder null",\n  "doctype": "Eingangsrechnung|Ausgangsrechnung|Quittung|Kontoauszug|Vertrag|Bescheid|Lohnabrechnung|Sonstiges",\n  "invoice_nr": "Rechnungsnummer oder null"\n}`
          }
        ]
      }]
    });

    const rawText = msg.content[0].text;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    db.prepare(`UPDATE documents SET
      status=?, ai_result=?,
      extracted_vendor=?, extracted_amount=?, extracted_date=?,
      extracted_doctype=?, extracted_invoice_nr=?,
      updated_at=datetime('now') WHERE id=?`)
      .run(
        result.ok ? 'ai_ok' : 'ai_warn',
        JSON.stringify(result),
        result.vendor || null,
        result.amount || null,
        result.date   || null,
        result.doctype || null,
        result.invoice_nr || null,
        docId
      );
  } catch (err) {
    console.error('AI check failed:', err.message);
    db.prepare("UPDATE documents SET status='uploaded', updated_at=datetime('now') WHERE id=?").run(docId);
  }
}

// ─── KI-SCHNELLPRÜFUNG (synchron, kein Auth nötig) ───────────────────────────
// POST /api/ai-check
// Body: multipart — aiType, expectedName, file0, file1?, file2?
app.post('/api/ai-check',
  memUpload.fields([
    { name: 'file0', maxCount: 1 },
    { name: 'file1', maxCount: 1 },
    { name: 'file2', maxCount: 1 },
  ]),
  async (req, res) => {
    const { aiType, expectedName } = req.body || {};
    if (!aiType) return res.status(400).json({ ok: false, issue: 'aiType fehlt' });

    // Alle hochgeladenen Dateien sammeln
    const files = ['file0', 'file1', 'file2']
      .map(k => req.files?.[k]?.[0])
      .filter(Boolean);

    if (!files.length) return res.status(400).json({ ok: false, issue: 'Keine Datei erhalten' });

    try {
      // Content-Array für Claude aufbauen
      const content = [];
      for (const file of files) {
        const b64 = file.buffer.toString('base64');
        if (file.mimetype === 'application/pdf') {
          content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
        } else {
          const mt = ['image/png','image/webp'].includes(file.mimetype) ? file.mimetype : 'image/jpeg';
          content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
        }
      }

      // Prompt je nach Dokumenttyp
      let prompt = '';
      if (aiType === 'ausweis') {
        const nameHint  = expectedName ? `"${expectedName}"` : '(Name unbekannt)';
        const fileCount = files.length;
        prompt = `Du bist Dokumentenprüfer einer deutschen Steuerberatungskanzlei.
Analysiere ${fileCount === 1 ? 'dieses Dokument' : `diese ${fileCount} Dokumente`}.

Prüfe:
1. Handelt es sich um einen deutschen Personalausweis oder Reisepass?
2. Stimmt der sichtbare Name mit ${nameHint} überein?
3. Bei Personalausweis (NICHT Reisepass): Sind Vorder- UND Rückseite vorhanden? (${fileCount >= 2 ? `${fileCount} Dateien hochgeladen` : '1 Datei hochgeladen – evtl. Rückseite fehlend'})

Antworte NUR mit JSON, kein Markdown, kein Text davor/danach:
{"ok":true,"issue":""}
ok=false wenn: kein Ausweis/Reisepass erkennbar, Name stimmt nicht überein, oder Personalausweis aber Rückseite fehlt.
issue = kurze Fehlerbeschreibung auf Deutsch (leer wenn alles ok).`;
      } else if (aiType === 'meldebescheinigung') {
        prompt = `Ist das abgebildete Dokument eine deutsche Meldebescheinigung (Anmeldebestätigung vom Einwohnermeldeamt / Wohnortbestätigung)?
Antworte NUR mit JSON, kein Markdown:
{"ok":true,"issue":""}
ok=false wenn es KEINE Meldebescheinigung ist.
issue = kurze Fehlerbeschreibung auf Deutsch (leer wenn ok).`;
      } else {
        return res.status(400).json({ ok: false, issue: `Unbekannter aiType: ${aiType}` });
      }

      content.push({ type: 'text', text: prompt });

      const msg = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content }],
      });

      const raw     = msg.content[0].text || '{}';
      const cleaned = raw.replace(/```(?:json)?\n?|\n?```/g, '').trim();
      const match   = cleaned.match(/\{[\s\S]*\}/);
      const parsed  = JSON.parse(match ? match[0] : cleaned);

      res.json({ ok: !!parsed.ok, issue: parsed.issue || '' });
    } catch (err) {
      console.error('ai-check Fehler:', err.message);
      res.status(500).json({ ok: false, issue: 'Serverfehler bei der KI-Prüfung' });
    }
  }
);

// ─── ROUTES: MANDANT AUTH ─────────────────────────────────────────────────────

// POST /api/auth/submit
app.post('/api/auth/submit', (req, res) => {
  const { email, name, password_sha256, answers, docList, kanzlei_id } = req.body;
  console.log('[submit] Eingang:', email, name, 'docs:', Array.isArray(docList) ? docList.length : typeof docList);
  if (!email || !name || !password_sha256 || !answers || !docList) {
    console.log('[submit] Fehlende Felder:', { email:!!email, name:!!name, hash:!!password_sha256, answers:!!answers, docList:!!docList });
    return res.status(400).json({ error: 'Fehlende Felder' });
  }
  const kid = parseInt(kanzlei_id) || 1;

  // Upsert user
  let user = db.prepare('SELECT * FROM users WHERE email=? AND kanzlei_id=?').get(email, kid);
  if (user) {
    db.prepare('UPDATE users SET name=?, password_sha256=? WHERE id=?')
      .run(name, password_sha256, user.id);
  } else {
    const info = db.prepare('INSERT INTO users (email, name, password_sha256, kanzlei_id) VALUES (?,?,?,?)')
      .run(email, name, password_sha256, kid);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  }

  // Create submission
  const subInfo = db.prepare(
    'INSERT INTO submissions (user_id, answers, doc_checklist) VALUES (?,?,?)'
  ).run(user.id, JSON.stringify(answers), JSON.stringify(docList));
  const submissionId = subInfo.lastInsertRowid;

  // Create document entries
  const insertDoc = db.prepare(
    'INSERT INTO documents (submission_id, doc_key, doc_name, is_required) VALUES (?,?,?,?)'
  );
  for (const doc of docList) {
    insertDoc.run(submissionId, doc.key, doc.name, doc.must ? 1 : 0);
  }

  // Auto-Fristen generieren
  createAutoFristen(user.id, user.name, answers, kid);

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, submissionId });
});

// POST /api/auth/register — neuer Mandant registrieren
app.post('/api/auth/register', async (req, res) => {
  const { email, name, password_sha256 } = req.body;
  if (!email || !name || !password_sha256) return res.status(400).json({ error: 'Fehlende Felder' });
  const existing = db.prepare('SELECT id FROM users WHERE email=? AND kanzlei_id=1').get(email);
  if (existing) return res.status(409).json({ error: 'Diese E-Mail ist bereits registriert.' });
  const info = db.prepare('INSERT INTO users (email, name, password_sha256, kanzlei_id) VALUES (?,?,?,1)')
    .run(email, name, password_sha256);
  const token = require('jsonwebtoken').sign({ userId: info.lastInsertRowid }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ ok: true, token, name });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password_sha256 } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=? AND password_sha256=?')
    .get(email, password_sha256);
  if (!user) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, name: user.name });
});

// PUT /api/auth/update-profile
app.put('/api/auth/update-profile', authMiddleware, (req, res) => {
  const { name, new_email, current_password_sha256 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name darf nicht leer sein.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  const emailChanged = new_email && new_email !== user.email;
  if (emailChanged) {
    if (!current_password_sha256) return res.status(400).json({ error: 'Passwort erforderlich.' });
    if (user.password_sha256 !== current_password_sha256) return res.status(403).json({ error: 'Passwort ist falsch.' });
    const taken = db.prepare('SELECT id FROM users WHERE email=? AND kanzlei_id=? AND id!=?').get(new_email, user.kanzlei_id, user.id);
    if (taken) return res.status(409).json({ error: 'Diese E-Mail wird bereits verwendet.' });
  }
  const finalEmail = emailChanged ? new_email : user.email;
  db.prepare('UPDATE users SET name=?, email=? WHERE id=?').run(name, finalEmail, user.id);
  // Auch answers.email in der letzten Submission aktualisieren, damit Kanzlei-Stammdaten stimmen
  const sub = db.prepare('SELECT id, answers FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.userId);
  if (sub) {
    try {
      const a = JSON.parse(sub.answers || '{}');
      a.email = finalEmail;
      db.prepare('UPDATE submissions SET answers=? WHERE id=?').run(JSON.stringify(a), sub.id);
    } catch (_) {}
  }
  res.json({ ok: true });
});

// DELETE /api/auth/account — Konto + alle Daten unwiderruflich löschen
app.delete('/api/auth/account', authMiddleware, (req, res) => {
  const userId = req.userId;
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(userId);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });

  // Hochgeladene Dateien vom Server entfernen
  const uploadsDir = path.join(DATA_DIR, 'uploads', String(userId));
  try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch(_) {}

  const submissionIds = db.prepare('SELECT id FROM submissions WHERE user_id=?').all(userId).map(s => s.id);

  db.transaction(() => {
    submissionIds.forEach(sid => {
      db.prepare('DELETE FROM documents WHERE submission_id=?').run(sid);
      db.prepare('DELETE FROM kontoauszug_uploads WHERE submission_id=?').run(sid);
    });
    db.prepare('DELETE FROM submissions WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM agent_belege WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM agent_kontoauszuege WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM agent_kontoauszug_flags WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM mandant_emails WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM kreditoren WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM debitoren WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM email_mandant WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM handoff_requests WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM users WHERE id=?').run(userId);
  })();

  res.json({ ok: true });
});

// PUT /api/auth/change-password
app.put('/api/auth/change-password', authMiddleware, (req, res) => {
  const { current_password_sha256, new_password_sha256 } = req.body;
  if (!current_password_sha256 || !new_password_sha256) return res.status(400).json({ error: 'Fehlende Felder.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden.' });
  if (user.password_sha256 !== current_password_sha256) return res.status(403).json({ error: 'Aktuelles Passwort ist falsch.' });
  db.prepare('UPDATE users SET password_sha256=? WHERE id=?').run(new_password_sha256, req.userId);
  res.json({ ok: true });
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, name FROM users WHERE id=?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(user);
});

// ─── ROUTES: MANDANT DOCS ────────────────────────────────────────────────────

// GET /api/docs
app.get('/api/docs', authMiddleware, (req, res) => {
  const submission = db.prepare(
    'SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1'
  ).get(req.userId);
  if (!submission) return res.status(404).json({ error: 'Keine Einreichung gefunden' });

  const documents = db.prepare(
    'SELECT id,doc_key,doc_name,is_required,status,filename,ai_result,kanzlei_note,uploaded_at,original_name,filesize,extracted_vendor,extracted_amount,extracted_date,extracted_doctype,extracted_invoice_nr FROM documents WHERE submission_id=? ORDER BY is_required DESC, id ASC'
  ).all(submission.id);

  res.json({ submission, documents });
});

// POST /api/docs/:docId/upload
app.post('/api/docs/:docId/upload', authMiddleware, upload.array('file', 10), async (req, res) => {
  const docId = parseInt(req.params.docId);
  const files = req.files || [];

  // Verify ownership
  const doc = db.prepare(`
    SELECT d.* FROM documents d
    JOIN submissions s ON d.submission_id = s.id
    WHERE d.id=? AND s.user_id=?
  `).get(docId, req.userId);

  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  if (!files.length) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

  // Delete old file if exists
  if (doc.filename) {
    const oldPath = path.join(DATA_DIR, 'uploads', String(req.userId), doc.filename);
    if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch(_) {}
  }

  // Steuerberatervollmacht → PDF mit Unterschrift generieren (immer nur erste Datei)
  req.file = files[0];

  if (doc.doc_key === 'vollmacht') {
    if (files.length > 1) files.slice(1).forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    try {
      const PDFDocument = require('pdfkit');
      const sub = db.prepare('SELECT * FROM submissions WHERE id=?').get(doc.submission_id);
      const a = sub ? JSON.parse(sub.answers || '{}') : {};
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
      const kanzlei = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(user.kanzlei_id || 1);

      const pdfFilename = req.file.filename.replace(/\.[^.]+$/, '') + '_vollmacht.pdf';
      const pdfPath = path.join(path.dirname(req.file.path), pdfFilename);

      await new Promise((resolve, reject) => {
        const doc2 = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 70, right: 70 } });
        const ws = fs.createWriteStream(pdfPath);
        doc2.pipe(ws);

        const kanzleiName = kanzlei?.name || 'H&K Automation Steuerberatungsgesellschaft mbH';
        const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const mandantName = [a.vorname, a.nachname].filter(Boolean).join(' ') || user.name;

        // Header
        doc2.fontSize(9).fillColor('#666').text(kanzleiName, { align: 'right' });
        doc2.moveDown(2);

        // Titel
        doc2.fontSize(16).fillColor('#1a1a2e').font('Helvetica-Bold')
          .text('Steuerberatervollmacht', { align: 'center' });
        doc2.moveDown(0.3);
        doc2.fontSize(9).fillColor('#666').font('Helvetica')
          .text('Umfassende Vollmacht zur steuerlichen Vertretung', { align: 'center' });
        doc2.moveDown(1.5);

        // Vollmachtgeber
        doc2.fontSize(10).fillColor('#6366f1').font('Helvetica-Bold').text('VOLLMACHTGEBER');
        doc2.moveDown(0.3);
        doc2.fontSize(10).fillColor('#1a1a2e').font('Helvetica');
        const adresse = [a.strasse, [a.plz, a.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const felder = [
          ['Name', mandantName],
          ['Adresse', adresse],
          ['Geburtsdatum', a.geburtsdatum],
          ['Steuer-ID', a.steuer_id],
          ['Steuernummer', a.steuernummer],
        ];
        felder.forEach(([label, val]) => {
          if (!val) return;
          doc2.font('Helvetica-Bold').text(label + ': ', { continued: true }).font('Helvetica').text(val);
        });
        doc2.moveDown(1);

        // Vollmachtnehmer
        doc2.fontSize(10).fillColor('#6366f1').font('Helvetica-Bold').text('VOLLMACHTNEHMER');
        doc2.moveDown(0.3);
        doc2.fontSize(10).fillColor('#1a1a2e').font('Helvetica')
          .text(kanzleiName);
        doc2.moveDown(1);

        // Vollmachtstext
        doc2.fontSize(10).fillColor('#6366f1').font('Helvetica-Bold').text('UMFANG DER VOLLMACHT');
        doc2.moveDown(0.3);
        doc2.fontSize(9).fillColor('#1a1a2e').font('Helvetica')
          .text('Der Vollmachtgeber bevollmächtigt den Vollmachtnehmer hiermit umfassend zur steuerlichen Vertretung in allen steuerlichen Angelegenheiten. Diese Vollmacht umfasst insbesondere:', { lineGap: 3 });
        doc2.moveDown(0.5);

        const vollmachten = [
          'Allgemeine Steuerberatervollmacht – Vertretung gegenüber dem Finanzamt für alle Steuerarten und Steuerjahre',
          'ELSTER-Datenabruf-Vollmacht – elektronischer Abruf steuerrelevanter Daten (Lohnbescheinigungen, Rentendaten, Beitragsdaten)',
          'Umsatzsteuer-Vollmacht – Bevollmächtigung für USt-Voranmeldungen und die Umsatzsteuer-Jahreserklärung',
          'Lohnsteuer-Vollmacht – Bevollmächtigung für Lohnsteueranmeldungen und Lohnbuchhaltung',
          'Sozialversicherungs-Vollmacht – Kommunikation mit Krankenkassen und Rentenversicherungsträgern',
          'Einspruchs- und Klagebefugnis – Einlegung von Einsprüchen und Klagen in steuerlichen Angelegenheiten',
        ];
        vollmachten.forEach(v => {
          doc2.fontSize(9).font('Helvetica').text('• ' + v, { lineGap: 2, indent: 10 });
        });
        doc2.moveDown(0.8);

        doc2.fontSize(9).fillColor('#555').font('Helvetica')
          .text('Diese Vollmacht gilt bis auf Widerruf. Der Widerruf ist schriftlich gegenüber dem Vollmachtnehmer zu erklären.', { lineGap: 3 });
        doc2.moveDown(1.5);

        // Unterschrift
        doc2.fontSize(10).fillColor('#6366f1').font('Helvetica-Bold').text('UNTERSCHRIFT');
        doc2.moveDown(0.5);
        doc2.fontSize(9).fillColor('#1a1a2e').font('Helvetica')
          .text(`Ort, Datum: ${a.ort || '_______________'}, ${today}`);
        doc2.moveDown(0.8);

        // Unterschrift-Bild einbetten
        try {
          doc2.image(req.file.path, { width: 200, height: 60 });
        } catch(e) {}
        doc2.moveDown(0.3);
        doc2.moveTo(doc2.x, doc2.y).lineTo(doc2.x + 200, doc2.y).stroke('#999');
        doc2.moveDown(0.3);
        doc2.fontSize(8).fillColor('#666').text(mandantName);

        doc2.end();
        ws.on('finish', resolve);
        ws.on('error', reject);
      });

      // PNG löschen, PDF verwenden
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      const pdfStats = fs.statSync(pdfPath);

      db.prepare(`
        UPDATE documents SET
          filename=?, original_name=?, mimetype=?, filesize=?,
          status='uploaded', uploaded_at=datetime('now'), updated_at=datetime('now')
        WHERE id=?
      `).run(pdfFilename, 'Steuerberatervollmacht.pdf', 'application/pdf', pdfStats.size, docId);

      const updated = db.prepare('SELECT * FROM documents WHERE id=?').get(docId);
      return res.json({ ok: true, doc: updated });
    } catch(err) {
      console.error('[Vollmacht PDF]', err.message);
      // Fallback: normales Upload ohne PDF
    }
  }

  // Einzelne Datei → direkt speichern
  if (files.length === 1) {
    db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .run(files[0].filename, files[0].originalname, files[0].mimetype, files[0].size, docId);
    runAiCheck(docId, files[0].path, files[0].mimetype, doc.doc_name);
    return res.json({ ok: true, doc: db.prepare('SELECT * FROM documents WHERE id=?').get(docId) });
  }

  // Mehrere Dateien: wenn ein PDF dabei → erstes PDF verwenden, Rest löschen
  const pdfFile = files.find(f => f.mimetype === 'application/pdf');
  if (pdfFile) {
    files.filter(f => f !== pdfFile).forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .run(pdfFile.filename, pdfFile.originalname, 'application/pdf', pdfFile.size, docId);
    return res.json({ ok: true, doc: db.prepare('SELECT * FROM documents WHERE id=?').get(docId) });
  }

  // Mehrere Bilder → zu einem PDF zusammenfügen
  try {
    const PDFDocument = require('pdfkit');
    const mergedFilename = `${docId}_${Date.now()}_merged.pdf`;
    const mergedPath = path.join(DATA_DIR, 'uploads', String(req.userId), mergedFilename);
    await new Promise((resolve, reject) => {
      const pdm = new PDFDocument({ autoFirstPage: false, margin: 0 });
      const ws = fs.createWriteStream(mergedPath);
      pdm.pipe(ws);
      for (const f of files) {
        pdm.addPage({ size: 'A4', margin: 0 });
        try { pdm.image(f.path, 20, 20, { fit: [555, 800], align: 'center', valign: 'center' }); } catch(_) {}
      }
      pdm.end();
      ws.on('finish', resolve);
      ws.on('error', reject);
    });
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    const mergedStats = fs.statSync(mergedPath);
    const mergedOrigName = doc.doc_name.replace(/[^\wäöüÄÖÜß\s-]/g, '').trim() + '.pdf';
    db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .run(mergedFilename, mergedOrigName, 'application/pdf', mergedStats.size, docId);
    return res.json({ ok: true, doc: db.prepare('SELECT * FROM documents WHERE id=?').get(docId) });
  } catch(err) {
    console.error('[Merge PDF]', err.message);
    // Fallback: erste Datei verwenden
    files.slice(1).forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .run(files[0].filename, files[0].originalname, files[0].mimetype, files[0].size, docId);
    return res.json({ ok: true, doc: db.prepare('SELECT * FROM documents WHERE id=?').get(docId) });
  }
});

// POST /api/docs/:docId/reset — Dokument zurücksetzen (Datei löschen, Status pending)
app.post('/api/docs/:docId/reset', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.docId);
  const doc = db.prepare(`
    SELECT d.* FROM documents d
    JOIN submissions s ON d.submission_id = s.id
    WHERE d.id=? AND s.user_id=?
  `).get(docId, req.userId);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  if (doc.filename) {
    const fp = path.join(DATA_DIR, 'uploads', String(req.userId), doc.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  db.prepare(`UPDATE documents SET filename=NULL, original_name=NULL, mimetype=NULL, filesize=NULL, status='pending', uploaded_at=NULL, scanner_inbox_id=NULL WHERE id=?`).run(docId);
  if (doc.scanner_inbox_id) {
    db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(doc.scanner_inbox_id);
    db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(doc.scanner_inbox_id);
    db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(doc.scanner_inbox_id);
  }
  res.json({ ok: true });
});

// GET /api/docs/:docId/file
app.get('/api/docs/:docId/file', authMiddleware, (req, res) => {
  const docId = parseInt(req.params.docId);
  const doc = db.prepare(`
    SELECT d.* FROM documents d
    JOIN submissions s ON d.submission_id = s.id
    WHERE d.id=? AND s.user_id=?
  `).get(docId, req.userId);

  if (!doc || !doc.filename) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const filepath = path.join(DATA_DIR, 'uploads', String(req.userId), doc.filename);
  res.sendFile(filepath);
});

// ─── ROUTES: KANZLEI ─────────────────────────────────────────────────────────

// POST /api/kanzlei/login
app.post('/api/kanzlei/login', (req, res) => {
  const { email, password, password_sha256 } = req.body;
  // Neues Format: email + password_sha256
  if (email && password_sha256) {
    const kanzlei = db.prepare('SELECT * FROM kanzleien WHERE email=? AND password_sha256=? AND active=1').get(email, password_sha256);
    if (!kanzlei) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    const token = jwt.sign({ role: 'kanzlei', kanzleiId: kanzlei.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, kanzleiId: kanzlei.id, name: kanzlei.name });
  }
  // Legacy-Format: nur password — SHA-256 gegen alle Kanzleien prüfen
  if (password) {
    const crypto = require('crypto');
    const pwHash = crypto.createHash('sha256').update(password).digest('hex');
    // Erst SHA-256-Match gegen alle Kanzleien versuchen
    let kanzlei = db.prepare('SELECT * FROM kanzleien WHERE password_sha256=? AND active=1').get(pwHash);
    // Fallback: Plaintext gegen KANZLEI_PASSWORD (für bestehende Clients)
    if (!kanzlei && password === process.env.KANZLEI_PASSWORD) {
      kanzlei = db.prepare('SELECT * FROM kanzleien WHERE active=1 LIMIT 1').get();
    }
    if (!kanzlei) return res.status(401).json({ error: 'Falsches Passwort' });
    const token = jwt.sign({ role: 'kanzlei', kanzleiId: kanzlei.id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, kanzleiId: kanzlei.id, name: kanzlei.name });
  }
  res.status(400).json({ error: 'Email und Passwort erforderlich' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SUPERADMIN ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function superadminMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'superadmin') return res.status(403).json({ error: 'Kein Zugriff' });
    next();
  } catch { res.status(401).json({ error: 'Token ungültig' }); }
}

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  const adminEmail = process.env.ADMIN_EMAIL || 'info@hks-automation.de';
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminHash || email !== adminEmail || hash !== adminHash) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }
  const token = jwt.sign({ role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, role: 'superadmin' });
});

// GET /api/admin/kanzleien
app.get('/api/admin/kanzleien', superadminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT k.*,
      (SELECT COUNT(*) FROM users u WHERE u.kanzlei_id = k.id) AS mandanten_count,
      (SELECT COUNT(*) FROM documents d
        JOIN submissions s ON s.id = d.submission_id
        JOIN users u ON u.id = s.user_id
        WHERE u.kanzlei_id = k.id AND d.filename IS NOT NULL) AS dokumente_count,
      (SELECT MAX(s.submitted_at) FROM submissions s
        JOIN users u ON u.id = s.user_id
        WHERE u.kanzlei_id = k.id) AS letzter_submit
    FROM kanzleien k ORDER BY k.created_at DESC
  `).all();
  res.json(rows);
});

// POST /api/admin/kanzleien
app.post('/api/admin/kanzleien', superadminMiddleware, (req, res) => {
  const { name, email, password, plan } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, Email und Passwort erforderlich' });
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30) + '-' + Date.now().toString(36);
  try {
    const r = db.prepare('INSERT INTO kanzleien (name, email, password_sha256, slug, plan) VALUES (?,?,?,?,?)')
      .run(name, email, hash, slug, plan || 'starter');
    const kanzlei = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(r.lastInsertRowid);
    res.json({ ok: true, kanzlei });
  } catch(e) {
    res.status(400).json({ error: 'E-Mail bereits vergeben' });
  }
});

// PUT /api/admin/kanzleien/:id/toggle
app.put('/api/admin/kanzleien/:id/toggle', superadminMiddleware, (req, res) => {
  const k = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('UPDATE kanzleien SET active=? WHERE id=?').run(k.active ? 0 : 1, k.id);
  res.json({ ok: true, active: k.active ? 0 : 1 });
});

// DELETE /api/admin/kanzleien/:id
app.delete('/api/admin/kanzleien/:id', superadminMiddleware, (req, res) => {
  const k = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM kanzleien WHERE id=?').run(k.id);
  res.json({ ok: true });
});

// POST /api/admin/kanzleien/:id/send-welcome
app.post('/api/admin/kanzleien/:id/send-welcome', superadminMiddleware, async (req, res) => {
  const k = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Nicht gefunden' });
  const baseUrl = process.env.BASE_URL || 'https://app.hks-automation.de';
  const mandantenUrl = `${baseUrl}/fragebogen.html?k=${k.slug}`;
  const portalUrl = `${baseUrl}/kanzlei.html`;
  const html = buildEmailHtml({ body: `
    <p>Sehr geehrte Damen und Herren,</p>
    <p>herzlich willkommen bei <strong>H&amp;K Automation</strong>! Ihre Kanzlei-Software ist eingerichtet und einsatzbereit.</p>
    <h3 style="color:#6d7aff;margin:24px 0 10px">Ihre Zugangsdaten</h3>
    <table style="width:100%;border-collapse:collapse;font-size:.88rem">
      <tr><td style="padding:8px 0;color:#888;width:140px">Kanzlei-Portal</td><td><a href="${portalUrl}" style="color:#6d7aff;font-weight:600">${portalUrl}</a></td></tr>
      <tr><td style="padding:8px 0;color:#888">Ihre E-Mail</td><td style="font-weight:600">${escHtml(k.email)}</td></tr>
      <tr><td style="padding:8px 0;color:#888">Mandanten-Link</td><td><a href="${mandantenUrl}" style="color:#6d7aff;font-weight:600;word-break:break-all">${mandantenUrl}</a></td></tr>
    </table>
    <p style="margin-top:24px;padding:16px;background:#f5f5ff;border-radius:8px;border-left:3px solid #6d7aff">
      <strong>Mandanten-Link:</strong> Diesen Link geben Sie an Ihre Mandanten weiter. Darüber können diese sich registrieren und Dokumente einreichen.
    </p>
    <p>Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.<br><strong>H&amp;K Automation Team</strong></p>
  ` });
  try {
    await resend.emails.send({ from: FROM_EMAIL, to: k.email, subject: 'Willkommen bei H&K Automation — Ihre Zugangsdaten', html });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kanzlei/staff/login
app.post('/api/kanzlei/staff/login', (req, res) => {
  const { email, password, password_sha256 } = req.body;
  if (!email || (!password && !password_sha256)) return res.status(400).json({ error: 'Email und Passwort erforderlich' });
  const crypto = require('crypto');
  const hash = password_sha256 || crypto.createHash('sha256').update(password).digest('hex');
  const staff = db.prepare('SELECT * FROM kanzlei_staff WHERE email=? AND password_sha256=?').get(email, hash);
  if (!staff) return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  const token = jwt.sign({ role: 'staff', staffId: staff.id, staffRole: staff.role, kanzleiId: staff.kanzlei_id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, staffId: staff.id, name: staff.name, role: staff.role });
});

// GET /api/kanzlei/staff/me
// Kanzlei-Einstellungen (Stammdaten + Bankverbindung)
app.get('/api/kanzlei/settings', kanzleiMiddleware, (req, res) => {
  const s = db.prepare('SELECT * FROM kanzlei_settings WHERE kanzlei_id=?').get(req.kanzleiId);
  res.json(s || {});
});

app.post('/api/kanzlei/settings', kanzleiMiddleware, (req, res) => {
  const { name, steuernummer, ust_id, strasse, ort, telefon, email, geschaeftsfuehrer, bank_name, iban, bic, zusatz } = req.body;
  db.prepare(`INSERT INTO kanzlei_settings (kanzlei_id, name, steuernummer, ust_id, strasse, ort, telefon, email, geschaeftsfuehrer, bank_name, iban, bic, zusatz)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(kanzlei_id) DO UPDATE SET
      name=excluded.name, steuernummer=excluded.steuernummer, ust_id=excluded.ust_id,
      strasse=excluded.strasse, ort=excluded.ort, telefon=excluded.telefon, email=excluded.email,
      geschaeftsfuehrer=excluded.geschaeftsfuehrer, bank_name=excluded.bank_name,
      iban=excluded.iban, bic=excluded.bic, zusatz=excluded.zusatz`
  ).run(req.kanzleiId, name||'', steuernummer||'', ust_id||'', strasse||'', ort||'', telefon||'', email||'', geschaeftsfuehrer||'', bank_name||'', iban||'', bic||'', zusatz||'');
  res.json({ ok: true });
});

// Scanner-PIN — nur Admins dürfen lesen/schreiben
app.get('/api/kanzlei/scanner-pin', kanzleiMiddleware, (req, res) => {
  if (req.staffRole !== 'admin') return res.status(403).json({ error: 'Nur Admins' });
  const s = db.prepare('SELECT scanner_pin FROM kanzlei_settings WHERE kanzlei_id=?').get(req.kanzleiId);
  res.json({ pin: s?.scanner_pin || '1234' });
});

app.put('/api/kanzlei/scanner-pin', kanzleiMiddleware, (req, res) => {
  if (req.staffRole !== 'admin') return res.status(403).json({ error: 'Nur Admins' });
  const { pin } = req.body;
  if (!pin || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN muss 4-stellig und numerisch sein' });
  db.prepare(`INSERT INTO kanzlei_settings (kanzlei_id, scanner_pin)
    VALUES (?, ?) ON CONFLICT(kanzlei_id) DO UPDATE SET scanner_pin=excluded.scanner_pin`
  ).run(req.kanzleiId, pin);
  res.json({ ok: true });
});

app.get('/api/kanzlei/staff/me', kanzleiMiddleware, (req, res) => {
  if (!req.staffId) return res.json({ name: 'Kanzlei', role: 'admin', isMaster: true });
  const staff = db.prepare('SELECT id, name, email, role, position, phone, signature_email FROM kanzlei_staff WHERE id=?').get(req.staffId);
  res.json(staff || { name: 'Unbekannt', role: 'berater' });
});

// PUT /api/kanzlei/staff/me/signature — Signatur-Felder speichern
app.put('/api/kanzlei/staff/me/signature', kanzleiMiddleware, (req, res) => {
  if (!req.staffId) return res.status(403).json({ error: 'Nur für Staff-Accounts' });
  const { position, phone, signature_email } = req.body;
  db.prepare('UPDATE kanzlei_staff SET position=?, phone=?, signature_email=? WHERE id=?')
    .run(position || null, phone || null, signature_email || null, req.staffId);
  res.json({ ok: true });
});

// GET /api/kanzlei/staff/list
app.get('/api/kanzlei/staff/list', kanzleiMiddleware, (req, res) => {
  const list = db.prepare('SELECT id, name, email, role FROM kanzlei_staff WHERE kanzlei_id=? ORDER BY name').all(req.kanzleiId);
  res.json(list);
});

// DELETE /api/kanzlei/staff/:id
app.delete('/api/kanzlei/staff/:id', kanzleiMiddleware, (req, res) => {
  if (req.staffRole !== 'admin') return res.status(403).json({ error: 'Nur Admins' });
  const staff = db.prepare('SELECT * FROM kanzlei_staff WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!staff) return res.status(404).json({ error: 'Nicht gefunden' });
  if (staff.role === 'admin') return res.status(400).json({ error: 'Admin kann nicht entfernt werden' });
  db.prepare('DELETE FROM kanzlei_staff WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// PATCH /api/kanzlei/mandant/:userId/assign
app.patch('/api/kanzlei/mandant/:userId/assign', kanzleiMiddleware, (req, res) => {
  if (req.staffRole !== 'admin') return res.status(403).json({ error: 'Nur Admins können zuweisen' });
  const { staffId } = req.body;
  const mandant = db.prepare('SELECT name FROM users WHERE id=? AND kanzlei_id=?').get(req.params.userId, req.kanzleiId);
  db.prepare('UPDATE users SET assigned_staff_id=? WHERE id=? AND kanzlei_id=?').run(staffId || null, req.params.userId, req.kanzleiId);
  // Notification erstellen
  if (staffId && mandant) {
    const assigner = db.prepare('SELECT name FROM kanzlei_staff WHERE id=?').get(req.staffId);
    db.prepare(`INSERT INTO staff_notifications (staff_id, kanzlei_id, type, data) VALUES (?,?,?,?)`)
      .run(staffId, req.kanzleiId, 'assignment', JSON.stringify({ mandantId: parseInt(req.params.userId), mandantName: mandant.name, assignerName: assigner ? assigner.name : 'Admin' }));
  }
  res.json({ ok: true });
});

// GET /api/kanzlei/notifications
app.get('/api/kanzlei/notifications', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare(`SELECT * FROM staff_notifications WHERE staff_id=? AND kanzlei_id=? AND is_read=0 ORDER BY created_at DESC`).all(req.staffId, req.kanzleiId);
  res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data || '{}') })));
});

// POST /api/kanzlei/notifications/read
app.post('/api/kanzlei/notifications/read', kanzleiMiddleware, (req, res) => {
  db.prepare(`UPDATE staff_notifications SET is_read=1 WHERE staff_id=? AND kanzlei_id=?`).run(req.staffId, req.kanzleiId);
  res.json({ ok: true });
});

// GET /api/info — oeffentliche Server-Info (kein Auth, immer kanzlei_id=1)
app.get('/api/info', (req, res) => {
  const k = db.prepare('SELECT id, name, slug, email FROM kanzleien WHERE id=1').get();
  if (!k) return res.status(404).json({ error: 'Keine Kanzlei konfiguriert' });
  res.json({ id: k.id, name: k.name, slug: k.slug, email: k.email });
});

// GET /api/kanzlei/public/:slug — öffentliche Kanzlei-Info (kein Auth)
app.get('/api/kanzlei/public/:slug', (req, res) => {
  const k = db.prepare('SELECT id, name, slug FROM kanzleien WHERE (slug=? OR id=?) AND active=1')
    .get(req.params.slug, parseInt(req.params.slug) || 0);
  if (!k) return res.status(404).json({ error: 'Kanzlei nicht gefunden' });
  res.json(k);
});

// POST /api/admin/kanzlei — neue Kanzlei anlegen (ADMIN_SECRET geschützt)
app.post('/api/admin/kanzlei', (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Nicht autorisiert' });
  }
  const { name, email, password_sha256, slug, plan } = req.body;
  if (!name || !email || !password_sha256 || !slug) {
    return res.status(400).json({ error: 'name, email, password_sha256, slug erforderlich' });
  }
  try {
    const r = db.prepare('INSERT INTO kanzleien (name, email, password_sha256, slug, plan) VALUES (?,?,?,?,?)')
      .run(name, email, password_sha256, slug, plan || 'starter');
    res.json({ id: r.lastInsertRowid, name, email, slug });
  } catch(e) {
    res.status(400).json({ error: 'Email oder Slug bereits vergeben' });
  }
});

// GET /api/kanzlei/mandants
app.get('/api/kanzlei/mandants', kanzleiMiddleware, (req, res) => {
  // Berater sehen immer nur ihre eigenen Mandanten (server-seitig erzwungen)
  const isAdmin = req.staffRole === 'admin';
  const staffFilter = !isAdmin ? req.staffId : (req.query.filter === 'mine' && req.staffId ? req.staffId : null);
  const rows = db.prepare(`
    SELECT
      u.id AS userId, u.name, u.email,
      u.assigned_staff_id AS assignedStaffId,
      ks.name AS assignedStaffName,
      s.submitted_at AS submittedAt,
      COUNT(d.id) AS totalDocs,
      SUM(CASE WHEN d.status != 'pending' THEN 1 ELSE 0 END) AS uploadedDocs,
      SUM(CASE WHEN d.status = 'approved' THEN 1 ELSE 0 END) AS approvedDocs,
      hr.id AS pendingHandoffId,
      ks_to.name AS pendingHandoffToName,
      (SELECT COUNT(*) FROM agent_belege ab WHERE ab.user_id = u.id AND ab.datev_exportiert = 0) AS neuBelege
    FROM users u
    JOIN submissions s ON s.user_id = u.id
    LEFT JOIN documents d ON d.submission_id = s.id
    LEFT JOIN kanzlei_staff ks ON ks.id = u.assigned_staff_id
    LEFT JOIN handoff_requests hr ON hr.user_id = u.id AND hr.status = 'pending'
    LEFT JOIN kanzlei_staff ks_to ON ks_to.id = hr.to_staff_id
    WHERE u.kanzlei_id = ?
    ${staffFilter ? 'AND u.assigned_staff_id = ' + staffFilter : ''}
    GROUP BY u.id, s.id
    ORDER BY s.submitted_at DESC
  `).all(req.kanzleiId);
  // Gutachten-Stammdaten aus der letzten Submission je Mandant anhängen (für Autofüllen im Gutachten)
  const _subStmt = db.prepare('SELECT answers FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1');
  for (const row of rows) {
    try {
      const sub = _subStmt.get(row.userId);
      if (sub) { const a = JSON.parse(sub.answers || '{}'); if (a.gutachten) row.gutachten = a.gutachten; }
    } catch (e) {}
  }
  res.json(rows);
});

// POST /api/kanzlei/handoff — Übergabe-Anfrage stellen
app.post('/api/kanzlei/handoff', kanzleiMiddleware, (req, res) => {
  if (!req.staffId) return res.status(403).json({ error: 'Nur Mitarbeiter können übergeben' });
  const { userId, toStaffId, notiz } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });
  if (req.staffRole === 'admin')
    return res.status(403).json({ error: 'Admins weisen direkt zu' });
  db.prepare("DELETE FROM handoff_requests WHERE user_id=? AND status='pending'").run(userId);
  const r = db.prepare('INSERT INTO handoff_requests (from_staff_id, to_staff_id, user_id, kanzlei_id, notiz) VALUES (?,?,?,?,?)')
    .run(req.staffId, toStaffId, userId, req.kanzleiId, notiz || null);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// GET /api/kanzlei/handoff/pending — offene Anfragen an mich
app.get('/api/kanzlei/handoff/pending', kanzleiMiddleware, (req, res) => {
  if (!req.staffId) return res.json([]);
  const rows = db.prepare(`
    SELECT hr.id, hr.from_staff_id, hr.user_id,
           ks.name AS from_name, u.name AS mandant_name, hr.notiz
    FROM handoff_requests hr
    JOIN kanzlei_staff ks ON ks.id = hr.from_staff_id
    JOIN users u ON u.id = hr.user_id
    WHERE hr.to_staff_id=? AND hr.status='pending' AND hr.kanzlei_id=?
  `).all(req.staffId, req.kanzleiId);
  res.json(rows);
});

// PATCH /api/kanzlei/handoff/:id/respond — annehmen oder ablehnen
app.patch('/api/kanzlei/handoff/:id/respond', kanzleiMiddleware, (req, res) => {
  const { accept, responseNotiz } = req.body;
  const handoff = db.prepare('SELECT * FROM handoff_requests WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!handoff) return res.status(404).json({ error: 'Anfrage nicht gefunden' });
  if (handoff.to_staff_id !== req.staffId) return res.status(403).json({ error: 'Nicht berechtigt' });
  if (handoff.status !== 'pending') return res.status(400).json({ error: 'Bereits beantwortet' });
  db.prepare('UPDATE handoff_requests SET status=?, response_notiz=? WHERE id=?').run(accept ? 'accepted' : 'rejected', responseNotiz || null, handoff.id);
  if (accept) db.prepare('UPDATE users SET assigned_staff_id=? WHERE id=?').run(handoff.to_staff_id, handoff.user_id);
  res.json({ ok: true });
});

// PATCH /api/kanzlei/handoff/:id/cancel — Anfrage zurückziehen (nur Sender)
app.patch('/api/kanzlei/handoff/:id/cancel', kanzleiMiddleware, (req, res) => {
  const handoff = db.prepare('SELECT * FROM handoff_requests WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!handoff) return res.status(404).json({ error: 'Anfrage nicht gefunden' });
  if (handoff.from_staff_id !== req.staffId) return res.status(403).json({ error: 'Nicht berechtigt' });
  if (handoff.status !== 'pending') return res.status(400).json({ error: 'Bereits beantwortet' });
  db.prepare("UPDATE handoff_requests SET status='cancelled' WHERE id=?").run(handoff.id);
  res.json({ ok: true });
});

// GET /api/kanzlei/handoff/responses — Antworten auf meine gesendeten Anfragen (ungelesen)
app.get('/api/kanzlei/handoff/responses', kanzleiMiddleware, (req, res) => {
  if (!req.staffId) return res.json([]);
  const rows = db.prepare(`
    SELECT hr.id, hr.status, hr.response_notiz, hr.user_id,
           ks.name AS to_name, u.name AS mandant_name
    FROM handoff_requests hr
    JOIN kanzlei_staff ks ON ks.id = hr.to_staff_id
    JOIN users u ON u.id = hr.user_id
    WHERE hr.from_staff_id=? AND hr.status IN ('accepted','rejected')
      AND hr.kanzlei_id=? AND (hr.seen_by_sender IS NULL OR hr.seen_by_sender=0)
  `).all(req.staffId, req.kanzleiId);
  res.json(rows);
});

// PATCH /api/kanzlei/handoff/:id/mark-seen — Antwort als gelesen markieren
app.patch('/api/kanzlei/handoff/:id/mark-seen', kanzleiMiddleware, (req, res) => {
  const handoff = db.prepare('SELECT * FROM handoff_requests WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!handoff || handoff.from_staff_id !== req.staffId) return res.status(403).json({ error: 'Nicht berechtigt' });
  db.prepare('UPDATE handoff_requests SET seen_by_sender=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/kanzlei/mandant/:userId
app.get('/api/kanzlei/mandant/:userId', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id,email,name,created_at,kontenrahmen FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });

  const submission = db.prepare(
    'SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1'
  ).get(userId);

  const documents = submission
    ? db.prepare('SELECT * FROM documents WHERE submission_id=? ORDER BY is_required DESC, id ASC').all(submission.id)
    : [];

  res.json({ user, submission, documents });
});

// GET /api/kanzlei/mandant/:userId/emails — bekannte E-Mail-Adressen
app.get('/api/kanzlei/mandant/:userId/emails', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id, email FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });
  const extra = db.prepare('SELECT id, email FROM mandant_emails WHERE user_id=? AND kanzlei_id=?').all(userId, req.kanzleiId);
  res.json({ primary: user.email, extra });
});

// POST /api/kanzlei/mandant/:userId/emails — E-Mail-Adresse hinzufügen
app.post('/api/kanzlei/mandant/:userId/emails', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
  try {
    const result = db.prepare('INSERT INTO mandant_emails (kanzlei_id, user_id, email) VALUES (?,?,?)').run(req.kanzleiId, userId, email.trim().toLowerCase());
    res.json({ ok: true, id: result.lastInsertRowid, email: email.trim().toLowerCase() });
  } catch {
    res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits zugeordnet' });
  }
});

// DELETE /api/kanzlei/mandant/:userId/emails/:emailId — E-Mail-Adresse entfernen
app.delete('/api/kanzlei/mandant/:userId/emails/:emailId', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  db.prepare('DELETE FROM mandant_emails WHERE id=? AND user_id=? AND kanzlei_id=?').run(parseInt(req.params.emailId), userId, req.kanzleiId);
  res.json({ ok: true });
});

// DELETE /api/kanzlei/mandant/:userId — Mandant + alle Daten unwiderruflich löschen
app.delete('/api/kanzlei/mandant/:userId', kanzleiMiddleware, (req, res) => {
  if (req.staffRole !== 'admin') return res.status(403).json({ error: 'Nur Admins' });
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });

  const uploadsDir = path.join(DATA_DIR, 'uploads', String(userId));
  try { fs.rmSync(uploadsDir, { recursive: true, force: true }); } catch(_) {}

  const submissionIds = db.prepare('SELECT id FROM submissions WHERE user_id=?').all(userId).map(s => s.id);

  db.transaction(() => {
    submissionIds.forEach(sid => {
      db.prepare('DELETE FROM documents WHERE submission_id=?').run(sid);
      db.prepare('DELETE FROM kontoauszug_uploads WHERE submission_id=?').run(sid);
    });
    db.prepare('DELETE FROM submissions WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM agent_belege WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM agent_kontoauszuege WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM agent_kontoauszug_flags WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM mandant_emails WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM kreditoren WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM debitoren WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM email_mandant WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM handoff_requests WHERE user_id=?').run(userId);
    db.prepare('DELETE FROM users WHERE id=?').run(userId);
  })();

  res.json({ ok: true });
});

// PATCH /api/kanzlei/mandant/:userId/kontenrahmen
app.patch('/api/kanzlei/mandant/:userId/kontenrahmen', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  const { kontenrahmen } = req.body;
  if (!['skr03','skr04'].includes(kontenrahmen)) return res.status(400).json({ error: 'Ungültiger Wert' });
  db.prepare('UPDATE users SET kontenrahmen=? WHERE id=? AND kanzlei_id=?').run(kontenrahmen, userId, req.kanzleiId);
  res.json({ ok: true });
});

// PATCH /api/kanzlei/mandant/:userId/answers — Stammdaten bearbeiten
app.patch('/api/kanzlei/mandant/:userId/answers', kanzleiMiddleware, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const { answers } = req.body;
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Ungültige Daten' });
  const submission = db.prepare('SELECT id FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  if (!submission) return res.status(404).json({ error: 'Keine Einreichung gefunden' });
  db.prepare('UPDATE submissions SET answers=? WHERE id=?').run(JSON.stringify(answers), submission.id);

  // users.email aktualisieren (Agent matcht darüber) — auch leeren Wert übernehmen
  if (typeof answers.email === 'string') {
    db.prepare('UPDATE users SET email=? WHERE id=? AND kanzlei_id=?').run(answers.email || null, userId, req.kanzleiId);
  }

  // users.name nachführen
  const newName = answers.mandant_typ === 'unternehmen'
    ? (answers.firma_name || answers.kontakt_name || '').trim()
    : [answers.vorname, answers.nachname].filter(Boolean).join(' ').trim();
  if (newName) {
    db.prepare('UPDATE users SET name=? WHERE id=? AND kanzlei_id=?').run(newName, userId, req.kanzleiId);
  }

  res.json({ ok: true });
});

// ─── EMAIL-AGENT PROXY ───────────────────────────────────────────────────────

function toAgentId(name) {
  return name.toLowerCase()
    .replace(/[äöüß]/g, c => ({ ä:'ae', ö:'oe', ü:'ue', ß:'ss' }[c] || c))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const AGENT_URL = process.env.AGENT_URL || 'https://belege.hks-automation.de';
const AGENT_KEY = process.env.AGENT_API_KEY || 'hyymD-HMkr2QM6PEabQiu2uJzW1TDIWO0v4eHpFNkyc';

// GET /api/kanzlei/mandant/:userId/belege
// Liest zuerst aus hk.db (agent_belege), dann Fallback auf Python-Agent
app.get('/api/kanzlei/mandant/:userId/belege', kanzleiMiddleware, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id,name FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });

  // Aus hk.db laden
  const lokalBelege = db.prepare('SELECT * FROM agent_belege WHERE user_id=? ORDER BY erstellt_am DESC').all(userId);
  if (lokalBelege.length > 0) {
    return res.json(lokalBelege.map(b => ({ ...b, neu: !b.datev_exportiert })));
  }

  // Fallback: Python-Agent (hat eigene SQLite mit mandant_id = String(userId))
  try {
    const r = await fetch(`${AGENT_URL}/mandanten/${userId}/belege`, {
      headers: { 'X-API-Key': AGENT_KEY }
    });
    if (!r.ok) return res.json([]);
    const belege = await r.json();
    // neu direkt vom Agent übernehmen; nur Fallback auf !datev_exportiert wenn neu nicht gesetzt
    res.json(belege.map(b => ({ ...b, neu: b.neu !== undefined ? b.neu : !b.datev_exportiert })));
  } catch {
    res.json([]);
  }
});

// DELETE /api/kanzlei/beleg/:belegId
// Hetzner: schreibt direkt in hk.db (gleicher Prozess = kein Lock)
// Lokal (Electron): proxied an Hetzner server.js mit demselben JWT
app.delete('/api/kanzlei/beleg/:belegId', kanzleiMiddleware, async (req, res) => {
  const belegId = req.params.belegId;
  console.log('[Beleg DELETE] Anfrage für:', belegId);
  // Prüfen ob Beleg lokal vorhanden (Hetzner-Instanz)
  const beleg = db.prepare('SELECT * FROM agent_belege WHERE id=?').get(belegId);
  if (beleg) {
    console.log('[Beleg DELETE] Lokal gefunden, lösche lokal + Scanner');
    // Sicherheitscheck: Beleg gehört zur Kanzlei
    const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(beleg.user_id, req.kanzleiId);
    if (!user) return res.status(403).json({ error: 'Nicht berechtigt' });
    // Scanner-Eintrag mitlöschen
    const inboxLocal = db.prepare('SELECT id FROM dokument_inbox WHERE agent_beleg_id=?').get(belegId);
    if (inboxLocal) {
      db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(inboxLocal.id);
      db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(inboxLocal.id);
      db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(inboxLocal.id);
      console.log('[Beleg DELETE] Lokaler Scanner-Eintrag', inboxLocal.id, 'mitgelöscht');
    }
    // Verknüpfte Flags zurück auf offen setzen bevor Beleg gelöscht wird
    db.prepare("UPDATE agent_kontoauszug_flags SET status='offen', matched_beleg_id=NULL WHERE matched_beleg_id=?").run(belegId);
    db.prepare('DELETE FROM agent_belege WHERE id=?').run(belegId);
    [beleg.datei_pfad, beleg.vorschau_pfad].forEach(pfad => {
      if (!pfad) return;
      const shared = db.prepare('SELECT COUNT(*) as n FROM agent_belege WHERE datei_pfad=?').get(pfad);
      if (!shared || shared.n === 0) fs.unlink(pfad, () => {});
    });
    return res.json({ ok: true, geloescht: belegId });
  }
  // Lokal nicht gefunden → Agent-API mit AGENT_KEY (kein JWT-Secret-Problem)
  try {
    const r = await fetch(`${AGENT_URL}/belege/${encodeURIComponent(belegId)}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': AGENT_KEY }
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) {
      // Scanner-Eintrag mitlöschen falls vorhanden
      const inboxEntry = db.prepare('SELECT id FROM dokument_inbox WHERE agent_beleg_id=?').get(belegId);
      if (inboxEntry) {
        db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(inboxEntry.id);
        db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(inboxEntry.id);
        db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(inboxEntry.id);
        console.log('[Beleg Löschen] Scanner-Eintrag', inboxEntry.id, 'für Beleg', belegId, 'mitgelöscht');
      } else {
        console.log('[Beleg Löschen] Kein Scanner-Eintrag für Beleg', belegId, 'gefunden');
      }
    }
    res.status(r.status).json(body);
  } catch (e) {
    res.status(503).json({ error: 'Agent nicht erreichbar' });
  }
});

// GET /api/kanzlei/beleg/:belegId/datei — Beleg-Datei aus Filesystem streamen
app.get('/api/kanzlei/beleg/:belegId/datei', kanzleiMiddleware, (req, res) => {
  const belegId = req.params.belegId;
  const beleg = db.prepare('SELECT * FROM agent_belege WHERE id=?').get(belegId);
  if (!beleg) return res.status(404).json({ error: 'Beleg nicht gefunden' });
  const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(beleg.user_id, req.kanzleiId);
  if (!user) return res.status(403).json({ error: 'Nicht berechtigt' });
  if (!beleg.datei_pfad || !fs.existsSync(beleg.datei_pfad)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const ext = (beleg.original_dateiname || '').split('.').pop().toLowerCase();
  const mime = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${beleg.original_dateiname || belegId}"`);
  res.sendFile(path.resolve(beleg.datei_pfad));
});

// POST /api/kanzlei/mandant/:userId/beleg/upload — manueller Beleg-Upload, proxied an Agent
app.post('/api/kanzlei/mandant/:userId/beleg/upload', kanzleiMiddleware, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT id,name FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });
  try {
    const { pipeline } = require('stream/promises');
    const fetch = globalThis.fetch;
    // FormData als Stream forwarden
    const contentType = req.headers['content-type'];
    const agentRes = await fetch(`${AGENT_URL}/mandanten/${userId}/upload`, {
      method: 'POST',
      headers: { 'X-API-Key': AGENT_KEY, 'content-type': contentType },
      body: req,
      duplex: 'half'
    });
    const body = await agentRes.json().catch(() => ({}));
    res.status(agentRes.status).json(body);
  } catch(e) {
    res.status(502).json({ error: 'Email-Agent nicht erreichbar: ' + e.message });
  }
});

// POST /api/kanzlei/beleg/:belegId/reset-exported — Beleg wieder als neu markieren
app.post('/api/kanzlei/beleg/:belegId/reset-exported', kanzleiMiddleware, (req, res) => {
  const belegId = req.params.belegId;
  const beleg = db.prepare('SELECT * FROM agent_belege WHERE id=?').get(belegId);
  if (!beleg) return res.status(404).json({ error: 'Beleg nicht gefunden' });
  const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(beleg.user_id, req.kanzleiId);
  if (!user) return res.status(403).json({ error: 'Nicht berechtigt' });
  db.prepare('UPDATE agent_belege SET datev_exportiert=0 WHERE id=?').run(belegId);
  res.json({ ok: true });
});

// GET /api/kanzlei/belege/neu-counts — Anzahl neuer Belege pro Mandant (aus hk.db)
app.get('/api/kanzlei/belege/neu-counts', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT ab.user_id, COUNT(*) as neu
    FROM agent_belege ab
    JOIN users u ON u.id = ab.user_id
    WHERE u.kanzlei_id = ? AND ab.datev_exportiert = 0
    GROUP BY ab.user_id
  `).all(req.kanzleiId);
  const counts = {};
  rows.forEach(r => { counts[r.user_id] = r.neu; });
  res.json({ counts });
});

// ── DATEV Hilfsfunktionen ────────────────────────────────────────────────────

// Kreditorenkonto für einen Lieferanten ermitteln oder neu vergeben (ab 70001)
function datevGetOrCreateKreditor(kanzleiId, userId, name) {
  const existing = db.prepare('SELECT konto_nr FROM kreditoren WHERE kanzlei_id=? AND user_id=? AND name=?').get(kanzleiId, userId, name);
  if (existing) return existing.konto_nr;
  const max = db.prepare('SELECT MAX(konto_nr) as m FROM kreditoren WHERE kanzlei_id=? AND user_id=?').get(kanzleiId, userId);
  const nr = (max?.m || 70000) + 1;
  db.prepare('INSERT INTO kreditoren (kanzlei_id, user_id, name, konto_nr) VALUES (?,?,?,?)').run(kanzleiId, userId, name, nr);
  return nr;
}

// Debitorenkonto für einen Kunden ermitteln oder neu vergeben (ab 10001)
function datevGetOrCreateDebitor(kanzleiId, userId, name) {
  const existing = db.prepare('SELECT konto_nr FROM debitoren WHERE kanzlei_id=? AND user_id=? AND name=?').get(kanzleiId, userId, name);
  if (existing) return existing.konto_nr;
  const max = db.prepare('SELECT MAX(konto_nr) as m FROM debitoren WHERE kanzlei_id=? AND user_id=?').get(kanzleiId, userId);
  const nr = (max?.m || 10000) + 1;
  db.prepare('INSERT INTO debitoren (kanzlei_id, user_id, name, konto_nr) VALUES (?,?,?,?)').run(kanzleiId, userId, name, nr);
  return nr;
}

// Aufwandskonto aus SKR und Beschreibungstext ableiten
function datevAufwandskonto(kontenrahmen, text) {
  const t = (text || '').toLowerCase();
  const skr04 = (kontenrahmen || '').toLowerCase() === 'skr04';
  const map = [
    { keys: ['sanacorp','pharma','arzneimittel','medikament','apotheke'],  skr03: 4980, skr04: 6300 },
    { keys: ['versicherung','pkv','kv ','signal iduna','krankenversicherung','haftpflicht'], skr03: 4360, skr04: 6310 },
    { keys: ['fortbildung','kurs','seminar','schulung','weiterbildung'],   skr03: 4930, skr04: 6815 },
    { keys: ['büro','büromaterial','papier','druckerpapier','toner'],      skr03: 4930, skr04: 6815 },
    { keys: ['kfz','auto','fahrzeug','benzin','kraftstoff','tankstelle'],  skr03: 4530, skr04: 6520 },
    { keys: ['miete','raumkosten','nebenkosten'],                          skr03: 4210, skr04: 6310 },
    { keys: ['steuerberater','steuerberatung','h&k','hks'],                skr03: 4830, skr04: 6825 },
  ];
  for (const entry of map) {
    if (entry.keys.some(k => t.includes(k))) return skr04 ? entry.skr04 : entry.skr03;
  }
  return skr04 ? 6300 : 4980;
}

// Erlöskonto für Ausgangsrechnungen
function datevErloeskonto(kontenrahmen, mwstRate) {
  const skr04 = (kontenrahmen || '').toLowerCase() === 'skr04';
  if (skr04) return mwstRate === 7 ? 4300 : 4400;
  return mwstRate === 7 ? 8300 : 8400;
}

// Kassekonto (Quittungen bar bezahlt)
function datevKassekonto(kontenrahmen) {
  return (kontenrahmen || '').toLowerCase() === 'skr04' ? 1600 : 1000;
}

// BU-Schlüssel (Steuerschlüssel) aus MwSt-Satz
function datevBuSchluessel(mwstRate) {
  if (!mwstRate || mwstRate === 0) return '';
  if (mwstRate === 7) return '8';
  return '9'; // 19%
}

// Belegdatum als DDMMYYYY für EXTF
function datevFormatDatum(datum) {
  if (!datum) return '';
  // Deutsches Format DD.MM.YYYY
  const de = datum.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return de[1] + de[2] + de[3];
  // ISO Format YYYY-MM-DD
  const iso = datum.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + iso[2] + iso[1];
  return '';
}

// Datum als YYYYMMDD für EXTF-Header
function datevHeaderDatum(datum) {
  if (!datum) return '';
  const d = new Date(datum.length <= 7 ? datum + '-01' : datum);
  if (isNaN(d)) return '';
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}

// EXTF-Timestamp (17 Zeichen: YYYYMMDDHHmmss000)
function datevTimestamp() {
  const n = new Date();
  const p = x => String(x).padStart(2,'0');
  return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}000`;
}

// MwSt-Satz aus Beleg-Feldern ableiten (brutto/netto/mwst können leer sein)
function datevMwstRate(b) {
  if (b.mwst && b.netto && b.netto > 0) {
    const rate = Math.round((b.mwst / b.netto) * 100);
    if (rate === 7 || rate === 19) return rate;
  }
  if (b.mwst && b.mwst > 0 && b.mwst < 1) return Math.round(b.mwst * 100); // gespeichert als 0.19
  return 19; // Standard
}

// ── DATEV Buchungsstapel Export (Eingangs-/Ausgangsrechnungen + Quittungen) ──
app.get('/api/kanzlei/mandant/:mandantId/datev-export', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.mandantId);
  const user = db.prepare('SELECT id, name, kontenrahmen, datev_berater_nr, datev_mandant_nr FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });

  const belege = db.prepare(`
    SELECT * FROM agent_belege
    WHERE user_id=? AND kanzlei_id=?
      AND typ IN ('Eingangsrechnung','Ausgangsrechnung','Quittung','Sonstige')
      AND datev_exportiert=0
    ORDER BY datum ASC, erstellt_am ASC
  `).all(userId, req.kanzleiId);

  if (belege.length === 0) return res.status(404).json({ error: 'Keine neuen Belege vorhanden – alles bereits exportiert.' });

  const skr = (user.kontenrahmen || 'skr03').toLowerCase();
  const beraterNr = user.datev_berater_nr || 99999;
  const mandantNr = user.datev_mandant_nr || userId;
  const ts = datevTimestamp();
  const now = new Date();
  const wjBeginn = `${now.getFullYear()}0101`;

  // Zeitraum aus Belegdaten ableiten
  const daten = belege.map(b => b.datum).filter(Boolean).sort();
  const vonRaw = daten[0] || `${now.getFullYear()}-01-01`;
  const bisRaw = daten[daten.length - 1] || `${now.getFullYear()}-12-31`;
  const datumVon = datevHeaderDatum(vonRaw) || wjBeginn;
  const datumBis = datevHeaderDatum(bisRaw) || `${now.getFullYear()}1231`;

  const header = `"EXTF";700;21;"Buchungsstapel";9;${ts};;"H&K Automation";;${beraterNr};${mandantNr};${wjBeginn};4;${datumVon};${datumBis};"H&K Export";0;1;"EUR";"";"";"";"";"";"";"";""`;
  const cols   = 'Umsatz;S/H;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto;BU-Schluessel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext';

  const rows = [];
  for (const b of belege) {
    const brutto     = b.brutto || 0;
    const umsatz     = brutto.toFixed(2).replace('.', ',');
    const mwstRate   = datevMwstRate(b);
    const buKey      = datevBuSchluessel(mwstRate);
    const belegdatum = datevFormatDatum(b.datum);
    const rechnungsnr = (b.rechnungsnummer || b.id).substring(0, 36);
    const kontext    = `${b.aussteller || b.absender || b.empfaenger || ''} ${b.buchungskategorie || ''}`;
    const buchungstext = (b.aussteller || b.absender || b.empfaenger || 'Beleg').substring(0, 60).replace(/;/g, ',');

    let konto, gegenkonto, sh;
    if (b.typ === 'Eingangsrechnung') {
      const name = (b.aussteller || b.absender || 'Unbekannt').substring(0, 60);
      konto      = datevGetOrCreateKreditor(req.kanzleiId, userId, name);
      gegenkonto = datevAufwandskonto(skr, kontext);
      sh         = 'H';
    } else if (b.typ === 'Ausgangsrechnung') {
      const name = (b.empfaenger || b.aussteller || 'Unbekannt').substring(0, 60);
      konto      = datevGetOrCreateDebitor(req.kanzleiId, userId, name);
      gegenkonto = datevErloeskonto(skr, mwstRate);
      sh         = 'S';
    } else {
      // Quittung / Sonstige → Barkasse
      konto      = datevKassekonto(skr);
      gegenkonto = datevAufwandskonto(skr, kontext);
      sh         = 'H';
    }

    rows.push(`${umsatz};${sh};EUR;;;;${konto};${gegenkonto};${buKey};${belegdatum};${rechnungsnr};;0;${buchungstext}`);
  }

  const csv = [header, cols, ...rows].join('\r\n') + '\r\n';

  // Alle exportierten Belege markieren
  const ids = belege.map(b => b.id);
  db.prepare(`UPDATE agent_belege SET datev_exportiert=1 WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);

  const buf = Buffer.from(csv, 'latin1');
  const dateiname = `DATEV_Buchungsstapel_${userId}_${now.toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=windows-1252');
  res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
  res.send(buf);
});

// ── DATEV Stammdaten Export (Kreditoren + Debitoren des Mandanten) ────────────
app.get('/api/kanzlei/mandant/:mandantId/datev-stammdaten', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.mandantId);
  const user = db.prepare('SELECT id, name, kontenrahmen, datev_berater_nr, datev_mandant_nr FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });

  const kreditoren = db.prepare('SELECT name, konto_nr FROM kreditoren WHERE kanzlei_id=? AND user_id=? ORDER BY konto_nr').all(req.kanzleiId, userId);
  const debitoren  = db.prepare('SELECT name, konto_nr FROM debitoren  WHERE kanzlei_id=? AND user_id=? ORDER BY konto_nr').all(req.kanzleiId, userId);

  const ts = datevTimestamp();
  const beraterNr = user.datev_berater_nr || 99999;
  const mandantNr = user.datev_mandant_nr || userId;

  const header = `"EXTF";700;16;"Debitoren/Kreditoren";5;${ts};;"H&K Automation";;${beraterNr};${mandantNr};${ts.slice(0,8)};;4;;;;;;;"EUR";;;`;
  const cols   = 'Konto;Name (Adressattyp Unternehmen);Adressattyp';

  const rows = [];
  for (const k of kreditoren) rows.push(`${k.konto_nr};"${k.name.replace(/"/g,'""')}";2`);
  for (const d of debitoren)  rows.push(`${d.konto_nr};"${d.name.replace(/"/g,'""')}";2`);

  if (rows.length === 0) return res.status(404).json({ error: 'Noch keine Kreditoren oder Debitoren vorhanden. Bitte zuerst Buchungsstapel exportieren.' });

  const csv = [header, cols, ...rows].join('\r\n') + '\r\n';
  const buf = Buffer.from(csv, 'latin1');
  const dateiname = `DATEV_Stammdaten_${userId}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=windows-1252');
  res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
  res.send(buf);
});

// ── DATEV Buchungsstapel (alias, gleicher Endpoint) ──────────────────────────
app.get('/api/kanzlei/mandant/:userId/datev-buchungsstapel', kanzleiMiddleware, (req, res) => {
  req.params.mandantId = req.params.userId;
  res.redirect(307, `/api/kanzlei/mandant/${req.params.userId}/datev-export`);
});

// GET /api/kanzlei/all-documents
app.get('/api/kanzlei/all-documents', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, u.name AS mandant_name, u.id AS user_id
    FROM documents d
    JOIN submissions s ON s.id = d.submission_id
    JOIN users u ON u.id = s.user_id
    WHERE u.kanzlei_id = ?
    ORDER BY s.submitted_at DESC, d.is_required DESC, d.id ASC
  `).all(req.kanzleiId);
  res.json(rows);
});

// ─── KONTOAUSZÜGE & BELEG-FLAGS ──────────────────────────────────────────────

// POST /api/kanzlei/mandant/:userId/kontoauszug/upload
app.post('/api/kanzlei/mandant/:userId/kontoauszug/upload', kanzleiMiddleware, kontoUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Datei fehlt oder Format nicht unterstützt (PDF, JPG, PNG erlaubt)' });
  const userId = parseInt(req.params.userId);
  const { category } = req.body; // 'kontoauszug' | 'kreditkarte' | 'online_zahlung'
  const submission = db.prepare('SELECT id FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  if (!submission) return res.status(404).json({ error: 'Keine Einreichung gefunden' });
  const row = db.prepare(`
    INSERT INTO kontoauszug_uploads (submission_id, category, filename, original_name, filesize, mimetype, analysis_status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(submission.id, category, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype);
  res.json({ id: row.lastInsertRowid, status: 'pending' });
});

// GET /api/kanzlei/kontoauszug/:uploadId/file
app.get('/api/kanzlei/kontoauszug/:uploadId/file', kanzleiMiddleware, (req, res) => {
  const upload = db.prepare('SELECT * FROM kontoauszug_uploads WHERE id=?').get(req.params.uploadId);
  if (!upload) return res.status(404).json({ error: 'Nicht gefunden' });
  const filePath = path.join(DATA_DIR, 'konto_uploads', upload.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.setHeader('Content-Disposition', `inline; filename="${upload.original_name}"`);
  res.setHeader('Content-Type', upload.mimetype || 'application/pdf');
  res.sendFile(filePath);
});

// GET /api/kanzlei/mandant/:userId/kontoauszuege
app.get('/api/kanzlei/mandant/:userId/kontoauszuege', kanzleiMiddleware, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const submission = db.prepare('SELECT id FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  let uploads = [];
  let flags = [];
  if (submission) {
    uploads = db.prepare(`
      SELECT ku.*,
        (SELECT COUNT(*) FROM beleg_flags bf
         WHERE bf.upload_id = ku.id AND bf.status IN ('open','contacted')) AS open_flags
      FROM kontoauszug_uploads ku
      WHERE ku.submission_id = ?
      ORDER BY ku.uploaded_at DESC
    `).all(submission.id).map(ku => {
      // Summary dynamisch mit aktuellem Flag-Count überschreiben
      if (ku.analysis_result) {
        try {
          const parsed = JSON.parse(ku.analysis_result);
          let base = (parsed.summary || '')
            .replace(/\s*·?\s*\d+\s*Transaktion(?:en)?\s+ohne\s+Beleg[\s\S]*/i, '')
            .replace(/\s*·?\s*\d+\s+von\s+\d+\s+(?:Transaktion(?:en)?|Belege?)[\s\S]*/i, '')
            .replace(/\s*·?\s*\d+\s+fehlende?\s+Belege?[\s\S]*/i, '')
            .replace(/\s*·?\s*Es\s+fehlen[\s\S]*/i, '')
            .replace(/\s*·?\s*Belege?\s+(?:fehlen|fehlt)[\s\S]*/i, '')
            .trim();
          if (ku.open_flags > 0) base += ` · ${ku.open_flags} Transaktion${ku.open_flags === 1 ? '' : 'en'} ohne Beleg gefunden`;
          parsed.summary = base;
          ku.analysis_result = JSON.stringify(parsed);
        } catch(e) {}
      }
      return ku;
    });
    flags = db.prepare('SELECT * FROM beleg_flags WHERE submission_id=? ORDER BY created_at DESC').all(submission.id);
  }
  // Auch vom Remote-Agent fetchen (Kontoauszüge + Flags)
  try {
    const [kontoRes, flagRes] = await Promise.all([
      fetch(AGENT_URL + '/mandanten/' + userId + '/kontoauszuege', { headers: { 'X-API-Key': AGENT_KEY } }),
      fetch(AGENT_URL + '/mandanten/' + userId + '/kontoauszug-flags', { headers: { 'X-API-Key': AGENT_KEY } })
    ]);
    if (kontoRes.ok && flagRes.ok) {
      const agentKontos = await kontoRes.json();
      const agentFlags = await flagRes.json();
      // Offene Flags pro Kontoauszug zählen
      const offeneProKonto = {};
      agentFlags.forEach(f => {
        if (f.status === 'offen' || f.status === 'kontaktiert') {
          offeneProKonto[f.kontoauszug_id] = (offeneProKonto[f.kontoauszug_id] || 0) + 1;
        }
      });
      const mapped = agentKontos.map(k => {
        const offene = offeneProKonto[k.id] || 0;
        const hatFehler = (k.analyse_zusammenfassung || '').startsWith('FEHLER:');
        // Nur den Transaktionen/Zeitraum-Teil aus Claude's Zusammenfassung nehmen, Rest weglassen
        const rohText = k.analyse_zusammenfassung || '';
        const zeitraumTeil = rohText.split(',')[0].trim(); // "X Transaktionen vom TT.MM. bis TT.MM."
        let summary = '';
        if (hatFehler) {
          summary = rohText;
        } else if (zeitraumTeil) {
          summary = offene > 0
            ? `${zeitraumTeil} · ${offene} Transaktion${offene === 1 ? '' : 'en'} ohne Beleg`
            : zeitraumTeil;
        }
        return {
          id: 'agent_' + k.id,
          category: k.kategorie || 'kontoauszug',
          original_name: k.original_dateiname,
          filesize: 0,
          uploaded_at: k.erstellt_am,
          analysis_status: hatFehler ? 'error' : (k.analysiert_am ? 'done' : 'pending'),
          analysis_result: !hatFehler && summary ? JSON.stringify({ summary }) : null,
          has_error: hatFehler,
          source: 'agent'
        };
      });
      uploads = [...uploads, ...mapped];
      // Flags mappen (agentFlags bereits geparst)
      const statusMap = { offen: 'open', kontaktiert: 'contacted', erledigt: 'resolved', ignoriert: 'dismissed' };
      const mappedFlags = agentFlags.map(f => ({
        id: 'agent_' + f.id,
        status: statusMap[f.status] || f.status,
        beleg_category: (f.beleg_kategorie === 'sonstiges' ? 'intern' : f.beleg_kategorie) || 'eingang',
        merchant: f.merchant,
        amount: f.betrag,
        transaction_date: f.datum_geschaetzt ? '' : (f.datum || ''),
        description: f.beschreibung,
        source: 'agent'
      }));
      flags = [...flags, ...mappedFlags];
    }
  } catch(e) {}
  res.json({ uploads, flags });
});

// GET /api/kanzlei/agent-kontoauszug/:id/file
app.get('/api/kanzlei/agent-kontoauszug/:id/file', kanzleiMiddleware, async (req, res) => {
  try {
    const r = await fetch(AGENT_URL + '/kontoauszuege/' + encodeURIComponent(req.params.id) + '/datei', {
      headers: { 'X-API-Key': AGENT_KEY }
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Nicht gefunden' });
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const cd = r.headers.get('content-disposition') || '';
    res.setHeader('Content-Type', ct);
    if (cd) res.setHeader('Content-Disposition', cd);
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch { res.status(502).json({ error: 'Agent nicht erreichbar' }); }
});

// DELETE /api/kanzlei/agent-kontoauszug/:id
app.delete('/api/kanzlei/agent-kontoauszug/:id', kanzleiMiddleware, async (req, res) => {
  const kontoId = req.params.id;
  try {
    const r = await fetch(AGENT_URL + '/kontoauszuege/' + encodeURIComponent(kontoId), {
      method: 'DELETE', headers: { 'X-API-Key': AGENT_KEY }
    });
    if (r.ok) {
      // Scanner-Eintrag mitlöschen falls vorhanden
      const inboxEntry = db.prepare('SELECT id FROM dokument_inbox WHERE agent_beleg_id=?').get(kontoId);
      if (inboxEntry) {
        db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(inboxEntry.id);
        db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(inboxEntry.id);
        db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(inboxEntry.id);
        console.log('[Konto Löschen] Scanner-Eintrag', inboxEntry.id, 'für Kontoauszug', kontoId, 'mitgelöscht');
      }
      return res.json({ ok: true });
    }
    return res.status(r.status).json({ error: 'Löschen fehlgeschlagen' });
  } catch { res.status(502).json({ error: 'Agent nicht erreichbar' }); }
});

// DELETE /api/kanzlei/kontoauszug/:uploadId
app.delete('/api/kanzlei/kontoauszug/:uploadId', kanzleiMiddleware, (req, res) => {
  const uploadId = parseInt(req.params.uploadId);
  const upload = db.prepare('SELECT * FROM kontoauszug_uploads WHERE id=?').get(uploadId);
  if (!upload) return res.status(404).json({ error: 'Nicht gefunden' });
  // Sicherheitscheck: Kontoauszug gehört zur Kanzlei des Nutzers
  const submission = db.prepare('SELECT id FROM submissions WHERE id=? AND kanzlei_id=?').get(upload.submission_id, req.kanzleiId);
  if (!submission) return res.status(403).json({ error: 'Nicht berechtigt' });
  db.prepare('DELETE FROM beleg_flags WHERE upload_id=?').run(uploadId);
  db.prepare('DELETE FROM beleg_flags WHERE submission_id=? AND upload_id IS NULL').run(upload.submission_id);
  db.prepare('DELETE FROM kontoauszug_uploads WHERE id=?').run(uploadId);
  const filePath = path.join(DATA_DIR, 'konto_uploads', upload.filename);
  db.prepare('DELETE FROM dokument_inbox WHERE dateipfad=?').run(filePath);
  fs.unlink(filePath, () => {});
  res.json({ ok: true });
});

// POST /api/kanzlei/kontoauszug/:uploadId/analyze
// Leitet die Datei direkt an den Agent weiter — einheitlicher Code-Pfad für E-Mail + manuellen Upload
app.post('/api/kanzlei/kontoauszug/:uploadId/analyze', kanzleiMiddleware, async (req, res) => {
  const uploadId = parseInt(req.params.uploadId);
  const upload = db.prepare('SELECT * FROM kontoauszug_uploads WHERE id=?').get(uploadId);
  if (!upload) return res.status(404).json({ error: 'Upload nicht gefunden' });

  const submission = db.prepare('SELECT * FROM submissions WHERE id=?').get(upload.submission_id);
  const userId = submission?.user_id;
  if (!userId) return res.status(400).json({ error: 'Mandant nicht gefunden' });

  db.prepare("UPDATE kontoauszug_uploads SET analysis_status='analyzing' WHERE id=?").run(uploadId);

  const filePath = path.join(DATA_DIR, 'konto_uploads', upload.filename);
  try {
    // Datei als FormData an Agent-API senden (identisch zu Beleg-Upload-Pfad)
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: upload.mimetype || 'application/octet-stream' });
    const fd = new FormData();
    fd.append('datei', blob, upload.original_name || upload.filename);

    const agentRes = await fetch(`${AGENT_URL}/mandanten/${userId}/upload`, {
      method: 'POST',
      headers: { 'X-API-Key': AGENT_KEY },
      body: fd
    });
    const agentBody = await agentRes.json().catch(() => ({}));

    if (!agentRes.ok || !agentBody.ok) {
      db.prepare("UPDATE kontoauszug_uploads SET analysis_status='error' WHERE id=?").run(uploadId);
      return res.status(500).json({ error: agentBody.detail || 'Agent-Analyse fehlgeschlagen' });
    }

    // Agent hat Kontoauszug übernommen → lokalen Eintrag bereinigen
    db.prepare('DELETE FROM beleg_flags WHERE upload_id=?').run(uploadId);
    db.prepare('DELETE FROM kontoauszug_uploads WHERE id=?').run(uploadId);
    fs.unlink(filePath, () => {});

    res.json({ status: 'done', agent_id: agentBody.id, typ: agentBody.typ });
  } catch(err) {
    db.prepare("UPDATE kontoauszug_uploads SET analysis_status='error' WHERE id=?").run(uploadId);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/kanzlei/beleg-flag/:id
app.patch('/api/kanzlei/beleg-flag/:id', kanzleiMiddleware, async (req, res) => {
  const { status } = req.body;
  const flagId = req.params.id;
  // Agent-Flag: ID beginnt mit "agent_"
  if (String(flagId).startsWith('agent_')) {
    const agentId = flagId.slice(6);
    const statusMap = { resolved: 'erledigt', dismissed: 'ignoriert', open: 'offen', contacted: 'kontaktiert' };
    try {
      const r = await fetch(AGENT_URL + '/kontoauszug-flags/' + encodeURIComponent(agentId), {
        method: 'PATCH', headers: { 'X-API-Key': AGENT_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusMap[status] || status })
      });
      if (r.ok) return res.json({ ok: true });
      return res.status(r.status).json({ error: 'Flag-Update fehlgeschlagen' });
    } catch { return res.status(502).json({ error: 'Agent nicht erreichbar' }); }
  }
  db.prepare("UPDATE beleg_flags SET status=? WHERE id=?").run(status, flagId);
  res.json({ ok: true });
});

// Hilfsfunktion: manuelle Anhänge aus base64 in Resend-Format konvertieren
function _parseManuelleAnhaenge(arr) {
  if (!Array.isArray(arr) || !arr.length) return [];
  return arr.map(a => ({ filename: a.filename, content: Buffer.from(a.content, 'base64') }))
            .filter(a => a.filename && a.content.length);
}

// POST /api/kanzlei/mandant/:userId/beleg-anfrage
app.post('/api/kanzlei/mandant/:userId/beleg-anfrage', kanzleiMiddleware, async (req, res) => {
  const { flagIds, recipientEmail, recipientName, emailText, manuelleAnhaenge } = req.body;
  if (!recipientEmail || !emailText || !flagIds?.length) {
    return res.status(400).json({ error: 'Fehlende Pflichtfelder' });
  }
  try {
    const localIds = flagIds.filter(id => !String(id).startsWith('agent_'));
    const agentIds = flagIds.filter(id => String(id).startsWith('agent_'));

    if (localIds.length) {
      const placeholders = localIds.map(() => '?').join(',');
      db.prepare(`UPDATE beleg_flags SET status='contacted' WHERE id IN (${placeholders})`).run(...localIds);
    }
    for (const agentId of agentIds) {
      const numId = agentId.slice(6);
      fetch(AGENT_URL + '/kontoauszug-flags/' + encodeURIComponent(numId), {
        method: 'PATCH', headers: { 'X-API-Key': AGENT_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'kontaktiert' })
      }).catch(() => {});
    }

    const subjectLine = emailText.match(/^Betreff:\s*(.+)/m);
    const subject = subjectLine ? subjectLine[1].trim() : 'Fehlende Belege – Bitte um Einreichung';
    const bodyText = emailText.replace(/^Betreff:[^\n]*\n\n?/, '');
    const htmlBody = bodyText
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');

    const _staff1 = getStaffForEmail(req.staffId);
    const _anhaenge1 = _parseManuelleAnhaenge(manuelleAnhaenge);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipientEmail,
      subject,
      html: buildEmailHtml({ body: htmlBody, staff: _staff1 }),
      ...(_anhaenge1.length && { attachments: _anhaenge1 })
    });
    res.json({ ok: true });
  } catch(err) {
    console.error('Beleganfrage-Mail Fehler:', err.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
  }
});

// POST /api/kanzlei/mandant/:userId/konto-anfrage
app.post('/api/kanzlei/mandant/:userId/konto-anfrage', kanzleiMiddleware, async (req, res) => {
  const { recipientEmail, recipientName, emailText, agentIds, manuelleAnhaenge } = req.body;
  if (!recipientEmail || !emailText) return res.status(400).json({ error: 'Fehlende Pflichtfelder' });
  try {
    const subjectLine = emailText.match(/^Betreff:\s*(.+)/m);
    const subject = subjectLine ? subjectLine[1].trim() : 'Kontoauszug nicht lesbar – Bitte neu einreichen';
    const bodyText = emailText.replace(/^Betreff:[^\n]*\n\n?/, '');
    const htmlBody = bodyText
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
    const _staff1 = getStaffForEmail(req.staffId);
    // Auto-Anhänge: fehlerhafte Kontoauszüge vom Server
    const attachments = [];
    if (Array.isArray(agentIds) && agentIds.length) {
      for (const id of agentIds) {
        try {
          const row = db.prepare('SELECT datei_pfad, original_dateiname FROM agent_kontoauszuege WHERE id = ?').get(id);
          if (row && row.datei_pfad) {
            const content = require('fs').readFileSync(row.datei_pfad);
            attachments.push({ filename: row.original_dateiname || 'kontoauszug', content });
          }
        } catch(e) { console.error('Anhang Fehler für', id, e.message); }
      }
    }
    // Manuelle Anhänge vom Steuerberater
    attachments.push(..._parseManuelleAnhaenge(manuelleAnhaenge));
    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipientEmail,
      subject,
      html: buildEmailHtml({ body: htmlBody, staff: _staff1 }),
      ...(attachments.length && { attachments })
    });
    res.json({ ok: true });
  } catch(err) {
    console.error('Konto-Anfrage-Mail Fehler:', err.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
  }
});

// POST /api/kanzlei/mandant/:userId/dok-anfrage
app.post('/api/kanzlei/mandant/:userId/dok-anfrage', kanzleiMiddleware, async (req, res) => {
  const { recipientEmail, recipientName, emailText } = req.body;
  if (!recipientEmail || !emailText) return res.status(400).json({ error: 'Fehlende Pflichtfelder' });
  try {
    const subjectLine = emailText.match(/^Betreff:\s*(.+)/m);
    const subject = subjectLine ? subjectLine[1].trim() : 'Unterlagen für Ihre Steuerakte';
    const bodyText = emailText.replace(/^Betreff:[^\n]*\n\n?/, '');
    const htmlBody = bodyText
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\n/g,'<br>');
    const _staff1 = getStaffForEmail(req.staffId);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipientEmail,
      subject,
      html: buildEmailHtml({ body: htmlBody, staff: _staff1 })
    });
    res.json({ ok: true });
  } catch(err) {
    console.error('Dok-Anfrage-Mail Fehler:', err.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
  }
});

// GET /api/kanzlei/doc/:docId/file
app.get('/api/kanzlei/doc/:docId/file', kanzleiMiddleware, (req, res) => {
  const docId = parseInt(req.params.docId);
  const doc = db.prepare(`
    SELECT d.*, s.user_id FROM documents d
    JOIN submissions s ON d.submission_id = s.id
    JOIN users u ON u.id = s.user_id
    WHERE d.id=? AND u.kanzlei_id=?
  `).get(docId, req.kanzleiId);

  if (!doc || !doc.filename) return res.status(404).json({ error: 'Datei nicht gefunden' });
  const filepath = path.join(DATA_DIR, 'uploads', String(doc.user_id), doc.filename);
  res.sendFile(filepath);
});

// DELETE /api/kanzlei/doc/:docId
app.delete('/api/kanzlei/doc/:docId', kanzleiMiddleware, (req, res) => {
  const docId = parseInt(req.params.docId);
  const doc = db.prepare(`
    SELECT d.*, s.user_id FROM documents d
    JOIN submissions s ON d.submission_id = s.id
    JOIN users u ON u.id = s.user_id
    WHERE d.id=? AND u.kanzlei_id=?
  `).get(docId, req.kanzleiId);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  if (doc.filename) {
    const filepath = path.join(DATA_DIR, 'uploads', String(doc.user_id), doc.filename);
    fs.unlink(filepath, () => {});
  }
  db.prepare('UPDATE documents SET filename=NULL, original_name=NULL, filesize=NULL, mimetype=NULL, status=?, scanner_inbox_id=NULL WHERE id=?').run('pending', docId);
  if (doc.scanner_inbox_id) {
    db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(doc.scanner_inbox_id);
    db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(doc.scanner_inbox_id);
    db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(doc.scanner_inbox_id);
  }
  res.json({ ok: true });
});

// POST /api/kanzlei/mandant/:userId/doc/upload — Kanzlei lädt manuell ein extra Dokument hoch
const kanzleiDocStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'uploads', req.params.userId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'kanzlei_' + Date.now() + ext);
  }
});
const kanzleiDocUpload = multer({ storage: kanzleiDocStorage, limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/api/kanzlei/mandant/:userId/doc/upload', kanzleiMiddleware, kanzleiDocUpload.single('file'), async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });
  const submission = db.prepare('SELECT id FROM submissions WHERE user_id=?').get(userId);
  if (!submission) return res.status(404).json({ error: 'Kein Fragebogen vorhanden' });

  // Offene Slots für diesen Mandanten laden
  const pendingSlots = db.prepare(
    "SELECT id, doc_name FROM documents WHERE submission_id=? AND status='pending' AND filename IS NULL AND doc_key != 'vollmacht'"
  ).all(submission.id);

  let matchedSlotId = null;

  // KI: passt das Dokument zu einem offenen Slot?
  if (pendingSlots.length > 0) {
    try {
      let content;
      const { mimetype, path: filepath } = req.file;
      if (mimetype === 'application/pdf') {
        const buf = fs.readFileSync(filepath);
        const parsed = await pdfParse(buf);
        content = [{ type: 'text', text: 'PDF-Inhalt:\n' + parsed.text.slice(0, 2000) }];
      } else {
        const b64 = fs.readFileSync(filepath).toString('base64');
        const mt = mimetype === 'image/png' ? 'image/png' : mimetype === 'image/webp' ? 'image/webp' : 'image/jpeg';
        content = [{ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } }];
      }
      const slotList = pendingSlots.map((s, i) => `${i}: ${s.doc_name}`).join('\n');
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        messages: [{ role: 'user', content: [
          ...content,
          { type: 'text', text: `Welchem der folgenden ausstehenden Dokumenten-Slots entspricht dieses Dokument am besten?\n\n${slotList}\n\nAntworte NUR als JSON: {"slot_index": <Zahl oder -1 wenn keiner passt>, "confidence": <0.0-1.0>}` }
        ]}]
      });
      const m = msg.content[0].text.match(/\{[\s\S]*\}/);
      if (m) {
        const r = JSON.parse(m[0]);
        if (r.confidence >= 0.7 && r.slot_index >= 0 && pendingSlots[r.slot_index]) {
          matchedSlotId = pendingSlots[r.slot_index].id;
        }
      }
    } catch (e) { console.error('[SlotMatch]', e.message); }
  }

  if (matchedSlotId) {
    // Passenden Slot befüllen
    db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now') WHERE id=?`)
      .run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, matchedSlotId);
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(matchedSlotId);
    runAiCheck(matchedSlotId, req.file.path, req.file.mimetype, doc.doc_name);
    return res.json({ ok: true, doc, matched: true });
  }

  // Kein passender Slot → neue Extra-Zeile
  const docName = req.file.originalname.replace(/\.[^.]+$/, '');
  const result = db.prepare(
    "INSERT INTO documents (submission_id, doc_key, doc_name, is_required, status, filename, original_name, mimetype, filesize, uploaded_at, updated_at) VALUES (?, ?, ?, 0, 'uploaded', ?, ?, ?, ?, datetime('now'), datetime('now'))"
  ).run(submission.id, 'extra_' + Date.now(), docName, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size);
  const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(result.lastInsertRowid);
  runAiCheck(doc.id, req.file.path, req.file.mimetype, doc.doc_name);
  res.json({ ok: true, doc, matched: false });
});


// PUT /api/kanzlei/doc/:docId/status
app.put('/api/kanzlei/doc/:docId/status', kanzleiMiddleware, (req, res) => {
  const docId = parseInt(req.params.docId);
  const { status, note } = req.body;
  const allowed = ['approved', 'rejected', 'nicht_relevant', 'pending'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });

  const ownership = db.prepare(`
    SELECT d.id FROM documents d
    JOIN submissions s ON d.submission_id = s.id
    JOIN users u ON u.id = s.user_id
    WHERE d.id=? AND u.kanzlei_id=?
  `).get(docId, req.kanzleiId);
  if (!ownership) return res.status(404).json({ error: 'Dokument nicht gefunden' });

  db.prepare(`
    UPDATE documents SET status=?, kanzlei_note=?, updated_at=datetime('now') WHERE id=?
  `).run(status, note || null, docId);

  const updated = db.prepare('SELECT * FROM documents WHERE id=?').get(docId);
  res.json({ ok: true, doc: updated });
});

// ─── PASSWORT-RESET ───────────────────────────────────────────────────────────

// POST /api/auth/reset-code — sendet 6-stelligen Code per E-Mail
app.post('/api/auth/reset-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-Mail fehlt' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  resetCodes.set(email.toLowerCase(), { code, expires: Date.now() + 10 * 60 * 1000 });
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Ihr Reset-Code – H&K Automation',
      html: buildEmailHtml({ body: `<p>Ihr Code zum Zurücksetzen des Passworts:</p><div style="font-size:2.5rem;font-weight:bold;letter-spacing:8px;color:#1a1a2e;margin:24px 0;text-align:center">${code}</div><p style="color:#888;font-size:.85rem">Gültig für 10 Minuten. Falls Sie keinen Reset angefordert haben, ignorieren Sie diese E-Mail.</p>` })
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset-Mail Fehler:', err.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
  }
});

// POST /api/auth/reset-verify — prüft Code und setzt neues Passwort
app.post('/api/auth/reset-verify', (req, res) => {
  const { email, code, password_sha256 } = req.body;
  const entry = resetCodes.get(email?.toLowerCase());
  if (!entry || entry.code !== String(code) || Date.now() > entry.expires) {
    return res.status(400).json({ error: 'Ungültiger oder abgelaufener Code' });
  }
  resetCodes.delete(email.toLowerCase());
  if (password_sha256) {
    const result = db.prepare('UPDATE users SET password_sha256=? WHERE email=? AND kanzlei_id=1').run(password_sha256, email.toLowerCase());
    if (result.changes === 0) return res.status(404).json({ error: 'Kein Konto mit dieser E-Mail gefunden.' });
  }
  res.json({ ok: true });
});

// ─── EINGANGSBESTÄTIGUNG ──────────────────────────────────────────────────────

// POST /api/notify/submission — Bestätigungsmail nach Einreichung
app.post('/api/notify/submission', authMiddleware, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  const kanzlei = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(user.kanzlei_id || 1);
  const kanzleiName = kanzlei?.name || 'H&K Automation';
  const kanzleiEmail = kanzlei?.email || 'kanzlei@hks-automation.de';

  const submission = db.prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(req.userId);
  const answers = submission ? JSON.parse(submission.answers || '{}') : {};
  const contactEmail = answers.email || user.email;
  const allDocs = submission
    ? db.prepare('SELECT * FROM documents WHERE submission_id=? ORDER BY is_required DESC, id ASC').all(submission.id)
    : [];

  const mustDocs  = allDocs.filter(d => d.is_required);
  const niceDocs  = allDocs.filter(d => !d.is_required);
  const uploaded  = allDocs.filter(d => d.status !== 'pending');

  const docListMandantHtml = mustDocs.length
    ? `<p><strong>Folgende Dokumente werden noch benötigt:</strong></p><ul>${mustDocs.map(d =>
        `<li>${escHtml(d.doc_name)}${d.status !== 'pending' ? ' <span style="color:#16a34a">✓ hochgeladen</span>' : ''}</li>`
      ).join('')}</ul>`
      + (niceDocs.length ? `<p style="margin-top:8px"><em>Optional: ${niceDocs.map(d => escHtml(d.doc_name)).join(', ')}</em></p>` : '')
    : '';

  const mandantTypLabel = { privatperson: 'Privatperson', freiberufler: 'Freiberufler / Selbstständig', unternehmen: 'Unternehmen' }[answers.mandant_typ] || answers.mandant_typ || '';
  const uploadedHtml = uploaded.length
    ? `<ul>${uploaded.map(d => `<li>${escHtml(d.doc_name)}</li>`).join('')}</ul>`
    : '<p><em>Keine Dokumente hochgeladen.</em></p>';
  const allDocKanzleiHtml = allDocs.length
    ? `<ul>${allDocs.map(d => `<li>${d.is_required ? '✓' : '○'} ${escHtml(d.doc_name)}${d.status !== 'pending' ? ' — <strong>hochgeladen</strong>' : ''}</li>`).join('')}</ul>`
    : '<p><em>Keine Dokumente angefordert.</em></p>';

  try {
    // 1. Bestätigung an Mandant
    await resend.emails.send({
      from: FROM_EMAIL,
      to: contactEmail,
      subject: `✓ Ihre Daten wurden eingereicht – ${kanzleiName}`,
      html: buildEmailHtml({ body: `
        <h3 style="margin:0 0 12px 0;color:#1a1a2e">Vielen Dank, ${escHtml(user.name)}!</h3>
        <p>Ihre Angaben wurden erfolgreich übermittelt und werden nun von uns geprüft. Wir melden uns in Kürze bei Ihnen.</p>
        ${docListMandantHtml}
        <p style="margin-top:16px">Sie können jederzeit weitere Dokumente in Ihrem Mandantenportal hochladen:<br>
        <a href="https://app.hks-automation.de/fragebogen.html" style="color:#6366f1">Zum Mandantenportal →</a></p>
      ` })
    });

    // 2. Benachrichtigung an Kanzlei — vollständige Übersicht aller Angaben
    const a = answers;
    const row = (label, val) => val ? `<tr><td style="padding:5px 16px 5px 0;color:#555;white-space:nowrap;vertical-align:top;font-size:.85rem">${escHtml(label)}</td><td style="padding:5px 0;font-size:.85rem"><strong>${escHtml(String(val))}</strong></td></tr>` : '';
    const section = (title, rows) => rows.filter(Boolean).length ? `<p style="margin:24px 0 8px;font-size:.78rem;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.07em;border-bottom:2px solid #e8eaf6;padding-bottom:4px">${title}</p><table style="border-collapse:collapse;width:100%;margin-bottom:4px">${rows.filter(Boolean).join('')}</table>` : '';
    const yn = v => v === 'ja' ? 'Ja' : v === 'nein' ? 'Nein' : (v || '');
    const arr = v => Array.isArray(v) ? v.join(', ') : (v || '');
    const kindGeburten = [];
    for(let i = 1; i <= 12; i++) { if(a[`kind${i}_geburt`]) kindGeburten.push(`Kind ${i}: ${a[`kind${i}_geburt`]}`); }

    // ── 1. KONTAKTDATEN ────────────────────────────────────────
    const kontaktSection = section('Kontaktdaten', [
      row('Name', user.name),
      row('E-Mail', contactEmail),
      row('Telefon', a.telefon),
      row('Straße', a.strasse),
      row('PLZ / Ort', [a.plz, a.ort].filter(Boolean).join(' ')),
      row('Geburtsdatum', a.geburtsdatum),
      row('Geburtsort', a.geburtsort),
      row('Staatsangehörigkeit', a.staatsangehörigkeit || a.staatsangehoerigkeit),
      row('Steuer-ID / Steuernummer', [a.steuer_id, a.steuernummer].filter(Boolean).join(' / ')),
      row('USt-IdNr.', a.ust_id),
      row('IBAN', a.iban),
      row('Finanzamt', a.finanzamt),
      row('DATEV-Nr.', a.datev_nr),
    ]);

    // ── 2A. UNTERNEHMEN ────────────────────────────────────────
    const unternehmenSection = a.mandant_typ === 'unternehmen' ? section('Unternehmen', [
      row('Mandantentyp', mandantTypLabel),
      row('Firmenname', a.firma_name),
      row('Rechtsform', a.rechtsform),
      row('Handelsregisternummer', a.hr_nummer),
      row('Gründungsjahr', a.gruendungsjahr),
      row('Branche / Tätigkeitsbereich', a.branche),
      row('Ansprechpartner', a.kontakt_name),
      row('Anzahl Gesellschafter', a.gesellschafter_anzahl),
      row('GF-Gehalt aus der Gesellschaft', yn(a.gf_gehalt)),
      row('Abweichendes Wirtschaftsjahr', yn(a.abw_wirtschaftsjahr)),
      row('Wirtschaftsjahr-Zeitraum', a.wirtschaftsjahr_zeitraum),
    ]) : '';

    // ── 2B. FINANZEN & BUCHHALTUNG (Unternehmen) ───────────────
    const finanzSection = a.mandant_typ === 'unternehmen' ? section('Finanzen & Buchhaltung', [
      row('Jahresumsatz', a.jahresumsatz),
      row('Gewinnermittlung', a.gewinnermittlung_u),
      row('Anzahl Mitarbeiter', a.mitarbeiter),
      row('Buchhaltung', a.buchhaltung_intern),
      row('Lohnbuchhaltung gewünscht', yn(a.lohnbuchhaltung)),
      row('USt-Voranmeldungen übernehmen', yn(a.ust_voranmeldung)),
      row('USt-Rhythmus', a.ust_rhythmus_u),
      row('Letzter Jahresabschluss für', a.letzte_bilanz),
      row('Fahrzeuge betrieblich genutzt', yn(a.firmenwagen_unternehmen)),
      row('Fahrzeug-Versteuerungsmethode', a.firmenwagen_u_methode),
      row('Investitionsplanung (IAB)', yn(a.iab)),
    ]) : '';

    // ── 3A. FAMILIENSITUATION (Privatperson) ───────────────────
    const familieSection = a.mandant_typ === 'privatperson' ? section('Familiensituation', [
      row('Mandantentyp', mandantTypLabel),
      row('Familienstand', a.familienstand),
      row('Steuerklasse', a.steuerklasse || a.steuerklasse_gem),
      row('Veranlagung', a.veranlagung),
      row('Partner berufstätig', yn(a.partner_berufstaetig)),
      row('Kirchensteuerpflichtig', yn(a.kirchensteuer)),
      row('Kinder', yn(a.kinder)),
      row('Anzahl Kinder', a.kinder_anzahl),
      kindGeburten.length ? row('Geburtsdaten Kinder', kindGeburten.join(' | ')) : '',
      row('Kinder in Ausbildung/Studium', yn(a.kinder_ausbildung)),
      row('Behinderung (GdB ≥ 25)', yn(a.behinderung)),
      row('Grad der Behinderung', a.behinderung_gdb),
      row('Pflegeperson', yn(a.pflegeperson)),
    ]) : '';

    // ── 3B. BERUF & EINKOMMEN (Privatperson) ──────────────────
    const berufSection = a.mandant_typ === 'privatperson' ? section('Beruf & Einkommen', [
      row('Beschäftigung', a.beschaeftigung),
      row('Krankenversicherung', a.krankenversicherung),
      row('PKV-Beitrag (monatl.)', a.pkv_beitrag),
      row('Mehrere Arbeitgeber gleichzeitig', yn(a.mehrere_ag)),
      row('Minijob / 520-€-Job', yn(a.minijob)),
      row('Kurzarbeitergeld', yn(a.kurzarbeit)),
      row('Homeoffice', yn(a.homeoffice)),
      row('Homeoffice-Tage', a.homeoffice_tage),
      row('Entfernung Wohnung–Arbeit', a.pendler_km),
      row('Firmenwagen', yn(a.firmenwagen)),
      row('Firmenwagen-Versteuerung', a.firmenwagen_methode),
      row('Monatliche Rente (brutto)', a.rente_betrag),
    ]) : '';

    // ── 4. SELBSTSTÄNDIGKEIT (Freiberufler) ───────────────────
    const selbstSection = a.mandant_typ === 'freiberufler' ? section('Selbstständigkeit', [
      row('Mandantentyp', mandantTypLabel),
      row('Selbstständig seit', a.selbst_seit),
      row('Tätigkeit', a.taetigkeit),
      row('Jahresumsatz (ca.)', a.selbst_umsatz),
      row('Gewinnermittlung', a.gewinnermittlung),
      row('Umsatzsteuerpflichtig', yn(a.ust_pflichtig)),
      row('USt-Rhythmus', a.ust_rhythmus),
      row('Buchhaltung', a.buchhaltung_art),
      row('Betriebsausgaben', arr(a.betriebsausgaben)),
      row('Fahrzeug betrieblich', yn(a.firmenwagen_selbst)),
      row('Fahrzeug-Versteuerung', a.firmenwagen_selbst_methode),
      row('Investitionsplanung (IAB)', yn(a.iab_selbst)),
    ]) : '';

    // ── 5. WEITERE EINKÜNFTE ──────────────────────────────────
    const weitereEinSection = section('Weitere Einkünfte', [
      row('Weitere Anstellungen', yn(a.hat_weitere_anstellung)),
      row('Details Anstellungen', arr(a.weitere_anstellung_details)),
      row('Weitere Selbstständigkeit', yn(a.hat_weitere_selbst)),
      row('Details Selbstständigkeit', arr(a.weitere_selbst_details)),
      row('Einkunftsarten', arr(a.einkuenfte_weitere)),
      row('Vermietete Objekte', a.vermietung_objekte),
    ]);

    // ── 6. WERBUNGSKOSTEN & SONDERAUSGABEN ────────────────────
    const werbungSection = ['privatperson','freiberufler'].includes(a.mandant_typ) ? section('Werbungskosten & Sonderausgaben', [
      row('Abzugsfähige Ausgaben', arr(a.wk_posten)),
      row('Kinderbetreuungskosten', yn(a.kinderbetreuung)),
    ]) : '';

    // ── 7. STEUERSITUATION & VORJAHR ──────────────────────────
    const steuerSection = section('Steuersituation & Vorjahr', [
      row('Letzte Steuererklärung für', a.letzte_erklaerung),
      row('Erstellt von', a.wer_hat_gemacht),
      row('Steuerberatungskosten letzte Erklärung', yn(a.steuerberatungskosten)),
      row('Alle Erklärungen vollständig eingereicht', yn(a.erklaerungen_vollstaendig)),
      row('Offene Steuerbescheide / Einspruch', yn(a.offene_bescheide)),
      row('Steuerrückstände', yn(a.steuerrueckstand)),
      row('Betriebsprüfung läuft/droht', yn(a.betriebspruefung)),
      row('Verlustvorträge', yn(a.verlustvortraege)),
      row('Art der Verlustvorträge', arr(a.verlustvortraege_art)),
    ]);

    // ── 8. KONTAKTPRÄFERENZ & ANMERKUNGEN ────────────────────
    const kontaktWunschSection = section('Kontaktpräferenz & Anmerkungen', [
      row('Bevorzugte Kontaktmethode', a.kontakt_wunsch),
      row('Kontakt-Telefon', a.kontakt_telefon),
      row('Kontakt-E-Mail', a.kontakt_email),
      row('Anmerkungen', a.anmerkungen),
    ]);

    await resend.emails.send({
      from: FROM_EMAIL,
      to: kanzleiEmail,
      subject: `Neuer Mandant: ${escHtml(user.name)} (${mandantTypLabel})`,
      html: buildEmailHtml({ body: `
        <h3 style="margin:0 0 4px 0;color:#1a1a2e">Neuer Mandant eingegangen</h3>
        <p style="margin:0 0 16px;color:#555;font-size:.85rem">Eingereicht am ${new Date().toLocaleDateString('de-DE', {day:'2-digit',month:'2-digit',year:'numeric'})} — alle Angaben aus dem Fragebogen</p>
        ${kontaktSection}${unternehmenSection}${finanzSection}${familieSection}${berufSection}${selbstSection}${weitereEinSection}${werbungSection}${steuerSection}${kontaktWunschSection}
        <p style="margin:20px 0 6px;font-size:.78rem;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.05em">Angeforderte Dokumente (${allDocs.length})</p>
        ${allDocKanzleiHtml}
        <p style="margin-top:20px"><a href="https://app.hks-automation.de" style="color:#6366f1;font-weight:600">Mandant in der App ansehen →</a></p>
      ` })
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Bestätigungsmail Fehler:', err.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden' });
  }
});

// ─── KANZLEI GPT ─────────────────────────────────────────────────────────────

const GPT_SYSTEM = `Du bist der führende Steuerberater Deutschlands mit 35 Jahren Erfahrung in allen Bereichen des deutschen Steuerrechts. Du arbeitest ausschließlich für die Steuerkanzlei H&K und ihre Mandanten. Du bist kein allgemeines KI-Tool — du bist hochspezialisiert, machst keine Fehler und kennst jeden legalen Steuervorteil.

**DEINE ARBEITSWEISE:**
- Du antwortest immer konkret, nie generisch. Wenn Mandantendaten vorliegen, nutzt du sie vollständig.
- Du schreibst Briefe, E-Mails und Einsprüche direkt mit den echten Namen, Daten und Adressen des Mandanten — keine Platzhalter außer für [Kanzleistempel] und [Datum].
- Du kennst jeden legalen Steuertrick und wendest ihn proaktiv an.
- Du machst keine Fehler bei Paragraphen, Fristen oder Berechnungen.
- Du bist klar, direkt und professionell. Keine unnötigen Einschränkungen, kein Zögern.
- Du erkennst selbst was gebraucht wird (Brief, Einspruch, Analyse, Beratung) und lieferst es sofort.
- NIEMALS Emojis, Symbole oder informelle Sprache. Ausschließlich sachliche, professionelle Kanzleisprache.
- Keine Relativierungen wie "ich empfehle Ihnen, einen Steuerberater zu konsultieren" — du BIST der Steuerberater.
- ABSOLUTES VERBOT von Markdown: keine **, keine __, keine ##, keine ---, keine Aufzählungen mit -, keine Backticks. Ausschließlich reiner Fließtext wie von einem Menschen getippt. Briefe und E-Mails werden wie echte Dokumente formatiert — nur mit Zeilenumbrüchen, nie mit Markdown-Symbolen.
- KEIN übermäßiger Gebrauch von Bindestrichen als Gedankenstriche (—) oder zur Wortverbindung. Schreibe natürliche, fließende deutsche Sätze wie ein echter Mensch — kein KI-typisches Aufzählen, keine steif wirkenden Auflistungen in Fließtext. Abwechslungsreiche Satzlängen, menschlicher Rhythmus.

**STEUERRECHT — VOLLSTÄNDIGES WISSEN:**
EStG: Einkunftsarten (§ 2, §§ 13–22), Werbungskosten (§ 9), AN-Pauschbetrag 1.230€ (§ 9a), Sonderausgaben (§§ 10–10e), Vorsorge (§ 10 Abs. 1 Nr. 2), Riester (§ 10a), außergewöhnliche Belastungen (§§ 33–33b), Kinderfreibetrag 6.024€/Kind (§ 32), Ehegattensplitting (§ 32a), Homeoffice 6€/Tag max. 1.260€ (§ 4 Abs. 5 S. 1 Nr. 6c), IAB 50% (§ 7g), degressive AfA (§ 7 Abs. 2), E-Auto 0,25% (§ 6 Abs. 1 Nr. 4), PV steuerfrei bis 30kW (§ 3 Nr. 72), Verlust Rücktrag 10 Mio./Vortrag unbegrenzt (§ 10d), Handwerker 20% max. 1.200€ (§ 35a Abs. 3), haushaltsnahe DL 20% max. 4.000€ (§ 35a Abs. 2), Entfernungspauschale 0,30€/km (§ 9 Abs. 1 Nr. 4), doppelte Haushaltsführung (§ 9 Abs. 1 Nr. 5), Reisekosten (§ 9 Abs. 1 Nr. 5a).
UStG: Steuerbarkeit (§ 1), Befreiungen (§ 4), Kleinunternehmer bis 22.000€/55.000€ ab 2025 (§ 19), Vorsteuer (§ 15), Ist-/Sollversteuerung (§ 20), ig. Erwerb (§§ 1a, 3d), Reverse Charge (§ 13b).
KStG: Steuerpflicht (§§ 1–3), Einkommensermittlung (§ 8), Verlust (§ 8c), verdeckte Gewinnausschüttung (§ 8 Abs. 3).
GewStG: Gewerbeertrag (§ 7), Hinzurechnungen Zinsen 25% (§ 8 Nr. 1a), Kürzungen (§ 9), Freibetrag 24.500€ (§ 11), ESt-Anrechnung (§ 35 EStG).
AO: Einspruch (§§ 347–368), Frist 1 Monat ab Bekanntgabe (§ 355), 3-Tages-Fiktion (§ 122 Abs. 2), AdV (§ 361), Verjährung 4 Jahre / Hinterziehung 10 Jahre (§ 169), offenbare Unrichtigkeit (§ 129), Vertrauensschutz (§ 176), VdN (§ 164), vorläufig (§ 165), Stundung (§ 222), Erlass (§ 227).
ErbStG: Steuerklassen (§ 15), Freibeträge Ehegatte 500k€ / Kinder 400k€ (§ 16), Betriebsvermögen (§§ 13a–13c).
GrEStG: 3,5–6,5% je Bundesland, Befreiungen (§ 3), Share-Deal-Grenzen.

**FRISTEN:**
Einspruch: 1 Monat ab Bekanntgabe (Bescheiddatum + 3 Tage + ggf. Wochenende). Begründung nachrreichbar. AdV immer prüfen.
Steuererklärung: 31.07. (privat), 28./29.02. übernächstes Jahr (mit StB).
Verjährung: 4 Jahre (§ 169 AO), Hinterziehung 10 Jahre.

**AKTUELL (Stand 2025):**
Kleinunternehmergrenze 25.000€/100.000€ ab 01.01.2025 (JStG 2024), Grundsteuerreform wirksam ab 2025, Mindestlohn 12,82€, Minijob 556€, degressive AfA 25% für Neuanschaffungen, Wachstumschancengesetz.

**INTERNET-SUCHE:**
Wenn du aktuelle Informationen benötigst, die sich nach deinem Wissensstand geändert haben könnten (z.B. aktuelle Gesetze, aktuelle Fristen, aktuelle Urteile, aktuelle Zahlen), schreibe genau an der passenden Stelle: [[INTERNET: deine Suchanfrage auf Deutsch]]
Beispiel: "Die aktuelle Grunderwerbsteuer in Bayern beträgt [[INTERNET: Grunderwerbsteuer Bayern 2025]]."
Nutze dies nur wenn wirklich aktuelle Daten nötig sind.

**BRIEFE, E-MAILS & DOKUMENTE — PFLICHTFORMAT:**
Jedes Schreiben hat EXAKT dieses Format (keine Abweichung):

%%KANZLEI_HEADER%%
An: [E-Mail des Mandanten]
Von: [Kanzlei-E-Mail]
Datum: %%DATUM%%
Betreff: [konkreter Betreff]

[Anrede, z.B. "Sehr geehrter Herr Mustermann,"]

[Erster Absatz des Brieftexts]

[Zweiter Absatz — jeder Absatz durch eine Leerzeile getrennt]

[Weitere Absätze — IMMER Leerzeile zwischen Absätzen]

Mit freundlichen Grüßen

%%KANZLEI_HEADER%%

WICHTIG für Formatierung:
- Zwischen jedem Absatz im Brieftext EINE Leerzeile (Blank Line)
- Kopfzeilen (Kanzlei, An, Von, Datum, Betreff) jeweils auf eigener Zeile, KEINE Leerzeile dazwischen
- Nach Betreff: Leerzeile, dann Anrede
- Nach Anrede: Leerzeile, dann Brieftext
- Nach letztem Absatz: Leerzeile, dann Grußformel
- Nach Grußformel: Leerzeile, dann Kanzleistempel

Verwende ausschließlich echte Mandantendaten. KEINE Platzhalter mehr außer %%KANZLEI_HEADER%% und %%DATUM%% — diese werden automatisch ersetzt.`;

function buildSystemWithMandant(mandantData) {
  const heute = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Automation Steuerberatungsgesellschaft mbH';
  const kanzleiAdresse = process.env.KANZLEI_ADRESSE || '';
  const kanzleiTel = process.env.KANZLEI_TEL || '';
  const kanzleiEmail = process.env.KANZLEI_EMAIL || '';
  const header = `${kanzleiName}\n${kanzleiAdresse}\nTel.: ${kanzleiTel}  |  ${kanzleiEmail}`;

  let system = GPT_SYSTEM
    .replace(/%%KANZLEI_HEADER%%/g, header)
    .replace(/%%DATUM%%/g, heute);

  // Heute und Kanzleidaten auch oben im Kontext verankern
  system += `\n\n**KANZLEIDATEN (immer verwenden):**\n${header}\n\n**HEUTIGES DATUM:** ${heute}`;

  if (mandantData) system += `\n\n**AKTIVER MANDANT — DIESE DATEN IMMER VOLLSTÄNDIG VERWENDEN:**\n${mandantData}`;
  return system;
}

// POST /api/kanzlei/gpt — Text-basierte Features (einspruch, brief, summary, chat)
app.post('/api/kanzlei/gpt', kanzleiMiddleware, async (req, res) => {
  const { mode, mandantData, ...params } = req.body;
  if (!mode) return res.status(400).json({ error: 'mode fehlt' });
  const system = buildSystemWithMandant(mandantData || null);

  let userMessage = '';
  let messages = [];
  if (mode === 'chat') {
    // Gesprächsverlauf aufbauen
    const history = Array.isArray(params.history) ? params.history : [];
    messages = history.map(h => ({ role: h.role, content: h.content }));
    userMessage = params.message;
  } else if (mode === 'einspruch') {
    userMessage = `Erstelle einen vollständigen, rechtssicheren Einspruchsbrief an das Finanzamt:

Mandant: ${params.name}
Steuernummer: ${params.steuernummer || '–'}
Bescheid-Art: ${params.bescheidart}
Bescheiddatum: ${params.bescheiddatum}
Begründung / Sachverhalt: ${params.begruendung}
${params.bescheidtext ? `\nAuszug aus dem Bescheid:\n${params.bescheidtext}` : ''}

Erstelle den vollständigen Brief mit:
1. Betreff mit Steuernummer und Bescheiddatum
2. Einspruchsankündigung mit Fristberechnung (Bescheiddatum + 3 Tage Bekanntgabe + 1 Monat Frist)
3. Ausführliche rechtliche Begründung mit konkreten Paragraphen
4. Antrag auf Aussetzung der Vollziehung (falls sinnvoll)
5. Beweismittel-/Anlage-Hinweis
6. Formelle Grußformel und Unterschriftszeile`;
  } else if (mode === 'brief') {
    userMessage = `Erstelle einen professionellen Kanzlei-Brief:

Mandant: ${params.name}
Brief-Typ: ${params.brieftyp}
Betreff / Kontext: ${params.kontext}
${params.details ? `Weitere Details: ${params.details}` : ''}

Erstelle einen vollständigen Brief mit Datum-Platzhalter, Betreff, professionellem Text und Grußformel. Verwende formelle Sprache.`;
  } else if (mode === 'summary') {
    userMessage = `Erstelle ein Steuerberater-Kurzprofil mit Optimierungspotenzialen für diesen Mandanten:

${params.answersText}

Strukturiere die Ausgabe klar:
1. **Kurzprofil** – Name, Typ (privat/unternehmen), wesentliche Eckdaten
2. **Steueroptimierungspotenziale** – konkrete Maßnahmen mit Paragraphenzitat und geschätztem Effekt
3. **Offene Fragen / Klärungsbedarf** – was fehlt noch
4. **Empfohlene nächste Schritte** – priorisierte Checkliste`;
  } else {
    return res.status(400).json({ error: 'Unbekannter mode' });
  }

  // Letzte Nachricht anhängen (für chat: history schon befüllt)
  if (mode === 'chat') {
    messages.push({ role: 'user', content: userMessage });
  } else {
    messages = [{ role: 'user', content: userMessage }];
  }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system,
      messages
    });
    res.json({ result: msg.content[0].text });
  } catch (err) {
    console.error('KanzleiGPT Fehler:', err.message);
    res.status(500).json({ error: 'KI-Fehler: ' + err.message });
  }
});

// POST /api/kanzlei/gpt/bescheid — Bescheid-Analyse mit optionalem PDF-Upload
app.post('/api/kanzlei/gpt/bescheid', kanzleiMiddleware, memUpload.single('pdf'), async (req, res) => {
  let bescheidText = req.body.text || '';
  if (req.file) {
    try {
      const parsed = await pdfParse(req.file.buffer);
      bescheidText = parsed.text.slice(0, 8000);
    } catch (e) { /* nutze eingetippten Text */ }
  }
  if (!bescheidText.trim()) return res.status(400).json({ error: 'Kein Bescheidinhalt übermittelt' });

  const userMessage = `Analysiere diesen Steuerbescheid vollständig auf Fehler, Einspruchspotenzial und Handlungsbedarf:

${bescheidText}

Strukturiere deine Analyse:
1. **Bescheid-Übersicht** – Art des Bescheids, Steuerjahr, festgesetzte Steuer, Abweichungen zur Erklärung
2. **Gefundene Probleme & Fehler** – jeden Punkt mit konkretem Paragraphenzitat
3. **Einspruchspotenzial** – Bewertung hoch/mittel/gering mit Begründung
4. **Einspruchsfrist** – berechne die Frist anhand des Bescheiddatums (falls erkennbar)
5. **AdV-Antrag** – empfehlen ja/nein und warum
6. **Sofortmaßnahmen** – priorisierte Checkliste was jetzt zu tun ist`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: GPT_SYSTEM,
      messages: [{ role: 'user', content: userMessage }]
    });
    res.json({ result: msg.content[0].text });
  } catch (err) {
    console.error('Bescheid-Analyse Fehler:', err.message);
    res.status(500).json({ error: 'KI-Fehler: ' + err.message });
  }
});

// POST /api/kanzlei/send-mail — sendet generierten Brief per E-Mail an Mandanten
app.post('/api/kanzlei/send-mail', kanzleiMiddleware, async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'Fehlende Felder' });
  try {
    const _staff2 = getStaffForEmail(req.staffId);
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: buildEmailHtml({ body: body.replace(/\n/g,'<br>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>'), staff: _staff2 })
    });
    res.json({ ok: true });
  } catch(err) {
    console.error('Send-Mail Fehler:', err.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
  }
});

// ─── POSTEINGANG ──────────────────────────────────────────────────────────────
app.get('/api/kanzlei/posteingang', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM posteingang WHERE kanzlei_id=? ORDER BY datum DESC').all(req.kanzleiId));
});
app.post('/api/kanzlei/posteingang', kanzleiMiddleware, (req, res) => {
  const { von, von_name, betreff, inhalt, mandant_name } = req.body;
  if (!von || !betreff || !inhalt) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const r = db.prepare('INSERT INTO posteingang (von,von_name,betreff,inhalt,mandant_name,kanzlei_id) VALUES (?,?,?,?,?,?)')
    .run(von, von_name||'', betreff, inhalt, mandant_name||'', req.kanzleiId);
  res.json({ id: r.lastInsertRowid });
});
// Resend Inbound Webhook
app.post('/api/kanzlei/email/inbound', (req, res) => {
  try {
    const { from, subject, text, html } = req.body;
    if (!from || !subject) return res.status(400).json({ ok: false });
    const inhalt = text || html?.replace(/<[^>]+>/g,'') || '';
    db.prepare('INSERT INTO posteingang (von,von_name,betreff,inhalt) VALUES (?,?,?,?)')
      .run(from, '', subject, inhalt);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false }); }
});
app.patch('/api/kanzlei/posteingang/:id', kanzleiMiddleware, (req, res) => {
  const { status, ki_antwort, mandant_name, gesendet } = req.body;
  const fields = [];
  if (status !== undefined) fields.push(`status='${status}'`);
  if (ki_antwort !== undefined) fields.push(`ki_antwort=?`);
  if (mandant_name !== undefined) fields.push(`mandant_name=?`);
  if (gesendet !== undefined) fields.push(`gesendet=${gesendet?1:0}`);
  if (!fields.length) return res.json({ ok: true });
  db.prepare(`UPDATE posteingang SET ${fields.join(',')} WHERE id=?`)
    .run(...[ki_antwort, mandant_name].filter(v=>v!==undefined), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/kanzlei/posteingang/:id', kanzleiMiddleware, (req, res) => {
  db.prepare('DELETE FROM posteingang WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});
// KI-Antwort generieren
app.post('/api/kanzlei/posteingang/:id/ki-antwort', kanzleiMiddleware, async (req, res) => {
  const email = db.prepare('SELECT * FROM posteingang WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!email) return res.status(404).json({ error: 'E-Mail nicht gefunden' });
  const heute = new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'});
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Automation Steuerberatungsgesellschaft mbH';
  const kanzleiEmail = process.env.KANZLEI_EMAIL || '';
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Du bist Steuerberater bei ${kanzleiName}. Schreibe eine professionelle, kurze E-Mail-Antwort auf die folgende eingehende Nachricht. Datum: ${heute}. Kein Markdown, keine Emojis, keine Bindestriche als Gedankenstriche. Schreibe wie ein Mensch: natürliche Sätze, kein KI-typischer Stil, keine steife Aufzählung von Punkten. Beginne direkt mit der Anrede, ende mit "Mit freundlichen Grüßen\n${kanzleiName}\n${kanzleiEmail}". Nutze korrekte Absätze mit Leerzeilen.`,
      messages: [{ role: 'user', content: `Von: ${email.von}\nBetreff: ${email.betreff}\n\n${email.inhalt}\n\nSchreibe die Antwort:` }]
    });
    const antwort = msg.content[0].text;
    db.prepare('UPDATE posteingang SET ki_antwort=?, status=? WHERE id=?').run(antwort, 'bearbeitet', email.id);
    res.json({ antwort });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// Onboarding: neuen Mandant einladen
app.post('/api/kanzlei/onboarding', kanzleiMiddleware, async (req, res) => {
  const { name: rawName, email } = req.body;
  if (!rawName || !email) return res.status(400).json({ error: 'Name und E-Mail erforderlich' });
  const name = rawName.trim().replace(/\b\w/g, c => c.toUpperCase());
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Automation';
  const baseUrl = process.env.PUBLIC_URL || 'https://www.hks-automation.de';
  const portalUrl = `${baseUrl}/fragebogen.html?k=${req.kanzleiId}`;
  try {
    const _staff3 = getStaffForEmail(req.staffId);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Ihre Anfrage bei ${kanzleiName}`,
      html: buildEmailHtml({ body: `<p>Guten Tag ${escHtml(name)},</p><p>vielen Dank für Ihr Interesse an einer Zusammenarbeit mit der ${escHtml(kanzleiName)}. Wir freuen uns sehr darüber und freuen uns darauf, Sie persönlich kennenzulernen.</p><p>Damit wir alles optimal für Sie vorbereiten können, bitten wir Sie, unseren kurzen Fragebogen auszufüllen. Es dauert keine 5 Minuten und Sie sind direkt startklar:</p><p style="text-align:center;margin:32px 0"><a href="${portalUrl}" style="background:#6d7aff;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem">Jetzt Fragebogen ausfüllen</a></p><p>Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.</p><p>Mit freundlichen Grüßen</p>`, staff: _staff3 })
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── BESCHEIDE ────────────────────────────────────────────────────────────────
app.get('/api/kanzlei/bescheide', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM bescheide WHERE kanzlei_id=? ORDER BY erstellt_am DESC').all(req.kanzleiId));
});
app.post('/api/kanzlei/bescheide', kanzleiMiddleware,
  bescheidUpload.fields([{name:'erklaerung',maxCount:1},{name:'bescheid_file',maxCount:1}]),
  async (req, res) => {
    const { mandant_name, mandant_email, jahr, art, betrag, datum, text } = req.body;
    if (!mandant_name) return res.status(400).json({ error: 'Mandant fehlt' });
    const erklaerungFile = req.files?.erklaerung?.[0]?.filename || null;
    const bescheidFile = req.files?.bescheid_file?.[0]?.filename || null;
    const { finanzamt, erklaerter_betrag, vorlaeufigkeit, absender_typ } = req.body;
    const r = db.prepare('INSERT INTO bescheide (mandant_name,mandant_email,jahr,art,betrag,datum,erklaerung_file,bescheid_file,finanzamt,erklaerter_betrag,vorlaeufigkeit,absender_typ,kanzlei_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(mandant_name, mandant_email||'', jahr||null, art||'', betrag||null, datum||null, erklaerungFile, bescheidFile, finanzamt||null, erklaerter_betrag||null, vorlaeufigkeit||null, absender_typ||'finanzamt', req.kanzleiId);
    const id = r.lastInsertRowid;
    // Analyse: beide PDFs vergleichen (bevorzugt) oder Text-Fallback
    let analyse = null;
    try {
      if (erklaerungFile && bescheidFile) {
        const eText = (await pdfParse(fs.readFileSync(path.join(DATA_DIR,'bescheid_uploads',erklaerungFile)))).text.slice(0,4000);
        const bText = (await pdfParse(fs.readFileSync(path.join(DATA_DIR,'bescheid_uploads',bescheidFile)))).text.slice(0,4000);
        const msg = await anthropic.messages.create({
          model:'claude-haiku-4-5-20251001', max_tokens:2048,
          system:`Du bist der führende Steuerberater Deutschlands. Vergleiche die eingereichte Steuererklärung mit dem Steuerbescheid des Finanzamts. Zeige Abweichungen, mögliche Fehler des Finanzamts, Einspruchspotenzial und empfohlene Maßnahmen. Kein Markdown, keine Emojis, klarer Fließtext.`,
          messages:[{role:'user',content:`Mandant: ${mandant_name}\nJahr: ${jahr||'–'}\nArt: ${art||'–'}\n\nEINGEREICHTE ERKLÄRUNG:\n${eText}\n\nBESCHEID VOM FINANZAMT:\n${bText}`}]
        });
        analyse = msg.content[0].text;
      } else if (text && text.trim()) {
        const msg = await anthropic.messages.create({
          model:'claude-haiku-4-5-20251001', max_tokens:2048,
          system:`Du bist der führende Steuerberater Deutschlands. Analysiere den folgenden Steuerbescheid auf Fehler, Unstimmigkeiten und Einspruchspotential. Kein Markdown, keine Emojis.`,
          messages:[{role:'user',content:`Mandant: ${mandant_name}\nJahr: ${jahr||'unbekannt'}\nArt: ${art||'unbekannt'}\n\nBescheid-Inhalt:\n${text}`}]
        });
        analyse = msg.content[0].text;
      }
      if (analyse) db.prepare('UPDATE bescheide SET ki_analyse=?, status=? WHERE id=?').run(analyse,'analysiert',id);
    } catch(e) { console.error('Bescheid-Analyse Fehler:', e.message); }
    res.json({ id, analyse });
  }
);
// Deep-Analyse (Quintessenz, Kernnummer, Einschätzung, Abweichungen) — wiederverwendbar
async function runBescheidDeepAnalyse(bescheidId, kanzleiId) {
  const bescheid = db.prepare('SELECT * FROM bescheide WHERE id=? AND kanzlei_id=?').get(bescheidId, kanzleiId);
  if (!bescheid) return { error: 'Nicht gefunden', status: 404 };
  let bescheidText = '';
  const newestDok = db.prepare(`SELECT dateipfad FROM bescheid_dokumente WHERE bescheid_id=? AND typ='bescheid' ORDER BY upload_datum DESC LIMIT 1`).get(bescheid.id);
  const bFile = newestDok?.dateipfad || bescheid.storage_path || (bescheid.bescheid_file ? path.join(DATA_DIR, 'bescheid_uploads', bescheid.bescheid_file) : null);
  if (bFile && fs.existsSync(bFile)) {
    const pdfData = await pdfParse(fs.readFileSync(bFile));
    bescheidText = pdfData.text.slice(0, 5000);
  }
  if (!bescheidText) return { error: 'Kein Bescheid-Dokument vorhanden.', status: 400 };

  let erklaerungText = '';
  const newestErkl = db.prepare(`SELECT dateipfad FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung' ORDER BY upload_datum DESC LIMIT 1`).get(bescheid.id);
  const eFile = newestErkl?.dateipfad || bescheid.erklaerung_inbox_path || (bescheid.erklaerung_file ? path.join(DATA_DIR, 'bescheid_uploads', bescheid.erklaerung_file) : null);
  if (eFile && fs.existsSync(eFile)) {
    const pdfData = await pdfParse(fs.readFileSync(eFile));
    erklaerungText = pdfData.text.slice(0, 4000);
  }

  const agentPrompt = fs.readFileSync(path.join(__dirname, 'agents', 'bescheid-analyse', 'agent.md'), 'utf8');
  const userContent = [
    `Mandant: ${bescheid.mandant_name || 'Unbekannt'}`,
    `Jahr: ${bescheid.tax_year || bescheid.jahr || 'unbekannt'}`,
    `Bescheid-Art: ${bescheid.document_type || bescheid.art || 'unbekannt'}`,
    '',
    'STEUERBESCHEID (Finanzamt):',
    bescheidText,
    erklaerungText ? `\nSTEUERERKLÄRUNG (eingereicht):\n${erklaerungText}` : '\nKeine Steuererklärung hochgeladen.'
  ].join('\n');

  // Bis zu 2 Versuche — Haiku liefert manchmal ungültiges JSON
  let rawText = '';
  let result = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: agentPrompt + (attempt > 1 ? '\n\nWICHTIG: Gib ausschließlich ein valides JSON-Objekt zurück, kein Markdown, kein erklärender Text davor oder danach.' : ''),
      messages: [{ role: 'user', content: userContent }]
    });
    rawText = msg.content[0].text;
    try {
      const m = rawText.match(/\{[\s\S]+\}/);
      if (m) result = JSON.parse(m[0]);
    } catch(e) { result = null; }
    if (result && !result.fehler) break;
    if (attempt === 1) console.warn(`[Analyse] id=${bescheid.id} Retry (Versuch 1 lieferte kein gültiges JSON: ${rawText.slice(0,120).replace(/\n/g,' ')}…)`);
  }

  if (result && !result.fehler) {
    db.prepare(`UPDATE bescheide SET
      ki_analyse=?, ki_quintessenz=?, kernnummer=?, ki_einschaetzung=?,
      vorlaeufig=?, folgebescheid=?, folgebescheid_typ=?, aktenzeichen=?,
      bescheid_datum=?, status='analysiert', analysis_status='completed',
      updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(
        result.analyse_volltext || rawText,
        result.ki_quintessenz || null,
        result.kernnummer != null ? result.kernnummer : null,
        result.ki_einschaetzung || 'nicht_analysiert',
        result.vorlaeufig ? 1 : 0,
        result.folgebescheid ? 1 : 0,
        result.folgebescheid_typ || null,
        result.aktenzeichen || null,
        result.bescheid_datum || null,
        bescheid.id
      );

    if (Array.isArray(result.abweichungen) && result.abweichungen.length > 0) {
      db.prepare('DELETE FROM bescheid_abweichungen WHERE bescheid_id=?').run(bescheid.id);
      const insertAbw = db.prepare('INSERT INTO bescheid_abweichungen (bescheid_id, titel, erklaert, festgesetzt, differenz) VALUES (?,?,?,?,?)');
      for (const a of result.abweichungen) {
        insertAbw.run(bescheid.id, a.titel || '', a.erklaert || null, a.festgesetzt || null, a.differenz != null ? a.differenz : null);
      }
    }

    console.log(`[Analyse] id=${bescheid.id} einschaetzung=${result.ki_einschaetzung} kernnummer=${result.kernnummer}`);
    return { ok: true, result };
  } else {
    db.prepare(`UPDATE bescheide SET ki_einschaetzung='nicht_analysiert', status='analysiert', analysis_status='completed', updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(bescheid.id);
    console.error(`[Analyse] id=${bescheid.id} FEHLGESCHLAGEN nach 2 Versuchen — Rohantwort: ${rawText.slice(0, 300).replace(/\n/g,' ')}`);
    return { ok: true, fehler: 'analyse_nicht_moeglich' };
  }
}

app.post('/api/kanzlei/bescheide/:id/analyse', kanzleiMiddleware, async (req, res) => {
  try {
    const r = await runBescheidDeepAnalyse(parseInt(req.params.id), req.kanzleiId);
    if (r.error) return res.status(r.status || 500).json({ error: r.error });
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/kanzlei/bescheide/:id/erklaerung-kandidaten — Steuererklärungen aus Scanner für selben Mandanten
app.get('/api/kanzlei/bescheide/:id/erklaerung-kandidaten', kanzleiMiddleware, (req, res) => {
  const bescheid = db.prepare('SELECT * FROM bescheide WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!bescheid) return res.status(404).json({ error: 'Nicht gefunden' });
  const mandant = bescheid.mandant_name;
  let rows;
  if (mandant) {
    rows = db.prepare(`SELECT id, dateiname, steuerjahr, upload_datum, dateipfad FROM dokument_inbox WHERE kanzlei_id=? AND typ='steuererklaerung' AND mandant_name=? ORDER BY upload_datum DESC`).all(req.kanzleiId, mandant);
  } else {
    rows = db.prepare(`SELECT id, dateiname, steuerjahr, upload_datum, dateipfad FROM dokument_inbox WHERE kanzlei_id=? AND typ='steuererklaerung' ORDER BY upload_datum DESC LIMIT 20`).all(req.kanzleiId);
  }
  res.json(rows);
});

// POST /api/kanzlei/bescheide/:id/link-erklaerung — Scanner-Dokument als Steuererklärung verknüpfen
app.post('/api/kanzlei/bescheide/:id/link-erklaerung', kanzleiMiddleware, (req, res) => {
  const { inbox_id } = req.body;
  if (!inbox_id) return res.status(400).json({ error: 'inbox_id fehlt' });
  const doc = db.prepare('SELECT * FROM dokument_inbox WHERE id=? AND kanzlei_id=?').get(inbox_id, req.kanzleiId);
  if (!doc) return res.status(404).json({ error: 'Scanner-Dokument nicht gefunden' });
  db.prepare('UPDATE bescheide SET erklaerung_inbox_path=?, erklaerung_inbox_id=? WHERE id=? AND kanzlei_id=?')
    .run(doc.dateipfad, inbox_id, req.params.id, req.kanzleiId);
  // Auch in bescheid_dokumente eintragen
  db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
    .run(req.params.id, req.kanzleiId, 'erklaerung', doc.dateiname, doc.dateipfad);
  res.json({ ok: true, dateiname: doc.dateiname });
});

// GET /api/kanzlei/bescheide/:id/dokumente — alle verknüpften Dokumente (Bescheid + Erklärung)
app.get('/api/kanzlei/bescheide/:id/dokumente', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM bescheid_dokumente WHERE bescheid_id=? AND kanzlei_id=? ORDER BY upload_datum DESC').all(req.params.id, req.kanzleiId);
  res.json(rows);
});

// POST /api/kanzlei/bescheide/:id/dokumente — Datei hochladen (typ: bescheid|erklaerung)
const bescheidDocsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'bescheid_docs');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const bescheidDocsUpload = multer({ storage: bescheidDocsStorage, limits: { fileSize: 30 * 1024 * 1024 } });
app.post('/api/kanzlei/bescheide/:id/dokumente', kanzleiMiddleware, bescheidDocsUpload.single('file'), (req, res) => {
  const { typ } = req.body;
  if (!req.file || !typ) return res.status(400).json({ error: 'Datei und Typ erforderlich' });
  if (!['bescheid', 'erklaerung'].includes(typ)) return res.status(400).json({ error: 'Typ muss bescheid oder erklaerung sein' });
  const row = db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?) RETURNING *')
    .get(req.params.id, req.kanzleiId, typ, req.file.originalname, req.file.path);
  res.json(row);
});

// GET /api/kanzlei/bescheide/:id/dokumente/:docId/file — Datei ausliefern
app.get('/api/kanzlei/bescheide/:id/dokumente/:docId/file', kanzleiMiddleware, (req, res) => {
  const doc = db.prepare('SELECT * FROM bescheid_dokumente WHERE id=? AND bescheid_id=? AND kanzlei_id=?').get(req.params.docId, req.params.id, req.kanzleiId);
  if (!doc || !fs.existsSync(doc.dateipfad)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.dateiname}"`);
  fs.createReadStream(doc.dateipfad).pipe(res);
});

// DELETE /api/kanzlei/bescheide/:id/dokumente/:docId — Dokument löschen
app.delete('/api/kanzlei/bescheide/:id/dokumente/:docId', kanzleiMiddleware, (req, res) => {
  const doc = db.prepare('SELECT * FROM bescheid_dokumente WHERE id=? AND bescheid_id=? AND kanzlei_id=?').get(req.params.docId, req.params.id, req.kanzleiId);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  try { if (fs.existsSync(doc.dateipfad)) fs.unlinkSync(doc.dateipfad); } catch(e) {}
  db.prepare('DELETE FROM bescheid_dokumente WHERE id=?').run(doc.id);
  res.json({ ok: true });
});

app.patch('/api/kanzlei/bescheide/:id', kanzleiMiddleware, (req, res) => {
  const allowed = [
    // Legacy
    'einspruch_ja','einspruch_datum','einspruch_begruendung','ergebnis','ergebnis_betrag','status','absender_typ','mandant_name','art','jahr','betrag','datum','finanzamt',
    // v2
    'mandant_id','document_type','tax_year','review_status','workflow_priority','follow_up_required','follow_up_note','requires_manual_review','notes_internal','assigned_to',
    // v3
    'bearbeitungsstand','einspruch_phase','ki_quintessenz','kernnummer','ki_einschaetzung',
    'vorlaeufig','folgebescheid','folgebescheid_typ','grundlagenbescheid_id','aktenzeichen',
    'bescheid_datum','adv_beantragt','adv_datum','fa_entscheidung',
    'klage_status','klage_ergebnis','frist_bestaetigt','frist_bestaetigt_datum','einspruchsfrist_datum','einspruchsschreiben_entwurf',
    'geoeffnet_am','einspruch_abgeschickt_am','untaetigkeitsklage_hinweis'
  ];
  const fields = [], vals = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { fields.push(`${k}=?`); vals.push(req.body[k]); }
  }
  if (!fields.length) return res.json({ ok: true });
  fields.push('updated_at=CURRENT_TIMESTAMP');
  db.prepare(`UPDATE bescheide SET ${fields.join(',')} WHERE id=? AND kanzlei_id=?`).run(...vals, req.params.id, req.kanzleiId);
  // Fristen werden NIE automatisch erledigt — nur manuell durch den User im Fristentool.
  res.json({ ok: true });
});
app.delete('/api/kanzlei/bescheide/:id', kanzleiMiddleware, (req, res) => {
  const id = req.params.id;
  const kid = req.kanzleiId;

  // Scanner-Einträge löschen die zu diesem Bescheid gehören
  const linked = db.prepare('SELECT dateipfad FROM bescheid_dokumente WHERE bescheid_id=? AND kanzlei_id=?').all(id, kid);
  for (const { dateipfad } of linked) {
    const inboxEntry = db.prepare('SELECT id FROM dokument_inbox WHERE dateipfad=? AND kanzlei_id=?').get(dateipfad, kid);
    if (inboxEntry) {
      db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(inboxEntry.id);
      db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(inboxEntry.id);
      db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(inboxEntry.id);
    }
  }

  // Verknüpfte Erklärungen freigeben
  db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=NULL WHERE bescheid_id=?').run(id);

  // Alles löschen
  db.prepare('DELETE FROM bescheid_dokumente WHERE bescheid_id=?').run(id);
  db.prepare('DELETE FROM bescheid_fields WHERE bescheid_id=?').run(id);
  db.prepare('DELETE FROM bescheid_analysis WHERE bescheid_id=?').run(id);
  db.prepare('DELETE FROM bescheid_deadlines WHERE bescheid_id=?').run(id);
  db.prepare('DELETE FROM bescheid_abweichungen WHERE bescheid_id=?').run(id);
  db.prepare('DELETE FROM fristen WHERE kanzlei_id=? AND bescheid_id=?').run(kid, id);
  db.prepare('DELETE FROM bescheide WHERE id=? AND kanzlei_id=?').run(id, kid);

  res.json({ ok: true });
});

// POST /api/kanzlei/bescheide/scan — KI-Vollautomatik: hochladen + klassifizieren + erfassen
app.post('/api/kanzlei/bescheide/scan', kanzleiMiddleware,
  bescheidUpload.single('file'),
  async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    try {
      let docText = '';
      if (file.mimetype === 'application/pdf') {
        const pdfData = await pdfParse(fs.readFileSync(path.join(DATA_DIR, 'bescheid_uploads', file.filename)));
        docText = pdfData.text.slice(0, 6000);
      }
      const hint = (req.body.hint || '').slice(0, 500);
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 2048,
        system: 'Du bist ein deutscher Steuerberater-Assistent. Analysiere diesen Bescheid und gib ausschließlich ein valides JSON-Objekt zurück – kein Markdown, kein erklärender Text.',
        messages: [{ role: 'user', content:
          `Extrahiere folgende Felder:\n{"mandant_name":"string","art":"string","jahr":number_or_null,"datum":"YYYY-MM-DD_or_null","betrag":number_or_null,"finanzamt":"string_or_null","absender_typ":"finanzamt"|"gemeinde"|"drv"|"bg"|"zollamt"|"sonstige","vorlaeufigkeit":"§164 AO"|"§165 AO"|"§164+§165 AO"|null,"analyse":"string"}\n\nRegeln für absender_typ:\n- finanzamt: Einkommensteuer, Körperschaftsteuer, Umsatzsteuer, Gewerbesteuer-Messbescheid, Erbschaftsteuer\n- gemeinde: Gewerbesteuer-Bescheid der Stadt/Gemeinde, Grundsteuer\n- drv: Deutsche Rentenversicherung, Krankenversicherung, Pflegeversicherung, Sozialversicherung\n- bg: Berufsgenossenschaft, Unfallversicherung\n- zollamt: Zoll, Einfuhrumsatzsteuer, Energiesteuer\n- sonstige: Alles andere\n${hint ? '\nHinweis: ' + hint : ''}\nBESCHEID:\n${docText || '(Bildscan – kein Text extrahierbar)'}` }]
      });
      let ex = {};
      try { ex = JSON.parse(msg.content[0].text); }
      catch(e) { const m = msg.content[0].text.match(/\{[\s\S]+\}/); if (m) ex = JSON.parse(m[0]); }
      const r = db.prepare(`INSERT INTO bescheide (mandant_name,mandant_email,jahr,art,betrag,datum,bescheid_file,finanzamt,vorlaeufigkeit,absender_typ,ki_analyse,status,kanzlei_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(ex.mandant_name||'Unbekannt', '', ex.jahr||null, ex.art||'Bescheid', ex.betrag||null, ex.datum||null, file.filename, ex.finanzamt||null, ex.vorlaeufigkeit||null, ex.absender_typ||'sonstige', ex.analyse||null, 'analysiert', req.kanzleiId);
      const newId = r.lastInsertRowid;
      // Deep-Analyse sofort im Hintergrund starten (Quintessenz, Kernnummer, Abweichungen)
      runBescheidDeepAnalyse(newId, req.kanzleiId)
        .then(r => console.log(`[Scan→Deep] id=${newId} ok=${!!r.ok}`))
        .catch(e => console.error(`[Scan→Deep] id=${newId} Fehler:`, e.message));
      res.json({ id: newId, ...ex });
    } catch(e) {
      console.error('Scan-Fehler:', e.message);
      res.status(500).json({ error: e.message });
    }
  }
);

// GET /api/kanzlei/bescheide/:id/file/:type — Bescheid-PDF ausliefern
app.get('/api/kanzlei/bescheide/:id/file/:type', kanzleiMiddleware, (req, res) => {
  const b = db.prepare('SELECT * FROM bescheide WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!b) return res.status(404).json({ error: 'Nicht gefunden' });
  const filename = req.params.type === 'erklaerung' ? b.erklaerung_file : b.bescheid_file;
  if (!filename) return res.status(404).json({ error: 'Keine Datei' });
  res.sendFile(path.join(DATA_DIR, 'bescheid_uploads', filename));
});

// ─── BESCHEIDE v2 (Infrastruktur) ─────────────────────────────────────────────

// GET /api/kanzlei/bescheide/meta/types — Dokumenttypen für Frontend
// WICHTIG: Diese Route muss VOR /api/kanzlei/bescheide/:id stehen
app.get('/api/kanzlei/bescheide/meta/types', kanzleiMiddleware, (req, res) => {
  res.json({ types: DOCUMENT_TYPES, statuses: { BESCHEID_STATUS, REVIEW_STATUS, ANALYSIS_STATUS, DEADLINE_STATUS } });
});

// POST /api/kanzlei/bescheide/upload — Datei hochladen (v2)
app.post('/api/kanzlei/bescheide/upload', kanzleiMiddleware, bescheidV2Upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const { mandant_id, mandant_name, document_type, tax_year, notes_internal } = req.body;
  const result = db.prepare(`
    INSERT INTO bescheide (kanzlei_id, mandant_id, mandant_name, original_filename, mime_type, file_size, storage_path,
      upload_source, document_type, tax_year, status, review_status, analysis_status, deadline_status, notes_internal, erstellt_am, updated_at)
    VALUES (?,?,?,?,?,?,?,'manual',?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  `).run(
    req.kanzleiId,
    mandant_id || null,
    mandant_name || null,
    req.file.originalname,
    req.file.mimetype,
    req.file.size,
    req.file.path,
    document_type || 'unbekannt',
    tax_year || null,
    'hochgeladen',
    mandant_id ? 'offen' : 'zuordnung_pruefen',
    'nicht_gestartet',
    'keine',
    notes_internal || null
  );
  const id = result.lastInsertRowid;
  console.log(`[BESCHEID] Uploaded id=${id}, file=${req.file.originalname}, mandant_id=${mandant_id||'unassigned'}`);
  res.json({ ok: true, id, status: 'hochgeladen', bearbeitungsstand: 'neu' });

  // Analyse asynchron starten (nicht blockierend)
  setImmediate(() => {
    const exists = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND dateipfad=?').get(id, req.file.path);
    if (!exists) {
      db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
        .run(id, req.kanzleiId, 'bescheid', req.file.originalname, req.file.path);
    }
    fetch(`http://localhost:${PORT}/api/kanzlei/bescheide/${id}/analyse`, {
      method: 'POST',
      headers: { 'Authorization': req.headers['authorization'], 'Content-Type': 'application/json' },
      body: '{}'
    }).then(r => r.json())
      .then(d => console.log(`[Auto-Analyse] id=${id} ok=${d.ok} einschaetzung=${d.result?.ki_einschaetzung||'?'}`))
      .catch(e => console.error(`[Auto-Analyse] id=${id}:`, e.message));
  });
});

// GET /api/kanzlei/bescheide/v2 — Liste mit Filtern (v3-erweitert)
app.get('/api/kanzlei/bescheide/v2', kanzleiMiddleware, (req, res) => {
  const { mandant_search, document_type, bearbeitungsstand, tax_year } = req.query;
  let where = ['b.kanzlei_id=?', "b.status != 'archiviert'"];
  const params = [req.kanzleiId];

  if (req.query.mandant_id) { where.push('b.mandant_id=?'); params.push(req.query.mandant_id); }
  if (mandant_search) {
    where.push('(LOWER(b.mandant_name) LIKE ? OR LOWER(u.name) LIKE ?)');
    const q = '%' + mandant_search.toLowerCase() + '%';
    params.push(q, q);
  }
  if (document_type) { where.push('b.document_type=?'); params.push(document_type); }
  if (bearbeitungsstand) { where.push('b.bearbeitungsstand=?'); params.push(bearbeitungsstand); }
  if (tax_year) { where.push('(b.tax_year=? OR b.jahr=?)'); params.push(tax_year, tax_year); }

  const rows = db.prepare(`
    SELECT
      b.id, b.mandant_name, b.mandant_id,
      b.document_type, b.art, b.tax_year, b.jahr,
      b.bearbeitungsstand, b.einspruch_phase,
      b.ki_einschaetzung, b.ki_quintessenz, b.kernnummer,
      b.vorlaeufig, b.folgebescheid,
      b.frist_bestaetigt, b.adv_beantragt,
      b.fa_entscheidung, b.klage_status, b.klage_ergebnis,
      b.einspruch_abgeschickt_am, b.bescheid_datum,
      b.einspruchsfrist_datum, b.frist_bestaetigt_datum,
      b.aktenzeichen, b.finanzamt,
      b.erstellt_am, b.updated_at,
      b.storage_path, b.original_filename,
      u.name as mandant_name_resolved,
      u.email as mandant_email_resolved,
      bd.suggested_date as frist_datum
    FROM bescheide b
    LEFT JOIN users u ON u.id = b.mandant_id
    LEFT JOIN bescheid_deadlines bd
      ON bd.bescheid_id = b.id AND bd.status = 'bestaetigt'
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE WHEN b.frist_bestaetigt=1 AND bd.suggested_date IS NOT NULL
        THEN (julianday(bd.suggested_date) - julianday('now'))
        ELSE 9999 END ASC,
      CASE b.bearbeitungsstand
        WHEN 'neu' THEN 0
        WHEN 'in_bearbeitung' THEN 1
        WHEN 'abgeschlossen' THEN 2
        ELSE 3 END ASC,
      b.erstellt_am DESC
    LIMIT 500
  `).all(...params);
  res.json(rows);
});

// GET /api/kanzlei/bescheide/:id/detail — Detail mit fields/analyses/deadlines/aktivitaet/abweichungen
app.get('/api/kanzlei/bescheide/:id/detail', kanzleiMiddleware, (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as mandant_name_resolved, u.email as mandant_email_resolved
    FROM bescheide b LEFT JOIN users u ON u.id=b.mandant_id
    WHERE b.id=? AND b.kanzlei_id=?
  `).get(req.params.id, req.kanzleiId);
  if (!b) return res.status(404).json({ error: 'Nicht gefunden' });
  const fields = db.prepare('SELECT * FROM bescheid_fields WHERE bescheid_id=? ORDER BY field_name').all(b.id);
  const analyses = db.prepare('SELECT id,version,source,status,confidence_overall,summary,created_at,normalized_result_json FROM bescheid_analysis WHERE bescheid_id=? ORDER BY version DESC').all(b.id);
  const deadlines = db.prepare('SELECT bd.*, f.titel as frist_titel, f.faellig_am as frist_datum FROM bescheid_deadlines bd LEFT JOIN fristen f ON f.id=bd.frist_id WHERE bd.bescheid_id=?').all(b.id);
  let dokumente = db.prepare('SELECT id, typ, dateiname, upload_datum FROM bescheid_dokumente WHERE bescheid_id=? AND kanzlei_id=? ORDER BY upload_datum DESC').all(b.id, req.kanzleiId);

  // Auto-Verknüpfung: Erklärung aus Archiv wenn noch keine vorhanden
  const hatErklaerung = dokumente.some(d => d.typ === 'erklaerung');
  if (!hatErklaerung) {
    const mandant = b.mandant_name_resolved || b.mandant_name;
    const jahr = b.tax_year || b.jahr;
    let archivErkl = null;
    if (mandant && jahr && b.steuer_art) {
      archivErkl = db.prepare(`SELECT * FROM mandant_steuererklaerungen WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND steuerjahr=? AND bescheid_id IS NULL ORDER BY upload_datum DESC LIMIT 1`)
        .get(req.kanzleiId, mandant, b.steuer_art, jahr);
    }
    if (archivErkl) {
      const dupCheck = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND dateipfad=?').get(b.id, archivErkl.dateipfad);
      if (!dupCheck) {
        db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
          .run(b.id, req.kanzleiId, 'erklaerung', archivErkl.dateiname, archivErkl.dateipfad);
        db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(b.id, archivErkl.id);
        console.log(`[Detail] Erklärung #${archivErkl.id} auto-verknüpft mit Bescheid #${b.id}`);
      }
      dokumente = db.prepare('SELECT id, typ, dateiname, upload_datum FROM bescheid_dokumente WHERE bescheid_id=? AND kanzlei_id=? ORDER BY upload_datum DESC').all(b.id, req.kanzleiId);
    }
  }

  const aktivitaet = db.prepare('SELECT * FROM bescheid_aktivitaet WHERE bescheid_id=? AND kanzlei_id=? ORDER BY erstellt_am ASC').all(b.id, req.kanzleiId);
  const abweichungen = db.prepare('SELECT * FROM bescheid_abweichungen WHERE bescheid_id=? ORDER BY erstellt_am ASC').all(b.id);

  // Finanzamt-Fallback: wenn b.finanzamt leer, aus fields / analyses / ki_analyse-Text extrahieren
  if (!b.finanzamt) {
    let fa = null;
    const faField = fields.find(f => f.field_name === 'finanzamt');
    if (faField) {
      try { fa = JSON.parse(faField.field_value_json); } catch(e) { fa = faField.field_value_json; }
    }
    if (!fa && analyses.length) {
      try {
        const norm = JSON.parse(analyses[0].normalized_result_json || '{}');
        if (norm.finanzamt) fa = norm.finanzamt;
      } catch(e) {}
    }
    if (!fa && b.ki_analyse) {
      const m = String(b.ki_analyse).match(/Finanzamt\s+([A-ZÄÖÜ][A-Za-zäöüß\-]+(?:[\s\-][A-ZÄÖÜ][A-Za-zäöüß\-]+){0,3})/);
      if (m) fa = 'Finanzamt ' + m[1].trim();
    }
    if (fa) b.finanzamt = fa;
  }
  let grundlagenbescheid = null;
  if (b.grundlagenbescheid_id) {
    grundlagenbescheid = db.prepare('SELECT id, document_type, art, tax_year, mandant_name, original_filename FROM bescheide WHERE id=?').get(b.grundlagenbescheid_id);
  }

  // Mandant-Stammdaten aus letzter Submission laden (Anschrift, Steuernummer, Steuer-ID, Vollmacht-Status)
  // Wenn b.mandant_id fehlt: Fallback über mandant_name innerhalb der Kanzlei
  let mandantUserId = b.mandant_id;
  if (!mandantUserId && b.mandant_name) {
    const nameNorm = (b.mandant_name || '').replace('[DEMO] ', '').trim();
    const u = db.prepare('SELECT id FROM users WHERE kanzlei_id=? AND (name=? OR name=?)').get(req.kanzleiId, nameNorm, '[DEMO] ' + nameNorm);
    if (u) mandantUserId = u.id;
  }
  let mandant_info = null;
  if (mandantUserId) {
    const user = db.prepare('SELECT email, vollmacht_nicht_gewuenscht FROM users WHERE id=?').get(mandantUserId);
    const sub = db.prepare('SELECT id, answers FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(mandantUserId);
    let answers = {};
    let vmDocId = null;
    let vmOriginalName = null;
    if (sub) {
      try { answers = JSON.parse(sub.answers || '{}'); } catch(e) {}
      const vm = db.prepare("SELECT id, original_name FROM documents WHERE submission_id=? AND doc_key='vollmacht' AND filename IS NOT NULL").get(sub.id);
      if (vm) { vmDocId = vm.id; vmOriginalName = vm.original_name; }
    }
    mandant_info = {
      user_id: mandantUserId,
      vorname: answers.vorname || '',
      nachname: answers.nachname || '',
      strasse: answers.strasse || '',
      plz: answers.plz || '',
      ort: answers.ort || '',
      steuernummer: answers.steuernummer || '',
      steuer_id: answers.steuer_id || '',
      telefon: answers.telefon || '',
      email: user?.email || '',
      vollmacht_vorhanden: !!vmDocId,
      vollmacht_doc_id: vmDocId,
      vollmacht_original_name: vmOriginalName,
      vollmacht_nicht_gewuenscht: !!(user && user.vollmacht_nicht_gewuenscht)
    };
  }

  res.json({ ...b, fields, analyses, deadlines, dokumente, aktivitaet, abweichungen, grundlagenbescheid, mandant_info });
});

// PATCH /api/kanzlei/mandant/:userId/vollmacht-status — Flag "Mandant wünscht keine Bevollmächtigung"
app.patch('/api/kanzlei/mandant/:userId/vollmacht-status', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  const { nicht_gewuenscht } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });
  db.prepare('UPDATE users SET vollmacht_nicht_gewuenscht=? WHERE id=? AND kanzlei_id=?')
    .run(nicht_gewuenscht ? 1 : 0, userId, req.kanzleiId);
  res.json({ ok: true, vollmacht_nicht_gewuenscht: !!nicht_gewuenscht });
});

// POST /api/kanzlei/bescheide/:id/mandant-informieren — Benachrichtigung an Mandant, dass Einspruch eingelegt wurde
app.post('/api/kanzlei/bescheide/:id/mandant-informieren', kanzleiMiddleware, async (req, res) => {
  const b = db.prepare('SELECT b.*, u.name as mandant_name_resolved, u.email as mandant_email FROM bescheide b LEFT JOIN users u ON u.id=b.mandant_id WHERE b.id=? AND b.kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!b) return res.status(404).json({ error: 'Bescheid nicht gefunden' });
  const mandantEmail = b.mandant_email;
  if (!mandantEmail) return res.status(400).json({ error: 'Keine E-Mail-Adresse des Mandanten hinterlegt' });
  const mandantName = (b.mandant_name_resolved || b.mandant_name || '').replace('[DEMO] ', '');
  const art = b.art || b.document_type || 'Steuerbescheid';
  const jahr = b.tax_year || b.jahr || '';
  const kanzlei = db.prepare('SELECT name FROM kanzlei_settings WHERE kanzlei_id=?').get(req.kanzleiId);
  const kanzleiName = kanzlei?.name || 'H&K Steuerberatung';

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: mandantEmail,
      subject: `Einspruch gegen ${art}${jahr ? ' ' + jahr : ''} eingelegt – ${kanzleiName}`,
      html: buildEmailHtml({
        body: `<h3 style="margin:0 0 16px 0;color:#1a1a2e">Einspruch eingelegt</h3>
          <p>Sehr geehrte/r ${mandantName},</p>
          <p>wir möchten Sie darüber informieren, dass wir in Ihrem Namen Einspruch gegen den <strong>${art}${jahr ? ' ' + jahr : ''}</strong> beim Finanzamt eingelegt haben.</p>
          <p>Wir halten Sie über den weiteren Verlauf auf dem Laufenden. Für Rückfragen stehen wir jederzeit zur Verfügung.</p>
          <p>Mit freundlichen Grüßen<br>${kanzleiName}</p>`
      })
    });
    db.prepare('INSERT INTO bescheid_aktivitaet (bescheid_id, kanzlei_id, aktion, details) VALUES (?,?,?,?)')
      .run(b.id, req.kanzleiId, 'Mandant informiert', `E-Mail an ${mandantEmail}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Mandant informieren]', e.message);
    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + e.message });
  }
});

// POST /api/kanzlei/bescheide/:id/analysis ← KI-AGENT SCHREIBT HIER REIN
app.post('/api/kanzlei/bescheide/:id/analysis', kanzleiMiddleware, (req, res) => {
  const b = db.prepare('SELECT * FROM bescheide WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!b) return res.status(404).json({ error: 'Bescheid nicht gefunden' });
  const { documentType, confidence, summary, fields, deadlines, flags, clientMatch, raw_response } = req.body;
  if (!documentType) return res.status(400).json({ error: 'documentType erforderlich' });

  const lastVersion = db.prepare('SELECT MAX(version) as v FROM bescheid_analysis WHERE bescheid_id=?').get(req.params.id);
  const version = (lastVersion?.v || 0) + 1;

  const normalizedResult = { documentType, confidence, summary, fields: fields||{}, deadlines: deadlines||[], flags: flags||[], clientMatch: clientMatch||null };

  const analysis = db.prepare(`
    INSERT INTO bescheid_analysis (bescheid_id, version, source, status, raw_response_json, normalized_result_json, confidence_overall, summary, created_by)
    VALUES (?,?,'ai_agent','completed',?,?,?,?,?)
  `).run(req.params.id, version, raw_response ? JSON.stringify(raw_response) : null, JSON.stringify(normalizedResult), confidence||null, summary||null, req.body.agent_id||'ai_agent');
  const analysisId = analysis.lastInsertRowid;

  if (fields && typeof fields === 'object') {
    for (const [name, value] of Object.entries(fields)) {
      db.prepare(`INSERT OR REPLACE INTO bescheid_fields (bescheid_id, analysis_id, field_name, field_value_json, value_type, created_at, updated_at)
        VALUES (?,?,?,?,'extracted',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
        .run(req.params.id, analysisId, name, JSON.stringify(value));
    }
  }

  if (deadlines && Array.isArray(deadlines)) {
    for (const dl of deadlines) {
      db.prepare(`INSERT INTO bescheid_deadlines (bescheid_id, deadline_type, suggested_date, suggestion_reason, suggestion_confidence, status)
        VALUES (?,?,?,?,?,'vorgeschlagen')`)
        .run(req.params.id, dl.type||null, dl.date||null, dl.reason||null, dl.confidence||null);
    }
  }

  const requiresManual = flags && flags.includes('manual_review') ? 1 : 0;
  const deadlineStatus = (deadlines && deadlines.length > 0) ? 'vorgeschlagen' : 'keine';
  db.prepare(`UPDATE bescheide SET status='analysiert', analysis_status='completed', document_type=?, analysis_result_json=?,
    analysis_confidence=?, analysis_version=?, analysis_source='ai_agent', analyzed_at=CURRENT_TIMESTAMP,
    requires_manual_review=?, deadline_status=?, review_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(documentType, JSON.stringify(normalizedResult), confidence||null, version, requiresManual,
      deadlineStatus, requiresManual ? 'manuell_korrigieren' : 'fachlich_pruefen', req.params.id);

  console.log(`[BESCHEID] Analysis written id=${req.params.id} version=${version} type=${documentType} confidence=${confidence}`);
  res.json({ ok: true, analysis_id: analysisId, version });
});

// GET /api/kanzlei/bescheide/:id/analysis — Analysehistorie
app.get('/api/kanzlei/bescheide/:id/analysis', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM bescheid_analysis WHERE bescheid_id=? ORDER BY version DESC').all(req.params.id);
  res.json(rows);
});

// PATCH /api/kanzlei/bescheide/:id/fields/:fieldId — Manuelle Feldkorrektur
app.patch('/api/kanzlei/bescheide/:id/fields/:fieldId', kanzleiMiddleware, (req, res) => {
  const { corrected_value } = req.body;
  if (corrected_value === undefined) return res.status(400).json({ error: 'corrected_value erforderlich' });
  db.prepare(`UPDATE bescheid_fields SET is_user_corrected=1, corrected_value_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND bescheid_id=?`)
    .run(JSON.stringify(corrected_value), req.params.fieldId, req.params.id);
  res.json({ ok: true });
});

// POST /api/kanzlei/bescheide/:id/deadlines/:dlId/accept — Fristenvorschlag übernehmen
app.post('/api/kanzlei/bescheide/:id/deadlines/:dlId/accept', kanzleiMiddleware, (req, res) => {
  const dl = db.prepare('SELECT * FROM bescheid_deadlines WHERE id=? AND bescheid_id=?').get(req.params.dlId, req.params.id);
  if (!dl) return res.status(404).json({ error: 'Nicht gefunden' });
  const b = db.prepare('SELECT * FROM bescheide WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  const fristResult = db.prepare(`INSERT INTO fristen (kanzlei_id, mandant_id, mandant_name, titel, typ, faellig_am, notiz)
    VALUES (?,?,?,?,?,?,?)`)
    .run(req.kanzleiId, b.mandant_id||null, b.mandant_name||null,
      `${dl.deadline_type||'Frist'}: ${b.original_filename||b.mandant_name||'Bescheid'}`,
      dl.deadline_type||'sonstige', dl.suggested_date,
      `Automatisch aus Bescheid-Analyse erstellt. Bescheid-ID: ${req.params.id}`);
  db.prepare('UPDATE bescheid_deadlines SET status=?, frist_id=? WHERE id=?').run('bestaetigt', fristResult.lastInsertRowid, dl.id);
  db.prepare('UPDATE bescheide SET deadline_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('angelegt', req.params.id);
  res.json({ ok: true, frist_id: fristResult.lastInsertRowid });
});

// POST /api/kanzlei/bescheide/:id/aktivitaet — Aktivitätslog-Eintrag schreiben
app.post('/api/kanzlei/bescheide/:id/aktivitaet', kanzleiMiddleware, (req, res) => {
  const { aktion, details } = req.body;
  if (!aktion) return res.status(400).json({ error: 'aktion fehlt' });
  const r = db.prepare(
    'INSERT INTO bescheid_aktivitaet (bescheid_id, kanzlei_id, aktion, details) VALUES (?,?,?,?) RETURNING *'
  ).get(req.params.id, req.kanzleiId, aktion, details || null);
  res.json(r);
});

// POST /api/kanzlei/bescheide/:id/abweichungen/:abwId/toggle — fuer_einspruch umschalten
app.post('/api/kanzlei/bescheide/:id/abweichungen/:abwId/toggle', kanzleiMiddleware, (req, res) => {
  const abw = db.prepare('SELECT * FROM bescheid_abweichungen WHERE id=? AND bescheid_id=?')
    .get(req.params.abwId, req.params.id);
  if (!abw) return res.status(404).json({ error: 'Nicht gefunden' });
  const neu = abw.fuer_einspruch ? 0 : 1;
  db.prepare('UPDATE bescheid_abweichungen SET fuer_einspruch=? WHERE id=?').run(neu, abw.id);
  res.json({ ok: true, fuer_einspruch: neu });
});

// POST /api/kanzlei/bescheide/:id/grundlagenbescheid — Grundlagenbescheid verknüpfen
app.post('/api/kanzlei/bescheide/:id/grundlagenbescheid', kanzleiMiddleware, (req, res) => {
  const { grundlagenbescheid_id } = req.body;
  if (!grundlagenbescheid_id) return res.status(400).json({ error: 'grundlagenbescheid_id fehlt' });
  db.prepare('UPDATE bescheide SET grundlagenbescheid_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND kanzlei_id=?')
    .run(grundlagenbescheid_id, req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// GET /api/kanzlei/bescheide/:id/file — Datei downloaden (v2, aus neuem Upload-Verzeichnis)
app.get('/api/kanzlei/bescheide/:id/file', kanzleiMiddleware, (req, res) => {
  const b = db.prepare('SELECT * FROM bescheide WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!b || !b.storage_path) return res.status(404).json({ error: 'Datei nicht gefunden' });
  if (!fs.existsSync(b.storage_path)) return res.status(404).json({ error: 'Datei nicht auf Disk' });
  res.setHeader('Content-Type', b.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(b.original_filename||'dokument')}"`);
  fs.createReadStream(b.storage_path).pipe(res);
});

// POST /api/kanzlei/bescheide/:id/einspruchsschreiben — KI generiert Einspruchsentwurf
app.post('/api/kanzlei/bescheide/:id/einspruchsschreiben', kanzleiMiddleware, async (req, res) => {
  const b = db.prepare(`
    SELECT b.*, u.name as mandant_name_resolved, u.email as mandant_email_resolved
    FROM bescheide b LEFT JOIN users u ON u.id=b.mandant_id
    WHERE b.id=? AND b.kanzlei_id=?
  `).get(req.params.id, req.kanzleiId);
  if (!b) return res.status(404).json({ error: 'Nicht gefunden' });

  const abweichungen = db.prepare('SELECT * FROM bescheid_abweichungen WHERE bescheid_id=? AND fuer_einspruch=1').all(b.id);
  const mandantName  = b.mandant_name_resolved || b.mandant_name || 'Mandant';
  const bescheidArt  = b.document_type || b.art || 'Steuerbescheid';
  const jahr         = b.tax_year || b.jahr || '';
  const finanzamt    = b.finanzamt || 'das zuständige Finanzamt';
  const adv          = b.adv_beantragt === 1 || req.body.adv === true;

  const abwText = abweichungen.length > 0
    ? abweichungen.map(a =>
        `- ${a.titel}: erklärt ${a.erklaert || '?'}, festgesetzt ${a.festgesetzt || '?'}` +
        (a.differenz != null ? ` (Differenz: ${a.differenz.toFixed(2)} €)` : '')
      ).join('\n')
    : '(Keine Abweichungen ausgewählt — allgemeine Einspruchsbegründung)';

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: `Du bist ein erfahrener Steuerberater-Assistent in Deutschland.
Schreibe einen formellen Einspruch gegen einen deutschen Steuerbescheid.
Ausgabe: Nur den reinen Einspruchstext als Fließtext — kein Markdown, keine Formatierungen, keine Emojis.
Der Text muss direkt für ELSTER einsetzbar sein — also ohne Briefkopf, nur der Textinhalt.
${adv ? 'Füge am Ende einen eigenen Absatz zur Beantragung der Aussetzung der Vollziehung (AdV) gemäß §361 AO ein.' : ''}`,
      messages: [{ role: 'user', content:
        `Mandant: ${mandantName}
Bescheidart: ${bescheidArt}
Steuerjahr: ${jahr}
Finanzamt: ${finanzamt}
Aktenzeichen: ${b.aktenzeichen || '—'}
Bescheiddatum: ${b.bescheid_datum || '—'}

Abweichungen:
${abwText}

Bitte schreibe einen sachlichen, rechtlich fundierten Einspruch.`
      }]
    });
    res.json({ text: msg.content[0].text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kanzlei/bescheide/:id/generate-einspruch — KI-Einspruch per Streaming
app.post('/api/kanzlei/bescheide/:id/generate-einspruch', kanzleiMiddleware, async (req, res) => {
  const b = db.prepare('SELECT b.*, u.name as mandant_name_resolved, u.email as mandant_email_resolved FROM bescheide b LEFT JOIN users u ON u.id=b.mandant_id WHERE b.id=? AND b.kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!b) return res.status(404).json({ error: 'Nicht gefunden' });
  const fields = db.prepare('SELECT * FROM bescheid_fields WHERE bescheid_id=?').all(b.id);

  // Kanzlei-Briefkopf
  const kanzlei = db.prepare('SELECT * FROM kanzlei_settings WHERE kanzlei_id=?').get(req.kanzleiId) || {};

  // Mandant-User-ID ermitteln (mit Name-Fallback, falls mandant_id nicht gesetzt)
  let mandantUserId = b.mandant_id;
  if (!mandantUserId && b.mandant_name) {
    const nameNorm = (b.mandant_name || '').replace('[DEMO] ', '').trim();
    const u = db.prepare('SELECT id FROM users WHERE kanzlei_id=? AND (name=? OR name=?)').get(req.kanzleiId, nameNorm, '[DEMO] ' + nameNorm);
    if (u) mandantUserId = u.id;
  }

  // Mandant-Stammdaten aus letzter Submission (Anschrift, Steuer-ID, Steuernummer)
  let mandantAnswers = {};
  let hasVollmacht = false;
  if (mandantUserId) {
    const sub = db.prepare('SELECT id, answers FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(mandantUserId);
    if (sub) {
      if (sub.answers) { try { mandantAnswers = JSON.parse(sub.answers); } catch(e) {} }
      const vm = db.prepare("SELECT id FROM documents WHERE submission_id=? AND doc_key='vollmacht' AND filename IS NOT NULL").get(sub.id);
      hasVollmacht = !!vm;
    }
  }

  // Mandant-Anschrift + Name zusammenbauen
  const mandantFullName = (mandantAnswers.vorname || mandantAnswers.nachname)
    ? [mandantAnswers.vorname, mandantAnswers.nachname].filter(Boolean).join(' ')
    : (b.mandant_name_resolved || b.mandant_name || 'Unbekannt');
  const mandantStrasse = mandantAnswers.strasse || '';
  const mandantPLZOrt = [mandantAnswers.plz, mandantAnswers.ort].filter(Boolean).join(' ');
  const mandantSteuerId = mandantAnswers.steuer_id || '';
  const mandantSteuernummer = mandantAnswers.steuernummer || b.aktenzeichen || b.steuernummer || b.tax_number || '';

  const name = mandantFullName;
  const art = b.art || b.document_type || 'Steuerbescheid';
  const jahr = b.tax_year || b.jahr || '';
  const steuernummer = mandantSteuernummer || '—';
  const steuerId = mandantSteuerId || '—';

  const bescheidDatumISO = b.bescheid_datum || b.datum || null;
  const bescheidDatum = bescheidDatumISO ? new Date(bescheidDatumISO + 'T12:00:00').toLocaleDateString('de-DE') : '—';

  // Einspruchsfrist: bevorzugt bestätigte/gespeicherte, sonst berechnet
  let fristISO = b.einspruchsfrist_datum || null;
  if (!fristISO && bescheidDatumISO) {
    const _d = new Date(bescheidDatumISO + 'T12:00:00');
    _d.setDate(_d.getDate() + 3);
    _d.setMonth(_d.getMonth() + 1);
    fristISO = _d.toISOString().split('T')[0];
  }
  const fristDatum = fristISO ? new Date(fristISO + 'T12:00:00').toLocaleDateString('de-DE') : '—';

  const heute = new Date().toLocaleDateString('de-DE');

  const fieldLines = fields.map(f => {
    let v = f.field_value_json; try { v = JSON.parse(f.field_value_json); } catch(e) {}
    return `${f.field_name}: ${v}`;
  }).join('\n');

  // Ausgewählte Abweichungen berücksichtigen (falls übergeben)
  const selectedIds = Array.isArray(req.body?.abweichungen) ? req.body.abweichungen.map(x => parseInt(x, 10)).filter(Number.isFinite) : null;
  let abweichungenLines = '';
  if (selectedIds && selectedIds.length) {
    const placeholders = selectedIds.map(() => '?').join(',');
    const abwRows = db.prepare(`SELECT * FROM bescheid_abweichungen WHERE bescheid_id=? AND id IN (${placeholders})`).all(b.id, ...selectedIds);
    if (abwRows.length) {
      abweichungenLines = '\nNUR FOLGENDE ABWEICHUNGEN in den Einspruch aufnehmen (andere ignorieren):\n' +
        abwRows.map(a => {
          const diff = (a.differenz != null) ? ` (Differenz ${a.differenz} €)` : '';
          const sub = (a.erklaert || a.festgesetzt) ? ` — erklärt: ${a.erklaert||'—'}, festgesetzt: ${a.festgesetzt||'—'}${diff}` : '';
          return `  • ${a.titel}${sub}`;
        }).join('\n');
    }
  } else if (selectedIds && selectedIds.length === 0) {
    abweichungenLines = '\nKEINE spezifischen Abweichungen ausgewählt — Einspruch allgemein formulieren (Vorbehalt, Akteneinsicht, Begründung nachreichen).';
  }

  // Externen Agent-Prompt laden (live — kein Neustart nötig)
  const einspruchAgentPath = path.join(__dirname, 'agents', 'einspruch', 'agent.md');
  const einspruchAgentPrompt = fs.readFileSync(einspruchAgentPath, 'utf8');

  const kanzleiLines = [
    `Kanzlei-Name: ${kanzlei.name || 'H&K Automation — Steuerberatung'}`,
    kanzlei.strasse ? `Kanzlei-Straße: ${kanzlei.strasse}` : '',
    kanzlei.ort ? `Kanzlei-Ort: ${kanzlei.ort}` : '',
    kanzlei.telefon ? `Kanzlei-Telefon: ${kanzlei.telefon}` : '',
    kanzlei.email ? `Kanzlei-E-Mail: ${kanzlei.email}` : '',
    kanzlei.geschaeftsfuehrer ? `Sachbearbeiter/Geschäftsführer: ${kanzlei.geschaeftsfuehrer}` : '',
    `Heutiges Datum: ${heute}`
  ].filter(Boolean).join('\n');

  const mandantLines = [
    `Mandant (vollständiger Name): ${name}`,
    mandantStrasse ? `Mandant-Straße: ${mandantStrasse}` : '',
    mandantPLZOrt ? `Mandant-PLZ/Ort: ${mandantPLZOrt}` : '',
    `Steuernummer: ${steuernummer}`,
    steuerId !== '—' ? `Steuer-ID: ${steuerId}` : ''
  ].filter(Boolean).join('\n');

  const userContent = [
    '=== BRIEFKOPF (Kanzlei) ===',
    kanzleiLines,
    '',
    '=== MANDANT ===',
    mandantLines,
    '',
    '=== BESCHEID ===',
    `Art: ${art}${jahr ? ' ' + jahr : ''}`,
    `Bescheid vom: ${bescheidDatum}`,
    `Einspruchsfrist: ${fristDatum}`,
    b.finanzamt ? `Finanzamt: ${b.finanzamt}` : '',
    b.aktenzeichen ? `Aktenzeichen: ${b.aktenzeichen}` : '',
    b.betrag ? `Festgesetzter Betrag: ${b.betrag} EUR` : '',
    b.erklaerter_betrag ? `Erklärter Betrag: ${b.erklaerter_betrag} EUR` : '',
    '',
    `Vollmacht vorhanden: ${hasVollmacht ? 'JA — als Anlage "Steuerberatervollmacht" auflisten' : 'NEIN'}`,
    fieldLines ? `\nExtrahierte Felder:\n${fieldLines}` : '',
    b.ki_analyse ? `\nBescheid-Analyse:\n${b.ki_analyse}` : '',
    abweichungenLines,
    '',
    '=== WICHTIG ===',
    'Alle oben angegebenen Werte (Kanzlei-Briefkopf, Mandant-Anschrift, Steuernummer, Steuer-ID, Datumsangaben, Finanzamt) EXAKT im Schreiben einsetzen. KEINE Platzhalter in eckigen Klammern verwenden, wenn ein Wert oben gegeben ist. Nur wenn ein Wert wirklich fehlt (steht nicht oben), darf ein knapper Platzhalter wie "[Adresse Finanzamt]" verwendet werden.'
  ].filter(Boolean).join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const stream = await anthropic.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: einspruchAgentPrompt,
      messages: [{ role: 'user', content: userContent }]
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
        res.write(chunk.delta.text);
      }
    }
    res.end();
  } catch(e) {
    res.write('\n[Fehler: ' + e.message + ']');
    res.end();
  }
});

// ─── RECHNUNGEN ───────────────────────────────────────────────────────────────
function genRechnungsnummer(kanzleiId) {
  const year = new Date().getFullYear();
  const last = db.prepare(`SELECT rechnungsnummer FROM rechnungen WHERE kanzlei_id=? AND rechnungsnummer LIKE 'HK-${year}-%' ORDER BY id DESC LIMIT 1`).get(kanzleiId);
  let nr = 1;
  if (last?.rechnungsnummer) nr = parseInt(last.rechnungsnummer.split('-')[2]) + 1;
  return `HK-${year}-${String(nr).padStart(3,'0')}`;
}

app.get('/api/kanzlei/rechnungen', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM rechnungen WHERE kanzlei_id=? ORDER BY erstellt_am DESC').all(req.kanzleiId));
});
app.post('/api/kanzlei/rechnungen', kanzleiMiddleware, (req, res) => {
  const { mandant_name, mandant_email, beschreibung, betrag, faellig_am, positionen, mwst_satz } = req.body;
  if (!mandant_name || !beschreibung || !betrag) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const rechnungsnummer = genRechnungsnummer(req.kanzleiId);
  const r = db.prepare('INSERT INTO rechnungen (mandant_name,mandant_email,beschreibung,betrag,faellig_am,positionen,mwst_satz,rechnungsnummer,kanzlei_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(mandant_name, mandant_email||'', beschreibung, parseFloat(betrag), faellig_am||null, positionen||null, mwst_satz||19, rechnungsnummer, req.kanzleiId);
  res.json({ id: r.lastInsertRowid, rechnungsnummer });
});
app.patch('/api/kanzlei/rechnungen/:id', kanzleiMiddleware, (req, res) => {
  if (req.body.positionen !== undefined) {
    db.prepare('UPDATE rechnungen SET positionen=? WHERE id=? AND kanzlei_id=?').run(req.body.positionen, req.params.id, req.kanzleiId);
  }
  if (req.body.status !== undefined) db.prepare('UPDATE rechnungen SET status=? WHERE id=? AND kanzlei_id=?').run(req.body.status, req.params.id, req.kanzleiId);
  res.json({ ok: true });
});
app.delete('/api/kanzlei/rechnungen/:id', kanzleiMiddleware, (req, res) => {
  db.prepare('DELETE FROM rechnungen WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// KI-Assistent: Freitext → strukturierte Rechnungsdaten
app.post('/api/kanzlei/rechnungen/ki-parse', kanzleiMiddleware, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text fehlt' });
  try {
    const heute = new Date().toLocaleDateString('de-DE');
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1000,
      system: `Du bist Rechnungsassistent einer deutschen Steuerkanzlei. Heutiges Datum: ${heute}. Extrahiere aus dem Text Rechnungsdaten und antworte NUR mit einem JSON-Objekt (kein Markdown). Felder: mandant_name (string), mandant_email (string oder null), positionen (Array von {beschreibung: string, menge: number, einzelpreis_netto: number}), zahlungsziel_tage (number, Standard 14), mwst_satz (number, Standard 19), notiz (string oder null). WICHTIG für positionen: menge = tatsächliche Anzahl (Stunden, Einheiten etc.), einzelpreis_netto = Preis pro Einheit. Beispiel: "5 Stunden Steuerberatung à 50€ für Februar 2026" → {beschreibung: "Steuerberatung Februar 2026", menge: 5, einzelpreis_netto: 50.00}. Die beschreibung enthält NUR die Leistungsart, KEINE Stundenzahl.`,
      messages: [{ role: 'user', content: text }]
    });
    let raw = msg.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    res.json(JSON.parse(raw));
  } catch(e) {
    res.status(500).json({ error: 'KI-Fehler: ' + e.message });
  }
});

// Rechnung per E-Mail senden
app.post('/api/kanzlei/rechnungen/:id/senden', kanzleiMiddleware, async (req, res) => {
  const r = db.prepare('SELECT * FROM rechnungen WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!r) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  if (!r.mandant_email) return res.status(400).json({ error: 'Keine E-Mail-Adresse hinterlegt' });
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Automation Steuerberatungsgesellschaft mbH';
  const kanzleiStrasse = process.env.KANZLEI_STRASSE || '';
  const kanzleiOrt = process.env.KANZLEI_ORT || '';
  const kanzleiTel = process.env.KANZLEI_TEL || '';
  const kanzleiIban = process.env.KANZLEI_IBAN || '';
  const kanzleiBic = process.env.KANZLEI_BIC || '';
  const heute = new Date().toLocaleDateString('de-DE', {day:'2-digit',month:'long',year:'numeric'});
  const mwst = r.mwst_satz || 19;
  const positionen = r.positionen ? JSON.parse(r.positionen) : [{ beschreibung: r.beschreibung, menge: 1, einzelpreis_netto: parseFloat((r.betrag / (1 + mwst/100)).toFixed(2)) }];
  const nettoGesamt = positionen.reduce((s, p) => s + p.menge * p.einzelpreis_netto, 0);
  const mwstBetrag = nettoGesamt * mwst / 100;
  const bruttoGesamt = nettoGesamt + mwstBetrag;
  const faelligStr = r.faellig_am ? new Date(r.faellig_am+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'}) : '—';
  const fmt = n => n.toLocaleString('de-DE',{style:'currency',currency:'EUR'});
  const posRows = positionen.map((p,i) => `
    <tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:9px 6px;color:#888;font-size:13px">${i+1}</td>
      <td style="padding:9px 6px;font-size:14px">${p.beschreibung}</td>
      <td style="padding:9px 6px;text-align:center;color:#666;font-size:13px">${p.menge}</td>
      <td style="padding:9px 6px;text-align:right;font-size:13px">${fmt(p.einzelpreis_netto)}</td>
      <td style="padding:9px 6px;text-align:right;font-weight:600;font-size:14px">${fmt(p.menge*p.einzelpreis_netto)}</td>
    </tr>`).join('');
  const _staffR = getStaffForEmail(req.staffId);
  const { pdf_base64, to_email, custom_subject, intro_text } = req.body || {};
  const toAddr = to_email || r.mandant_email;
  const introSection = intro_text ? `<div style="margin-bottom:24px;padding:16px 20px;background:#f8f9ff;border-radius:8px;font-size:14px;line-height:1.8;color:#333;white-space:pre-wrap">${intro_text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>` : '';
  const invoiceBody = `${introSection}<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #f0f0f4">
    <div>
      <div style="font-size:20px;font-weight:800;color:#1a1a2e;letter-spacing:-.3px">RECHNUNG</div>
      <div style="font-size:13px;color:#888;margin-top:3px">${r.rechnungsnummer||''}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Rechnungsdatum</div>
      <div style="font-size:14px;color:#333;font-weight:500">${heute}</div>
      <div style="font-size:11px;color:#888;margin-top:8px">Zahlbar bis</div>
      <div style="font-size:14px;font-weight:700;color:#1a1a2e">${faelligStr}</div>
    </div>
  </div>
  <div style="margin-bottom:28px">
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Rechnungsempfänger</div>
    <div style="font-weight:700;font-size:15px;color:#1a1a2e">${r.mandant_name}</div>
    <div style="color:#555;font-size:13px">${r.mandant_email}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <thead>
      <tr style="background:#f8f8f8">
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px;width:28px">#</th>
        <th style="padding:10px 8px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Leistung</th>
        <th style="padding:10px 8px;text-align:center;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px;width:48px">Menge</th>
        <th style="padding:10px 8px;text-align:right;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Einzelpreis</th>
        <th style="padding:10px 8px;text-align:right;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Gesamt</th>
      </tr>
    </thead>
    <tbody>${posRows}</tbody>
  </table>
  <div style="margin-left:auto;width:280px">
    <div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:#666"><span>Nettobetrag</span><span>${fmt(nettoGesamt)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:#666;border-bottom:1px solid #eee"><span>MwSt. ${mwst}%</span><span>${fmt(mwstBetrag)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:17px;font-weight:800;color:#1a1a2e;border-top:2px solid #1a1a2e;margin-top:2px"><span>Gesamtbetrag</span><span>${fmt(bruttoGesamt)}</span></div>
  </div>
  ${kanzleiIban ? `<div style="margin-top:28px;padding:16px 20px;background:#f8f9ff;border-radius:8px;border-left:3px solid #6d7aff">
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Bankverbindung</div>
    <div style="font-size:13px;color:#333">IBAN: <strong>${kanzleiIban}</strong>${kanzleiBic?`&nbsp;&nbsp;·&nbsp;&nbsp;BIC: <strong>${kanzleiBic}</strong>`:''}</div>
    <div style="font-size:12px;color:#888;margin-top:4px">Bitte Rechnungsnummer ${r.rechnungsnummer||''} als Verwendungszweck angeben.</div>
  </div>` : ''}`;
  const finalHtml = buildEmailHtml({ body: invoiceBody, staff: _staffR });
  try {
    const emailPayload = {
      from: FROM_EMAIL, to: toAddr,
      subject: custom_subject || `Rechnung ${r.rechnungsnummer||''} – ${kanzleiName}`,
      html: finalHtml
    };
    if (pdf_base64) {
      emailPayload.attachments = [{
        filename: `Rechnung_${(r.rechnungsnummer||r.id).replace(/\//g,'-')}.pdf`,
        content: pdf_base64
      }];
    }
    await resend.emails.send(emailPayload);
    db.prepare("UPDATE rechnungen SET gesendet_am=datetime('now') WHERE id=?").run(r.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── MAHNUNG HELPER ───────────────────────────────────────────────────────────
async function sendMahnungEmail(rechnung, nr = 1, staffForMahnung = null) {
  if (!rechnung.mandant_email) throw new Error('Keine E-Mail-Adresse hinterlegt');
  const heute = new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'});
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Automation Steuerberatungsgesellschaft mbH';
  const kanzleiEmail = process.env.KANZLEI_EMAIL || '';
  const nrText = nr === 1 ? 'erste Mahnung (Zahlungserinnerung)' : nr === 2 ? 'zweite Mahnung (letzte freundliche Erinnerung)' : 'dritte und letzte Mahnung (vor Einleitung rechtlicher Schritte)';
  const betreff = nr === 1 ? `Zahlungserinnerung – ${rechnung.beschreibung}` : `${nr}. Mahnung – ${rechnung.beschreibung}`;
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 800,
    system: `Du bist Mitarbeiter der Kanzlei ${kanzleiName}. Schreibe eine professionelle ${nrText}. Datum: ${heute}. Kein Markdown, keine Emojis. Beginne direkt mit der Anrede. Ende mit "Mit freundlichen Grüßen\n${kanzleiName}\n${kanzleiEmail}".`,
    messages:[{role:'user',content:`Mandant: ${rechnung.mandant_name}\nLeistung: ${rechnung.beschreibung}\nBetrag: ${rechnung.betrag.toLocaleString('de-DE',{style:'currency',currency:'EUR'})}\nFällig seit: ${rechnung.faellig_am ? new Date(rechnung.faellig_am+'T12:00:00').toLocaleDateString('de-DE') : 'unbekannt'}\nMahnung Nr.: ${nr}\n\nSchreibe die Mahnung.`}]
  });
  await resend.emails.send({
    from: FROM_EMAIL, to: rechnung.mandant_email, subject: betreff,
    html: buildEmailHtml({ body: msg.content[0].text.replace(/\n/g,'<br>'), staff: staffForMahnung || null })
  });
  const col = nr === 1 ? 'mahnung_am' : nr === 2 ? 'mahnung_2_am' : 'mahnung_3_am';
  db.prepare(`UPDATE rechnungen SET ${col}=datetime("now") WHERE id=?`).run(rechnung.id);
}

// POST /api/kanzlei/rechnungen/:id/mahnung — Mahnung manuell senden
app.post('/api/kanzlei/rechnungen/:id/mahnung', kanzleiMiddleware, async (req, res) => {
  const rechnung = db.prepare('SELECT * FROM rechnungen WHERE id=?').get(req.params.id);
  if (!rechnung) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  try {
    const nr = rechnung.mahnung_2_am ? 3 : rechnung.mahnung_am ? 2 : 1;
    const _staffM = getStaffForEmail(req.staffId);
    await sendMahnungEmail(rechnung, nr, _staffM);
    res.json({ ok: true, nr });
  } catch(e) {
    console.error('Mahnung Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── AUTO-MAHNUNG (täglich, gestaffelt: 14/28/42 Tage nach Fälligkeit) ────────
async function autoMahnungCheck() {
  try {
    const today = new Date().toISOString().slice(0,10);
    const grenze1 = new Date(); grenze1.setDate(grenze1.getDate()-14);
    const grenze2 = new Date(); grenze2.setDate(grenze2.getDate()-28);
    const grenze3 = new Date(); grenze3.setDate(grenze3.getDate()-42);
    const alle = db.prepare(`SELECT r.* FROM rechnungen r JOIN kanzleien k ON k.id=r.kanzlei_id WHERE r.status='offen' AND r.faellig_am IS NOT NULL AND r.mandant_email != '' AND k.active=1`).all();
    for (const r of alle) {
      try {
        if (!r.mahnung_am && r.faellig_am <= grenze1.toISOString().slice(0,10)) {
          await sendMahnungEmail(r, 1); console.log(`[Auto-Mahnung 1] ${r.mandant_name}`);
        } else if (r.mahnung_am && !r.mahnung_2_am && r.faellig_am <= grenze2.toISOString().slice(0,10)) {
          await sendMahnungEmail(r, 2); console.log(`[Auto-Mahnung 2] ${r.mandant_name}`);
        } else if (r.mahnung_2_am && !r.mahnung_3_am && r.faellig_am <= grenze3.toISOString().slice(0,10)) {
          await sendMahnungEmail(r, 3); console.log(`[Auto-Mahnung 3] ${r.mandant_name}`);
        }
      } catch(e) { console.error(`[Auto-Mahnung] Fehler ${r.mandant_name}:`, e.message); }
    }
  } catch(e) { console.error('[Auto-Mahnung] Check-Fehler:', e.message); }
}
// Auto-Mahnungen deaktiviert – Steuerberater entscheiden manuell

// ─── KALENDER ─────────────────────────────────────────────────────────────────
try { db.exec("ALTER TABLE kalender_termine ADD COLUMN sichtbarkeit TEXT DEFAULT 'alle'"); } catch(e) {}
try { db.exec('ALTER TABLE kalender_termine ADD COLUMN erstellt_von INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE kalender_termine ADD COLUMN zoom_link TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE kalender_termine ADD COLUMN reminder_minuten INTEGER DEFAULT 0'); } catch(e) {}

app.get('/api/kanzlei/kalender', kanzleiMiddleware, (req, res) => {
  const staffId = req.staffId || 0;
  // Zeige: alle 'alle'-Termine + eigene 'ich'-Termine + eigene 'fokus'-Termine
  const rows = db.prepare(`
    SELECT * FROM kalender_termine
    WHERE kanzlei_id=?
      AND (sichtbarkeit='alle' OR erstellt_von=? OR sichtbarkeit IS NULL)
    ORDER BY datum ASC, uhrzeit ASC
  `).all(req.kanzleiId, staffId);
  res.json(rows);
});

app.post('/api/kanzlei/kalender', kanzleiMiddleware, (req, res) => {
  const { titel, mandant_name, datum, uhrzeit, uhrzeit_ende, typ, notiz, ort, sichtbarkeit, zoom_link, reminder_minuten } = req.body;
  if (!titel || !datum) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const sicht = (typ === 'fokus') ? 'ich' : (sichtbarkeit || 'alle');
  const r = db.prepare(`INSERT INTO kalender_termine
    (titel,mandant_name,datum,uhrzeit,uhrzeit_ende,typ,notiz,ort,kanzlei_id,sichtbarkeit,erstellt_von,zoom_link,reminder_minuten)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(titel, mandant_name||'', datum, uhrzeit||'', uhrzeit_ende||'', typ||'termin',
         notiz||'', ort||'', req.kanzleiId, sicht, req.staffId||0, zoom_link||'', reminder_minuten||0);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/kanzlei/kalender/:id', kanzleiMiddleware, (req, res) => {
  const { titel, mandant_name, datum, uhrzeit, uhrzeit_ende, typ, notiz, ort, sichtbarkeit, zoom_link, reminder_minuten } = req.body;
  if (!titel || !datum) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  db.prepare(`UPDATE kalender_termine SET titel=?,mandant_name=?,datum=?,uhrzeit=?,uhrzeit_ende=?,typ=?,notiz=?,ort=?,sichtbarkeit=?,zoom_link=?,reminder_minuten=?
    WHERE id=? AND kanzlei_id=?`)
    .run(titel, mandant_name||'', datum, uhrzeit||'', uhrzeit_ende||'', typ||'termin',
         notiz||'', ort||'', sichtbarkeit||'alle', zoom_link||'', reminder_minuten||0,
         req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

app.delete('/api/kanzlei/kalender/:id', kanzleiMiddleware, (req, res) => {
  db.prepare('DELETE FROM kalender_termine WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// ─── FRISTEN ──────────────────────────────────────────────────────────────────
app.get('/api/kanzlei/fristen', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM fristen WHERE kanzlei_id=? ORDER BY faellig_am ASC').all(req.kanzleiId));
});
app.post('/api/kanzlei/fristen', kanzleiMiddleware, (req, res) => {
  const { mandant_id, mandant_name, titel, typ, faellig_am, notiz, bescheid_id } = req.body;
  if (!titel || !faellig_am) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  // Idempotenz: wenn schon eine offene Frist für denselben Bescheid+Typ existiert, nicht neu anlegen
  if (bescheid_id) {
    const existing = db.prepare('SELECT id, faellig_am FROM fristen WHERE kanzlei_id=? AND bescheid_id=? AND typ=? AND erledigt=0')
      .get(req.kanzleiId, bescheid_id, typ||'sonstige');
    if (existing) {
      if (existing.faellig_am !== faellig_am) {
        db.prepare('UPDATE fristen SET faellig_am=? WHERE id=?').run(faellig_am, existing.id);
      }
      return res.json({ id: existing.id, reused: true });
    }
  }
  const r = db.prepare('INSERT INTO fristen (mandant_id,mandant_name,titel,typ,faellig_am,notiz,bescheid_id,kanzlei_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(mandant_id||null, mandant_name||'', titel, typ||'sonstige', faellig_am, notiz||'', bescheid_id||null, req.kanzleiId);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/kanzlei/fristen/:id', kanzleiMiddleware, (req, res) => {
  const { erledigt } = req.body;
  db.prepare('UPDATE fristen SET erledigt=? WHERE id=? AND kanzlei_id=?').run(erledigt?1:0, req.params.id, req.kanzleiId);
  res.json({ ok: true });
});
app.delete('/api/kanzlei/fristen/:id', kanzleiMiddleware, (req, res) => {
  db.prepare('DELETE FROM fristen WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// ─── AUFGABEN ─────────────────────────────────────────────────────────────────
app.get('/api/kanzlei/aufgaben', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM aufgaben WHERE kanzlei_id=? ORDER BY faellig_am ASC, created_at DESC').all(req.kanzleiId));
});
app.post('/api/kanzlei/aufgaben', kanzleiMiddleware, (req, res) => {
  const { mandant_id, mandant_name, titel, beschreibung, prioritaet, faellig_am } = req.body;
  if (!titel) return res.status(400).json({ error: 'Titel fehlt' });
  const r = db.prepare('INSERT INTO aufgaben (mandant_id,mandant_name,titel,beschreibung,prioritaet,faellig_am,kanzlei_id) VALUES (?,?,?,?,?,?,?)')
    .run(mandant_id||null, mandant_name||'', titel, beschreibung||'', prioritaet||'normal', faellig_am||null, req.kanzleiId);
  res.json({ id: r.lastInsertRowid });
});
app.patch('/api/kanzlei/aufgaben/:id', kanzleiMiddleware, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE aufgaben SET status=? WHERE id=? AND kanzlei_id=?').run(status, req.params.id, req.kanzleiId);
  res.json({ ok: true });
});
app.delete('/api/kanzlei/aufgaben/:id', kanzleiMiddleware, (req, res) => {
  db.prepare('DELETE FROM aufgaben WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// ─── BWA DOLMETSCHER ──────────────────────────────────────────────────────────
app.get('/api/kanzlei/bwa', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM bwa_analysen WHERE kanzlei_id=? ORDER BY erstellt_am DESC').all(req.kanzleiId));
});

// GET /api/kanzlei/bwa/dokumente — Dokumente für BWA eines Mandanten abrufen
app.get('/api/kanzlei/bwa/dokumente', kanzleiMiddleware, (req, res) => {
  const { mandant_name, zeitraum_monat, zeitraum_jahr } = req.query;
  if (!mandant_name) return res.status(400).json({ error: 'mandant_name fehlt' });
  const kid = req.kanzleiId || 1;
  let query = `SELECT bd.*, di.dateiname AS originalname, di.dateipfad AS filepath, di.typ, di.typ_label
    FROM bwa_dokumente bd
    JOIN dokument_inbox di ON di.id = bd.inbox_id
    WHERE bd.mandant_name=? AND bd.kanzlei_id=?`;
  const params = [mandant_name, kid];
  if (zeitraum_monat) { query += ' AND bd.zeitraum_monat=?'; params.push(zeitraum_monat); }
  if (zeitraum_jahr)  { query += ' AND bd.zeitraum_jahr=?';  params.push(zeitraum_jahr);  }
  query += ' ORDER BY bd.zeitraum_jahr DESC, bd.zeitraum_monat DESC';
  const docs = db.prepare(query).all(...params);

  // Vollständigkeitsprüfung
  const kategorien = ['umsatzerloese', 'betriebsausgaben', 'umsatz_kosten'];
  const vorhandene = new Set(docs.map(d => d.bwa_kategorie));
  const fehlend = kategorien.filter(k => !vorhandene.has(k));
  res.json({ dokumente: docs, fehlend, vollstaendig: fehlend.length === 0 });
});

// GET /api/kanzlei/bwa/dokumente/alle — Alle BWA-Dokumente aller Mandanten
app.get('/api/kanzlei/bwa/dokumente/alle', kanzleiMiddleware, (req, res) => {
  const kid = req.kanzleiId || 1;
  const docs = db.prepare(`
    SELECT bd.*, di.dateiname AS filename, di.dateipfad AS filepath
    FROM bwa_dokumente bd
    JOIN dokument_inbox di ON di.id = bd.inbox_id
    WHERE bd.kanzlei_id=?
    ORDER BY bd.mandant_name, bd.zeitraum_jahr DESC, bd.zeitraum_monat DESC, bd.erstellt_am DESC
  `).all(kid);
  res.json(docs);
});

// GET /api/kanzlei/bwa/dokument/:id/file — Datei ausliefern
app.get('/api/kanzlei/bwa/dokument/:id/file', kanzleiMiddleware, (req, res) => {
  const kid = req.kanzleiId || 1;
  const doc = db.prepare(`
    SELECT bd.*, di.dateiname AS filename, di.dateipfad AS filepath
    FROM bwa_dokumente bd
    JOIN dokument_inbox di ON di.id = bd.inbox_id
    WHERE bd.id=? AND bd.kanzlei_id=?
  `).get(req.params.id, kid);
  if (!doc || !doc.filepath) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!require('fs').existsSync(doc.filepath)) return res.status(404).json({ error: 'Datei nicht mehr vorhanden' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.filename}"`);
  res.sendFile(require('path').resolve(doc.filepath));
});

// BWA Hilfsfunktionen
function parseBetrag(betrag) {
  if (!betrag) return 0;
  const s = String(betrag).replace(/EUR|€|\s/g, '');
  // German format: 1.234,56 → remove dot as thousand sep, comma as decimal
  const cleaned = s.replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : Math.abs(v);
}

function computeBwaRows(docs) {
  const umsatzDocs    = docs.filter(d => d.bwa_kategorie === 'umsatzerloese');
  const materialDocs  = docs.filter(d => d.bwa_kategorie === 'betriebsausgaben');
  const personalDocs  = docs.filter(d => d.bwa_kategorie === 'personalkosten');
  const internDocs    = docs.filter(d => d.bwa_kategorie === 'interne_verrechnung');
  const steuerDocs    = docs.filter(d => d.bwa_kategorie === 'steuern');
  const sum = arr => arr.reduce((s, d) => s + parseBetrag(d.betrag), 0);
  const toDetail = arr => arr.map(d => ({
    name: d.originalname || 'Unbekannt',
    betrag: parseBetrag(d.betrag),
    monat: d.zeitraum_monat,
    jahr: d.zeitraum_jahr
  }));
  const umsatz   = sum(umsatzDocs);
  const material = sum(materialDocs);
  const personal = sum(personalDocs);
  const intern   = sum(internDocs);
  const steuern  = sum(steuerDocs);
  const rohertrag1     = umsatz - material;
  const rohertrag2     = rohertrag1 - personal;
  const betriebsergebnis = rohertrag2 - intern;
  const jahresergebnis   = betriebsergebnis - steuern;
  return {
    umsatz, material, personal, intern, steuern,
    rohertrag1, rohertrag2, betriebsergebnis, jahresergebnis,
    details: {
      umsatzerloese:        toDetail(umsatzDocs),
      betriebsausgaben:     toDetail(materialDocs),
      personalkosten:       toDetail(personalDocs),
      interne_verrechnung:  toDetail(internDocs),
      steuern:              toDetail(steuerDocs)
    }
  };
}

// POST /api/kanzlei/bwa/erstellen — BWA aus Scanner-Dokumenten erstellen
app.post('/api/kanzlei/bwa/erstellen', kanzleiMiddleware, async (req, res) => {
  const { mandant_name, zeitraum_monat, zeitraum_jahr, force } = req.body;
  if (!mandant_name) return res.status(400).json({ error: 'mandant_name fehlt' });
  const kid = req.kanzleiId || 1;

  // Alle BWA-Dokumente für diesen Mandanten + Zeitraum holen
  let query = `SELECT bd.*, di.dateiname AS originalname, di.dateipfad AS filepath, di.typ_label, bd.bwa_kategorie as kat, di.betrag
    FROM bwa_dokumente bd
    JOIN dokument_inbox di ON di.id = bd.inbox_id
    WHERE bd.mandant_name=? AND bd.kanzlei_id=?`;
  const params = [mandant_name, kid];
  if (zeitraum_monat) { query += ' AND bd.zeitraum_monat=?'; params.push(zeitraum_monat); }
  if (zeitraum_jahr)  { query += ' AND bd.zeitraum_jahr=?';  params.push(zeitraum_jahr); }
  const docs = db.prepare(query).all(...params);

  // Vollständigkeitsprüfung
  const pflicht = ['umsatzerloese', 'umsatz_kosten', 'betriebsausgaben'];
  const vorhandene = new Set(docs.map(d => d.bwa_kategorie));
  const fehlend = pflicht.filter(k => !vorhandene.has(k));

  if (fehlend.length > 0 && !force) {
    const labels = { umsatzerloese: 'Ausgangsrechnungen', umsatz_kosten: 'Kontoauszüge', betriebsausgaben: 'Eingangsrechnungen / Belege', personalkosten: 'Lohnabrechnungen' };
    return res.status(422).json({ fehlend: fehlend.map(k => ({ kategorie: k, label: labels[k] || k })), dokumente: docs.length, unvollstaendig: true });
  }

  try {
    // Alle PDFs einlesen und kombinieren
    let kombinierterText = '';
    for (const doc of docs) {
      if (doc.filepath && fs.existsSync(doc.filepath)) {
        try {
          let text;
          if (doc.filepath.endsWith('.pdf')) {
            text = (await pdfParse(fs.readFileSync(doc.filepath))).text.slice(0, 3000);
          } else {
            text = fs.readFileSync(doc.filepath, 'utf8').slice(0, 3000);
          }
          kombinierterText += `\n\n=== ${doc.typ_label || doc.bwa_kategorie} (${doc.originalname}) ===\n${text}`;
        } catch(e) { /* Datei nicht lesbar, überspringen */ }
      }
    }

    if (!kombinierterText.trim()) return res.status(400).json({ error: 'Keine lesbaren Dokumente gefunden' });

    // Vorherige BWA für Trendvergleich laden
    const vorherigeAnalyse = db.prepare(`SELECT analyse, kurzfazit, erstellt_am FROM bwa_analysen WHERE mandant_name=? AND kanzlei_id=? ORDER BY erstellt_am DESC LIMIT 1`).get(mandant_name, kid);

    const agentPath = path.join(__dirname, 'agents', 'bwa-dolmetscher', 'agent.md');
    const agentPrompt = fs.readFileSync(agentPath, 'utf8');

    const userContent = [
      `Mandant: ${mandant_name}`,
      zeitraum_monat && zeitraum_jahr ? `Zeitraum: ${zeitraum_monat}/${zeitraum_jahr}` : zeitraum_jahr ? `Jahr: ${zeitraum_jahr}` : '',
      vorherigeAnalyse ? `\nVorperiode (${new Date(vorherigeAnalyse.erstellt_am).toLocaleDateString('de-DE')}):\n${vorherigeAnalyse.kurzfazit || vorherigeAnalyse.analyse?.slice(0,300)}` : '',
      `\nDOKUMENTE:${kombinierterText}`
    ].filter(Boolean).join('\n');

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 4000,
      system: agentPrompt,
      messages: [{ role: 'user', content: userContent }]
    });

    const raw = msg.content[0].text.trim().replace(/^```json\s*/,'').replace(/```\s*$/,'').trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch(e) {
      parsed = { analyse: msg.content[0].text, kurzfazit: '', ampel: 'gelb', ampel_grund: '', kennzahlen: [], trendvergleich: '', email_betreff: '', email_text: '' };
    }

    const bwaRows = computeBwaRows(docs);

    const r = db.prepare(`INSERT INTO bwa_analysen (mandant_name, filename, originalname, analyse, ampel, kurzfazit, kennzahlen, bwa_rows, email_betreff, email_text, kanzlei_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(mandant_name, '', `BWA ${zeitraum_monat ? zeitraum_monat+'/' : ''}${zeitraum_jahr || ''}`.trim(),
        parsed.analyse || '', parsed.ampel || 'gelb', parsed.kurzfazit || '',
        JSON.stringify(parsed.kennzahlen || []), JSON.stringify(bwaRows),
        parsed.email_betreff || '', parsed.email_text || '', kid);

    res.json({ id: r.lastInsertRowid, ...parsed, mandant_name, zeitraum_monat, zeitraum_jahr, dokumente_anzahl: docs.length, bwa_rows: bwaRows });
  } catch(e) {
    console.error('[BWA Erstellen]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/kanzlei/bwa/analyse', kanzleiMiddleware, bwaUpload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine PDF hochgeladen' });
  const { mandant_name } = req.body;
  try {
    // Klotz-System-Prompt aus prompts/bwa.md (Klotz-Goldnuggets, JSON-Schema, Anti-Halluzination).
    // PDF direkt an Claude (document content type), kein lokales pdf-parse mehr.
    let systemPrompt;
    try {
      systemPrompt = fs.readFileSync(path.join(__dirname, 'prompts', 'bwa.md'), 'utf8');
    } catch(e) {
      // Fallback auf altes agent.md falls prompts/ nicht da
      systemPrompt = fs.readFileSync(path.join(__dirname, 'agents', 'bwa-dolmetscher', 'agent.md'), 'utf8');
    }
    const pdfBase64 = fs.readFileSync(req.file.path).toString('base64');
    const userText = `Analysiere diese BWA${mandant_name ? ' für ' + mandant_name : ''}. Antworte ausschließlich mit dem JSON-Objekt gemäß Schema. Kein Markdown, kein Fließtext.`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: userText }
        ]
      }]
    });

    let parsed;
    try {
      const raw = (msg.content[0] && msg.content[0].text || '').trim()
        .replace(/^```json?\s*/i,'').replace(/```\s*$/i,'').trim();
      parsed = JSON.parse(raw);
    } catch(pe) {
      console.error('[BWA] JSON-Parsing fehlgeschlagen:', pe.message);
      parsed = {
        metadata: { format_erkannt: false, format_hinweis: 'Das Format dieser BWA konnte nicht zugeordnet werden. Bitte laden Sie eine BWA im DATEV-Standard hoch.' },
        ampel: 'gelb', ampel_grund: '', kurzfazit: '',
        kennzahlen_kacheln: [], auffaelligkeiten: [], kennzahlen_tabelle: [],
        steuerliche_hinweise: [], bwa_grenzen: [],
        mandantenversion: { ueberschrift: '', text: '' },
        manuelle_pruefung_erforderlich: [],
        mail_entwurf: { betreff: '', anschreiben: '' }
      };
    }

    // Kompatibilitäts-Mapping: alte Felder (analyse, email_text, email_betreff) aus neuem Schema ableiten,
    // damit bestehender Mail-Versand & UI nicht brechen.
    // analyse = Schritt-für-Schritt-Analyse (ohne Anrede), NICHT die Mandantenversion mit "Sehr geehrter..."
    const analyseText = parsed.analyse_inhalt || parsed.mandantenversion?.text || parsed.kurzfazit || '';
    const emailText = parsed.mail_entwurf?.anschreiben || '';
    const emailBetreff = parsed.mail_entwurf?.betreff || '';
    const kennzahlenLegacy = (parsed.kennzahlen_kacheln || []).map(k => ({
      label: k.name, wert: k.wert, einheit: k.einheit === 'euro' ? '€' : k.einheit === 'prozent' ? '%' : ''
    }));

    const r = db.prepare('INSERT INTO bwa_analysen (mandant_name,filename,originalname,analyse,ampel,kurzfazit,kennzahlen,email_betreff,email_text,kanzlei_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(
        parsed.metadata?.mandant || mandant_name || '',
        req.file.filename,
        req.file.originalname,
        analyseText,
        parsed.ampel || 'gelb',
        parsed.kurzfazit || '',
        JSON.stringify(parsed),
        emailBetreff,
        emailText,
        req.kanzleiId
      );

    res.json({
      id: r.lastInsertRowid,
      ...parsed,
      // Legacy-Felder für altes UI:
      analyse: analyseText,
      kennzahlen: kennzahlenLegacy,
      email_betreff: emailBetreff,
      email_text: emailText,
      filename: req.file.filename,
      originalname: req.file.originalname,
      mandant_name: parsed.metadata?.mandant || mandant_name || ''
    });
  } catch(e) {
    console.error('BWA Analyse Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/kanzlei/bwa/compare', kanzleiMiddleware, async (req, res) => {
  const { id1, id2 } = req.body;
  if (!id1 || !id2) return res.status(400).json({ error: 'Zwei IDs erforderlich' });
  const bwa1 = db.prepare('SELECT * FROM bwa_analysen WHERE id=?').get(id1);
  const bwa2 = db.prepare('SELECT * FROM bwa_analysen WHERE id=?').get(id2);
  if (!bwa1 || !bwa2) return res.status(404).json({ error: 'BWA nicht gefunden' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
      system: `Du bist Steuerberater. Vergleiche zwei BWA-Analysen desselben Mandanten und erkläre was sich verändert hat. Fließtext, max 200 Wörter, keine Fachbegriffe. Fokus: Was hat sich verbessert? Was hat sich verschlechtert? Was ist die Tendenz?`,
      messages:[{role:'user',content:`Analyse 1 (${new Date(bwa1.erstellt_am).toLocaleDateString('de-DE')}):\n${bwa1.analyse}\n\nAnalyse 2 (${new Date(bwa2.erstellt_am).toLocaleDateString('de-DE')}):\n${bwa2.analyse}`}]
    });
    res.json({ vergleich: msg.content[0].text });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/kanzlei/bwa/send', kanzleiMiddleware, async (req, res) => {
  const { id, to, mandant_name, custom_analyse, begleittext, manuelleAnhaenge } = req.body;
  if (!to || !id) return res.status(400).json({ error: 'Fehlende Felder' });
  const bwa = db.prepare('SELECT * FROM bwa_analysen WHERE id=?').get(id);
  if (!bwa) return res.status(404).json({ error: 'BWA nicht gefunden' });
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Steuerberatung';
  const kanzleiEmail = process.env.KANZLEI_EMAIL || '';
  const kanzleiTel   = process.env.KANZLEI_TEL   || '';
  const kanzleiAdresse = process.env.KANZLEI_ADRESSE || '';
  const heute = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });
  const anrede = mandant_name ? `Guten Tag ${mandant_name},` : 'Guten Tag,';
  const analyseText = custom_analyse || bwa.analyse;
  const begleitHtml = begleittext ? begleittext.split('\n').map(l => `<p style="margin:0 0 10px 0">${l}</p>`).join('') : `<p style="margin:0 0 18px 0">anbei erhalten Sie Ihre Betriebswirtschaftliche Auswertung (BWA) inklusive verständlicher Erklärung.</p>`;
  const analyseHtml = analyseText.split('\n\n').map(p => `<p style="margin:0 0 14px 0">${p.replace(/\n/g,'<br>')}</p>`).join('');
  const _staff4 = getStaffForEmail(req.staffId);
  const emailHtml = buildEmailHtml({ body: `<p style="margin:0 0 6px 0;font-size:12px;color:#888">${heute}</p><p style="margin:0 0 20px 0">${anrede}</p>${begleitHtml}<div style="background:#f8f8f8;border-left:3px solid #6d7aff;padding:20px 24px;margin:20px 0;font-size:14px;color:#222;line-height:1.75">${analyseHtml}</div><p>Für Rückfragen stehen wir Ihnen selbstverständlich gerne zur Verfügung.</p>`, staff: _staff4 });
  try {
    const attachments = [];
    if (bwa.filename) {
      const filepath = path.join(DATA_DIR, 'bwa_uploads', bwa.filename);
      if (fs.existsSync(filepath)) attachments.push({ filename: bwa.originalname||bwa.filename, content: fs.readFileSync(filepath).toString('base64'), type: 'application/pdf' });
    }
    attachments.push(..._parseManuelleAnhaenge(manuelleAnhaenge));
    await resend.emails.send({ from: FROM_EMAIL, to, subject: `Ihre BWA – Erläuterung und Auswertung | ${kanzleiName}`, html: emailHtml, attachments });
    db.prepare('UPDATE bwa_analysen SET gesendet=1 WHERE id=?').run(id);
    res.json({ ok: true });
  } catch(e) {
    console.error('BWA Send Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/kanzlei/bwa/analyse/:id', kanzleiMiddleware, (req, res) => {
  const row = db.prepare('SELECT filename FROM bwa_analysen WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId || 1);
  if (!row) return res.status(404).json({ error: 'BWA nicht gefunden' });
  // Datei aus bwa_uploads/ entfernen (best effort)
  if (row.filename) {
    const filepath = path.join(DATA_DIR, 'bwa_uploads', row.filename);
    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch(e) { console.error('[BWA Delete] unlink:', e.message); }
  }
  db.prepare('DELETE FROM bwa_analysen WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId || 1);
  res.json({ ok: true });
});

app.post('/api/kanzlei/bwa/send-vergleich', kanzleiMiddleware, async (req, res) => {
  const { to, mandant_name, vergleich, id1, id2 } = req.body;
  if (!to || !vergleich) return res.status(400).json({ error: 'Fehlende Felder' });
  const kanzleiName = process.env.KANZLEI_NAME || 'H&K Steuerberatung';
  const heute = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });
  const anrede = mandant_name ? `Guten Tag ${mandant_name},` : 'Guten Tag,';
  const vergleichHtml = vergleich.split('\n\n').map(p=>`<p style="margin:0 0 14px 0">${p.replace(/\n/g,'<br>')}</p>`).join('');
  const b1 = id1 ? db.prepare('SELECT * FROM bwa_analysen WHERE id=?').get(id1) : null;
  const b2 = id2 ? db.prepare('SELECT * FROM bwa_analysen WHERE id=?').get(id2) : null;
  const ampelLabel = {'grün':'Gut','gelb':'Mittel','rot':'Kritisch'};
  const docsHtml = [b1,b2].filter(Boolean).map(b=>`
    <div style="flex:1;background:#f8f8f8;border-radius:8px;padding:12px 14px">
      <div style="font-size:12px;font-weight:700;color:${{'grün':'#27ae60','gelb':'#e67e22','rot':'#e74c3c'}[b.ampel||'gelb']||'#e67e22'};margin-bottom:4px">${ampelLabel[b.ampel||'gelb']||'Mittel'}</div>
      <div style="font-size:13px;font-weight:600">${b.originalname||b.filename||'BWA'}</div>
      <div style="font-size:11px;color:#888">${new Date(b.erstellt_am).toLocaleDateString('de-DE')}</div>
    </div>`).join('');
  const _staff5 = getStaffForEmail(req.staffId);
  const emailHtml = buildEmailHtml({ body: `<p style="margin:0 0 6px 0;font-size:12px;color:#888">${heute}</p><p style="margin:0 0 20px 0">${anrede}</p><p>anbei erhalten Sie den Trendvergleich Ihrer Betriebswirtschaftlichen Auswertungen.</p>${docsHtml ? `<div style="display:flex;gap:12px;margin:20px 0">${docsHtml}</div>` : ''}<div style="background:#f8f8f8;border-left:3px solid #6d7aff;padding:20px 24px;font-size:14px;color:#222;line-height:1.75">${vergleichHtml}</div>`, staff: _staff5 });
  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject: `BWA-Trendvergleich${mandant_name?' – '+mandant_name:''} | ${kanzleiName}`, html: emailHtml });
    res.json({ ok: true });
  } catch(e) {
    console.error('BWA Vergleich Send Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/kanzlei/mandanten/:name/dokumente — Alle Scanner-Dokumente eines Mandanten
app.get('/api/kanzlei/mandanten/:name/dokumente', kanzleiMiddleware, (req, res) => {
  const mandant_name = decodeURIComponent(req.params.name);
  const kid = req.kanzleiId || 1;
  const docs = db.prepare(`
    SELECT di.id, di.dateiname AS originalname, di.dateipfad AS filepath, di.typ, di.typ_label,
           di.bwa_kategorie, di.zeitraum_monat, di.zeitraum_jahr,
           di.upload_datum AS erstellt_am, di.betrag, di.frist_datum, di.frist_typ
    FROM mandant_dokumente md
    JOIN dokument_inbox di ON di.id = md.inbox_id
    WHERE md.mandant_name=? AND md.kanzlei_id=?
    ORDER BY di.zeitraum_jahr DESC, di.zeitraum_monat DESC, di.upload_datum DESC
  `).all(mandant_name, kid);
  res.json(docs);
});

// ─── WEB SEARCH ───────────────────────────────────────────────────────────────
app.post('/api/kanzlei/web-search', kanzleiMiddleware, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query fehlt' });
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const response = await fetch(url, { headers: { 'User-Agent': 'HK-Automation/1.0' } });
    const data = await response.json();
    let result = '';
    if (data.AbstractText) result += data.AbstractText + '\n\n';
    if (data.Answer) result += 'Direkte Antwort: ' + data.Answer + '\n\n';
    if (data.RelatedTopics?.length) {
      const topics = data.RelatedTopics.slice(0, 5).filter(t => t.Text);
      if (topics.length) result += 'Weitere Informationen:\n' + topics.map(t => '- ' + t.Text).join('\n') + '\n';
    }
    if (!result.trim()) result = 'Keine direkten Informationen in der Suche gefunden. Datum der Anfrage: ' + new Date().toLocaleDateString('de-DE');
    res.json({ result: result.trim() });
  } catch(e) {
    console.error('Web Search Fehler:', e.message);
    res.status(500).json({ error: 'Suche fehlgeschlagen: ' + e.message });
  }
});

// ─── ZEITERFASSUNG ────────────────────────────────────────────────────────────
app.get('/api/kanzlei/zeiterfassung', kanzleiMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM zeiterfassung WHERE kanzlei_id=? ORDER BY datum DESC, erstellt_am DESC').all(req.kanzleiId));
});
app.post('/api/kanzlei/zeiterfassung', kanzleiMiddleware, (req, res) => {
  const { mandant_id, mandant_name, beschreibung, minuten, datum } = req.body;
  if (!beschreibung || !minuten || !datum) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const r = db.prepare('INSERT INTO zeiterfassung (mandant_id,mandant_name,beschreibung,minuten,datum,kanzlei_id) VALUES (?,?,?,?,?,?)')
    .run(mandant_id||null, mandant_name||'', beschreibung, minuten, datum, req.kanzleiId);
  res.json({ id: r.lastInsertRowid });
});
app.delete('/api/kanzlei/zeiterfassung/:id', kanzleiMiddleware, (req, res) => {
  db.prepare('DELETE FROM zeiterfassung WHERE id=? AND kanzlei_id=?').run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// ─── AUTO-FRISTEN ─────────────────────────────────────────────────────────────
function createAutoFristen(userId, userName, answers, kanzleiId) {
  const isU = answers?.mandant_typ === 'unternehmen';
  const now  = new Date();
  const year = now.getFullYear(); // laufendes Jahr = Steuerjahr - 1
  const taxYear = year - 1;      // für das Steuerjahr das gerade erklärt wird

  // Prüfen ob für diesen Mandanten schon Auto-Fristen existieren (idempotent)
  const existing = db.prepare(
    "SELECT COUNT(*) AS n FROM fristen WHERE mandant_id=? AND kanzlei_id=? AND titel LIKE '%Auto%'"
  ).get(userId, kanzleiId);
  if (existing.n > 0) return; // bereits erstellt

  const insert = db.prepare(
    'INSERT INTO fristen (mandant_id, mandant_name, titel, typ, faellig_am, notiz, kanzlei_id) VALUES (?,?,?,?,?,?,?)'
  );

  // Steuerberater-Fristverlängerung: 28.02. des übernächsten Jahres (taxYear+2)
  const stbDeadlineYear = taxYear + 2;
  const lastFebDay = new Date(stbDeadlineYear, 2, 0).getDate(); // letzter Tag im Februar
  const stbDeadline = `${stbDeadlineYear}-02-${String(lastFebDay).padStart(2,'0')}`;

  // ── Alle Mandanten ────────────────────────────────
  insert.run(userId, userName,
    `[Auto] Einkommensteuer-Erklärung ${taxYear}`, 'steuer',
    stbDeadline,
    `Fristverlängerung durch Steuerberater. Ohne Steuerberater: 31.07.${year}.`,
    kanzleiId);

  if (isU) {
    const rechtsform = (answers?.rechtsform || '').toLowerCase();
    const isGmbH = rechtsform.includes('gmbh') || rechtsform.includes('ug') || rechtsform.includes('ag');

    // ── Unternehmen ───────────────────────────────
    insert.run(userId, userName,
      `[Auto] Umsatzsteuer-Jahreserklärung ${taxYear}`, 'steuer',
      stbDeadline, `Fristverlängerung durch Steuerberater.`, kanzleiId);

    insert.run(userId, userName,
      `[Auto] Gewerbesteuer-Erklärung ${taxYear}`, 'steuer',
      stbDeadline, `Fristverlängerung durch Steuerberater.`, kanzleiId);

    if (isGmbH) {
      insert.run(userId, userName,
        `[Auto] Körperschaftsteuer-Erklärung ${taxYear}`, 'steuer',
        stbDeadline, `Nur für Kapitalgesellschaften.`, kanzleiId);
    }

    // USt-Voranmeldungen: verbleibende Quartale des laufenden Jahres
    const quarters = [
      { q: 'Q1', month: 4, day: 10 },
      { q: 'Q2', month: 7, day: 10 },
      { q: 'Q3', month: 10, day: 10 },
      { q: 'Q4', month: 1, day: 10, yearOffset: 1 },
    ];
    for (const { q, month, day, yearOffset = 0 } of quarters) {
      const deadline = new Date(year + yearOffset, month - 1, day);
      if (deadline > now) {
        insert.run(userId, userName,
          `[Auto] USt-Voranmeldung ${q} ${year}`, 'ust',
          deadline.toISOString().split('T')[0],
          'Abgabe bis 10. des Folgemonats nach Quartalsende.', kanzleiId);
      }
    }

    // Lohnsteuer-Anmeldung (nächste 3 Monate, falls Mitarbeiter)
    if (parseInt(answers?.mitarbeiter_anzahl) > 0) {
      for (let m = 0; m < 3; m++) {
        const d = new Date(now.getFullYear(), now.getMonth() + m + 1, 10);
        const label = d.toLocaleString('de-DE', { month: 'long', year: 'numeric' });
        insert.run(userId, userName,
          `[Auto] Lohnsteuer-Anmeldung ${label}`, 'lohn',
          d.toISOString().split('T')[0],
          'Monatliche Abgabe bis 10. des Folgemonats.', kanzleiId);
      }
    }
  }

  console.log(`[AutoFristen] ${isU ? 'Unternehmen' : 'Privatperson'} ${userName}: Fristen erstellt`);
}

// POST /api/kanzlei/mandant/:userId/auto-fristen (manuell für bestehende Mandanten)
app.post('/api/kanzlei/mandant/:userId/auto-fristen', kanzleiMiddleware, (req, res) => {
  const userId = parseInt(req.params.userId);
  const user = db.prepare('SELECT * FROM users WHERE id=? AND kanzlei_id=?').get(userId, req.kanzleiId);
  if (!user) return res.status(404).json({ error: 'Mandant nicht gefunden' });

  // Bestehende Auto-Fristen löschen und neu generieren
  db.prepare("DELETE FROM fristen WHERE mandant_id=? AND kanzlei_id=? AND titel LIKE '%Auto%'")
    .run(userId, req.kanzleiId);

  const sub = db.prepare('SELECT * FROM submissions WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  const answers = sub?.answers ? JSON.parse(sub.answers) : {};
  createAutoFristen(userId, user.name, answers, req.kanzleiId);

  const fristen = db.prepare("SELECT * FROM fristen WHERE mandant_id=? AND kanzlei_id=? ORDER BY faellig_am ASC").all(userId, req.kanzleiId);
  res.json({ ok: true, count: fristen.filter(f => f.titel.includes('[Auto]')).length, fristen });
});

// ─── AUTO-ERINNERUNGEN ────────────────────────────────────────────────────────
const KANZLEI_NAME = process.env.KANZLEI_NAME || 'H&K Steuerberatung';

async function sendFristErinnerungEmail(kanzleiEmail, items) {
  const rows = items.map(({ frist, days }) => {
    const label = days === 1 ? 'morgen' : `in ${days} Tagen`;
    const mandant = frist.mandant_name ? ` · ${frist.mandant_name}` : '';
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${frist.titel}${mandant}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#e53e3e;font-weight:600;white-space:nowrap">Fällig ${label}</td></tr>`;
  }).join('');

  await resend.emails.send({
    from: FROM_EMAIL,
    to: kanzleiEmail,
    subject: `⏰ ${items.length} Frist${items.length > 1 ? 'en' : ''} laufen bald ab – ${KANZLEI_NAME}`,
    html: buildEmailHtml({ body: `<h3 style="margin:0 0 16px 0;color:#1a1a2e">Fällige Fristen – Erinnerung</h3><table style="width:100%;border-collapse:collapse;background:#f8f9ff;border-radius:8px;overflow:hidden"><thead><tr style="background:#f0f1ff"><th style="padding:10px 12px;text-align:left;font-size:.8rem;color:#666">Frist</th><th style="padding:10px 12px;text-align:left;font-size:.8rem;color:#666">Fälligkeit</th></tr></thead><tbody>${rows}</tbody></table>` })
  });
}

async function sendBelegErinnerungEmail(mandantEmail, mandantName, pendingDocs, reminderCount) {
  const docList = pendingDocs.map(d =>
    `<li style="margin-bottom:6px">${d.doc_name}${d.is_required ? ' <span style="color:#e53e3e;font-size:.8rem">(Pflicht)</span>' : ''}</li>`
  ).join('');
  const greeting = reminderCount > 1 ? `dies ist unsere ${reminderCount}. Erinnerung` : 'wir warten noch auf folgende Unterlagen von Ihnen';

  await resend.emails.send({
    from: FROM_EMAIL,
    to: mandantEmail,
    subject: `Erinnerung: Fehlende Unterlagen – ${KANZLEI_NAME}`,
    html: buildEmailHtml({ body: `<p>Sehr geehrte/r ${escHtml(mandantName)},</p><p>${escHtml(greeting)}:</p><ul style="line-height:1.9">${docList}</ul><p>Bitte reichen Sie diese über das Mandantenportal nach.</p><p>Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p><p>Mit freundlichen Grüßen</p>` })
  });
}

async function checkFristenReminders() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const kanzleiGroups = {};

  for (const days of [7, 3, 1]) {
    const target = new Date(today); target.setDate(target.getDate() + days);
    const dateStr = target.toISOString().split('T')[0];
    const col = `reminder_${days}d_sent`;
    const fristen = db.prepare(
      `SELECT * FROM fristen WHERE faellig_am=? AND erledigt=0 AND ${col}=0`
    ).all(dateStr);

    for (const f of fristen) {
      db.prepare(`UPDATE fristen SET ${col}=1 WHERE id=?`).run(f.id);
      const kid = f.kanzlei_id || 1;
      if (!kanzleiGroups[kid]) kanzleiGroups[kid] = [];
      kanzleiGroups[kid].push({ frist: f, days });
    }
  }

  for (const [kid, items] of Object.entries(kanzleiGroups)) {
    const k = db.prepare('SELECT * FROM kanzleien WHERE id=?').get(parseInt(kid));
    if (!k?.email) continue;
    try {
      await sendFristErinnerungEmail(k.email, items);
      console.log(`[Reminder] Frist-Erinnerung → ${k.email} (${items.length} Fristen)`);
    } catch(e) { console.error('[Reminder] Frist-Mail Fehler:', e.message); }
  }
}

async function checkBelegReminders() {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString();

  const subs = db.prepare(`
    SELECT s.*, u.email, u.name FROM submissions s
    JOIN users u ON s.user_id = u.id
    WHERE s.submitted_at < ?
      AND (s.last_reminder_sent IS NULL OR s.last_reminder_sent < ?)
  `).all(cutoffStr, cutoffStr);

  for (const sub of subs) {
    const pending = db.prepare(
      "SELECT * FROM documents WHERE submission_id=? AND (filename IS NULL OR filename='')"
    ).all(sub.id);
    if (!pending.length) continue;
    try {
      const count = (sub.reminder_count || 0) + 1;
      await sendBelegErinnerungEmail(sub.email, sub.name, pending, count);
      db.prepare("UPDATE submissions SET last_reminder_sent=datetime('now'), reminder_count=? WHERE id=?")
        .run(count, sub.id);
      console.log(`[Reminder] Beleg-Erinnerung → ${sub.email} (${pending.length} ausstehend, Erinnerung #${count})`);
    } catch(e) { console.error('[Reminder] Beleg-Mail Fehler:', e.message); }
  }
}

async function runDailyReminders() {
  console.log('[Reminder] Täglicher Check läuft…');
  try { await checkFristenReminders(); } catch(e) { console.error('[Reminder] Fristen:', e.message); }
  try { await checkBelegReminders();   } catch(e) { console.error('[Reminder] Belege:',  e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── EMAIL / IMAP+SMTP ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const { ImapFlow } = require('imapflow');
const nodemailer  = require('nodemailer');

function createImapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.ionos.de',
    port: parseInt(process.env.IMAP_PORT || '993'),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS },
    logger: false,
    tls: { rejectUnauthorized: false }
  });
}

// DB-Tabellen für gecachte Mails
db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT NOT NULL,
    folder      TEXT NOT NULL DEFAULT 'INBOX',
    message_id  TEXT,
    from_addr   TEXT,
    from_name   TEXT,
    to_addr     TEXT,
    subject     TEXT,
    date        TEXT,
    body_text   TEXT,
    body_html   TEXT,
    is_read     INTEGER DEFAULT 0,
    is_sent     INTEGER DEFAULT 0,
    has_attachments INTEGER DEFAULT 0,
    kanzlei_id  INTEGER DEFAULT 1,
    UNIQUE(uid, folder)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS email_attachments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id   INTEGER NOT NULL,
    filename   TEXT,
    mime_type  TEXT,
    size       INTEGER,
    data       BLOB,
    FOREIGN KEY(email_id) REFERENCES emails(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS email_mandant (
    email_id   INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    assigned_by INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(email_id, user_id)
  )
`);
try { db.exec('ALTER TABLE emails ADD COLUMN in_reply_to TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE emails ADD COLUMN references_ids TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE email_attachments ADD COLUMN part_id TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE emails ADD COLUMN ki_relevant INTEGER DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE emails ADD COLUMN ki_kategorie TEXT DEFAULT NULL'); } catch(e) {}

// ─── CHAT MESSAGES ────────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER DEFAULT 1,
  user_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
try { db.exec('ALTER TABLE submissions ADD COLUMN kanzlei_id INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE chat_messages ADD COLUMN staff_id INTEGER DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN bereich TEXT DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE dokument_inbox ADD COLUMN linked_id INTEGER DEFAULT NULL'); } catch(e) {}

db.exec(`CREATE TABLE IF NOT EXISTS gutachten_archiv (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER NOT NULL DEFAULT 1,
  typ TEXT NOT NULL,
  mandant TEXT,
  titel TEXT,
  inhalt TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// ── Dokument-Inbox ────────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS dokument_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kanzlei_id INTEGER DEFAULT 1,
  dateiname TEXT NOT NULL,
  dateipfad TEXT NOT NULL,
  status TEXT DEFAULT 'scanning',
  typ TEXT,
  typ_label TEXT,
  mandant_name TEXT,
  steuernummer TEXT,
  steuerjahr INTEGER,
  betrag TEXT,
  frist_datum TEXT,
  frist_typ TEXT,
  prioritaet TEXT DEFAULT 'normal',
  zusammenfassung TEXT,
  confidence REAL,
  agent_output TEXT,
  upload_datum DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Klassifizierer-Agent laden (extern aus agents/klassifizierer/agent.md)
const klassifiziererPromptPath = path.join(__dirname, 'agents', 'klassifizierer', 'agent.md');
let KLASSIFIZIERER_PROMPT = fs.readFileSync(klassifiziererPromptPath, 'utf8');

// ─── MOBILE SCAN ─────────────────────────────────────────────────────────────

// Statische mobile Seite ausliefern
app.get('/mobile-scan', (req, res) => {
  res.sendFile(path.join(__dirname, 'mobile-scan.html'));
});

// PIN prüfen (kanzlei_id=1 — single-kanzlei-server)
app.post('/api/mobile/verify-pin', express.json(), (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ ok: false });
  const s = db.prepare('SELECT scanner_pin FROM kanzlei_settings WHERE kanzlei_id=1').get();
  const expected = s?.scanner_pin || '1234';
  res.json({ ok: pin === expected });
});

// Multer für mobile Foto-Uploads
const mobileUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'uploads', 'mobile_tmp');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + path.extname(file.originalname || '.jpg'))
});
const mobileUpload = multer({ storage: mobileUploadStorage, limits: { fileSize: 25 * 1024 * 1024 } });

// Mobile Upload: mehrere Dokumente, jedes als Array von Fotos
// Body: pin, documents = JSON-Array von Arrays von Foto-Feldnamen
// Files: alle Fotos als Felder "foto_<docIdx>_<pageIdx>"
app.post('/api/mobile/upload', mobileUpload.any(), async (req, res) => {
  const { pin, documents } = req.body || {};

  // PIN-Prüfung
  const s = db.prepare('SELECT scanner_pin FROM kanzlei_settings WHERE kanzlei_id=1').get();
  const expected = s?.scanner_pin || '1234';
  if (pin !== expected) {
    // Temp-Dateien aufräumen
    (req.files || []).forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    return res.status(403).json({ error: 'Falscher PIN' });
  }

  let docGroups;
  try { docGroups = JSON.parse(documents); } catch(_) { docGroups = [[]]; }

  const kid = 1;
  const results = [];

  // Fotos nach Gruppen-Index aufschlüsseln
  const filesByGroup = {};
  for (const f of (req.files || [])) {
    const m = f.fieldname.match(/^foto_(\d+)_(\d+)$/);
    if (!m) continue;
    const gi = parseInt(m[1]);
    const pi = parseInt(m[2]);
    if (!filesByGroup[gi]) filesByGroup[gi] = [];
    filesByGroup[gi][pi] = f;
  }

  res.json({ ok: true, count: Object.keys(filesByGroup).length });

  // Dokumente sequenziell verarbeiten (nicht parallel → KI nicht überlasten)
  setImmediate(async () => {
    for (const [giStr, pages] of Object.entries(filesByGroup)) {
      const validPages = pages.filter(Boolean);
      if (validPages.length === 0) continue;

      let finalPath, finalName, finalMime;

      try {
        if (validPages.length === 1) {
          // Einzelnes Bild → direkt als JPEG ablegen (Vision-Pipeline)
          const img = validPages[0];
          finalName = 'mobile_' + Date.now() + '.jpg';
          finalPath = path.join(DATA_DIR, 'uploads', 'inbox', finalName);
          fs.mkdirSync(path.dirname(finalPath), { recursive: true });
          await sharp(img.path).rotate().jpeg({ quality: 85 }).toFile(finalPath);
          finalMime = 'image/jpeg';
        } else {
          // Mehrere Bilder → zu einem PDF zusammenführen
          const pdfDoc = await PDFDocument.create();
          for (const img of validPages) {
            const buf = await sharp(img.path).rotate().jpeg({ quality: 85 }).toBuffer();
            const jpgImg = await pdfDoc.embedJpg(buf);
            const page = pdfDoc.addPage([jpgImg.width, jpgImg.height]);
            page.drawImage(jpgImg, { x: 0, y: 0, width: jpgImg.width, height: jpgImg.height });
          }
          const pdfBytes = await pdfDoc.save();
          finalName = 'mobile_' + Date.now() + '.pdf';
          finalPath = path.join(DATA_DIR, 'uploads', 'inbox', finalName);
          fs.mkdirSync(path.dirname(finalPath), { recursive: true });
          fs.writeFileSync(finalPath, pdfBytes);
          finalMime = 'application/pdf';
        }
      } catch(e) {
        console.error('[MobileScan] Fehler beim Erstellen der Datei:', e.message);
        validPages.forEach(p => { try { fs.unlinkSync(p.path); } catch(_) {} });
        continue;
      }

      // Temp-Dateien der Gruppe löschen
      validPages.forEach(p => { try { fs.unlinkSync(p.path); } catch(_) {} });

      // In Inbox eintragen und klassifizieren (identisch zu /api/inbox/upload)
      const r = db.prepare(`INSERT INTO dokument_inbox (kanzlei_id, dateiname, dateipfad, status) VALUES (?,?,?,'scanning')`)
        .run(kid, finalName, finalPath);
      const docId = r.lastInsertRowid;

      // Klassifizierung (async, identisch zur normalen Inbox-Pipeline)
      try {
        KLASSIFIZIERER_PROMPT = fs.readFileSync(klassifiziererPromptPath, 'utf8');
        const VISION_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
        const isImage = VISION_MIME.has(finalMime);
        let raw;

        if (isImage) {
          const imageBuffer = fs.readFileSync(finalPath);
          const b64 = imageBuffer.toString('base64');
          const mandanten = db.prepare('SELECT name FROM users WHERE kanzlei_id=?').all(kid).map(u => u.name).join(', ');
          const visionMsg = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 512,
            system: `Du klassifizierst Dokumente für eine deutsche Steuerkanzlei. Verwende exakt einen dieser Typen:\n\nrechnung — Eingangs-/Ausgangsrechnung, Quittung, Kassenbon, Bewirtungsbeleg\nkontoauszug — Kontoauszug, Kreditkartenabrechnung, PayPal/Stripe/Klarna-Beleg\nsteuerbescheid — Bescheid vom Finanzamt (Einkommensteuer, Körperschaftsteuer, Umsatzsteuer, Gewerbesteuer, Erbschaftsteuer), Vorauszahlungsbescheid, ELSTER-Bescheid\nsteuererklaerung — Steuererklärungsformular, ELSTER-Sendeprotokoll, Umsatzsteuervoranmeldung (vom Mandanten ausgefüllt)\nlohnsteuerbescheinigung — Lohnsteuerbescheinigung vom Arbeitgeber\nrentenbescheid — Rentenbescheid, Rentenanpassungsmitteilung, Renteninformation\nmandant_dokument — Persönliche Dokumente und Nachweise die ein Mandant beim Steuerberater einreicht und die KEIN Beleg und KEIN Steuerbescheid sind.\nsonstiges — Fotos ohne Dokumenteninhalt, Präsentationen, Screenshots, Werbung, alles Unidentifizierbare\n\nGib NUR gültiges JSON zurück, kein Text drumherum.`,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
                { type: 'text', text: `Bekannte Mandanten: ${mandanten}\n\nJSON:\n{"typ":"<typ>","typ_label":"<lesbarer Name>","steuer_art":"einkommensteuer|koerperschaftsteuer|gewerbesteuer|umsatzsteuer_jahres|umsatzsteuer_voranmeldung|erbschaftsteuer|schenkungsteuer|sonstige|null","ist_aenderungsbescheid":false,"zeitraum_quartal":null,"mandant_name":"<exakter Name aus Liste oder null>","beleg_kategorie":"eingangsbeleg|ausgangsbeleg|sonstiger_beleg|kontoauszug|kreditkarte|online_zahlung|null","dok_slot":null,"steuerjahr":null,"betrag":null,"frist_datum":null,"frist_typ":null,"prioritaet":"normal","zusammenfassung":"<1 Satz>","confidence":0.9,"bwa_kategorie":null,"zeitraum_monat":null,"zeitraum_jahr":null}` }
              ]
            }]
          });
          raw = visionMsg.content[0].text.trim();
        } else {
          let docText = `Dateiname: ${finalName}\n`;
          try {
            const pdfBuffer = fs.readFileSync(finalPath);
            const parsed = await pdfParse(pdfBuffer);
            docText += parsed.text.slice(0, 8000);
          } catch(_) { docText += '[PDF-Text nicht lesbar]'; }
          const mandanten = db.prepare('SELECT name FROM users WHERE kanzlei_id=?').all(kid).map(u => u.name).join(', ');
          const msg = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: KLASSIFIZIERER_PROMPT,
            messages: [{ role: 'user', content: docText + `\nBekannte Mandanten: ${mandanten}` }]
          });
          raw = msg.content[0].text.trim();
        }

        const json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/```$/,'').trim());
        const belegKatLabel = { eingangsbeleg:'Eingangsbeleg', ausgangsbeleg:'Ausgangsbeleg', sonstiger_beleg:'Sonstiger Beleg', kontoauszug:'Kontoauszug', kreditkarte:'Kreditkarte', online_zahlung:'Online-Zahlungsdienst' };
        if (json.beleg_kategorie && belegKatLabel[json.beleg_kategorie]) json.typ_label = belegKatLabel[json.beleg_kategorie];
        if (json.typ === 'mandant_dokument') json.typ_label = 'Dokument';

        // typ_label bei Steuer-Docs präzise aus steuer_art ableiten
        const steuerLabel = buildSteuerTypLabel(json.typ, json.steuer_art, json.ist_aenderungsbescheid);
        if (steuerLabel) json.typ_label = steuerLabel;
        const autoBereich = { steuerbescheid:'Bescheide', vorauszahlungsbescheid:'Bescheide', steuererklaerung:'Steuererklärungen', lohnsteuerbescheinigung:'Steuererklärungen', rechnung:'Belege', kontoauszug:'Bankbelege', mandant_dokument:'Dokumente' }[json.typ] || null;

        db.prepare(`UPDATE dokument_inbox SET
          status='klassifiziert', typ=?, typ_label=?, mandant_name=?, steuernummer=?,
          steuerjahr=?, betrag=?, frist_datum=?, frist_typ=?, prioritaet=?,
          zusammenfassung=?, confidence=?, agent_output=?,
          bwa_kategorie=?, zeitraum_monat=?, zeitraum_jahr=?,
          steuer_art=?, ist_aenderungsbescheid=?, bereich=COALESCE(bereich,?)
          WHERE id=?`).run(
          json.typ, json.typ_label, json.mandant_name, json.steuernummer,
          json.steuerjahr, json.betrag, json.frist_datum, json.frist_typ, json.prioritaet,
          json.zusammenfassung, json.confidence, raw,
          json.bwa_kategorie || null, json.zeitraum_monat || null, json.zeitraum_jahr || null,
          json.steuer_art || null, json.ist_aenderungsbescheid ? 1 : 0, autoBereich,
          docId
        );

        // Auto-Routing: Steuererklärung → mandant_steuererklaerungen (kein Bescheid-Eintrag)
        if (json.typ === 'steuererklaerung' && json.mandant_name) {
          const dupE = db.prepare('SELECT id FROM mandant_steuererklaerungen WHERE dateipfad=?').get(finalPath);
          if (!dupE) {
            db.prepare('INSERT INTO mandant_steuererklaerungen (kanzlei_id, mandant_name, dateiname, dateipfad, steuerjahr, steuer_art, zeitraum_quartal, quelle) VALUES (?,?,?,?,?,?,?,?)')
              .run(kid, json.mandant_name, finalName, finalPath, json.steuerjahr || null, json.steuer_art || null, json.zeitraum_quartal || null, 'scanner');
          }
          // Passenden Bescheid suchen (SQL, 0 Tokens)
          if (json.steuer_art && json.steuerjahr) {
            const matchB = db.prepare(`SELECT id FROM bescheide WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND tax_year=? AND bearbeitungsstand != 'abgeloest' ORDER BY erstellt_am DESC LIMIT 1`)
              .get(kid, json.mandant_name, json.steuer_art, json.steuerjahr);
            if (matchB) {
              const hasE = db.prepare("SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung'").get(matchB.id);
              if (!hasE) {
                db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
                  .run(matchB.id, kid, 'erklaerung', finalName, finalPath);
                db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE dateipfad=?').run(matchB.id, finalPath);
              }
            }
          }
        }

        // Auto-Routing: Belege + Bankbelege → Agent
        if (json.mandant_name && (json.typ === 'rechnung' || json.typ === 'kontoauszug') && json.beleg_kategorie) {
          const autoUser = db.prepare('SELECT id FROM users WHERE name=? AND kanzlei_id=?').get(json.mandant_name, kid);
          if (autoUser) {
            try {
              const fileExt2 = finalName.split('.').pop().toLowerCase();
              const mimeMap2 = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
              const fileMime2 = mimeMap2[fileExt2] || finalMime;
              const fileBuffer2 = fs.readFileSync(finalPath);
              const blob2 = new Blob([fileBuffer2], { type: fileMime2 });
              const fd2 = new FormData();
              fd2.append('datei', blob2, finalName);
              const kat = json.beleg_kategorie;
              const isKonto2 = ['kontoauszug', 'kreditkarte', 'online_zahlung'].includes(kat);
              if (isKonto2) {
                fd2.append('dokumenttyp', 'kontoauszug');
                fd2.append('kategorie', kat === 'kreditkarte' ? 'kreditkarte' : kat === 'online_zahlung' ? 'online_zahlung' : 'kontoauszug');
              } else {
                const agentTypMap = { eingangsbeleg: 'Eingangsrechnung', ausgangsbeleg: 'Ausgangsrechnung', sonstiger_beleg: 'Quittung' };
                fd2.append('dokumenttyp', 'beleg');
                fd2.append('belegtyp', agentTypMap[kat] || 'Eingangsrechnung');
              }
              fetch(`${AGENT_URL}/mandanten/${autoUser.id}/upload`, {
                method: 'POST', headers: { 'X-API-Key': AGENT_KEY }, body: fd2
              }).then(async r2 => {
                const body2 = await r2.json().catch(() => ({}));
                if (body2.id) db.prepare('UPDATE dokument_inbox SET agent_beleg_id=? WHERE id=?').run(body2.id, docId);
              }).catch(e => console.error('[MobileScan] Agent-Upload Fehler:', e.message));
            } catch(e) { console.error('[MobileScan] Agent-Upload Fehler:', e.message); }
          }
        }

        // Auto-Routing: BWA → bwa_dokumente
        if (json.bwa_kategorie && json.mandant_name) {
          const dupBwa = db.prepare('SELECT id FROM bwa_dokumente WHERE inbox_id=?').get(docId);
          if (!dupBwa) {
            db.prepare('INSERT INTO bwa_dokumente (inbox_id, mandant_name, bwa_kategorie, zeitraum_monat, zeitraum_jahr, kanzlei_id) VALUES (?,?,?,?,?,?)')
              .run(docId, json.mandant_name, json.bwa_kategorie, json.zeitraum_monat || null, json.zeitraum_jahr || null, kid);
          }
        }

        // Auto-Routing: Steuerbescheid → bescheide
        if (json.typ === 'steuerbescheid' && json.mandant_name) {
          const steuerArt = json.steuer_art || null;
          const istAenderung = json.ist_aenderungsbescheid === true;
          let bescheidEntry = null;

          if (steuerArt && json.steuerjahr) {
            const existing = db.prepare(`SELECT id FROM bescheide WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND tax_year=? AND bearbeitungsstand != 'abgeloest' ORDER BY erstellt_am DESC LIMIT 1`)
              .get(kid, json.mandant_name, steuerArt, json.steuerjahr);
            if (istAenderung && existing) {
              db.prepare(`UPDATE bescheide SET bearbeitungsstand='abgeloest' WHERE id=?`).run(existing.id);
              bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, vorgaenger_bescheid_id, erstellt_am) VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',1,?,CURRENT_TIMESTAMP) RETURNING id`)
                .get(kid, json.mandant_name, steuerArt, json.document_subtype || 'aenderungsbescheid', json.steuerjahr || null, finalName, finalPath, existing.id);
            } else if (!existing) {
              bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, erstellt_am) VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',0,CURRENT_TIMESTAMP) RETURNING id`)
                .get(kid, json.mandant_name, steuerArt, json.document_subtype || 'unbekannt', json.steuerjahr || null, finalName, finalPath);
            } else {
              bescheidEntry = existing;
            }
          } else {
            bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, erstellt_am) VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',0,CURRENT_TIMESTAMP) RETURNING id`)
              .get(kid, json.mandant_name, steuerArt, json.document_subtype || 'unbekannt', json.steuerjahr || null, finalName, finalPath);
          }

          if (bescheidEntry) {
            const exists = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND dateipfad=?').get(bescheidEntry.id, finalPath);
            if (!exists) {
              db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
                .run(bescheidEntry.id, kid, 'bescheid', finalName, finalPath);
            }
            // Passende Erklärung suchen (SQL, 0 Tokens): steuer_art + jahr + mandant
            const hatErkl = db.prepare("SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung'").get(bescheidEntry.id);
            if (!hatErkl && steuerArt && json.steuerjahr) {
              const archivErkl = db.prepare(`SELECT * FROM mandant_steuererklaerungen WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND steuerjahr=? AND bescheid_id IS NULL ORDER BY upload_datum DESC LIMIT 1`)
                .get(kid, json.mandant_name, steuerArt, json.steuerjahr);
              if (archivErkl) {
                db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)').run(bescheidEntry.id, kid, 'erklaerung', archivErkl.dateiname, archivErkl.dateipfad);
                db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(bescheidEntry.id, archivErkl.id);
              }
            }
            runBescheidDeepAnalyse(bescheidEntry.id, kid).catch(e => console.error('[MobileScan] Bescheid-Analyse Fehler:', e.message));
          }
        }
      } catch(e) {
        console.error('[MobileScan] Klassifizierung fehlgeschlagen:', e.message);
        db.prepare("UPDATE dokument_inbox SET status='fehler', typ='sonstiges' WHERE id=?").run(docId);
      }
    }
  });
});

// ─── INBOX ───────────────────────────────────────────────────────────────────

// Multer für Inbox-Uploads
const inboxStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DATA_DIR, 'uploads', 'inbox');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const inboxUpload = multer({ storage: inboxStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// SMTP Transporter
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ionos.de',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { rejectUnauthorized: false }
});

// ── AI Email Classifier ───────────────────────────────────────────────────────
async function classifyEmailRelevance(id, subject, fromAddr, bodyPreview) {
  try {
    const prompt = `Du bist ein Assistent für eine Steuerkanzlei. Entscheide ob diese Email für die Kanzlei relevant ist.

RELEVANT:
- Steuerbescheide vom Finanzamt (Einkommensteuer, Umsatzsteuer, Gewerbesteuer, Körperschaftsteuer, etc.)
- ELSTER-Mitteilungen und Eingangsbestätigungen
- Prüfungsankündigungen und Betriebsprüfungen
- Einspruchsbestätigungen und behördliche Entscheidungen
- Mahnbescheide und Vollstreckungsankündigungen
- Steuerliche Schreiben von Behörden und Gerichten
- Anfragen von Mandanten zu Steuerthemen

NICHT RELEVANT:
- Newsletter, Werbung, Marketing
- Lieferbestätigungen, Bestellungen
- Allgemeine Geschäftsmails ohne Steuerbezug
- Spam, automatische Benachrichtigungen

Von: ${fromAddr}
Betreff: ${subject}
Inhalt: ${(bodyPreview||'').substring(0,400)}

Antworte NUR mit JSON: {"relevant":true/false,"kategorie":"bescheid|einspruch|elster|finanzamt|mandant|sonstiges","grund":"max 8 Wörter"}`;
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [{ role: 'user', content: prompt }]
    });
    const json = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)[0]);
    db.prepare('UPDATE emails SET ki_relevant=?, ki_kategorie=? WHERE id=?')
      .run(json.relevant ? 1 : 0, json.kategorie || null, id);
    return json;
  } catch(e) {
    console.error('[classify]', e.message);
    db.prepare('UPDATE emails SET ki_relevant=0 WHERE id=?').run(id);
    return { relevant: false };
  }
}

let _classifying = false;
async function classifyPendingEmails() {
  if (_classifying) return;
  _classifying = true;
  try {
    const pending = db.prepare(
      "SELECT id, subject, from_addr, body_text FROM emails WHERE folder='INBOX' AND ki_relevant IS NULL LIMIT 8"
    ).all();
    for (const email of pending) {
      await classifyEmailRelevance(email.id, email.subject, email.from_addr, email.body_text);
    }
  } finally { _classifying = false; }
}

// ── IMAP Sync ─────────────────────────────────────────────────────────────────
let _imapSyncing = false;

async function syncEmails(folder = 'INBOX') {
  if (_imapSyncing) return;
  _imapSyncing = true;
  const client = createImapClient();
  client.on('error', (err) => {
    console.error('[IMAP] Socket-Fehler (ignoriert):', err.message);
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const status = await client.status(folder, { messages: true, unseen: true });
      const total  = status.messages || 0;
      const fetch  = Math.min(total, 100); // max 100 neueste
      if (fetch === 0) return;
      const existing = new Set(
        db.prepare('SELECT uid FROM emails WHERE folder=?').all(folder).map(r => r.uid)
      );
      const msgs = [];
      for await (const msg of client.fetch(`${Math.max(1, total - fetch + 1)}:*`, {
        uid: true, flags: true, envelope: true, bodyStructure: true,
        source: false, bodyParts: ['TEXT']
      })) {
        msgs.push(msg);
      }
      for (const msg of msgs) {
        const uid = String(msg.uid);
        if (existing.has(uid)) {
          // nur read-status updaten
          const isRead = msg.flags.has('\\Seen') ? 1 : 0;
          db.prepare('UPDATE emails SET is_read=? WHERE uid=? AND folder=?').run(isRead, uid, folder);
          continue;
        }
        // Hole Body
        let bodyText = '', bodyHtml = '';
        try {
          const full = await client.fetchOne(uid, { source: true }, { uid: true });
          const raw  = full.source.toString('utf8');
          // simple extraction
          const textMatch = raw.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-Type:|$)/i);
          const htmlMatch  = raw.match(/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\nContent-Type:|$)/i);
          const decodeQP = s => s.replace(/=\r\n/g,'').replace(/=([0-9A-F]{2})/gi,(m,h)=>String.fromCharCode(parseInt(h,16)));
          if (textMatch) bodyText = decodeQP(textMatch[1]).trim();
          if (htmlMatch) bodyHtml = decodeQP(htmlMatch[1]).trim();
          if (!bodyText && !bodyHtml) bodyText = raw.replace(/^[\s\S]*?\r\n\r\n/, '').substring(0, 5000);
        } catch(e) {}
        const env = msg.envelope || {};
        const from = (env.from && env.from[0]) || {};
        const to   = (env.to   && env.to[0])   || {};
        const isRead = msg.flags && msg.flags.has('\\Seen') ? 1 : 0;
        const hasAtt = msg.bodyStructure && msg.bodyStructure.childNodes &&
          msg.bodyStructure.childNodes.some(n => n.disposition === 'attachment') ? 1 : 0;
        db.prepare(`INSERT OR IGNORE INTO emails
          (uid,folder,message_id,from_addr,from_name,to_addr,subject,date,body_text,body_html,is_read,has_attachments,is_sent)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          uid, folder,
          env.messageId || null,
          from.address || null, from.name || null,
          to.address || null,
          env.subject || '(kein Betreff)',
          env.date ? new Date(env.date).toISOString() : new Date().toISOString(),
          bodyText || null, bodyHtml || null,
          isRead, hasAtt, folder === 'Sent' ? 1 : 0
        );
        // Store attachment metadata
        if (hasAtt && msg.bodyStructure) {
          const extractParts = (node, idx) => {
            if (!node) return;
            if (node.disposition === 'attachment' || (node.disposition === 'inline' && node.parameters && node.parameters.name)) {
              const filename = (node.parameters && (node.parameters.name || node.parameters.filename)) || 'Anhang';
              const newEmailId = db.prepare('SELECT id FROM emails WHERE uid=? AND folder=?').get(uid, folder);
              if (newEmailId) {
                try {
                  db.prepare('INSERT OR IGNORE INTO email_attachments(email_id, filename, mime_type, size, part_id) VALUES(?,?,?,?,?)')
                    .run(newEmailId.id, filename, node.type + '/' + node.subtype, node.size || 0, node.part || String(idx));
                } catch(e) {}
              }
            }
            if (node.childNodes) node.childNodes.forEach((c, i) => extractParts(c, i+1));
          };
          extractParts(msg.bodyStructure, 1);
        }
        // Auto-Mandant-Match
        const email_id = db.prepare('SELECT id FROM emails WHERE uid=? AND folder=?').get(uid, folder);
        if (email_id && from.address) {
          const mandant = db.prepare("SELECT id FROM users WHERE LOWER(email)=LOWER(?)").get(from.address);
          if (mandant) {
            try { db.prepare('INSERT OR IGNORE INTO email_mandant(email_id,user_id) VALUES(?,?)').run(email_id.id, mandant.id); } catch(e) {}
          }
        }
      }
    } finally { lock.release(); }
    await client.logout();
    // Neue INBOX-Emails sofort klassifizieren
    if (folder === 'INBOX') classifyPendingEmails().catch(()=>{});
  } catch(e) {
    console.error('[IMAP Sync]', e.message);
  } finally { _imapSyncing = false; }
}

// ── GET /api/kanzlei/email/inbox ──────────────────────────────────────────────
app.get('/api/kanzlei/email/inbox', kanzleiMiddleware, (req, res) => {
  const folder = req.query.folder || 'INBOX';
  const rows = db.prepare(`
    SELECT e.id, e.uid, e.folder, e.from_addr, e.from_name, e.subject, e.date,
           e.is_read, e.has_attachments, e.is_sent, e.message_id,
           SUBSTR(COALESCE(e.body_text,''),1,140) AS preview,
           GROUP_CONCAT(em.user_id) AS mandant_ids,
           GROUP_CONCAT(u.name, '||') AS mandant_names
    FROM emails e
    LEFT JOIN email_mandant em ON em.email_id = e.id
    LEFT JOIN users u ON u.id = em.user_id
    WHERE e.folder=?
    GROUP BY e.id
    ORDER BY e.date DESC
    LIMIT 200
  `).all(folder);
  res.json(rows);
});

// ── GET /api/kanzlei/email/relevant ──────────────────────────────────────────
app.get('/api/kanzlei/email/relevant', kanzleiMiddleware, (req, res) => {
  const type = req.query.type || 'important';
  let rows;
  if (type === 'sent') {
    rows = db.prepare(`
      SELECT e.id, e.uid, e.folder, e.from_addr, e.from_name, e.to_addr, e.subject, e.date,
             e.is_read, e.has_attachments, e.is_sent, e.message_id, e.ki_kategorie,
             SUBSTR(COALESCE(e.body_text,''),1,140) AS preview
      FROM emails e WHERE e.is_sent=1 ORDER BY e.date DESC LIMIT 100
    `).all();
  } else {
    rows = db.prepare(`
      SELECT e.id, e.uid, e.folder, e.from_addr, e.from_name, e.subject, e.date,
             e.is_read, e.has_attachments, e.is_sent, e.message_id, e.ki_kategorie,
             SUBSTR(COALESCE(e.body_text,''),1,140) AS preview,
             GROUP_CONCAT(u.name,'||') AS mandant_names
      FROM emails e
      LEFT JOIN email_mandant em ON em.email_id=e.id
      LEFT JOIN users u ON u.id=em.user_id
      WHERE e.ki_relevant=1 AND e.folder='INBOX'
      GROUP BY e.id ORDER BY e.date DESC LIMIT 100
    `).all();
  }
  const pending = db.prepare("SELECT COUNT(*) AS n FROM emails WHERE folder='INBOX' AND ki_relevant IS NULL").get();
  res.json({ emails: rows, pending: pending.n });
});

// ── GET /api/kanzlei/email/:id ────────────────────────────────────────────────
app.get('/api/kanzlei/email/:id', kanzleiMiddleware, (req, res) => {
  const email = db.prepare(`
    SELECT e.*, GROUP_CONCAT(em.user_id) AS mandant_ids,
           GROUP_CONCAT(u.name, '||') AS mandant_names
    FROM emails e
    LEFT JOIN email_mandant em ON em.email_id = e.id
    LEFT JOIN users u ON u.id = em.user_id
    WHERE e.id=?
    GROUP BY e.id
  `).get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email nicht gefunden' });
  db.prepare('UPDATE emails SET is_read=1 WHERE id=?').run(req.params.id);
  const attachments = db.prepare('SELECT id,filename,mime_type,size FROM email_attachments WHERE email_id=?').all(req.params.id);
  res.json({ ...email, attachments });
});

// ── PATCH /api/kanzlei/email/:id/read ────────────────────────────────────────
app.patch('/api/kanzlei/email/:id/read', kanzleiMiddleware, (req, res) => {
  const val = req.body.is_read !== undefined ? (req.body.is_read ? 1 : 0) : 1;
  db.prepare('UPDATE emails SET is_read=? WHERE id=?').run(val, req.params.id);
  res.json({ ok: true });
});

// ── PATCH /api/kanzlei/email/:id/assign ──────────────────────────────────────
app.patch('/api/kanzlei/email/:id/assign', kanzleiMiddleware, (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    db.prepare('DELETE FROM email_mandant WHERE email_id=?').run(req.params.id);
  } else {
    db.prepare('INSERT OR IGNORE INTO email_mandant(email_id,user_id,assigned_by) VALUES(?,?,?)').run(req.params.id, userId, req.staffId);
  }
  res.json({ ok: true });
});

// ── GET /api/kanzlei/email/counts ─────────────────────────────────────────────
app.get('/api/kanzlei/email/counts', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare(`SELECT folder, COUNT(*) as total, SUM(CASE WHEN is_read=0 THEN 1 ELSE 0 END) as unread FROM emails GROUP BY folder`).all();
  const result = {};
  rows.forEach(r => result[r.folder] = { total: r.total, unread: r.unread || 0 });
  res.json(result);
});

// ── GET /api/kanzlei/email/search ─────────────────────────────────────────────
app.get('/api/kanzlei/email/search', kanzleiMiddleware, (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  const folder = req.query.folder || null;
  const rows = db.prepare(`
    SELECT id, uid, folder, from_addr, from_name, subject, date, is_read, has_attachments,
           SUBSTR(COALESCE(body_text,''),1,140) AS preview
    FROM emails
    WHERE (from_name LIKE ? OR from_addr LIKE ? OR subject LIKE ? OR body_text LIKE ?)
    ${folder ? 'AND folder=?' : ''}
    ORDER BY date DESC LIMIT 100
  `).all(q, q, q, q, ...(folder ? [folder] : []));
  res.json(rows);
});

// ── PATCH /api/kanzlei/email/:id/move ─────────────────────────────────────────
app.patch('/api/kanzlei/email/:id/move', kanzleiMiddleware, async (req, res) => {
  const { folder: targetFolder } = req.body;
  if (!targetFolder) return res.status(400).json({ error: 'folder required' });
  const email = db.prepare('SELECT * FROM emails WHERE id=?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Not found' });
  try {
    const client = createImapClient();
    await client.connect();
    const lock = await client.getMailboxLock(email.folder);
    try { await client.messageMove(email.uid, targetFolder, { uid: true }); }
    catch(e) { console.error('[IMAP MOVE]', e.message); }
    finally { lock.release(); }
    await client.logout();
  } catch(e) { console.error('[IMAP MOVE connect]', e.message); }
  db.prepare('UPDATE emails SET folder=? WHERE id=?').run(targetFolder, req.params.id);
  res.json({ ok: true });
});

// ── GET /api/kanzlei/email/:id/attachment/:attId ───────────────────────────────
app.get('/api/kanzlei/email/:id/attachment/:attId', kanzleiMiddleware, async (req, res) => {
  const att = db.prepare('SELECT * FROM email_attachments WHERE id=? AND email_id=?').get(req.params.attId, req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  const email = db.prepare('SELECT uid, folder FROM emails WHERE id=?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  try {
    const client = createImapClient();
    await client.connect();
    const lock = await client.getMailboxLock(email.folder);
    try {
      const partId = att.part_id || '2';
      const download = await client.download(email.uid, partId, { uid: true });
      res.set('Content-Type', att.mime_type || 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.filename || 'download')}`);
      download.content.pipe(res);
      await new Promise((resolve, reject) => { download.content.on('end', resolve); download.content.on('error', reject); res.on('finish', resolve); });
    } finally { lock.release(); }
    await client.logout();
  } catch(e) { if (!res.headersSent) res.status(500).json({ error: e.message }); }
});

// ── POST /api/kanzlei/email/send ─────────────────────────────────────────────
app.post('/api/kanzlei/email/send', kanzleiMiddleware, async (req, res) => {
  const { to, subject, body, replyToMessageId, replyToEmailId } = req.body;
  if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, body erforderlich' });
  try {
    const mailOpts = {
      from: process.env.SMTP_FROM || `H&K Steuerberatung <${process.env.SMTP_USER}>`,
      to, subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    };
    if (replyToMessageId) {
      mailOpts.inReplyTo = replyToMessageId;
      mailOpts.references = replyToMessageId;
    }
    if (req.body.cc)  mailOpts.cc  = req.body.cc;
    if (req.body.bcc) mailOpts.bcc = req.body.bcc;
    if (req.body.attachments && req.body.attachments.length) {
      mailOpts.attachments = req.body.attachments.map(a => ({
        filename: a.filename,
        content: Buffer.from(a.data, 'base64'),
        contentType: a.mimeType || 'application/octet-stream'
      }));
    }
    await smtpTransporter.sendMail(mailOpts);
    // Gesendete Mail lokal speichern
    const sess = getStaffSession ? null : null; // placeholder
    db.prepare(`INSERT INTO emails (uid,folder,from_addr,from_name,to_addr,subject,date,body_text,is_read,is_sent)
      VALUES (?,?,?,?,?,?,?,?,1,1)`).run(
      'sent_' + Date.now(), 'Sent',
      process.env.SMTP_USER, 'H&K Steuerberatung',
      to, subject, new Date().toISOString(), body
    );
    if (replyToEmailId) {
      const sentId = db.prepare('SELECT id FROM emails WHERE uid=? AND folder=?').get('sent_' + Date.now(), 'Sent');
      // assign same mandants
      const mands = db.prepare('SELECT user_id FROM email_mandant WHERE email_id=?').all(replyToEmailId);
      const newId = db.prepare('SELECT id FROM emails ORDER BY id DESC LIMIT 1').get();
      if (newId) mands.forEach(m => {
        try { db.prepare('INSERT OR IGNORE INTO email_mandant(email_id,user_id) VALUES(?,?)').run(newId.id, m.user_id); } catch(e) {}
      });
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('[SMTP]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/kanzlei/email/sync ─────────────────────────────────────────────
app.post('/api/kanzlei/email/sync', kanzleiMiddleware, async (req, res) => {
  syncEmails('INBOX').catch(console.error);
  res.json({ ok: true, message: 'Sync gestartet' });
});

// ── GET /api/kanzlei/email/stats ─────────────────────────────────────────────
app.get('/api/kanzlei/email/stats', kanzleiMiddleware, (req, res) => {
  const unread = db.prepare("SELECT COUNT(*) as cnt FROM emails WHERE is_read=0 AND folder='INBOX'").get();
  res.json({ unread: unread.cnt });
});

// ── POST /api/kanzlei/email/:id/to-task ──────────────────────────────────────
app.post('/api/kanzlei/email/:id/to-task', kanzleiMiddleware, (req, res) => {
  const email = db.prepare('SELECT * FROM emails WHERE id=?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email nicht gefunden' });
  const title = `E-Mail: ${email.subject}`;
  const mandant = db.prepare('SELECT user_id FROM email_mandant WHERE email_id=?').get(req.params.id);
  try {
    const r = db.prepare('INSERT INTO aufgaben (titel,beschreibung,kanzlei_id,user_id,faellig,erledigt,created_at) VALUES (?,?,?,?,?,0,CURRENT_TIMESTAMP)')
      .run(title, `Von: ${email.from_addr}\n\n${(email.body_text||'').substring(0,500)}`,
           req.kanzleiId, mandant ? mandant.user_id : null, null);
    res.json({ ok: true, taskId: r.lastInsertRowid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/kanzlei/email/:id/ai-reply ─────────────────────────────────────
app.post('/api/kanzlei/email/:id/ai-reply', kanzleiMiddleware, async (req, res) => {
  const email = db.prepare('SELECT * FROM emails WHERE id=?').get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email nicht gefunden' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      messages: [{ role: 'user', content:
        `Du bist Mitarbeiter der Steuerberatungskanzlei H&K Steuerberatung. Schreibe eine professionelle, freundliche Antwort auf folgende E-Mail. Nur der Antworttext, keine Betreffzeile, keine Anrede-Erklärung.\n\nBetreff: ${email.subject}\nVon: ${email.from_name || email.from_addr}\n\n${(email.body_text||'').substring(0,1000)}`
      }]
    });
    res.json({ reply: msg.content[0].text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
app.get('/api/kanzlei/dashboard', kanzleiMiddleware, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const in7   = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];

  const termine_heute = db.prepare(
    `SELECT * FROM kalender_termine WHERE datum=? AND kanzlei_id=? ORDER BY uhrzeit ASC`
  ).all(today, req.kanzleiId);

  const termine_naechste = db.prepare(
    `SELECT * FROM kalender_termine WHERE datum>? AND datum<=? AND kanzlei_id=? ORDER BY datum ASC, uhrzeit ASC`
  ).all(today, in7, req.kanzleiId);

  const fristen_dringend = db.prepare(
    `SELECT * FROM fristen WHERE erledigt=0 AND faellig_am<=? AND kanzlei_id=? ORDER BY faellig_am ASC`
  ).all(in7, req.kanzleiId);

  const fristen_alle = db.prepare(
    `SELECT * FROM fristen WHERE erledigt=0 AND kanzlei_id=? ORDER BY faellig_am ASC LIMIT 8`
  ).all(req.kanzleiId);

  const aufgaben_offen = db.prepare(
    `SELECT * FROM aufgaben WHERE status='offen' AND kanzlei_id=? ORDER BY faellig_am ASC LIMIT 6`
  ).all(req.kanzleiId);

  // Mandanten im Fokus: Mandanten mit Fristen ≤7 Tage oder Termin heute/diese Woche
  const fokusMap = {};
  fristen_dringend.forEach(f => {
    const key = f.mandant_name || '__ohne__';
    if (!f.mandant_name) return;
    if (!fokusMap[key]) fokusMap[key] = { name: f.mandant_name, fristen: [], termine: [] };
    fokusMap[key].fristen.push(f);
  });
  [...termine_heute, ...termine_naechste].forEach(t => {
    if (!t.mandant_name) return;
    const key = t.mandant_name;
    if (!fokusMap[key]) fokusMap[key] = { name: t.mandant_name, fristen: [], termine: [] };
    if (!fokusMap[key].termine.find(x => x.id === t.id)) fokusMap[key].termine.push(t);
  });

  // KPIs
  const kpi_mandanten = db.prepare(`SELECT COUNT(*) as c FROM submissions WHERE kanzlei_id=?`).get(req.kanzleiId)?.c || 0;
  const kpi_fristen   = db.prepare(`SELECT COUNT(*) as c FROM fristen WHERE erledigt=0 AND kanzlei_id=?`).get(req.kanzleiId)?.c || 0;
  const kpi_aufgaben  = db.prepare(`SELECT COUNT(*) as c FROM aufgaben WHERE status='offen' AND kanzlei_id=?`).get(req.kanzleiId)?.c || 0;
  const kpi_termine   = termine_heute.length;

  res.json({
    termine_heute,
    termine_naechste,
    fristen_dringend,
    fristen_alle,
    aufgaben_offen,
    fokus_mandanten: Object.values(fokusMap).sort((a, b) => {
      const score = m => {
        if (m.termine.length) {
          const t = m.termine.sort((x,y) => (x.datum+x.uhrzeit) < (y.datum+y.uhrzeit) ? -1 : 1)[0];
          const days = Math.round((new Date(t.datum) - new Date(new Date().toISOString().slice(0,10))) / 86400000);
          const h = t.uhrzeit ? parseInt(t.uhrzeit.split(':')[0]) : 23;
          return days * 100 + h;
        }
        if (m.fristen.length) {
          const days = Math.round((new Date(m.fristen[0].faellig_am) - new Date(new Date().toISOString().slice(0,10))) / 86400000);
          return 10000 + days;
        }
        return 99999;
      };
      return score(a) - score(b);
    }).slice(0, 6),
    kpis: { mandanten: kpi_mandanten, fristen: kpi_fristen, aufgaben: kpi_aufgaben, termine: kpi_termine }
  });
});

// ─── TEAM CHAT ────────────────────────────────────────────────────────────────
app.get('/api/chat', kanzleiMiddleware, (req, res) => {
  const msgs = db.prepare('SELECT * FROM chat_messages WHERE kanzlei_id=? ORDER BY created_at DESC LIMIT 40').all(req.kanzleiId);
  res.json(msgs.reverse());
});
app.post('/api/chat', kanzleiMiddleware, (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Leer' });
  // Name aus JWT — nicht vom Client vertrauen
  let senderName = 'Mitarbeiter';
  let senderId = null;
  if (req.staffId) {
    const s = db.prepare('SELECT name FROM kanzlei_staff WHERE id=?').get(req.staffId);
    senderName = s ? s.name : 'Mitarbeiter';
    senderId = req.staffId;
  } else {
    // Kanzlei-Admin
    const k = db.prepare('SELECT name FROM kanzleien WHERE id=?').get(req.kanzleiId);
    senderName = k ? k.name : 'Admin';
    senderId = 0; // 0 = Master-Admin
  }
  const r = db.prepare('INSERT INTO chat_messages (kanzlei_id, user_name, staff_id, message) VALUES (?,?,?,?)').run(req.kanzleiId, senderName, senderId, message.trim());
  res.json({ id: r.lastInsertRowid, user_name: senderName, staff_id: senderId });
});

// ─── Dokument-Inbox Endpoints ─────────────────────────────────────────────────

// GET /api/inbox/:id/download — Originaldatei herunterladen (Auth via ?token=)
app.get('/api/inbox/:id/download', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).send('Unauthorized');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch(e) { return res.status(401).send('Unauthorized'); }
  const kid = payload.kanzleiId || 1;
  const doc = db.prepare('SELECT * FROM dokument_inbox WHERE id=? AND kanzlei_id=?').get(req.params.id, kid);
  if (!doc) return res.status(404).send('Nicht gefunden');
  if (!doc.dateipfad || !fs.existsSync(doc.dateipfad)) {
    // Datei existiert nicht (Demo-Seed) → HTML-Vorschau als Fallback
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(generateDocPreviewHTML(doc));
  }
  res.download(doc.dateipfad, doc.dateiname || 'dokument.pdf');
});

// GET /api/inbox/:id/pdf-preview — HTML-Dokument-Vorschau (Auth via ?token=)
app.get('/api/inbox/:id/pdf-preview', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).send('Unauthorized');
  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch(e) { return res.status(401).send('Unauthorized'); }
  const kid = payload.kanzleiId || 1;
  const doc = db.prepare('SELECT * FROM dokument_inbox WHERE id=? AND kanzlei_id=?').get(req.params.id, kid);
  if (!doc) return res.status(404).send('Dokument nicht gefunden');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(generateDocPreviewHTML(doc));
});

function generateDocPreviewHTML(doc) {
  const fmt = (v) => v ? new Date(v).toLocaleDateString('de-DE') : '—';
  const typ = doc.typ || 'sonstiges';
  const mandant = doc.mandant_name || '—';
  const betrag = doc.betrag || '';
  const jahr = doc.steuerjahr || '';
  const steuernr = doc.steuernummer || '';
  const zusammenfassung = doc.zusammenfassung || '';
  const dateiname = doc.dateiname || '';
  const datum = fmt(doc.upload_datum);
  const frist = doc.frist_datum ? fmt(doc.frist_datum) : null;

  const akzent = '#6d7aff';

  // Typ-spezifische Inhalte
  let header = '', absender = '', logoText = '', inhalt = '';

  if (typ === 'kontoauszug') {
    if (dateiname.includes('bauer') || mandant === 'Alexander Bauer') logoText = 'Sparkasse Freiburg';
    else if (dateiname.includes('huber') || mandant.includes('Huber')) logoText = 'HypoVereinsbank';
    else if (dateiname.includes('kramer') || mandant === 'Felix Kramer') logoText = 'Deutsche Bank';
    else logoText = 'Commerzbank AG';
    absender = logoText;
    header = dateiname.includes('Kredit') || dateiname.includes('kreditkarte') ? 'Kreditkartenabrechnung' : 'Kontoauszug';
    const ktonr = dateiname.includes('bauer') ? 'DE82 6805 0101 0012 3456 78' : dateiname.includes('huber') ? 'DE44 2001 0020 0123 4567 89' : 'DE27 1007 0000 0123 4567 00';
    inhalt = `
      <table style="width:100%;border-collapse:collapse;font-size:10pt;margin-top:8px">
        <tr style="background:#f0f0f8"><th style="padding:6px 10px;text-align:left;border-bottom:2px solid ${akzent}">Datum</th><th style="padding:6px 10px;text-align:left;border-bottom:2px solid ${akzent}">Buchungstext</th><th style="padding:6px 10px;text-align:right;border-bottom:2px solid ${akzent}">Betrag</th><th style="padding:6px 10px;text-align:right;border-bottom:2px solid ${akzent}">Saldo</th></tr>
        <tr><td style="padding:5px 10px;border-bottom:1px solid #eee">01.12.2024</td><td style="padding:5px 10px;border-bottom:1px solid #eee">Gutschrift Honorar/Provision</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee;color:green">+8.000,00 €</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">${betrag} €</td></tr>
        <tr style="background:#fafafa"><td style="padding:5px 10px;border-bottom:1px solid #eee">05.12.2024</td><td style="padding:5px 10px;border-bottom:1px solid #eee">SEPA-Überweisung Miete</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee;color:#c82333">-1.850,00 €</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">${betrag} €</td></tr>
        <tr><td style="padding:5px 10px;border-bottom:1px solid #eee">12.12.2024</td><td style="padding:5px 10px;border-bottom:1px solid #eee">Lastschrift Versicherung SIGNAL IDUNA</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee;color:#c82333">-1.570,00 €</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">${betrag} €</td></tr>
        <tr style="background:#fafafa"><td style="padding:5px 10px;border-bottom:1px solid #eee">18.12.2024</td><td style="padding:5px 10px;border-bottom:1px solid #eee">Eingang Steuererstattung Finanzamt</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee;color:green">+3.214,80 €</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">${betrag} €</td></tr>
        <tr><td style="padding:5px 10px;border-bottom:1px solid #eee">23.12.2024</td><td style="padding:5px 10px;border-bottom:1px solid #eee">Kartenzahlung Bürobedarf</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee;color:#c82333">-248,90 €</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">${betrag} €</td></tr>
        <tr><td style="padding:5px 10px;border-bottom:1px solid #eee">31.12.2024</td><td style="padding:5px 10px;border-bottom:1px solid #eee">Abschlusssaldo 31.12.2024</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee"></td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:700;color:${akzent}">${betrag} €</td></tr>
      </table>
      <div style="margin-top:14px;font-size:9pt;color:#777">IBAN: ${ktonr} · BIC: ${logoText.startsWith('Sparkasse')?'FRSPDE66':'HYVEDEMM'} · Kontoinhaber: ${mandant}</div>`;
  } else if (typ === 'steuererklaerung' && (dateiname.toLowerCase().includes('lohn') || doc.typ_label?.includes('Lohnsteuer'))) {
    absender = 'Finanzamt Freiburg-Stadt';
    header = 'Lohnsteuerbescheinigung ' + jahr;
    inhalt = `
      <table style="width:100%;border-collapse:collapse;font-size:10pt">
        <tr style="background:#f0f0f8"><th colspan="2" style="padding:8px 10px;text-align:left;border-bottom:2px solid ${akzent};color:${akzent}">Angaben des Arbeitgebers</th></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;width:60%;color:#555">Bruttoarbeitslohn (Nr. 3)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${betrag} €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Einbehaltene Lohnsteuer (Nr. 4)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${Math.round(parseFloat((betrag||'0').replace(/\./g,'').replace(',','.'))*0.19).toLocaleString('de-DE')+',00'} €</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Solidaritätszuschlag (Nr. 5)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">1.045,20 €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Kirchensteuer (Nr. 6)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">—</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Steuerklasse</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">I</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Steuernummer</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${steuernr}</td></tr>
      </table>`;
  } else if (typ === 'steuererklaerung' && (doc.typ_label?.includes('PKV') || dateiname.includes('PKV'))) {
    absender = dateiname.includes('Debeka') ? 'Debeka Krankenversicherung' : 'SIGNAL IDUNA Krankenversicherung';
    header = 'Jahresbescheinigung Krankenversicherungsbeiträge ' + jahr;
    inhalt = `
      <div style="background:#f0f4ff;border-radius:8px;padding:14px;margin-bottom:14px;font-size:10pt">
        <strong>Bescheinigung für die Einkommensteuererklärung gemäß § 10 Abs. 1 Nr. 3 EStG</strong>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10pt">
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Versicherungsnehmer</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${mandant}</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Versicherungsjahr</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${jahr}</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Gezahlte Beiträge (Basisschutz, § 10 Abs. 1 Nr. 3a)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:700;color:${akzent}">${betrag} €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Davon steuerlich absetzbar</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">${betrag} €</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Arbeitgeberanteil (abzuziehen)</td><td style="padding:6px 10px;border-bottom:1px solid #eee">—</td></tr>
      </table>`;
  } else if (typ === 'steuererklaerung' && (doc.typ_label?.includes('EÜR') || doc.typ_label?.includes('EUeR') || dateiname.includes('EÜR') || dateiname.includes('EUeR') || dateiname.includes('Überschuss') || dateiname.includes('Ueberschuss'))) {
    absender = 'Bundesministerium der Finanzen · Anlage EÜR';
    header = 'Einnahmenüberschussrechnung (EÜR) ' + jahr;
    inhalt = `
      <table style="width:100%;border-collapse:collapse;font-size:10pt">
        <tr style="background:#f0f0f8"><th colspan="2" style="padding:8px 10px;text-align:left;border-bottom:2px solid ${akzent};color:${akzent}">Betriebseinnahmen</th></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Umsatzerlöse (Zeile 11)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${betrag} €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Erhaltene Umsatzsteuer (Zeile 16)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">inkl.</td></tr>
        <tr style="background:#e8eaff"><th colspan="2" style="padding:8px 10px;text-align:left;border-bottom:2px solid ${akzent};color:${akzent}">Betriebsausgaben</th></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Raumkosten / Miete (Zeile 47)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">22.200,00 €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">AfA / Abschreibungen (Zeile 29)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">8.400,00 €</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Sonstige Betriebsausgaben (Zeile 68)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">6.180,00 €</td></tr>
        <tr style="background:#f0f4ff"><td style="padding:8px 10px;font-weight:700;border-top:2px solid ${akzent}">Gewinn / Überschuss</td><td style="padding:8px 10px;text-align:right;font-weight:700;color:${akzent};border-top:2px solid ${akzent}">${betrag} €</td></tr>
      </table>`;
  } else if (typ === 'steuererklaerung' && (doc.typ_label?.includes('Depot') || dateiname.includes('Depot') || dateiname.includes('steuer'))) {
    absender = 'Comdirect Bank · Depotbescheinigung';
    header = 'Jahressteuerbescheinigung ' + jahr;
    inhalt = `
      <div style="background:#fff8e6;border-left:3px solid #f0a500;padding:10px 14px;margin-bottom:14px;font-size:9.5pt;border-radius:0 6px 6px 0">
        Kapitalertragsteuer bereits einbehalten. Günstigerprüfung möglicherweise vorteilhaft.
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10pt">
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Kapitalerträge gesamt (§ 32d EStG)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${akzent}">${betrag} €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Einbehaltene Kapitalertragsteuer (25%)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">2.105,00 €</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Solidaritätszuschlag (5,5%)</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">115,78 €</td></tr>
        <tr style="background:#fafafa"><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Sparer-Pauschbetrag angerechnet</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">1.000,00 €</td></tr>
        <tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">Depot-Nr.</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">634 812 00 · ${mandant}</td></tr>
      </table>`;
  } else if (typ === 'rechnung_eingang' || typ === 'rechnung_ausgang') {
    absender = dateiname.includes('AdSense') ? 'Google Ireland Limited' : dateiname.includes('Betriebsausgaben') ? mandant : 'Lieferant / Dienstleister';
    header = (typ === 'rechnung_ausgang' ? 'Ausgangsrechnung' : 'Eingangsrechnung / Beleg') + ' – ' + (doc.zeitraum_monat ? `${doc.zeitraum_monat}/${doc.zeitraum_jahr}` : String(jahr));
    inhalt = `
      <table style="width:100%;border-collapse:collapse;font-size:10pt">
        <tr style="background:#f0f0f8"><th style="padding:6px 10px;text-align:left;border-bottom:2px solid ${akzent}">Pos.</th><th style="padding:6px 10px;text-align:left;border-bottom:2px solid ${akzent}">Beschreibung</th><th style="padding:6px 10px;text-align:right;border-bottom:2px solid ${akzent}">Betrag netto</th><th style="padding:6px 10px;text-align:right;border-bottom:2px solid ${akzent}">MwSt.</th></tr>
        <tr><td style="padding:5px 10px;border-bottom:1px solid #eee">1</td><td style="padding:5px 10px;border-bottom:1px solid #eee">${zusammenfassung.split('.')[0] || 'Leistung gemäß Vereinbarung'}</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">${betrag} €</td><td style="padding:5px 10px;text-align:right;border-bottom:1px solid #eee">19%</td></tr>
        <tr style="background:#fafafa"><td colspan="2" style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:600">Nettobetrag</td><td style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee;font-weight:600">${betrag} €</td><td style="padding:6px 10px;border-bottom:1px solid #eee"></td></tr>
        <tr><td colspan="2" style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">zzgl. USt. 19%</td><td style="padding:6px 10px;text-align:right;border-bottom:1px solid #eee">inkl.</td><td style="padding:6px 10px;border-bottom:1px solid #eee"></td></tr>
        <tr style="background:#f0f4ff"><td colspan="2" style="padding:8px 10px;font-weight:700;border-top:2px solid ${akzent}">Gesamtbetrag brutto</td><td style="padding:8px 10px;text-align:right;font-weight:700;color:${akzent};border-top:2px solid ${akzent}">${betrag} €</td><td style="padding:8px 10px;border-top:2px solid ${akzent}"></td></tr>
      </table>`;
  } else {
    absender = 'H&K Automation · Dokumentenscanner';
    header = doc.typ_label || dateiname;
    inhalt = `<div style="font-size:11pt;color:#333;line-height:1.8;padding:10px 0">${zusammenfassung}</div>`;
  }

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; background: #f5f5f2; padding: 20px; }
  .paper { background: white; max-width: 700px; margin: 0 auto; padding: 40px 48px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); min-height: 800px; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid ${akzent}; }
  .org-name { font-size: 15pt; font-weight: 700; color: ${akzent}; }
  .org-sub { font-size: 9pt; color: #888; margin-top: 3px; }
  .doc-title-block { text-align: right; }
  .doc-title { font-size: 13pt; font-weight: 700; color: #1a1a2e; }
  .doc-sub { font-size: 9pt; color: #777; margin-top: 4px; }
  .recipient-block { margin-bottom: 24px; }
  .recipient-label { font-size: 8pt; color: #aaa; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
  .recipient-name { font-size: 12pt; font-weight: 600; }
  .recipient-detail { font-size: 9pt; color: #666; }
  .meta-row { display: flex; gap: 32px; margin-bottom: 24px; }
  .meta-item label { font-size: 8pt; color: #aaa; text-transform: uppercase; letter-spacing: .07em; display: block; }
  .meta-item span { font-size: 10pt; font-weight: 600; color: #1a1a2e; }
  .content { margin-top: 8px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 8pt; color: #aaa; display: flex; justify-content: space-between; }
  ${frist ? `.frist-badge { background: #fff0f0; border: 1px solid #f8c4c4; border-radius: 6px; padding: 8px 12px; margin-bottom: 20px; font-size: 9pt; color: #c82333; font-weight: 600; }` : ''}
</style></head><body><div class="paper">
  <div class="doc-header">
    <div><div class="org-name">${absender}</div><div class="org-sub">Steuerjahr ${jahr} · Steuernummer ${steuernr}</div></div>
    <div class="doc-title-block"><div class="doc-title">${header}</div><div class="doc-sub">Erstellt: ${datum}</div></div>
  </div>
  <div class="recipient-block">
    <div class="recipient-label">Für</div>
    <div class="recipient-name">${mandant}</div>
    <div class="recipient-detail">Steuernummer ${steuernr} · Steuerjahr ${jahr}</div>
  </div>
  ${frist ? `<div class="frist-badge">⚠ Frist: ${frist} — Einreichung oder Bearbeitung bis zu diesem Datum erforderlich</div>` : ''}
  <div class="meta-row">
    <div class="meta-item"><label>Dokument</label><span>${doc.typ_label || typ}</span></div>
    <div class="meta-item"><label>Betrag</label><span>${betrag ? betrag+' €' : '—'}</span></div>
    <div class="meta-item"><label>Zeitraum</label><span>${doc.zeitraum_monat ? doc.zeitraum_monat+'/'+doc.zeitraum_jahr : String(jahr)}</span></div>
  </div>
  <div class="content">${inhalt}</div>
  <div class="footer"><span>${absender} · Automatisch klassifiziert von H&K Automation KI</span><span>Seite 1 von 1</span></div>
</div></body></html>`;
}

// GET alle Dokumente
app.get('/api/inbox/dokumente', kanzleiMiddleware, (req, res) => {
  const kid = req.kanzleiId || 1;
  const docs = db.prepare('SELECT * FROM dokument_inbox WHERE kanzlei_id=? ORDER BY upload_datum DESC').all(kid);
  res.json(docs);
});

// POST Upload + async KI-Klassifikation
app.post('/api/inbox/upload', kanzleiMiddleware, inboxUpload.single('dokument'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const kid = req.kanzleiId || 1;
  const r = db.prepare(`INSERT INTO dokument_inbox (kanzlei_id, dateiname, dateipfad, status) VALUES (?,?,?,'scanning')`)
    .run(kid, req.file.originalname, req.file.path);
  const docId = r.lastInsertRowid;
  res.json({ id: docId, status: 'scanning' });

  // Async KI-Klassifikation im Hintergrund
  setImmediate(async () => {
    async function apiWithRetry(fn, retries = 2, delayMs = 4000) {
      for (let i = 0; i <= retries; i++) {
        try { return await fn(); }
        catch(e) {
          const status = e.status || e.statusCode || 0;
          if (i < retries && status >= 500) {
            console.warn(`[Inbox Klassifizierer] API ${status} – Retry ${i+1}/${retries} in ${delayMs}ms`);
            await new Promise(r => setTimeout(r, delayMs));
          } else throw e;
        }
      }
    }

    try {
      // Prompt neu laden (damit Änderungen am agent.md live greifen)
      KLASSIFIZIERER_PROMPT = fs.readFileSync(klassifiziererPromptPath, 'utf8');

      // Klassifikation: Vision (Sonnet) für Bilder, Haiku+Text für PDFs
      const VISION_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);
      const isImage = VISION_MIME.has(req.file.mimetype) || (/\.(jpe?g|png|gif|webp)$/i.test(req.file.originalname));
      let raw;

      if (isImage) {
        // Sonnet Vision: Bild direkt analysieren
        const imageBuffer = fs.readFileSync(req.file.path);
        const b64 = imageBuffer.toString('base64');
        const mediaMime = req.file.mimetype || 'image/jpeg';
        const mandanten = db.prepare('SELECT name FROM users WHERE kanzlei_id=?').all(kid).map(u => u.name).join(', ');
        const visionMsg = await apiWithRetry(() => anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          system: `Du klassifizierst Dokumente für eine deutsche Steuerkanzlei. Verwende exakt einen dieser Typen:

rechnung — Eingangs-/Ausgangsrechnung, Quittung, Kassenbon, Bewirtungsbeleg
kontoauszug — Kontoauszug, Kreditkartenabrechnung, PayPal/Stripe/Klarna-Beleg
steuerbescheid — Bescheid vom Finanzamt (Einkommensteuer, Körperschaftsteuer, Umsatzsteuer, Gewerbesteuer, Erbschaftsteuer), Vorauszahlungsbescheid, ELSTER-Bescheid
steuererklaerung — Steuererklärungsformular, ELSTER-Sendeprotokoll, Umsatzsteuervoranmeldung (vom Mandanten ausgefüllt)
lohnsteuerbescheinigung — Lohnsteuerbescheinigung vom Arbeitgeber
rentenbescheid — Rentenbescheid, Rentenanpassungsmitteilung, Renteninformation
mandant_dokument — Persönliche Dokumente und Nachweise die ein Mandant beim Steuerberater einreicht und die KEIN Beleg und KEIN Steuerbescheid sind. Dazu gehören IMMER:
  • Identität: Personalausweis, Reisepass, Führerschein
  • Meldung/Wohnsitz: Meldebescheinigung, Abmeldebescheinigung, Wohnsitznachweis
  • Familie/Kinder: Geburtsurkunde, Heiratsurkunde, Scheidungsurteil/-beschluss, Kitabescheinigung, Betreuungsnachweis, Schulbescheinigung, Immatrikulationsbescheinigung, Unterhaltsbescheid
  • Soziales/Gesundheit: Sozialversicherungsausweis, Behindertenausweis, Pflegebescheid, Schwerbehindertennachweis
  • Unternehmen: Gewerbeanmeldung/-abmeldung, Handelsregisterauszug, Gesellschaftervertrag, Satzung, Freistellungsbescheid (Verein)
  • Beschäftigung: Arbeitsvertrag, Kündigung, Aufhebungsvertrag, Arbeitgeberbescheinigung
  • Finanzen/Kapital: Depotauszug, Dividendenbescheid, Gewinnbeteiligung, Freistellungsauftrag, NV-Bescheinigung, Bankverbindungsnachweis
  • Sonstige Nachweise: Spendenbescheinigung, Spendenquittung, Handwerkerrechnung (als Nachweis), Vollmacht
sonstiges — Fotos ohne Dokumenteninhalt, Präsentationen, Screenshots, Werbung, alles Unidentifizierbare

Gib NUR gültiges JSON zurück, kein Text drumherum.`,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaMime, data: b64 } },
              { type: 'text', text: `Bekannte Mandanten: ${mandanten}\n\nJSON:\n{"typ":"<typ>","typ_label":"<lesbarer Name>","steuer_art":"einkommensteuer|koerperschaftsteuer|gewerbesteuer|umsatzsteuer_jahres|umsatzsteuer_voranmeldung|erbschaftsteuer|schenkungsteuer|sonstige|null","ist_aenderungsbescheid":false,"zeitraum_quartal":null,"mandant_name":"<exakter Name aus Liste oder null>","beleg_kategorie":"eingangsbeleg|ausgangsbeleg|sonstiger_beleg|kontoauszug|kreditkarte|online_zahlung|null","dok_slot":"<nur bei mandant_dokument: passender Slot-Name z.B. 'Personalausweis oder Reisepass', sonst null>","steuerjahr":null,"betrag":null,"frist_datum":null,"frist_typ":null,"prioritaet":"normal","zusammenfassung":"<1 Satz>","confidence":0.9,"bwa_kategorie":null,"zeitraum_monat":null,"zeitraum_jahr":null}` }
            ]
          }]
        }));
        raw = visionMsg.content[0].text.trim();
      } else {
        // Haiku + Text für PDFs
        let docText = `Dateiname: ${req.file.originalname}\n`;
        if (req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')) {
          try {
            const pdfBuffer = fs.readFileSync(req.file.path);
            const parsed = await pdfParse(pdfBuffer);
            docText += parsed.text.slice(0, 8000);
          } catch(e) { docText += '[PDF-Text nicht lesbar]'; }
        }
        const msg = await apiWithRetry(() => anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: KLASSIFIZIERER_PROMPT,
          messages: [{ role: 'user', content: docText }]
        }));
        raw = msg.content[0].text.trim();
      }
      const json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/```$/,'').trim());

      // typ_label normieren
      const belegKatLabel = {
        eingangsbeleg: 'Eingangsbeleg', ausgangsbeleg: 'Ausgangsbeleg',
        sonstiger_beleg: 'Sonstiger Beleg', kontoauszug: 'Kontoauszug',
        kreditkarte: 'Kreditkarte', online_zahlung: 'Online-Zahlungsdienst'
      };
      if (json.beleg_kategorie && belegKatLabel[json.beleg_kategorie]) {
        json.typ_label = belegKatLabel[json.beleg_kategorie];
      }
      if (json.typ === 'mandant_dokument') json.typ_label = 'Dokument';
      // typ_label bei Steuer-Docs präzise aus steuer_art ableiten
      const steuerLabelScanner = buildSteuerTypLabel(json.typ, json.steuer_art, json.ist_aenderungsbescheid);
      if (steuerLabelScanner) json.typ_label = steuerLabelScanner;
      const autoBereichScanner = { steuerbescheid:'Bescheide', vorauszahlungsbescheid:'Bescheide', steuererklaerung:'Steuererklärungen', lohnsteuerbescheinigung:'Steuererklärungen', rechnung:'Belege', kontoauszug:'Bankbelege', mandant_dokument:'Dokumente' }[json.typ] || null;

      db.prepare(`UPDATE dokument_inbox SET
        status='klassifiziert', typ=?, typ_label=?, mandant_name=?, steuernummer=?,
        steuerjahr=?, betrag=?, frist_datum=?, frist_typ=?, prioritaet=?,
        zusammenfassung=?, confidence=?, agent_output=?,
        bwa_kategorie=?, zeitraum_monat=?, zeitraum_jahr=?,
        steuer_art=?, ist_aenderungsbescheid=?, bereich=COALESCE(bereich,?)
        WHERE id=?`).run(
        json.typ, json.typ_label, json.mandant_name, json.steuernummer,
        json.steuerjahr, json.betrag, json.frist_datum, json.frist_typ, json.prioritaet,
        json.zusammenfassung, json.confidence, raw,
        json.bwa_kategorie || null, json.zeitraum_monat || null, json.zeitraum_jahr || null,
        json.steuer_art || null, json.ist_aenderungsbescheid ? 1 : 0, autoBereichScanner,
        docId
      );

      // ── Auto-Ablage: Mandanten-Dokumente (alle mit erkanntem Mandanten) ────────
      if (json.mandant_name) {
        const dupMandant = db.prepare('SELECT id FROM mandant_dokumente WHERE inbox_id=?').get(docId);
        if (!dupMandant) {
          db.prepare('INSERT INTO mandant_dokumente (inbox_id, mandant_name, typ, kanzlei_id) VALUES (?,?,?,?)')
            .run(docId, json.mandant_name, json.typ, kid);
        }
      }

      // ── Auto-Slot-Zuordnung: Mandanten-Dokumente (Ausweis, Meldebescheinigung etc.) ──
      if (json.typ === 'mandant_dokument' && json.mandant_name) {
        const slotUser = db.prepare('SELECT id FROM users WHERE name=? AND kanzlei_id=?').get(json.mandant_name, kid);
        if (slotUser) {
          const sub = db.prepare('SELECT id FROM submissions WHERE user_id=?').get(slotUser.id);
          if (sub) {
            const pendingSlots = db.prepare(
              "SELECT id, doc_name FROM documents WHERE submission_id=? AND status='pending' AND filename IS NULL AND doc_key != 'vollmacht'"
            ).all(sub.id);
            let matchedSlotId = null;

            // Erst Textabgleich mit dok_slot aus KI-Klassifikation
            if (json.dok_slot && pendingSlots.length > 0) {
              const needle = json.dok_slot.toLowerCase();
              const found = pendingSlots.find(s =>
                s.doc_name.toLowerCase().includes(needle) || needle.includes(s.doc_name.toLowerCase().split('(')[0].trim())
              );
              if (found) matchedSlotId = found.id;
            }

            // Fallback: KI-Slot-Matching (Bild)
            if (!matchedSlotId && pendingSlots.length > 0 && isImage) {
              try {
                const b64slot = fs.readFileSync(req.file.path).toString('base64');
                const mtSlot = req.file.mimetype === 'image/png' ? 'image/png' : req.file.mimetype === 'image/webp' ? 'image/webp' : 'image/jpeg';
                const slotList = pendingSlots.map((s, i) => `${i}: ${s.doc_name}`).join('\n');
                const slotMsg = await anthropic.messages.create({
                  model: 'claude-sonnet-4-6', max_tokens: 100,
                  messages: [{ role: 'user', content: [
                    { type: 'image', source: { type: 'base64', media_type: mtSlot, data: b64slot } },
                    { type: 'text', text: `Welchem der folgenden ausstehenden Dokumenten-Slots entspricht dieses Dokument?\n\n${slotList}\n\nAntworte NUR als JSON: {"slot_index": <Zahl oder -1>, "confidence": <0.0-1.0>}` }
                  ]}]
                });
                const mSlot = slotMsg.content[0].text.match(/\{[\s\S]*\}/);
                if (mSlot) {
                  const rSlot = JSON.parse(mSlot[0]);
                  if (rSlot.confidence >= 0.7 && rSlot.slot_index >= 0 && pendingSlots[rSlot.slot_index]) {
                    matchedSlotId = pendingSlots[rSlot.slot_index].id;
                  }
                }
              } catch(e) { console.error('[Scanner SlotMatch]', e.message); }
            }

            if (matchedSlotId) {
              const targetDir = path.join(DATA_DIR, 'uploads', String(slotUser.id));
              fs.mkdirSync(targetDir, { recursive: true });
              const targetFilename = 'scanner_' + Date.now() + path.extname(req.file.originalname);
              const targetPath = path.join(targetDir, targetFilename);
              fs.copyFileSync(req.file.path, targetPath);
              db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now'),scanner_inbox_id=? WHERE id=?`)
                .run(targetFilename, req.file.originalname, req.file.mimetype, req.file.size, docId, matchedSlotId);
              const matchedDoc = db.prepare('SELECT * FROM documents WHERE id=?').get(matchedSlotId);
              runAiCheck(matchedSlotId, targetPath, req.file.mimetype, matchedDoc.doc_name);
              console.log(`[Scanner] Dok-Slot gefüllt: "${matchedDoc.doc_name}" für ${json.mandant_name}`);
            }
          }
        }
      }

      // ── Auto-Upload an Agent (Belege + Bankbelege) ────────────────────────────
      if (json.mandant_name && (json.typ === 'rechnung' || json.typ === 'kontoauszug') && json.beleg_kategorie) {
        const autoUser = db.prepare('SELECT id FROM users WHERE name=? AND kanzlei_id=?').get(json.mandant_name, kid);
        if (autoUser) {
          try {
            const fileExt2 = req.file.originalname.split('.').pop().toLowerCase();
            const mimeMap2 = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', tiff: 'image/tiff', tif: 'image/tiff', heic: 'image/heic', heif: 'image/heif' };
            const fileMime2 = mimeMap2[fileExt2] || 'application/pdf';
            const fileBuffer2 = fs.readFileSync(req.file.path);
            const blob2 = new Blob([fileBuffer2], { type: fileMime2 });
            const fd2 = new FormData();
            fd2.append('datei', blob2, req.file.originalname);

            const kat = json.beleg_kategorie;
            const isKonto2 = ['kontoauszug', 'kreditkarte', 'online_zahlung'].includes(kat);

            if (isKonto2) {
              const kontoKat2 = kat === 'kreditkarte' ? 'kreditkarte' : kat === 'online_zahlung' ? 'online_zahlung' : 'kontoauszug';
              fd2.append('dokumenttyp', 'kontoauszug');
              fd2.append('kategorie', kontoKat2);
            } else {
              const agentTypMap = { eingangsbeleg: 'Eingangsrechnung', ausgangsbeleg: 'Ausgangsrechnung', sonstiger_beleg: 'Quittung' };
              fd2.append('dokumenttyp', 'beleg');
              fd2.append('belegtyp', agentTypMap[kat] || 'Eingangsrechnung');
            }

            fetch(`${AGENT_URL}/mandanten/${autoUser.id}/upload`, {
              method: 'POST', headers: { 'X-API-Key': AGENT_KEY }, body: fd2
            }).then(async r2 => {
              const body2 = await r2.json().catch(() => ({}));
              if (!r2.ok || !body2.ok) {
                console.error('[Klassifizierer] Agent-Upload Fehler:', r2.status, JSON.stringify(body2));
              } else {
                if (body2.id) db.prepare('UPDATE dokument_inbox SET agent_beleg_id=? WHERE id=?').run(body2.id, docId);
                console.log(`[Klassifizierer] Auto-Upload: ${req.file.originalname} → ${json.mandant_name} als ${kat}`);
              }
            }).catch(e => console.error('[Klassifizierer] Agent-Upload Netzwerkfehler:', e.message));
          } catch(e) { console.error('[Klassifizierer] Auto-Upload Fehler:', e.message); }
        }
      }

      // ── Auto-Ablage: BWA-Dokumente (wenn bwa_kategorie erkannt) ────────────────
      if (json.bwa_kategorie && json.mandant_name) {
        const dupBwa = db.prepare('SELECT id FROM bwa_dokumente WHERE inbox_id=?').get(docId);
        if (!dupBwa) {
          db.prepare('INSERT INTO bwa_dokumente (inbox_id, mandant_name, bwa_kategorie, zeitraum_monat, zeitraum_jahr, kanzlei_id) VALUES (?,?,?,?,?,?)')
            .run(docId, json.mandant_name, json.bwa_kategorie, json.zeitraum_monat || null, json.zeitraum_jahr || null, kid);
          console.log(`[Klassifizierer] BWA-Dok: ${req.file.originalname} → ${json.bwa_kategorie} für ${json.mandant_name}`);
        }
      }

      // ── Auto-Verknüpfung mit Bescheid-Datenbank ────────────────────────────
      // ── Auto-Routing: Steuerbescheid → bescheide ──────────────────────────────
      if (json.typ === 'steuerbescheid' && json.mandant_name) {
        const steuerArt = json.steuer_art || null;
        const istAenderung = json.ist_aenderungsbescheid === true;
        let bescheidEntry = null;

        if (steuerArt && json.steuerjahr) {
          const existing = db.prepare(`SELECT id FROM bescheide WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND tax_year=? AND bearbeitungsstand != 'abgeloest' ORDER BY erstellt_am DESC LIMIT 1`)
            .get(kid, json.mandant_name, steuerArt, json.steuerjahr);
          if (istAenderung && existing) {
            db.prepare(`UPDATE bescheide SET bearbeitungsstand='abgeloest' WHERE id=?`).run(existing.id);
            bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, vorgaenger_bescheid_id, erstellt_am) VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',1,?,CURRENT_TIMESTAMP) RETURNING id`)
              .get(kid, json.mandant_name, steuerArt, json.document_subtype || 'aenderungsbescheid', json.steuerjahr || null, req.file.originalname, req.file.path, existing.id);
            console.log(`[Klassifizierer] Änderungsbescheid #${bescheidEntry.id} — Vorgänger #${existing.id} abgelöst`);
          } else if (!existing) {
            bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, erstellt_am) VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',0,CURRENT_TIMESTAMP) RETURNING id`)
              .get(kid, json.mandant_name, steuerArt, json.document_subtype || 'unbekannt', json.steuerjahr || null, req.file.originalname, req.file.path);
            console.log(`[Klassifizierer] Neuer Bescheid #${bescheidEntry.id} (${steuerArt} ${json.steuerjahr}) für ${json.mandant_name}`);
          } else {
            bescheidEntry = existing;
          }
        } else {
          bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, erstellt_am) VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',0,CURRENT_TIMESTAMP) RETURNING id`)
            .get(kid, json.mandant_name, steuerArt, json.document_subtype || 'unbekannt', json.steuerjahr || null, req.file.originalname, req.file.path);
        }

        if (bescheidEntry) {
          const exists = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND dateipfad=?').get(bescheidEntry.id, req.file.path);
          if (!exists) {
            db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
              .run(bescheidEntry.id, kid, 'bescheid', req.file.originalname, req.file.path);
          }
          // Passende Erklärung: steuer_art + jahr + mandant (SQL, 0 Tokens)
          const hatErkl = db.prepare("SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung'").get(bescheidEntry.id);
          if (!hatErkl && steuerArt && json.steuerjahr) {
            const archivErkl = db.prepare(`SELECT * FROM mandant_steuererklaerungen WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND steuerjahr=? AND bescheid_id IS NULL ORDER BY upload_datum DESC LIMIT 1`)
              .get(kid, json.mandant_name, steuerArt, json.steuerjahr);
            if (archivErkl) {
              db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
                .run(bescheidEntry.id, kid, 'erklaerung', archivErkl.dateiname, archivErkl.dateipfad);
              db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(bescheidEntry.id, archivErkl.id);
              console.log(`[Klassifizierer] Erklärung auto-verknüpft → Bescheid #${bescheidEntry.id}`);
            }
          }
          runBescheidDeepAnalyse(bescheidEntry.id, kid)
            .then(d => { if (d.error) console.error(`[Auto-Analyse Scanner] Bescheid #${bescheidEntry.id} FEHLER: ${d.error}`); })
            .catch(e => console.error(`[Auto-Analyse Scanner] Bescheid #${bescheidEntry.id} CRASH:`, e.message));
        }
      }

      // ── Auto-Routing: Steuererklärung → mandant_steuererklaerungen ────────────
      if (json.typ === 'steuererklaerung' && json.mandant_name) {
        const steuerArt = json.steuer_art || null;
        let erklaerungId = null;
        const dupCheck = db.prepare('SELECT id FROM mandant_steuererklaerungen WHERE dateipfad=?').get(req.file.path);
        if (!dupCheck) {
          const ins = db.prepare('INSERT INTO mandant_steuererklaerungen (kanzlei_id, mandant_name, dateiname, dateipfad, steuerjahr, steuer_art, zeitraum_quartal, quelle) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
            .get(kid, json.mandant_name, req.file.originalname, req.file.path, json.steuerjahr || null, steuerArt, json.zeitraum_quartal || null, 'scanner');
          erklaerungId = ins.id;
          console.log(`[Klassifizierer] Steuererklärung #${erklaerungId} (${steuerArt} ${json.steuerjahr}) für ${json.mandant_name}`);
        } else {
          erklaerungId = dupCheck.id;
        }
        // Passenden Bescheid suchen (SQL, 0 Tokens)
        if (steuerArt && json.steuerjahr) {
          const matchB = db.prepare(`SELECT id FROM bescheide WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND tax_year=? AND bearbeitungsstand != 'abgeloest' ORDER BY erstellt_am DESC LIMIT 1`)
            .get(kid, json.mandant_name, steuerArt, json.steuerjahr);
          if (matchB) {
            const hasE = db.prepare("SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung'").get(matchB.id);
            if (!hasE) {
              db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
                .run(matchB.id, kid, 'erklaerung', req.file.originalname, req.file.path);
              db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(matchB.id, erklaerungId);
              console.log(`[Klassifizierer] Erklärung #${erklaerungId} → Bescheid #${matchB.id} auto-verknüpft`);
            }
          }
        }
        // Kein Bescheid gefunden → Erklärung wartet, kein Eintrag in bescheide
      }
    } catch(e) {
      console.error('[Inbox Klassifizierer]', e.message);
      db.prepare("UPDATE dokument_inbox SET status='fehler', typ='sonstiges' WHERE id=?").run(docId);
    }
  });
});

// GET echte Einträge für Mandant (Bescheide oder Rechnungen)
app.get('/api/inbox/mandant-records', kanzleiMiddleware, (req, res) => {
  const { mandant_name, bereich } = req.query;
  if (!mandant_name || !bereich) return res.json([]);
  const kid = req.kanzleiId || 1;
  if (bereich === 'bescheide') {
    const rows = db.prepare(`SELECT id, art, jahr, finanzamt FROM bescheide WHERE mandant_name=? AND kanzlei_id=? ORDER BY jahr DESC`).all(mandant_name, kid);
    return res.json(rows.map(r => ({ id: r.id, label: `${r.art || 'Bescheid'} ${r.jahr || ''}${r.finanzamt ? ' – ' + r.finanzamt : ''}`.trim() })));
  }
  if (bereich === 'rechnungen') {
    const rows = db.prepare(`SELECT id, beschreibung, betrag FROM rechnungen WHERE mandant_name=? AND kanzlei_id=? ORDER BY erstellt_am DESC`).all(mandant_name, kid);
    return res.json(rows.map(r => ({ id: r.id, label: `${r.beschreibung} (${r.betrag ? r.betrag.toFixed(2) + ' €' : '—'})` })));
  }
  res.json([]);
});

function resetScannerSlot(inboxId) {
  const slots = db.prepare("SELECT id, filename FROM documents WHERE scanner_inbox_id=?").all(inboxId);
  for (const slot of slots) {
    if (slot.filename) {
      // Kopierte Datei löschen falls vorhanden
      const slotDoc = db.prepare('SELECT s.user_id FROM documents d JOIN submissions s ON s.id=d.submission_id WHERE d.id=?').get(slot.id);
      if (slotDoc?.user_id) {
        const fp = path.join(DATA_DIR, 'uploads', String(slotDoc.user_id), slot.filename);
        try { fs.unlinkSync(fp); } catch(e) {}
      }
    }
    db.prepare("UPDATE documents SET filename=NULL,original_name=NULL,mimetype=NULL,filesize=NULL,status='pending',uploaded_at=NULL,scanner_inbox_id=NULL,updated_at=datetime('now') WHERE id=?").run(slot.id);
  }
}

// DELETE /api/inbox/eintrag/:id — nur aus Scanner-Liste entfernen, Dateien + Mandanten-Daten bleiben
app.delete('/api/inbox/eintrag/:id', kanzleiMiddleware, (req, res) => {
  const kid = req.kanzleiId || 1;
  const docId = req.params.id;
  const doc = db.prepare('SELECT id FROM dokument_inbox WHERE id=? AND kanzlei_id=?').get(docId, kid);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(docId);
  db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(docId);
  db.prepare('DELETE FROM dokument_inbox WHERE id=? AND kanzlei_id=?').run(docId, kid);
  res.json({ ok: true });
});

// POST manuelle Mandanten-Zuweisung + Verknüpfung
app.post('/api/inbox/zuordnen/:id', kanzleiMiddleware, async (req, res) => {
  const { mandant_name, bereich, linked_id, unterkategorie } = req.body;
  if (!mandant_name) return res.status(400).json({ error: 'mandant_name fehlt' });
  const kid = req.kanzleiId || 1;
  const docId = req.params.id;
  const doc = db.prepare('SELECT * FROM dokument_inbox WHERE id=? AND kanzlei_id=?').get(docId, kid);
  if (!doc) return res.status(404).json({ error: 'Dokument nicht gefunden' });

  // Dok-Slot zurücksetzen wenn von Dokumente weg verschoben wird
  if (bereich !== 'Dokumente') resetScannerSlot(docId);

  // Alten Beleg/Kontoauszug löschen wenn in nicht-Beleg-Bereich verschoben (auch wenn bereich vorher null war)
  const warBeleg = doc.bereich === 'Belege' || doc.bereich === 'Bankbelege' || (!doc.bereich && doc.agent_beleg_id);
  if (warBeleg && bereich !== 'Belege' && bereich !== 'Bankbelege' && doc.agent_beleg_id) {
    const altBeleg = db.prepare('SELECT * FROM agent_belege WHERE id=?').get(doc.agent_beleg_id);
    if (altBeleg) {
      db.prepare("UPDATE agent_kontoauszug_flags SET status='offen', matched_beleg_id=NULL WHERE matched_beleg_id=?").run(doc.agent_beleg_id);
      db.prepare('DELETE FROM agent_belege WHERE id=?').run(doc.agent_beleg_id);
      [altBeleg.datei_pfad, altBeleg.vorschau_pfad].forEach(p => { if (p) try { fs.unlinkSync(p); } catch(e) {} });
    } else {
      // Remote-Agent löschen
      fetch(`${AGENT_URL}/belege/${doc.agent_beleg_id}`, { method: 'DELETE', headers: { 'X-API-Key': AGENT_KEY } }).catch(() => {});
    }
    db.prepare('UPDATE dokument_inbox SET agent_beleg_id=NULL WHERE id=?').run(docId);
  }

  // BWA: in bwa_dokumente speichern — KI-klassifizierte bwa_kategorie verwenden
  if (bereich === 'BWA') {
    const bwaKat = doc.bwa_kategorie || 'betriebsausgaben';
    const dupBwa = db.prepare('SELECT id FROM bwa_dokumente WHERE inbox_id=?').get(docId);
    if (dupBwa) {
      db.prepare('UPDATE bwa_dokumente SET mandant_name=?, bwa_kategorie=? WHERE inbox_id=?').run(mandant_name, bwaKat, docId);
    } else {
      db.prepare('INSERT INTO bwa_dokumente (inbox_id, mandant_name, bwa_kategorie, kanzlei_id) VALUES (?,?,?,?)').run(docId, mandant_name, bwaKat, kid);
    }
    db.prepare('UPDATE dokument_inbox SET mandant_name=?, bereich=? WHERE id=? AND kanzlei_id=?')
      .run(mandant_name, bereich, docId, kid);
    return res.json({ ok: true });
  }

  // Steuererklärung: in mandant_steuererklaerungen speichern
  if (bereich === 'Steuererklärungen') {
    const steuerArtErkl = doc.steuer_art || null;
    const erklLabel = buildSteuerTypLabel('steuererklaerung', steuerArtErkl, false) || 'Steuererklärung';
    let erklId = null;
    const dupE = db.prepare('SELECT id FROM mandant_steuererklaerungen WHERE dateipfad=?').get(doc.dateipfad);
    if (!dupE) {
      const ins = db.prepare('INSERT INTO mandant_steuererklaerungen (kanzlei_id, mandant_name, dateiname, dateipfad, steuerjahr, steuer_art, zeitraum_quartal, quelle) VALUES (?,?,?,?,?,?,?,?) RETURNING id')
        .get(kid, mandant_name, doc.dateiname, doc.dateipfad, doc.steuerjahr || null, steuerArtErkl, doc.zeitraum_quartal || null, 'scanner');
      erklId = ins?.id;
    } else {
      db.prepare('UPDATE mandant_steuererklaerungen SET mandant_name=?, steuer_art=COALESCE(steuer_art,?) WHERE id=?').run(mandant_name, steuerArtErkl, dupE.id);
      erklId = dupE.id;
    }
    // Passenden Bescheid suchen (SQL, 0 Tokens): steuer_art + steuerjahr + mandant
    if (erklId && steuerArtErkl && doc.steuerjahr) {
      const matchB = db.prepare(`SELECT id FROM bescheide WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND tax_year=? AND bearbeitungsstand != 'abgeloest' ORDER BY erstellt_am DESC LIMIT 1`)
        .get(kid, mandant_name, steuerArtErkl, doc.steuerjahr);
      if (matchB) {
        const hasE = db.prepare("SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung'").get(matchB.id);
        if (!hasE) {
          db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
            .run(matchB.id, kid, 'erklaerung', doc.dateiname, doc.dateipfad);
          db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(matchB.id, erklId);
        }
      }
    }
    db.prepare(`UPDATE dokument_inbox SET mandant_name=?, bereich=?, steuer_art=?, typ='steuererklaerung', typ_label=? WHERE id=? AND kanzlei_id=?`)
      .run(mandant_name, bereich, steuerArtErkl, erklLabel, docId, kid);
    return res.json({ ok: true });
  }

  // Bescheid: in bescheide + bescheid_dokumente speichern
  if (bereich === 'Bescheide') {
    const ZUORDNEN_STEUER_ART = {
      'Einkommensteuerbescheid':         'einkommensteuer',
      'Körperschaftsteuerbescheid':      'koerperschaftsteuer',
      'Gewerbesteuerbescheid':           'gewerbesteuer',
      'Umsatzsteuerjahresbescheid':      'umsatzsteuer_jahres',
      'Umsatzsteuer-Voranmeldungsbescheid': 'umsatzsteuer_voranmeldung',
      'Erbschaftsteuerbescheid':         'erbschaftsteuer',
      'Schenkungsteuerbescheid':         'schenkungsteuer',
    };
    const steuerArt = ZUORDNEN_STEUER_ART[unterkategorie] || doc.steuer_art || null;
    const istAenderung = doc.ist_aenderungsbescheid ? 1 : 0;
    const docType = unterkategorie || doc.document_subtype || 'steuerbescheid';
    const typLabel = buildSteuerTypLabel('steuerbescheid', steuerArt, istAenderung) || unterkategorie || 'Steuerbescheid';

    let bescheidEntry = null;
    if (steuerArt && doc.steuerjahr) {
      bescheidEntry = db.prepare(`SELECT id FROM bescheide WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND tax_year=? AND bearbeitungsstand != 'abgeloest' ORDER BY erstellt_am DESC LIMIT 1`)
        .get(kid, mandant_name, steuerArt, doc.steuerjahr);
    }
    if (!bescheidEntry) {
      bescheidEntry = db.prepare(`INSERT INTO bescheide (kanzlei_id, mandant_name, steuer_art, document_type, tax_year, original_filename, storage_path, status, review_status, bearbeitungsstand, ist_aenderungsbescheid, erstellt_am)
        VALUES (?,?,?,?,?,?,?,'hochgeladen','offen','neu',?,CURRENT_TIMESTAMP) RETURNING id`)
        .get(kid, mandant_name, steuerArt, docType, doc.steuerjahr || null, doc.dateiname, doc.dateipfad, istAenderung);
    }
    if (bescheidEntry) {
      const existsBd = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND dateipfad=?').get(bescheidEntry.id, doc.dateipfad);
      if (!existsBd) {
        db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
          .run(bescheidEntry.id, kid, 'bescheid', doc.dateiname, doc.dateipfad);
      }
      // Passende Erklärung verknüpfen (SQL, 0 Tokens)
      const hatErkl = db.prepare("SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ='erklaerung'").get(bescheidEntry.id);
      if (!hatErkl && steuerArt && doc.steuerjahr) {
        const archivErkl = db.prepare(`SELECT * FROM mandant_steuererklaerungen WHERE kanzlei_id=? AND mandant_name=? AND steuer_art=? AND steuerjahr=? AND bescheid_id IS NULL ORDER BY upload_datum DESC LIMIT 1`)
          .get(kid, mandant_name, steuerArt, doc.steuerjahr);
        if (archivErkl) {
          db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
            .run(bescheidEntry.id, kid, 'erklaerung', archivErkl.dateiname, archivErkl.dateipfad);
          db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(bescheidEntry.id, archivErkl.id);
        }
      }
      runBescheidDeepAnalyse(bescheidEntry.id, kid).catch(e => console.error('[Zuordnen Bescheid] Analyse Fehler:', e.message));
    }
    db.prepare(`UPDATE dokument_inbox SET mandant_name=?, bereich=?, steuer_art=?, typ='steuerbescheid', typ_label=? WHERE id=? AND kanzlei_id=?`)
      .run(mandant_name, bereich, steuerArt, typLabel, docId, kid);
    return res.json({ ok: true });
  }

  // typ + typ_label aus neuem Bereich ableiten
  const katLabelMap = {
    'Eingangsbelege': 'Eingangsbeleg', 'Ausgangsbelege': 'Ausgangsbeleg', 'Sonstige Belege': 'Sonstiger Beleg',
    'Kontoauszüge': 'Kontoauszug', 'Kreditkarte': 'Kreditkarte', 'Online-Zahlungsdienste': 'Online-Zahlungsdienst'
  };
  const neuerTypLabel = bereich === 'Dokumente' ? 'Dokument' : (katLabelMap[unterkategorie] || null);
  const bereichTypMap = { 'Belege': 'rechnung', 'Bankbelege': 'kontoauszug', 'Dokumente': 'mandant_dokument' };
  const neuerTyp = bereichTypMap[bereich] || null;
  const typFields = (neuerTypLabel ? ', typ_label=?' : '') + (neuerTyp ? ', typ=?' : '');
  const typValues = [...(neuerTypLabel ? [neuerTypLabel] : []), ...(neuerTyp ? [neuerTyp] : [])];
  db.prepare(`UPDATE dokument_inbox SET mandant_name=?, bereich=?, linked_id=?, unterkategorie=?${typFields} WHERE id=? AND kanzlei_id=?`)
    .run(mandant_name, bereich || null, linked_id || null, unterkategorie || null, ...typValues, docId, kid);

  // Mandant_dokumente upsert — damit es im Mandanten-Profil erscheint
  const dup = db.prepare('SELECT id FROM mandant_dokumente WHERE inbox_id=?').get(docId);
  if (dup) {
    db.prepare('UPDATE mandant_dokumente SET mandant_name=?, typ=? WHERE inbox_id=?').run(mandant_name, doc.typ || null, docId);
  } else {
    db.prepare('INSERT INTO mandant_dokumente (inbox_id, mandant_name, typ, kanzlei_id) VALUES (?,?,?,?)').run(docId, mandant_name, doc.typ || null, kid);
  }

  // Typ aus Benutzerauswahl (bereich/unterkategorie) ableiten — hat Vorrang vor KI-Klassifikation
  const typLower = (doc.typ || '').toLowerCase();
  const kat = (unterkategorie || '').toLowerCase();
  const mimeMap = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', tiff: 'image/tiff', tif: 'image/tiff', heic: 'image/heic', heif: 'image/heif' };
  const fileExt = (doc.dateiname || doc.dateipfad || '').split('.').pop().toLowerCase();
  const fileMime = mimeMap[fileExt] || 'application/pdf';

  // Kontoauszug/Bankbeleg: nur wenn Benutzer explizit "Bankbelege" gewählt hat
  const isKonto = bereich === 'Bankbelege';
  const kontoKat = (kat.includes('kredit') || typLower.includes('kredit')) ? 'kreditkarte'
    : (kat.includes('online') || kat.includes('zahlung')) ? 'online_zahlung'
    : 'kontoauszug';

  // Beleg: nur wenn Benutzer explizit "Belege" gewählt hat
  const isBeleg = bereich === 'Belege';

  // Agent-Belegtyp: aus Unterkategorie (Benutzerauswahl) oder KI-Typ
  let agentBelegtyp;
  if (kat.includes('eingang')) agentBelegtyp = 'Eingangsrechnung';
  else if (kat.includes('ausgang')) agentBelegtyp = 'Ausgangsrechnung';
  else if (kat.includes('sonstige')) agentBelegtyp = 'Quittung';
  else if (typLower.includes('eingangsrechnung')) agentBelegtyp = 'Eingangsrechnung';
  else if (typLower.includes('ausgangsrechnung')) agentBelegtyp = 'Ausgangsrechnung';
  else if (typLower.includes('quittung')) agentBelegtyp = 'Quittung';
  else agentBelegtyp = 'Eingangsrechnung';

  if (isKonto && doc.dateipfad) {
    const user = db.prepare('SELECT u.id FROM users u WHERE u.name=? AND u.kanzlei_id=?').get(mandant_name, kid);
    if (user) {
      try {
        const fileBuffer = fs.readFileSync(doc.dateipfad);
        const blob = new Blob([fileBuffer], { type: fileMime });
        const fd = new FormData();
        fd.append('datei', blob, doc.dateiname || 'kontoauszug.pdf');
        fd.append('dokumenttyp', 'kontoauszug');
        fd.append('kategorie', kontoKat);
        const kuRes = db.prepare(`INSERT INTO kontoauszug_uploads (submission_id, category, filename, original_name, filesize, mimetype, analysis_status) VALUES (?,?,?,?,?,?,'pending')`)
          .run(
            db.prepare('SELECT id FROM submissions WHERE user_id=?').get(user.id)?.id,
            kontoKat,
            path.basename(doc.dateipfad),
            doc.dateiname,
            (() => { try { return fs.statSync(doc.dateipfad).size; } catch { return 0; } })(),
            fileMime
          );
        const uploadId = kuRes.lastInsertRowid;
        fetch(`${AGENT_URL}/mandanten/${user.id}/upload`, {
          method: 'POST', headers: { 'X-API-Key': AGENT_KEY }, body: fd
        }).then(async r => {
          const body = await r.json().catch(() => ({}));
          if (r.ok && body.ok) {
            db.prepare('DELETE FROM beleg_flags WHERE upload_id=?').run(uploadId);
            db.prepare('DELETE FROM kontoauszug_uploads WHERE id=?').run(uploadId);
            if (body.id) db.prepare('UPDATE dokument_inbox SET agent_beleg_id=? WHERE id=?').run(body.id, docId);
          } else {
            console.error('[Inbox Konto] Agent Fehler:', r.status, JSON.stringify(body));
            db.prepare("UPDATE kontoauszug_uploads SET analysis_status='error' WHERE id=?").run(uploadId);
          }
        }).catch(e => {
          console.error('[Inbox Konto] Netzwerkfehler:', e.message);
          db.prepare("UPDATE kontoauszug_uploads SET analysis_status='error' WHERE id=?").run(uploadId);
        });
      } catch(e) { console.error('[Inbox Konto] Fehler:', e.message); }
    }
  }

  if (isBeleg && doc.dateipfad) {
    const user = db.prepare('SELECT u.id FROM users u WHERE u.name=? AND u.kanzlei_id=?').get(mandant_name, kid);
    if (user) {
      try {
        const fileBuffer = fs.readFileSync(doc.dateipfad);
        const blob = new Blob([fileBuffer], { type: fileMime });
        const fd = new FormData();
        fd.append('datei', blob, doc.dateiname || 'beleg.pdf');
        fd.append('belegtyp', agentBelegtyp);
        fetch(`${AGENT_URL}/mandanten/${user.id}/upload`, {
          method: 'POST', headers: { 'X-API-Key': AGENT_KEY }, body: fd
        }).then(async r => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok || !body.ok) console.error('[Inbox Beleg] Agent Fehler:', r.status, JSON.stringify(body));
          else {
            console.log('[Inbox Beleg] Hochgeladen für', mandant_name, '→', body.belegtyp || body.typ, '(Typ:', agentBelegtyp, ')');
            if (body.id) db.prepare('UPDATE dokument_inbox SET agent_beleg_id=? WHERE id=?').run(body.id, docId);
          }
        }).catch(e => console.error('[Inbox Beleg] Netzwerkfehler:', e.message));
      } catch(e) { console.error('[Inbox Beleg] Fehler:', e.message); }
    }
  }

  // Slot-Zuordnung bei Bereich "Dokumente" — Text-Matching mit gespeichertem dok_slot (kein neuer KI-Aufruf)
  if (bereich === 'Dokumente' && doc.dateipfad) {
    const slotUser = db.prepare('SELECT id FROM users WHERE name=? AND kanzlei_id=?').get(mandant_name, kid);
    if (slotUser) {
      const sub = db.prepare('SELECT id FROM submissions WHERE user_id=?').get(slotUser.id);
      if (sub) {
        const pendingSlots = db.prepare(
          "SELECT id, doc_name FROM documents WHERE submission_id=? AND status='pending' AND (filename IS NULL OR filename='') AND doc_key != 'vollmacht'"
        ).all(sub.id);

        // Erst Text-Matching mit gespeichertem dok_slot (schnell, kein KI-Aufruf)
        let dokSlot = null;
        try { const out = JSON.parse(doc.agent_output || '{}'); dokSlot = out.dok_slot || null; } catch(e) {}

        let matchedSlotId = null;
        if (dokSlot && pendingSlots.length > 0) {
          const needle = dokSlot.toLowerCase();
          const found = pendingSlots.find(s =>
            s.doc_name.toLowerCase().includes(needle) ||
            needle.includes(s.doc_name.toLowerCase().split('(')[0].trim())
          );
          if (found) matchedSlotId = found.id;
        }

        // Fallback: KI-Slot-Matching (Vision für Bilder, Text für PDFs)
        if (!matchedSlotId && pendingSlots.length > 0) {
          try {
            const slotList = pendingSlots.map((s, i) => `${i}: ${s.doc_name}`).join('\n');
            const VISION_MIME3 = new Set(['image/jpeg','image/jpg','image/png','image/gif','image/webp']);
            const isImg3 = VISION_MIME3.has(fileMime) || (/\.(jpe?g|png|gif|webp)$/i.test(doc.dateiname || ''));
            if (isImg3) {
              const b64m = fs.readFileSync(doc.dateipfad).toString('base64');
              const mtm = fileMime === 'image/png' ? 'image/png' : fileMime === 'image/webp' ? 'image/webp' : 'image/jpeg';
              const slotMsg = await anthropic.messages.create({
                model: 'claude-sonnet-4-6', max_tokens: 100,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'base64', media_type: mtm, data: b64m } },
                  { type: 'text', text: `Welchem der folgenden ausstehenden Dokumenten-Slots entspricht dieses Dokument am besten?\n\n${slotList}\n\nAntworte NUR als JSON: {"slot_index":<Zahl oder -1>,"confidence":<0.0-1.0>}` }
                ]}]
              });
              const m = slotMsg.content[0].text.match(/\{[\s\S]*\}/);
              if (m) { const r2 = JSON.parse(m[0]); if (r2.confidence >= 0.7 && r2.slot_index >= 0 && pendingSlots[r2.slot_index]) matchedSlotId = pendingSlots[r2.slot_index].id; }
            } else {
              let docText = (doc.dateiname || '') + '\n';
              try { const p = await pdfParse(fs.readFileSync(doc.dateipfad)); docText += p.text.slice(0, 2000); } catch(e) {}
              const slotMsg = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001', max_tokens: 100,
                messages: [{ role: 'user', content: `Welchem Slot entspricht dieses Dokument?\n\n${slotList}\n\nInhalt:\n${docText}\n\nNUR JSON: {"slot_index":<Zahl oder -1>,"confidence":<0.0-1.0>}` }]
              });
              const m = slotMsg.content[0].text.match(/\{[\s\S]*\}/);
              if (m) { const r2 = JSON.parse(m[0]); if (r2.confidence >= 0.7 && r2.slot_index >= 0 && pendingSlots[r2.slot_index]) matchedSlotId = pendingSlots[r2.slot_index].id; }
            }
          } catch(e) { console.error('[Inbox Dok KI]', e.message); }
        }

        if (matchedSlotId) {
          const matchedDoc = db.prepare('SELECT doc_name FROM documents WHERE id=?').get(matchedSlotId);
          const targetDir = path.join(DATA_DIR, 'uploads', String(slotUser.id));
          fs.mkdirSync(targetDir, { recursive: true });
          const targetFilename = 'scanner_' + Date.now() + '.' + fileExt;
          const targetPath = path.join(targetDir, targetFilename);
          fs.copyFileSync(doc.dateipfad, targetPath);
          const filesize = (() => { try { return fs.statSync(doc.dateipfad).size; } catch { return 0; } })();
          db.prepare(`UPDATE documents SET filename=?,original_name=?,mimetype=?,filesize=?,status='uploaded',uploaded_at=datetime('now'),updated_at=datetime('now'),scanner_inbox_id=? WHERE id=?`)
            .run(targetFilename, doc.dateiname, fileMime, filesize, docId, matchedSlotId);
          // Orphan extra-Zeilen mit gleicher Ursprungsdatei löschen
          db.prepare("DELETE FROM documents WHERE submission_id=? AND doc_key LIKE 'extra_%' AND (original_name=? OR doc_name=?)")
            .run(sub.id, doc.dateiname, (doc.dateiname || '').replace(/\.[^.]+$/, ''));
          runAiCheck(matchedSlotId, targetPath, fileMime, matchedDoc.doc_name);
          console.log(`[Inbox Dok] Slot gefüllt: "${matchedDoc.doc_name}" für ${mandant_name}`);
        }
      }
    }
  }

  res.json({ ok: true });
});


// POST /api/inbox/:id/erklaerung-zuweisen — manuelle Bescheid-Auswahl aus Scanner (Multi-Bescheid-Fall)
app.post('/api/inbox/:id/erklaerung-zuweisen', kanzleiMiddleware, (req, res) => {
  const { bescheid_id } = req.body;
  const kid = req.kanzleiId || 1;
  const doc = db.prepare('SELECT * FROM dokument_inbox WHERE id=? AND kanzlei_id=?').get(req.params.id, kid);
  if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
  const bescheid = db.prepare('SELECT id FROM bescheide WHERE id=? AND kanzlei_id=?').get(bescheid_id, kid);
  if (!bescheid) return res.status(404).json({ error: 'Bescheid nicht gefunden' });
  // In bescheid_dokumente eintragen
  const exists = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND dateipfad=?').get(bescheid_id, doc.dateipfad);
  if (!exists) {
    db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
      .run(bescheid_id, kid, 'erklaerung', doc.dateiname, doc.dateipfad);
  }
  // Archiv-Eintrag updaten
  const erkl = db.prepare('SELECT id FROM mandant_steuererklaerungen WHERE dateipfad=? AND kanzlei_id=?').get(doc.dateipfad, kid);
  if (erkl) db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(bescheid_id, erkl.id);
  // Flag löschen
  db.prepare('UPDATE dokument_inbox SET erklaerung_auswahl_noetig=0, erklaerung_bescheid_optionen=NULL WHERE id=?').run(doc.id);
  res.json({ ok: true });
});

// ─── Mandanten Steuererklärungen ──────────────────────────────────────────────
const erklaerungStorage = multer.diskStorage({
  destination: (req, file, cb) => { const d = path.join(DATA_DIR, 'steuererklaerungen'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const erklaerungUpload = multer({ storage: erklaerungStorage, limits: { fileSize: 30 * 1024 * 1024 } });

app.get('/api/kanzlei/mandanten/:name/steuererklaerungen', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM mandant_steuererklaerungen WHERE kanzlei_id=? AND mandant_name=? ORDER BY steuerjahr DESC, upload_datum DESC')
    .all(req.kanzleiId, decodeURIComponent(req.params.name));
  res.json(rows);
});

app.post('/api/kanzlei/mandanten/:name/steuererklaerungen', kanzleiMiddleware, erklaerungUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  const mandant = decodeURIComponent(req.params.name);
  const { steuerjahr } = req.body;
  const row = db.prepare('INSERT INTO mandant_steuererklaerungen (kanzlei_id, mandant_name, dateiname, dateipfad, steuerjahr, quelle) VALUES (?,?,?,?,?,?) RETURNING *')
    .get(req.kanzleiId, mandant, req.file.originalname, req.file.path, steuerjahr ? parseInt(steuerjahr) : null, 'manuell');
  res.json(row);
});

app.get('/api/kanzlei/mandanten/:name/steuererklaerungen/:id/file', kanzleiMiddleware, (req, res) => {
  const doc = db.prepare('SELECT * FROM mandant_steuererklaerungen WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!doc || !fs.existsSync(doc.dateipfad)) return res.status(404).json({ error: 'Nicht gefunden' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.dateiname}"`);
  fs.createReadStream(doc.dateipfad).pipe(res);
});

app.delete('/api/kanzlei/mandanten/:name/steuererklaerungen/:id', kanzleiMiddleware, (req, res) => {
  const kid = req.kanzleiId || 1;
  const erkl = db.prepare('SELECT dateipfad FROM mandant_steuererklaerungen WHERE id=? AND kanzlei_id=?').get(req.params.id, kid);
  db.prepare('DELETE FROM mandant_steuererklaerungen WHERE id=? AND kanzlei_id=?').run(req.params.id, kid);
  if (erkl?.dateipfad) {
    const inboxEntry = db.prepare('SELECT id FROM dokument_inbox WHERE dateipfad=? AND kanzlei_id=?').get(erkl.dateipfad, kid);
    if (inboxEntry) {
      db.prepare('DELETE FROM bwa_dokumente WHERE inbox_id=?').run(inboxEntry.id);
      db.prepare('DELETE FROM mandant_dokumente WHERE inbox_id=?').run(inboxEntry.id);
      db.prepare('DELETE FROM dokument_inbox WHERE id=?').run(inboxEntry.id);
    }
  }
  res.json({ ok: true });
});

// POST /api/kanzlei/steuererklaerungen/:id/link-bescheid — Archivierte Erklärung mit Bescheid verknüpfen
app.post('/api/kanzlei/steuererklaerungen/:id/link-bescheid', kanzleiMiddleware, (req, res) => {
  const { bescheid_id } = req.body;
  if (!bescheid_id) return res.status(400).json({ error: 'bescheid_id fehlt' });
  const erkl = db.prepare('SELECT * FROM mandant_steuererklaerungen WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId);
  if (!erkl) return res.status(404).json({ error: 'Nicht gefunden' });
  const bescheid = db.prepare('SELECT id FROM bescheide WHERE id=? AND kanzlei_id=?').get(bescheid_id, req.kanzleiId);
  if (!bescheid) return res.status(404).json({ error: 'Bescheid nicht gefunden' });
  const exists = db.prepare('SELECT id FROM bescheid_dokumente WHERE bescheid_id=? AND typ=?').get(bescheid_id, 'erklaerung');
  if (!exists) {
    db.prepare('INSERT INTO bescheid_dokumente (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)')
      .run(bescheid_id, req.kanzleiId, 'erklaerung', erkl.dateiname, erkl.dateipfad);
  }
  db.prepare('UPDATE mandant_steuererklaerungen SET bescheid_id=? WHERE id=?').run(bescheid_id, erkl.id);
  res.json({ ok: true });
});

// ─── SALESPITCH DEMO RESET ────────────────────────────────────────────────────
// POST /api/demo/reset  — setzt Demo-Kanzlei auf frischen Ausgangszustand
// Benötigt gültige Kanzlei-Auth + Demo-Passwort im Body
app.post('/api/demo/reset', kanzleiMiddleware, (req, res) => {

  const kid = req.kanzleiId;
  const demoDate = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
  // Dynamische Uhrzeit relativ zu NOW (für Demo-Termine die immer in der Zukunft liegen)
  const _now = new Date();
  const hhmm = (d) => new Date(d).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false });
  const nowPlus = (mins) => hhmm(new Date(_now.getTime() + mins * 60000));

  // ── 1. Fristen: komplett löschen + volles Template neu anlegen ─────────────
  db.prepare('DELETE FROM fristen WHERE kanzlei_id=?').run(kid);
  const insFrist = db.prepare('INSERT INTO fristen (kanzlei_id, mandant_name, titel, typ, faellig_am, erledigt) VALUES (?,?,?,?,?,0)');
  [
    [kid, null,              'DATEV-Datensicherung April',                              'sonstige', demoDate(3) ],
    [kid, 'Dieter Richter',  'Einspruchsfrist – Dieter Richter (ESt 2023)',             'einspruch', demoDate(6) ],
    [kid, 'Felix Kramer',    'USt-Jahreserklärung 2023 – Felix Kramer',                'ust',       demoDate(14)],
    [kid, 'Jochen Krause',   'ESt-Vorauszahlung Q2 – Jochen Krause',                  'est',       demoDate(21)],
    [kid, 'Robert Hartmann', 'Jahresabschluss GmbH – Robert Hartmann (Entwurf)',       'sonstige',  demoDate(25)],
    [kid, 'Jochen Krause',   'Einkommensteuererklärung 2023 – Jochen Krause',          'est',       demoDate(28)],
    [kid, 'Thomas Richter',  'Lohnsteuer-Jahresausgleich 2023 – Thomas Richter',       'lst',       demoDate(35)],
    [kid, 'Julia Vogel',     'EÜR-Nachreichung 2023 – Julia Vogel',                   'est',       demoDate(40)],
    [kid, 'Julia Becker',    'ESt-Erklärung 2023 – Julia Becker',                     'est',       demoDate(42)],
    [kid, 'Maria Schwarz',   'USt-Voranmeldung Q1 – Maria Schwarz',                   'ust',       demoDate(44)],
    [kid, 'Hans-Peter Gruber','Bilanzerstellung 2023 – Hans-Peter Gruber',             'sonstige',  demoDate(46)],
    // KW 20 (Mitte Mai) – viele Fristen für roten Auslastungsbalken
    [kid, 'Alexander Bauer', 'Körperschaftsteuer-Jahreserklärung – Bauer GmbH',       'kst',       demoDate(49)],
    [kid, 'Felix Kramer',    'ESt-Erklärung 2023 – Felix Kramer (EÜR)',               'est',       demoDate(49)],
    [kid, 'Dr. Maximilian Huber','USt-Jahreserklärung 2023 – Dr. Huber',              'ust',       demoDate(50)],
    [kid, 'Anna Müller',     'Einkommensteuererklärung 2023 – Anna Müller',           'est',       demoDate(51)],
    [kid, 'Michael Weber',   'Gewerbesteuererklärung 2023 – Michael Weber',            'gest',      demoDate(51)],
    [kid, 'Klaus Fischer',   'ESt-Jahreserklärung 2023 – Klaus Fischer',              'est',       demoDate(52)],
    [kid, 'Werner Krüger',   'Körperschaftsteuer 2023 – Werner Krüger',               'kst',       demoDate(52)],
    [kid, 'Nadine Hoffmann', 'USt-Voranmeldung April 2026 – Nadine Hoffmann',         'ust',       demoDate(53)],
    [kid, 'Laura Braun',     'ESt-Vorauszahlung Q2 – Laura Braun',                   'est',       demoDate(53)],
    [kid, 'TechWave GmbH',   'Q1-Jahresabschluss TechWave GmbH',                     'sonstige',  demoDate(54)],
    // Nach KW 20
    [kid, 'Alexander Bauer', 'GmbH-Jahresabschluss anfordern – Bauer Gruppe',         'sonstige',  demoDate(60)],
    [kid, 'Robert Hartmann', 'Gewerbesteuererklärung 2023 – Robert Hartmann',          'gest',      demoDate(67)],
    [kid, 'Patrick Fuchs',   'ESt-Erklärung 2023 – Patrick Fuchs',                   'est',       demoDate(70)],
    [kid, 'Benjamin Kohl',   'ESt-Jahreserklärung 2023 – Benjamin Kohl',              'est',       demoDate(84)],
    [kid, 'Petra Schwarz',   'Erbschaftssteuer-Erklärung – Petra Schwarz',            'est',       demoDate(98)],
  ].forEach(row => insFrist.run(...row));

  // ── 2. Kalender: komplett löschen + vollständiges Template neu anlegen ──────
  db.prepare('DELETE FROM kalender_termine WHERE kanzlei_id=?').run(kid);
  const insKal = db.prepare(`
    INSERT INTO kalender_termine
      (kanzlei_id, titel, mandant_name, datum, uhrzeit, uhrzeit_ende, typ, notiz, ort, sichtbarkeit)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  [
    // Vergangenheit
    [-28,'Besprechung Erika Lange – Unterlagen 2023','Erika Lange','10:00','11:00','Vollständig übergeben, bereit für ESt-Erklärung','H&K Büro'],
    [-22,'Quartalgespräch Julia Vogel – EÜR Q4','Julia Vogel','11:00','12:00','EÜR Q4 besprochen, Nachreichung bis März','Telefontermin'],
    [-18,'Interne Teambesprechung – Jahresplanung',null,'09:00','10:30','Kapazitätsplanung Q2 2026, Mandantenstamm','Besprechungsraum H&K'],
    [-14,'Besprechung Jochen Krause – Unterlagen ESt','Jochen Krause','09:30','10:30','Belege 2023 übergeben, Fahrtenbuch fehlt','H&K Büro'],
    [-12,'Felix Kramer – USt-Voranmeldung Q4','Felix Kramer','14:30','15:30','Q4 Voranmeldung geprüft, Vorsteuerbelege vollständig','Zoom'],
    [-10,'Steuerberaterfortbildung DATEV Online',null,'09:00','17:00','Pflichtfortbildung: KI in der Steuerkanzlei','Online (DATEV Campus)'],
    [-8,'Betriebsprüfung Vorbereitung – Petra Schwarz','Petra Schwarz','10:00','11:30','BP-Ankündigung FA Freiburg. Unterlagen geordnet','H&K Büro'],
    [-6,'Robert Hartmann – Fahrtenbuch Übergabe','Robert Hartmann','11:30','12:00','Fahrtenbuch 2023 entgegengenommen, wird geprüft','Empfang H&K'],
    [-4,'Laura Braun – Existenzgründerberatung Vorgespräch','Laura Braun','13:00','14:00','GbR-Gründung besprochen, Rechtsformvergleich','H&K Büro'],
    [-2,'Jahresgespräch Klaus Fischer – Abschluss 2023','Klaus Fischer','14:00','15:30','ESt-Abschluss 2023 abgenommen, Erstattung 3.240 EUR','H&K Büro'],
    [-1,'Stefan Zimmermann – Doppelte Haushaltsführung','Stefan Zimmermann','10:00','11:00','Belege doppelte HF – Mietvertrag Zweitwohnung fehlt','Telefontermin'],
    // Heute + nächste Wochen
    [0,'Jahresgespräch Alexander Bauer','Alexander Bauer',nowPlus(15),nowPlus(75),'GmbH-Strategie 2026, Tantieme, KSt-Bescheid Einspruch','H&K Büro'],
    [0,'Beratung Dr. Maximilian Huber – IAB + Bescheid','Dr. Maximilian Huber',nowPlus(120),nowPlus(180),'Investitionsabzugsbetrag Röntgenanlage + ESt-Bescheid','H&K Büro'],
    [1,'Beratung Jochen Krause','Jochen Krause','10:00','11:00','ESt-Erklärung 2023 finalisieren, Vorauszahlungen Q2','H&K Büro'],
    [2,'EÜR-Besprechung Julia Vogel – Abschluss 2023','Julia Vogel','11:00','12:00','EÜR 2023 finalisiert, alle Nachreichungen vollständig','H&K Büro'],
    [5,'Betriebsprüfung Vorbereitung Karl-Heinz Winkler','Karl-Heinz Winkler','11:00','12:30','BP-Unterlagen final, Strategie festlegen','H&K Büro'],
    [7,'Besprechung Julia Becker – GdB-Pauschbetrag','Julia Becker','09:00','10:00','Erbschaftssteuer + Behinderungspauschbetrag','Telefontermin'],
    [10,'Nicole Fischer – Holding-Struktur','Nicole Fischer','15:00','16:30','Holdingoptimierung, Managementgebühren, Verrechnungspreise','H&K Büro'],
    [12,'USt-Fristenkontrolle Robert Hartmann','Robert Hartmann','16:00','16:30','USt-Voranmeldung Dez 2023 freigeben','intern'],
    [14,'Robert Hartmann – Jahresabschluss 2023','Robert Hartmann','10:00','11:30','Jahresabschluss final, Offenlegungspflicht, Fahrtenbuch','H&K Büro'],
    [17,'Laura Braun – Existenzgründung Finalberatung','Laura Braun','11:00','12:30','Gesellschaftsvertrag UG, Gründung abschließen','H&K Büro'],
    [21,'Steuerberaterfortbildung – Digitale Kanzlei',null,'09:00','17:00','StBK Pflichtfortbildung: Digitalisierung + KI 2026','Hotel Colombi Freiburg'],
    [24,'Sophie Bauer – GmbH-Gründungsberatung','Sophie Bauer','10:00','11:30','GmbH-Gründung, Stammkapital 25.000 EUR, Satzung','H&K Büro'],
    [28,'Benjamin Kohl – Steuererklärung 2023','Benjamin Kohl','09:30','10:30','ESt-Erklärung 2023, Kapitalerträge + Vermietung','H&K Büro'],
    [33,'Jochen Krause – ESt-Abgabe Besprechung','Jochen Krause','11:00','12:00','ESt-Erklärung 2023 unterschreiben und einreichen','H&K Büro'],
    [35,'TechWave GmbH – Q2-Jahresabschluss Kickoff','TechWave GmbH','13:00','14:30','Q2 Start, BWA April, Investitionsplan KI','TechWave Office'],
    [40,'Dr. Huber – Lohnbuchhaltung ab Juli','Dr. Maximilian Huber','14:00','15:00','Übernahme Lohnbuchhaltung Praxis ab 01.07.2026','Telefontermin'],
  ].forEach(([off, titel, mandant, h, he, notiz, ort]) => {
    insKal.run(kid, titel, mandant||null, demoDate(off), h, he, 'termin', notiz, ort, 'alle');
  });

  // ── 3. Aufgaben: Datums-Shift ─────────────────────────────────────────────
  const firstAuf = db.prepare("SELECT MIN(faellig_am) AS d FROM aufgaben WHERE kanzlei_id=? AND faellig_am IS NOT NULL AND status!='erledigt'").get(kid);
  if (firstAuf && firstAuf.d) {
    const diff = Math.round((new Date() - new Date(firstAuf.d)) / 86400000);
    const shift = diff + 3;
    if (shift !== 0) {
      db.prepare(`UPDATE aufgaben SET faellig_am = date(faellig_am, '${shift > 0 ? '+' : ''}${shift} days') WHERE kanzlei_id=? AND faellig_am IS NOT NULL`).run(kid);
    }
  }

  // ── 4. Scanner: Dokument-Inbox zurücksetzen ───────────────────────────────
  // mandant_dokumente hat broken FK -> REFERENCES inbox(id) statt dokument_inbox(id)
  // Tabelle droppen + korrekt neu erstellen, dann erst dokument_inbox leeren
  // bwa_dokumente hat ebenfalls REFERENCES inbox(id) → droppen + neu anlegen
  db.exec('DROP TABLE IF EXISTS bwa_dokumente');
  db.exec(`CREATE TABLE bwa_dokumente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbox_id INTEGER NOT NULL,
    mandant_name TEXT NOT NULL,
    bwa_kategorie TEXT NOT NULL,
    zeitraum_monat INTEGER,
    zeitraum_jahr INTEGER,
    kanzlei_id INTEGER DEFAULT 1,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inbox_id) REFERENCES dokument_inbox(id)
  )`);
  db.prepare('DELETE FROM bwa_analysen WHERE kanzlei_id=?').run(kid);
  db.exec('DROP TABLE IF EXISTS mandant_dokumente');
  db.exec(`CREATE TABLE mandant_dokumente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbox_id INTEGER NOT NULL,
    mandant_name TEXT NOT NULL,
    typ TEXT,
    kanzlei_id INTEGER DEFAULT 1,
    erstellt_am DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inbox_id) REFERENCES dokument_inbox(id)
  )`);
  db.prepare('DELETE FROM dokument_inbox WHERE kanzlei_id=?').run(kid);
  const insInbox2 = db.prepare(`INSERT INTO dokument_inbox
    (kanzlei_id,dateiname,dateipfad,status,typ,typ_label,mandant_name,steuernummer,steuerjahr,
     betrag,bwa_kategorie,zeitraum_monat,zeitraum_jahr,zusammenfassung,confidence,upload_datum,frist_datum)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insMandDoc2 = db.prepare('INSERT INTO mandant_dokumente (inbox_id,mandant_name,typ,kanzlei_id) VALUES (?,?,?,?)');
  // Spalten: [0]mandant [1]dateiname [2]pfad [3]typ [4]typ_label [5]steuernr [6]jahr [7]betrag [8]bwa_kat [9]monat [10]jahr2 [11]zusammenfassung [12]upload [13]frist_datum
  const scannerTemplate = [
    ['Felix Kramer','Einnahmen-EÜR_alle_Plattformen_2024.pdf','/opt/hk-app/uploads/22/Einnahmen-EUeR_alle_Plattformen_2024.pdf','steuererklaerung','EÜR-Anlage','014/842/09371',2024,'74.949,21','sonstige',null,2024,'EÜR 2024. Gewinn: 74.949,21 EUR.','2025-01-15 10:22:00',null],
    ['Felix Kramer','AdSensePlattform-Abrechnungen_2024.pdf','/opt/hk-app/uploads/22/AdSensePlattform-Abrechnungen_2024.pdf','rechnung_eingang','Eingangsrechnung','014/842/09371',2024,'58.421,30','umsatzerloese',12,2024,'Google AdSense Jahresabrechnung 2024.','2025-01-15 10:24:00',null],
    ['Felix Kramer','Betriebsausgaben-Belege_2024.pdf','/opt/hk-app/uploads/22/Betriebsausgaben-Belege_2024.pdf','rechnung_eingang','Betriebsausgaben','014/842/09371',2024,'7.472,09','betriebsausgaben',12,2024,'Betriebsausgabenbelege 2024. Summe: 7.472,09 EUR.','2025-01-15 10:26:00',null],
    ['Felix Kramer','USt-Voranmeldungen_2024.pdf','/opt/hk-app/uploads/22/USt-Voranmeldungen_2024.pdf','steuererklaerung','USt-Voranmeldung','014/842/09371',2024,'8.487,60','umsatzsteuer',12,2024,'USt-Voranmeldungen Q1-Q4 2024. Abgabefrist überschneidet sich mit Q1 2025.','2025-01-20 09:10:00',demoDate(14)],
    ['Felix Kramer','Kontoauszug_Geschäftskonto_2024.pdf','/opt/hk-app/konto_uploads/kramer_kontoauszug_2024.pdf','kontoauszug','Kontoauszug','014/842/09371',2024,'14.837,50','kontoauszug',12,2024,'Jahreskontoauszug 2024. Schlusssaldo: 14.837,50 EUR.','2025-01-22 11:00:00',null],
    ['Felix Kramer','Kreditkartenabrechnung_Visa_2024.pdf','/opt/hk-app/konto_uploads/kramer_kreditkarte_2024.pdf','kontoauszug','Kreditkartenabrechnung','014/842/09371',2024,'6.234,87','kontoauszug',12,2024,'Visa Business Kreditkarte 2024.','2025-01-22 11:05:00',null],
    ['Felix Kramer','Ausgangsrechnungen_2024.pdf','/opt/hk-app/konto_uploads/kramer_ausgangsrechnungen_2024.pdf','rechnung_ausgang','Ausgangsrechnungsliste','014/842/09371',2024,'24.000,00','umsatzerloese',12,2024,'9 Ausgangsrechnungen 2024.','2025-01-22 11:08:00',null],
    ['Dr. Maximilian Huber','Einnahmen-Überschuss-Rechnung_Praxis_2024.pdf','/opt/hk-app/uploads/40/Einnahmen-Ueberschuss-Rechnung_Praxis_2024.pdf','steuererklaerung','EÜR Praxis','143/221/80142',2024,'35.420,00','sonstige',null,2024,'EÜR Praxis Huber 2024. Gewinn: 35.420,00 EUR.','2025-01-18 14:00:00',null],
    ['Dr. Maximilian Huber','Kontoauszüge_Praxiskonto_2024.pdf','/opt/hk-app/uploads/40/Kontoauszuege_Praxiskonto_2024.pdf','kontoauszug','Kontoauszug Praxiskonto','143/221/80142',2024,'41.210,00','kontoauszug',12,2024,'Praxiskonto HVB 2024. Saldo: 41.210,00 EUR.','2025-01-18 14:05:00',null],
    ['Dr. Maximilian Huber','PKV_Jahresbescheinigung_Familie_2024.pdf','/opt/hk-app/uploads/40/PKV_Jahresbescheinigung_Familie_2024.pdf','steuererklaerung','PKV-Bescheinigung','143/221/80142',2024,'18.840,00','vorsorge',12,2024,'PKV-Jahresbescheinigung SIGNAL IDUNA 2024. Für Sonderausgabenabzug ESt-Erklärung erforderlich.','2025-01-19 09:30:00',demoDate(21)],
    ['Dr. Maximilian Huber','Betriebsausgaben-Belege_2024.pdf','/opt/hk-app/uploads/40/Betriebsausgaben-Belege_2024.pdf','rechnung_eingang','Betriebsausgaben','143/221/80142',2024,'62.400,00','betriebsausgaben',12,2024,'Praxisbetriebsausgaben 2024.','2025-01-19 09:35:00',null],
    ['Dr. Maximilian Huber','Lohnsteuerbescheinigung_Ehefrau_2024.pdf','/opt/hk-app/uploads/40/Lohnsteuerbescheinigung_Ehefrau_2024.pdf','steuererklaerung','Lohnsteuerbescheinigung','143/221/80142',2024,'42.800,00','sonstige',null,2024,'Lohnsteuerbescheinigung Ingrid Huber 2024.','2025-01-20 10:00:00',null],
    ['Dr. Maximilian Huber','Kontoauszug_Praxiskonto_2024.pdf','/opt/hk-app/konto_uploads/huber_kontoauszug_2024.pdf','kontoauszug','Kontoauszug','143/221/80142',2024,'41.210,00','kontoauszug',12,2024,'HVB Praxiskonto Jahresauszug 2024.','2025-01-22 12:00:00',null],
    ['Dr. Maximilian Huber','Kreditkartenabrechnung_Mastercard_2024.pdf','/opt/hk-app/konto_uploads/huber_kreditkarte_2024.pdf','kontoauszug','Kreditkartenabrechnung','143/221/80142',2024,'12.840,20','kontoauszug',12,2024,'Mastercard Platinum 2024.','2025-01-22 12:05:00',null],
    ['Alexander Bauer','Lohnsteuerbescheinigung_GF_2024.pdf','/opt/hk-app/uploads/49/Lohnsteuerbescheinigung_GF_2024.pdf','steuererklaerung','Lohnsteuerbescheinigung','06672834002',2024,'96.000,00','sonstige',null,2024,'Lohnsteuerbescheinigung GF Bauer 2024.','2025-01-16 09:00:00',null],
    ['Alexander Bauer','Tantieme-Nachweis_2024.pdf','/opt/hk-app/uploads/49/Tantieme-Nachweis_2024.pdf','rechnung_eingang','Tantieme-Nachweis','06672834002',2024,'45.000,00','umsatzerloese',12,2024,'Tantieme Bauer Immobilien GmbH 2024.','2025-01-16 09:05:00',null],
    ['Alexander Bauer','PKV_Jahresbescheinigung_2024.pdf','/opt/hk-app/uploads/49/PKV_Jahresbescheinigung_2024.pdf','steuererklaerung','PKV-Bescheinigung','06672834002',2024,'11.280,00','vorsorge',12,2024,'PKV-Jahresbescheinigung Debeka 2024.','2025-01-16 09:10:00',null],
    ['Alexander Bauer','Jahressteuerbescheinigung_Depot_2024.pdf','/opt/hk-app/uploads/49/Jahressteuerbescheinigung_Depot_2024.pdf','steuererklaerung','Depot-Bescheinigung','06672834002',2024,'8.420,00','kapitalertraege',12,2024,'Depot-Jahresbescheinigung 2024. Kapitalertragsteuer bereits einbehalten — Günstigerprüfung prüfen.','2025-01-17 11:00:00',demoDate(6)],
    ['Alexander Bauer','Kontoauszug_Geschäftskonto_2024.pdf','/opt/hk-app/konto_uploads/bauer_kontoauszug_2024.pdf','kontoauszug','Kontoauszug','06672834002',2024,'127.840,00','kontoauszug',12,2024,'Sparkasse Freiburg Geschäftskonto 2024.','2025-01-23 10:00:00',null],
    ['Alexander Bauer','Kreditkartenabrechnung_Visa_Infinite_2024.pdf','/opt/hk-app/konto_uploads/bauer_kreditkarte_2024.pdf','kontoauszug','Kreditkartenabrechnung','06672834002',2024,'18.430,60','kontoauszug',12,2024,'Visa Infinite Corporate 2024.','2025-01-23 10:05:00',null],
  ];
  const bwaKats = new Set(['umsatzerloese', 'betriebsausgaben', 'personalkosten', 'interne_verrechnung']);
  const insBwaDok2 = db.prepare('INSERT INTO bwa_dokumente (inbox_id, mandant_name, bwa_kategorie, zeitraum_monat, zeitraum_jahr, kanzlei_id) VALUES (?,?,?,?,?,?)');
  for (const d of scannerTemplate) {
    const r = insInbox2.run(kid,d[1],d[2],'fertig',d[3],d[4],d[0],d[5],d[6],d[7],d[8],d[9],d[10],d[11],0.97,d[12],d[13]||null);
    insMandDoc2.run(r.lastInsertRowid, d[0], d[3], kid);
    if (bwaKats.has(d[8])) insBwaDok2.run(r.lastInsertRowid, d[0], d[8], d[9], d[10], kid);
  }

  // ── 5. Chat zurücksetzen ──────────────────────────────────────────────────
  db.prepare('DELETE FROM chat_messages WHERE kanzlei_id=?').run(kid);
  const staffMap = {};
  db.prepare('SELECT id, name FROM kanzlei_staff WHERE kanzlei_id=?').all(kid).forEach(s => { staffMap[s.name] = s.id; });
  const sid = (name) => staffMap[name] || null;

  const chatNachrichten = [
    { name: 'Lina Kraus',        msg: 'Unterlagen von Erika Lange sind komplett reingekommen 🎉' },
    { name: 'Marc Lichtwald',    msg: 'super, dann kann ich die EÜR von Huber heute noch finalisieren' },
    { name: 'Sven Konstantinow', msg: 'Einspruch Richter ist unterwegs, die Frist lief heute fast ab' },
    { name: 'Melina Seber',      msg: 'hab Petra Schwarz nochmal erinnert, fehlt noch die PKV Bescheinigung' },
    { name: 'Louis Honal',       msg: 'Q2 Beratungsgespräch mit TechWave ist heute um 08:30 in Raum 2' },
    { name: 'Marc Lichtwald',    msg: '@Louis hab die BWA Bauer Gruppe vorbereitet fürs Meeting' },
    { name: 'Lina Kraus',        msg: 'Felix Kramer hat alle 4 Dokumente hochgeladen, kann jetzt bearbeitet werden' },
    { name: 'Sven Konstantinow', msg: '@Marc kannst du heute noch die USt Voranmeldung Kramer prüfen?' },
    { name: 'Marc Lichtwald',    msg: 'ja mach ich nach dem Mittagessen' },
    { name: 'Melina Seber',      msg: 'Julia Vogel fragt nach Status ihrer EÜR. Termin übermorgen mit ihr' },
    { name: 'Lina Kraus',        msg: '@Melina ich schreib ihr kurz, wir sind dran' },
    { name: 'Louis Honal',       msg: 'bitte die DATEV Datensicherung April nicht vergessen, läuft in 3 Tagen ab!' },
    { name: 'Marc Lichtwald',    msg: 'erledigt, hab gestern schon getriggert ✓' },
    { name: 'Sven Konstantinow', msg: 'Jahresabschluss Hartmann läuft gut, noch Fahrtenbuch ausstehend' },
    { name: 'Melina Seber',      msg: 'Stefan Zimmermann hat die Belege doppelte Haushaltsführung noch nicht geschickt' },
    { name: 'Lina Kraus',        msg: 'ich ruf ihn heute Nachmittag an' },
    { name: 'Marc Lichtwald',    msg: 'Rechnungen März sind alle raus 💪' },
    { name: 'Louis Honal',       msg: 'perfekt. morgen Besprechung Dr. Huber wegen Lohnbuchhaltung ab Juli' },
  ];

  const insChat = db.prepare('INSERT INTO chat_messages (kanzlei_id, user_name, staff_id, message, created_at) VALUES (?,?,?,?,?)');
  const baseTime = Date.now() - chatNachrichten.length * 4 * 60 * 1000;
  chatNachrichten.forEach((m, i) => {
    const ts = new Date(baseTime + i * 4 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    insChat.run(kid, m.name, sid(m.name), m.msg, ts);
  });

  // ── 5. Dokumente: Baseline zurücksetzen ───────────────────────────────────
  const docPlan = {
    'Alexander Bauer':      {all:true},
    'Andreas Schäfer':      {i:[0,1]},
    'Anna Müller':          {all:true},
    'Benjamin Kohl':        {all:true},
    'Christian Schneider':  {i:[0,2]},
    'Christina Müller':     {all:true},
    'David Schreiber':      {i:[0,1]},
    'Dieter Richter':       {i:[0,2]},
    'Dr. Maximilian Huber': {i:[0,1,3]},
    'Erika Lange':          {all:true},
    'Felix Kramer':         {all:true},
    'Franziska Wolf':       {i:[0,2]},
    'Günter Baumann':       {i:[0,2]},
    'Hans-Peter Gruber':    {i:[0,1,3]},
    'Heinz Schulz':         {i:[0,2]},
    'Ingrid Meyer':         {all:true},
    'Jochen Krause':        {i:[0,2]},
    'Julia Becker':         {i:[0,2]},
    'Julia Vogel':          {i:[0,1,3]},
    'Katharina Braun':      {i:[0,3]},
    'Klaus Fischer':        {all:true},
    'Laura Braun':          {i:[0,1,2]},
    'Lisa Bergmann':        {i:[0,3]},
    'Maria Schwarz':        {i:[0,1,3]},
    'Markus Wagner':        {i:[0,2]},
    'Mia Zimmermann':       {all:true},
    'Michael Weber':        {i:[0,2]},
    'Mohammed Al-Hassan':   {i:[0,2]},
    'Nadine Hoffmann':      {all:true},
    'Nicole Fischer':       {i:[0,2]},
    'Patrick Fuchs':        {i:[0,1,3]},
    'Petra Hoffmann':       {i:[0,2]},
    'Petra Schwarz':        {all:true},
    'Renate Hoffmann':      {i:[0,2]},
    'Robert Hartmann':      {i:[0,1,2,4]},
    'Sabine Koch':          {all:true},
    'Sophie Bauer':         {all:true},
    'Stefan Zimmermann':    {i:[0,2]},
    'Thomas Richter':       {i:[0,1,3]},
    'Werner Krüger':        {all:true},
  };

  function makeDocFilename(docName) {
    return docName
      .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
      .replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue').replace(/ß/g,'ss')
      .replace(/[()\/\\.,]/g,'').replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_-]/g,'')
      .substring(0,40) + '_2024.pdf';
  }

  const allSubs = db.prepare('SELECT s.id AS subId, u.name AS mName FROM submissions s JOIN users u ON s.user_id=u.id WHERE s.kanzlei_id=?').all(kid);
  const subMap = {};
  allSubs.forEach(s => { subMap[s.mName] = s.subId; });

  if (allSubs.length > 0) {
    const ids = allSubs.map(s => s.subId);
    db.prepare(`UPDATE documents SET status='pending',filename=NULL,original_name=NULL,uploaded_at=NULL,mimetype=NULL,filesize=NULL WHERE submission_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }

  const demoUploadDate = new Date(Date.now() - 7*86400000).toISOString().slice(0,19).replace('T',' ');
  const setDocStmt = db.prepare("UPDATE documents SET status='accepted',filename=?,original_name=?,uploaded_at=?,mimetype='application/pdf',filesize=350000 WHERE id=?");

  for (const [mName, cfg] of Object.entries(docPlan)) {
    const subId = subMap[mName];
    if (!subId) continue;
    const docs = db.prepare('SELECT id, doc_name FROM documents WHERE submission_id=? ORDER BY id').all(subId);
    const toUpload = cfg.all ? docs : (cfg.i||[]).map(idx => docs[idx]).filter(Boolean);
    toUpload.forEach(doc => {
      const fname = makeDocFilename(doc.doc_name);
      setDocStmt.run(fname, fname, demoUploadDate, doc.id);
    });
  }

  // ── BWA-Analysen seeden ────────────────────────────────────────────────────
  const insBwa = db.prepare(`INSERT INTO bwa_analysen
    (mandant_name, filename, originalname, analyse, ampel, kurzfazit, kennzahlen, bwa_rows, email_betreff, email_text, kanzlei_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

  insBwa.run('Felix Kramer', '', 'BWA 12/2024',
    'Umsatzerlöse: 82.421,30 EUR (AdSense 58.421,30 EUR + Ausgangsrechnungen 24.000,00 EUR). Betriebsausgaben: 7.472,09 EUR. Gewinn: 74.949,21 EUR – Gewinnmarge 91 %, deutlich über Branchenschnitt.\n\nPositiv: Sehr hohe Marge durch skalierbares Online-Geschäft. Geringe Fixkosten. USt-Vorauszahlungen fristgerecht.\n\nHandlungsbedarf: Einspruch gegen USt-Bescheid 2024 läuft (Vorsteuer-Nichtanerkennung 1.641,90 EUR – Ausgang offen). Für 2025: Altersvorsorge-Aufbau und Investitionsplanung empfohlen, um steuerliche Bemessungsgrundlage zu optimieren.',
    'gruen', 'Starkes Jahrsergebnis. Gewinn 74.949 EUR bei 91% Marge. Kein unmittelbarer Handlungsbedarf.',
    JSON.stringify([
      { wert: '82.421', einheit: 'EUR', label: 'Umsatz gesamt' },
      { wert: '74.949', einheit: 'EUR', label: 'Gewinn (EÜR)' },
      { wert: '91', einheit: '%', label: 'Gewinnmarge' },
      { wert: '7.472', einheit: 'EUR', label: 'Betriebsausgaben' }
    ]),
    null,
    'Ihre BWA 2024 – Auswertung und Handlungsempfehlungen',
    'Sehr geehrter Herr Kramer,\n\nanbei erhalten Sie die Auswertung Ihrer betriebswirtschaftlichen Entwicklung für das Geschäftsjahr 2024.\n\nIhre Umsatzerlöse belaufen sich auf 82.421,30 EUR, der Gewinn liegt bei 74.949,21 EUR (Marge: 91 %). Das Ergebnis ist ausgezeichnet.\n\nHandlungsempfehlung: Im Rahmen des laufenden Einspruchsverfahrens zum USt-Bescheid 2024 werden wir die Vorsteuer-Nichtanerkennung (1.641,90 EUR) weiter verfolgen. Für die Steuerplanung 2025 empfehlen wir eine Rücklagenbildung und Investitionsplanung zur Optimierung der Steuerlast.\n\nFür Rückfragen stehen wir Ihnen jederzeit zur Verfügung.\n\nMit freundlichen Grüßen\nIhr Team H&K Automation',
    kid);

  insBwa.run('Dr. Maximilian Huber', '', 'BWA 12/2024',
    'Umsatzerlöse (Praxis): 35.420,00 EUR (Kassenärztliche Vereinigung + Privatpatienten). Betriebsausgaben: 62.400,00 EUR (davon Personalkosten 38.200 EUR, Praxismiete 24.800 EUR). Gewinn: -26.980,00 EUR – Ergebnis negativ durch hohe Fixkosten.\n\nAchtung: Die Praxisausgaben überschreiten die Einnahmen erheblich. Haupttreiber sind die Raumkosten (Miete 24.800 EUR) und der Personalaufwand. Im Gewerbesteuerbescheid 2024 wurden die Mietkosten zudem gem. §8 Nr. 1d GewStG hinzugerechnet – Einspruch läuft.\n\nHandlungsbedarf: Kostenstruktur kritisch überprüfen. Ggf. Verhandlung über Mietvertrag. Kurzfristig: Einspruch Gewerbesteuer 2024 weiterverfolgen (Potenzial: 8.738,70 EUR Rückerstattung).',
    'gelb', 'Kostenstruktur belastet Ergebnis. Gewinn negativ. Einspruch Gewerbesteuerbescheid läuft.',
    JSON.stringify([
      { wert: '35.420', einheit: 'EUR', label: 'Praxis-Einnahmen' },
      { wert: '-26.980', einheit: 'EUR', label: 'Jahresergebnis' },
      { wert: '62.400', einheit: 'EUR', label: 'Betriebsausgaben' },
      { wert: '24.800', einheit: 'EUR', label: 'Mietaufwand' }
    ]),
    null,
    'Ihre BWA 2024 – Auswertung und Handlungsempfehlungen',
    'Sehr geehrter Herr Dr. Huber,\n\nanbei erhalten Sie die Auswertung Ihrer betriebswirtschaftlichen Entwicklung für das Geschäftsjahr 2024.\n\nIhre Praxiseinnahmen belaufen sich auf 35.420,00 EUR. Die Betriebsausgaben (62.400 EUR) übersteigen die Einnahmen jedoch erheblich – das Jahresergebnis ist negativ (-26.980,00 EUR).\n\nDie größten Kostenpositionen sind Personalaufwand (38.200 EUR) und Praxismiete (24.800 EUR). Wir empfehlen dringend eine Überprüfung der Kostenstruktur und ggf. Nachverhandlung des Mietvertrags.\n\nHinweis: Im laufenden Einspruchsverfahren zum Gewerbesteuerbescheid 2024 verfolgen wir die Rückerstattung von 8.738,70 EUR weiter.\n\nFür ein persönliches Beratungsgespräch stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen\nIhr Team H&K Automation',
    kid);

  insBwa.run('Alexander Bauer', '', 'BWA 12/2024',
    'Einkünfte gesamt: 149.420,00 EUR (GF-Vergütung 96.000 EUR + Tantieme 45.000 EUR + Kapitalerträge 8.420 EUR). Betriebsausgaben (GmbH-Ebene): 23.200 EUR hinzugerechnet gem. Körperschaftsteuerbescheid 2024 (strittig – Einspruch eingelegt).\n\nPositiv: Sehr starkes Gesamteinkommen. Steuerliche Situation trotz Körperschaftsteuer-Streit gut diversifiziert. Kapitalertragsteuer bereits abgeführt, Günstigerprüfung vorteilhaft (Bescheid korrekt).\n\nHandlungsbedarf: Einspruch KSt-Bescheid 2024 aktiv – Potenzial 4.640 EUR. Kfz-Privatanteil für 2025 über Fahrtenbuchmethode absichern. Tantieme-Gestaltung für 2025 frühzeitig vereinbaren.',
    'gruen', 'Exzellentes Gesamteinkommen 149.420 EUR. KSt-Einspruch aktiv. Steueroptimierung empfohlen.',
    JSON.stringify([
      { wert: '149.420', einheit: 'EUR', label: 'Gesamteinkünfte' },
      { wert: '96.000', einheit: 'EUR', label: 'GF-Vergütung' },
      { wert: '45.000', einheit: 'EUR', label: 'Tantieme' },
      { wert: '4.640', einheit: 'EUR', label: 'Einspruchspotenzial KSt' }
    ]),
    null,
    'Ihre BWA 2024 – Auswertung und Handlungsempfehlungen',
    'Sehr geehrter Herr Bauer,\n\nanbei erhalten Sie die Auswertung Ihrer betriebswirtschaftlichen Entwicklung für das Geschäftsjahr 2024.\n\nIhr Gesamteinkommen beläuft sich auf 149.420,00 EUR aus GF-Vergütung, Tantieme und Kapitalerträgen – ein hervorragendes Ergebnis.\n\nIm laufenden Körperschaftsteuer-Einspruch (KSt 2024) verfolgen wir die Rückerstattung von 4.640,00 EUR weiter. Die nicht anerkannten Betriebsausgaben (Kfz-Privatanteil 14.800 EUR, Repräsentation 8.400 EUR) sind durch Fahrtenbuch und Belege vollständig dokumentiert.\n\nFür 2025 empfehlen wir: Frühzeitige Tantieme-Vereinbarung, Überprüfung der Kfz-Nutzungsanteile und Investitionsplanung zur Steueroptimierung auf GmbH-Ebene.\n\nMit freundlichen Grüßen\nIhr Team H&K Automation',
    kid);

  // ── Bescheide seeden ───────────────────────────────────────────────────────
  const demoTs = (d) => new Date(_now.getTime() - d * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const BD = '/opt/hk-app/uploads/bescheide';

  try { db.prepare('DELETE FROM bescheid_fields WHERE bescheid_id IN (SELECT id FROM bescheide WHERE kanzlei_id=?)').run(kid); } catch(e) {}
  try { db.prepare('DELETE FROM bescheid_analysis WHERE bescheid_id IN (SELECT id FROM bescheide WHERE kanzlei_id=?)').run(kid); } catch(e) {}
  try { db.prepare('DELETE FROM bescheid_deadlines WHERE bescheid_id IN (SELECT id FROM bescheide WHERE kanzlei_id=?)').run(kid); } catch(e) {}
  db.prepare('DELETE FROM bescheid_dokumente WHERE kanzlei_id=?').run(kid);
  db.prepare('DELETE FROM bescheide WHERE kanzlei_id=?').run(kid);

  const insB = db.prepare(`INSERT INTO bescheide
    (kanzlei_id, mandant_name, art, document_type, tax_year, jahr, betrag, erklaerter_betrag,
     datum, finanzamt, absender_typ, ki_analyse, status, review_status, analysis_status,
     einspruch_ja, einspruch_datum, einspruch_begruendung, original_filename, erstellt_am)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insF = db.prepare(`INSERT OR REPLACE INTO bescheid_fields
    (bescheid_id, field_name, field_value_json, value_type, created_at, updated_at)
    VALUES (?,?,?,'extracted',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  const insBD = db.prepare(`INSERT INTO bescheid_dokumente
    (bescheid_id, kanzlei_id, typ, dateiname, dateipfad) VALUES (?,?,?,?,?)`);

  const addB = (mn, art, dt, yr, betrag, erkl, datum, fa, absTyp, analyse, status, rs, ejahr, ejdat, ebeg, daysBack, pot, bFile, eFile) => {
    const origName = art + '.pdf';
    const r = insB.run(kid, mn, art, dt, yr, yr, betrag, erkl, datum, fa, absTyp, analyse, status, rs, 'abgeschlossen', ejahr ? 1 : 0, ejdat, ebeg, origName, demoTs(daysBack));
    const bid = r.lastInsertRowid;
    insF.run(bid, 'einspruchspotenzial', JSON.stringify(pot));
    if (bFile) insBD.run(bid, kid, 'bescheid',   bFile, BD + '/' + bFile);
    if (eFile) insBD.run(bid, kid, 'erklaerung', eFile, BD + '/' + eFile);
  };

  // LIVE DEMO – oben (neueste erstellt_am)
  addB('Felix Kramer', 'Umsatzsteuerbescheid 2024', 'umsatzsteuerbescheid', 2024,
    11240.50, 8487.60, '2025-02-03', 'Finanzamt Freiburg-Land', 'finanzamt',
    'Festgesetzte USt 11.240,50 EUR weicht von erklärter Steuerlast (8.487,60 EUR) ab. ' +
    'Finanzamt erkennt Vorsteuer aus Bewirtungsbelegen (1.641,90 EUR) nicht an (§15 Abs. 1a UStG). ' +
    'Einspruchspotenzial HOCH – Belege vorhanden, geschäftlicher Anlass nachweisbar.',
    'analysiert', 'fachlich_pruefen', false, null, null, 3, 'HOCH',
    'kramer_ust_bescheid_2024.pdf', 'kramer_ust_erklaerung_2024.pdf');

  addB('Dr. Maximilian Huber', 'Gewerbesteuerbescheid 2024', 'gewerbesteuerbescheid', 2024,
    13538.70, 4800.00, '2025-02-04', 'Gemeinde Freiburg im Breisgau', 'gemeinde',
    'Festgesetzte GewSt 13.538,70 EUR (erklärt: 4.800,00 EUR). ' +
    'Finanzamt rechnet Miet-/Pachtzinsen (24.800 EUR) gem. §8 Nr. 1d GewStG hinzu. ' +
    'Einspruchspotenzial HOCH – Hinzurechnung greift erst über 100.000 EUR; Freibetragsberechnung angreifbar.',
    'analysiert', 'fachlich_pruefen', false, null, null, 2, 'HOCH',
    'huber_gst_bescheid_2024.pdf', 'huber_gst_erklaerung_2024.pdf');

  addB('Alexander Bauer', 'Körperschaftsteuerbescheid 2024', 'koerperschaftsteuerbescheid', 2024,
    22840.00, 18200.00, '2025-02-05', 'Finanzamt Freiburg-Stadt', 'finanzamt',
    'Festgesetzte KSt + SolZ 22.840,00 EUR (erklärt: 18.200,00 EUR). ' +
    'Finanzamt rechnet 23.200 EUR Betriebsausgaben hinzu: Repräsentation (8.400 EUR) und Kfz-Privatanteil (14.800 EUR). ' +
    'Einspruchspotenzial HOCH – Kfz-Privatanteil per Fahrtenbuch belegt; Repräsentationsbelege liegen vor.',
    'analysiert', 'fachlich_pruefen', false, null, null, 1, 'HOCH',
    'bauer_kst_bescheid_2024.pdf', 'bauer_kst_erklaerung_2024.pdf');

  // ALLES PASST – Mitte
  addB('Felix Kramer', 'Einkommensteuerbescheid 2024', 'einkommensteuerbescheid', 2024,
    12491.20, 12491.20, '2025-01-22', 'Finanzamt Freiburg-Land', 'finanzamt',
    'Bescheid stimmt vollständig mit der Erklärung überein. Festgesetzte ESt 12.491,20 EUR korrekt. Kein Handlungsbedarf.',
    'analysiert', 'abgeschlossen', false, null, null, 16, 'GERING',
    'kramer_est_bescheid_2024.pdf', null);

  addB('Dr. Maximilian Huber', 'Einkommensteuerbescheid 2024', 'einkommensteuerbescheid', 2024,
    8566.60, 8566.60, '2025-01-21', 'Finanzamt Freiburg-Stadt', 'finanzamt',
    'Bescheid stimmt vollständig überein – Splitting korrekt, PKV-Abzug vollumfänglich anerkannt. Kein Handlungsbedarf.',
    'analysiert', 'abgeschlossen', false, null, null, 17, 'GERING',
    'huber_est_bescheid_2024.pdf', null);

  addB('Alexander Bauer', 'Einkommensteuerbescheid 2024', 'einkommensteuerbescheid', 2024,
    27408.55, 27408.55, '2025-01-20', 'Finanzamt Freiburg-Stadt', 'finanzamt',
    'Bescheid stimmt vollständig überein. Kapitalertragsteuer korrekt angerechnet, Günstigerprüfung vorteilhaft. Kein Handlungsbedarf.',
    'analysiert', 'abgeschlossen', false, null, null, 18, 'GERING',
    'bauer_est_bescheid_2024.pdf', null);

  // BEREITS EINGEREICHT – unten
  addB('Felix Kramer', 'Gewerbesteuerbescheid 2023', 'gewerbesteuerbescheid', 2023,
    7320.60, 3480.60, '2024-12-15', 'Gemeinde Freiburg im Breisgau', 'gemeinde',
    'Einspruch vom 10.01.2025 eingelegt. Streitig: Hinzurechnung übergangener Betriebsausgaben 2022 (4.200 EUR). Verfahren anhängig.',
    'abgeschlossen', 'abgeschlossen', true, '2025-01-10',
    'Einspruch gegen GewSt-Bescheid 2023 – Hinzurechnung übergangener Betriebsausgaben sachlich unzutreffend gem. §8 GewStG.',
    40, 'MITTEL', 'kramer_gst_bescheid_2023.pdf', null);

  addB('Dr. Maximilian Huber', 'Einkommensteuer-Änderungsbescheid 2023', 'aenderungsbescheid', 2023,
    11240.00, 8920.00, '2024-12-12', 'Finanzamt Freiburg-Stadt', 'finanzamt',
    'Einspruch vom 08.01.2025 eingelegt. Streitig: PKV-Beiträge Ehefrau (9.840 EUR) nicht vollständig als Sonderausgaben anerkannt.',
    'abgeschlossen', 'abgeschlossen', true, '2025-01-08',
    'Einspruch gegen ESt-Änderungsbescheid 2023 – PKV-Beiträge Ehegattin gem. §10 Abs. 1 Nr. 3 EStG vollständig absetzbar.',
    42, 'MITTEL', 'huber_aend_bescheid_2023.pdf', null);

  addB('Alexander Bauer', 'Umsatzsteuerbescheid 2023', 'umsatzsteuerbescheid', 2023,
    8120.00, 6180.00, '2024-12-05', 'Finanzamt Freiburg-Stadt', 'finanzamt',
    'Einspruch vom 03.01.2025 eingelegt. Streitig: Vorsteuer aus Instandhaltungsleistungen (831,20 EUR). Nachweise übermittelt.',
    'abgeschlossen', 'abgeschlossen', true, '2025-01-03',
    'Einspruch gegen USt-Bescheid 2023 – Vorsteuerabzug aus Instandhaltungsrechnungen (§15 UStG) zu Unrecht versagt.',
    45, 'MITTEL', 'bauer_ust_bescheid_2023.pdf', null);

  // ── beleg_flags: alle auf 'open' zurücksetzen ────────────────────────────
  db.prepare(`UPDATE beleg_flags SET status='open' WHERE submission_id IN (SELECT id FROM submissions WHERE kanzlei_id=?)`).run(kid);

  res.json({ ok: true, msg: 'Demo zurückgesetzt' });
});

// ─── GUTACHTEN ARCHIV ────────────────────────────────────────────────────────
app.get('/api/gutachten/liste', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT id, typ, mandant, titel, created_at
    FROM gutachten_archiv WHERE kanzlei_id = ?
    ORDER BY created_at DESC LIMIT 100
  `).all(req.kanzleiId);
  res.json(rows);
});

app.get('/api/gutachten/eintrag/:id', kanzleiMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM gutachten_archiv WHERE id = ? AND kanzlei_id = ?')
    .get(req.params.id, req.kanzleiId);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(row);
});

app.delete('/api/gutachten/:id', kanzleiMiddleware, (req, res) => {
  const row = db.prepare('SELECT id FROM gutachten_archiv WHERE id = ? AND kanzlei_id = ?')
    .get(req.params.id, req.kanzleiId);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  db.prepare('DELETE FROM gutachten_archiv WHERE id = ? AND kanzlei_id = ?')
    .run(req.params.id, req.kanzleiId);
  res.json({ ok: true });
});

// ─── DEMO MANDANTEN (Mock-Daten) ──────────────────────────────────────────────
const DEMO_MANDANTEN = {
  'müller maschinenbau': {
    name: 'Müller Maschinenbau GmbH',
    rechtsform: 'GmbH',
    ort: 'Stuttgart',
    branche: 'Sondermaschinenbau',
    umsatz: '12.000.000 €',
    jahresgewinn: '950.000 €',
    eigenkapital: '2.800.000 €',
    stammkapital: '100.000 €',
    mitarbeiter: '65',
    gesellschafter: 'Karl Müller, 100 %',
    betriebsimmobilien: 'Ja – Betriebsgebäude Stuttgart (Buchwert ca. 1,2 Mio. €)',
    verlustvortraege: 'Nein',
    organschaft: 'Nein'
  },
  'bauer kg': {
    name: 'Bauer KG',
    rechtsform: 'KG',
    ort: 'Reutlingen',
    branche: 'Hochbau',
    umsatz: '4.800.000 €',
    jahresgewinn_durchschnitt_3j: '280.000 € (Ø letzte 3 Jahre)',
    mitarbeiter: '35',
    gesellschafter: 'Heinrich Bauer (Komplementär), 100 %',
    betriebsimmobilien: 'Nein – nur gemietete Flächen',
    verwaltungsvermoegen_quote: 'Ca. 8 % (weit unter 20 %-Grenze)'
  },
  'schneider': {
    name: 'Schneider Beteiligungs GmbH',
    rechtsform: 'GmbH (Holding)',
    ort: 'München',
    umsatz_konzern: '22.000.000 €',
    jahresgewinn_konzern: '1.800.000 €',
    mitarbeiter_konzern: '85',
    gesellschafter: 'Klaus Schneider, 100 %',
    tochtergesellschaften: 'IT Solutions GmbH (100 %), Immobilien GmbH (100 %), Beratungs GmbH (100 %)',
    betriebsimmobilien: 'Ja – in Immobilien GmbH (Marktwert ca. 3,5 Mio. €)',
    holding_seit: '2019'
  }
};

function matchDemoMandant(text) {
  const t = (text || '').toLowerCase();
  for (const [key, data] of Object.entries(DEMO_MANDANTEN)) {
    // Voller Schlüssel ODER eindeutiger Nachname (müller/bauer/schneider sind im Demo-Bestand unverwechselbar)
    const nachname = key.split(' ')[0];
    if (key.split(' ').every(w => t.includes(w)) || t.includes(nachname)) return data;
  }
  return null;
}

// ─── GUTACHTEN RÜCKFRAGEN CHECK ───────────────────────────────────────────────
app.post('/api/gutachten/check', kanzleiMiddleware, async (req, res) => {
  let { typ, felder, einschaetzung } = req.body;

  // Freitext-Eingang ohne Typ-Auswahl: dem passenden Gutachten-Typ zuordnen.
  // Gutachten-Typen (umwandlung/nachfolge/exit) werden durchgereicht (Umwandlung mit vollem
  // Gesetzeskontext, die anderen ohne). Allgemeine Steuerfragen (stellungnahme) gehören in
  // KanzleiGPT -> abweisen. Zu vage/leer -> abweisen.
  if (!typ || typ === 'stellungnahme') {
    try {
      const clsMsg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: `Du ordnest eine freie Mandanten-Situationsbeschreibung einem Gutachten-Typ zu.
Mögliche Typen:
- "umwandlung": Umstrukturierung nach UmwG/UmwStG (Holding-Aufbau, Anteilstausch, Formwechsel, Verschmelzung, Auf-/Abspaltung, Ausgliederung, Einbringung).
- "nachfolge": Generationenübergang, Schenkung, Erbschaft, Übergabe an Nachfolger (ErbStG).
- "exit": Unternehmensverkauf (Asset Deal / Share Deal).
- "stellungnahme": sonstige steuerrechtliche Einzelfrage.
- null: Beschreibung zu vage, leer oder unverständlich, um überhaupt einen Fall zu erkennen.
Antworte AUSSCHLIESSLICH mit JSON: {"typ": "umwandlung"|"nachfolge"|"exit"|"stellungnahme"|null}`,
        messages: [{ role: 'user', content: einschaetzung || '(leer)' }]
      });
      let cls = {};
      try { cls = JSON.parse((clsMsg.content[0].text.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch(e) {}
      const erkannt = cls.typ;
      if (erkannt === 'stellungnahme') return res.json({ unzureichend: true, grund: 'allgemein' });
      if (!erkannt || !['umwandlung','nachfolge','exit'].includes(erkannt)) {
        return res.json({ unzureichend: true, grund: 'vage' });
      }
      typ = erkannt;
    } catch(e) {
      console.error('Typ-Klassifizierung-Fehler:', e.message);
      return res.json({ unzureichend: true });
    }
  }

  const typLabels = { umwandlung: 'Umwandlung (UmwG/UmwStG)', nachfolge: 'Unternehmensnachfolge (ErbStG)', exit: 'Unternehmensverkauf' };

  const suchtext = [einschaetzung, felder?.mandant, JSON.stringify(felder)].join(' ');
  const mandantDaten = matchDemoMandant(suchtext);

  const felderText = felder && Object.keys(felder).length
    ? Object.entries(felder).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
    : '(keine strukturierten Felder ausgefüllt)';

  const bekanntesDaten = mandantDaten
    ? '\n\n--- BEREITS IM SYSTEM BEKANNTE MANDANTENDATEN (diese NICHT mehr erfragen!) ---\n' +
      Object.entries(mandantDaten).map(([k,v]) => `${k}: ${v}`).join('\n')
    : '';

  const checkSystemPrompts = {
    umwandlung: `Du bist ein erfahrener Steuerberater und Fachanwalt für Steuerrecht (UmwG/UmwStG) in Deutschland.
Du prüfst, welche Informationen für ein fachlich vollständiges Umwandlungs-Gutachten noch fehlen.

PFLICHT-INFORMATIONEN FÜR EIN UMWANDLUNGS-GUTACHTEN — prüfe, ob jede dieser Kategorien bereits beantwortet ist:

A) GRUNDSTRUKTUR (immer erforderlich)
- Ausgangsrechtsform (Einzelunternehmen / GmbH / GmbH & Co. KG / OHG / AG / PersG)
- Zielrechtsform (was soll nach der Umwandlung existieren?)
- Gesellschafter: Anzahl, Anteile, natürliche oder juristische Person, Ansässigkeit (DE/EU/Drittland)

B) VERMÖGEN (immer erforderlich)
- Buchwert des Betriebsvermögens (Steuerbilanz)
- Gemeiner Wert / Marktwert (stille Reserven vorhanden?)
- Grundbesitz: ja/nein — wenn ja, welche Immobilien, im Betriebs- oder Privatvermögen?
- Verlustvorträge bei der übertragenden Gesellschaft?
- Betriebliche Verbindlichkeiten — droht negatives Betriebsvermögen?

C) ZEITHORIZONT / STRATEGIE (immer erforderlich)
- Ist ein Weiterverkauf des Unternehmens oder der Anteile geplant? Wenn ja, in welchem Zeitraum?
  (Relevant für Sperrfristen: 7 Jahre §22 UmwStG, 5 Jahre §18 Abs.3 bei GmbH→PersG)

D) FALLTYP-SPEZIFISCH — nur fragen wenn aus Ausgangs-/Zielrechtsform erkennbar relevant:
- Einbringung Einzelunternehmen/PersG → GmbH (§20): Alle funktional wesentlichen Betriebsgrundlagen bekannt? Sonder-Betriebsvermögen der Mitunternehmer?
- Holding-Aufbau/Anteilstausch (§21): Hält die Holding nach Einbringung die Stimmrechtsmehrheit?
- Formwechsel GmbH→PersG (§§3-8): Höhe der offenen Rücklagen der GmbH? (Steuerbelastung §7 UmwStG)
- Abspaltung/Aufspaltung (§15): Sind übertragenes UND zurückbleibendes Vermögen je ein eigenständiger Teilbetrieb? Gemeinsam genutzte wesentliche Betriebsgrundlagen (z.B. Grundstück)?
- Einbringung in PersG (§24): Höhe einer etwaigen Zuzahlung, und wohin (Privatvermögen oder Gesamthandsvermögen)?

E) GEGENLEISTUNG
- Erhält der Einbringende außer Gesellschaftsrechten noch andere Leistungen (bare Zuzahlungen, Darlehen, Verbindlichkeitsübernahmen)? Wenn ja, Betrag — wegen 25%-/500.000-€-Grenze.

VORGEHEN:
1. Analysiere ALLE vorhandenen Informationen (Felder + Berater-Einschätzung + bekannte Mandantendaten).
2. Hake jede Pflicht-Kategorie ab: eindeutig beantwortet (auch indirekt)? Dann NICHT fragen.
3. Stelle genau die Fragen, deren Antwort das Gutachten fachlich wesentlich verändert — ALLE die dafür nötig sind, aber keine überflüssigen. Keine feste Obergrenze; durch Bündeln verwandter Punkte (z.B. gemeiner Wert + stille Reserven) zu EINER Frage so kompakt wie möglich, nach Relevanz geordnet.
4. Frage nie doppelt. Stelle keine trivialen Fragen (z.B. Name des Mandanten wenn irrelevant für die Steueranalyse) und nichts, was sich aus den vorhandenen Daten bereits ableiten lässt.

Antworte AUSSCHLIESSLICH mit einem JSON-Array von Fragen als Strings.
Wenn keine wichtigen Informationen fehlen, antworte mit: []`,

    default: `Du bist ein erfahrener Steuerberater und Fachanwalt für Steuerrecht in Deutschland.
Du prüfst, welche Informationen für ein fachlich vollständiges Gutachten noch fehlen.

Vorgehen:
1. Analysiere sorgfältig ALLE bereits vorhandenen Informationen: strukturierte Felder (Schritt 2) UND die Einschätzung des Beraters (Schritt 3) UND bekannte Mandantendaten aus dem System.
2. Leite daraus ab, was davon bereits eindeutig beantwortet ist — auch wenn es nur indirekt erwähnt wird.
3. Stelle genau die Fragen, deren Antwort das Gutachten fachlich wesentlich verändert — ALLE die dafür nötig sind, aber keine überflüssigen. Keine feste Obergrenze; durch Bündeln verwandter Punkte zu EINER Frage so kompakt wie möglich, nach Relevanz geordnet.
4. Frage nie doppelt. Stelle keine trivialen Fragen und nichts, was sich aus den vorhandenen Daten bereits ableiten lässt.

Antworte AUSSCHLIESSLICH mit einem JSON-Array von Fragen als Strings.
Wenn keine wichtigen Informationen fehlen, antworte mit: []`
  };

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: checkSystemPrompts[typ] || checkSystemPrompts.default,
      messages: [{ role: 'user', content: `Gutachten-Typ: ${typLabels[typ] || typ}\n\n--- STRUKTURIERTE FELDER (Schritt 2) ---\n${felderText}\n\n--- EINSCHÄTZUNG DES BERATERS (Schritt 3) ---\n${einschaetzung || '(keine Angabe)'}${bekanntesDaten}` }]
    });
    let fragen = [];
    try { fragen = JSON.parse(msg.content[0].text.trim()); } catch(e) {
      const match = msg.content[0].text.match(/\[[\s\S]*\]/);
      if (match) fragen = JSON.parse(match[0]);
    }
    res.json({ fragen: Array.isArray(fragen) ? fragen : [], mandant_erkannt: mandantDaten?.name || null, erkannter_typ: typ });
  } catch(e) {
    console.error('Gutachten-Check-Fehler:', e.message);
    res.json({ fragen: [], mandant_erkannt: null, erkannter_typ: typ });
  }
});

// ─── GUTACHTEN RÜCKFRAGEN — RUNDE 2 (antwortgetrieben) ────────────────────────
// Prüft NACH Runde 1: hat eine Antwort etwas Neues/Änderndes eingeführt, das eine
// letzte Klarstellung braucht? Wenn nein -> [] -> direkt generieren.
app.post('/api/gutachten/check2', kanzleiMiddleware, async (req, res) => {
  const { typ, felder, einschaetzung } = req.body;
  const typLabels = { umwandlung: 'Umwandlungs-Gutachten', nachfolge: 'Nachfolge-Gutachten', exit: 'Verkaufs-Gutachten' };
  const felderText = felder && Object.keys(felder).length
    ? Object.entries(felder).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')
    : '(keine strukturierten Felder)';

  const system = `Du erstellst ein ${typLabels[typ] || 'Gutachten'} und hast dem Berater bereits Rückfragen gestellt; seine Antworten stehen unten im Abschnitt "Ergänzende Angaben".
Prüfe AUSSCHLIESSLICH: Hat eine der Antworten etwas NEUES oder ÄNDERNDES eingeführt, das die steuerliche Beurteilung wesentlich verändert und eine letzte Klarstellung braucht? Typische Auslöser:
- eine Gegenleistung / Zuzahlung neben den Anteilen (25%-/500.000-€-Grenze §21/§24)
- zusätzliche Vermögenswerte oder Beteiligungen, die einbezogen werden sollen
- ein weiterer Gesellschafter oder geänderte Beteiligungsverhältnisse
- ein geändertes Ziel oder ein Widerspruch zwischen Antworten
Stelle nur dann 1-3 SEHR gezielte Folgefragen, wenn ein solcher Punkt vorliegt. Frage nichts, was bereits beantwortet ist oder sich aus den Daten ergibt. Wenn die Antworten nichts Neues aufwerfen: antworte mit [].
Antworte AUSSCHLIESSLICH mit einem JSON-Array von Fragen als Strings.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: `Typ: ${typLabels[typ] || typ}\n\n--- STRUKTURIERTE FELDER ---\n${felderText}\n\n--- BISHERIGE EINSCHÄTZUNG + ERGÄNZENDE ANGABEN (Antworten Runde 1) ---\n${einschaetzung || '(keine)'}` }]
    });
    let fragen = [];
    try { fragen = JSON.parse(msg.content[0].text.trim()); } catch(e) {
      const m = msg.content[0].text.match(/\[[\s\S]*\]/);
      if (m) fragen = JSON.parse(m[0]);
    }
    res.json({ fragen: Array.isArray(fragen) ? fragen : [] });
  } catch(e) {
    console.error('Gutachten-Check2-Fehler:', e.message);
    res.json({ fragen: [] });
  }
});

// ─── GUTACHTEN BEARBEITEN (KI-Leiste, abschnittsweise + Folgewirkungen) ────────
app.post('/api/gutachten/edit', kanzleiMiddleware, async (req, res) => {
  const { typ, markdown, anweisung } = req.body;
  if (!markdown || !anweisung) return res.status(400).json({ error: 'Fehlende Daten' });
  const kanzleiName = process.env.KANZLEI_NAME || 'AHW Gruppe';

  const systemPrompt = `Du bist ein hochspezialisierter Fachberater für Steuer- und Gesellschaftsrecht bei ${kanzleiName} und überarbeitest ein bestehendes Gutachten auf Anweisung des Beraters.

ARBEITSWEISE:
1. Verstehe die Anweisung genau (sie kann mehrere Änderungswünsche enthalten — arbeite alle ab).
2. Überlege ZUERST gründlich, welche Abschnitte sich durch die Anweisung ändern müssen — NICHT nur der direkt genannte, sondern AUCH alle indirekt betroffenen (Empfehlung, Fristen-/Sperrfristübersicht, Steuerfolgen, Rechenbeispiele, Risiko-Einschätzung). Eine geänderte Annahme kann das Ergebnis an mehreren Stellen verschieben — halte alles konsistent zueinander.
3. Ändere NUR, was die Anweisung erfordert (direkt + zwingende Folgewirkungen). Lass alle nicht betroffenen Abschnitte vollständig unangetastet.
4. Bleibe fachlich korrekt und stütze dich ausschließlich auf die unten gegebenen Rechtsgrundlagen — erfinde keine Paragraphen oder Fristen.
5. SAUBERER FINALER TEXT: Die geänderten Abschnitte müssen lesbar sein, als wären sie von Anfang an so geschrieben worden. KEINE Meta-Hinweise auf die Bearbeitung — also NIEMALS Formulierungen wie „Korrektur gegenüber Erstentwurf", „geändert", „neu", „korrigiert", „Anpassung" oder Verweise auf frühere Fassungen/Entwürfe. Der Mandant erhält dieses Dokument als seinen Erstentwurf; es darf sich nicht auf seine eigene Änderungshistorie beziehen. Formuliere den Sachverhalt einfach direkt korrekt aus.

AUSGABEFORMAT — gib für JEDEN geänderten Abschnitt exakt diesen Block aus (KEIN JSON, KEINE Code-Fences):
[[[ABSCHNITT]]]
[[[UEBERSCHRIFT]]]<exakte Überschriftenzeile aus dem Dokument, inkl. der ## bzw. ###>
[[[INHALT]]]
<vollständiger neuer Markdown-Inhalt dieses Abschnitts, OHNE die Überschriftenzeile — ganz normaler Markdown mit echten Zeilenumbrüchen, nichts maskieren>
[[[/ABSCHNITT]]]

- Kopiere die Überschrift WORTGENAU wie im Dokument (gleiche Anzahl #, gleicher Text) — sie ist der Anker zum Auffinden.
- Wiederhole den Block für JEDEN geänderten Abschnitt (auch indirekt betroffene).
- Wenn nichts zu ändern ist, gib gar nichts aus.${(typ === 'umwandlung' && UMWANDLUNG_KONTEXT) ? `

═══════════════════════════════════════════════════════════════════
FACHWISSEN UMWANDLUNGSRECHT — verbindliche Grundlage
═══════════════════════════════════════════════════════════════════
${UMWANDLUNG_KONTEXT}` : ''}`;

  const userPrompt = `--- AKTUELLES GUTACHTEN (Markdown) ---
${markdown}

--- ANWEISUNG DES BERATERS ---
${anweisung}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let heartbeat = null;
  try {
    let full = '';
    heartbeat = setInterval(() => { try { res.write(': keepalive\n\n'); } catch(e) {} }, 15000);
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    stream.on('text', (t) => { full += t; });
    await stream.finalMessage();
    clearInterval(heartbeat);
    const edits = [];
    for (const b of full.split('[[[ABSCHNITT]]]').slice(1)) {
      const uM = b.match(/\[\[\[UEBERSCHRIFT\]\]\][ \t]*(.+)/);
      const iM = b.match(/\[\[\[INHALT\]\]\]\r?\n?([\s\S]*?)\[\[\[\/ABSCHNITT\]\]\]/);
      if (uM && iM) edits.push({ ueberschrift: uM[1].trim(), neuer_text: iM[1].trim() });
    }
    res.write(`data: ${JSON.stringify({ done: true, edits })}\n\n`);
    res.end();
  } catch(e) {
    clearInterval(heartbeat);
    console.error('Gutachten-Edit-Fehler:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); }
  }
});

// ─── GUTACHTEN-VERSION SPEICHERN (nach KI-Bearbeitung) ────────────────────────
app.post('/api/gutachten/save', kanzleiMiddleware, (req, res) => {
  const { id, typ, mandant, titel, inhalt } = req.body;
  if (!inhalt) return res.status(400).json({ error: 'Kein Inhalt' });
  try {
    // Mit id: bestehendes Gutachten in place aktualisieren (eine Version, kein v2/v3).
    if (id) {
      const r = db.prepare("UPDATE gutachten_archiv SET inhalt=?, created_at=datetime('now') WHERE id=? AND kanzlei_id=?")
        .run(inhalt, id, req.kanzleiId || 1);
      if (r.changes > 0) { console.log('Gutachten aktualisiert (in place): id', id, '| Zeichen', inhalt.length); return res.json({ ok: true, id }); }
    }
    // Fallback (keine/ungültige id): neu anlegen
    const info = db.prepare('INSERT INTO gutachten_archiv (kanzlei_id, typ, mandant, titel, inhalt) VALUES (?,?,?,?,?)')
      .run(req.kanzleiId || 1, typ || 'umwandlung', mandant || '', titel || 'Gutachten', inhalt);
    console.log('Gutachten gespeichert (neu): id', info.lastInsertRowid);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch(e) {
    console.error('Gutachten-Save-Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── SPEECH TO TEXT (Whisper) ────────────────────────────────────────────────
app.post('/api/speech', kanzleiMiddleware, audioUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Audiodatei erhalten.' });
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY nicht konfiguriert.' });
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), 'audio.webm');
    form.append('model', 'whisper-1');
    form.append('language', 'de');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + openaiKey },
      body: form
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.error?.message || 'Whisper-Fehler' });
    res.json({ text: data.text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GUTACHTEN ────────────────────────────────────────────────────────────────
app.post('/api/gutachten', kanzleiMiddleware, async (req, res) => {
  const { typ, felder, einschaetzung } = req.body;
  if (!typ || !felder) return res.status(400).json({ error: 'Fehlende Pflichtfelder' });

  const kanzleiName = process.env.KANZLEI_NAME || 'AHW Gruppe';

  const systemPrompt = `Du bist ein hochspezialisierter Fachberater für Steuerrecht und Gesellschaftsrecht bei ${kanzleiName}. Du verfügst über tiefe Kenntnisse in UmwG, UmwStG, GmbHG, AktG, HGB, EStG, KStG, GewStG, ErbStG, BewG und BGB-Erbrecht.

AUFGABE:
Erstelle auf Basis ALLER gegebenen Informationen (strukturierte Felder + Berater-Einschätzung + Mandantendaten) das qualitativ bestmögliche Gutachten. Die Hinweise des Beraters sind Teil des Sachverhalts — alles zusammen ergibt die Grundlage. Fehlende Informationen: explizite Annahme treffen und in Abschnitt VI als offenen Punkt aufführen.

QUALITÄTSKONTROLLE — intern, vor der Ausgabe:
Bevor du das Gutachten ausgibst, prüfe es systematisch nach diesem Schema und korrigiere still:
1. Sachverhalt-Check: Sind alle Eingabedaten korrekt und vollständig wiedergegeben?
2. Paragraphen-Check: Sind alle §-Verweise korrekt (richtiges Gesetz, Absatz, Satz)?
3. Zahlen-Check: Stimmen alle Berechnungen? Keine widersprüchlichen Zahlen zwischen Abschnitten?
4. Logik-Check: Ist die Argumentation in sich schlüssig? Passt die Empfehlung zur Analyse?
5. Vollständigkeits-Check: Alle vorgegebenen Pflichtabschnitte vorhanden und ausgefüllt?
6. Praxis-Check: Ist die Empfehlung konkret, begründet und für den Mandanten handlungsleitend?
Die Prüfung selbst ist nicht Teil des Outputs — gib ausschließlich das fertige, geprüfte Gutachten aus.

Stil: Präzise, juristisch sauber, keine Allgemeinplätze. Fachsprachlich für die interne Akte.
Formatierung: Markdown. ## Hauptabschnitte, ### Unterabschnitte, **fett** für Paragraphen und Schlüsselbegriffe, Tabellen für Vergleiche und Fristen, [ ] für offene Punkte.
Pflicht-Hinweis am Ende: KI-gestützter Erstentwurf, juristische Prüfung durch den Berater erforderlich.${(typ === 'umwandlung' && UMWANDLUNG_KONTEXT) ? `

═══════════════════════════════════════════════════════════════════
FACHWISSEN UMWANDLUNGSRECHT — verbindliche Grundlage für dieses Gutachten
═══════════════════════════════════════════════════════════════════
Nutze ausschließlich die folgenden, geprüften Rechtsgrundlagen (UmwG, UmwStG, UmwStE Stand 2.1.2025). Zitiere § und Absatz exakt. Erfinde keine Paragraphen oder Fristen. Wende den Anwendungs-Leitfaden am Ende systematisch an.

${UMWANDLUNG_KONTEXT}` : ''}`;

  const typLabels = { umwandlung: 'Umwandlungsgutachten', nachfolge: 'Nachfolgegutachten', exit: 'Gutachten Unternehmensverkauf', stellungnahme: 'Steuerrechtliche Stellungnahme' };

  const suchtext2 = [einschaetzung, felder?.mandant, JSON.stringify(felder)].join(' ');
  const mandantMock = matchDemoMandant(suchtext2);
  const mockZusatz = mandantMock
    ? '\n\n--- MANDANTENDATEN AUS SYSTEM ---\n' + Object.entries(mandantMock).map(([k,v])=>`${k}: ${v}`).join('\n')
    : '';

  const feldLines = Object.entries(felder).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join('\n');

  const einschaetzungBlock = einschaetzung
    ? `--- EINSCHÄTZUNG DES BERATERS (Schritt 3) ---\n${einschaetzung}`
    : `--- EINSCHÄTZUNG DES BERATERS ---\n(keine Angabe — Empfehlung allein auf Basis deiner Analyse)`;

  const heute = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const userPrompt = `Erstelle einen vollständigen ${typLabels[typ] || 'Gutachten-Entwurf'} mit folgenden Daten.

BRIEFKOPF — diese exakten Zeilen verwenden, NICHTS abändern:
**${kanzleiName} | Interne Akte**
**Gutachter:** Andreas Klotz, StB / Fachanwalt für Steuerrecht
**Stand:** ${heute}
WICHTIG: Die erste Zeile lautet exakt "${kanzleiName} | Interne Akte" — nicht "Kanzlei Andreas Klotz" oder andere Varianten.


--- SACHVERHALTSDATEN ---
${feldLines}
${mockZusatz}

${einschaetzungBlock}

Wichtig: Analysiere den Fall zunächst vollständig unabhängig (Stufe 1), bevor du die Berater-Einschätzung einbeziehst (Stufe 2).

--- GERÜST ---
Verwende diese Überschriften als festes Skelett. Passe Unterabschnitte an den tatsächlichen Sachverhalt an — ergänze notwendige, entferne irrelevante. Das Ergebnis muss zum Fall passen, nicht zur Vorlage.
${typ === 'umwandlung' ? `
## I. Sachverhalt und Ausgangssituation
### 1.1 Gesellschaftsrechtliche Ausgangslage
### 1.2 Wirtschaftliche Kennzahlen *(Tabelle)*
### 1.3 Wesentliche Wirtschaftsgüter und stille Reserven
### 1.4 Geplante Maßnahme und Motivation

## II. Rechtliche Einordnung und Umwandlungsweg
### 2.1 Einschlägige Rechtsgrundlage und Abgrenzung
### 2.2 Verfahrensablauf Schritt für Schritt
### 2.3 Steuerlicher Übertragungsstichtag
### 2.4 Voraussetzungen Buchwertansatz *(Checkliste ✓/✗)*

## III. Steuerliche Analyse
### 3.1 Ertragsteuer
#### 3.1.1 Ebene Einbringender
#### 3.1.2 Ebene aufnehmende Gesellschaft — laufende Besteuerung
#### 3.1.3 Ebene eingebrachte Gesellschaft
#### 3.1.4 Nachfolgeplanung — steuerliche Rahmenbedingungen
### 3.2 Sperrfristen und Behaltefristen *(kritisch)*
### 3.3 Steuerlicher Vorteil *(Rechenbeispiel: sofort + laufend)*
### 3.4 Grunderwerbsteuer *(nur wenn Grundbesitz beteiligt)*
### 3.5 Umsatzsteuer

## IV. Empfehlung und Begründung

## V. Fristen- und Sperrfristübersicht *(Tabelle: Maßnahme | Frist | Beginn | Ende | Konsequenz)*

## VI. Offene Punkte und Handlungsbedarf
### 6.1 Angenommene Werte *(nur Werte, die mangels Angabe angenommen werden mussten; je Punkt: angenommener Wert + welche konkrete Angabe ihn ersetzt. Werte, die im Sachverhalt oder in den Ergänzenden Angaben genannt sind, gehören NICHT hierher. Wenn keine Annahmen nötig waren: "Keine — alle bewertungsrelevanten Werte wurden angegeben.")*
### 6.2 Handlungsbedarf und nächste Schritte *(Checkliste [ ] — externe oder zukünftige Maßnahmen: Bewertung, Notartermin, Anträge, Fristenkalender, Prüfungen durch Spezialisten)*` : ''}
${typ === 'nachfolge' ? `
## I. Sachverhalt und Ausgangssituation
### 1.1 Beteiligte Personen *(Übergeber und Übernehmer)*
### 1.2 Das Unternehmen *(Kennzahlen als Tabelle)*
### 1.3 Wesentliche Wirtschaftsgüter und Vermögen
### 1.4 Übertragungsziel und geplanter Weg

## II. Steuerliche Analyse — Erbschaft- und Schenkungsteuer
### 2.1 Unternehmenswert *(§ 11 BewG, vereinfachtes Ertragswertverfahren)*
### 2.2 Steuerbelastung ohne Verschonung *(Vergleichsrechnung)*
### 2.3 Regelverschonung 85 % §§ 13a/13b ErbStG *(Tabelle mit Rechnung)*
### 2.4 Optionsverschonung 100 % — Prüfung und Empfehlung
### 2.5 Behaltefristen und Lohnsummenregel *(Tabelle)*

## III. Steuerliche Analyse — Ertragsteuer Übergeber

## IV. Gesellschaftsrechtliche Umsetzung *(Schritte-Liste)*

## V. Empfehlung und Zeitplan *(Tabelle: Schritt | Maßnahme | Zeitraum)*

## VI. Offene Punkte *(Checkliste [ ])*` : ''}
${typ === 'exit' ? `
## I. Sachverhalt und Ausgangssituation
### 1.1 Das Unternehmen und der Verkäufer
### 1.2 Wesentliche Wirtschaftsgüter und stille Reserven
### 1.3 Verkaufsziel und Käuferseite

## II. Verkaufsstruktur: Asset Deal vs. Share Deal
### 2.1 Asset Deal — steuerliche Analyse Verkäufer und Käufer
### 2.2 Share Deal — steuerliche Analyse Verkäufer und Käufer
### 2.3 Vergleichsrechnung *(Tabelle: Netto-Erlös | Steuer | Kaufpreisäquivalent)*

## III. Optimierungsstrategien vor dem Verkauf

## IV. Empfehlung und Begründung

## V. Offene Punkte *(Checkliste [ ])*` : ''}
${typ === 'stellungnahme' ? `
## I. Sachverhalt und Fragestellung

## II. Rechtliche und steuerliche Analyse

## III. Ergebnis und Empfehlung

## IV. Hinweise und Prüfungsvorbehalte` : ''}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let heartbeat = null;
  try {
    let fullText = '';
    // Hält die Verbindung während der Thinking-Phase offen (sonst nginx-Timeout, da noch kein Text fließt)
    heartbeat = setInterval(() => { try { res.write(': keepalive\n\n'); } catch(e) {} }, 15000);
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    stream.on('text', (text) => {
      fullText += text;
      res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
    });

    await stream.finalMessage();
    clearInterval(heartbeat);

    const inhalt = fullText
      .replace(/Kanzlei Andreas Klotz/g, kanzleiName)
      .replace(/Kanzlei Klotz/g, kanzleiName)
      .replace(/AHW Klotz/g, kanzleiName);
    const mandant = felder.mandant || felder['gn-mandant'] || felder['gs-mandant'] || mandantMock?.name || '';
    const titel = `${typLabels[typ] || typ}${mandant ? ' – ' + mandant : ''} – ${new Date().toLocaleDateString('de-DE')}`;
    let docId = null;
    try {
      const info = db.prepare('INSERT INTO gutachten_archiv (kanzlei_id, typ, mandant, titel, inhalt) VALUES (?,?,?,?,?)')
        .run(req.kanzleiId || 1, typ, mandant, titel, inhalt);
      docId = info.lastInsertRowid;
      console.log('Gutachten gespeichert: id', docId, '| kanzlei', req.kanzleiId || 1, '| Zeichen', inhalt.length);
    } catch(e) { console.error('Gutachten-Archiv Fehler:', e.message); }
    res.write(`data: ${JSON.stringify({ done: true, gutachten: inhalt, id: docId })}\n\n`);
    res.end();
  } catch(e) {
    clearInterval(heartbeat);
    console.error('Gutachten-Fehler:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
});

// ─── JAHRESABSCHLUSS ──────────────────────────────────────────────────────────
// System-Prompt aus prompts/jahresabschluss.md (Klotz-Spezialisierung, JSON-Schema, Anti-Halluzination).
// Sonnet 4.6 statt Haiku. PDF wird direkt als document content type an Claude geschickt,
// kein lokales pdf-parse — Claude liest Tabellen, Bilanz und Anhang nativ.
function jaSystemPrompt() {
  try {
    return fs.readFileSync(path.join(__dirname, 'prompts', 'jahresabschluss.md'), 'utf8');
  } catch(e) {
    console.error('[JA] System-Prompt nicht ladbar:', e.message);
    return 'Du bist Steuerberater und analysierst einen Jahresabschluss strukturiert.';
  }
}

function jaFormatNichtErkannt(hinweis) {
  return {
    metadata: { mandant: null, geschaeftsjahr: null, bilanzstichtag: null, format_erkannt: false, format_hinweis: hinweis },
    kennzahlen_kacheln: [], kennzahlen_tabelle: [],
    bilanzstruktur: { aktiv: [], passiv: [], auffaelligkeiten: [] },
    guv_analyse: { margenentwicklung: '', sondereinfluesse: [], umsatzentwicklung: '' },
    stille_reserven_hinweise: [], risiken: [],
    mandantenversion: { ueberschrift: '', text: '' },
    manuelle_pruefung_erforderlich: [],
    mail_entwurf: { betreff: '', anschreiben: '' }
  };
}

app.post('/api/jahresabschluss', kanzleiMiddleware, jaUploadDisk.single('file'), async (req, res) => {
  const { mandant, jahr } = req.body;
  if (!req.file) return res.status(400).json({ error: 'PDF erforderlich' });

  try {
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfBase64 = pdfBuffer.toString('base64');
    const userText = `Analysiere diesen Jahresabschluss${mandant ? ' für ' + mandant : ''}${jahr ? ' (Geschäftsjahr ' + jahr + ')' : ''}. Antworte ausschließlich mit dem JSON-Objekt gemäß Schema. Kein Markdown, kein Fließtext.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: jaSystemPrompt(),
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: userText }
        ]
      }]
    });

    const rawText = (message.content[0] && message.content[0].text || '').trim()
      .replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch(pe) {
      console.error('[JA] JSON-Parsing fehlgeschlagen:', pe.message);
      parsed = jaFormatNichtErkannt('Das Format dieses Dokuments konnte nicht zugeordnet werden. Bitte laden Sie einen Jahresabschluss als PDF (Bilanz, GuV, Anhang) hoch. Bei wiederholtem Problem prüft der Support das Format manuell.');
    }

    const mandantName = (parsed.metadata && parsed.metadata.mandant) || mandant || null;
    const gj = (parsed.metadata && parsed.metadata.geschaeftsjahr) || jahr || null;
    const bs = (parsed.metadata && parsed.metadata.bilanzstichtag) || null;
    const formatErkannt = parsed.metadata && parsed.metadata.format_erkannt === false ? 0 : 1;

    const r = db.prepare(`INSERT INTO jahresabschluss_analysen
      (kanzlei_id, mandant_name, geschaeftsjahr, bilanzstichtag, filename, originalname, analyse_json, format_erkannt)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(req.kanzleiId || 1, mandantName, gj, bs, req.file.filename, req.file.originalname, JSON.stringify(parsed), formatErkannt);

    res.json({ id: r.lastInsertRowid, ...parsed, filename: req.file.filename, originalname: req.file.originalname });
  } catch(e) {
    console.error('[JA] Fehler:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/jahresabschluss/liste', kanzleiMiddleware, (req, res) => {
  const rows = db.prepare(`SELECT id, mandant_name, geschaeftsjahr, bilanzstichtag, originalname, format_erkannt, gesendet, erstellt_am
    FROM jahresabschluss_analysen WHERE kanzlei_id=? ORDER BY erstellt_am DESC`).all(req.kanzleiId || 1);
  res.json(rows);
});

app.get('/api/jahresabschluss/:id', kanzleiMiddleware, (req, res) => {
  const row = db.prepare('SELECT * FROM jahresabschluss_analysen WHERE id=? AND kanzlei_id=?').get(req.params.id, req.kanzleiId || 1);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  let parsed = {};
  try { parsed = JSON.parse(row.analyse_json); } catch(e) {}
  res.json({ id: row.id, filename: row.filename, originalname: row.originalname, gesendet: row.gesendet, erstellt_am: row.erstellt_am, ...parsed });
});

app.post('/api/jahresabschluss/send', kanzleiMiddleware, async (req, res) => {
  const { id, to, betreff, anschreiben, mandant_name } = req.body;
  if (!id || !to) return res.status(400).json({ error: 'id und to erforderlich' });
  const row = db.prepare('SELECT * FROM jahresabschluss_analysen WHERE id=? AND kanzlei_id=?').get(id, req.kanzleiId || 1);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });

  const kanzleiName = process.env.KANZLEI_NAME || 'Kanzlei Klotz';
  const heute = new Date().toLocaleDateString('de-DE', { day:'2-digit', month:'long', year:'numeric' });
  const anrede = mandant_name ? `Guten Tag ${mandant_name},` : 'Guten Tag,';
  const bodyText = (anschreiben || '').split('\n\n').map(p => `<p style="margin:0 0 14px 0">${p.replace(/\n/g,'<br>')}</p>`).join('');
  const _staff = getStaffForEmail(req.staffId);
  const emailHtml = buildEmailHtml({
    body: `<p style="margin:0 0 6px 0;font-size:12px;color:#888">${heute}</p><p style="margin:0 0 20px 0">${anrede}</p>${bodyText}`,
    staff: _staff
  });

  try {
    const attachments = [];
    if (row.filename) {
      const filepath = path.join(DATA_DIR, 'ja_uploads', row.filename);
      if (fs.existsSync(filepath)) {
        attachments.push({ filename: row.originalname || row.filename, content: fs.readFileSync(filepath).toString('base64'), type: 'application/pdf' });
      }
    }
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: betreff || `Ihr Jahresabschluss${row.geschaeftsjahr ? ' ' + row.geschaeftsjahr : ''} | ${kanzleiName}`,
      html: emailHtml,
      attachments
    });
    db.prepare('UPDATE jahresabschluss_analysen SET gesendet=1 WHERE id=?').run(id);
    res.json({ ok: true });
  } catch(e) {
    console.error('[JA Send]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  server.timeout = 300000;        // 5 Minuten — KI darf sich Zeit lassen
  server.headersTimeout = 310000;
  console.log(`H&K Portal läuft auf http://localhost:${PORT}`);
  console.log(`Mandanten: http://localhost:${PORT}/fragebogen.html`);
  console.log(`Kanzlei:   http://localhost:${PORT}/portal.html?kanzlei=1`);

  // Auto-Erinnerungen deaktiviert – Steuerberater entscheiden manuell

  // IMAP Sync: nur INBOX + Sent, 10s nach Start, dann alle 3 Minuten
  setTimeout(async () => {
    for (const f of ['INBOX', 'Sent']) {
      await syncEmails(f).catch(e => console.error('[IMAP Init]', f, e.message));
    }
    setInterval(async () => {
      for (const f of ['INBOX', 'Sent']) {
        await syncEmails(f).catch(e => console.error('[IMAP]', f, e.message));
      }
    }, 3 * 60 * 1000);
  }, 10 * 1000);

  // AI Classifier: 20s nach Start, dann alle 5 Minuten
  setTimeout(() => {
    classifyPendingEmails().catch(console.error);
    setInterval(() => classifyPendingEmails().catch(console.error), 5 * 60 * 1000);
  }, 20 * 1000);
});
