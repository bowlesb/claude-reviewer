'use client';

import { useState, useEffect } from 'react';
import ReactDiffViewer from 'react-diff-viewer-continued';

interface Comment {
    id: string;
    lineNumber: number;
    text: string;
}

interface DiffViewerProps {
    oldValue: string;
    newValue: string;
    splitView?: boolean;
    onAddComment: (line: number, text: string) => void;
    comments: Record<number, Comment[]>;
}

export default function DiffViewer({ oldValue, newValue, splitView = false, onAddComment, comments }: DiffViewerProps) {
    const [commentingLine, setCommentingLine] = useState<number | null>(null);
    const [newCommentText, setNewCommentText] = useState('');

    const renderContent = (line: string) => <pre style={{ display: 'inline' }}>{line}</pre>;

    const handleLineClick = (lineId: string) => {
        const lineNum = parseInt(lineId.split('-')[1]);
        setCommentingLine(lineNum);
    };

    const submitComment = () => {
        if (commentingLine !== null && newCommentText.trim()) {
            onAddComment(commentingLine, newCommentText);
            setNewCommentText('');
            setCommentingLine(null);
        }
    };

    return (
        <div className="diff-container">
            <ReactDiffViewer
                oldValue={oldValue}
                newValue={newValue}
                splitView={splitView}
                onLineNumberClick={handleLineClick}
                renderContent={renderContent}
            />
            {commentingLine !== null && (
                <div className="card" style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 100, width: '300px' }}>
                    <h4>Add Comment to Line {commentingLine}</h4>
                    <textarea
                        style={{ width: '100%', minHeight: '80px', marginBottom: '1rem' }}
                        value={newCommentText}
                        onChange={(e) => setNewCommentText(e.target.value)}
                        placeholder="What needs fixing?"
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={submitComment}>Add</button>
                        <button style={{ backgroundColor: '#6e7681' }} onClick={() => setCommentingLine(null)}>Cancel</button>
                    </div>
                </div>
            )}
            <div style={{ padding: '1rem' }}>
                {Object.entries(comments).map(([line, lineComments]) => (
                    <div key={line} className="comment-box">
                        <strong>Line {line}:</strong>
                        {lineComments.map(c => <div key={c.id}>- {c.text}</div>)}
                    </div>
                ))}
            </div>
        </div>
    );
}
