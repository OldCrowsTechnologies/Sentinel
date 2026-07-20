# Acoustic UAV Detection — Literature Review (ingested)

> **Source.** Michael Bares' `UAV_Literature_Review_Tracker.xlsx` (GUARD collaboration,
> emailed 2026-07-17/19) — 81 rows / **~73 unique papers** (the 8 "★ Already Have"
> duplicate earlier entries). The spreadsheet is a curated **reading list** (authors,
> title, venue, year, category); the Key-Contribution/Relevance columns were blank, so
> this doc is the **synthesis** — what the literature says for Corvus Sentinel.
> Related: [[guard-vigil-hf-data]], [GUARD-VIGIL-INTEGRATION.md](GUARD-VIGIL-INTEGRATION.md),
> [SENTINEL-UNIFIED-SENSOR.md](SENTINEL-UNIFIED-SENSOR.md).
>
> **Read Part A first** — it maps the literature onto our two live problems
> (false-positive/confounder rejection, and DOA/localization). Part B is the annotated
> bibliography by category. Specific figures are cited only where web-verified or
> well-established; per-paper deep dives can be pulled on request.

---

## Part A — What the literature says for Sentinel (actionable)

### A1. Confounder rejection / false positives *(our #1 problem — the Blue Angels FP storm)*
The single most useful finding for us: **rotor UAVs have a distinctive harmonic structure** —
a **blade-pass fundamental (~50–250 Hz) with a comb of harmonics**, tonal peaks riding on
broadband — whereas our confounders (jet turbines, car A/C compressors, reefer engines,
fountain fans) are **broadband/quasi-stationary machinery without the same evenly-spaced
rotor-harmonic comb** (Kloet #57, Cabell #58, Wu #62, Alexander #59). Actionable levers:
- **Feature-engineer the rotor comb**, don't rely on raw mel energy. Harmonic-product-spectrum /
  cepstral-peak / blade-pass-frequency (BPF) tracking separates a *propeller* from a *turbine or
  compressor*. Wu #62 ("deterministic components of propeller noise") and Kloet #57 are the
  physics references. This directly attacks today's jets→"Fixed-wing UAS" and fans→"FPV racer".
- **Low-frequency concentration is necessary but NOT sufficient.** Izquierdo #61 discriminates
  drone-from-voice because drone noise is low-freq — but our confounders are *also* low-freq, so
  we must discriminate on **harmonic pattern + temporal stationarity**, not just band energy.
- **Blind Source Separation (BSS)** — flagged by the Kang #1/#81 review as a front-end we don't
  use; can peel a drone tonal set off a stationary noise bed before classification.
- **Hard-negative training is the proven fix** — every survey (Kang, Seidaliyeva #3, Taha #2)
  stresses real-world negatives; matches our jet/AC retrain. The confounder corpus we gathered
  today is exactly what these papers say is scarce and valuable.
- **Propeller-anomaly CNNs** (Fuentes-Sanchez #48) show lightweight nets keying on propeller
  spectral signatures — supports a rotor-specific detector head.

### A2. DOA / localization / triangulation *(the unified-sensor RF+acoustic goal)*
16 papers in "Arrays/TDOA/Localization" — the richest category, and the roadmap for turning
Sentinel from presence → **location**:
- **Small arrays already localize Class-I UAS.** Benyamin & Goldman #26 (tetrahedral 4-mic array)
  and Case #29 (low-cost array) are the canonical "cheap array → bearing/track" references —
  direct templates for our mic-array node.
- **DOA methods:** GCC-PHAT / TDOA (Liu #37, Chen #41 improved-EMD delay estimation), SRP-PHAT /
  beamforming (Satish #38 spherical, Busset #30 acoustic camera), and **frequency-tracking DOA in
  the time-frequency plane** (Itare #35) — the last is attractive because it locks onto the rotor
  harmonics we're already extracting (ties A1↔A2).
- **Distributed arrays beat one big array** (Lim #36, Yang #80, Blass #51 mobile arrays) — i.e.
  our **mesh of nodes** is the right architecture, not one super-sensor. Fusion of per-node
  bearings/ranges is exactly `lib/meshFusion.ts`.
- **`RealTimeBearingGPS.py`** (GUARD's code, in the same email) is a working bearing+GPS
  implementation to port — Part A2 is the theory behind it.
- Practical range: **acoustic detection realistic to <200 m** (Tejera-Berengue #75); localization
  needs the target in range of ≥3 nodes — informs node spacing for coverage.

### A3. Features & model architecture
- **Mel-spectrogram + CNN is the field default** (Seo #9 STFT-CNN, Al-Emadi #8, Lei #14); **CRNN**
  adds temporal modeling (Kashyap #13 reports ~99% within 70 m; Utebayeva #5 RNN review) — a CRNN
  is a natural upgrade from our current MLP-on-features if we want sequence modeling.
- **Late/result-level fusion of multiple nets** (Casabianca #16, Dong #10) improves robustness —
  cheap ensemble win.
- **Time-frequency complementary enhancement** (Dong #11) and **frequency-band feature extraction**
  (Zhong #25) are confounder-robustness techniques.
- **Transfer learning + frequency-domain features** (Yaacoub #24) — relevant given our small real
  corpus; pretrain on big sets, fine-tune on our captures.

### A4. Edge / embedded (the node)
- **Edge C-UAS acoustic sensing** (Hagberg #47 — a UND paper Michael has read) and **lightweight
  CNNs** (Fuentes-Sanchez #48) confirm real-time detection on a Pi-class device is viable — de-risks
  the unified-node compute budget. AIM #49 (acoustic-inertial) is more indoor/niche.

### A5. Datasets & augmentation
- **ESC-50** (Piczak #53) — the standard 50-class environmental-sound set: **a ready source of
  hard negatives** (engines, machinery, wind) to augment our "None" class *now*, complementing the
  Blue Angels captures.
- **DroneNoise DB** (Romero #54, Salford) and **DroneAudioDataset** (Al-Emadi #55) — drone positives.
- The HuggingFace **DADS** set (Michael's link) fits here too: 180k clips @16 kHz, drone-heavy.
- Takeaway: augment with ESC-50 negatives + keep our field confounders; guard class balance
  (the `--cap` lever) — the surveys and our own history warn naive dataset dumps regress.

### A6. Multi-modal fusion *(validates the unified sensor)*
- **RF + acoustic fusion** (Frid #42) and **radar + acoustic via transformer** (Ganganath #43)
  show cross-modal fusion beats any single modality — the literature backing for one node doing
  acoustic + Remote-ID + control-link. Audio-visual (Alla #17, Xiao #44 AV-DTEC) is a later camera add.

### A7. Calibration, range, confidence
- Tejera-Berengue #75 quantifies **accuracy degradation with distance/SNR** — supports reporting
  **calibrated confidence + a range band**, not raw softmax (ties to our temperature-scaling TODO).

---

## Part B — Annotated bibliography by category

**1. Survey / Review**
- **#1/#81 Kang, Huang, Sun et al. (2025)** *Holistic Review of Acoustic Detection for UAVs* — AIP Advances (DOI 10.1063/5.0304975). Covers signal acquisition, **blind source separation**, feature extraction, SSL. Best single map of the field.
- **#2 Taha & Shoufan (2019)** *ML-Based Drone Detection & Classification: State-of-the-Art* — IEEE Access. Foundational ML survey.
- **#3 Seidaliyeva et al. (2024)** *Advances and Challenges in Drone Detection* — Sensors. Current challenges incl. false alarms.
- **#4 Mrabet et al. (2024)** *ML for Drone Detection: Benefits and Challenges* — Frontiers.
- **#5 Utebayeva et al. (2022)** *RNNs for Real-Time Drone Sound Detection* — Drones.
- **#6 Chevtchenko et al. (2025)** *Drone-Based Sound Source Localization: Systematic Review* — IEEE Access. SSL-focused.
- **#7 Pham & Srour (2004)** *TTCP AG-6: Acoustic Detection & Tracking of UAVs* — SPIE. Early defense baseline.

**2. Deep Learning**
- **#8 Al-Emadi et al. (2019)** *Audio-Based Drone Detection & ID Using DL* — IEEE IWCMC. Also the DroneAudioDataset source.
- **#9 Seo, Jang, Im (2018)** *CNN with Acoustic STFT Features* — IEEE AVSS. Canonical STFT-CNN.
- **#10 Dong, Liu, Liu (2023)** *Result-Level Fusion DL* — MTA.
- **#11 Dong et al. (2023)** *Time-Frequency Complementary Enhancement* — IEEE TIM. Confounder robustness.
- **#12 Jeon et al. (2017)** *Drone Sound Detection in Real-Life Environments with DNNs* — arXiv:1701.05779. Early real-world negatives.
- **#13 Kashyap et al. (2023)** *CRNN for Small Drone Detection* — ~99.3% within 70 m.
- **#14 Lei, Gadgil et al. (2025)** *UAV Audio ID with STFT Spectrograms + DL* — IEEE ICUAS.
- **#15 Liu et al. (2025)** *DL Acoustic Recognition of UAVs in Complex Environments* — Drones. "Complex environments" = confounders.
- **#16 Casabianca & Zhang (2021)** *Late Fusion of DNNs* — Drones. Ensemble robustness.
- **#17 Alla, Olou et al. (2024)** *Audio-Visual Fusion + DL* — ACM WiSec.
- **#18 Vemula (2018)** *Multiple Drone Detection + Acoustic Scene Classification* — BTech thesis, Wright State.

**3. Classical / Feature Extraction**
- **#19 Anwar, Kaleem, Jamalipour (2019)** *ML Sound-Based Amateur Drone Detection for Public Safety* — IEEE TVT. MFCC-class features; public-safety framing.
- **#20 Akbal et al. (2023)** *Skinny Pattern (hand-crafted feature) Detection* — Digital Signal Processing.
- **#21 Mezei & Molnár (2016)** *Drone Sound Detection by Correlation* — IEEE SACI. Matched-filter/correlation.
- **#22 Bernardini et al. (2017)** *Acoustic Signature Identification* — IS&T. SVM on spectral features.
- **#23 Hauzenberger & Ohlsson (2015)** *Drone Detection Using Audio Analysis* — MSc, Lund.
- **#24 Yaacoub, Younes, Rizk (2022)** *Transfer Learning + Frequency-Domain Features* — IC2SPM. Relevant to small-corpus training.
- **#25 Zhong et al. (2025)** *Frequency-Band Feature Extraction* — Drones. Band-selective features for robustness.

**4. Arrays / TDOA / Localization** *(DOA roadmap — see A2)*
- **#26 Benyamin & Goldman (2014)** *Class-I UAS Tracking with a Tetrahedral Mic Array* — DTIC. Canonical small-array template.
- **#27 Chang, Yang et al. (2018)** *Surveillance via Acoustic Arrays*.
- **#28 Tong, Xie, Hu et al. (2016)** *Low-Altitude Target Trajectory from a Single Acoustic Array* — JASA.
- **#29 Case, Zelnio, Rigling (2008)** *Low-Cost Acoustic Array for Small UAV* — IEEE NAECON. Cheap-array reference.
- **#30 Busset et al. (2015)** *Acoustic Cameras for Drone Tracking* — SPIE. Beamforming imaging.
- **#31 Blanchard, Torea et al. (2019)** *Localization with Mic Array* — InterNoise.
- **#32 Baron, Bouley et al. (2019)** *Array + Supervised Learning localization/ID* — SPIE.
- **#33 Ramamonjy, Bavu et al. (2018)** *Compact Digital MEMS Array Localization+ID* — ICSV25. MEMS array (our hardware class).
- **#34 Herold et al. (2020)** *Separate Tracking of Swarm Quadcopters* — array measurements.
- **#35 Itare, Thomas, Raoof (2022)** *DOA via Frequency Tracking in the T-F Plane* — Sensors. **Rotor-harmonic-based DOA — ties features↔localization.**
- **#36 Lim, Joo, Kim (2025)** *Distributed Mic Arrays* — Sensors. **Distributed > single (our mesh).**
- **#37 Liu, Yu, Yang (2025)** *Improved Time-Delay Estimation for Anti-Low-Altitude UAV* — Sensors. TDOA accuracy.
- **#38 Satish & Medda (2022)** *Spherical Array Beamforming* — Asilomar.
- **#39 Cheng et al. (2024)** *MEMS Array on a Dynamic Platform* — ICCE-Taiwan.
- **#40 Hoshiba et al. (2024)** *SSL via Histogram + Frequency Info (Drone Audition)* — Drones.
- **#41 Chen, Yu, Yang (2024)** *SSL via Improved EMD* — Sensors.

**5. Multi-modal Detection** *(unified-sensor backing — see A6)*
- **#42 Frid, Ben-Shimol et al. (2024)** *Fusion of RF + Acoustic + DNNs* — Sensors. **Direct backing for acoustic+RF node.**
- **#43 Ganganath et al. (2025)** *Radar + Acoustic via Transformer Encoder* — arXiv.
- **#44 Xiao et al. (2024)** *AV-DTEC: Self-Supervised Audio-Visual Trajectory + Classification* — arXiv.
- **#45 Liu, Wei, Chen et al. (2017)** *Audio-Assisted Camera Array* — IEEE BigMM.
- **#46 Christnacher et al. (2016)** *Optical + Acoustical Detection* — SPIE.

**6. Edge / Embedded** *(the node — see A4)* — all marked **Read** by Michael
- **#47 Hagberg et al. (2025)** *Edge-Enabled Acoustic Sensing for Real-Time C-UAS* — UND. Closest to our node.
- **#48 Fuentes-Sanchez et al. (2025)** *Lightweight CNN, Real-Time Propeller Anomaly Detection* — rotor-specific + edge.
- **#49 Sun, Wang et al. (2022)** *AIM: Acoustic-Inertial Indoor Localization* — ACM SenSys.
- **#50 Hu et al. (2025)** *Autonomous Interception via Improved SSL* — IEEE Access.
- **#51 Blass, Grebien, Graf (2024)** *Acoustic Tracking with Mobile Mic Arrays* — Quiet Drones.
- **#52 Finn & Franklin (2011)** *Acoustic Sense & Avoid for UAVs* — ISSNIP.

**7. Datasets & Augmentation** *(see A5)*
- **#53 Piczak (2015)** *ESC-50 Environmental Sound Dataset* — ACM MM. **Negatives source.**
- **#54 Romero et al. (2023)** *DroneNoise Database* — Salford Figshare.
- **#55 Al-Emadi et al. (2019)** *DroneAudioDataset* (= #8).
- **#56 Nemer et al. (2021)** *RF-Based UAV Detection, Hierarchical Learning (multimodal dataset)* — Sensors.

**8. Noise & Acoustics** *(confounder physics — see A1)*
- **#57 Kloet, Watkins, Clothier (2017)** *Acoustic Signature of Small Multirotor sUAS* — J. Micro Air Vehicles. Rotor signature reference.
- **#58 Cabell, McSwain, Grosveld (2016)** *Measured Noise from Small UAVs* — NOISE-CON.
- **#59 Alexander & Whelchel (2019)** *Flyover Noise of Multirotor sUAS* — InterNoise.
- **#60 Dumitrescu et al. (2020)** *Acoustic System for UAV Detection* — Sensors.
- **#61 Izquierdo et al. (2020)** *Discriminating UAV Propeller Noise from Distress Signals, MEMS Arrays* — Sensors (DOI 10.3390/s20030597). **Key: drone noise is low-frequency-concentrated → discriminable; MEMS-array DOA of multiple sources.**
- **#62 Wu et al. (2022)** *Deterministic Components of Propeller Noise* — Aerospace Science & Tech. **Physics of the blade-pass harmonic comb — the discriminating feature.**
- **#63/#78 Jekaterynczuk & Piotrowski (2025)** *Outdoor Mic Range Tests + Spectral Analysis of UAV Signatures* — Sensors. **Read.** Range + spectra for array design.

**9. Adjacent / Audio ML**
- **#64 Smeaton & McHugh (2006)** *Event Detection in an Audio Sensor Network* — Multimedia Systems.
- **#65 Kovalenko & Poroshenko (2022)** *Sound Event Detection Methods Survey*.
- **#66 Mesaros et al. (2021)** *Sound Event Detection: A Tutorial* — IEEE SPM. SED framing for our detector.
- **#67 Mienye et al. (2024)** *RNNs: Comprehensive Review* — Information.
- **#68 Al-Selwi et al. (2024)** *RNN-LSTM Systematic Review* — JKSU.
- **#69 Chen et al. (2021)** *CNN Image Classification Review* — Remote Sensing.

**10. Counter-UAS / Security**
- **#70 Wagoner, Schrader, Matson (2017)** *Vision-Based Targeting for C-UAS* — IEEE CIVEMSA.
- **#71 Goppert et al. (2017)** *Autonomous Air-to-Air C-UAS* — IEEE IRC.
- **#72 Sayed, Ramahi, Shaker (2024)** *RDIwS: Beamforming-Based Detection & Classification* — IEEE Sensors J.
- **#73 Jekaterynczuk & Piotrowski (2023)** *Survey of SSL Detection Methods* — Sensors.

**★ Already Have (74–81)** — duplicates of the above plus:
- **#74 Chatterjee et al. (2025)** *AUDRON: Fused Acoustic Signatures for Drone Type Recognition* — IEEE INDICON.
- **#75 Tejera-Berengue et al. (2024)** *Distance & Environmental Impact on UAV Acoustic Detection* — Electronics 13(3):643. **Read. Detection realistic <200 m; LDA/SVM→YAMNet vs distance/SNR.**
- **#79 Pinel Lamotte, Baron, Bouley (2020)** *UAV Detection from Acoustic Signature: Requirements & SotA* — Quiet Drones.
- **#80 Yang, Bowon (2019)** *UAV Detection with Multiple Acoustic Nodes + ML* — MS thesis, Purdue. **Multi-node = our mesh.**

---

## Part C — Priority actions this review surfaces (for Sentinel)

1. **Add a rotor-harmonic feature** (blade-pass fundamental + harmonic-comb / cepstral-peak) so the
   model discriminates *propeller* from *turbine/compressor/fan* — the direct fix for today's
   jets→UAS and fans→UAS FPs (refs #57, #62, #61, #48). Highest-value, physics-grounded.
2. **Augment "None" with ESC-50** engine/machinery/wind classes (#53) now, alongside the Blue Angels
   confounder captures — cheap hard-negative boost.
3. **DOA path for the unified node:** port GUARD's `RealTimeBearingGPS.py`; frequency-tracking DOA
   (#35) reuses the rotor harmonics; distributed nodes + `meshFusion` (#36, #80). Validate <200 m (#75).
4. **Consider a CRNN** upgrade (#13, #5) and **late fusion** (#16) if the harmonic feature + retrain
   don't fully close the gap.
5. **Blind Source Separation** front-end (#1) to peel drone tonals off a stationary noise bed —
   research bet for the hardest confounder scenes.

**Gaps to fill:** DOIs/links for most rows are blank in the tracker — I web-verified #61/#75/#1;
say the word and I'll resolve links + pull specifics for any subset (e.g. the Noise & Acoustics or
Arrays papers) you want to action first.

Sources: [Izquierdo 2020 (MDPI Sensors)](https://www.mdpi.com/1424-8220/20/3/597) · [Tejera-Berengue 2024 (MDPI Electronics)](https://www.mdpi.com/2079-9292/13/3/643) · [Kang 2025 (AIP Advances)](https://pubs.aip.org/aip/adv/article/15/12/120701/3373725/)
