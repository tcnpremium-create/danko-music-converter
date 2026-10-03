// ============================================================================
// Danko Music Converter — MCP tool catalog (single shared toolset).
//
// SAFETY MODEL (do not weaken):
//   * Every tool maps 1:1 to a Danko product feature. There is NO tool to run
//     shell commands, execute arbitrary code, or read/delete arbitrary files.
//     The server is a capability surface, not a computer gateway.
//   * Tools with `destructive: true` require `confirm: true` or the server
//     refuses and asks the client to confirm.
//   * Read tools are marked `readOnly: true`.
// ============================================================================

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  readOnly?: boolean;
  destructive?: boolean;
  inputSchema: Record<string, unknown>;
  /** Method name on DankoCore. */
  handler:
    | 'searchLibrary' | 'getTrackMetadata' | 'analyzeAudio' | 'convertAudio'
    | 'getConversionHistory' | 'listPresets' | 'generateReport'
    | 'updateMetadata' | 'deleteTracks';
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});

export const TOOLS: ToolDef[] = [
  {
    name: 'search_library',
    title: 'Search library',
    description:
      'Search tracks in the local library. Filters: query (text over title/artist/album), ' +
      'artist, title, genre, year, format, folder, min/max duration (seconds), and bpm range ' +
      '(bpm filtering applies only to tracks whose BPM is already known).',
    readOnly: true,
    inputSchema: obj({
      query: { type: 'string' },
      artist: { type: 'string' },
      title: { type: 'string' },
      genre: { type: 'string' },
      year: { type: 'integer' },
      format: { type: 'string', enum: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'aiff', 'ogg'] },
      folder: { type: 'string', description: 'Match tracks whose source path contains this substring.' },
      minDurationSec: { type: 'number' },
      maxDurationSec: { type: 'number' },
      bpmMin: { type: 'number' },
      bpmMax: { type: 'number' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    }),
    handler: 'searchLibrary',
  },
  {
    name: 'get_track_metadata',
    title: 'Get track metadata',
    description: 'Return stored metadata and technical fields for a single track by id.',
    readOnly: true,
    inputSchema: obj({ trackId: { type: 'string' } }, ['trackId']),
    handler: 'getTrackMetadata',
  },
  {
    name: 'analyze_audio',
    title: 'Analyze audio',
    description:
      'Analyze a track file: duration, format, codec, bitrate, sample rate, channels, size. ' +
      'BPM/key/loudness are returned only when actually computed (null otherwise — never invented).',
    readOnly: true,
    inputSchema: obj({ trackId: { type: 'string' } }, ['trackId']),
    handler: 'analyzeAudio',
  },
  {
    name: 'convert_audio',
    title: 'Convert audio',
    description:
      'Queue a real FFmpeg conversion of one or more tracks to a target format or preset. ' +
      'Writes NEW files; never overwrites or deletes the sources. Set wait:true to block until done.',
    inputSchema: obj({
      trackIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      format: { type: 'string', enum: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'aiff'] },
      preset: { type: 'string', description: 'Preset id from list_presets (overrides format).' },
      wait: { type: 'boolean', default: false },
    }, ['trackIds']),
    handler: 'convertAudio',
  },
  {
    name: 'get_conversion_history',
    title: 'Get conversion history',
    description: 'List recent conversions (completed and failed) from the local database.',
    readOnly: true,
    inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 } }),
    handler: 'getConversionHistory',
  },
  {
    name: 'list_presets',
    title: 'List presets',
    description: 'List real DJ-oriented conversion presets.',
    readOnly: true,
    inputSchema: obj({}),
    handler: 'listPresets',
  },
  {
    name: 'generate_report',
    title: 'Generate library report',
    description: 'Summarize the library: track count, formats, total size, conversions and recent activity.',
    readOnly: true,
    inputSchema: obj({}),
    handler: 'generateReport',
  },
  {
    name: 'update_metadata',
    title: 'Update metadata',
    description: 'Update editable metadata fields for a track. Requires confirm:true. Never deletes files.',
    destructive: true,
    inputSchema: obj({
      trackId: { type: 'string' },
      patch: obj({
        title: { type: 'string' }, artist: { type: 'string' }, album: { type: 'string' },
        year: { type: 'integer' }, genre: { type: 'string' }, trackNumber: { type: 'integer' },
        comment: { type: 'string' },
      }),
      confirm: { type: 'boolean' },
    }, ['trackId', 'patch']),
    handler: 'updateMetadata',
  },
  {
    name: 'delete_tracks',
    title: 'Delete tracks from library',
    description:
      'Remove tracks from the Danko LIBRARY (database entries only). Requires confirm:true. ' +
      'Never deletes the user\'s audio files on disk.',
    destructive: true,
    inputSchema: obj({
      trackIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      confirm: { type: 'boolean' },
    }, ['trackIds']),
    handler: 'deleteTracks',
  },
];

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
