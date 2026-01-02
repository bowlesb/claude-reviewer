import { NextRequest, NextResponse } from 'next/server';
import { GitManager } from '@/lib/git';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const repoPath = searchParams.get('path');
    const action = searchParams.get('action');

    if (!repoPath) return NextResponse.json({ error: 'Repo path required' }, { status: 400 });

    const git = new GitManager(repoPath);

    try {
        if (action === 'refs') {
            const refs = await git.getRefs();
            return NextResponse.json(refs);
        }
        if (action === 'diff') {
            const base = searchParams.get('base') || 'main';
            const head = searchParams.get('head') || 'HEAD';
            const diff = await git.getDiff(base, head);
            return NextResponse.json({ diff });
        }
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { repoPath, action, patch, message } = body;

    if (!repoPath) return NextResponse.json({ error: 'Repo path required' }, { status: 400 });

    const git = new GitManager(repoPath);

    try {
        if (action === 'apply') {
            const result = await git.applyPatch(patch);
            return NextResponse.json(result);
        }
        if (action === 'commit') {
            const result = await git.commit(message);
            return NextResponse.json(result);
        }
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
