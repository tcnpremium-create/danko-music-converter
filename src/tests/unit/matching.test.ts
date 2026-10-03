import { describe, it, expect } from 'vitest';
import {
  normalizeText, versionTokens, similarity, levenshtein,
  scoreMatch, classify, bestMatch, THRESHOLDS, type MatchFields,
} from '../../matching/matching.js';

describe('normalizeText', () => {
  it('baja a minúsculas, quita acentos y puntuación', () => {
    expect(normalizeText('Él Canción (Remix)!')).toBe('el cancion');
  });
  it('elimina feat/ft/featuring y lo que sigue', () => {
    expect(normalizeText('Titanium feat. Sia')).toBe('titanium');
    expect(normalizeText('Loud ft Someone')).toBe('loud');
  });
  it('elimina frases de ruido como official video', () => {
    expect(normalizeText('Clarity (Official Video)')).toBe('clarity');
  });
  it('colapsa espacios', () => {
    expect(normalizeText('  a   b  ')).toBe('a b');
  });
});

describe('versionTokens', () => {
  it('detecta remix/live/extended', () => {
    expect(versionTokens('Titanium (Remix 2024)').has('remix')).toBe(true);
    expect(versionTokens('Song - Live').has('live')).toBe(true);
    expect(versionTokens('Song (Extended Mix)').has('extended')).toBe(true);
  });
  it('no detecta versión en un título limpio', () => {
    expect(versionTokens('Titanium').size).toBe(0);
  });
});

describe('levenshtein & similarity', () => {
  it('distancia correcta', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
  it('similitud 1 para iguales normalizados', () => {
    expect(similarity('Titanium', 'titanium')).toBe(1);
  });
  it('similitud alta para casi iguales', () => {
    expect(similarity('Titanium', 'Titaniom')).toBeGreaterThan(0.8);
  });
});

describe('scoreMatch — coincidencias claras', () => {
  it('MATCH alto para misma pista', () => {
    const ref: MatchFields = { artist: 'David Guetta', title: 'Titanium', durationSec: 245, album: 'Nothing but the Beat' };
    const cand: MatchFields = { artist: 'David Guetta', title: 'Titanium', durationSec: 245, album: 'Nothing but the Beat' };
    const r = scoreMatch(ref, cand);
    expect(r.score).toBeGreaterThanOrEqual(THRESHOLDS.MATCH);
    expect(r.verdict).toBe('MATCH');
  });

  it('ISRC idéntico → 100 directo', () => {
    const r = scoreMatch(
      { artist: 'A', title: 'X', isrc: 'USUM71234567' },
      { artist: 'Totalmente otro', title: 'Distinto', isrc: 'usum71234567' },
    );
    expect(r.score).toBe(100);
  });
});

describe('scoreMatch — ANTI falsos positivos (caso Titanium)', () => {
  it('NO auto-asocia Titanium con Titanium Remix 2024 (duración distinta)', () => {
    const ref: MatchFields = { artist: 'David Guetta', title: 'Titanium', durationSec: 245 };
    const remix: MatchFields = { artist: 'David Guetta', title: 'Titanium (Remix 2024)', durationSec: 312 };
    const r = scoreMatch(ref, remix);
    expect(r.verdict).not.toBe('MATCH');
    expect(r.score).toBeLessThan(THRESHOLDS.PROBABLE);
  });

  it('perdona versión distinta SOLO si la duración es casi idéntica', () => {
    const ref: MatchFields = { artist: 'David Guetta', title: 'Titanium', durationSec: 245 };
    const almost: MatchFields = { artist: 'David Guetta', title: 'Titanium (Remastered)', durationSec: 246 };
    const r = scoreMatch(ref, almost);
    // Puede ser PROBABLE pero no se dispara a MATCH ciego; sobre todo no SIN_MATCH.
    expect(r.score).toBeGreaterThanOrEqual(THRESHOLDS.REVISAR);
  });

  it('artista distinto nunca es MATCH', () => {
    const r = scoreMatch(
      { artist: 'David Guetta', title: 'Titanium', durationSec: 245 },
      { artist: 'Rihanna', title: 'Titanium', durationSec: 245 },
    );
    expect(r.verdict).not.toBe('MATCH');
    expect(r.score).toBeLessThanOrEqual(60);
  });
});

describe('classify', () => {
  it('bandas correctas', () => {
    expect(classify(95)).toBe('MATCH');
    expect(classify(80)).toBe('PROBABLE');
    expect(classify(65)).toBe('REVISAR');
    expect(classify(40)).toBe('SIN_MATCH');
  });
});

describe('bestMatch', () => {
  it('elige el mejor candidato', () => {
    const ref: MatchFields = { artist: 'Danko', title: 'Tema', durationSec: 200 };
    const cands: MatchFields[] = [
      { artist: 'Otro', title: 'Nada', durationSec: 100 },
      { artist: 'Danko', title: 'Tema', durationSec: 200 },
    ];
    const best = bestMatch(ref, cands);
    expect(best?.index).toBe(1);
    expect(best?.result.verdict).toBe('MATCH');
  });

  it('con dos candidatos casi idénticos pide REVISAR en vez de auto-asociar', () => {
    const ref: MatchFields = { artist: 'Danko', title: 'Tema', durationSec: 200 };
    const cands: MatchFields[] = [
      { artist: 'Danko', title: 'Tema', durationSec: 200 },
      { artist: 'Danko', title: 'Tema', durationSec: 200 },
    ];
    const best = bestMatch(ref, cands);
    expect(best?.result.verdict).toBe('REVISAR');
  });

  it('lista vacía → null', () => {
    expect(bestMatch({ artist: 'A', title: 'B' }, [])).toBeNull();
  });
});
