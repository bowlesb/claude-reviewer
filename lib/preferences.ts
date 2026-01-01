import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { Comment } from './database';

const client = new Anthropic();

/**
 * Infer coding preferences from review comments using Claude.
 * Returns a list of preference statements that can be added to CLAUDE.md
 */
export async function inferPreferences(
  comments: Comment[],
  repoPath: string
): Promise<string[]> {
  if (comments.length === 0) {
    return [];
  }

  // Read existing CLAUDE.md to avoid duplicates
  const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
  let existingContent = '';
  try {
    existingContent = fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    // File doesn't exist yet, that's fine
  }

  // Format comments for the prompt
  const formattedComments = comments.map(c =>
    `[${c.file_path}:${c.line_number}] ${c.content}`
  ).join('\n');

  const prompt = `You are analyzing code review comments to infer general coding preferences and style guidelines.

Here are the review comments:
${formattedComments}

${existingContent ? `Here is the existing CLAUDE.md content (avoid duplicating these):
${existingContent}` : ''}

Based on these comments, identify any general coding preferences or patterns that could be added to a CLAUDE.md file. These should be:
1. General guidelines, not specific to one file
2. Actionable and clear
3. Not already covered in the existing CLAUDE.md

Return ONLY a JSON array of preference strings. If no general preferences can be inferred, return an empty array.
Example: ["Prefer explicit error handling over silent failures", "Use descriptive variable names for boolean flags"]

Return only the JSON array, no other text.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return [];
    }

    // Parse the JSON response
    const text = content.text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }

    const preferences = JSON.parse(match[0]) as string[];
    return preferences.filter(p => typeof p === 'string' && p.length > 0);
  } catch (error) {
    console.error('Error inferring preferences:', error);
    return [];
  }
}

/**
 * Append new preferences to CLAUDE.md in the repository.
 * Creates the file if it doesn't exist.
 */
export async function appendToClaudeMd(
  repoPath: string,
  preferences: string[]
): Promise<void> {
  if (preferences.length === 0) {
    return;
  }

  const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
  let existingContent = '';

  try {
    existingContent = fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    // File doesn't exist, create with header
    existingContent = `# Claude Code Preferences

This file contains coding preferences learned from code reviews.

`;
  }

  // Check if there's a review preferences section
  const sectionHeader = '## Learned from Reviews';
  let newContent = existingContent;

  if (!existingContent.includes(sectionHeader)) {
    // Add the section
    newContent += `\n${sectionHeader}\n\n`;
  }

  // Add new preferences
  const timestamp = new Date().toISOString().split('T')[0];
  const preferencesText = preferences.map(p => `- ${p}`).join('\n');
  const newSection = `\n<!-- Added ${timestamp} -->\n${preferencesText}\n`;

  // Find where to insert (at end of Learned from Reviews section or file)
  const sectionIndex = newContent.indexOf(sectionHeader);
  if (sectionIndex !== -1) {
    // Find the end of this section (next ## or end of file)
    const afterSection = newContent.slice(sectionIndex + sectionHeader.length);
    const nextSectionMatch = afterSection.match(/\n##\s/);

    if (nextSectionMatch) {
      const insertPoint = sectionIndex + sectionHeader.length + (nextSectionMatch.index ?? 0);
      newContent = newContent.slice(0, insertPoint) + newSection + newContent.slice(insertPoint);
    } else {
      newContent += newSection;
    }
  } else {
    newContent += newSection;
  }

  fs.writeFileSync(claudeMdPath, newContent);
}

/**
 * Get the current preferences from CLAUDE.md
 */
export function getPreferences(repoPath: string): string | null {
  const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
  try {
    return fs.readFileSync(claudeMdPath, 'utf-8');
  } catch {
    return null;
  }
}
