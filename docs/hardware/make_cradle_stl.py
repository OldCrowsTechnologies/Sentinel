"""
make_cradle_stl.py -- build the Corvus rugged SDR cradle as a printable STL.
Mirrors corvus-sdr-cradle.scad (sharp corners for robustness). Edit the dims to
match your caliper measurements, then: python make_cradle_stl.py
"""
import numpy as np
import trimesh
from trimesh.boolean import union, difference

# ---- 1) MEASURE YOUR DONGLE (mm) ----
dl, dw, dh = 25.0, 17.0, 8.0       # body length (excl. connectors), width, thickness
# ---- 2) FIT + STRENGTH ----
gap, wall, base = 0.6, 2.8, 2.6
# ---- 3) CONNECTORS ----
sma_dia, usbw, usbh = 9.5, 13.0, 7.0
# ---- 4) STRAP MOUNT ----
margin, slot_len, slot_wid = 10.0, 30.0, 4.5

cav_l, cav_w, cav_h = dl + gap, dw + gap, dh + gap
crad_l, crad_w, crad_h = cav_l + 2 * wall, cav_w + 2 * wall, cav_h
plate_l, plate_w = crad_l + 2 * margin, crad_w + 2 * margin
H = base + crad_h


def box(sx, sy, sz, cx, cy, cz):
    b = trimesh.creation.box(extents=[sx, sy, sz])
    b.apply_translation([cx, cy, cz])
    return b


cx0, cy0 = margin, margin

solids = [
    box(plate_l, plate_w, base, plate_l / 2, plate_w / 2, base / 2),          # baseplate
    box(crad_l, crad_w, H, cx0 + crad_l / 2, cy0 + crad_w / 2, H / 2),        # cradle block
]
# cable strain-relief posts past the USB end
for dy in (-(usbw / 2) - 1.5, (usbw / 2) + 1.5):
    solids.append(box(3, 3.5, base + 8, cx0 + crad_l + 3, cy0 + crad_w / 2 + dy, (base + 8) / 2))

body = union(solids, engine="manifold")

cuts = []
# dongle pocket (open top)
cuts.append(box(cav_l, cav_w, crad_h + 2, cx0 + wall + cav_l / 2, cy0 + wall + cav_w / 2, base + (crad_h + 2) / 2))
# SMA hole through -X wall (cylinder along X)
cyl = trimesh.creation.cylinder(radius=sma_dia / 2, height=wall + 4)
cyl.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
cyl.apply_translation([cx0 + wall / 2, cy0 + crad_w / 2, base + cav_h / 2])
cuts.append(cyl)
# USB-C opening through +X wall
cuts.append(box(wall + 4, usbw, usbh, cx0 + crad_l - wall / 2, cy0 + crad_w / 2, base + usbh / 2))
# strap / zip-tie slots, one per long side
for sy in (margin / 2, plate_w - margin / 2):
    cuts.append(box(slot_len, slot_wid, base + 4, plate_l / 2, sy, base / 2))

result = difference([body, union(cuts, engine="manifold")], engine="manifold")
result.export("corvus-sdr-cradle.stl")
print(f"wrote corvus-sdr-cradle.stl  ({plate_l:.1f} x {plate_w:.1f} x {H:.1f} mm, "
      f"{len(result.vertices)} verts, watertight={result.is_watertight})")
