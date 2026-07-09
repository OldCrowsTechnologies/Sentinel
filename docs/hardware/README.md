# Corvus Sentinel — Rugged SDR Cradle (3D print)

A tough cradle that holds the **Nooelec NESDR Nano 3** SDR and lashes to your
phone or rugged case, with **USB-cable strain relief** so a knock on the antenna
can't pry/snap the phone's USB-C port (the real failure mode).

## Files
**Universal strap cradle** (fits any phone):
- **`corvus-sdr-cradle.stl`** — ready to slice & print (51 × 43 × 11 mm).
- **`corvus-sdr-cradle.scad`** — parametric source (OpenSCAD). Edit dimensions, F6, Export STL.
- **`make_cradle_stl.py`** — regenerates the STL from Python (`pip install trimesh manifold3d`).

**Magnetic puck** (for MagSafe-style cases, e.g. UAG Metropolis LT w/ magnet):
- **`corvus-magnet-puck-s24u.stl`** + **`make_magnet_puck.py`** — 60 mm disc, SDR cradle
  on the front, lanyard hole. Stick a **56 mm adhesive MagSafe ring** (or a steel MagSafe
  plate, ~$6) to the flat back; it then snaps to the case's magnet. Print FLAT (back on
  bed), cradle up — no supports. Run a thin lanyard/zip-tie through the hole as drop insurance.

**Phone-specific "boot" mounts** (grip the bottom of the phone, SDR on the back):
- **`corvus-mount-s24-ultra.stl`** + **`preview-s24-ultra.png`** — Galaxy S24 Ultra (79.0 × 8.6 mm grip).
- **`corvus-mount-s26-ultra.stl`** + **`preview-s26-ultra.png`** — Galaxy S26 Ultra (78.1 × 7.9 mm grip).
- **`corvus-mount-s26-ultra-pelican.stl`** + **`preview-s26-ultra-pelican.png`** — S26 Ultra
  **inside a Pelican Protector-class case** (82.5 × 13.0 mm cased grip, outer boot 89.7 × 20.2 × 34 mm).
  The 82.5 × 13.0 is an **estimate** (bare + ~2.2 mm/side + ~5 mm back protrusion) — see below.
- **`make_phone_mounts.py`** — regenerates all STLs + previews.
- IMPORTANT: bare-phone cavities are sized for the **bare phone + 1.2 mm**. The Pelican
  variant is sized for the **cased** outer dimensions. Either way, **caliper-measure**
  your actual grip target and set the `(width, thickness)` in `PHONES` before a final print
  (a 0.5 mm error is snug-vs-useless). **Print in TPU** so it flexes on without stressing anything.

## ⚠️ Verify the dongle size FIRST
Published specs for the Nano 3 **conflict** (~17 mm vs ~25 mm body length). Before
printing, **measure your dongle with calipers** (length excluding the USB + SMA
connectors, width, thickness) and set `dl, dw, dh` in either file, then re-export.
A 0.5 mm error is the difference between snug and useless. The STL here uses
25 × 17 × 8 mm with 0.6 mm clearance.

## Print settings
- **Material: TPU 95A** for best impact resistance (ideal for "won't break"), or
  **PETG** for a stiffer/tougher-than-PLA shell. Avoid plain PLA (brittle, softens in a hot truck/pack).
- **No supports** — the pocket is open-top. Print the **flat base on the bed**.
- ~**4 perimeters / walls**, **30–40% infill**, 0.2 mm layers.

## Assembly
1. Drop the SDR into the pocket; antenna (SMA) exits the round hole, USB-C exits the slot.
2. Route the USB-C cable between the two **strain-relief posts** and cinch a small
   zip-tie around it — now cable bending load goes to the cradle, not the phone port.
3. Lash to the phone/case: run a **zip-tie or velcro strap through each side slot**
   and around the phone (or onto MOLLE / an arm mount).

## Notes & next step
- This is a **phone-agnostic strap cradle** on purpose — it fits any phone/case.
- For a **phone-specific clamshell** (clips onto your exact device, no straps),
  tell me your phone model + a few measurements and I'll generate that variant.
- Antenna stays external (it must, for reception). Keep ~the included whip clear of your hand/body.
