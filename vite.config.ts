import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { defineConfig, type Plugin } from 'vite';
import { app } from './src/server/index.ts';
import type { D1Database, D1PreparedStatement } from './src/server/db.ts';

function createLocalD1Database(dbFilePath: string): D1Database {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const sqlite = new DatabaseSync(dbFilePath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  return {
    prepare(query: string): D1PreparedStatement {
      let boundValues: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]) {
          boundValues = values.map((v) => (v === undefined ? null : v));
          return stmt;
        },
        async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
          const prepared = sqlite.prepare(query);
          const row = prepared.get(...(boundValues as never[])) as Record<string, unknown> | undefined;
          if (!row) return null;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        },
        async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
          const prepared = sqlite.prepare(query);
          const rows = prepared.all(...(boundValues as never[])) as T[];
          return { results: rows ?? [] };
        },
        async run(): Promise<{ success: boolean }> {
          const prepared = sqlite.prepare(query);
          prepared.run(...(boundValues as never[]));
          return { success: true };
        },
      };
      return stmt;
    },
    async exec(query: string): Promise<unknown> {
      sqlite.exec(query);
      return { ok: true };
    },
  };
}

function createApiMiddleware(db: D1Database) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/api/')) {
      next();
      return;
    }

    try {
      const protocol = 'http';
      const host = req.headers.host || 'localhost:5173';
      const url = `${protocol}://${host}${req.url}`;

      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (Array.isArray(val)) {
          for (const v of val) headers.append(key, v);
        } else if (typeof val === 'string') {
          headers.set(key, val);
        }
      }

      const method = req.method || 'GET';
      let body: Uint8Array | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        body = new Uint8Array(Buffer.concat(chunks));
      }

      const webReq = new Request(url, {
        method,
        headers,
        body: body ? (body.buffer as ArrayBuffer) : undefined,
      });

      const webRes = await app.fetch(webReq, { DB: db });
      res.statusCode = webRes.status;

      const setCookies = webRes.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        res.setHeader('set-cookie', setCookies);
      }

      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        res.setHeader(key, value);
      });

      const arrayBuf = await webRes.arrayBuffer();
      res.end(Buffer.from(arrayBuf));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal Server Error' }));
    }
  };
}

function cloudflareLocalD1Plugin(): Plugin {
  let db: D1Database | null = null;
  const getDb = () => {
    if (!db) {
      const dbPath = path.resolve(process.cwd(), '.wrangler/state/d1-local.sqlite');
      db = createLocalD1Database(dbPath);
    }
    return db;
  };

  return {
    name: 'cloudflare-local-d1-api',
    configureServer(server) {
      server.middlewares.use(createApiMiddleware(getDb()));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createApiMiddleware(getDb()));
    },
  };
}

export default defineConfig({
  plugins: [cloudflareLocalD1Plugin()],
});
