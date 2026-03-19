const http = require("http");
const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// HTTP server — serves bridge.html at GET /
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/bridge.html") {
    const file = path.join(__dirname, "bridge.html");
    if (fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404);
      res.end("bridge.html not found");
    }
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// Two WSS endpoints
const bridgeWss = new WebSocketServer({ noServer: true });
const foundryWss = new WebSocketServer({ noServer: true });

const bridgeClients = new Set();
const foundryClients = new Set();

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === "/bridge") {
    bridgeWss.handleUpgrade(req, socket, head, (ws) => {
      bridgeWss.emit("connection", ws, req);
    });
  } else if (pathname === "/foundry") {
    foundryWss.handleUpgrade(req, socket, head, (ws) => {
      foundryWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Bridge clients (React Native app / phone)
bridgeWss.on("connection", (ws) => {
  bridgeClients.add(ws);
  console.log(`[Bridge] Client connected (${bridgeClients.size} total)`);

  ws.on("message", (data) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      const extra = parsed.type === "roll" ? `result=${parsed.result} (${parsed.denomination})` : "";
      console.log(`[Bridge→Foundry] ${parsed.type}`, parsed.pixelId || "", extra);
    } catch {}
    // Forward to all foundry clients
    for (const client of foundryClients) {
      if (client.readyState === 1) client.send(msg);
    }
  });

  ws.on("close", () => {
    bridgeClients.delete(ws);
    console.log(`[Bridge] Client disconnected (${bridgeClients.size} total)`);
  });
});

// Foundry clients (FoundryVTT browser module)
foundryWss.on("connection", (ws) => {
  foundryClients.add(ws);
  console.log(`[Foundry] Client connected (${foundryClients.size} total)`);

  ws.on("message", (data) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      console.log(`[Foundry→Bridge] ${parsed.type}`, parsed.pixelId || "");
    } catch {}
    // Forward to all bridge clients
    for (const client of bridgeClients) {
      if (client.readyState === 1) client.send(msg);
    }
  });

  ws.on("close", () => {
    foundryClients.delete(ws);
    console.log(`[Foundry] Client disconnected (${foundryClients.size} total)`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pixels Bridge Relay running on http://0.0.0.0:${PORT}`);
  console.log(`  Bridge endpoint:  ws://localhost:${PORT}/bridge`);
  console.log(`  Foundry endpoint: ws://localhost:${PORT}/foundry`);
});
