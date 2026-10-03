// ============================================================================
// DankoCore — the ONLY surface the MCP server may touch.
//
// This is a narrow, typed adapter over Danko product features. It deliberately
// exposes no shell, no arbitrary filesystem, no network. A concrete adapter
// binds this to the running app (via a local IPC/HTTP bridge) or to a
// read-only view of the library database.
//
// The default adapter below is NOT a fake: read tools return a structured
// "core-not-connected" result until a real adapter is attached, and no tool
// ever invents data or reports success it did not perform.
// ============================================================================

/**
 * @typedef {Object} CoreResult
 * @property {boolean} ok
 * @property {string} [reason]   // when ok=false
 * @property {any}    [data]     // when ok=true
 * @property {string} [message]
 */

const NOT_CONNECTED = Object.freeze({
  ok: false,
  reason: 'core-not-connected',
  message:
    'The Danko core is not attached to this MCP server. Start the app with the ' +
    'MCP bridge enabled, or provide a read-only DANKO_DB_PATH for query tools.',
});

/**
 * Base adapter. Every method returns a CoreResult. Subclasses override the
 * capabilities they can actually fulfil; unimplemented ones stay honest.
 */
export class DankoCore {
  /** @returns {Promise<CoreResult>} */ async searchLibrary() { return NOT_CONNECTED; }
  async getTrackMetadata() { return NOT_CONNECTED; }
  async analyzeAudio() { return NOT_CONNECTED; }
  async getConversionHistory() { return NOT_CONNECTED; }
  async listPresets() {
    // Presets are static product metadata, safe to answer without the app.
    return {
      ok: true,
      data: [
        { id: 'dj-mp3', name: 'DJ MP3', format: 'mp3', bitrate: 320 },
        { id: 'high-quality', name: 'High Quality', format: 'mp3', bitrate: 320 },
        { id: 'wav-master', name: 'WAV Master', format: 'wav' },
        { id: 'flac-archive', name: 'FLAC Archive', format: 'flac' },
        { id: 'custom', name: 'Custom', format: null },
      ],
    };
  }
  async convertAudio() { return NOT_CONNECTED; }
  async updateMetadata() { return NOT_CONNECTED; }
  async generateReport() { return NOT_CONNECTED; }
  async deleteTracks() { return NOT_CONNECTED; }
}

/**
 * Attach a real adapter here when wiring the app bridge. Kept as a factory so
 * the server file stays agnostic about how the core is reached.
 * @returns {DankoCore}
 */
export function createCore() {
  // A read-only SQLite adapter (sql.js) or an app IPC bridge adapter would be
  // constructed here based on env (e.g. DANKO_DB_PATH or DANKO_MCP_BRIDGE).
  return new DankoCore();
}
