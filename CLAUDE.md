# RBB & Partner Pitch-App

## Zweck
Pitch-Mockup für Nikolai Galozzi (RBB & Partner), Termin 27.05.2026 10:00 Uhr.
Lokale Electron-App, basiert auf Klotz-App-Codebase, branded auf RBB.

## Was funktioniert
- Buchhaltungs-Modul (5 Views): Beleg-Eingang, Beleg-Detail mit Vision AI, Wissensdatenbank, DATEV-Export, Kanzlei-Cockpit
- Sidebar-Navigation zwischen allen Views
- Klick auf Beleg-Zeile öffnet Beleg-Detail
- Andere H&K-Module (Dashboard, Mandanten, BWA, KanzleiGPT etc.) sind aus dem Klotz-Code übernommen und navigierbar

## Was gemockt ist
- Kein Server. `window.fetch` ist im Pitch-Mode komplett überschrieben (Block im `<script>` direkt nach `SS_KEY`-Definition).
- Auto-Login: localStorage wird beim ersten Aufruf mit Demo-Session vorbefüllt.
- Default-View beim Start: `belege` (Beleg-Eingang).

## Starten
```bash
cd "/Users/loco/Desktop/H&K ALL/RBB&Partner : Nikolai H /RBB App"
./node_modules/.bin/electron .
# oder: npm start (wenn Electron in PATH)
```

## Wichtige Stellen in kanzlei.html
- `PITCH-MODE` Block (Auto-Login + fetch-Mock): direkt nach Zeile mit `const SS_KEY = 'hk_kanzlei_v2'`
- Buchhaltungs-CSS: am Ende des `<style>`-Blocks, Marker `PITCH-MODE — BUCHHALTUNG`
- Sidebar-Sektion „Buchhaltung": oberste Sektion in der Sidebar
- 5 Buchhaltungs-Views: am Anfang von `<div class="content-area">`, vor `view-dashboard`
