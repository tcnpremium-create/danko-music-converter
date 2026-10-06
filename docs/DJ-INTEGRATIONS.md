# DJ integrations: current capabilities

## VirtualDJ local playlists

In Danko's Playlists page, choose **Exportar a VirtualDJ**. Import local audio
or finish conversions first. Danko validates each file and preserves playlist
order. When a converted output exists it is preferred; otherwise the existing
source is used. Missing files, empty files, unsupported extensions and duplicate
references to the same file are reported. Distinct remixes remain separate.

The save dialog offers VirtualDJ's existing `MyLists` directory when available.
The generated `.vdjfolder` references the audio on this computer. Existing files
are never overwritten. Original audio and VirtualDJ's database are not edited.
No BPM, key, cues or beatgrids are invented or exported in this first adapter.

This is a **local playlist export**, not an online-source plugin or streaming
catalog. It does not transfer audio to another computer. Playback and library
visibility must be verified in the target VirtualDJ installation.

## Other targets

rekordbox, Engine DJ and standalone Pioneer/Denon devices are not integrated
yet. Compatibility must be validated per application version and device model.
Do not label a generic playlist file as a prepared CDJ/Engine USB library.

The next development step is a VirtualDJ Online Source adapter, using the
manufacturer's SDK. It requires a scoped local library API, per-client
authorization and testing in VirtualDJ before release. A hosted audio catalog
is a separate product requiring authorized content and managed infrastructure.

The desktop/local-export workflow requires no user-operated server. The optional
hosted MCP is managed on Render and does not automatically access local music.
