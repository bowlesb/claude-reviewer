import { NextRequest, NextResponse } from 'next/server';
import { getPRByUuid, updatePRStatus } from '@/lib/database';
import { GitManager } from '@/lib/git';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/prs/[id]/merge - Merge an approved PR
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { push = true, deleteBranch = false } = body;

    const pr = getPRByUuid(id);
    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    if (pr.status !== 'approved') {
      return NextResponse.json(
        { error: `PR is not approved (current status: ${pr.status})` },
        { status: 400 }
      );
    }

    const git = new GitManager(pr.repo_path);

    // Check for uncommitted changes
    const isDirty = await git.isDirty();
    if (isDirty) {
      return NextResponse.json(
        { error: 'Repository has uncommitted changes. Commit or stash them first.' },
        { status: 400 }
      );
    }

    // Perform merge
    const mergeResult = await git.merge(pr.head_ref, pr.base_ref);
    if (!mergeResult.success) {
      return NextResponse.json(
        { error: `Merge failed: ${mergeResult.message}` },
        { status: 500 }
      );
    }

    const results: string[] = [mergeResult.message];

    // Push if requested
    if (push) {
      const pushResult = await git.push();
      if (pushResult.success) {
        results.push(pushResult.message);
      } else {
        results.push(`Warning: Push failed: ${pushResult.message}`);
      }
    }

    // Delete source branch if requested
    if (deleteBranch) {
      const deleteResult = await git.deleteBranch(pr.head_ref);
      if (deleteResult.success) {
        results.push(deleteResult.message);
      }
    }

    // Update PR status
    updatePRStatus(id, 'merged');

    return NextResponse.json({
      success: true,
      message: results.join('. '),
      status: 'merged',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
