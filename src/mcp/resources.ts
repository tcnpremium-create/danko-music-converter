// ============================================================================
// MCP resources + prompts: connector UI groundwork (MCP Apps) and ready-made
// prompts. Standard MCP mechanisms — the same catalog serves Claude and
// ChatGPT. The UI is optional: tools always work without it.
// ============================================================================

/** URI for the interactive results widget (referenced by read tools' _meta). */
export const RESULTS_UI_URI = 'ui://danko/results';

// Self-contained dark widget that renders a track list with actions. Hosts that
// support MCP Apps UI (e.g. ChatGPT Apps SDK) read the tool's structured output
// from window.openai?.toolOutput; otherwise the tool's JSON is used directly.
const RESULTS_UI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Danko Music</title>
<style>
  :root{--bg:#0e0e12;--card:#16161d;--line:#2a2a36;--txt:#e8e8f0;--dim:#9a9ab0;--accent:#7c5cff;--accent2:#22d3ee}
  *{box-sizing:border-box}body{margin:0;font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--txt);padding:12px}
  .head{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-weight:700}
  .logo{background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
  .row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);margin-bottom:6px}
  .row .meta{flex:1;min-width:0}.row .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row .s{color:var(--dim);font-size:12px}
  .pill{font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:1px 8px}
  .btns{display:flex;gap:6px}button{background:#20202b;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}
  button.primary{background:linear-gradient(135deg,var(--accent),#6b4cff);border:none}
  .empty{color:var(--dim);padding:16px;text-align:center}
</style></head>
<body>
  <div class="head"><span class="logo">🎧 DANKO MUSIC</span></div>
  <div id="list" class="empty">No results.</div>
  <script>
    function fmtDur(s){ if(!s&&s!==0)return''; const m=Math.floor(s/60),x=Math.floor(s%60); return m+':' + (x<10?'0':'')+x; }
    function callTool(name,args){ try{ window.openai&&window.openai.callTool&&window.openai.callTool(name,args); }catch(e){} }
    function render(data){
      var tracks = (data&&data.data&&data.data.tracks)||[];
      var el=document.getElementById('list');
      if(!tracks.length){ el.className='empty'; el.textContent='No results.'; return; }
      el.className=''; el.innerHTML='';
      tracks.forEach(function(t){
        var bpm = t.bpm?(' · '+t.bpm+' BPM'):'';
        var row=document.createElement('div'); row.className='row';
        row.innerHTML='<div class="meta"><div class="t">'+(t.artist||'')+' — '+(t.title||'')+'</div>'+
          '<div class="s">'+(t.format||'').toUpperCase()+' · '+fmtDur(t.durationSec)+(t.genre?(' · '+t.genre):'')+bpm+'</div></div>'+
          '<span class="pill">'+(t.hasLocalFile?'local':'metadata')+'</span>';
        var btns=document.createElement('div'); btns.className='btns';
        var a=document.createElement('button'); a.textContent='Analyze'; a.onclick=function(){callTool('analyze_audio',{trackId:t.id});};
        var c=document.createElement('button'); c.className='primary'; c.textContent='Convert'; c.onclick=function(){callTool('convert_audio',{trackIds:[t.id],preset:'mp3-320'});};
        btns.appendChild(a); btns.appendChild(c); row.appendChild(btns); el.appendChild(row);
      });
    }
    var out = (window.openai&&window.openai.toolOutput)|| null;
    if(out) render(out);
    window.addEventListener('message',function(e){ if(e.data&&e.data.type==='danko:data') render(e.data.payload); });
  </script>
</body></html>`;

export interface ResourceDef { uri: string; name: string; description: string; mimeType: string; text: string; }

export const RESOURCES: ResourceDef[] = [
  {
    uri: RESULTS_UI_URI,
    name: 'Danko results widget',
    description: 'Interactive track-list UI for MCP Apps hosts (renders search/library results with Analyze/Convert actions).',
    // OpenAI Apps SDK renders HTML UI resources declared with this media type.
    mimeType: 'text/html+skybridge',
    text: RESULTS_UI_HTML,
  },
];

export const RESOURCES_BY_URI: Record<string, ResourceDef> = Object.fromEntries(RESOURCES.map((r) => [r.uri, r]));

export interface PromptDef {
  name: string; title: string; description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  render: (args: Record<string, string>) => string;
}

export const PROMPTS: PromptDef[] = [
  {
    name: 'find_tracks',
    title: 'Find tracks',
    description: 'Find tracks in the library by style, decade and BPM range.',
    arguments: [
      { name: 'style', description: 'e.g. Makina, Techno, House', required: false },
      { name: 'decade', description: 'e.g. 90s', required: false },
      { name: 'bpm', description: 'e.g. 168-174', required: false },
    ],
    render: (a) => `Use Danko to search the library for ${a.style || 'tracks'}${a.decade ? ' from the ' + a.decade : ''}${a.bpm ? ' between ' + a.bpm + ' BPM' : ''}. Call search_library with the right filters and show the results.`,
  },
  {
    name: 'convert_selection',
    title: 'Convert selection',
    description: 'Convert the current selection to a target format/preset.',
    arguments: [{ name: 'format', description: 'wav, mp3, flac…', required: false }],
    render: (a) => `Convert the selected tracks to ${a.format || 'WAV'} using Danko (call convert_audio with the matching preset). Confirm how many files were produced.`,
  },
  {
    name: 'build_dj_set',
    title: 'Build a DJ set',
    description: 'Assemble a selection of a given length from the library.',
    arguments: [{ name: 'minutes', description: 'target length, e.g. 120', required: false }],
    render: (a) => `Build a DJ selection of about ${a.minutes || '120'} minutes from the Danko library: search_library for suitable tracks, check durations via get_track_metadata, and list the chosen order with the running total.`,
  },
];

export const PROMPTS_BY_NAME: Record<string, PromptDef> = Object.fromEntries(PROMPTS.map((p) => [p.name, p]));
