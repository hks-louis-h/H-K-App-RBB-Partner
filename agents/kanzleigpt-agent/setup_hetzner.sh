#!/bin/bash
# Einmalig auf Hetzner ausführen — richtet den Cron-Job ein
# ssh -i ~/.ssh/hk_hetzner root@178.104.23.187
# bash /opt/hk-app/agents/kanzleigpt-agent/setup_hetzner.sh

set -e

AGENT_DIR="/opt/hk-app/agents/kanzleigpt-agent"
PYTHON="/usr/bin/python3"

echo "=== KanzleiGPT Law Updater Setup ==="

# Dependencies installieren
echo "Installiere Python-Pakete..."
pip3 install -r "$AGENT_DIR/requirements.txt" -q

# Test-Lauf
echo "Teste Verbindung zu gesetze-im-internet.de..."
python3 -c "import requests; r=requests.get('https://www.gesetze-im-internet.de/estg/xml.zip',timeout=10); print(f'OK — {r.status_code}')"

# Cron-Job einrichten (alle 2 Wochen, montags 03:00 Uhr)
CRON_CMD="0 3 * * 1 [ \$((\$(date +\\%s) / 86400 \\% 14)) -eq 0 ] && ANTHROPIC_API_KEY=\$(grep ANTHROPIC_API_KEY /opt/hk-app/.env | cut -d= -f2) $PYTHON $AGENT_DIR/law_updater.py >> $AGENT_DIR/updater.log 2>&1"

# Einfachere Alternative: direkt alle 14 Tage
CRON_SIMPLE="0 3 1,15 * * ANTHROPIC_API_KEY=\$(grep -oP 'ANTHROPIC_API_KEY=\\K.*' /opt/hk-app/.env) $PYTHON $AGENT_DIR/law_updater.py >> $AGENT_DIR/updater.log 2>&1"

echo "Trage Cron-Job ein (1. und 15. des Monats, 03:00 Uhr)..."
(crontab -l 2>/dev/null | grep -v "law_updater"; echo "$CRON_SIMPLE") | crontab -

echo ""
echo "Cron-Job eingetragen:"
crontab -l | grep law_updater

echo ""
echo "=== Setup abgeschlossen ==="
echo "Manuell testen: ANTHROPIC_API_KEY=\$(grep -oP 'ANTHROPIC_API_KEY=\\K.*' /opt/hk-app/.env) python3 $AGENT_DIR/law_updater.py"
echo "Logs: tail -f $AGENT_DIR/updater.log"
