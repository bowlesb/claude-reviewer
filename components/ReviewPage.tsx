'use client';

import { useState } from 'react';
import DiffViewer from './DiffViewer';
import { GitBranch, MessageSquare, Send, CheckCircle } from 'lucide-react';

interface ReviewPageProps {
    repoPath: string;
    baseRef: string;
    headRef: string;
    diff: string;
}

export default function ReviewPage({ repoPath, baseRef, headRef, diff }: ReviewPageProps) {
    const [comments, setComments] = useState<Record<number, any[]>>({});
    const [patch, setPatch] = useState<string | null>(null);
    const [isRequesting, setIsRequesting] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [prMetadata, setPrMetadata] = useState<{ title: string; description: string } | null>(null);

    const addComment = (line: number, text: string) => {
        setComments(prev => ({
            ...prev,
            [line]: [...(prev[line] || []), { id: Date.now().toString(), lineNumber: line, text }]
        }));
    };

    const requestFixes = async () => {
        setIsRequesting(true);
        const flattenedComments = Object.entries(comments).flatMap(([line, lineComments]) =>
            lineComments.map(c => ({ ...c, lineNumber: parseInt(line) }))
        );

        try {
            const res = await fetch('/api/claude', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'fix', diff, comments: flattenedComments, repoPath })
            });
            const data = await res.json();
            setPatch(data.patch);
        } catch (e) {
            alert('Error requesting fixes');
        } finally {
            setIsRequesting(false);
        }
    };

    const applyPatch = async () => {
        if (!patch) return;
        setIsApplying(true);
        try {
            const res = await fetch('/api/git', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'apply', patch, repoPath })
            });
            const data = await res.json();
            if (data.success) {
                // Auto-commit
                const commitRes = await fetch('/api/git', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'commit', message: 'refactor: apply fixes from Claude', repoPath })
                });
                const commitData = await commitRes.json();

                if (commitData.summary || commitData.commit) {
                    alert('Patch applied and committed successfully!');
                } else {
                    alert('Patch applied, but commit failed: ' + (commitData.error || 'Unknown error'));
                }
                setPatch(null);
            } else {
                alert('Error applying patch: ' + data.error);
            }
        } catch (e) {
            alert('Error applying patch');
        } finally {
            setIsApplying(false);
        }
    };

    const generatePR = async () => {
        try {
            const res = await fetch('/api/claude', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'metadata', diff })
            });
            const data = await res.json();
            setPrMetadata(data);
        } catch (e) {
            alert('Error generating PR info');
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div>
                    <h3>Reviewing {baseRef} .. {headRef}</h3>
                    <p style={{ color: '#6e7681' }}>{repoPath}</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={requestFixes} disabled={isRequesting}>
                        {isRequesting ? 'Requesting Fixes...' : 'Request Fixes'}
                    </button>
                    <button onClick={generatePR}>Generate PR Info</button>
                </div>
            </div>

            <DiffViewer
                oldValue=""
                newValue={diff}
                onAddComment={addComment}
                comments={comments}
            />

            {patch && (
                <div className="card" style={{ marginTop: '2rem', border: '1px solid #238636' }}>
                    <h4>Suggested Fixes (Claude Patch)</h4>
                    <pre style={{ maxHeight: '300px', overflow: 'auto', background: '#0d1117', padding: '1rem', borderRadius: '4px' }}>
                        {patch}
                    </pre>
                    <button
                        style={{ backgroundColor: '#238636', marginTop: '1rem' }}
                        onClick={applyPatch}
                        disabled={isApplying}
                    >
                        {isApplying ? 'Applying...' : 'Apply Patch'}
                    </button>
                </div>
            )}

            {prMetadata && (
                <div className="card" style={{ marginTop: '2rem' }}>
                    <h4>PR Candidate Info</h4>
                    <div style={{ marginBottom: '1rem' }}>
                        <strong>Title:</strong>
                        <input style={{ width: '100%' }} value={prMetadata.title} readOnly />
                    </div>
                    <div>
                        <strong>Description:</strong>
                        <textarea style={{ width: '100%', minHeight: '100px' }} value={prMetadata.description} readOnly />
                    </div>
                </div>
            )}
        </div>
    );
}
