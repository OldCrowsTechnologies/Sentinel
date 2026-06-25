/**
 * reportGenerator.ts -- builds an OCWS-branded session After-Action Report
 * (HTML) from the threat log and writes it to the device cache, returning the
 * file URI so the UI can share/export it.
 */

import * as FileSystem from 'expo-file-system';
import type { Threat } from './threatTracker';

export interface SessionReport {
  startTime: number;
  endTime: number;
  threats: Threat[];
  origin?: { lat: number; lon: number; accuracy: number | null } | null; // operator position
}

function fmt(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function loc(lat?: number | null, lon?: number | null): string {
  if (lat == null || lon == null) return 'n/a';
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function buildReportHtml(report: SessionReport): string {
  const rows = report.threats
    .map((t) => {
      const dur = Math.max(0, Math.round((t.lastSeen - t.firstSeen) / 1000));
      return `<tr>
        <td>${t.type}</td>
        <td>${Math.round(t.confidence)}%</td>
        <td>~${Math.round(t.distance * 0.65)}&ndash;${Math.round(t.distance * 1.55)} ft</td>
        <td>${t.bearing >= 0 ? Math.round(t.bearing) + '°' : 'n/a'}</td>
        <td>${t.status}</td>
        <td>${fmt(t.firstSeen)}</td>
        <td>${dur}s</td>
        <td>${loc(t.lat, t.lon)}</td>
      </tr>`;
    })
    .join('');

  const total = report.threats.length;
  const durMin = Math.max(0, Math.round((report.endTime - report.startTime) / 60000));

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1A2332;margin:32px;}
  h1{color:#0D6E7A;border-bottom:3px solid #B8922A;padding-bottom:8px;}
  .meta{color:#555;font-size:13px;margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{background:#1A2332;color:#fff;text-align:left;padding:8px;}
  td{border-bottom:1px solid #ddd;padding:8px;}
  .footer{margin-top:32px;color:#0D6E7A;font-weight:600;font-style:italic;}
  .empty{color:#888;padding:24px 0;}
</style></head><body>
  <h1>CORVUS SENTINEL &mdash; After-Action Report</h1>
  <div class="meta">
    Session start: ${fmt(report.startTime)}<br>
    Session end: ${fmt(report.endTime)}<br>
    Operator position: ${report.origin ? loc(report.origin.lat, report.origin.lon) : 'n/a'}<br>
    Duration: ${durMin} min &nbsp;|&nbsp; Total contacts: ${total}
  </div>
  ${
    total > 0
      ? `<table><thead><tr>
          <th>Type</th><th>Peak Conf.</th><th>Range (est)</th><th>Bearing</th>
          <th>Status</th><th>First Seen (UTC)</th><th>Track Dur.</th><th>Operator GPS</th>
        </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">No contacts detected during this session.</div>`
  }
  <div class="footer">Corvus. Old Crows Wireless Solutions. We Always Find the Signal.</div>
</body></html>`;
}

export async function writeReport(report: SessionReport): Promise<string> {
  const html = buildReportHtml(report);
  const stamp = new Date(report.startTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const uri = `${FileSystem.cacheDirectory}corvus-report-${stamp}.html`;
  await FileSystem.writeAsStringAsync(uri, html, { encoding: FileSystem.EncodingType.UTF8 });
  return uri;
}
