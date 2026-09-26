const http = require("http");
const { WebSocketServer } = require("ws");

const PORT =
  Number(process.env.PORT) || 8080;

const HOST = "0.0.0.0";

const server =
  http.createServer(
    (req, res) => {

      if (
        req.url === "/health"
      ) {

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json"
          }
        );

        res.end(
          JSON.stringify({
            status: "ok",
            service:
              "TeamConnect Relay"
          })
        );

        return;
      }

      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain"
        }
      );

      res.end(
        "TeamConnect Relay is running."
      );
    }
  );

const wss =
  new WebSocketServer({
    server
  });

const rooms =
  new Map();

console.log(
  `TeamConnect server starting on ${HOST}:${PORT}`
);

/* -------------------------
   CONNECTION
------------------------- */

wss.on(
  "connection",
  ws => {

    ws.room = null;
    ws.username = null;

    ws.on(
      "message",
      raw => {

        let data;

        try {

          data =
            JSON.parse(
              raw.toString()
            );

        } catch (_) {

          return;
        }

        /* CREATE */

        if (
          data.type ===
          "CREATE_ROOM"
        ) {

          const room =
            String(
              data.room || ""
            );

          if (
            !/^\d{6}$/.test(room)
          ) {

            send(ws, {
              type:
                "ERROR",
              message:
                "Invalid room code"
            });

            return;
          }

          if (
            rooms.has(room)
          ) {

            send(ws, {
              type:
                "ROOM_EXISTS"
            });

            return;
          }

          const member = {
            ws,
            username:
              cleanName(
                data.username
              ),
            publicKey:
              data.publicKey
          };

          rooms.set(
            room,
            [member]
          );

          ws.room = room;
          ws.username =
            member.username;

          send(ws, {
            type:
              "ROOM_CREATED",
            room
          });

          broadcastMembers(
            room
          );

          return;
        }

        /* JOIN */

        if (
          data.type ===
          "JOIN_ROOM"
        ) {

          const room =
            String(
              data.room || ""
            );

          if (
            !rooms.has(room)
          ) {

            send(ws, {
              type:
                "ROOM_NOT_FOUND"
            });

            return;
          }

          const members =
            rooms.get(room);

          const member = {
            ws,
            username:
              cleanName(
                data.username
              ),
            publicKey:
              data.publicKey
          };

          members.push(
            member
          );

          ws.room = room;
          ws.username =
            member.username;

          send(ws, {
            type:
              "ROOM_JOINED",
            room
          });

          /* Give joining member
             every existing public key */

          for (
            const existing of members
          ) {

            if (
              existing.ws !== ws &&
              existing.publicKey
            ) {

              send(ws, {
                type:
                  "KEY_EXCHANGE",
                publicKey:
                  existing.publicKey
              });
            }
          }

          /* Give existing
             members the new key */

          if (
            member.publicKey
          ) {

            for (
              const existing of members
            ) {

              if (
                existing.ws !== ws
              ) {

                send(
                  existing.ws,
                  {
                    type:
                      "KEY_EXCHANGE",
                    publicKey:
                      member.publicKey
                  }
                );
              }
            }
          }

          broadcastMembers(
            room
          );

          return;
        }

        /* CONTENT */

        if (
          data.type ===
          "ENCRYPTED_CONTENT"
        ) {

          broadcastRoom(
            ws.room,
            {
              type:
                "ENCRYPTED_CONTENT",
              sender:
                ws.username,
              payload:
                data.payload
            },
            ws
          );

          return;
        }

        /* FILE START */

        if (
          data.type ===
          "FILE_START"
        ) {

          broadcastRoom(
            ws.room,
            {
              type:
                "FILE_START",
              sender:
                ws.username,
              transferId:
                data.transferId,
              name:
                data.name,
              size:
                data.size,
              mime:
                data.mime,
              totalChunks:
                data.totalChunks
            },
            ws
          );

          return;
        }

        /* FILE CHUNK */

        if (
          data.type ===
          "FILE_CHUNK"
        ) {

          broadcastRoom(
            ws.room,
            {
              type:
                "FILE_CHUNK",
              sender:
                ws.username,
              transferId:
                data.transferId,
              index:
                data.index,
              iv:
                data.iv,
              data:
                data.data
            },
            ws
          );

          return;
        }

        /* FILE END */

        if (
          data.type ===
          "FILE_END"
        ) {

          broadcastRoom(
            ws.room,
            {
              type:
                "FILE_END",
              sender:
                ws.username,
              transferId:
                data.transferId
            },
            ws
          );

          return;
        }
      }
    );

    ws.on(
      "close",
      () => {

        removeSocket(
          ws
        );
      }
    );

    ws.on(
      "error",
      () => {

        removeSocket(
          ws
        );
      }
    );
  }
);

/* -------------------------
   ROOM HELPERS
------------------------- */

function broadcastMembers(room) {

  const members =
    rooms.get(room);

  if (!members) return;

  const names =
    members.map(
      member =>
        member.username
    );

  for (
    const member of members
  ) {

    send(
      member.ws,
      {
        type:
          "ROOM_MEMBERS",
        members:
          names
      }
    );
  }
}

function broadcastRoom(
  room,
  payload,
  sender
) {

  const members =
    rooms.get(room);

  if (!members) return;

  for (
    const member of members
  ) {

    if (
      member.ws !== sender
    ) {

      send(
        member.ws,
        payload
      );
    }
  }
}

function removeSocket(ws) {

  const room =
    ws.room;

  if (!room) return;

  const members =
    rooms.get(room);

  if (!members) return;

  const remaining =
    members.filter(
      member =>
        member.ws !== ws
    );

  if (!remaining.length) {

    rooms.delete(
      room
    );

    return;
  }

  rooms.set(
    room,
    remaining
  );

  broadcastMembers(
    room
  );
}

function send(
  ws,
  payload
) {

  if (
    ws &&
    ws.readyState === 1
  ) {

    ws.send(
      JSON.stringify(
        payload
      )
    );
  }
}

function cleanName(name) {

  const value =
    String(
      name || "User"
    )
      .trim()
      .slice(0, 30);

  return value || "User";
}

/* -------------------------
   KEEPALIVE
------------------------- */

const heartbeat =
  setInterval(
    () => {

      for (
        const ws of wss.clients
      ) {

        if (
          ws.isAlive === false
        ) {

          ws.terminate();

          continue;
        }

        ws.isAlive = false;

        try {
          ws.ping();
        } catch (_) {}
      }

    },
    30000
  );

wss.on(
  "connection",
  ws => {

    ws.isAlive = true;

    ws.on(
      "pong",
      () => {
        ws.isAlive = true;
      }
    );
  }
);

process.on(
  "SIGTERM",
  () => {

    clearInterval(
      heartbeat
    );

    server.close(
      () => process.exit(0)
    );
  }
);

server.listen(
  PORT,
  HOST,
  () => {

    console.log(
      `🚀 TeamConnect Relay running on ${HOST}:${PORT}`
    );
  }
);