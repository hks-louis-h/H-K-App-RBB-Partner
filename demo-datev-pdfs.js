// Generiert zwei DATEV-style PDFs für Klotz-Demo:
//   1. demo-pdfs/mueller-bwa-april-2026.pdf  — DATEV BWA Form 1
//   2. demo-pdfs/schneider-ja-2024.pdf       — Jahresabschluss gem. § 264 HGB
//
// Daten enthalten bewusst Klotz-Goldnuggets:
//   BWA Müller: Personalkosten +18% MoM, Bewirtungskosten 4.200 EUR, Privatentnahmen +30%,
//               vGA-relevantes GF-Gehalt 28.000 EUR/Monat
//   JA Schneider: Grundstücke seit 2008 unverändert (stille Reserven), Beteiligungen historisch,
//                 Pensionsrückstellungen, keine latenten Steuern im Anhang
//
// Ausführung: node demo-datev-pdfs.js

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT_DIR = path.join(__dirname, 'demo-pdfs');
fs.mkdirSync(OUT_DIR, { recursive: true });

// DATEV-Farben
const DATEV_BLUE = '#1a3a6e';
const DATEV_GRAY = '#4a4a4a';
const LIGHT_BG = '#f0f4fa';

// EUR-Formatter
const eur = (n) => n == null ? '' : Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => n == null ? '' : n.toFixed(1).replace('.',',');

// ════════════════════════════════════════════════════════════════
// 1. MÜLLER BWA — DATEV BWA Form 1, April 2026
// ════════════════════════════════════════════════════════════════
function buildBWA() {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
    Title: 'BWA April 2026 - Müller Maschinenbau GmbH',
    Author: 'DATEV eG',
    Subject: 'Betriebswirtschaftliche Auswertung Form 1',
    Creator: 'DATEV Kanzlei-Rechnungswesen'
  }});
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, 'mueller-bwa-april-2026.pdf')));

  // Header
  doc.fontSize(8).fillColor(DATEV_GRAY).font('Helvetica');
  doc.text('Steuerberatungskanzlei Andreas Klotz · Hauptstraße 12 · 70173 Stuttgart', 40, 30);
  doc.text('Berater-Nr. 12345 · Tel. 0711 / 123456 · kanzlei@klotz-stb.de', 40, 42);

  // Titelblock
  doc.rect(40, 60, 515, 24).fill(DATEV_BLUE);
  doc.fillColor('#fff').fontSize(11).font('Helvetica-Bold');
  doc.text('BWA Form 1 - Kurzfristige Erfolgsrechnung', 50, 67);
  doc.fontSize(8).font('Helvetica');
  doc.text('DATEV-Kanzlei-Rechnungswesen', 380, 70);

  // Mandant-Block
  let y = 95;
  doc.fillColor('#000').fontSize(9).font('Helvetica-Bold');
  doc.text('Mandant:', 40, y);
  doc.font('Helvetica').text('Müller Maschinenbau GmbH', 110, y);
  doc.font('Helvetica-Bold').text('Mandanten-Nr.:', 350, y);
  doc.font('Helvetica').text('67890', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('Sitz:', 40, y);
  doc.font('Helvetica').text('Stuttgart, HRB 12345', 110, y);
  doc.font('Helvetica-Bold').text('Steuernummer:', 350, y);
  doc.font('Helvetica').text('99181 12345', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('Auswertungszeitraum:', 40, y);
  doc.font('Helvetica').text('April 2026', 160, y);
  doc.font('Helvetica-Bold').text('Letzte Buchung:', 350, y);
  doc.font('Helvetica').text('30.04.2026', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('Kontenrahmen:', 40, y);
  doc.font('Helvetica').text('SKR 03', 160, y);
  doc.font('Helvetica-Bold').text('Erstellt am:', 350, y);
  doc.font('Helvetica').text('05.05.2026', 440, y);
  y += 18;

  // Tabellenkopf
  doc.rect(40, y, 515, 28).fill(LIGHT_BG);
  doc.fillColor(DATEV_GRAY).fontSize(7).font('Helvetica-Bold');
  doc.text('Bezeichnung', 45, y+4, { width: 175 });
  doc.text('Apr 2026', 230, y+4, { width: 70, align: 'right' });
  doc.text('% Umsatz', 230, y+16, { width: 70, align: 'right' });
  doc.text('Jan-Apr 2026', 305, y+4, { width: 70, align: 'right' });
  doc.text('% Umsatz', 305, y+16, { width: 70, align: 'right' });
  doc.text('Apr 2025', 380, y+4, { width: 70, align: 'right' });
  doc.text('% Umsatz', 380, y+16, { width: 70, align: 'right' });
  doc.text('Jan-Apr 2025', 455, y+4, { width: 95, align: 'right' });
  doc.text('% Umsatz', 455, y+16, { width: 95, align: 'right' });
  y += 30;

  const umsatzAkt = 1080000, umsatzKum = 4320000, umsatzVj = 950000, umsatzVjKum = 3940000;
  const row = (label, akt, kum, vj, vjKum, opts = {}) => {
    const isSum = !!opts.sum;
    const isItalic = !!opts.italic;
    const indent = opts.indent || 0;
    if (isSum) doc.rect(40, y-1, 515, 13).fill('#fafafa');
    doc.fillColor('#000').fontSize(7.5).font(isSum ? 'Helvetica-Bold' : (isItalic ? 'Helvetica-Oblique' : 'Helvetica'));
    doc.text(label, 45 + indent, y+2, { width: 175 - indent });
    doc.text(eur(akt), 230, y+2, { width: 70, align: 'right' });
    doc.text(akt!=null ? pct(akt/umsatzAkt*100) : '', 230, y+2, { width: 95, align: 'right' });
    doc.text(eur(kum), 305, y+2, { width: 70, align: 'right' });
    doc.text(kum!=null ? pct(kum/umsatzKum*100) : '', 305, y+2, { width: 95, align: 'right' });
    doc.text(eur(vj), 380, y+2, { width: 70, align: 'right' });
    doc.text(vj!=null ? pct(vj/umsatzVj*100) : '', 380, y+2, { width: 95, align: 'right' });
    doc.text(eur(vjKum), 455, y+2, { width: 95, align: 'right' });
    if (isSum) {
      doc.moveTo(40, y+12).lineTo(555, y+12).strokeColor(DATEV_GRAY).lineWidth(0.5).stroke();
    }
    y += 13;
  };

  row('Umsatzerlöse', 1080000, 4320000, 950000, 3940000);
  row('Best.Verdg. FE/UE', 0, 0, 0, 0);
  row('Akt. Eigenleistungen', 0, 0, 0, 0);
  row('Gesamtleistung', 1080000, 4320000, 950000, 3940000, { sum: true });
  row('Mat./Wareneinkauf', -626400, -2505600, -551000, -2285200);
  row('Rohertrag', 453600, 1814400, 399000, 1654800, { sum: true });
  row('So. betr. Erlöse', 8500, 34000, 7200, 28800);
  row('Betriebl. Rohertrag', 462100, 1848400, 406200, 1683600, { sum: true });
  row('Personalkosten', -280000, -1120000, -228000, -945600);
  row('   davon Geschäftsführer-Gehalt', -28000, -112000, -22000, -88000, { italic: true, indent: 8 });
  row('Raumkosten', -18500, -74000, -17800, -71200);
  row('Betriebliche Steuern', -4200, -16800, -3800, -15200);
  row('Versicherungen/Beiträge', -6800, -27200, -6400, -25600);
  row('Besondere Kosten', 0, 0, 0, 0);
  row('Fahrzeugkosten', -8200, -32800, -7500, -30000);
  row('Werbe-/Reisekosten', -7800, -31200, -8400, -33600);
  row('Bewirtungskosten (4650/4651)', -4200, -12500, -1400, -5200);
  row('Kosten Warenabgabe', 0, 0, 0, 0);
  row('Abschreibungen', -22000, -88000, -21500, -86000);
  row('Reparatur/Instandhaltung', -4800, -19200, -5200, -20800);
  row('Sonstige Kosten', -15300, -61200, -14100, -56400);
  row('Gesamtkosten', -371800, -1483700, -314100, -1287600, { sum: true });
  row('Betriebsergebnis', 90300, 364700, 92100, 396000, { sum: true });
  row('Sonst. neutrale Erträge', 0, 0, 0, 0);
  row('Sonst. neutrale Aufwand', 0, 0, 0, 0);
  row('Zinsaufwand', -8900, -39200, -7600, -32800);
  row('Steuern Eink./Ertrag', 0, 0, 0, 0);
  row('Vorläufiges Ergebnis', 81400, 325500, 84500, 363200, { sum: true });

  // Privatentnahmen-Block (für Personengesellschaften, hier nicht relevant, aber zur Spec-Demo)
  y += 8;
  doc.fontSize(7).fillColor(DATEV_GRAY).font('Helvetica-Bold');
  doc.text('Nachrichtlich (Gesellschafter-Konten):', 45, y);
  y += 10;
  doc.font('Helvetica').fillColor('#000');
  doc.text('Privatentnahmen Gesellschafter (Konto 1800)', 45, y);
  doc.text(eur(22500), 230, y, { width: 70, align: 'right' });
  doc.text(eur(87000), 305, y, { width: 70, align: 'right' });
  doc.text(eur(17800), 380, y, { width: 70, align: 'right' });
  doc.text(eur(67000), 455, y, { width: 95, align: 'right' });
  y += 12;

  // Footer
  y = 800;
  doc.fontSize(6).fillColor(DATEV_GRAY).font('Helvetica-Oblique');
  doc.text('Erstellt mit DATEV Kanzlei-Rechnungswesen comfort. Diese Auswertung enthält keine Bestände und keine OPOS-Daten. Für Liquiditätsaussagen ist eine ergänzende OPOS-Liste erforderlich.', 40, y, { width: 515, align: 'center' });

  doc.end();
}

// ════════════════════════════════════════════════════════════════
// 2. SCHNEIDER BETEILIGUNGS GmbH — Jahresabschluss 2024
// ════════════════════════════════════════════════════════════════
function buildJA() {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
    Title: 'Jahresabschluss 2024 - Schneider Beteiligungs GmbH',
    Author: 'Kanzlei Klotz',
    Subject: 'Jahresabschluss gem. § 264 HGB'
  }});
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, 'schneider-ja-2024.pdf')));

  // ─── Seite 1: Deckblatt ──────────────────────────────────────
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica');
  doc.text('Steuerberatungskanzlei Andreas Klotz · 70173 Stuttgart', 40, 40);

  doc.fillColor(DATEV_BLUE).fontSize(22).font('Helvetica-Bold');
  doc.text('Jahresabschluss', 40, 180);
  doc.fontSize(14).fillColor('#000').font('Helvetica');
  doc.text('zum 31. Dezember 2024', 40, 215);

  doc.moveTo(40, 250).lineTo(555, 250).strokeColor(DATEV_BLUE).lineWidth(1.5).stroke();

  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000');
  doc.text('Schneider Beteiligungs GmbH', 40, 280);
  doc.fontSize(11).font('Helvetica').fillColor(DATEV_GRAY);
  doc.text('Sitz: Tübingen', 40, 310);
  doc.text('Handelsregister: HRB 8821 Amtsgericht Stuttgart', 40, 325);
  doc.text('Steuernummer: 86001 22334', 40, 340);
  doc.text('Geschäftsführer: Dr. Klaus Schneider', 40, 355);

  doc.fontSize(10).fillColor('#000').font('Helvetica');
  doc.text('Bestandteile:', 40, 410);
  doc.font('Helvetica').text('  · Bilanz zum 31. Dezember 2024', 40, 430);
  doc.text('  · Gewinn- und Verlustrechnung 01.01. bis 31.12.2024', 40, 445);
  doc.text('  · Anhang', 40, 460);

  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica-Oblique');
  doc.text('Aufgestellt nach den Vorschriften des Handelsgesetzbuches (§§ 264 ff. HGB) sowie ergänzenden Vorschriften des GmbH-Gesetzes.', 40, 510, { width: 515 });
  doc.text('Größenklasse gem. § 267 HGB: mittelgroße Kapitalgesellschaft.', 40, 545, { width: 515 });

  doc.fontSize(8).fillColor(DATEV_GRAY);
  doc.text('Stuttgart, den 28. April 2026', 40, 760);
  doc.text('Andreas Klotz, Steuerberater · Fachanwalt für Steuerrecht', 40, 772);

  // ─── Seite 2: Bilanz Aktiv ────────────────────────────────────
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Bilanz zum 31. Dezember 2024', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Schneider Beteiligungs GmbH, Tübingen', 40, 60);

  let y = 90;
  // Aktiv-Header
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('A K T I V A', 40, y);
  doc.text('31.12.2024', 380, y, { width: 80, align: 'right' });
  doc.text('31.12.2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  const aktivRow = (label, akt, vj, opts = {}) => {
    const isSum = !!opts.sum;
    const isLevel0 = !!opts.level0; // ganze Hauptgruppe (A./B./...)
    const indent = opts.indent || 0;
    doc.fillColor('#000').font(isLevel0 ? 'Helvetica-Bold' : (isSum ? 'Helvetica-Bold' : 'Helvetica')).fontSize(9);
    doc.text(label, 45 + indent, y, { width: 330 - indent });
    if (akt != null) doc.text(eur(akt), 380, y, { width: 80, align: 'right' });
    if (vj != null)  doc.text(eur(vj), 470, y, { width: 80, align: 'right' });
    if (isSum) {
      doc.moveTo(380, y+12).lineTo(555, y+12).strokeColor('#666').lineWidth(0.4).stroke();
    }
    y += isLevel0 ? 14 : 12;
  };

  aktivRow('A. Anlagevermögen', null, null, { level0: true });
  aktivRow('I.  Immaterielle Vermögensgegenstände', 45000, 52000, { indent: 10 });
  aktivRow('II. Sachanlagen', null, null, { indent: 10 });
  aktivRow('1. Grundstücke und Gebäude', 2150000, 2150000, { indent: 25 });
  aktivRow('2. Andere Anlagen, BGA', 380000, 420000, { indent: 25 });
  aktivRow('III. Finanzanlagen', null, null, { indent: 10 });
  aktivRow('1. Anteile an verbundenen Unternehmen', 2875000, 2875000, { indent: 25 });
  aktivRow('   (Schneider IT Solutions, Schneider Immobilien, Schneider Beratung)', null, null, { indent: 28 });
  aktivRow('2. Ausleihungen an verbundene Unternehmen', 150000, 175000, { indent: 25 });
  aktivRow('Summe Anlagevermögen', 5600000, 5672000, { sum: true });
  y += 6;

  aktivRow('B. Umlaufvermögen', null, null, { level0: true });
  aktivRow('I.  Vorräte', 0, 0, { indent: 10 });
  aktivRow('II. Forderungen und sonstige Vermögensgegenstände', null, null, { indent: 10 });
  aktivRow('1. Forderungen aus L+L', 1358000, 1389200, { indent: 25 });
  aktivRow('2. Forderungen ggü. verbundenen Unternehmen', 142000, 142000, { indent: 25 });
  aktivRow('   (davon RLZ > 1 Jahr: 142.000 EUR — Immobilientochter, 97 Tage überfällig)', null, null, { indent: 28 });
  aktivRow('III. Liquide Mittel', 800000, 861800, { indent: 10 });
  aktivRow('Summe Umlaufvermögen', 2300000, 2393000, { sum: true });
  y += 6;
  aktivRow('C. Rechnungsabgrenzungsposten', 100000, 40000, { level0: true });
  y += 4;
  aktivRow('BILANZSUMME', 8000000, 8105000, { sum: true, level0: true });

  // ─── Seite 3: Bilanz Passiv ───────────────────────────────────
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Bilanz zum 31. Dezember 2024 (Fortsetzung)', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Schneider Beteiligungs GmbH, Tübingen', 40, 60);

  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('P A S S I V A', 40, y);
  doc.text('31.12.2024', 380, y, { width: 80, align: 'right' });
  doc.text('31.12.2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  aktivRow('A. Eigenkapital', null, null, { level0: true });
  aktivRow('I.   Gezeichnetes Kapital', 250000, 250000, { indent: 10 });
  aktivRow('II.  Kapitalrücklage', 500000, 500000, { indent: 10 });
  aktivRow('III. Gewinnrücklagen', 2450000, 2180000, { indent: 10 });
  aktivRow('IV.  Bilanzgewinn', 160000, 853000, { indent: 10 });
  aktivRow('Summe Eigenkapital', 3360000, 3783000, { sum: true });
  y += 6;
  aktivRow('B. Rückstellungen', null, null, { level0: true });
  aktivRow('1. Pensionsrückstellungen', 850000, 780000, { indent: 10 });
  aktivRow('   (Diskontierungssatz 1,82% p.a., 6 Versorgungsberechtigte, BilMoG-Unterschied 187.000 EUR)', null, null, { indent: 13 });
  aktivRow('2. Steuerrückstellungen', 420000, 395000, { indent: 10 });
  aktivRow('3. Sonstige Rückstellungen', 530000, 485000, { indent: 10 });
  aktivRow('Summe Rückstellungen', 1800000, 1660000, { sum: true });
  y += 6;
  aktivRow('C. Verbindlichkeiten', null, null, { level0: true });
  aktivRow('1. Verbindlichkeiten ggü. Kreditinstituten', 2200000, 2223000, { indent: 10 });
  aktivRow('2. Verbindlichkeiten aus L+L', 360000, 359000, { indent: 10 });
  aktivRow('3. Verbindlichkeiten ggü. Gesellschaftern', 250000, 50000, { indent: 10 });
  aktivRow('   (Gesellschafterdarlehen Dr. Schneider, Rangrücktritt erklärt)', null, null, { indent: 13 });
  aktivRow('4. Sonstige Verbindlichkeiten', 30000, 30000, { indent: 10 });
  aktivRow('Summe Verbindlichkeiten', 2840000, 2662000, { sum: true });
  y += 4;
  aktivRow('BILANZSUMME', 8000000, 8105000, { sum: true, level0: true });

  // ─── Seite 4: GuV ─────────────────────────────────────────────
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Gewinn- und Verlustrechnung', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('01.01.2024 bis 31.12.2024 — Schneider Beteiligungs GmbH', 40, 60);

  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Gesamtkostenverfahren (§ 275 Abs. 2 HGB)', 40, y);
  doc.text('2024', 380, y, { width: 80, align: 'right' });
  doc.text('2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  const guvRow = (label, val, vj, opts = {}) => {
    const isSum = !!opts.sum;
    const indent = opts.indent || 0;
    doc.fillColor('#000').font(isSum ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 45 + indent, y, { width: 330 });
    if (val != null) doc.text(eur(val), 380, y, { width: 80, align: 'right' });
    if (vj != null)  doc.text(eur(vj), 470, y, { width: 80, align: 'right' });
    if (isSum) doc.moveTo(380, y+12).lineTo(555, y+12).strokeColor('#666').lineWidth(0.4).stroke();
    y += 12;
  };

  guvRow('1. Umsatzerlöse', 8200000, 7850000);
  guvRow('2. Sonstige betriebliche Erträge', 285000, 92000);
  guvRow('   davon periodenfremd (Auflösung Rückstellung Garantie)', 165000, 0, { indent: 10 });
  guvRow('3. Materialaufwand', -4760000, -4520000);
  guvRow('4. Personalaufwand', -1985000, -1840000);
  guvRow('   a) Löhne und Gehälter', -1620000, -1510000, { indent: 10 });
  guvRow('   b) Soziale Abgaben und Aufwendungen für Altersversorgung', -365000, -330000, { indent: 10 });
  guvRow('5. Abschreibungen auf Anlagevermögen', -245000, -238000);
  guvRow('6. Sonstige betriebliche Aufwendungen', -940000, -895000);
  guvRow('Betriebsergebnis (EBIT)', 555000, 449000, { sum: true });
  y += 4;
  guvRow('7. Erträge aus Beteiligungen', 480000, 720000);
  guvRow('   (Gewinnausschüttungen Schneider IT, Schneider Beratung)', null, null, { indent: 10 });
  guvRow('8. Sonstige Zinsen und ähnliche Erträge', 8000, 12000);
  guvRow('9. Zinsen und ähnliche Aufwendungen', -95000, -98000);
  guvRow('Finanzergebnis', 393000, 634000, { sum: true });
  y += 4;
  guvRow('Ergebnis vor Steuern', 948000, 1083000, { sum: true });
  guvRow('10. Steuern vom Einkommen und Ertrag', -288000, -230000);
  guvRow('11. Sonstige Steuern', 0, 0);
  guvRow('Jahresüberschuss', 660000, 853000, { sum: true });

  // ─── Seite 5: Anhang (Auszug) ─────────────────────────────────
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Anhang zum Jahresabschluss 2024 (Auszug)', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Schneider Beteiligungs GmbH, Tübingen', 40, 60);

  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('1. Bilanzierungs- und Bewertungsmethoden', 40, y); y += 18;
  doc.font('Helvetica').fontSize(9);
  doc.text('Die Grundstücke und Gebäude wurden 2008 zu Anschaffungs- und Herstellungskosten aktiviert. Planmäßige Abschreibungen erfolgen linear über die gewöhnliche Nutzungsdauer. Eine Neubewertung erfolgte nicht. Stille Reserven werden im Anhang nicht beziffert.', 40, y, { width: 515, lineGap: 2 });
  y += 50;

  doc.text('Die Anteile an verbundenen Unternehmen sind zu Anschaffungskosten bewertet. Die letzten Erwerbe erfolgten in den Geschäftsjahren 2011 (Schneider IT Solutions GmbH), 2014 (Schneider Immobilien GmbH) und 2018 (Schneider Beratung GmbH). Eine Werthaltigkeitsprüfung wurde durchgeführt; eine außerplanmäßige Abschreibung war nicht erforderlich.', 40, y, { width: 515, lineGap: 2 });
  y += 60;

  doc.font('Helvetica-Bold').text('2. Pensionsrückstellungen', 40, y); y += 16;
  doc.font('Helvetica').text('Die Pensionsrückstellungen wurden gem. § 253 Abs. 2 HGB mit dem durchschnittlichen Marktzinssatz der vergangenen zehn Geschäftsjahre (1,82 % p.a.) abgezinst. Der Unterschiedsbetrag zur Bewertung mit dem Sieben-Jahres-Durchschnittszinssatz beträgt 187.000 EUR und unterliegt der Ausschüttungssperre nach § 253 Abs. 6 HGB.', 40, y, { width: 515, lineGap: 2 });
  y += 56;

  doc.font('Helvetica-Bold').text('3. Latente Steuern', 40, y); y += 16;
  doc.font('Helvetica').text('Von dem Ansatzwahlrecht nach § 274 HGB für aktive latente Steuern wurde kein Gebrauch gemacht. Passive latente Steuern bestehen nach Beurteilung der Geschäftsführung nicht.', 40, y, { width: 515, lineGap: 2 });
  y += 40;

  doc.font('Helvetica-Bold').text('4. Sonstige finanzielle Verpflichtungen und Eventualverbindlichkeiten', 40, y); y += 16;
  doc.font('Helvetica').text('Es bestehen Bürgschaften und Garantien für verbundene Unternehmen in Höhe von 450.000 EUR (Vorjahr: 380.000 EUR), davon entfallen 380.000 EUR auf eine Bürgschaft zugunsten der Schneider IT Solutions GmbH gegenüber der Hausbank.', 40, y, { width: 515, lineGap: 2 });
  y += 40;

  doc.font('Helvetica-Bold').text('5. Nachtragsbericht', 40, y); y += 16;
  doc.font('Helvetica').text('Nach dem Bilanzstichtag haben sich keine Vorgänge von besonderer Bedeutung ereignet, die einen wesentlichen Einfluss auf die Vermögens-, Finanz- und Ertragslage haben.', 40, y, { width: 515, lineGap: 2 });
  y += 36;

  doc.font('Helvetica-Bold').text('6. Geschäftsführung', 40, y); y += 16;
  doc.font('Helvetica').text('Geschäftsführer im Berichtsjahr: Dr. Klaus Schneider, Tübingen.', 40, y);

  doc.end();
}

// ════════════════════════════════════════════════════════════════
// 3. MÜLLER MASCHINENBAU GMBH — Jahresabschluss 2024
// Nachfolge-Szenario: GF Hans Müller 64, prüft Verkauf vs. Holdinglösung.
// Klotz-Goldnuggets: stille Reserven Maschinenpark + Grundstück, Pensionszusage GF,
// kein Anhang zu latenten Steuern, Sperrfristen UmwStG bei geplanter Umwandlung.
// ════════════════════════════════════════════════════════════════
function buildMuellerJA() {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
    Title: 'Jahresabschluss 2024 - Müller Maschinenbau GmbH',
    Author: 'Kanzlei Klotz'
  }});
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, 'mueller-ja-2024.pdf')));

  // Deckblatt
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica');
  doc.text('Steuerberatungskanzlei Andreas Klotz · 70173 Stuttgart', 40, 40);
  doc.fillColor(DATEV_BLUE).fontSize(22).font('Helvetica-Bold').text('Jahresabschluss', 40, 180);
  doc.fontSize(14).fillColor('#000').font('Helvetica').text('zum 31. Dezember 2024', 40, 215);
  doc.moveTo(40, 250).lineTo(555, 250).strokeColor(DATEV_BLUE).lineWidth(1.5).stroke();
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text('Müller Maschinenbau GmbH', 40, 280);
  doc.fontSize(11).font('Helvetica').fillColor(DATEV_GRAY);
  doc.text('Sitz: Stuttgart', 40, 310);
  doc.text('Handelsregister: HRB 12345 Amtsgericht Stuttgart', 40, 325);
  doc.text('Steuernummer: 99181 12345', 40, 340);
  doc.text('Geschäftsführer und Alleingesellschafter: Hans Müller (Jahrgang 1962)', 40, 355);
  doc.text('Branche: Maschinen- und Anlagenbau, 65 Mitarbeiter', 40, 370);

  doc.fontSize(10).fillColor('#000').font('Helvetica');
  doc.text('Bestandteile:', 40, 420);
  doc.text('  · Bilanz zum 31. Dezember 2024', 40, 440);
  doc.text('  · Gewinn- und Verlustrechnung 01.01. bis 31.12.2024', 40, 455);
  doc.text('  · Anhang', 40, 470);

  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica-Oblique');
  doc.text('Aufgestellt nach §§ 264 ff. HGB. Größenklasse gem. § 267 HGB: mittelgroße Kapitalgesellschaft.', 40, 520, { width: 515 });
  doc.text('Stuttgart, den 22. April 2026', 40, 760);
  doc.fontSize(8).text('Andreas Klotz, Steuerberater · Fachanwalt für Steuerrecht', 40, 772);

  // Bilanz Aktiv
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Bilanz zum 31. Dezember 2024', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Müller Maschinenbau GmbH, Stuttgart', 40, 60);
  let y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('A K T I V A', 40, y);
  doc.text('31.12.2024', 380, y, { width: 80, align: 'right' });
  doc.text('31.12.2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  const aktivRow = (label, akt, vj, opts = {}) => {
    const isSum = !!opts.sum, isLevel0 = !!opts.level0, indent = opts.indent || 0;
    doc.fillColor('#000').font(isLevel0 || isSum ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 45 + indent, y, { width: 330 - indent });
    if (akt != null) doc.text(eur(akt), 380, y, { width: 80, align: 'right' });
    if (vj != null)  doc.text(eur(vj), 470, y, { width: 80, align: 'right' });
    if (isSum) doc.moveTo(380, y+12).lineTo(555, y+12).strokeColor('#666').lineWidth(0.4).stroke();
    y += isLevel0 ? 14 : 12;
  };

  aktivRow('A. Anlagevermögen', null, null, { level0: true });
  aktivRow('I.  Immaterielle Vermögensgegenstände', 28000, 35000, { indent: 10 });
  aktivRow('II. Sachanlagen', null, null, { indent: 10 });
  aktivRow('1. Grundstücke und Gebäude (Betriebsgelände Stuttgart)', 950000, 950000, { indent: 25 });
  aktivRow('2. Technische Anlagen und Maschinen', 1850000, 1920000, { indent: 25 });
  aktivRow('3. Andere Anlagen, BGA', 320000, 345000, { indent: 25 });
  aktivRow('4. Geleistete Anzahlungen', 80000, 0, { indent: 25 });
  aktivRow('III. Finanzanlagen (Ausleihungen)', 12000, 18000, { indent: 10 });
  aktivRow('Summe Anlagevermögen', 3240000, 3268000, { sum: true });
  y += 6;
  aktivRow('B. Umlaufvermögen', null, null, { level0: true });
  aktivRow('I.   Vorräte', 2100000, 1640000, { indent: 10 });
  aktivRow('  1. Roh-, Hilfs- und Betriebsstoffe', 750000, 590000, { indent: 25 });
  aktivRow('  2. Unfertige Erzeugnisse', 980000, 720000, { indent: 25 });
  aktivRow('  3. Fertige Erzeugnisse', 370000, 330000, { indent: 25 });
  aktivRow('II.  Forderungen aus L+L', 1500000, 1418000, { indent: 10 });
  aktivRow('   davon RLZ > 1 Jahr: 0 EUR', null, null, { indent: 13 });
  aktivRow('III. Liquide Mittel', 800000, 1142000, { indent: 10 });
  aktivRow('Summe Umlaufvermögen', 4400000, 4200000, { sum: true });
  y += 6;
  aktivRow('C. Rechnungsabgrenzungsposten', 360000, 102000, { level0: true });
  y += 4;
  aktivRow('BILANZSUMME', 8000000, 7570000, { sum: true, level0: true });

  // Bilanz Passiv
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Bilanz zum 31. Dezember 2024 (Fortsetzung)', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Müller Maschinenbau GmbH, Stuttgart', 40, 60);
  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('P A S S I V A', 40, y);
  doc.text('31.12.2024', 380, y, { width: 80, align: 'right' });
  doc.text('31.12.2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  aktivRow('A. Eigenkapital', null, null, { level0: true });
  aktivRow('I.   Gezeichnetes Kapital', 100000, 100000, { indent: 10 });
  aktivRow('II.  Kapitalrücklage', 250000, 250000, { indent: 10 });
  aktivRow('III. Gewinnrücklagen', 2890000, 2510000, { indent: 10 });
  aktivRow('IV.  Bilanzgewinn', 120000, 240000, { indent: 10 });
  aktivRow('Summe Eigenkapital', 3360000, 3100000, { sum: true });
  y += 6;
  aktivRow('B. Rückstellungen', null, null, { level0: true });
  aktivRow('1. Pensionsrückstellung für Geschäftsführer Hans Müller', 720000, 645000, { indent: 10 });
  aktivRow('   (Versorgungszusage 2008, Festbetrag 6.500 EUR/Monat ab Vollendung 67. LJ)', null, null, { indent: 13 });
  aktivRow('   (Diskontierungssatz 1,82% p.a., BilMoG-Unterschied 158.000 EUR)', null, null, { indent: 13 });
  aktivRow('2. Steuerrückstellungen', 280000, 245000, { indent: 10 });
  aktivRow('3. Sonstige Rückstellungen (Garantien, Urlaub)', 410000, 385000, { indent: 10 });
  aktivRow('Summe Rückstellungen', 1410000, 1275000, { sum: true });
  y += 6;
  aktivRow('C. Verbindlichkeiten', null, null, { level0: true });
  aktivRow('1. Verbindlichkeiten ggü. Kreditinstituten', 1850000, 1980000, { indent: 10 });
  aktivRow('   davon RLZ > 5 Jahre: 980.000 EUR (Investitionsdarlehen Maschinenpark 2022)', null, null, { indent: 13 });
  aktivRow('2. Erhaltene Anzahlungen auf Bestellungen', 320000, 180000, { indent: 10 });
  aktivRow('3. Verbindlichkeiten aus L+L', 720000, 745000, { indent: 10 });
  aktivRow('4. Sonstige Verbindlichkeiten', 340000, 290000, { indent: 10 });
  aktivRow('Summe Verbindlichkeiten', 3230000, 3195000, { sum: true });
  y += 4;
  aktivRow('BILANZSUMME', 8000000, 7570000, { sum: true, level0: true });

  // GuV
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Gewinn- und Verlustrechnung', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('01.01.2024 bis 31.12.2024 — Müller Maschinenbau GmbH', 40, 60);
  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Gesamtkostenverfahren (§ 275 Abs. 2 HGB)', 40, y);
  doc.text('2024', 380, y, { width: 80, align: 'right' });
  doc.text('2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  const guvRow = (label, val, vj, opts = {}) => {
    const isSum = !!opts.sum, indent = opts.indent || 0;
    doc.fillColor('#000').font(isSum ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 45 + indent, y, { width: 330 });
    if (val != null) doc.text(eur(val), 380, y, { width: 80, align: 'right' });
    if (vj != null)  doc.text(eur(vj), 470, y, { width: 80, align: 'right' });
    if (isSum) doc.moveTo(380, y+12).lineTo(555, y+12).strokeColor('#666').lineWidth(0.4).stroke();
    y += 12;
  };
  guvRow('1. Umsatzerlöse', 12000000, 11500000);
  guvRow('2. Erhöhung/Verminderung des Bestands an UE/FE', 320000, 145000);
  guvRow('3. Andere aktivierte Eigenleistungen', 0, 0);
  guvRow('4. Sonstige betriebliche Erträge', 95000, 78000);
  guvRow('Gesamtleistung', 12415000, 11723000, { sum: true });
  guvRow('5. Materialaufwand', -6960000, -6555000);
  guvRow('   a) Roh-, Hilfs- und Betriebsstoffe', -5800000, -5450000, { indent: 10 });
  guvRow('   b) Bezogene Leistungen', -1160000, -1105000, { indent: 10 });
  guvRow('Rohertrag', 5455000, 5168000, { sum: true });
  guvRow('6. Personalaufwand', -3360000, -3100000);
  guvRow('   a) Löhne und Gehälter', -2750000, -2540000, { indent: 10 });
  guvRow('      davon Geschäftsführer-Gehalt Hans Müller', -336000, -312000, { indent: 13 });
  guvRow('   b) Soziale Abgaben, Altersversorgung', -610000, -560000, { indent: 10 });
  guvRow('7. Abschreibungen auf Anlagevermögen', -340000, -325000);
  guvRow('8. Sonstige betriebliche Aufwendungen', -735000, -695000);
  guvRow('Betriebsergebnis (EBIT)', 1020000, 1048000, { sum: true });
  y += 4;
  guvRow('9. Zinsen und ähnliche Aufwendungen', -78000, -88000);
  guvRow('Ergebnis vor Steuern', 942000, 960000, { sum: true });
  guvRow('10. Steuern vom Einkommen und Ertrag', -282000, -288000);
  guvRow('Jahresüberschuss', 660000, 672000, { sum: true });

  // Anhang
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Anhang zum Jahresabschluss 2024 (Auszug)', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Müller Maschinenbau GmbH, Stuttgart', 40, 60);
  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('1. Bilanzierungs- und Bewertungsmethoden', 40, y); y += 18;
  doc.font('Helvetica').fontSize(9);
  doc.text('Das Grundstück Betriebsgelände Stuttgart wurde im Geschäftsjahr 1998 zu Anschaffungskosten aktiviert. Der Buchwert von 950.000 EUR ist seit der erstmaligen Aktivierung unverändert. Eine Neubewertung erfolgte nicht. Stille Reserven werden im Anhang nicht beziffert.', 40, y, { width: 515, lineGap: 2 });
  y += 50;
  doc.text('Maschinen und technische Anlagen werden linear über die betriebsgewöhnliche Nutzungsdauer abgeschrieben. Wesentliche Sondermaschinen (Stanze Schuler Pressen 2014, CNC-Bearbeitungszentrum 2017) wurden über die steuerliche AfA-Tabelle für den Maschinenbau abgeschrieben und sind bilanziell auf Restbuchwerten. Marktwert nach Branchenindikation des VDMA voraussichtlich oberhalb des Buchwerts.', 40, y, { width: 515, lineGap: 2 });
  y += 60;
  doc.font('Helvetica-Bold').text('2. Pensionsrückstellung für Geschäftsführer Hans Müller', 40, y); y += 16;
  doc.font('Helvetica').text('Versorgungszusage vom 15.05.2008. Festbetrag 6.500 EUR/Monat ab Vollendung des 67. Lebensjahres. Bewertung nach Heubeck-Richttafeln 2018 G mit einem Diskontierungssatz von 1,82 % p.a. (10-Jahres-Durchschnitt). BilMoG-Unterschiedsbetrag zum 7-Jahres-Durchschnittszinssatz: 158.000 EUR (Ausschüttungssperre nach § 253 Abs. 6 HGB).', 40, y, { width: 515, lineGap: 2 });
  y += 56;
  doc.font('Helvetica-Bold').text('3. Latente Steuern', 40, y); y += 16;
  doc.font('Helvetica').text('Vom Ansatzwahlrecht nach § 274 HGB wurde kein Gebrauch gemacht.', 40, y, { width: 515 });
  y += 28;
  doc.font('Helvetica-Bold').text('4. Sonstige finanzielle Verpflichtungen', 40, y); y += 16;
  doc.font('Helvetica').text('Aus dem Investitionsdarlehen 2022 (Maschinenpark Neuanschaffung) bestehen Sicherungsübereignungen auf wesentliche Maschinen mit einem Buchwert von 1.250.000 EUR.', 40, y, { width: 515, lineGap: 2 });
  y += 40;
  doc.font('Helvetica-Bold').text('5. Angaben zur Geschäftsführung', 40, y); y += 16;
  doc.font('Helvetica').text('Geschäftsführer: Hans Müller, Jahrgang 1962, Alleingesellschafter mit 100 % der Anteile. Gehalt 2024: 336.000 EUR (Vorjahr 312.000 EUR), zzgl. private Nutzung Dienstwagen 14.400 EUR p.a.', 40, y, { width: 515, lineGap: 2 });

  doc.end();
}

// ════════════════════════════════════════════════════════════════
// 4. BAUER KG — Jahresabschluss 2024
// Generationenübergang: Tochter Anna soll Komplementärin werden.
// Klotz-Goldnuggets: Komplementär-Kommanditisten-Kapitalkonten getrennt,
// stille Reserven Grundstücke Reutlingen (Hochbau), Sperrfristen § 6 Abs 3 EStG
// bei unentgeltlicher Übertragung, Privatentnahmen Generationen ungleich.
// ════════════════════════════════════════════════════════════════
function buildBauerJA() {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
    Title: 'Jahresabschluss 2024 - Bauer KG',
    Author: 'Kanzlei Klotz'
  }});
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, 'bauer-ja-2024.pdf')));

  // Deckblatt
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica');
  doc.text('Steuerberatungskanzlei Andreas Klotz · 70173 Stuttgart', 40, 40);
  doc.fillColor(DATEV_BLUE).fontSize(22).font('Helvetica-Bold').text('Jahresabschluss', 40, 180);
  doc.fontSize(14).fillColor('#000').font('Helvetica').text('zum 31. Dezember 2024', 40, 215);
  doc.moveTo(40, 250).lineTo(555, 250).strokeColor(DATEV_BLUE).lineWidth(1.5).stroke();
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text('Bauer KG', 40, 280);
  doc.fontSize(11).font('Helvetica').fillColor(DATEV_GRAY);
  doc.text('Sitz: Reutlingen', 40, 310);
  doc.text('Handelsregister: HRA 4567 Amtsgericht Stuttgart', 40, 325);
  doc.text('Steuernummer: 90085 98765', 40, 340);
  doc.text('Komplementär: Josef Bauer (Jahrgang 1964)', 40, 355);
  doc.text('Kommanditisten: Anna Bauer (1992, Tochter), Markus Bauer (1995, Sohn)', 40, 370);
  doc.text('Branche: Hochbau, 28 Mitarbeiter', 40, 385);

  doc.fontSize(10).fillColor('#000').font('Helvetica');
  doc.text('Bestandteile:', 40, 430);
  doc.text('  · Bilanz zum 31. Dezember 2024', 40, 450);
  doc.text('  · Gewinn- und Verlustrechnung 01.01. bis 31.12.2024', 40, 465);
  doc.text('  · Anhang (freiwillig, Größenklasse klein gem. § 267a HGB)', 40, 480);

  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica-Oblique');
  doc.text('Aufgestellt nach §§ 242 ff. HGB. Größenklasse klein gem. § 267a HGB (Kleinstkapitalgesellschaft analog).', 40, 530, { width: 515 });
  doc.text('Stuttgart, den 30. März 2026', 40, 760);
  doc.fontSize(8).text('Andreas Klotz, Steuerberater · Fachanwalt für Steuerrecht', 40, 772);

  // Bilanz
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Bilanz zum 31. Dezember 2024', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Bauer KG, Reutlingen', 40, 60);
  let y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('A K T I V A', 40, y);
  doc.text('31.12.2024', 380, y, { width: 80, align: 'right' });
  doc.text('31.12.2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  const aktivRow = (label, akt, vj, opts = {}) => {
    const isSum = !!opts.sum, isLevel0 = !!opts.level0, indent = opts.indent || 0;
    doc.fillColor('#000').font(isLevel0 || isSum ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 45 + indent, y, { width: 330 - indent });
    if (akt != null) doc.text(eur(akt), 380, y, { width: 80, align: 'right' });
    if (vj != null)  doc.text(eur(vj), 470, y, { width: 80, align: 'right' });
    if (isSum) doc.moveTo(380, y+12).lineTo(555, y+12).strokeColor('#666').lineWidth(0.4).stroke();
    y += isLevel0 ? 14 : 12;
  };

  aktivRow('A. Anlagevermögen', null, null, { level0: true });
  aktivRow('I.  Sachanlagen', null, null, { indent: 10 });
  aktivRow('1. Grundstücke und Gebäude (Betriebshof Reutlingen)', 680000, 680000, { indent: 25 });
  aktivRow('2. Technische Anlagen (Baumaschinen, Schalung)', 540000, 615000, { indent: 25 });
  aktivRow('3. Fuhrpark (12 LKW, Bagger, Radlader)', 380000, 420000, { indent: 25 });
  aktivRow('4. Andere Anlagen, BGA', 95000, 110000, { indent: 25 });
  aktivRow('Summe Anlagevermögen', 1695000, 1825000, { sum: true });
  y += 6;
  aktivRow('B. Umlaufvermögen', null, null, { level0: true });
  aktivRow('I.  Vorräte', null, null, { indent: 10 });
  aktivRow('1. Roh-, Hilfs- und Betriebsstoffe', 185000, 165000, { indent: 25 });
  aktivRow('2. Unfertige Leistungen (laufende Bauvorhaben)', 420000, 280000, { indent: 25 });
  aktivRow('II. Forderungen aus L+L', 690000, 580000, { indent: 10 });
  aktivRow('III. Liquide Mittel', 180000, 320000, { indent: 10 });
  aktivRow('Summe Umlaufvermögen', 1475000, 1345000, { sum: true });
  y += 6;
  aktivRow('C. Rechnungsabgrenzungsposten', 30000, 30000, { level0: true });
  y += 4;
  aktivRow('BILANZSUMME', 3200000, 3200000, { sum: true, level0: true });

  // Passiv
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Bilanz zum 31. Dezember 2024 (Fortsetzung)', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Bauer KG, Reutlingen', 40, 60);
  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('P A S S I V A', 40, y);
  doc.text('31.12.2024', 380, y, { width: 80, align: 'right' });
  doc.text('31.12.2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  aktivRow('A. Eigenkapital', null, null, { level0: true });
  aktivRow('I.  Kapitalanteile Komplementär Josef Bauer', null, null, { indent: 10 });
  aktivRow('1. Festkapital', 250000, 250000, { indent: 25 });
  aktivRow('2. Variables Kapital (Gewinnvortrag, lfd. Gewinn, Entnahmen)', 410000, 372000, { indent: 25 });
  aktivRow('II. Kapitalanteile Kommanditisten', null, null, { indent: 10 });
  aktivRow('1. Anna Bauer — Festkapital', 50000, 50000, { indent: 25 });
  aktivRow('2. Anna Bauer — variables Kapital', 95000, 78000, { indent: 25 });
  aktivRow('3. Markus Bauer — Festkapital', 50000, 50000, { indent: 25 });
  aktivRow('4. Markus Bauer — variables Kapital', 85000, 70000, { indent: 25 });
  aktivRow('Summe Eigenkapital', 940000, 870000, { sum: true });
  y += 6;
  aktivRow('B. Rückstellungen', null, null, { level0: true });
  aktivRow('1. Gewährleistungsrückstellungen (Bau)', 280000, 245000, { indent: 10 });
  aktivRow('2. Sonstige Rückstellungen (Urlaub, Steuern)', 150000, 135000, { indent: 10 });
  aktivRow('Summe Rückstellungen', 430000, 380000, { sum: true });
  y += 6;
  aktivRow('C. Verbindlichkeiten', null, null, { level0: true });
  aktivRow('1. Verbindlichkeiten ggü. Kreditinstituten', 850000, 980000, { indent: 10 });
  aktivRow('2. Erhaltene Anzahlungen Bauherren', 580000, 480000, { indent: 10 });
  aktivRow('3. Verbindlichkeiten aus L+L (Subunternehmer, Material)', 380000, 460000, { indent: 10 });
  aktivRow('4. Sonstige Verbindlichkeiten', 20000, 30000, { indent: 10 });
  aktivRow('Summe Verbindlichkeiten', 1830000, 1950000, { sum: true });
  y += 4;
  aktivRow('BILANZSUMME', 3200000, 3200000, { sum: true, level0: true });

  // GuV
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Gewinn- und Verlustrechnung', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('01.01.2024 bis 31.12.2024 — Bauer KG', 40, 60);
  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
  doc.text('Gesamtkostenverfahren', 40, y);
  doc.text('2024', 380, y, { width: 80, align: 'right' });
  doc.text('2023', 470, y, { width: 80, align: 'right' });
  doc.fontSize(8).fillColor(DATEV_GRAY).text('EUR', 380, y+13, { width: 80, align: 'right' });
  doc.text('EUR', 470, y+13, { width: 80, align: 'right' });
  doc.moveTo(40, y+25).lineTo(555, y+25).strokeColor('#000').lineWidth(0.5).stroke();
  y += 32;

  const guvRow = (label, val, vj, opts = {}) => {
    const isSum = !!opts.sum, indent = opts.indent || 0;
    doc.fillColor('#000').font(isSum ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    doc.text(label, 45 + indent, y, { width: 330 });
    if (val != null) doc.text(eur(val), 380, y, { width: 80, align: 'right' });
    if (vj != null)  doc.text(eur(vj), 470, y, { width: 80, align: 'right' });
    if (isSum) doc.moveTo(380, y+12).lineTo(555, y+12).strokeColor('#666').lineWidth(0.4).stroke();
    y += 12;
  };
  guvRow('1. Umsatzerlöse', 4800000, 4520000);
  guvRow('2. Veränderung Bestand unfertige Leistungen', 140000, 60000);
  guvRow('3. Sonstige betriebliche Erträge', 52000, 38000);
  guvRow('Gesamtleistung', 4992000, 4618000, { sum: true });
  guvRow('4. Materialaufwand', -2380000, -2240000);
  guvRow('   a) Roh-, Hilfs- und Betriebsstoffe', -1050000, -980000, { indent: 10 });
  guvRow('   b) Bezogene Leistungen (Subunternehmer)', -1330000, -1260000, { indent: 10 });
  guvRow('5. Personalaufwand', -1480000, -1395000);
  guvRow('   davon Tätigkeitsvergütung Komplementär (Sondervergütung § 15 EStG)', -84000, -72000, { indent: 10 });
  guvRow('6. Abschreibungen', -210000, -195000);
  guvRow('7. Sonstige betriebliche Aufwendungen', -395000, -380000);
  guvRow('Betriebsergebnis', 527000, 408000, { sum: true });
  y += 4;
  guvRow('8. Zinsaufwand', -42000, -52000);
  guvRow('Jahresüberschuss (Gesamthandsergebnis)', 485000, 356000, { sum: true });
  y += 6;
  doc.fontSize(8).fillColor(DATEV_GRAY).font('Helvetica-Oblique').text('Anmerkung: Personengesellschaft – keine Steuern vom Einkommen auf Ebene der KG. Steuerbelastung erfolgt bei den Gesellschaftern.', 45, y, { width: 510 });
  y += 16;
  doc.fontSize(9).fillColor('#000').font('Helvetica-Bold').text('Gewinnverteilung 2024:', 45, y); y += 14;
  doc.font('Helvetica').fontSize(9);
  doc.text('Josef Bauer (Komplementär)            70 %    339.500 EUR', 60, y); y += 12;
  doc.text('Anna Bauer (Kommanditistin)           17 %     82.450 EUR', 60, y); y += 12;
  doc.text('Markus Bauer (Kommanditist)           13 %     63.050 EUR', 60, y);

  // Anhang
  doc.addPage();
  doc.fontSize(12).fillColor(DATEV_BLUE).font('Helvetica-Bold').text('Anhang zum Jahresabschluss 2024 (freiwillig)', 40, 40);
  doc.fontSize(9).fillColor(DATEV_GRAY).font('Helvetica').text('Bauer KG, Reutlingen', 40, 60);
  y = 90;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(10).text('1. Bilanzierungs- und Bewertungsmethoden', 40, y); y += 18;
  doc.font('Helvetica').fontSize(9);
  doc.text('Das Grundstück Betriebshof Reutlingen wurde im Jahr 1995 zu Anschaffungskosten aktiviert. Buchwert seit 1995 unverändert. Eine Neubewertung erfolgte nicht.', 40, y, { width: 515, lineGap: 2 });
  y += 36;
  doc.text('Unfertige Leistungen werden zu Herstellungskosten gem. § 255 Abs. 2 HGB bewertet. Anteilige Gemeinkosten werden eingerechnet.', 40, y, { width: 515, lineGap: 2 });
  y += 30;
  doc.font('Helvetica-Bold').text('2. Geplante Nachfolgegestaltung', 40, y); y += 16;
  doc.font('Helvetica').text('Komplementär Josef Bauer (61 Jahre) plant die schrittweise Übertragung seiner Stellung an Tochter Anna Bauer (32 Jahre). Eine entsprechende Vertragsgestaltung ist mit dem Steuerberater abgestimmt. Hinweis: Anwendung § 6 Abs. 3 EStG (Buchwertfortführung) erfordert unentgeltliche Übertragung und Beachtung der Sperrfristen.', 40, y, { width: 515, lineGap: 2 });
  y += 50;
  doc.font('Helvetica-Bold').text('3. Privatentnahmen 2024', 40, y); y += 16;
  doc.font('Helvetica').text('Josef Bauer:    187.000 EUR (Vorjahr 142.000 EUR)', 45, y); y += 12;
  doc.text('Anna Bauer:      48.000 EUR (Vorjahr 36.000 EUR)', 45, y); y += 12;
  doc.text('Markus Bauer:    36.000 EUR (Vorjahr 28.000 EUR)', 45, y); y += 18;
  doc.font('Helvetica-Bold').text('4. Sonstige finanzielle Verpflichtungen', 40, y); y += 16;
  doc.font('Helvetica').text('Aus Bauverträgen mit Bürgschaftshinterlegung bestehen Avalkreditlinien von 800.000 EUR (Vorjahr 700.000 EUR), davon zum Bilanzstichtag in Anspruch genommen: 320.000 EUR.', 40, y, { width: 515, lineGap: 2 });

  doc.end();
}

// ════════════════════════════════════════════════════════════════
// 5. MÜLLER BWA Januar 2026 — exakt DATEV-Look, identisch zu Form 1
// Mandant: Müller Maschinenbau GmbH (führender Mandant in der App)
// Kontakt: info@mueller-maschinenbau.de
// ════════════════════════════════════════════════════════════════
function buildMuellerBWAJan() {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
    Title: 'BWA Januar 2026 - Müller Maschinenbau GmbH',
    Author: 'DATEV eG',
    Subject: 'Betriebswirtschaftliche Auswertung Form 1',
    Creator: 'DATEV Kanzlei-Rechnungswesen'
  }});
  doc.pipe(fs.createWriteStream(path.join(OUT_DIR, 'mueller-bwa-januar-2026.pdf')));

  // Kanzlei-Briefkopf
  doc.fontSize(8).fillColor(DATEV_GRAY).font('Helvetica');
  doc.text('AHW Gruppe Steuerberatung · Hauptstraße 12 · 70173 Stuttgart', 40, 30);
  doc.text('Berater-Nr. 12345 · Tel. 0711 / 123456 · kanzlei@ahw-gruppe.de', 40, 42);

  // Adressfeld Mandant (DATEV-typisch, oben links nach Briefkopf)
  doc.rect(40, 60, 270, 60).strokeColor('#ccc').lineWidth(0.5).stroke();
  doc.fillColor('#000').fontSize(9).font('Helvetica');
  doc.text('Müller Maschinenbau GmbH', 48, 70);
  doc.text('z. Hd. Geschäftsführung Hans Müller', 48, 84);
  doc.text('Industriestraße 47', 48, 98);
  doc.text('70565 Stuttgart', 48, 112);

  // Titelblock
  doc.rect(40, 140, 515, 24).fill(DATEV_BLUE);
  doc.fillColor('#fff').fontSize(11).font('Helvetica-Bold');
  doc.text('BWA Form 1 - Kurzfristige Erfolgsrechnung', 50, 147);
  doc.fontSize(8).font('Helvetica');
  doc.text('DATEV-Kanzlei-Rechnungswesen', 380, 150);

  // Mandant-Block
  let y = 175;
  doc.fillColor('#000').fontSize(9).font('Helvetica-Bold');
  doc.text('Mandant:', 40, y);
  doc.font('Helvetica').text('Müller Maschinenbau GmbH', 110, y);
  doc.font('Helvetica-Bold').text('Mandanten-Nr.:', 350, y);
  doc.font('Helvetica').text('67890', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('Sitz:', 40, y);
  doc.font('Helvetica').text('Stuttgart, HRB 12345', 110, y);
  doc.font('Helvetica-Bold').text('Steuernummer:', 350, y);
  doc.font('Helvetica').text('99181 12345', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('E-Mail:', 40, y);
  doc.font('Helvetica').text('info@mueller-maschinenbau.de', 110, y);
  doc.font('Helvetica-Bold').text('Kontenrahmen:', 350, y);
  doc.font('Helvetica').text('SKR 03', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('Auswertungszeitraum:', 40, y);
  doc.font('Helvetica').text('Januar 2026', 160, y);
  doc.font('Helvetica-Bold').text('Letzte Buchung:', 350, y);
  doc.font('Helvetica').text('31.01.2026', 440, y);
  y += 12;
  doc.font('Helvetica-Bold').text('Erstellt am:', 40, y);
  doc.font('Helvetica').text('05.02.2026', 160, y);
  y += 18;

  // Tabellenkopf
  doc.rect(40, y, 515, 28).fill(LIGHT_BG);
  doc.fillColor(DATEV_GRAY).fontSize(7).font('Helvetica-Bold');
  doc.text('Bezeichnung', 45, y+4, { width: 175 });
  doc.text('Jan 2026', 230, y+4, { width: 70, align: 'right' });
  doc.text('% Umsatz', 230, y+16, { width: 70, align: 'right' });
  doc.text('Kumuliert', 305, y+4, { width: 70, align: 'right' });
  doc.text('% Umsatz', 305, y+16, { width: 70, align: 'right' });
  doc.text('Jan 2025', 380, y+4, { width: 70, align: 'right' });
  doc.text('% Umsatz', 380, y+16, { width: 70, align: 'right' });
  doc.text('Kum. 2025', 455, y+4, { width: 95, align: 'right' });
  doc.text('% Umsatz', 455, y+16, { width: 95, align: 'right' });
  y += 30;

  // Januar-Daten (Anfang Jahr — kumuliert = Monat)
  const umsatzAkt = 985000, umsatzKum = 985000, umsatzVj = 880000, umsatzVjKum = 880000;
  const row = (label, akt, kum, vj, vjKum, opts = {}) => {
    const isSum = !!opts.sum;
    const isItalic = !!opts.italic;
    const indent = opts.indent || 0;
    if (isSum) doc.rect(40, y-1, 515, 13).fill('#fafafa');
    doc.fillColor('#000').fontSize(7.5).font(isSum ? 'Helvetica-Bold' : (isItalic ? 'Helvetica-Oblique' : 'Helvetica'));
    doc.text(label, 45 + indent, y+2, { width: 175 - indent });
    doc.text(eur(akt), 230, y+2, { width: 70, align: 'right' });
    doc.text(akt!=null ? pct(akt/umsatzAkt*100) : '', 230, y+2, { width: 95, align: 'right' });
    doc.text(eur(kum), 305, y+2, { width: 70, align: 'right' });
    doc.text(kum!=null ? pct(kum/umsatzKum*100) : '', 305, y+2, { width: 95, align: 'right' });
    doc.text(eur(vj), 380, y+2, { width: 70, align: 'right' });
    doc.text(vj!=null ? pct(vj/umsatzVj*100) : '', 380, y+2, { width: 95, align: 'right' });
    doc.text(eur(vjKum), 455, y+2, { width: 95, align: 'right' });
    if (isSum) doc.moveTo(40, y+12).lineTo(555, y+12).strokeColor(DATEV_GRAY).lineWidth(0.5).stroke();
    y += 13;
  };

  row('Umsatzerlöse', 985000, 985000, 880000, 880000);
  row('Best.Verdg. FE/UE', 28000, 28000, 12000, 12000);
  row('Akt. Eigenleistungen', 0, 0, 0, 0);
  row('Gesamtleistung', 1013000, 1013000, 892000, 892000, { sum: true });
  row('Mat./Wareneinkauf', -571300, -571300, -510400, -510400);
  row('Rohertrag', 441700, 441700, 381600, 381600, { sum: true });
  row('So. betr. Erlöse', 7200, 7200, 6800, 6800);
  row('Betriebl. Rohertrag', 448900, 448900, 388400, 388400, { sum: true });
  row('Personalkosten', -258000, -258000, -215000, -215000);
  row('   davon Geschäftsführer-Gehalt', -28000, -28000, -22000, -22000, { italic: true, indent: 8 });
  row('   davon Lohnnachzahlung Q4/2025', -12000, -12000, 0, 0, { italic: true, indent: 8 });
  row('Raumkosten', -18500, -18500, -17800, -17800);
  row('Betriebliche Steuern', -4200, -4200, -3800, -3800);
  row('Versicherungen/Beiträge', -6800, -6800, -6400, -6400);
  row('Besondere Kosten', 0, 0, 0, 0);
  row('Fahrzeugkosten', -8200, -8200, -7500, -7500);
  row('Werbe-/Reisekosten', -8400, -8400, -7900, -7900);
  row('Bewirtungskosten (4650/4651)', -3850, -3850, -1200, -1200);
  row('Kosten Warenabgabe', 0, 0, 0, 0);
  row('Abschreibungen', -22000, -22000, -21500, -21500);
  row('Reparatur/Instandhaltung', -6300, -6300, -4800, -4800);
  row('Sonstige Kosten', -15800, -15800, -14100, -14100);
  row('Gesamtkosten', -352050, -352050, -300000, -300000, { sum: true });
  row('Betriebsergebnis', 96850, 96850, 88400, 88400, { sum: true });
  row('Sonst. neutrale Erträge', 0, 0, 0, 0);
  row('Sonst. neutraler Aufwand', 0, 0, 0, 0);
  row('Zinsaufwand', -9100, -9100, -7800, -7800);
  row('Steuern Eink./Ertrag', 0, 0, 0, 0);
  row('Vorläufiges Ergebnis', 87750, 87750, 80600, 80600, { sum: true });

  // Gesellschafterkonten
  y += 8;
  doc.fontSize(7).fillColor(DATEV_GRAY).font('Helvetica-Bold');
  doc.text('Nachrichtlich (Gesellschafter-Konten):', 45, y);
  y += 10;
  doc.font('Helvetica').fillColor('#000');
  doc.text('Privatentnahmen Gesellschafter (Konto 1800)', 45, y);
  doc.text(eur(28000), 230, y, { width: 70, align: 'right' });
  doc.text(eur(28000), 305, y, { width: 70, align: 'right' });
  doc.text(eur(18500), 380, y, { width: 70, align: 'right' });
  doc.text(eur(18500), 455, y, { width: 95, align: 'right' });
  y += 12;

  // Footer
  y = 800;
  doc.fontSize(6).fillColor(DATEV_GRAY).font('Helvetica-Oblique');
  doc.text('Erstellt mit DATEV Kanzlei-Rechnungswesen comfort. Diese Auswertung enthält keine Bestände und keine OPOS-Daten. Für Liquiditätsaussagen ist eine ergänzende OPOS-Liste erforderlich.', 40, y, { width: 515, align: 'center' });

  doc.end();
}

// ════════════════════════════════════════════════════════════════
buildBWA();
buildJA();
buildMuellerJA();
buildBauerJA();
buildMuellerBWAJan();

console.log('OK — generiert:');
console.log('  ' + path.join(OUT_DIR, 'mueller-bwa-april-2026.pdf'));
console.log('  ' + path.join(OUT_DIR, 'mueller-bwa-januar-2026.pdf'));
console.log('  ' + path.join(OUT_DIR, 'schneider-ja-2024.pdf'));
console.log('  ' + path.join(OUT_DIR, 'mueller-ja-2024.pdf'));
console.log('  ' + path.join(OUT_DIR, 'bauer-ja-2024.pdf'));
