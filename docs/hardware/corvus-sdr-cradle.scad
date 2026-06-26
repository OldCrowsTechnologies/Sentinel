// ============================================================
//  CORVUS SENTINEL — Rugged SDR Cradle (parametric)
//  Holds a Nooelec NESDR Nano 3 and straps/zip-ties to your phone
//  or rugged case. Open shell + USB cable strain relief so a knock
//  on the antenna won't snap the phone's USB-C port.
//
//  USE: install OpenSCAD (free, openscad.org). Open this file.
//  VERIFY the three dongle dims below with calipers, press F6 to
//  render, then File > Export > Export as STL.
//  PRINT: TPU 95A (best impact resistance) or PETG. 3+ walls,
//  ~30% infill, no supports needed (open top).
// ============================================================

/* ---- 1) MEASURE YOUR DONGLE, in mm (online specs CONFLICT: ~25 vs 17 long) ---- */
dongle_len = 25;   // SDR BODY length, EXCLUDING the USB + SMA connectors
dongle_wid = 17;   // SDR body width
dongle_thk = 8;    // SDR body thickness

/* ---- 2) FIT + RUGGEDNESS ---- */
fit_gap   = 0.6;   // total slide-in clearance (raise if tight, lower if loose)
wall      = 2.8;   // wall thickness (higher = tougher)
base      = 2.6;   // floor thickness
corner_r  = 3;     // outer corner radius
$fn       = 48;

/* ---- 3) CONNECTOR OPENINGS ---- */
sma_dia   = 9.5;   // antenna (SMA) connector clearance, -X end
usb_wid   = 13;    // USB-C plug + cable opening width, +X end
usb_hgt   = 7;     // USB-C plug + cable opening height

/* ---- 4) STRAP / ZIP-TIE MOUNT ---- */
plate_margin = 10; // flat margin around cradle holding the strap slots
slot_len     = 30; // strap/zip-tie slot length (along the body)
slot_wid     = 4.5;// strap/zip-tie slot width (strap thickness + a little)

/* ================= derived ================= */
cav_l = dongle_len + fit_gap;
cav_w = dongle_wid + fit_gap;
cav_h = dongle_thk + fit_gap;
crad_l = cav_l + 2 * wall;
crad_w = cav_w + 2 * wall;
crad_h = cav_h;
plate_l = crad_l + 2 * plate_margin;
plate_w = crad_w + 2 * plate_margin;

module rbox(l, w, h, r) {
  hull() for (x = [r, l - r], y = [r, w - r])
    translate([x, y, 0]) cylinder(h = h, r = r);
}

module cradle() {
  difference() {
    rbox(crad_l, crad_w, base + crad_h, corner_r);
    // dongle pocket — open top, no supports
    translate([wall, wall, base]) cube([cav_l, cav_w, crad_h + 1]);
    // SMA / antenna hole through the -X end wall
    translate([-1, crad_w / 2, base + cav_h / 2])
      rotate([0, 90, 0]) cylinder(h = wall + 2, d = sma_dia);
    // USB-C + cable opening through the +X end wall
    translate([crad_l - wall - 1, crad_w / 2 - usb_wid / 2, base])
      cube([wall + 2, usb_wid, usb_hgt]);
  }
}

module cable_relief() {
  // two posts just past the USB end: route the cable between them and
  // cinch a small zip-tie around it so bending load stays on the cradle.
  for (y = [crad_w / 2 - usb_wid / 2 - 3, crad_w / 2 + usb_wid / 2 - 0.5])
    translate([crad_l + 2.5, y, 0]) cube([3, 3.5, base + 8]);
}

difference() {
  union() {
    rbox(plate_l, plate_w, base, corner_r + 1);                 // baseplate
    translate([plate_margin, plate_margin, 0]) cradle();        // cradle
    translate([plate_margin, plate_margin, 0]) cable_relief();  // strain relief
  }
  // strap / zip-tie slots: one on each long side (wrap around the phone)
  for (sy = [plate_margin / 2 - slot_wid / 2,
             plate_w - plate_margin / 2 - slot_wid / 2])
    translate([plate_l / 2 - slot_len / 2, sy, -1])
      cube([slot_len, slot_wid, base + 2]);
}
