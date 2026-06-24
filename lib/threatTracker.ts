/**
 * threatTracker.ts -- deduplicates detections into tracked threats, manages
 * trajectory/lifecycle, and raises alerts. MVP runs on a single (mono) mic so
 * bearing is unavailable; dedup keys on drone TYPE + distance estimate.
 */

export interface TrajectoryPoint {
  distance: number;
  confidence: number;
  timestamp: number;
}

export interface Threat {
  id: string;
  type: string;
  distance: number;
  bearing: number; // -1 = unknown (mono mic)
  confidence: number;
  firstSeen: number;
  lastSeen: number;
  status: 'approaching' | 'receding' | 'static' | 'unknown';
  trajectory: TrajectoryPoint[];
}

export interface AlertEvent {
  type: 'new_threat' | 'approaching' | 'threat_gone';
  threat: Threat;
  severity: 'low' | 'medium' | 'high';
  message: string;
  timestamp: number;
}

export interface Detection {
  label: string;
  confidence: number; // 0-100
  distance: number;
  bearing: number;
  timestamp: number;
}

export class ThreatTracker {
  private threats: Map<string, Threat> = new Map();
  private alertQueue: AlertEvent[] = [];
  private sessionLog: Threat[] = [];

  private distanceThreshold = 80; // ft: same type within this band = same threat
  private minConfidence = 85; // % to register a new threat
  private approachingDelta = 25; // ft decrease to flag "approaching"
  private inactivityTimeout = 30000; // ms before a threat is dropped

  setThresholds(opts: Partial<{ distance: number; minConfidence: number; approaching: number; timeout: number }>): void {
    if (opts.distance != null) this.distanceThreshold = opts.distance;
    if (opts.minConfidence != null) this.minConfidence = opts.minConfidence;
    if (opts.approaching != null) this.approachingDelta = opts.approaching;
    if (opts.timeout != null) this.inactivityTimeout = opts.timeout;
  }

  update(d: Detection): AlertEvent[] {
    const ts = d.timestamp || Date.now();
    const alerts: AlertEvent[] = [];

    // "None"/"Unknown" with low confidence are not threats
    if (d.label === 'None') {
      this.cleanup(ts, alerts);
      this.alertQueue.push(...alerts);
      return alerts;
    }

    const existing = this.findExisting(d.label, d.distance);

    if (!existing) {
      if (d.confidence >= this.minConfidence) {
        const threat: Threat = {
          id: `${d.label}_${ts}`,
          type: d.label,
          distance: d.distance,
          bearing: d.bearing,
          confidence: d.confidence,
          firstSeen: ts,
          lastSeen: ts,
          status: 'unknown',
          trajectory: [{ distance: d.distance, confidence: d.confidence, timestamp: ts }],
        };
        this.threats.set(threat.id, threat);
        this.sessionLog.push(threat);
        alerts.push({
          type: 'new_threat',
          threat,
          severity: this.severity(d.distance),
          message: `New contact: ${d.label} ~${Math.round(d.distance)} ft (${Math.round(d.confidence)}%)`,
          timestamp: ts,
        });
      }
    } else {
      const prevDist = existing.distance;
      existing.distance = d.distance;
      existing.bearing = d.bearing;
      existing.confidence = Math.max(existing.confidence, d.confidence);
      existing.lastSeen = ts;
      existing.trajectory.push({ distance: d.distance, confidence: d.confidence, timestamp: ts });
      if (existing.trajectory.length > 60) existing.trajectory.shift();

      const delta = prevDist - d.distance;
      if (delta > this.approachingDelta) {
        existing.status = 'approaching';
        alerts.push({
          type: 'approaching',
          threat: existing,
          severity: this.severity(d.distance),
          message: `${d.label} approaching: ~${Math.round(d.distance)} ft (was ${Math.round(prevDist)} ft)`,
          timestamp: ts,
        });
      } else if (delta < -this.approachingDelta) {
        existing.status = 'receding';
      } else {
        existing.status = 'static';
      }
    }

    this.cleanup(ts, alerts);
    this.alertQueue.push(...alerts);
    return alerts;
  }

  private findExisting(type: string, distance: number): Threat | undefined {
    for (const t of this.threats.values()) {
      if (t.type === type && Math.abs(t.distance - distance) < this.distanceThreshold) return t;
    }
    return undefined;
  }

  private severity(distance: number): 'low' | 'medium' | 'high' {
    if (distance < 150) return 'high';
    if (distance < 300) return 'medium';
    return 'low';
  }

  private cleanup(now: number, alerts: AlertEvent[]): void {
    for (const [id, t] of this.threats) {
      if (now - t.lastSeen > this.inactivityTimeout) {
        alerts.push({
          type: 'threat_gone',
          threat: t,
          severity: 'low',
          message: `Lost contact: ${t.type}`,
          timestamp: now,
        });
        this.threats.delete(id);
      }
    }
  }

  getActiveThreats(): Threat[] {
    return Array.from(this.threats.values()).sort((a, b) => a.distance - b.distance);
  }

  getAlerts(): AlertEvent[] {
    return this.alertQueue.splice(0);
  }

  getSessionLog(): Threat[] {
    return this.sessionLog;
  }

  reset(): void {
    this.threats.clear();
    this.alertQueue = [];
    this.sessionLog = [];
  }
}

export default ThreatTracker;
