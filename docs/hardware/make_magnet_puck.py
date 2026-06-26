"""
make_magnet_puck.py -- magnetic SDR puck for a MagSafe-style case (e.g. UAG
Metropolis LT w/ magnet, S24 Ultra). A printed disc: SDR cradle on the FRONT,
flat BACK where you stick a 56 mm adhesive MagSafe magnet ring (or steel plate)
so it snaps to the case's magnet. Lanyard hole = drop insurance.

Run: python make_magnet_puck.py   (needs trimesh manifold3d numpy)
Print FLAT (back on bed), cradle opening up -> no supports. TPU or PETG.
"""
import numpy as np
import trimesh
from trimesh.boolean import union, difference

# Puck
PUCK_DIA, BASE_T = 60.0, 3.2        # 60 mm disc; 56 mm MagSafe ring fits on the back
# Nooelec NESDR Nano 3 (caliper-verify; specs conflict)
DL, DW, DH = 25.0, 17.0, 8.0
SG, WALL = 0.8, 2.6
SMA_DIA, USBW, USBH = 9.5, 13.0, 7.0
LANYARD_DIA = 5.0


def box(sx, sy, sz, cx, cy, cz):
    b = trimesh.creation.box(extents=[sx, sy, sz])
    b.apply_translation([cx, cy, cz])
    return b


def cyl(d, h, cx, cy, cz, axis="z"):
    c = trimesh.creation.cylinder(radius=d / 2, height=h, sections=64)
    if axis == "x":
        c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0]))
    c.apply_translation([cx, cy, cz])
    return c


cl, cw, ch = DL + SG, DW + SG, DH + SG          # cavity
col, cow = cl + 2 * WALL, cw + 2 * WALL          # cradle outer (long axis = x)

solids = [cyl(PUCK_DIA, BASE_T, 0, 0, BASE_T / 2)]                 # disc
solids.append(box(col, cow, ch, 0, 0, BASE_T + ch / 2))           # cradle block
# cable strain-relief posts past the USB (+x) end
for dy in (-(USBW / 2) - 1.5, (USBW / 2) + 1.5):
    solids.append(box(3, 3.5, BASE_T + 7, col / 2 + 2.5, dy, (BASE_T + 7) / 2))

cuts = []
# SDR pocket (open top), floor = disc top
cuts.append(box(cl, cw, ch + 2, 0, 0, BASE_T + (ch + 2) / 2))
# SMA / antenna hole through -x wall
cuts.append(cyl(SMA_DIA, WALL + 4, -(col / 2 - WALL / 2), 0, BASE_T + ch / 2, axis="x"))
# USB-C opening through +x wall
cuts.append(box(WALL + 4, USBW, USBH, col / 2 - WALL / 2, 0, BASE_T + USBH / 2))
# lanyard hole through the disc rim
cuts.append(cyl(LANYARD_DIA, BASE_T + 2, 0, PUCK_DIA / 2 - 5, BASE_T / 2))

body = union(solids, engine="manifold")
res = difference([body, union(cuts, engine="manifold")], engine="manifold")
res.export("corvus-magnet-puck-s24u.stl")
print(f"puck dia {PUCK_DIA} mm, watertight={res.is_watertight} -> corvus-magnet-puck-s24u.stl")
