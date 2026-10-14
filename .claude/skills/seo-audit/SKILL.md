---
name: seo-audit
description: Auditoría SEO técnica reproducible del proyecto activo (sitemap, robots, canonicals, metadatos, JSON-LD, llms.txt). Solo lectura.
---
1. Localiza sitemap, robots, layout/metadatos y todas las páginas del repo (según su framework).
2. Comprueba por página: `title` (<60), `description` (<160), `alternates.canonical`, Open Graph, un solo H1, JSON-LD válido, imágenes con `alt`.
3. Verifica que cada ruta de `app/` aparece en el sitemap y que robots.txt apunta al sitemap.
4. Revisa `public/_redirects`, `public/_headers`, `public/llms.txt`.
5. Entrega tabla: hallazgo · evidencia (archivo:línea) · impacto · esfuerzo. No modifiques nada ni Google Business Profile.
