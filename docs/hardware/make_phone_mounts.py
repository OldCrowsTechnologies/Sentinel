"""
make_phone_mounts.py -- phone-specific "boot" mounts that grip the bottom of a
Galaxy S24 Ultra / S26 Ultra and hold the Nooelec NESDR Nano 3 SDR on the back
(rigidly, by the USB-C port = built-in strain relief). Exports STLs + preview PNGs.

Run: python make_phone_mounts.py   (needs: trimesh manifold3d matplotlib numpy)
NOTE: cavity is sized for the BARE phone + 1.2 mm clearance. Add your case
thickness to PHONES below (or bump `clr`) if you run a case.
"""
import numpy as np
import trimesh
from trimesh.boolean import union, difference
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

# Phone (name, width, thickness) in mm
PHONES = [
    ("s24-ultra", "Galaxy S24 Ultra", 79.0, 8.6),
    ("s26-ultra", "Galaxy S26 Ultra", 78.1, 7.9),
]

# Nooelec NESDR Nano 3 (caliper-verify; specs conflict)
DL, DW, DH = 25.0, 17.0, 8.0
SG, SW, SFLOOR = 0.8, 2.6, 2.4


def box(sx, sy, sz, cx, cy, cz):
    b = trimesh.creation.box(extents=[sx, sy, sz])
    b.apply_translation([cx, cy, cz])
    return b


def build_boot(pw, pt):
    clr, wall, boot_h, lip, bt, usbw = 1.2, 3.0, 34.0, 10.0, 3.0, 24.0
    pwc, ptc = pw + clr, pt + clr
    ow, od = pwc + 2 * wall, ptc + 2 * wall

    solids = [box(ow, od, boot_h, ow / 2, od / 2, boot_h / 2)]
    cuts = []
    # phone cavity (open top)
    cuts.append(box(pwc, ptc, boot_h + 2, wall + pwc / 2, wall + ptc / 2, bt + (boot_h + 2) / 2))
    # short front lip: remove front wall above `lip`
    cuts.append(box(pwc + 2, wall + 2, boot_h, wall + pwc / 2, wall + ptc + wall / 2, lip + boot_h / 2))
    # USB-C access cutout in the bottom, under the phone only
    cuts.append(box(usbw, ptc + 2, bt + 2, ow / 2, wall + ptc / 2, bt / 2))

    # SDR holder fused to the back wall (back wall spans y in [0, wall])
    hx = ow / 2
    by_ext = wall + (DH + SG + SW)
    by_center = (-(DH + SG + SW) + wall) / 2
    holder_z = DL + SG + SFLOOR
    solids.append(box(DW + SG + 2 * SW, by_ext, holder_z, hx, by_center, holder_z / 2))
    # SDR pocket (open top), between the back wall (+y face) and the holder's -y wall
    cuts.append(box(DW + SG, DH + SG, DL + SG + 2, hx, -(DH + SG) / 2, SFLOOR + (DL + SG + 2) / 2))

    body = union(solids, engine="manifold")
    return difference([body, union(cuts, engine="manifold")], engine="manifold"), dict(
        ow=ow, od=od, boot_h=boot_h, wall=wall, ptc=ptc, pwc=pwc, bt=bt, hx=hx
    )


def add_mesh(ax, mesh, color, alpha=1.0, edge=None):
    tris = mesh.triangles
    pc = Poly3DCollection(tris, facecolors=color, edgecolors=edge or "none",
                          linewidths=0.1, alpha=alpha)
    ax.add_collection3d(pc)


def render(name, label, pw, pt, mesh, g):
    fig = plt.figure(figsize=(7, 7), facecolor="#1A2332")
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor("#1A2332")
    add_mesh(ax, mesh, "#9aa6b2", 1.0, "#3a4a5a")  # the printed mount

    # translucent phone slid into the boot
    phone_h = 150
    phone = box(pw, pt, phone_h, g["wall"] + pw / 2, g["wall"] + pt / 2, g["bt"] + phone_h / 2)
    add_mesh(ax, phone, "#00C2C7", 0.18)

    # SDR sitting in the back holder
    sdr = box(DW, DH, DL, g["hx"], -(DH) / 2, SFLOOR + DL / 2)
    add_mesh(ax, sdr, "#111820", 1.0, "#00C2C7")

    R = max(g["ow"], phone_h)
    ax.set_xlim(0, g["ow"]); ax.set_ylim(-20, g["od"]); ax.set_zlim(0, phone_h)
    ax.set_box_aspect((g["ow"], g["od"] + 20, phone_h))
    ax.view_init(elev=20, azim=-58)
    ax.set_axis_off()
    ax.set_title(f"Corvus Mount — {label}\n{pw} x {pt} mm body grip",
                 color="#F4F6F8", fontsize=13, pad=2)
    fig.savefig(f"preview-{name}.png", dpi=130, bbox_inches="tight", facecolor="#1A2332")
    plt.close(fig)


for name, label, pw, pt in PHONES:
    mesh, g = build_boot(pw, pt)
    mesh.export(f"corvus-mount-{name}.stl")
    render(name, label, pw, pt, mesh, g)
    print(f"{name}: STL {g['ow']:.1f}x{g['od']:.1f}x{g['boot_h']:.1f}mm  "
          f"watertight={mesh.is_watertight}  -> corvus-mount-{name}.stl + preview-{name}.png")
