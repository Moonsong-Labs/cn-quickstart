import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDescription, parseSections } from './pr-description';

/** The template as committed, which must fail until someone fills it in. */
const TEMPLATE = readFileSync(join(import.meta.dir, '..', 'pull_request_template.md'), 'utf8');

/** Builds a description from the required sections, overriding any of them. */
function describePr(overrides: Partial<Record<string, string>> = {}): string {
  const sections = {
    'Summary 📝': 'Waits for the validator before onboarding.',
    'Risk 🔍': 'Low. The CLI tests cover the wait.',
    'Decisions for a person 🕵️‍♂️': 'None',
    'What & Why 💻':
      '- `qs start` waits for the validator before onboarding, so a slow start fails visibly.',
    'Testing 🧪': '`bun test` in quickstart/cli.',
    ...overrides,
  };
  return Object.entries(sections)
    .map(([name, text]) => `## ${name}\n\n${text}\n`)
    .join('\n');
}

/** Error messages only, which decide whether the check fails. */
function errors(body: string): string[] {
  return checkDescription(body)
    .filter((finding) => finding.level === 'error')
    .map((finding) => finding.message);
}

describe('checkDescription', () => {
  test('passes a filled-in description', () => {
    expect(checkDescription(describePr())).toEqual([]);
  });

  test('fails the unfilled template on every required section', () => {
    expect(errors(TEMPLATE)).toEqual([
      'Summary: the section is empty.',
      'Risk: the section is empty.',
      'Decisions for a person: the section is empty.',
      'What & Why: the section is empty.',
      'Testing: the section is empty.',
    ]);
  });

  test('fails an empty description', () => {
    expect(errors('')).toHaveLength(5);
  });

  test('reports a missing section by name', () => {
    const body = describePr().replace(/## Testing[\s\S]*$/, '');
    expect(errors(body)).toEqual(['Missing the "## Testing" section.']);
  });

  test('matches headings regardless of case or emoji', () => {
    expect(errors(describePr().replace('## Risk 🔍', '## risk'))).toEqual([]);
  });

  test('needs bullets in What & Why', () => {
    expect(errors(describePr({ 'What & Why 💻': 'Waits for the validator.' }))).toEqual([
      'What & Why: list each point as a bullet.',
    ]);
  });

  test('needs a risk rating', () => {
    expect(errors(describePr({ Risk: 'Touches the renewal flow.' }))).toEqual([
      'Risk: rate the change low, medium, or high.',
    ]);
  });

  test('needs a reason next to the rating', () => {
    expect(errors(describePr({ Risk: '**High**' }))).toEqual(['Risk: say why the change is high.']);
  });

  test('accepts None in any common form', () => {
    for (const none of ['none', '- None', '**None**', 'None.']) {
      expect(errors(describePr({ 'Decisions for a person': none }))).toEqual([]);
    }
  });

  test('accepts decisions that each reference code', () => {
    const decisions = [
      '- Archives the license before payment settles. `License.daml:88`',
      '- Retries onboarding once,',
      '  then gives up. `quickstart/cli/src/commands/start.ts`',
    ].join('\n');
    expect(checkDescription(describePr({ 'Decisions for a person': decisions }))).toEqual([]);
  });

  test('names the decision that has no code reference', () => {
    const decisions = '- First. `a.ts`\n- Second, with no reference.';
    expect(errors(describePr({ 'Decisions for a person': decisions }))).toEqual([
      'Decisions for a person: decision 2 needs a code reference as `path` or `path:line`.',
    ]);
  });

  test('rejects decisions written as prose', () => {
    expect(
      errors(describePr({ 'Decisions for a person': 'The retry logic in `start.ts`.' })),
    ).toEqual(['Decisions for a person: list each decision as a bullet, or write None.']);
  });

  test('warns without failing on a long decisions list', () => {
    const decisions = Array.from({ length: 6 }, (_, i) => `- Decision. \`f${i}.ts\``).join('\n');
    const findings = checkDescription(describePr({ 'Decisions for a person': decisions }));
    expect(findings.map((finding) => finding.level)).toEqual(['warning']);
  });
});

describe('parseSections', () => {
  test('drops HTML comments and text before the first heading', () => {
    const sections = parseSections('Intro\n## Summary\n<!-- hint -->\nText\n### Detail\nMore');
    expect([...sections]).toEqual([['summary', 'Text\n### Detail\nMore']]);
  });
});
