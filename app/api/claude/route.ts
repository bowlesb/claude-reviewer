import { NextRequest, NextResponse } from 'next/server';
import { requestFixes, generatePRMetadata } from '@/lib/claude';

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { action, diff, comments, repoPath } = body;

    try {
        if (action === 'fix') {
            const patch = await requestFixes({ repoInfo: repoPath, diff, comments });
            return NextResponse.json({ patch });
        }
        if (action === 'metadata') {
            const metadata = await generatePRMetadata(diff);
            return NextResponse.json(metadata);
        }
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
