import type { Request, Response } from 'express';
import { createApiApp } from '../server/app.ts';

const app = createApiApp();

export default function handler(req: Request, res: Response) {
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'https://localhost');
      const rewrittenPath = parsed.searchParams.get('__path');
      if (rewrittenPath) {
        parsed.searchParams.delete('__path');
        const qs = parsed.searchParams.toString();
        const normalizedPath = rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
        req.url = qs ? `${normalizedPath}?${qs}` : normalizedPath;
      }
    } catch {
      // Preserve original req.url if parsing fails
    }
  }
  return app(req, res);
}
