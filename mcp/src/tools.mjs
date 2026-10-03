// ============================================================================
// Danko Music Converter — MCP tool catalog.
//
// SAFETY MODEL (do not weaken):
//   * Every tool maps 1:1 to a Danko product feature. There is NO tool for
//     running shell commands, reading arbitrary files, or deleting arbitrary
//     folders. The MCP server is a capability surface, not a computer gateway.
//   * Tools marked `destructive: true` MUST receive `confirm: true` in their
//     arguments or the server refuses and asks the client to confirm.
// ============================================================================

/** @typedef {{ name:string, title:string, description:string,
 *   destructive?:boolean, inputSchema:object, handler:string }} ToolDef */

/** @type {ToolDef[]} */
export const TOOLS = [
  {
    name: 'search_library',
    title: 'Search library',
    description: 'Search tracks in the local library by title, artist or album.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against title/artist/album.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: 'searchLibrary',
  },
  {
    name: 'get_track_metadata',
    title: 'Get track metadata',
    description: 'Return stored metadata for a single track by id.',
    inputSchema: {
      type: 'object',
      properties: { trackId: { type: 'string' } },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: 'getTrackMetadata',
  },
  {
    name: 'analyze_audio',
    title: 'Analyze audio',
    description: 'Return technical info for a track (duration, bitrate, sample rate, channels, format, size).',
    inputSchema: {
      type: 'object',
      properties: { trackId: { type: 'string' } },
      required: ['trackId'],
      additionalProperties: false,
    },
    handler: 'analyzeAudio',
  },
  {
    name: 'get_conversion_history',
    title: 'Get conversion history',
    description: 'List recent conversions (completed and failed).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 } },
      additionalProperties: false,
    },
    handler: 'getConversionHistory',
  },
  {
    name: 'list_presets',
    title: 'List presets',
    description: 'List available conversion presets (DJ MP3, High Quality, WAV Master, FLAC Archive, Custom).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: 'listPresets',
  },
  {
    name: 'convert_audio',
    title: 'Convert audio',
    description: 'Queue a conversion of one or more library tracks to a target format/preset. ' +
      'Non-destructive: it writes NEW files and never overwrites sources.',
    inputSchema: {
      type: 'object',
      properties: {
        trackIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        format: { type: 'string', enum: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'aiff'] },
        preset: { type: 'string' },
      },
      required: ['trackIds'],
      additionalProperties: false,
    },
    handler: 'convertAudio',
  },
  {
    name: 'update_metadata',
    title: 'Update metadata',
    description: 'Update editable metadata fields for a track. Does not delete the file.',
    inputSchema: {
      type: 'object',
      properties: {
        trackId: { type: 'string' },
        patch: {
          type: 'object',
          properties: {
            title: { type: 'string' }, artist: { type: 'string' }, album: { type: 'string' },
            year: { type: 'integer' }, genre: { type: 'string' }, trackNumber: { type: 'integer' },
            comment: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['trackId', 'patch'],
      additionalProperties: false,
    },
    handler: 'updateMetadata',
  },
  {
    name: 'generate_report',
    title: 'Generate library report',
    description: 'Summarize the library (counts, formats, total size, recent activity).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: 'generateReport',
  },
  // ---- Destructive: require explicit confirmation -------------------------
  {
    name: 'delete_tracks',
    title: 'Delete tracks from library',
    description: 'Remove tracks from the Danko LIBRARY (database entries). ' +
      'Requires `confirm: true`. Never deletes the user\'s audio files on disk.',
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: {
        trackIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        confirm: { type: 'boolean', description: 'Must be true to proceed.' },
      },
      required: ['trackIds'],
      additionalProperties: false,
    },
    handler: 'deleteTracks',
  },
];

export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
