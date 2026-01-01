import { NextRequest, NextResponse } from 'next/server';
import { getPRByUuid, getComments, addComment, resolveComment, deleteComment } from '@/lib/database';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/prs/[id]/comments - List comments
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const unresolvedOnly = searchParams.get('unresolved') === 'true';
    const filePath = searchParams.get('file') || undefined;

    const pr = getPRByUuid(id);
    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    const comments = getComments(id, { unresolvedOnly, filePath });

    return NextResponse.json({ comments });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/prs/[id]/comments - Add a comment
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { filePath, lineNumber, content, lineType } = body;

    if (!filePath || lineNumber === undefined || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: filePath, lineNumber, content' },
        { status: 400 }
      );
    }

    const pr = getPRByUuid(id);
    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    const commentUuid = addComment(id, filePath, lineNumber, content, lineType || 'new');

    return NextResponse.json({
      uuid: commentUuid,
      message: 'Comment added',
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/prs/[id]/comments - Resolve/unresolve a comment
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const body = await req.json();
    const { commentUuid, resolved } = body;

    if (!commentUuid || resolved === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: commentUuid, resolved' },
        { status: 400 }
      );
    }

    const success = resolveComment(commentUuid, resolved);

    if (!success) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/prs/[id]/comments - Delete a comment
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const commentUuid = searchParams.get('uuid');

    if (!commentUuid) {
      return NextResponse.json({ error: 'Missing comment uuid' }, { status: 400 });
    }

    const success = deleteComment(commentUuid);

    if (!success) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
