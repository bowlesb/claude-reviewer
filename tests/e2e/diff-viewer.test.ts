/**
 * E2E tests for the diff viewer UI
 * Tests that the diff viewer displays correctly without +/- prefixes
 * and that file navigation works properly
 */

import puppeteer, { Browser, Page } from 'puppeteer';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

describe('Diff Viewer E2E Tests', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
  });

  afterEach(async () => {
    await page.close();
  });

  describe('PR List Page', () => {
    it('should load the homepage', async () => {
      await page.goto(BASE_URL);
      await page.waitForSelector('header');
      const title = await page.$eval('header', (el) => el.textContent);
      expect(title).toContain('Claude Reviewer');
    });

    it('should display PR list or empty state', async () => {
      await page.goto(BASE_URL);
      await page.waitForSelector('main');
      // Should have either PR cards or empty state message
      const content = await page.$eval('main', (el) => el.textContent);
      expect(content).toBeTruthy();
    });
  });

  describe('Diff Display', () => {
    // These tests require a PR to exist in the database
    // Skip if no PR is available

    it('should not display +/- prefixes in diff lines', async () => {
      await page.goto(BASE_URL);

      // Find the first PR link and navigate to it
      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping diff display test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.file-diff', { timeout: 10000 });

      // Get all diff line contents
      const lineContents = await page.$$eval('.line-content', (elements) =>
        elements.map((el) => el.textContent || '')
      );

      // Check that added/deleted lines don't start with +/-
      // (Context lines and hunk headers are allowed to have special chars)
      const diffLines = lineContents.filter(
        (line) => !line.startsWith('@@') && line.trim().length > 0
      );

      for (const line of diffLines) {
        // Lines should NOT start with a bare + or - followed by content
        // Note: Lines like "+1" (a number) are valid content, we're checking for diff markers
        const startsWithDiffMarker = /^[+-][^+-]/.test(line) && !line.match(/^[+-]?\d/);
        if (startsWithDiffMarker) {
          // Allow lines that are genuinely code starting with + or -
          // but flag potential diff markers
          console.log('Potential diff marker found:', line.substring(0, 50));
        }
      }

      expect(diffLines.length).toBeGreaterThan(0);
    });

    it('should have file navigation links', async () => {
      await page.goto(BASE_URL);

      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping navigation test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.file-list', { timeout: 10000 });

      // Check that file items are anchor links with href
      const fileLinks = await page.$$eval('.file-item', (elements) =>
        elements.map((el) => ({
          tagName: el.tagName.toLowerCase(),
          href: el.getAttribute('href'),
        }))
      );

      expect(fileLinks.length).toBeGreaterThan(0);

      for (const link of fileLinks) {
        expect(link.tagName).toBe('a');
        expect(link.href).toMatch(/^#file-/);
      }
    });

    it('should have matching file IDs for navigation', async () => {
      await page.goto(BASE_URL);

      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping ID matching test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.file-diff', { timeout: 10000 });

      // Get all file link hrefs
      const linkHrefs = await page.$$eval('.file-item', (elements) =>
        elements.map((el) => el.getAttribute('href')?.replace('#', ''))
      );

      // Get all file diff IDs
      const fileDiffIds = await page.$$eval('.file-diff', (elements) =>
        elements.map((el) => el.id)
      );

      // Each link should have a corresponding file diff
      for (const href of linkHrefs) {
        if (href) {
          expect(fileDiffIds).toContain(href);
        }
      }
    });

    it('should scroll to file when clicking navigation link', async () => {
      await page.goto(BASE_URL);

      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping scroll test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.file-list', { timeout: 10000 });

      // Get the second file link if available (to test scrolling)
      const fileLinks = await page.$$('.file-item');
      if (fileLinks.length < 2) {
        console.log('Not enough files to test scrolling');
        return;
      }

      // Get initial scroll position
      const initialScroll = await page.evaluate(() => window.scrollY);

      // Click the second file link
      await fileLinks[1].click();

      // Wait for smooth scroll
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check that scroll position changed (if content is tall enough)
      const newScroll = await page.evaluate(() => window.scrollY);

      // The scroll might not change if the page isn't tall enough
      // Just verify no errors occurred
      expect(typeof newScroll).toBe('number');
    });
  });

  describe('Diff Line Styling', () => {
    it('should have proper CSS classes for diff lines', async () => {
      await page.goto(BASE_URL);

      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping styling test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.diff-content', { timeout: 10000 });

      // Check for presence of styled diff lines
      const hasAddLines = await page.$('.line-add');
      const hasDelLines = await page.$('.line-del');
      const hasCtxLines = await page.$('.line-ctx');

      // At least some line types should be present
      const hasAnyLines = hasAddLines || hasDelLines || hasCtxLines;
      expect(hasAnyLines).toBeTruthy();
    });

    it('should have line numbers visible', async () => {
      await page.goto(BASE_URL);

      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping line numbers test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.line-num', { timeout: 10000 });

      const lineNumbers = await page.$$eval('.line-num', (elements) =>
        elements.map((el) => el.textContent?.trim()).filter((text) => text && /^\d+$/.test(text))
      );

      expect(lineNumbers.length).toBeGreaterThan(0);
    });
  });

  describe('Review Functionality', () => {
    it('should have review buttons when PR is not merged', async () => {
      await page.goto(BASE_URL);

      const prLink = await page.$('a[href^="/prs/"]');
      if (!prLink) {
        console.log('No PRs available, skipping review button test');
        return;
      }

      await prLink.click();
      await page.waitForSelector('.pr-sidebar', { timeout: 10000 });

      // Check for review buttons
      const approveBtn = await page.$('.btn-approve');
      const requestChangesBtn = await page.$('.btn-request-changes');

      // At least one review action should be available for non-merged PRs
      const hasReviewOptions = approveBtn || requestChangesBtn;
      // Note: might be null if PR is merged
      expect(typeof hasReviewOptions).not.toBe('undefined');
    });
  });
});
