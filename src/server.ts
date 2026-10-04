// src/server.ts
import http from 'node:http';

export function startWebServer(): void {
  const PORT = Number(process.env.PORT) || 3000;

  const server = http.createServer((req, res) => {
    // Render health check endpoint
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Web server listening on port ${PORT}`);
  });
}

export function stopWebServer(): void {
  // We'll handle shutdown in index.ts by exiting the process directly.
}