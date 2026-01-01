import { NextRequest, NextResponse } from 'next/server';
import { getPRByUuid, getComments, submitReview, getReviews } from '@/lib/database';
import { inferPreferences, appendToClaudeMd } from '@/lib/preferences';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/prs/[id]/review - Get review history
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const pr = getPRByUuid(id);
    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    const reviews = getReviews(id);

    return NextResponse.json({ reviews });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/prs/[id]/review - Submit a review (approve/request_changes)
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { action, summary } = body;

    if (!action || !['approve', 'request_changes'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "request_changes"' },
        { status: 400 }
      );
    }

    const pr = getPRByUuid(id);
    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    // Submit the review
    submitReview(id, action, summary);

    // If changes were requested, try to infer preferences from comments
    if (action === 'request_changes') {
      const comments = getComments(id, { unresolvedOnly: true });

      if (comments.length > 0) {
        try {
          // Infer preferences and append to CLAUDE.md
          const preferences = await inferPreferences(comments, pr.repo_path);
          if (preferences && preferences.length > 0) {
            await appendToClaudeMd(pr.repo_path, preferences);
          }
        } catch (e) {
          // Don't fail the review if preference inference fails
          console.error('Failed to infer preferences:', e);
        }
      }
    }

    const newStatus = action === 'approve' ? 'approved' : 'changes_requested';

    return NextResponse.json({
      success: true,
      status: newStatus,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
