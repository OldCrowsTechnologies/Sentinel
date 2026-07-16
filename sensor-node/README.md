# Corvus Sentinel — Gunshot Sensor Node

A headless Raspberry Pi that listens for gunfire and pushes an instant alert to
the **same C2** as the drone product. Air → mic → `arecord` → ring buffer →
[`detectShots()`](../lib/shotDetect.ts) → Supabase → dashboard.

**Why a Pi runs Node.** `node.mjs` imports [`lib/shotDetect.ts`](../lib/shotDetect.ts)
**unchanged** — the device runs the exact detector validated at **97.8% recall on
8,015 real gunshots** (C3GD; see [`tools/shot_eval.mjs`](../tools/shot_eval.mjs)).
No port, no second implementation to keep in parity. An ESP32 rewrite is the
production cost-down *after* the algorithm is proven in the field, not before —
and a ResNet-scale classifier does not fit an ESP32 anyway.

**A node is a headless deputy.** It enrolls with an agency **seat code** exactly
like a phone (`enroll()` in [`c2.mjs`](c2.mjs)): anonymous auth → `redeem_seat_code`
→ joined to an org → insert detections. So *routing the alert to the right agency
needs no new backend* — the seat code **is** the routing, and per-agency RLS
isolation comes free. School district node → district code; patrol car → SO code.

**No audio is ever written to disk.** Samples live in a RAM ring buffer and are
overwritten continuously; a detection transmits a few numbers, never audio. This
is a hard design constraint, not a setting — a device that continuously records
in a school is a wiretapping/consent problem regardless of intent, and it is the
fight ShotSpotter keeps having. Keep it that way.

---

## Files

| File | What |
|---|---|
| `node.mjs` | The daemon: capture → detect → alert, with offline buffering + capture-stall self-heal. |
| `c2.mjs` | C2 uplink: seat-code enrollment + `pushDetection`, plain `fetch` (no supabase-js). |
| `node.json.example` | Config template. Copy to `node.json` (gitignored — holds a seat code). |
| `corvus-sensor.service` | systemd unit: 24/7, `Restart=always`, hardened. |
| `setup.sh` | One-shot Pi provisioner. |

---

## Hardware (prototype)

Cheapest path that runs the real pipeline. See `docs/SENTINEL-SHOTS-FIRED.md` §6
for the full per-deployment BOM (school / roof / vehicle) with part links.

- **Brain:** Raspberry Pi 4 (2 GB) — enough RAM to develop the log-mel + CNN
  classifier without fighting a 512 MB ceiling. Zero 2 W ($17) is the cost-down
  once the model is locked.
- **Mic:** an I2S MEMS mic breakout (e.g. Adafruit SPH0645 / ICS-43434), **or**
  any class-compliant USB audio interface (zero drivers, most robust for
  bring-up). Clipping does **not** hurt detection — measured — so an exotic
  high-AOP mic is not needed for P1.
- **Power/network:** PoE for fixed installs (one cable = power + data + a path to
  time sync later); 12 V buck for a vehicle.

> **On the "phones can't hear gunshots" claim:** they can. Measured on 8,015 real
> shots, phone mics matched dedicated mics for *detection* (97.7% vs 97.8%). The
> reason a fixed node beats a phone is **known surveyed position** (which makes
> TDOA localization possible), guaranteed power, and always-on placement — not
> raw detection ability. Keep the pitch honest.

---

## Wire the mic (I2S)

Two I2S MEMS mics wired L/R on one bus give a stereo pair the Pi captures at
48 kHz. Add to `/boot/firmware/config.txt` (Bookworm — note the new path):

```
dtparam=i2s=on
dtoverlay=googlevoicehat-soundcard
```

Reboot, then confirm the card and record a 3 s test:

```
arecord -l                                              # find the card/device
arecord -D hw:1,0 -f S16_LE -r 48000 -c 1 -d 3 t.wav    # should produce audio
```

A **USB** interface needs no overlay — just set `"device": "hw:2,0"` in config.

---

## Install

```bash
sudo ./sensor-node/setup.sh          # installs Node 22, service user, /opt/corvus, systemd unit
sudoedit /opt/corvus/sensor-node/node.json   # device, nodeId, lat/lon, seatCode, supabase*
sudo systemctl enable --now corvus-sensor
journalctl -u corvus-sensor -f
```

For a fielded 24/7 node, also enable a **read-only root filesystem**
(`raspi-config` → Performance → Overlay File System). It makes the node
power-loss-tolerant and stops SD-card wear from 24/7 operation — the dominant
field-failure mode. The node writes only its config + enrollment session, so
overlayfs costs it nothing.

---

## Bench it without hardware

Feed a WAV through the exact capture path — no mic, no network:

```bash
node --experimental-strip-types sensor-node/node.mjs \
     --wav data/external/C3GD-Dataset/data/<some-shot>.wav
```

You'll see one `SHOT …` line per round (echoes and overlapping windows are
deduped into a single event), then the C2 push (which fails cleanly and buffers
for retry if no `supabaseUrl` is configured).

---

## How it behaves in the field

- **Latency is the product.** The first impulse of an event alerts immediately —
  we never wait to count rounds before speaking. Detection is fire-and-forget so
  a stalled HTTPS POST can never make the node deaf to the next round.
- **Rapid fire is one alert with a round count**, not one banner per shot. A
  dispatcher reading "SHOTS FIRED" three times can't tell an echo from three
  shooters; that's worse than useless under stress.
- **Outages are safe.** `detections` is `unique(org_id, node_id, seq)`, so a node
  that buffers through a network drop and re-sends dedups server-side instead of
  double-alerting.
- **A deaf sensor heals itself.** If the mic stops delivering samples, the node
  exits and systemd restarts it — a silently-dead sensor (the site believes it's
  covered) is the failure this prevents.
