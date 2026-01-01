import { NextRequest, NextResponse } from 'next/server';
import { getPRByUuid, getLatestDiff, updatePRStatus, getComments } from '@/lib/database';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/prs/[id] - Get PR details
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const pr = getPRByUuid(id);

    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    const diff = getLatestDiff(id);
    const comments = getComments(id);

    // Parse diff to get file list
    const files = parseDiffFiles(diff || '');

    return NextResponse.json({
      pr,
      diff,
      files,
      comments,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/prs/[id] - Update PR (status, etc)
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();

    const pr = getPRByUuid(id);
    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    if (body.status) {
      updatePRStatus(id, body.status);
    }

    const updatedPR = getPRByUuid(id);
    return NextResponse.json({ pr: updatedPR });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Parse diff to extract file information
function parseDiffFiles(diff: string): Array<{
  path: string;
  oldPath?: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}> {
  const files: Array<{
    path: string;
    oldPath?: string;
    changeType: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }> = [];

  // Split by diff headers
  const diffParts = diff.split(/^diff --git /m).filter(Boolean);

  for (const part of diffParts) {
    const lines = part.split('\n');
    const headerLine = lines[0];

    // Extract file paths from header: a/path b/path
    const pathMatch = headerLine.match(/a\/(.+?) b\/(.+)/);
    if (!pathMatch) continue;

    const oldPath = pathMatch[1];
    const newPath = pathMatch[2];

    // Determine change type
    let changeType: 'added' | 'modified' | 'deleted' | 'renamed' = 'modified';
    if (part.includes('new file mode')) {
      changeType = 'added';
    } else if (part.includes('deleted file mode')) {
      changeType = 'deleted';
    } else if (oldPath !== newPath) {
      changeType = 'renamed';
    }

    // Count additions and deletions
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    files.push({
      path: newPath,
      oldPath: changeType === 'renamed' ? oldPath : undefined,
      changeType,
      additions,
      deletions,
    });
  }

  return files;
}
