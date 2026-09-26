# TeamConnect 3.0

This build is the upgraded Chrome MV3 extension + WebSocket relay.

## Included sharing
- Highlighted text capture from webpages with no floating popup.
- Double-click selection is captured and copied to clipboard.
- Copy/paste text into TeamConnect.
- Drag/drop text, URLs, images and files into the drop zone.
- URL sharing.
- Image/file sharing.
- Large-file chunking with 48 KB chunks.
- AES-GCM encryption happens in the browser before data reaches the relay.
- Room key is distributed to members using ECDH.
- Incoming file chunks are stored in IndexedDB and reconstructed in the original order as one downloadable file.
- Screen Share button sends encrypted live tab snapshots about every 1.5 seconds. This is a snapshot stream, not a WebRTC video call.
- LAN / Windows hotspot mode.
- Cloud Relay mode.
- 6-digit Team Code with automatic join after the sixth digit.
- Alt+Shift+T custom Chrome command to open the side panel.
- No server IP or server URL is shown in the UI.

## Important Cloud setting

After deploying `server.js` on Render, edit `sidepanel.js`:

    const CLOUD_RELAY_URL = "wss://YOUR-TEAMCONNECT-SERVER.onrender.com";

Replace the placeholder with the real Render Web Service URL using `wss://`.

## LAN setup

Lead laptop:
1. Turn on Windows Mobile Hotspot.
2. Open PowerShell in this folder.
3. Run `npm.cmd install`
4. Run `npm.cmd start`
5. Load the extension in Chrome.
6. Select LAN / Hotspot.
7. Click Create Room.

Team members:
1. Connect to the Lead laptop hotspot.
2. Load the same extension.
3. Select LAN / Hotspot.
4. Click Join Room.
5. Enter the six-digit Team Code. The sixth digit joins automatically.

The LAN discovery list contains common Windows hotspot/router gateway addresses. If a network uses a different subnet, discovery may need that gateway added to LAN_HOSTS in sidepanel.js.

## Chrome extension install

1. Open chrome://extensions
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select this `teamconnect_v3` folder.
5. After every code change, click Reload for TeamConnect.

For the keyboard shortcut:
1. Open chrome://extensions/shortcuts
2. Find TeamConnect.
3. Confirm `Alt+Shift+T` is assigned to `Open TeamConnect`.
4. If Chrome reports a conflict, assign another shortcut.

## Render deployment

Upload this folder to a GitHub repository or otherwise connect the repository to Render.

Render:
- New -> Web Service
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Deploy

The relay listens on `process.env.PORT` and `0.0.0.0`, so it is compatible with Render.

## Security note

This is application-level end-to-end encryption for the demo: the browser encrypts content with AES-GCM before sending it and decrypts it only in receiving extension instances. The relay forwards ciphertext.

The relay is not a trusted cryptographic identity authority. A production security release should add authenticated member-key fingerprints/signatures and an independent security review. Do not present the prototype as audited cryptographic software.

## File transfer note

The transfer protocol chunks files and reassembles them by chunk index, preserving filename, MIME type and byte order. IndexedDB is used on the receiving side so the entire incoming transfer does not have to stay only in JavaScript memory.
