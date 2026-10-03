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

  // --- Seguridad: path traversal -------------------------------------------
  it('neutraliza separadores dentro de un valor de token (no crea carpetas)', () => {
    const out = applyNamingTemplate('{title}', { title: '../../../../etc/passwd' });
    // Un único segmento, sin separadores → no puede transitar directorios.
    expect(out.includes('/')).toBe(false);
    expect(out.includes('\\')).toBe(false);
    expect(out).not.toContain('etc/passwd');
    expect(out.split('/').length).toBe(1);
  });

  it('un segmento "../" de la plantilla no permite subir de directorio', () => {
    const out = applyNamingTemplate('../../{title}', { title: 'x' });
    // Los segmentos ".." se neutralizan a un nombre seguro, nunca ".."
    expect(out.split('/').every((s) => s !== '..' && s !== '.')).toBe(true);
    expect(out.endsWith('/x')).toBe(true);
  });

  it('rutas absolutas en el valor no escapan', () => {
    const out = applyNamingTemplate('{title}', { title: '/etc/cron.d/evil' });
    expect(out.startsWith('/')).toBe(false);
    expect(out.includes('/')).toBe(false);
  });

  it('sanitizeSegment convierte ".." en un nombre no transitable', () => {
    expect(sanitizeSegment('..')).not.toBe('..');
    expect(sanitizeSegment('.')).not.toBe('.');
  });
});
