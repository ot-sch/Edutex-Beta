/**
 * @fileoverview Enforces the RC6 onboarding-comment standard across every maintained TypeScript,
 * TSX and JavaScript-module source file. It requires a file overview plus a meaningful leading
 * comment for every implemented declaration, method, React/event callback, validation predicate,
 * transaction callback and test callback. The root quality gate runs this before compilation so a
 * future developer cannot add undocumented executable behavior by accident.
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';

const repositoryRoot = join(import.meta.dirname, '..');
const excludedDirectories = new Set([
  '.git',
  '.terraform',
  'cdk.out',
  'coverage',
  'dist',
  'node_modules',
  'output',
  'tmp',
]);
const maintainedExtensions = new Set(['.ts', '.tsx', '.mjs']);

/**
 * Recursively lists maintained executable source while excluding generated dependencies, builds,
 * deployment state and rendered output. Sorting makes diagnostics deterministic in CI and locally.
 */
async function maintainedFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await maintainedFiles(path)));
    else if (entry.isFile() && maintainedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

/**
 * Returns true for executable function-like nodes that contain behavior. Type-only call signatures,
 * interfaces and overload declarations are deliberately excluded because they have no implementation.
 */
function isImplementedFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.body !== undefined
  );
}

/**
 * Selects the source location where a reader expects the function comment. A named arrow assigned to
 * a `const` uses the variable statement's comment; inline callbacks use a comment immediately before
 * the callback expression.
 */
function documentationAnchor(node: ts.FunctionLikeDeclaration): ts.Node {
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent)
  ) {
    const declarationList = node.parent.parent;
    return ts.isVariableDeclarationList(declarationList) ? declarationList.parent : node.parent;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isPropertyAssignment(node.parent)
  ) {
    return node.parent;
  }
  return node;
}

/**
 * Confirms the anchor has a directly attached line/block comment containing at least 24 characters.
 * The length threshold prevents placeholders such as `// handler` from satisfying onboarding needs.
 */
function hasMeaningfulDocumentation(
  sourceText: string,
  sourceFile: ts.SourceFile,
  node: ts.FunctionLikeDeclaration,
): boolean {
  const anchor = documentationAnchor(node);
  const anchorStart = anchor.getStart(sourceFile);
  let cursor = anchorStart;
  while (cursor > 0 && /\s/.test(sourceText[cursor - 1] ?? '')) cursor -= 1;

  let comment = '';
  if (sourceText.slice(Math.max(0, cursor - 2), cursor) === '*/') {
    const blockStart = sourceText.lastIndexOf('/*', cursor - 2);
    if (blockStart >= 0) comment = sourceText.slice(blockStart, cursor);
  } else {
    const precedingText = sourceText.slice(0, cursor);
    const adjacentLines = precedingText.split(/\r?\n/);
    const lineComments: string[] = [];
    for (let index = adjacentLines.length - 1; index >= 0; index -= 1) {
      const line = adjacentLines[index]?.trim() ?? '';
      if (!line.startsWith('//')) break;
      lineComments.unshift(line);
    }
    comment = lineComments.join('\n');
  }

  const meaningfulText = comment
    .replace(/^\/\*+|\*+\/$/g, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/^\s*\/\/\s?/gm, '')
    .trim();
  return meaningfulText.length >= 24;
}

/**
 * Derives a stable diagnostic name from a declaration, assignment, object property or parent call.
 * The label is for developer navigation only and never affects build output.
 */
function functionLabel(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  if (node.name) return node.name.getText(sourceFile);
  if (ts.isVariableDeclaration(node.parent)) return node.parent.name.getText(sourceFile);
  if (ts.isPropertyAssignment(node.parent)) return node.parent.name.getText(sourceFile);
  if (ts.isCallExpression(node.parent))
    return `callback passed to ${node.parent.expression.getText(sourceFile)}`;
  if (ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent)) {
    return `JSX ${node.parent.parent.name.getText(sourceFile)} callback`;
  }
  return 'anonymous callback';
}

/**
 * Audits one parsed source file for its file overview and every implemented function comment,
 * returning line-addressed errors that a new developer can fix without understanding the checker.
 */
function auditFile(filePath: string, sourceText: string): string[] {
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : filePath.endsWith('.mjs')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const errors: string[] = [];
  if (!sourceText.slice(0, 4096).includes('@fileoverview')) {
    errors.push('line 1: missing @fileoverview responsibility/dependency/security summary');
  }
  /** Walks the syntax tree and records each undocumented function implementation. */
  function visit(node: ts.Node): void {
    if (isImplementedFunction(node) && !hasMeaningfulDocumentation(sourceText, sourceFile, node)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      errors.push(`line ${position.line + 1}: ${functionLabel(node, sourceFile)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return errors;
}

/**
 * Runs the repository audit, prints every file/line failure, and sets a non-zero exit code consumed by
 * `npm run quality`. Success reports the exact file and function counts covered by the gate.
 */
async function main(): Promise<void> {
  const failures: string[] = [];
  let functionCount = 0;
  const files = await maintainedFiles(repositoryRoot);
  for (const filePath of files) {
    const sourceText = await readFile(filePath, 'utf8');
    const errors = auditFile(filePath, sourceText);
    if (errors.length > 0) {
      failures.push(
        `${relative(repositoryRoot, filePath)}\n${errors
          .map(
            /** Indents each line-addressed problem beneath its owning file. */
            (error) => `  - ${error}`,
          )
          .join('\n')}`,
      );
    }
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    /** Counts implemented functions independently from the failure list for the quality evidence. */
    function count(node: ts.Node): void {
      if (isImplementedFunction(node)) functionCount += 1;
      ts.forEachChild(node, count);
    }
    count(sourceFile);
  }
  if (failures.length > 0) {
    process.stderr.write(
      `Source documentation gate failed:\n${failures.join('\n')}\n` +
        'Add explicit responsibility, behavior and dependency comments before every listed function.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Source documentation gate passed: ${files.length} maintained files and ${functionCount} implemented functions documented.\n`,
  );
}

await main();
