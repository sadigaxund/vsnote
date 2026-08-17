/**
 * The print-only markdown renderer for DESIGN-SPEC item 38's Export as PDF —
 * split out of `printExport.tsx` (which owns mount/print/teardown) purely so
 * this file's only export is a component (`PrintDocument`); ESLint's
 * `react-refresh/only-export-components` flags a module that exports BOTH
 * component and non-component bindings, and `printExport.tsx` needs to
 * export the plain `exportMarkdownAsPdf` function. See that file's own doc
 * for the full reasoning on why this renders a separate static tree instead
 * of reusing the live CM6 Rendered view, and why the block parser below is
 * a real (if deliberately scoped) markdown reader rather than the library's
 * own minimal `Markdown` component.
 */
import { Fragment, type ReactNode } from "react";
import { CodeBlock, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, renderInline } from "my-you-eye";

/** `my-you-eye`'s exported `renderInline` (bold/italic/inline-code/links)
 * has no `~~strikethrough~~` handling — confirmed reading its regex in
 * `node_modules/my-you-eye/dist/index.js` (`` `[^`]+` ``, `**bold**`,
 * `*italic*`, `[text](url)`, nothing for `~~`). The Format menu's
 * Strikethrough action (`editor/formatActions.ts`) writes real `~~text~~`
 * markdown, so a note using it needs to print correctly too: this splits
 * strikethrough spans out FIRST, wraps each in a real `<del>`, and still
 * delegates every other inline rule (including the delegate call for
 * strikethrough's OWN inner text) to the library's `renderInline` rather
 * than reimplementing bold/italic/code/link matching a second time. */
function renderInlineText(text: string): ReactNode {
  const parts = text.split(/(~~[^~]+~~)/g);
  if (parts.length === 1) return renderInline(text);
  return (
    <>
      {parts.map((part, idx) => {
        const strike = part.match(/^~~([^~]+)~~$/);
        return strike ? <del key={idx}>{renderInline(strike[1])}</del> : <Fragment key={idx}>{renderInline(part)}</Fragment>;
      })}
    </>
  );
}

interface ListItemNode {
  text: string;
  ordered: boolean;
  checked?: boolean;
  children: ListItemNode[];
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: ListItemNode[] }
  | { type: "blockquote"; lines: { depth: number; text: string }[] }
  | { type: "code"; code: string; language?: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "image"; alt: string; src: string };

const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.+)$/;

function parseListItems(lines: string[], cursor: { i: number }, minIndent: number): ListItemNode[] {
  const items: ListItemNode[] = [];
  while (cursor.i < lines.length) {
    const m = lines[cursor.i].match(LIST_ITEM_RE);
    if (!m) break;
    const indent = m[1].length;
    if (indent < minIndent) break;
    if (indent > minIndent) break; // a deeper item belongs to the previous sibling's children, handled below
    const ordered = /\d+\./.test(m[2]);
    const checked = m[3] !== undefined ? /x/i.test(m[3]) : undefined;
    const text = m[4];
    cursor.i++;
    let children: ListItemNode[] = [];
    const next = cursor.i < lines.length ? lines[cursor.i].match(LIST_ITEM_RE) : null;
    if (next && next[1].length > indent) children = parseListItems(lines, cursor, next[1].length);
    items.push({ text, ordered, checked, children });
  }
  return items;
}

function parseBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2] });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", code: codeLines.join("\n"), language });
      continue;
    }
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2 && /^[\s|:-]+$/.test(tableLines[1])) {
        const parseRow = (row: string) => row.split("|").slice(1, -1).map((c) => c.trim());
        blocks.push({ type: "table", headers: parseRow(tableLines[0]), rows: tableLines.slice(2).map(parseRow) });
      }
      continue;
    }
    if (line.startsWith(">")) {
      const bqLines: { depth: number; text: string }[] = [];
      while (i < lines.length && (lines[i].startsWith(">") || lines[i].trim() === "")) {
        if (lines[i].trim() === "") {
          i++;
          continue;
        }
        const stripped = lines[i].match(/^((?:\s*>)+)\s?(.*)$/);
        const depth = stripped ? (stripped[1].match(/>/g) ?? []).length : 1;
        bqLines.push({ depth, text: stripped ? stripped[2] : lines[i] });
        i++;
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      const cursor = { i };
      const items = parseListItems(lines, cursor, 0);
      i = cursor.i;
      blocks.push({ type: "list", items });
      continue;
    }
    const bareImage = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (bareImage) {
      blocks.push({ type: "image", alt: bareImage[1], src: bareImage[2] });
      i++;
      continue;
    }
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6})\s+/.test(lines[i]) && !lines[i].startsWith("```") && !lines[i].startsWith("|") && !lines[i].startsWith(">") && !LIST_ITEM_RE.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", text: paraLines.join(" ") });
  }
  return blocks;
}

function ListItems({ items }: { items: ListItemNode[] }): ReactNode {
  if (items.length === 0) return null;
  const ordered = items[0].ordered;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={ordered ? "print-ol" : "print-ul"}>
      {items.map((item, idx) => (
        <li key={idx}>
          {item.checked !== undefined ? (
            <label className="print-task">
              <input type="checkbox" checked={item.checked} readOnly disabled />
              <span>{renderInlineText(item.text)}</span>
            </label>
          ) : (
            renderInlineText(item.text)
          )}
          {item.children.length > 0 && <ListItems items={item.children} />}
        </li>
      ))}
    </Tag>
  );
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as keyof JSX.IntrinsicElements;
      return <Tag>{renderInlineText(block.text)}</Tag>;
    }
    case "paragraph":
      return <p>{renderInlineText(block.text)}</p>;
    case "list":
      return <ListItems items={block.items} />;
    case "blockquote":
      return (
        <>
          {block.lines.map((l, idx) => (
            <blockquote key={idx} style={{ marginLeft: (l.depth - 1) * 16 }}>
              {l.text ? renderInlineText(l.text) : <>&nbsp;</>}
            </blockquote>
          ))}
        </>
      );
    case "code":
      return <CodeBlock code={block.code} language={block.language} highlight={Boolean(block.language)} showLineNumbers />;
    case "table":
      return (
        <Table>
          {block.headers.length > 0 && (
            <TableHeader>
              <TableRow>
                {block.headers.map((h, j) => (
                  <TableHead key={j}>{renderInlineText(h)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
          )}
          <TableBody>
            {block.rows.map((row, j) => (
              <TableRow key={j}>
                {row.map((c, k) => (
                  <TableCell key={k}>{renderInlineText(c)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    case "hr":
      return <hr />;
    case "image":
      // Vault images live in lightning-fs (in-browser, opaque blob: URLs the
      // print window can't resolve) — printed as a labeled placeholder
      // rather than a broken-image icon; same "never silently guess" spirit
      // as the rest of this pipeline.
      return <p className="print-image-note">Image: {block.alt || block.src}</p>;
  }
}

export function PrintDocument({ title, content }: { title: string; content: string }): ReactNode {
  const blocks = parseBlocks(content);
  return (
    <article className="print-doc">
      <h1 className="print-doc-title">{title}</h1>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          <BlockView block={b} />
        </Fragment>
      ))}
    </article>
  );
}
