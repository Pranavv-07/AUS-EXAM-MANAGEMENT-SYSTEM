import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { createApiApp, ensureDatabaseReady } from './server/app.ts';

const PORT = 3000;

async function startServer() {
  try {
    await ensureDatabaseReady();
  } catch (err) {
    console.warn('Database startup warning:', (err as Error).message);
  }

  const app = createApiApp();

  // Serve Vite dev middleware in development or static dist/ in production Node server
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProdBuild = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (!isProdBuild) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aditya University Exam Cell Server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Aditya University Exam Server:', err);
  process.exit(1);
});
