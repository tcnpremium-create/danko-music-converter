import { realpathSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { Track, Job, DjExportResult } from '../types/index.js';

const formats = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.aiff', '.aif', '.ogg']);
const text = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ');
const xml = (value: string) => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));

/** Validates local files; never edits audio or another application's database. */
export function buildVirtualDjExport(tracks: Track[], jobs: Job[]) {
  const omitted: DjExportResult['omitted'] = [];
  const songs: string[] = [];
  const paths = new Set<string>();
  for (const track of tracks) {
    const outputs = jobs.filter(job => job.trackId === track.id && job.status === 'COMPLETADO' && job.outputPath)
      .sort((a, b) => b.updatedAt - a.updatedAt).map(job => job.outputPath!);
    const candidates = [...outputs, ...(track.sourcePath ? [track.sourcePath] : [])];
    let file: { path: string; bytes: number } | undefined;
    for (const candidate of candidates) {
      try {
        if (/[\u0000-\u001f\u007f]/.test(candidate) || !formats.has(extname(candidate).toLowerCase())) continue;
        const path = realpathSync(candidate);
        const info = statSync(path);
        if (info.isFile() && info.size > 0) { file = { path, bytes: info.size }; break; }
      } catch { /* try another existing output, then the source */ }
    }
    if (!file) {
      omitted.push({ trackId: track.id, title: track.metadata.title, reason: 'Sin archivo de audio local válido' });
      continue;
    }
    // Do not repeat the exact same file, but retain remixes/versions at distinct paths.
    const identity = process.platform === 'win32' ? file.path.toLowerCase() : file.path;
    if (paths.has(identity)) {
      omitted.push({ trackId: track.id, title: track.metadata.title, reason: 'El mismo archivo ya está en la selección' });
      continue;
    }
    paths.add(identity);
    const duration = Number.isFinite(track.durationSec) && track.durationSec > 0 ? ` songlength="${track.durationSec}"` : '';
    songs.push(`  <song path="${xml(file.path)}" size="${file.bytes}" artist="${xml(track.metadata.artist)}" title="${xml(track.metadata.title)}" idx="${songs.length}"${duration} />`);
  }
  return { content: `<?xml version="1.0" encoding="UTF-8"?>\n<VirtualFolder>\n${songs.join('\n')}\n</VirtualFolder>\n`, exported: songs.length, omitted };
}
