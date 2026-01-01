import { spawn } from 'child_process';

async function runClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Use -p for non-interactive mode which accepts stdin and prints to stdout
        const child = spawn('claude', ['-p'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error('Claude CLI error:', stderr);
                // Fallback: sometimes stderr has the response or info, but usually non-zero is error
                // However, if we get stdout, we might want to return it.
                // For now reject if non-zero.
                reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
            } else {
                resolve(stdout.trim());
            }
        });

        child.on('error', (err) => {
            reject(err);
        });

        // Write prompt to stdin
        child.stdin.write(prompt);
        child.stdin.end();
    });
}

export async function requestFixes(params: {
    repoInfo: string;
    diff: string;
    comments: any[];
}) {
    const { diff, comments } = params;

    const formattedComments = comments.map(c =>
        `File: ${c.fileName}, Line: ${c.lineNumber}, Comment: ${c.text}`
    ).join('\n');

    const prompt = `You are an expert AI developer. I have some code changes and feedback. 
Please provide a unified diff patch that addresses the following comments.

<diff>
${diff}
</diff>

<comments>
${formattedComments}
</comments>

Output ONLY the unified diff patch. No prose, no explanations. 
If no changes are needed, output empty string.
Do not wrap the output in markdown code blocks if possible, or I will have to strip them.
Just header and diff content.`;

    const output = await runClaude(prompt);

    // Clean up output if wrapped in markdown
    return cleanDiffOutput(output);
}

export async function generatePRMetadata(diff: string) {
    const prompt = `Based on the following diff, generate a PR title and a concise description.

<diff>
${diff}
</diff>

Output in JSON format:
{
  "title": "...",
  "description": "..."
}`;

    const output = await runClaude(prompt);

    try {
        // Try to find JSON in the output
        const match = output.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
    } catch (e) {
        console.error('Failed to parse JSON from Claude output', e);
    }

    return { title: 'PR Update', description: output };
}

function cleanDiffOutput(text: string): string {
    // Remove markdown code blocks if present
    let clean = text.replace(/^```diff\n/, '').replace(/^```\n/, '').replace(/```$/, '');
    // Also sometimes it adds "Here is the patch:" etc.
    // We expect a diff to start with "diff --git" or "---" or similar.
    // But strictly enforcing is hard.
    // However, `git apply` is picky.
    // Let's try to extract the patch block if mixed with text.

    // Simplistic approach: if it contains "diff --git", start from there.
    const diffStart = clean.indexOf('diff --git');
    if (diffStart !== -1) {
        clean = clean.substring(diffStart);
    } else {
        // maybe check for '--- a/'
        const fileCtx = clean.indexOf('--- a/');
        if (fileCtx !== -1) {
            clean = clean.substring(fileCtx);
        }
    }

    return clean.trim();
}
