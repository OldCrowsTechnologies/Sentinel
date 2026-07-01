# Corvus Sentinel — Field Recording Guide

Thanks for helping build the library. Every clip you send makes the detector
smarter and cuts false alarms. Don't overthink it — real audio beats perfect audio.

## The basics (applies to everything)
- **Phone is fine.** Voice-memo app, `.m4a` or `.wav`, any sample rate — we convert it.
- **One subject per file.** Don't mix a helicopter and a jet in the same clip.
- **Name it plainly** or just tell us in the message: what it is + where.
- **A few minutes each** is plenty. Variety (distance, power setting) beats length.
- **Do it lawfully.** Public or permitted/authorized areas only — never secure/restricted
  zones, and follow airline + airport policy. Skip anything with sensitive conversations
  (we only want machine/rotor sound, not people's voices).

## 1) Airport ambient  → the "quiet" that must NOT trigger
This is the environment Sentinel has to ignore. Your walk-around is perfect: open-air,
ground level, right on the ramp.
- Capture: jet idle/taxi, APU whine, tugs/ground power, wind across the tarmac.
- Label with the **airport code** (e.g., "KDFW ramp, gusty"). Different airports help a lot.
- Folder: `data/recordings/None/airport/<AIRPORT_CODE>/`

## 2) Helicopters  → a new "manned rotorcraft" class (not a threat)
Teaches Sentinel to say "that's a crewed helo, not a drone" instead of false-alarming.
- Capture variety: **spool-up/startup, hover, flybys at a few distances, shutdown.**
- Tell us the **make/model** per clip (Robinson R44, Bell 206, MD 500, Airbus H125, …).
- Folder: `data/recordings/Manned rotorcraft/<model>/`

## 3) Drones  → the actual targets
- **One make/model per clip**, and tell us exactly what it is (incl. homemade/FPV).
- Vary it: hover at ~5/10/20 ft, forward passes at part- and full-throttle.
- A little lead-in/out (powering up, landing) is useful.
- Folder: `data/recordings/<Make Model>/`  (e.g., `Autel EVO II/`)

## How to send
Zip them, drop a Google Drive link, or send individual files — whatever's easy. Include a
one-line note per file: **what + where** (and make/model for helos and drones).

*Corvus · Old Crows Wireless Solutions · We Always Find the Signal.*
