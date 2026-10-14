# Sistema multiagente — Danko Music Converter — software musical

Repo **público**: nunca commitear secretos ni datos personales. No ampliar las herramientas MCP más allá de lo que describe `SECURITY.md` sin autorización.

## Agentes (`.claude/agents/`)
`arquitecto-web` · `especialista-seo` · `automatizacion-empresarial` · `seguridad-informatica` (solo lectura) · `marketing-conversion` · `testing-calidad`.
Tras cualquier cambio de código invoca `testing-calidad`; antes de cambios grandes usa la skill `restore-point`.
Skills: `seo-audit`, `lead-automation-check`, `qa-report`, `restore-point`. Hooks: `guard.js` (pre-herramienta) y `post-edit-check.sh` (post-edición); pruebas del guard: `bash .claude/hooks/guard.test.sh`.

Perfil del proyecto: `.claude/project.md`.

## Límites (obligatorios)
- No cambiar el aspecto visual ni los precios comerciales sin autorización expresa; no alterar formularios que funcionan salvo reparación necesaria y comprobada.
- No modificar Google Maps ni Google Business Profile (solo lectura).
- No borrar archivos importantes; no cambiar contraseñas/secretos; no leer ni imprimir valores de secretos.
- No enviar correos ni mensajes comerciales: solo borradores (Gmail `create_draft`); el envío está denegado y bloqueado por hook.
- No desplegar a producción ni tocar `main`/`master`: trabajar en ramas `claude/*` y preparar cambios para revisión.
- Informar siempre de las pruebas ejecutadas y su resultado real (no marcar OK lo no ejecutado).
- Controles de seguridad (`.claude/hooks/guard.js`, `.claude/settings.json`) no se desactivan ni se rodean.
- Aislamiento: este repo es SOLO el proyecto descrito en `.claude/project.md`. No usar repos, credenciales, BBDD, servicios Render/Vercel/Netlify/Supabase ni configuración de otros proyectos.
