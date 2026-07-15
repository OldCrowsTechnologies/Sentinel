# Corvus Sentinel — Build List (post-demo backlog)

Running list of capabilities to build after the ECSO Blue Angels demo. Newest at
the top. Each item: what it is, why, the approach, and rough effort.

---

## 1. Multi-agency joint operations / geofenced mutual aid

**Status:** planned (post-demo)
**Raised:** during ECSO demo build, considering Santa Rosa SO as a second customer.

**The need.** Each agency is its own tenant and must stay isolated by default —
Escambia SO must not see Santa Rosa SO's routine activity, and vice versa (already
enforced by Row-Level Security). BUT in shared areas of responsibility (e.g.
Pensacola Beach during a joint event), deputies from both agencies need to see each
other's units and interact on one picture.

**Current state.**
- Hard per-agency isolation is already enforced in the database (RLS via
  `my_org_ids()`), so the "don't leak everyone's routine ops to each other" half is
  done the moment each agency is its own org.
- Cross-agency visibility is NOT built — isolation is currently total.

**Interim (works today, zero code):** the **Joint-Operation org** pattern. Stand up
a shared org (e.g. "Pensacola Beach Joint Ops"); participating deputies from both
agencies enroll into it for the event, and both commands log into its C2 with a
joint command code. Everyone in the joint op sees everyone in it; neither sees the
other agency's routine (home-org) activity. This is the classic task-force / unified-
command model and needs only seat codes. Use this for the first joint deployments.

**The real build (this item):** **geofenced mutual aid.** A standing sharing
agreement between adjacent agencies where any unit **physically inside a defined
shared zone** (the joint AO) automatically becomes visible to the partnering agency,
while everything outside the zone stays private — no manual "switch to joint mode."

Design sketch:
- A `sharing_agreements` table (org_a, org_b, shared polygon/zone, active window).
- A `zones` concept (GeoJSON polygon per shared AO).
- RLS extension: a command/deputy may read another org's `positions`/`detections`
  rows **only** when the row's lat/lon falls inside an active shared zone between the
  two orgs. (Postgres can do point-in-polygon in RLS via PostGIS, or a precomputed
  `in_zone` flag stamped on write.)
- Realtime: same filtering applied to the subscription payloads.
- C2 UI: shared units render with an agency tag/color so command can tell whose is
  whose; a toggle to show/hide partner units.

**Why it matters commercially:** "buy it for your county, and it still works when you
back up your neighbors" — a real differentiator when selling to adjacent SLTT
agencies. Turns each sale into a lever for the next.

**Effort:** medium. RLS + a sharing/zone layer + modest C2 UI. The data model already
supports multi-org membership, so much of the plumbing is reusable.
