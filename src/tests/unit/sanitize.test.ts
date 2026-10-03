import { describe, it, expect } from 'vitest';
import { sanitizeSegment, applyNamingTemplate } from '../../utils/sanitize.js';

describe('sanitizeSegment', () => {
  it('reemplaza caracteres inválidos de Windows', () => {
    expect(sanitizeSegment('AC/DC: Back?')).toBe('AC_DC_ Back_');
  });

  it('recorta puntos y espacios finales', () => {
    expect(sanitizeSegment('nombre...  ')).toBe('nombre');
  });

  it('evita nombres reservados', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('nul')).toBe('_nul');
  });

  it('nunca devuelve cadena vacía', () => {
    expect(sanitizeSegment('***')).toBe('___');
    expect(sanitizeSegment('')).toBe('sin_titulo');
  });
});

describe('applyNamingTemplate', () => {
  it('crea subcarpetas por segmento', () => {
    const out = applyNamingTemplate('{artist}/{album}/{track} - {title}', {
      artist: 'Danko', album: '90s', trackNumber: 3, title: 'Tema',
    });
    expect(out).toBe('Danko/90s/03 - Tema');
  });

  it('sanitiza cada segmento por separado sin romper la jerarquía', () => {
    const out = applyNamingTemplate('{artist}/{title}', {
      artist: 'A/B', title: 'C:D',
    });
    expect(out).toBe('A_B/C_D');
  });

  it('descarta tokens vacíos', () => {
    const out = applyNamingTemplate('{artist} - {title}', { artist: '', title: 'Solo' });
    expect(out).toBe('Solo');
  });
});
