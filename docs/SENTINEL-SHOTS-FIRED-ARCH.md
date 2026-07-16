# Sentinel Shots Fired — Reference Architecture (sensing → mesh → fusion → C2)

> How a gunshot becomes a located alert. This doc pins the boundary between **what
> P1 ships** and **what P2/P3 add**, so the capability claim stays honest when it
> gets pitched. Companion to [SENTINEL-SHOTS-FIRED.md](SENTINEL-SHOTS-FIRED.md)
> (thread), [SENTINEL-HARDWARE-BOM.md](SENTINEL-HARDWARE-BOM.md) (parts), and
> [PHASE3-MESH.md](PHASE3-MESH.md) (the mesh/fusion design this reuses).

---

## 0. The node contract

A node does **one** job: detect an impulse, decide it's gunshot-shaped, and report.
It does **not** triangulate, does **not** talk to other nodes, does **not** classify
caliber (P1). Dumb, cheap, reliable. Detection is [`lib/shotDetect.ts`](../lib/shotDetect.ts)
(97.8% recall on 8,015 real shots). Everything smarter happens **downstream, on the
fused set of reports** — never on the node.

A single node **cannot** know where the shooter is. It knows only *"I heard a
gunshot, at my position, at this time, this loud."* Localization is an emergent
property of several nodes' reports combined — not something a node computes.

---

## 1. The report

One compact `ContactReport` (≤40 B packed for LoRa; JSON is the logical shape),
reusing [`lib/meshTypes.ts`](../lib/meshTypes.ts) field-for-field:

```
nodeId · seq · t(timestamp) · lat/lon (the NODE's own position) · conf ·
peak_db · shot_count · kind='gunshot' · label('Unknown firearm' until P2)
```

That's the whole assertion. Note what's absent: any statement about the shooter's
location. That's downstream.

---

## 2. Topology — leaves + gateways, fixed + mobile

- **Leaf node** — detect + report over LoRa. Cheap: Pi + mic + LoRa radio + battery.
  No internet uplink of its own.
- **Gateway node** — a leaf that *also* has an internet uplink (cellular or wired)
  and **relays the mesh's reports to C2**. A gateway is just a leaf with a SIM.
- **Fixed leaves** (school ceilings) hop to a gateway. A site keeps **≥1 always-present
  fixed gateway** so it's covered before any deputy arrives.
- **Every cruiser is a gateway.** A cruiser already carries cellular (its only uplink)
  and GPS; adding the same LoRa radio the leaves use makes it a **mobile gateway** by
  definition — no new device, just don't disable the relay role.
- **Dynamic join.** A unit entering LoRa range of a mesh joins it (**authenticated** —
  see §7). A school's 10-node mesh gains 3 gateways the moment 3 cruisers arrive:
  redundant uplinks + mobile TDOA contributors (§5).

---

## 3. The flow

```
 leaf ─┐
 leaf ─┼─(LoRa)─► GATEWAY ─(HTTPS over cellular/wired)─► C2 ─► dashboard / dispatch
 leaf ─┘             ▲
 cruiser gateway ────┘  (also relays; also a sensor)
```

**Fusion is centralized** — at the gateway or at C2 — **not peer-to-peer among the
nodes.** Three nodes hearing one shot send three independent reports; the fusion step
collapses them into **one located event**. Why centralized: it keeps nodes dumb, it
doesn't burn LoRa airtime on node-to-node chatter, and a node dropping out just thins
the picture instead of breaking the solve.

The node can't POST HTTPS over LoRa (LoRa isn't IP), so the gateway runs the relay:
receive LoRa reports → fuse/dedup → forward to Supabase. The node's *detection* logic
is unchanged from [`sensor-node/`](../sensor-node/); only the transport swaps.

---

## 4. Localization ladder — the honest capability line

The precision of the located event depends on how much has been built. Each rung is
strictly more than the last; **each is already useful.**

| Output | Needs | Phase |
|---|---|---|
| **"Heard by nodes 1, 4, 6"** → shot is in the area those three cover | known node positions only | **P1 (~now)** |
| **A region / uncertainty ellipse** | range-only fusion + per-device range calibration | **P2** (Method A) |
| **A precise GPS point** | TDOA + sub-ms shared time (§5) | **P3** (Method B) |

The coarse rung is not a consolation prize — *"shots fired, three sensors in the
C-wing lit up simultaneously,"* delivered in ~1–2 s, is faster and more specific than
a 911 call. **Ship that first; don't delay it chasing the pinpoint.**

---

## 5. Time sync — why MOBILE nodes triangulate better than indoor ones

TDOA (the precise point) needs a **sub-millisecond shared clock** across contributing
nodes — 1 ms of skew ≈ 0.34 m of error. GPS carries *time*, not just position. That
splits the fleet cleanly:

- **Fixed indoor node** — no sky view → no GPS → no free time base. Contributes
  **detect + range-only** (coarse/region). Making it TDOA-capable would need a mesh or
  PTP time-distribution scheme (hard, and Phase-3).
- **Roof + mobile (cruiser) node** — sees the sky → GPS gives position **and** a sub-ms
  clock for free → **TDOA-capable.**

The consequence is counterintuitive and it's the strength of the mobile idea: **the
moving units are the strongest TDOA contributors**, because they each self-solve the
time sync the indoor nodes can't. Three cruisers converging on an incident with **no
installed nodes at all** can triangulate it among themselves.

**GPS-denied** (jammed/contested): units lose position *and* time → fall back to coarse
localization, **labeled degraded** — never a silent bad pin. (Same discipline as the
acoustic range band and the PHASE3-MESH degraded mode.)

---

## 6. Mobile mesh — coverage travels with the deputies

This is the capability ShotSpotter structurally **cannot** have. They are fixed
infrastructure sold by the square mile; coverage exists only where a city paid to
install. Here, coverage follows the response:

- **Triangulation with zero fixed infrastructure** — 3 cruisers around an incident,
  each GPS-positioned and GPS-timed, triangulate it themselves.
- **Redundant uplink on arrival** — if the building's comms were cut before an attack
  (a real pre-attack pattern), the responding cruisers **restore the path to C2**.
- **One shared offline incident picture** — deputies see the fused picture locally and
  **converge on the target**, even with no internet in the loop.

**Honest limits:**
- **Geometry (GDOP).** Units clustered on one approach → a smeared ellipse, not a
  point. Accuracy depends on how the units happen to be spread — which is response
  luck, not a setting. Show the ellipse; never a false pin.
- **Events, not a track.** You get a *sequence of located shot-events*, not a live
  continuous track of a moving shooter.

---

## 7. Security — the #1 new requirement (the target is a dispatch system)

A mesh any $20 LoRa radio can join is a **spoofing and denial-of-service vector
straight into dispatch** — a hostile actor injecting "SHOTS FIRED," replaying old
reports, or jamming the channel. Non-negotiable before any field deployment:

- **Authenticated membership** — agency pre-shared key / per-node credential; only
  enrolled nodes' reports are accepted, and *joins are authenticated.*
- **Signed / MAC'd reports** — a foreign radio can't forge or replay a detection.
- This is the **largest single piece of new code** in the mesh layer and it **gates
  field use.** (Bounded, well-understood crypto — but not optional.)

---

## 8. Fusion + dedup details

- **Heterogeneous by design.** The fusion engine consumes a *likelihood contribution*
  per node — range → annulus, bearing → wedge, TDOA → hyperbola — so indoor range-only
  nodes and GPS-timed mobile nodes combine in **one solve**. This is exactly the
  [`lib/meshFusion.ts`](../lib/meshFusion.ts) design from PHASE3-MESH; **reuse, not new.**
- **Two dedup layers.** A node's own resends dedup on `(org, node, seq)` — *already
  built* ([migration 0001](../supabase/migrations/0001_c2_core.sql)). A **fused event**
  needs its **own** key so the same event arriving at C2 via *multiple gateways* lands
  as one row, not three. *(New — build with fusion.)*

---

## 9. Tenant / who-gets-the-alert

When one agency's cruisers join another tenant's mesh (SO units at a school-district
site), **both** C2s should see the incident. Single-tenant routing is handled by the
seat-code/org model ([`c2.mjs`](../sensor-node/c2.mjs)); cross-tenant, co-located
visibility routes through the **geofenced mutual-aid / joint-ops** work
([SENTINEL-BUILD-LIST.md](SENTINEL-BUILD-LIST.md) item 2). Not a blocker for the mesh
mechanics — it's where "who sees it" is answered.

---

## 10. What's built vs not — the phase line

| Piece | Status |
|---|---|
| Single-node detect + report | **BUILT** — `lib/shotDetect.ts`, `sensor-node/` |
| Node → C2 over HTTPS (cellular/wired) | **BUILT** — `sensor-node/c2.mjs` |
| LoRa transport + gateway relay | Architected (PHASE3-MESH Tier-L), **not built** |
| Authenticated mesh membership | **Design — required before any field use (§7)** |
| Cross-node fusion + fused-event dedup (coarse) | Architected (`meshFusion` seam) |
| Range-only region (Method A) | P2 |
| Caliber classifier | P2, **not built** (detector only) |
| TDOA precise point + time sync | P3 |
| Dynamic cruiser join / mobile mesh | **this doc** — new |

---

## 11. Honesty guardrails (carry into every pitch)

- **Coarse localization ships first.** "Which nodes heard it" is already better than
  911 — pitch *that*. The GPS point is P3; **do not claim it before TDOA + time sync
  exist.**
- **Caliber is "class + confidence," P2** — never "it's a .223" until validated.
- **Mobile triangulation accuracy depends on cruiser geometry** — always show the
  uncertainty ellipse, never a bare pin.
- **GPS-denied = labeled degraded mode**, never a silent bad position.
- **The node never records audio** — RAM ring buffer, event-only transmit. (Legal +
  the ShotSpotter wiretap fight; see SENTINEL-SHOTS-FIRED.md §10.)
