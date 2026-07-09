# Art Brief — The Pale Chorus (Corvus Protocol enemy cast)

**Project:** Corvus Protocol: The Omen Wars (in-house)
**For:** Meshy 3D generation → Blender post → runtime `.glb`
**Pipeline parity:** mirrors the Rookery bird pipeline (`Rookery/scripts/birds/README.md`) — same tool chain, settings, and Blender post so the enemies sit in the same art world as the Murder.

---

## 1. The idea (why they look the way they do)

The Murder — Corvus, Sage, Pip, Mira — are **dark, solid, circuit-lit ravens**: black feathers, gold beaks, emissive per-character traces (cyan / violet / green / gold). The **Pale Chorus is their photographic negative.** Where the Murder are matter, the Chorus is absence: **spectral, pale, translucent raven-wraiths** that drift the summoning path toward the core.

Design rule of thumb for every model below: *take a raven and drain it.* Pale bone-white and cold blue instead of black; hollow glowing sockets instead of sharp eyes; dissolving wisps instead of clean feather edges; a faint **Pale-Chorus violet** (#B79CFF) bleeding through instead of the Murder's confident trace colors. No circuitry — the Chorus predates the machine. Their "traces" are **rune-scars**: faint carved white lines, not tech.

They should read instantly at 40–60 px on a phone board, silhouettes first.

---

## 2. Shared style spec (applies to ALL models)

| Attribute | Spec |
|---|---|
| Form language | Raven/corvid fused with a hooded funeral shroud; skeletal-spectral |
| Body color | Pale bone `#EAF4F9` → cold slate `#A6C6D6`, low saturation |
| Translucency | Semi-transparent, subsurface glow, edges fraying into wisps |
| Accent / energy | Pale-Chorus violet `#B79CFF` in eyes, rune-scars, phase energy |
| Eyes | Hollow sockets with an inner emissive glow — **no pupils** (void with a spark) |
| Beak | Ghostly bone, NOT gold (gold beaks belong to the Murder) |
| Surface detail | Faint carved **rune-scar** lines, cold white emissive — never circuitry |
| Silhouette | Must be readable as a raven-wraith at thumbnail size |
| Mood | Mournful, patient, wrong — a funeral that walks |

**Meshy generation settings (identical to the birds):**
Newest model · **Topology: Quad** · **Polycount: Medium (~30k)** · **Texture: On (PBR)** · **Symmetry: Auto**. Generate → Texture → pick the best raven-wraith likeness of the 4 candidates.

> Meshy bakes glow/translucency into the albedo (won't self-illuminate, won't be truly transparent). That's expected — the **Blender post step** adds emission on eyes/rune-scars and a translucent + dissolve material, exactly like the birds' process step adds emissive traces.

---

## 3. The roster

Four field variants + one boss (matches the handoff's "4 ghost variants + Whisper boss").

### 3.1 `wisp` — Pale Whisper  *(fast · fragile · trash)*
The basic Chorus unit. Small, quick, barely-there. A hand-sized tattered raven ghost, more smoke than body, one flickering socket, a comet-tail of dissolving wisps. Comes in numbers.
- **Size on board:** smallest. **Role:** speed, swarm.

### 3.2 `chorister` — Chorister  *(standard · the singer)*
The Chorus's baseline soldier. A mid-size shrouded raven-wraith, beak parted mid-hymn, faint concentric "sound-ring" ripples at the throat. Hooded shoulders of layered spectral feathers.
- **Size on board:** medium. **Role:** the bread-and-butter enemy.

### 3.3 `keener` — Keener  *(tall · wailing)*
A mourner stretched too long. Elongated neck and beak, thin, a wide silent-scream gape, trailing veil. Reads as unsettling verticality among the rounder wisps.
- **Size on board:** tall/thin. **Role:** visual variety, later waves.

### 3.4 `husk` — Husk  *(heavy · tank)*
A drowned thing. Dense, hunched, matted spectral plumage clotted heavy, sockets sunk deep, dragging tattered wings like wet cloth. Slow and hard to kill.
- **Size on board:** bulkiest. **Role:** damage sponge.

### 3.5 `whisper_boss` — Whisper  *(BOSS · two-phase, wave 15)*
The Chorus given a crown. A towering wraith-king: great tattered wings, **twin violet sockets**, a crown of bone/antler spikes, a train of veiling feathers. Regal, patient, wrong.
- **Phase I:** composed, slow, wings folded.
- **Phase II (≤50% HP):** crown splits, violet energy floods the rune-scars, wings flare, silhouette turns jagged and faster. Author as a **blend-shape / material state** off the Phase-I mesh so it's one model, two looks.
- **Size on board:** hero-scale, ~4× a wisp.

---

## 4. Concept images first (ChatGPT) — THE CHOSEN PIPELINE

**Decided 2026-07-07:** generate a concept reference in ChatGPT first, then feed it to Meshy **Image-to-3D** — exactly how the Murder was made. Text-to-3D was tested and rejected: it renders a generic grey raven and ignores the spectral art direction (translucency, hollow sockets, rune-scars, wisps). The text prompts in §5 are kept only as a fallback.

**How to run it (per enemy):**
1. In **one ChatGPT thread** (keeps style consistent across the set), paste the **shared framing preamble** + the enemy's line below.
2. Generate; iterate until the silhouette reads and the spectral look lands.
3. Save as `public/enemies/_raw/refs/<name>_full.png`.
4. Feed that PNG to Meshy **Image-to-3D** with the §2 settings.

**Shared framing preamble (prepend to every enemy):**
```
Character concept reference sheet for a mobile game enemy. A SINGLE creature, centered, FULL BODY fully in frame, three-quarter front view facing the camera, neutral floating idle pose, even soft studio lighting, plain dark charcoal background with no scenery, no text, no watermark, no border, high detail, painterly stylized game-art. Consistent style with the other sheets in this set. Subject:
```

**Per-enemy lines (append after the preamble):**
```
WISP — a small spectral raven ghost, translucent bone-white fading to cold pale-blue, body fraying into smoke and wisps, ONE hollow eye socket with a faint violet inner glow and no pupil, ghostly pale bone beak, a tattered wispy tail trailing like a comet, faint carved white rune-scar lines on the chest, mournful and ethereal.
```
```
CHORISTER — a mid-size spectral raven-wraith, hooded shoulders of layered translucent ghost feathers, bone-white fading to slate blue, beak parted mid-hymn with faint concentric sound-ring ripples at the throat, hollow eye sockets glowing pale violet, no pupils, ghostly bone beak, carved white rune-scars, edges dissolving into mist.
```
```
KEENER — a tall thin spectral raven mourner, unnaturally elongated neck and beak, wide silent-scream gape, translucent pale bone body with a long trailing veil of spectral feathers, hollow sockets with faint violet light, no pupils, ghostly bone beak, carved rune-scars, gaunt and unsettling, wisps peeling off the veil.
```
```
HUSK — a heavy hunched spectral raven tank, dense matted translucent ghost plumage clotted and drooping like waterlogged cloth, deep-sunk hollow sockets with a dim violet glow, no pupils, ghostly bone beak, tattered heavy wings dragging, bulky rounded silhouette, cold bone-white and slate, faint rune-scars, oppressive and slow.
```
```
WHISPER (BOSS) — a towering spectral raven wraith-king, great tattered translucent wings spread, twin hollow eye sockets glowing violet, no pupils, a crown of pale bone and antler-like spikes, a long train of veiling ghost feathers, bone-white fading to cold slate with pale-violet energy in the carved rune-scars, regal, patient and menacing, hero pose.
```

> ChatGPT tips: keep all five in the same chat and say "same framing and style as the last image" so the set matches. If it adds a scene/base, say "plain dark background, full body only, no ground." For Image-to-3D, a clean single-subject image on a plain background tracks far better than a busy one.

---

## 5. Meshy Text-to-3D prompts (FALLBACK ONLY)

Only if skipping the concept-image step. Paste the positive prompt, add the shared negative, apply the §2 settings.

**Shared NEGATIVE prompt (append to every one):**
```
gold beak, circuit lines, glowing wires, neon tech, bright saturated colors, black glossy feathers, cute, chibi, cartoon mascot, humanoid body, human face, armor, clothing logos, text, extra limbs, two heads, blurry, lowpoly blob
```

---
**`wisp` — Pale Whisper**
```
A small spectral raven ghost, stylized game creature, translucent bone-white and cold pale-blue body fraying into smoke and wisps, a single hollow eye socket with a faint violet inner glow, no pupil, ghostly bone beak, tattered wispy tail trailing like a comet, faint carved white rune-scar lines on the chest, mournful, ethereal, floating, subsurface glow, PBR, clean readable silhouette, neutral pose facing forward
```

**`chorister` — Chorister**
```
A mid-size spectral raven-wraith, stylized game enemy, hooded shoulders of layered translucent ghost feathers, bone-white fading to slate blue, beak parted as if singing, faint concentric sound-ring ripples at the throat, hollow eye sockets with pale violet inner light, no pupils, ghostly bone beak, carved white rune-scar lines, edges dissolving into mist, ethereal funeral mood, PBR, symmetrical front-facing pose
```

**`keener` — Keener**
```
A tall thin spectral raven mourner, stylized game enemy, unnaturally elongated neck and beak, wide silent-scream gape, translucent pale bone body with a trailing veil of spectral feathers, hollow glowing sockets with faint violet light, no pupils, ghostly bone beak, carved rune-scar lines, gaunt and unsettling, wisps peeling off the veil, ethereal, PBR, upright front-facing pose
```

**`husk` — Husk**
```
A heavy hunched spectral raven, stylized game tank enemy, dense matted translucent ghost plumage clotted and drooping like waterlogged cloth, deep-sunk hollow eye sockets with dim violet glow, no pupils, ghostly bone beak, tattered heavy wings dragging, bulky rounded silhouette, cold bone-white and slate, faint rune-scars, oppressive and slow, subsurface glow, PBR, front-facing pose
```

**`whisper_boss` — Whisper (boss)**
```
A towering spectral raven wraith-king boss, stylized game boss, great tattered translucent wings, twin hollow eye sockets glowing violet, no pupils, a crown of pale bone and antler-like spikes, a long train of veiling ghost feathers, bone-white fading to cold slate with pale-violet energy in carved rune-scars, regal patient and menacing, subsurface glow, ethereal, high detail, clean silhouette, symmetrical front-facing hero pose, PBR
```

---

## 6. Output & post (Claude does this after Meshy)

**Save raw Meshy exports to:**
```
public/enemies/_raw/wisp_meshy.glb
public/enemies/_raw/chorister_meshy.glb
public/enemies/_raw/keener_meshy.glb
public/enemies/_raw/husk_meshy.glb
public/enemies/_raw/whisper_boss_meshy.glb
```
(Repo TBD — the game has no repo yet; drop path finalizes when it's scaffolded.)

**Blender headless post** (per-mesh `process_enemy.py`, authored after `inspect_glb.py`, same as birds):
1. Normalize orientation / scale, face camera.
2. Make **eyes + rune-scars emissive** in pale violet `#B79CFF`.
3. Apply a **translucent / subsurface** material (alpha ~0.7) so they read as ghosts.
4. Add a **`dissolve` shape key or material driver** (0→1) for the spectral death fade.
5. Author clips: `float` (idle hover, loop), `advance` (drift-walk, loop), `attack` (lunge/shriek, once), `death` (dissolve, once). Boss also: `phase2` (crown split / wing flare, once) + `phase2_idle`.
6. Export → `public/enemies/<name>.glb`.

**Runtime clip names** (engine tries in order): `float`→`idle`, `advance`→`walk`, `attack`, `death`, boss `phase2`.

---

## 7. Checklist

- [ ] `wisp` — generate, pick, download raw
- [ ] `chorister` — generate, pick, download raw
- [ ] `keener` — generate, pick, download raw
- [ ] `husk` — generate, pick, download raw
- [ ] `whisper_boss` — generate, pick, download raw
- [ ] Blender inspect + process each → `public/enemies/*.glb`
- [ ] Wire into the board renderer (replaces the SVG stand-ins in the mockup)

> The mockup's current Pale Chorus (crafted SVG wraiths) are **placeholders / concept** for exactly these five. They match this brief's silhouettes so the game reads correctly until the Meshy meshes land.
