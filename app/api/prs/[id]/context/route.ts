import { NextRequest, NextResponse } from 'next/server';
import { getPRByUuid } from '@/lib/database';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Translate host paths to Docker paths if running in container
function translatePath(hostPath: string): string {
  const hostPrefix = process.env.HOST_PATH_PREFIX;
  if (hostPrefix && hostPath.startsWith('/Users/')) {
    // Extract the path after /Users/username/
    const parts = hostPath.split('/');
    const userPath = parts.slice(3).join('/'); // Skip /Users/username
    return path.join(hostPrefix, userPath);
  }
  return hostPath;
}

// GET /api/prs/[id]/context - Get additional context lines for a file
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const pr = getPRByUuid(id);

    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    const url = new URL(req.url);
    const filePath = url.searchParams.get('file');
    const startLine = parseInt(url.searchParams.get('start') || '1', 10);
    const endLine = parseInt(url.searchParams.get('end') || '20', 10);
    const commit = url.searchParams.get('commit') || pr.head_commit;

    if (!filePath) {
      return NextResponse.json({ error: 'file parameter required' }, { status: 400 });
    }

    const repoPath = translatePath(pr.repo_path);

    // Use git show to get file content at the specific commit
    try {
      const content = execSync(
        `git show ${commit}:${filePath}`,
        {
          cwd: repoPath,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024 // 10MB
        }
      );

      const lines = content.split('\n');
      const requestedLines = lines.slice(
        Math.max(0, startLine - 1),
        Math.min(lines.length, endLine)
      );

      return NextResponse.json({
        lines: requestedLines,
        startLine: Math.max(1, startLine),
        endLine: Math.min(lines.length, endLine),
        totalLines: lines.length,
      });
    } catch {
      // File might not exist in the commit (new file), try the working tree
      try {
        const fullPath = path.join(repoPath, filePath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const requestedLines = lines.slice(
          Math.max(0, startLine - 1),
          Math.min(lines.length, endLine)
        );

        return NextResponse.json({
          lines: requestedLines,
          startLine: Math.max(1, startLine),
          endLine: Math.min(lines.length, endLine),
          totalLines: lines.length,
        });
      } catch {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
