import { readFileSync as readFile } from 'node:fs';
import ts from 'typescript';

/** Read English source text through translation calls, so source-based UI guards
 * inspect the same wording whether it is a literal or a translated message. */
export function normalizeLocalizedSource(source: string, path = 'component.tsx'): string {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  type Edit = { start: number; end: number; text: string };
  const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  function rewrite(node: ts.Node): string {
    const edits: Edit[] = [];
    function visit(child: ts.Node) {
      if (ts.isCallExpression(child) && child.expression.getText(ast) === 't' && child.arguments[0]) {
        const first = child.arguments[0];
        let text: string;
        if (ts.isStringLiteralLike(first)) {
          const values = new Map<string, string>();
          const vars = child.arguments[1];
          if (vars && ts.isObjectLiteralExpression(vars)) {
            for (const item of vars.properties) {
              if (ts.isPropertyAssignment(item)) values.set(item.name.getText(ast), rewrite(item.initializer));
              if (ts.isShorthandPropertyAssignment(item)) values.set(item.name.text, item.name.text);
            }
          }
          text = values.size ? '`' + first.text.replace(/\{([^{}]+)\}/g, (match, key) => values.has(key) ? '${' + values.get(key) + '}' : match) + '`' : quote(first.text);
        } else text = rewrite(first);
        const parent = child.parent;
        if (ts.isJsxExpression(parent) && ts.isStringLiteralLike(first) && child.arguments.length === 1) {
          const attr = parent.parent;
          edits.push({ start: parent.getStart(ast), end: parent.end, text: ts.isJsxAttribute(attr) ? JSON.stringify(first.text) : first.text });
        } else edits.push({ start: child.getStart(ast), end: child.end, text });
        return;
      }
      ts.forEachChild(child, visit);
    }
    visit(node);
    let text = node.getText(ast);
    const offset = node.getStart(ast);
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start - offset) + edit.text + text.slice(edit.end - offset);
    return text;
  }
  return rewrite(ast);
}

export function readFileSync(path: string, encoding: 'utf8'): string {
  const source = readFile(path, encoding);
  return /\.tsx?$/.test(path) ? normalizeLocalizedSource(source, path) : source;
}
