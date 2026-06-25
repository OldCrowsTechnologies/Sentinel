"""Generate the Corvus Sentinel spec sheet PDF (for EOD tech review / testing)."""
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
)

NAVY = colors.HexColor("#1A2332")
PANEL = colors.HexColor("#22304A")
CYAN = colors.HexColor("#00C2C7")
TEAL = colors.HexColor("#0D6E7A")
GOLD = colors.HexColor("#B8922A")
LIGHT = colors.HexColor("#F4F6F8")
MUTED = colors.HexColor("#5A6675")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Corvus-Sentinel-SpecSheet.pdf")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], textColor=NAVY, fontSize=15,
                    spaceBefore=12, spaceAfter=4)
BODY = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5, leading=13,
                      textColor=colors.HexColor("#222831"))
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=12, bulletIndent=2, spaceAfter=2)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=8, textColor=MUTED, leading=11)
WHITE_TITLE = ParagraphStyle("WT", parent=styles["Title"], textColor=LIGHT, fontSize=26,
                             leading=28, spaceAfter=0)
WHITE_SUB = ParagraphStyle("WS", parent=styles["Normal"], textColor=CYAN, fontSize=11,
                           leading=14)
WHITE_SMALL = ParagraphStyle("WSM", parent=styles["Normal"], textColor=LIGHT, fontSize=8.5,
                             leading=11)


def band(flow):
    """Wrap flowables in a full-width navy band."""
    t = Table([[flow]], colWidths=[7.0 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    return t


def chip_table(rows, c1=GOLD):
    t = Table(rows, colWidths=[1.5 * inch, 5.0 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TEXTCOLOR", (0, 0), (0, -1), TEAL),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#DDE3EA")),
    ]))
    return t


def box(flow, border=GOLD, bg=colors.HexColor("#FBF6E9")):
    t = Table([[flow]], colWidths=[6.7 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 1, border),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


doc = SimpleDocTemplate(OUT, pagesize=letter, topMargin=0.5 * inch,
                        bottomMargin=0.5 * inch, leftMargin=0.75 * inch,
                        rightMargin=0.75 * inch, title="Corvus Sentinel Spec Sheet")
S = []

# Header band
hdr = [
    [Paragraph("CORVUS&nbsp;SENTINEL", WHITE_TITLE)],
    [Paragraph("DETECT. CLASSIFY. ALERT. &nbsp;|&nbsp; On-device acoustic drone detection", WHITE_SUB)],
    [Paragraph("Old Crows Wireless Solutions (OCWS) &middot; Sideloadable Android &middot; Offline &middot; No extra hardware required", WHITE_SMALL)],
]
ht = Table(hdr, colWidths=[6.7 * inch])
ht.setStyle(TableStyle([("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 2)]))
S.append(band(ht))
S.append(Spacer(1, 10))

# What it is
S.append(Paragraph("WHAT IT IS", H1))
S.append(HRFlowable(width="100%", thickness=1.5, color=GOLD, spaceAfter=6))
S.append(Paragraph(
    "Corvus Sentinel turns a phone or tablet into a passive, listen-only early-warning "
    "sensor for drones. It detects rotor acoustic signatures through the device microphone, "
    "classifies them on-device (no internet, no data leaving the device), tracks contacts, "
    "and briefs the operator. It is designed for the operator who needs awareness now on gear "
    "they already carry &mdash; not a six-figure fixed radar installation.", BODY))
S.append(Spacer(1, 8))

# Capabilities
S.append(Paragraph("CURRENT CAPABILITIES", H1))
S.append(HRFlowable(width="100%", thickness=1.5, color=GOLD, spaceAfter=6))
caps = [
    [Paragraph("Detect &amp; classify", BODY), Paragraph("Acoustic classifier (None / Skydio X2 / DJI Phantom / Parrot Anafi / Unknown), on-device.", BODY)],
    [Paragraph("Homemade flag", BODY), Paragraph("Open-set logic flags a contact that is clearly a drone but matches no library profile as <b>&ldquo;possible homemade / unknown build&rdquo;</b> &mdash; the threat a database-only detector misses.", BODY)],
    [Paragraph("Range", BODY), Paragraph("Loudness-based range <b>band</b> (e.g. ~150&ndash;250 ft). Single mic = <b>no bearing</b>; a manual rotate-to-peak aid gives coarse direction.", BODY)],
    [Paragraph("Tag &amp; report", BODY), Paragraph("GPS-stamped, timestamped intercepts and an exportable After-Action Report.", BODY)],
    [Paragraph("Background", BODY), Paragraph("Keeps monitoring when minimized; heads-up notification on every new contact.", BODY)],
    [Paragraph("Remote ID (RF)", BODY), Paragraph("Receives drone Remote ID over Bluetooth &mdash; drone position <b>and operator/pilot location</b> &mdash; for compliant drones.", BODY)],
    [Paragraph("Tactical map", BODY), Paragraph("Offline-capable map: operator, Remote ID drone/pilot pins, and acoustic range rings.", BODY)],
    [Paragraph("Learning library", BODY), Paragraph("Captures unknown/homemade contacts for labeling and retraining &mdash; the system improves from field encounters.", BODY)],
]
S.append(chip_table(caps))
S.append(Spacer(1, 8))

# Honest limitations
S.append(Paragraph("HONEST LIMITATIONS (read before testing)", H1))
S.append(HRFlowable(width="100%", thickness=1.5, color=TEAL, spaceAfter=6))
lim = (
    "&bull; The bundled model is trained on <b>physically-grounded synthetic</b> signatures. "
    "Real-world accuracy is <b>not yet validated</b> &mdash; that is exactly what this testing is for.<br/>"
    "&bull; Acoustic detection wins on cost/accessibility, not range/precision; it does not replace radar/RF.<br/>"
    "&bull; <b>No bearing or elevation</b> from a single mic; range is a coarse estimate.<br/>"
    "&bull; Remote ID only sees <b>compliant</b> drones that broadcast it; homemade/hostile drones will not appear there (caught acoustically).<br/>"
    "&bull; External RF (LoRa / ExpressLRS / control-link) detection needs an add-on SDR module &mdash; scaffolded but disabled until hardware."
)
S.append(box(Paragraph(lim, BODY), border=TEAL, bg=colors.HexColor("#EAF3F4")))
S.append(Spacer(1, 8))

# The ask
S.append(Paragraph("WHAT WE'RE ASKING YOU TO TEST", H1))
S.append(HRFlowable(width="100%", thickness=1.5, color=GOLD, spaceAfter=6))
ask = (
    "&bull; Install the APK (sideload, no account) and confirm it runs: mic permission, level meter, START.<br/>"
    "&bull; Fly known drones at marked distances &mdash; does it fire correctly, and does &ldquo;None&rdquo; hold in quiet?<br/>"
    "&bull; Note detection rate, false positives, and effective range &mdash; help us build a real confusion matrix.<br/>"
    "&bull; Try the <b>homemade flag</b> with a non-standard / FPV build if available.<br/>"
    "&bull; With a recent DJI, check <b>Remote ID</b> shows drone + operator location.<br/>"
    "&bull; Verify <b>background</b> detection + notifications with the screen off.<br/>"
    "&bull; Capture clips of anything interesting &mdash; they feed retraining."
)
S.append(box(Paragraph(ask, BODY), border=GOLD))
S.append(Spacer(1, 10))

# Roadmap + footer
S.append(Paragraph("ROADMAP", H1))
S.append(HRFlowable(width="100%", thickness=1.5, color=GOLD, spaceAfter=6))
S.append(Paragraph(
    "External RF module (SDR) for LoRa/ExpressLRS &amp; control-link detection &middot; "
    "stereo/array direction-finding &middot; real-data retrained model &middot; "
    "ATAK / Cursor-on-Target output &middot; rugged tactical-phone (ATAC-class) integration.", BODY))
S.append(Spacer(1, 14))
S.append(HRFlowable(width="100%", thickness=1, color=MUTED, spaceAfter=6))
S.append(Paragraph(
    "Corvus &middot; Old Crows Wireless Solutions &middot; We Always Find the Signal. &nbsp;|&nbsp; "
    "Contact: Joshua &middot; joshua@oldcrowswireless.com &nbsp;|&nbsp; "
    "Pre-release engineering build &mdash; for authorized evaluation only.", SMALL))

doc.build(S)
print("wrote", OUT, "(%.1f KB)" % (os.path.getsize(OUT) / 1024))
