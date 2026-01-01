'use client';

import { useState } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

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

// GitHub-style colors
const githubStyles = {
    variables: {
        light: {
            diffViewerBackground: '#ffffff',
            diffViewerColor: '#24292f',
            addedBackground: '#e6ffec',
            addedColor: '#24292f',
            removedBackground: '#ffebe9',
            removedColor: '#24292f',
            wordAddedBackground: '#abf2bc',
            wordRemovedBackground: '#ff818266',
            addedGutterBackground: '#ccffd8',
            removedGutterBackground: '#ffd7d5',
            gutterBackground: '#f6f8fa',
            gutterBackgroundDark: '#f0f0f0',
            highlightBackground: '#fffbdd',
            highlightGutterBackground: '#fff5b1',
            codeFoldGutterBackground: '#dbedff',
            codeFoldBackground: '#f1f8ff',
            emptyLineBackground: '#fafbfc',
            gutterColor: '#6e7781',
            addedGutterColor: '#24292f',
            removedGutterColor: '#24292f',
            codeFoldContentColor: '#0550ae',
        },
        dark: {
            diffViewerBackground: '#0d1117',
            diffViewerColor: '#c9d1d9',
            addedBackground: '#0d2218',
            addedColor: '#c9d1d9',
            removedBackground: '#2c0b0e',
            removedColor: '#c9d1d9',
            wordAddedBackground: '#1f6f2e',
            wordRemovedBackground: '#a1232b',
            addedGutterBackground: '#033a16',
            removedGutterBackground: '#530f16',
            gutterBackground: '#161b22',
            gutterBackgroundDark: '#0d1117',
            highlightBackground: '#3d2e00',
            highlightGutterBackground: '#5c4d00',
            codeFoldGutterBackground: '#1b3c5c',
            codeFoldBackground: '#141d26',
            emptyLineBackground: '#161b22',
            gutterColor: '#8b949e',
            addedGutterColor: '#c9d1d9',
            removedGutterColor: '#c9d1d9',
            codeFoldContentColor: '#58a6ff',
        },
    },
    line: {
        padding: '0 10px',
        minHeight: '20px',
    },
    gutter: {
        minWidth: '50px',
        padding: '0 10px',
        userSelect: 'none' as const,
    },
    marker: {
        display: 'none', // Hide +/- markers
    },
    contentText: {
        fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
        fontSize: '12px',
        lineHeight: '20px',
    },
};

export default function DiffViewer({ oldValue, newValue, splitView = false, onAddComment, comments }: DiffViewerProps) {
    const [commentingLine, setCommentingLine] = useState<number | null>(null);
    const [newCommentText, setNewCommentText] = useState('');

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
                styles={githubStyles}
                useDarkTheme={typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches}
                compareMethod={DiffMethod.WORDS}
                hideLineNumbers={false}
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
