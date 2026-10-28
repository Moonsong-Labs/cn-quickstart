/**
 * Checks a pull request description against .github/pull_request_template.md.
 *
 * Run with the description in PR_BODY. Prints each finding as a GitHub
 * annotation and exits 1 when any finding is an error. Warnings never fail.
 */

/** A problem with the description. Only an `error` fails the check. */
export interface Finding {
  level: 'error' | 'warning';
  message: string;
}

/**
 * Sections the description must contain, in template order, each with text
 * beyond the template's comments. "Left for later" stays optional.
 */
const REQUIRED_SECTIONS = [
  'Summary',
  'Risk',
  'Decisions for a person',
  'What & Why',
  'Testing',
] as const;

/** More decisions than this draws a warning: the list should be the short one a reviewer reads. */
const MAX_DECISIONS = 5;

/**
 * The heading text used as a section key: lower case, with the template's
 * trailing emoji removed. "What & Why 💻" and "what & why" are the same section.
 */
function sectionName(heading: string): string {
  return heading
    .replace(/[^\p{L}\p{N}&]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Splits a description into its `##` sections, keyed by {@link sectionName}.
 * HTML comments are removed first, so the template's instructions count as empty.
 * Text before the first heading, and `#` or `###` headings, belong to no section.
 */
export function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  /** Heading of the section being collected, or undefined before the first `##`. */
  let current: string | undefined;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = sectionName(heading[1]);
      sections.set(current, '');
    } else if (current !== undefined) {
      sections.set(current, `${sections.get(current)}${line}\n`);
    }
  }
  for (const [name, text] of sections) sections.set(name, text.trim());
  return sections;
}

/**
 * Checks the Risk section. Needs one of low, medium, or high, and a reason of at
 * least two words besides the rating. Returns no finding when both are there.
 */
function checkRisk(text: string): Finding[] {
  const rating = /\b(low|medium|high)\b/i.exec(text);
  if (!rating) {
    return [{ level: 'error', message: 'Risk: rate the change low, medium, or high.' }];
  }
  const reason = text.replace(rating[0], '').match(/[A-Za-z0-9`]+/g) ?? [];
  if (reason.length < 2) {
    return [{ level: 'error', message: `Risk: say why the change is ${rating[1].toLowerCase()}.` }];
  }
  return [];
}

/**
 * Checks the Decisions section. Accepts a lone "None", or one top-level bullet
 * per decision with a code reference in backticks. Nested bullets and wrapped
 * lines belong to the bullet above them. Warns above MAX_DECISIONS bullets.
 */
function checkDecisions(text: string): Finding[] {
  if (/^[-*]?\s*\**none\**\.?$/i.test(text)) return [];
  /** Top-level bullets, each joined with the lines that continue it. */
  const bullets: string[] = [];
  for (const line of text.split('\n')) {
    if (/^([-*]|\d+[.)])\s+/.test(line)) bullets.push(line);
    else if (bullets.length > 0) bullets[bullets.length - 1] += `\n${line}`;
  }
  if (bullets.length === 0) {
    return [
      {
        level: 'error',
        message: 'Decisions for a person: list each decision as a bullet, or write None.',
      },
    ];
  }
  const findings: Finding[] = bullets.flatMap((bullet, index) =>
    /`[^`\n]+`/.test(bullet)
      ? []
      : [
          {
            level: 'error' as const,
            message: `Decisions for a person: decision ${index + 1} needs a code reference as \`path\` or \`path:line\`.`,
          },
        ],
  );
  if (bullets.length > MAX_DECISIONS) {
    findings.push({
      level: 'warning',
      message: `Decisions for a person: ${bullets.length} decisions. Keep the few that need a human, at most ${MAX_DECISIONS}.`,
    });
  }
  return findings;
}

/**
 * Checks a section the template asks for as bullets. One top-level bullet is
 * enough; wrapped lines and nested bullets belong to the bullet above them.
 */
function checkBullets(name: string, text: string): Finding[] {
  if (text.split('\n').some((line) => /^([-*]|\d+[.)])\s+/.test(line))) return [];
  return [{ level: 'error', message: `${name}: list each point as a bullet.` }];
}

/**
 * Checks a description against the template. Returns every finding, in section
 * order. An empty array means the description passes. The optional "Left for
 * later" section and any extra sections are not checked.
 */
export function checkDescription(body: string): Finding[] {
  const sections = parseSections(body);
  const findings: Finding[] = [];
  for (const name of REQUIRED_SECTIONS) {
    const text = sections.get(sectionName(name));
    if (text === undefined) {
      findings.push({ level: 'error', message: `Missing the "## ${name}" section.` });
    } else if (text === '') {
      findings.push({ level: 'error', message: `${name}: the section is empty.` });
    } else if (name === 'Risk') {
      findings.push(...checkRisk(text));
    } else if (name === 'Decisions for a person') {
      findings.push(...checkDecisions(text));
    } else if (name === 'What & Why') {
      findings.push(...checkBullets(name, text));
    }
  }
  return findings;
}

if (import.meta.main) {
  const findings = checkDescription(process.env.PR_BODY ?? '');
  for (const { level, message } of findings) console.log(`::${level}::${message}`);
  const errors = findings.filter((finding) => finding.level === 'error').length;
  if (errors > 0) {
    console.log(
      `\n${errors} problem(s). Edit the description to match .github/pull_request_template.md; the check reruns on save.`,
    );
    process.exit(1);
  }
  console.log('The description follows the template.');
}
