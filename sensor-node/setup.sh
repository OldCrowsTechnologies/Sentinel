#!/usr/bin/env bash
# setup.sh -- provision a Raspberry Pi as a Corvus Sentinel gunshot sensor node.
#
# Idempotent: safe to re-run. Installs Node, creates a locked-down service user,
# stages the code to /opt/corvus, and installs the systemd unit. It does NOT wire
# the microphone overlay -- that step is mic-specific and printed at the end.
#
# Run on the Pi (Raspberry Pi OS Bookworm, 64-bit):
#   curl -fsSL <repo>/sensor-node/setup.sh | sudo bash        # or
#   sudo ./sensor-node/setup.sh
set -euo pipefail

CORVUS_HOME=/opt/corvus
NODE_MAJOR=22

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)"; exit 1; }

log "Installing Node.js ${NODE_MAJOR}.x + ALSA tools"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
apt-get install -y alsa-utils
node -v

log "Creating service user 'corvus' (no login, audio group)"
if ! id corvus >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --groups audio corvus
fi

log "Staging code to ${CORVUS_HOME}/sensor-node and lib/"
# Copy sensor-node/ and the shared lib/ (node.mjs imports ../lib/shotDetect.ts).
SRC="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "${CORVUS_HOME}/sensor-node" "${CORVUS_HOME}/lib"
cp -r "${SRC}/sensor-node/." "${CORVUS_HOME}/sensor-node/"
cp "${SRC}/lib/shotDetect.ts" "${SRC}/lib/dsp.ts" "${CORVUS_HOME}/lib/"
chown -R corvus:audio "${CORVUS_HOME}"
# Config + session hold a seat code and a refresh token -- lock them down.
chmod 750 "${CORVUS_HOME}/sensor-node"

log "Installing systemd unit"
cp "${CORVUS_HOME}/sensor-node/corvus-sensor.service" /etc/systemd/system/
systemctl daemon-reload

if [ ! -f "${CORVUS_HOME}/sensor-node/node.json" ]; then
  cp "${CORVUS_HOME}/sensor-node/node.json.example" "${CORVUS_HOME}/sensor-node/node.json"
  chown corvus:audio "${CORVUS_HOME}/sensor-node/node.json"
  chmod 600 "${CORVUS_HOME}/sensor-node/node.json"
  CONFIG_TODO=1
fi

cat <<EOF

$(log "Provisioned.")
Remaining steps (mic-specific + per-site):

  1. WIRE THE MIC OVERLAY. For an I2S MEMS mic add to /boot/firmware/config.txt:
        dtparam=i2s=on
        dtoverlay=googlevoicehat-soundcard      # or the overlay for your HAT
     then reboot and confirm with:  arecord -l
     (A USB audio interface needs no overlay -- just set device to hw:2,0.)

  2. EDIT ${CORVUS_HOME}/sensor-node/node.json:
        - device       (from 'arecord -l')
        - nodeId       (unique per physical node)
        - lat/lon      (SURVEYED at install)
        - seatCode     (the agency's code -- this is the alert routing)
        - supabaseUrl / supabaseAnonKey
${CONFIG_TODO:+     A starter node.json was created for you from the example.}

  3. TEST capture before enabling the service:
        sudo -u corvus arecord -D hw:1,0 -f S16_LE -r 48000 -c 1 -d 3 /tmp/t.wav && echo OK

  4. ENABLE 24/7:
        sudo systemctl enable --now corvus-sensor
        journalctl -u corvus-sensor -f

EOF
