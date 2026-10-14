#!/usr/bin/env node
// PreToolUse guard: blocks dangerous commands, secret access, prod deploys.
// Exit 2 = block (stderr is shown to Claude). Exit 0 = allow.
// Diseñado para NO bloquear auditorías, tests ni builds legítimos (falsos positivos).
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let ev;
  try { ev = JSON.parse(raw); } catch { process.exit(0); }
  const tool = ev.tool_name || "";
  const input = ev.tool_input || {};
  const block = (why) => {
    process.stderr.write(`BLOQUEADO por guard.js: ${why}. Pide autorización explícita al usuario.\n`);
    process.exit(2);
  };

  // Plantillas públicas sin secretos: .env.example / .sample / .template
  const SAFE_ENV = /\.env\.(example|sample|template)\b/;
  // Carpetas regenerables: borrarlas recursivamente es seguro
  const SAFE_RM = /(^|\/)(node_modules|dist|\.next|coverage|\.cache|test-results|playwright-report|\.turbo|\.vite)\/?$/;

  if (tool === "Bash") {
    let c = String(input.command || "");
    // Quita el cuerpo de heredocs (texto escrito a archivos) y los mensajes de commit/PR:
    // son datos, no comandos, y generan falsos positivos al mencionar "git push main", "rm -rf"...
    c = c.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, "<<HEREDOC");
    c = c.replace(/(git\s+commit\b[^\n;&|]*?\s-m\s*)("[^"]*"|'[^']*')/g, "$1MSG");
    c = c.replace(/(--(?:body|title|message)[= ])("[^"]*"|'[^']*')/g, "$1TXT");

    // rm recursivo: permitido solo sobre carpetas regenerables o /tmp
    for (const seg of c.split(/[;&|\n]+/)) {
      const m = seg.match(/^\s*(?:sudo\s+)?(?:\/bin\/)?rm\s+(.*)$/);
      if (!m) continue;
      const args = m[1].trim().split(/\s+/);
      const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === "--recursive");
      if (!recursive) continue;
      const targets = args.filter((a) => !a.startsWith("-"));
      const ok = targets.length > 0 && targets.every((t) => SAFE_RM.test(t) || /^\/tmp\//.test(t) || /\/scratchpad\//.test(t));
      if (!ok) block("borrado recursivo fuera de carpetas regenerables");
    }

    const rules = [
      [/\bgit\s+push\b[^\n]*(--force|\s-f\b|--force-with-lease)/, "git push forzado"],
      [/\bgit\s+push\b[^\n]*(\s|:|\/)(main|master)(\s|$)/, "push a rama de producción (main/master)"],
      [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|branch\s+-D)/, "operación git destructiva"],
      [/(^|[;&|]\s*)sudo\b|\bchmod\s+-R\s+777|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{/, "comando de sistema peligroso"],
      [/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, "ejecución de script remoto"],
      [/\b(netlify\s+deploy\s+--prod|vercel\s+(deploy\s+)?--prod|vercel\s+promote|render\s+deploys?\s+create)/, "despliegue a producción"],
      [/\bnpm\s+publish\b/, "publicación de paquete"],
      [/\bnpm\s+audit\s+fix\b[^\n]*--force/, "npm audit fix --force"],
      [/\bgh\s+secret\s+(set|delete|remove)/, "cambio de secretos de GitHub"],
    ];
    for (const [re, why] of rules) if (re.test(c)) block(why);

    // Lectura/copia de archivos de secretos (excepto plantillas .env.example)
    const secretRead = /(^|[\s;&|])(cat|less|more|head|tail|cp|mv|base64|strings|source|\.)\s+(?:[^\n;&|]*?[\s\/])?(\.env(\.[\w-]+)?(\s|$)|\.credentials\.json|credentials(\.json)?(\s|$)|id_rsa|[\w-]+\.pem(\s|$)|\.npmrc)/;
    const cc = c.replace(SAFE_ENV, "SAFE_TEMPLATE");
    if (secretRead.test(cc)) block("lectura/copia de archivos de secretos");
    if (/(^|[;&|]\s*)(printenv|env)\s*($|[|;&])/.test(c)) block("volcado de variables de entorno");
  }

  if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
    const p = String(input.file_path || input.notebook_path || "");
    const envFile = /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !SAFE_ENV.test(p);
    if (envFile || /(^|\/)\.credentials\.json$|(^|\/)credentials(\.json)?$|id_rsa|\.pem$|(^|\/)\.git\//.test(p)) block(`modificación de archivo sensible (${p})`);
    if (/\.github\/workflows\/.*\.ya?ml$/.test(p)) block("modificación de workflows de CI/CD (despliegue)");
  }

  // MCP: escrituras sobre producción / perfiles de empresa requieren aprobación explícita.
  // Permitido a propósito: Gmail create_draft / update_draft (borradores, NO envío).
  if (/^mcp__/.test(tool)) {
    if (/execute_action/.test(tool) && /google_my_business/.test(JSON.stringify(input))) block("escritura en Google Business Profile");
    if (/^mcp__(Gmail__(send_message|forward|reply)|Render__(trigger_deploy|update_environment_variables|query_render_postgres|create_.*)|Vercel__(create_deployment|request_promote|request_rollback|buy_domain|replace_domain_dns_records|update_record|create_record|create_project_env|edit_project_env)|Supabase__(apply_migration|execute_sql|delete_branch|merge_branch|reset_branch|pause_project|restore_project|deploy_edge_function|create_edge_function_secret)|Netlify__netlify-(deploy|project)-services-updater|github__(merge_pull_request|delete_file)|HubSpot__manage_|Windsor_ai__(execute_action|create_destination_task)|Cloudinary__delete-.*)/.test(tool)) {
      block(`acción MCP de escritura/producción (${tool})`);
    }
  }
  process.exit(0);
});
