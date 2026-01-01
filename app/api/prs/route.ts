import { NextRequest, NextResponse } from 'next/server';
import { listPRs, createPR, getPRByUuid, getLatestDiff } from '@/lib/database';
import { GitManager } from '@/lib/git';

// GET /api/prs - List all PRs
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const repoPath = searchParams.get('repo') || undefined;
    const status = searchParams.get('status') || undefined;
    const limitStr = searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    const prs = listPRs({ repoPath, status, limit });

    return NextResponse.json({ prs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/prs - Create a new PR
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { repoPath, title, description, baseRef, headRef } = body;

    if (!repoPath || !title || !baseRef || !headRef) {
      return NextResponse.json(
        { error: 'Missing required fields: repoPath, title, baseRef, headRef' },
        { status: 400 }
      );
    }

    // Get git info
    const git = new GitManager(repoPath);
    const baseCommit = await git.getCommitSha(baseRef);
    const headCommit = await git.getCommitSha(headRef);
    const diff = await git.getDiff(baseRef, headRef);

    // Create PR in database
    const uuid = createPR(
      repoPath,
      title,
      baseRef,
      headRef,
      baseCommit,
      headCommit,
      diff,
      description || ''
    );

    const pr = getPRByUuid(uuid);

    return NextResponse.json({
      uuid,
      pr,
      reviewUrl: `/prs/${uuid}`,
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
