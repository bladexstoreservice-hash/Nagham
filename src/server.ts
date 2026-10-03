// src/server.ts
import http from 'node:http';

let server: http.Server | null = null;

export function startWebServer(): void {
  if (server) return;

  const PORT = Number(process.env.PORT) || 3000;

  server = http.createServer((req, res) => {
    // UptimeRobot + Render health check
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'Naghm Music Bot',
          uptime: Math.floor(process.uptime()),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Web server listening on 0.0.0.0:${PORT}`);
  });
}

export function stopWebServer(): void {
  if (server) {
    server.close(() => {
      console.log('[SERVER] Web server stopped');
    });
    server = null;
  }
}