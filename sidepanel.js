/*
 * TEAMCONNECT 3.1
 *
 * Features:
 * - LAN / Hotspot
 * - Cloud Relay
 * - Create / Join room
 * - 6 digit automatic join
 * - Text sharing
 * - URL sharing
 * - Current page sharing
 * - File sharing
 * - Large file chunking
 * - AES-GCM encryption
 * - ECDH room key exchange
 * - IndexedDB file assembly
 * - Drag/drop
 * - Clipboard
 * - Screen snapshot sharing
 */

const CLOUD_RELAY_URL = "wss://teamconnect-3-1.onrender.com";

let ws = null;
const LAN_PORT = 8080;

const LAN_HOSTS = [
  "192.168.137.1",
  "192.168.43.1",
  "192.168.42.1",
  "192.168.1.1",
  "192.168.0.1",
  "10.0.0.1"
];

const CHUNK_SIZE = 48 * 1024;


let username = "User";
let roomCode = "";
let networkMode = "lan";

let roomKey = null;
let privateKey = null;
let publicKey = null;

let members = [];

let screenTimer = null;
let screenSharing = false;

const $ = id => document.getElementById(id);

const lobby = $("lobby");
const room = $("room");

function show(view) {
  lobby.classList.remove("active");
  room.classList.remove("active");
  view.classList.add("active");
}

function toast(message) {
  const el = $("toast");

  el.innerText = message;
  el.style.display = "block";

  setTimeout(() => {
    el.style.display = "none";
  }, 2200);
}

function setStatus(text) {
  $("screen-status").innerText = text || "";
}

function setNetwork(mode) {
  networkMode = mode;

  $("lan-box").classList.toggle(
    "active",
    mode === "lan"
  );

  $("cloud-box").classList.toggle(
    "active",
    mode === "cloud"
  );

  $("net-badge").innerText =
    mode === "lan"
      ? "LAN MODE"
      : "CLOUD RELAY";

  $("network-info").innerText =
    mode === "lan"
      ? "Lead: turn on Windows Mobile Hotspot and run the TeamConnect server. Other members connect to the hotspot and use the Team Code."
      : "Cloud Relay connects team members through the internet. No server address is shown here.";
}

$("username").value =
  localStorage.getItem("teamconnect_username") || "";

$("lan-box").onclick = () => setNetwork("lan");
$("cloud-box").onclick = () => setNetwork("cloud");

$("username").addEventListener("change", () => {
  localStorage.setItem(
    "teamconnect_username",
    $("username").value.trim()
  );
});

function generateRoomCode() {
  return Math.floor(
    100000 + Math.random() * 900000
  ).toString();
}

function renderRoomCode(code) {
  $("room-code").innerHTML = "";

  for (const digit of code) {
    const box = document.createElement("div");

    box.className = "room-digit";
    box.innerText = digit;

    $("room-code").appendChild(box);
  }
}

function getUsername() {
  return $("username").value.trim() || "User";
}

/* -------------------------
   CRYPTO
------------------------- */

async function createIdentity() {

  const keys =
    await crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256"
      },
      true,
      ["deriveKey"]
    );

  privateKey = keys.privateKey;
  publicKey = keys.publicKey;
}

async function exportPublicKey() {

  return crypto.subtle.exportKey(
    "jwk",
    publicKey
  );
}

async function importPublicKey(jwk) {

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    []
  );
}

async function deriveRoomKey(peerJwk) {

  const peerKey =
    await importPublicKey(peerJwk);

  return crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: peerKey
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(text) {

  if (!roomKey) {
    throw new Error("Encryption key not ready");
  }

  const iv =
    crypto.getRandomValues(
      new Uint8Array(12)
    );

  const data =
    new TextEncoder().encode(text);

  const encrypted =
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      roomKey,
      data
    );

  return {
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encrypted)
  };
}

async function decryptText(payload) {

  if (!roomKey) {
    throw new Error("Encryption key not ready");
  }

  const iv =
    base64ToUint8(payload.iv);

  const data =
    base64ToUint8(payload.data);

  const decrypted =
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv
      },
      roomKey,
      data
    );

  return new TextDecoder().decode(
    decrypted
  );
}

function arrayBufferToBase64(buffer) {

  const bytes =
    new Uint8Array(buffer);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToUint8(base64) {

  const binary =
    atob(base64);

  const bytes =
    new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}

/* -------------------------
   SERVER CONNECTION
------------------------- */

function getCloudURL() {

  if (
    !CLOUD_RELAY_URL ||
    CLOUD_RELAY_URL.includes(
      "YOUR-TEAMCONNECT"
    )
  ) {
    throw new Error(
      "Cloud Relay is not deployed yet."
    );
  }

  return CLOUD_RELAY_URL;
}

function openSocket(url) {

  return new Promise(
    (resolve, reject) => {

      let socket;

      try {
        socket =
          new WebSocket(url);
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;

      const timer =
        setTimeout(() => {

          if (!settled) {
            settled = true;
            socket.close();
            reject(
              new Error(
                "Connection timeout"
              )
            );
          }

        }, 7000);

      socket.onopen = () => {

        if (settled) return;

        settled = true;
        clearTimeout(timer);

        resolve(socket);
      };

      socket.onerror = () => {

        if (settled) return;

        settled = true;
        clearTimeout(timer);

        reject(
          new Error(
            "Could not connect to server"
          )
        );
      };
    }
  );
}

async function discoverLAN() {

  for (const host of LAN_HOSTS) {

    try {

      const socket =
        await openSocket(
          `ws://${host}:${LAN_PORT}`
        );

      return socket;

    } catch (_) {}
  }

  throw new Error(
    "TeamConnect server was not found on this hotspot."
  );
}

/* -------------------------
   CREATE ROOM
------------------------- */

$("create-room").onclick =
  async () => {

    username = getUsername();
    roomCode = generateRoomCode();

    localStorage.setItem(
      "teamconnect_username",
      username
    );

    try {

      if (ws) {
        try {
          ws.close();
        } catch (_) {}
      }

      ws =
        networkMode === "lan"
          ? await openSocket(
              `ws://127.0.0.1:${LAN_PORT}`
            )
          : await openSocket(
              getCloudURL()
            );

      await createIdentity();

      attachSocketHandlers(ws);

      ws.send(
        JSON.stringify({
          type: "CREATE_ROOM",
          room: roomCode,
          username,
          publicKey:
            await exportPublicKey()
        })
      );

    } catch (error) {

      alert(
        networkMode === "lan"
          ? "LAN Create Room failed.\n\nMake sure npm.cmd start is running on the Team Lead laptop."
          : error.message
      );
    }
  };

/* -------------------------
   JOIN ROOM
------------------------- */

$("join-room").onclick = () => {

  $("join-panel")
    .classList.remove("hidden");

  $("otpbox")[0]?.focus();

  document
    .querySelector(".otpbox")
    ?.focus();
};

const otpBoxes =
  [...document.querySelectorAll(
    ".otpbox"
  )];

otpBoxes.forEach(
  (box, index) => {

    box.addEventListener(
      "input",
      async () => {

        box.value =
          box.value
            .replace(/\D/g, "")
            .slice(0, 1);

        if (
          box.value &&
          index <
          otpBoxes.length - 1
        ) {
          otpBoxes[index + 1].focus();
        }

        const code =
          otpBoxes
            .map(x => x.value)
            .join("");

        if (
          code.length === 6
        ) {
          await joinRoom(code);
        }
      }
    );

    box.addEventListener(
      "keydown",
      event => {

        if (
          event.key === "Backspace" &&
          !box.value &&
          index > 0
        ) {
          otpBoxes[
            index - 1
          ].focus();
        }
      }
    );

    box.addEventListener(
      "paste",
      event => {

        event.preventDefault();

        const value =
          event.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);

        value
          .split("")
          .forEach(
            (digit, i) => {
              if (otpBoxes[i]) {
                otpBoxes[i].value =
                  digit;
              }
            }
          );

        if (
          value.length === 6
        ) {
          joinRoom(value);
        }
      }
    );
  }
);

async function joinRoom(code) {

  username = getUsername();
  roomCode = code;

  try {

    if (ws) {
      try {
        ws.close();
      } catch (_) {}
    }

    if (networkMode === "lan") {

      ws =
        await discoverLAN();

    } else {

      ws =
        await openSocket(
          getCloudURL()
        );
    }

    await createIdentity();

    attachSocketHandlers(ws);

    ws.send(
      JSON.stringify({
        type: "JOIN_ROOM",
        room: roomCode,
        username,
        publicKey:
          await exportPublicKey()
      })
    );

  } catch (error) {

    alert(
      error.message ||
      "Could not join room."
    );
  }
}

/* -------------------------
   SOCKET EVENTS
------------------------- */

function attachSocketHandlers(socket) {

  socket.onmessage =
    async event => {

      let message;

      try {
        message =
          JSON.parse(
            event.data
          );
      } catch (_) {
        return;
      }

      if (
        message.type ===
        "ROOM_CREATED"
      ) {

        roomCode =
          message.room;

        renderRoomCode(
          roomCode
        );

        show(room);

        toast(
          "Room created ✓"
        );

        return;
      }

      if (
        message.type ===
        "ROOM_JOINED"
      ) {

        roomCode =
          message.room;

        renderRoomCode(
          roomCode
        );

        show(room);

        toast(
          "Joined team ✓"
        );

        return;
      }

      if (
        message.type ===
        "ROOM_NOT_FOUND"
      ) {

        alert(
          "Team Code not found."
        );

        return;
      }

      if (
        message.type ===
        "ROOM_EXISTS"
      ) {

        alert(
          "Room already exists. Please create again."
        );

        return;
      }

      if (
        message.type ===
        "ROOM_MEMBERS"
      ) {

        members =
          message.members || [];

        renderMembers();

        return;
      }

      if (
        message.type ===
        "KEY_EXCHANGE"
      ) {

        try {

          roomKey =
            await deriveRoomKey(
              message.publicKey
            );

          socket.send(
            JSON.stringify({
              type:
                "KEY_READY"
            })
          );

        } catch (error) {

          console.error(
            "Key exchange failed",
            error
          );
        }

        return;
      }

      if (
        message.type ===
        "ENCRYPTED_CONTENT"
      ) {

        await handleEncryptedContent(
          message
        );

        return;
      }

      if (
        message.type ===
        "FILE_START"
      ) {

        await receiveFileStart(
          message
        );

        return;
      }

      if (
        message.type ===
        "FILE_CHUNK"
      ) {

        await receiveFileChunk(
          message
        );

        return;
      }

      if (
        message.type ===
        "FILE_END"
      ) {

        await receiveFileEnd(
          message
        );

        return;
      }
    };

  socket.onclose =
    () => {

      if (
        room.classList.contains(
          "active"
        )
      ) {
        toast(
          "Connection closed"
        );
      }
    };
}

/* -------------------------
   MEMBERS
------------------------- */

function renderMembers() {

  $("member-count").innerText =
    members.length;

  $("members").innerHTML = "";

  members.forEach(
    member => {

      const div =
        document.createElement(
          "div"
        );

      div.className =
        "member";

      div.innerHTML = `
        <span class="member-name">
          👤 ${escapeHTML(member)}
        </span>
        <span class="online">
          ● Online
        </span>
      `;

      $("members")
        .appendChild(div);
    }
  );
}

/* -------------------------
   QUICK SHARE
------------------------- */

function showPreview(text) {

  $("quick-preview")
    .innerText =
    text || "Ready to share.";
}

async function shareEncryptedObject(
  object
) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    toast("Not connected");
    return;
  }

  if (!roomKey) {

    toast(
      "Waiting for encryption..."
    );

    return;
  }

  const encrypted =
    await encryptText(
      JSON.stringify(object)
    );

  ws.send(
    JSON.stringify({
      type:
        "ENCRYPTED_CONTENT",
      sender:
        username,
      room:
        roomCode,
      payload:
        encrypted
    })
  );
}

/* Selected text */

chrome.storage.onChanged.addListener(
  changes => {

    if (
      changes.pendingShare?.newValue
    ) {

      const data =
        changes.pendingShare
          .newValue;

      showPreview(
        `Selected text:\n${data.text}`
      );
    }
  }
);

/* Current page */

async function getCurrentTab() {

  const tabs =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  return tabs[0];
}

$("send-page").onclick =
  async () => {

    const tab =
      await getCurrentTab();

    if (!tab) return;

    await shareEncryptedObject({
      kind: "WEBPAGE",
      title:
        tab.title || "Web Page",
      url:
        tab.url || ""
    });

    showPreview(
      `Page: ${tab.title}`
    );

    toast(
      "Page shared ✓"
    );
  };

$("send-url").onclick =
  async () => {

    const tab =
      await getCurrentTab();

    if (!tab?.url) return;

    await shareEncryptedObject({
      kind: "URL",
      url: tab.url,
      title:
        tab.title || tab.url
    });

    toast(
      "URL shared ✓"
    );
  };

/* Clipboard */

$("paste-btn").onclick =
  async () => {

    try {

      const text =
        await navigator.clipboard
          .readText();

      if (!text) {
        toast("Clipboard empty");
        return;
      }

      showPreview(text);

      await shareEncryptedObject({
        kind: "TEXT",
        text
      });

      toast(
        "Clipboard shared ✓"
      );

    } catch (error) {

      alert(
        "Clipboard permission is required."
      );
    }
  };

/* Send text */

$("send-text").onclick =
  async () => {

    const text =
      prompt(
        "Enter text to share:"
      );

    if (!text) return;

    showPreview(text);

    await shareEncryptedObject({
      kind: "TEXT",
      text
    });

    toast(
      "Text shared ✓"
    );
  };

/* -------------------------
   DROP ZONE
------------------------- */

$("dropzone").onclick =
  () => {

    $("file-input").click();
  };

$("file-input").onchange =
  async event => {

    const files =
      [...event.target.files];

    for (const file of files) {

      await sendFile(file);
    }

    event.target.value = "";
  };

$("dropzone").ondragover =
  event => {

    event.preventDefault();

    $("dropzone")
      .classList.add("drag");
  };

$("dropzone").ondragleave =
  () => {

    $("dropzone")
      .classList.remove("drag");
  };

$("dropzone").ondrop =
  async event => {

    event.preventDefault();

    $("dropzone")
      .classList.remove("drag");

    const files =
      [...event.dataTransfer.files];

    if (files.length) {

      for (const file of files) {

        await sendFile(file);
      }

      return;
    }

    const text =
      event.dataTransfer.getData(
        "text/plain"
      );

    if (text) {

      showPreview(text);

      await shareEncryptedObject({
        kind:
          /^https?:\/\//i.test(text)
            ? "URL"
            : "TEXT",
        text,
        url:
          /^https?:\/\//i.test(text)
            ? text
            : ""
      });

      toast(
        "Dropped content shared ✓"
      );
    }
  };

/* -------------------------
   FILE SENDING
------------------------- */

async function sendFile(file) {

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast("Not connected");
    return;
  }

  if (!roomKey) {
    toast("Encryption not ready");
    return;
  }

  const transferId =
    crypto.randomUUID();

  const totalChunks =
    Math.ceil(
      file.size /
      CHUNK_SIZE
    );

  ws.send(
    JSON.stringify({
      type:
        "FILE_START",
      sender:
        username,
      transferId,
      name:
        file.name,
      size:
        file.size,
      mime:
        file.type ||
        "application/octet-stream",
      totalChunks
    })
  );

  for (
    let index = 0;
    index < totalChunks;
    index++
  ) {

    const start =
      index * CHUNK_SIZE;

    const end =
      Math.min(
        start + CHUNK_SIZE,
        file.size
      );

    const buffer =
      await file.slice(
        start,
        end
      ).arrayBuffer();

    const iv =
      crypto.getRandomValues(
        new Uint8Array(12)
      );

    const encrypted =
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv
        },
        roomKey,
        buffer
      );

    ws.send(
      JSON.stringify({
        type:
          "FILE_CHUNK",
        sender:
          username,
        transferId,
        index,
        iv:
          arrayBufferToBase64(iv),
        data:
          arrayBufferToBase64(
            encrypted
          )
      })
    );

    const progress =
      Math.round(
        ((index + 1) /
          totalChunks) *
        100
      );

    showPreview(
      `Sending ${file.name} — ${progress}%`
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          0
        )
    );
  }

  ws.send(
    JSON.stringify({
      type:
        "FILE_END",
      sender:
        username,
      transferId
    })
  );

  toast(
    `${file.name} sent ✓`
  );
}

/* -------------------------
   FILE RECEIVE
------------------------- */

const incomingTransfers =
  new Map();

async function receiveFileStart(
  message
) {

  incomingTransfers.set(
    message.transferId,
    {
      name:
        message.name,
      size:
        message.size,
      mime:
        message.mime,
      totalChunks:
        message.totalChunks,
      chunks:
        new Array(
          message.totalChunks
        ),
      received: 0
    }
  );

  addFeedMessage(
    message.sender,
    `Receiving ${message.name}...`
  );
}

async function receiveFileChunk(
  message
) {

  const transfer =
    incomingTransfers.get(
      message.transferId
    );

  if (!transfer) return;

  try {

    const decrypted =
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv:
            base64ToUint8(
              message.iv
            )
        },
        roomKey,
        base64ToUint8(
          message.data
        )
      );

    transfer.chunks[
      message.index
    ] = decrypted;

    transfer.received++;

    const progress =
      Math.round(
        (transfer.received /
          transfer.totalChunks) *
        100
      );

    showPreview(
      `Receiving ${transfer.name} — ${progress}%`
    );

  } catch (error) {

    console.error(
      "File chunk decrypt error",
      error
    );
  }
}

async function receiveFileEnd(
  message
) {

  const transfer =
    incomingTransfers.get(
      message.transferId
    );

  if (!transfer) return;

  try {

    const blob =
      new Blob(
        transfer.chunks,
        {
          type:
            transfer.mime
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const card =
      document.createElement(
        "div"
      );

    card.className =
      "feed";

    card.innerHTML = `
      <div class="feed-head">
        👤 ${escapeHTML(
          message.sender || "Team"
        )}
      </div>

      <div class="feed-body">
        📁 ${escapeHTML(
          transfer.name
        )}
        <br>
        ${formatBytes(
          transfer.size
        )}
      </div>

      <button>
        ⬇ Download File
      </button>
    `;

    card.querySelector(
      "button"
    ).onclick = () => {

      const a =
        document.createElement(
          "a"
        );

      a.href = url;
      a.download =
        transfer.name;

      a.click();
    };

    $("feed")
      .prepend(card);

    incomingTransfers.delete(
      message.transferId
    );

    toast(
      `${transfer.name} received ✓`
    );

  } catch (error) {

    console.error(
      "File reconstruction failed",
      error
    );
  }
}

/* -------------------------
   ENCRYPTED CONTENT RECEIVE
------------------------- */

async function handleEncryptedContent(
  message
) {

  try {

    const raw =
      await decryptText(
        message.payload
      );

    const content =
      JSON.parse(raw);

    const sender =
      message.sender ||
      "Team member";

    if (
      content.kind === "TEXT"
    ) {

      addFeedMessage(
        sender,
        content.text,
        true
      );

    } else if (
      content.kind === "URL"
    ) {

      addFeedURL(
        sender,
        content.url,
        content.title
      );

    } else if (
      content.kind === "WEBPAGE"
    ) {

      addFeedURL(
        sender,
        content.url,
        content.title
      );

    } else if (
      content.kind === "SCREEN"
    ) {

      showScreenFrame(
        content.image
      );
    }

  } catch (error) {

    console.error(
      "Encrypted content error",
      error
    );
  }
}

/* -------------------------
   FEED
------------------------- */

function addFeedMessage(
  sender,
  text,
  copyButton = false
) {

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "feed";

  card.innerHTML = `
    <div class="feed-head">
      👤 ${escapeHTML(sender)}
    </div>

    <div class="feed-body">
      ${escapeHTML(text)}
    </div>

    ${
      copyButton
        ? "<button>📋 Copy</button>"
        : ""
    }
  `;

  if (copyButton) {

    card.querySelector(
      "button"
    ).onclick =
      async () => {

        await navigator.clipboard
          .writeText(text);

        toast(
          "Copied ✓"
        );
      };
  }

  $("feed")
    .prepend(card);
}

function addFeedURL(
  sender,
  url,
  title
) {

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "feed";

  card.innerHTML = `
    <div class="feed-head">
      👤 ${escapeHTML(sender)}
    </div>

    <div class="feed-body">
      🔗 ${escapeHTML(
        title || url
      )}
    </div>

    <button>🌐 Open</button>
    <button>📋 Copy URL</button>
  `;

  const buttons =
    card.querySelectorAll(
      "button"
    );

  buttons[0].onclick = () => {

    chrome.tabs.create({
      url
    });
  };

  buttons[1].onclick =
    async () => {

      await navigator.clipboard
        .writeText(url);

      toast(
        "URL copied ✓"
      );
    };

  $("feed")
    .prepend(card);
}

/* -------------------------
   SCREEN SHARE
   Snapshot based
------------------------- */

$("screen-btn").onclick =
  async () => {

    if (screenSharing) {

      stopScreenShare();

      return;
    }

    try {

      await startScreenShare();

    } catch (error) {

      console.error(error);

      alert(
        "Screen sharing could not start."
      );
    }
  };

async function startScreenShare() {

  screenSharing = true;

  $("screen-btn")
    .innerText =
    "⏹ Stop Screen Share";

  setStatus(
    "Screen sharing active..."
  );

  const capture =
    async () => {

      if (!screenSharing) return;

      try {

        const data =
          await chrome.tabs.captureVisibleTab(
            null,
            {
              format: "jpeg",
              quality: 45
            }
          );

        await shareEncryptedObject({
          kind:
            "SCREEN",
          image:
            data
        });

        $("screen-preview").src =
          data;

        $("screen-preview").style.display =
          "block";

      } catch (error) {

        console.error(
          "Screen capture error",
          error
        );
      }
    };

  await capture();

  screenTimer =
    setInterval(
      capture,
      1500
    );
}

function stopScreenShare() {

  screenSharing = false;

  if (screenTimer) {

    clearInterval(
      screenTimer
    );

    screenTimer = null;
  }

  $("screen-btn")
    .innerText =
    "🖥️ Screen Share";

  setStatus(
    "Screen sharing stopped."
  );
}

function showScreenFrame(image) {

  let existing =
    document.getElementById(
      "incoming-screen"
    );

  if (!existing) {

    existing =
      document.createElement(
        "img"
      );

    existing.id =
      "incoming-screen";

    existing.style.width =
      "100%";

    existing.style.borderRadius =
      "7px";

    existing.style.marginTop =
      "7px";

    $("feed")
      .prepend(existing);
  }

  existing.src =
    image;
}

/* -------------------------
   LEAVE
------------------------- */

$("leave").onclick =
  () => {

    stopScreenShare();

    if (ws) {

      try {
        ws.close();
      } catch (_) {}
    }

    ws = null;
    roomKey = null;
    roomCode = "";

    $("feed").innerHTML = "";
    $("members").innerHTML = "";

    otpBoxes.forEach(
      box => box.value = ""
    );

    $("join-panel")
      .classList.add(
        "hidden"
      );

    show(lobby);

    toast(
      "Left room"
    );
  };

/* -------------------------
   HELPERS
------------------------- */

function escapeHTML(value) {

  return String(value ?? "")
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function formatBytes(bytes) {

  if (!bytes) return "0 B";

  const units =
    [
      "B",
      "KB",
      "MB",
      "GB"
    ];

  const index =
    Math.floor(
      Math.log(bytes) /
      Math.log(1024)
    );

  return (
    (bytes /
      Math.pow(
        1024,
        index
      )).toFixed(2) +
    " " +
    units[index]
  );
}

/* -------------------------
   INITIAL PENDING SELECTION
------------------------- */

chrome.storage.local.get(
  "pendingShare",
  data => {

    if (
      data.pendingShare
    ) {

      const share =
        data.pendingShare;

      showPreview(
        `Selected text:\n${share.text}`
      );

      chrome.storage.local.remove(
        "pendingShare"
      );
    }
  }
);
