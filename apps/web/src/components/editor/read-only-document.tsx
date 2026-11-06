import { cn } from "@notes-learning/ui/lib/utils";

import type { TipTapDoc, TipTapNode } from "@notes-learning/domain";

import { MermaidDiagram } from "../diagram/mermaid-diagram";

function renderMarks(
  node: TipTapNode,
  text: React.ReactNode,
  onPageLink?: (pageId: string) => void,
): React.ReactNode {
  let result = text;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "bold":
        result = <strong>{result}</strong>;
        break;
      case "italic":
        result = <em>{result}</em>;
        break;
      case "strike":
        result = <s>{result}</s>;
        break;
      case "underline":
        result = <u>{result}</u>;
        break;
      case "code":
        result = <code>{result}</code>;
        break;
      case "highlight":
        result = <mark>{result}</mark>;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : null;
        if (href && /^https?:\/\//.test(href)) {
          result = (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {result}
            </a>
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return result;
}

function renderNode(
  node: TipTapNode,
  key: string,
  onPageLink?: (pageId: string) => void,
): React.ReactNode {
  const children = (node.content ?? []).map((child, index) =>
    renderNode(child, `${key}-${index}`, onPageLink),
  );
  switch (node.type) {
    case "doc":
      return <>{children}</>;
    case "text":
      return <span key={key}>{renderMarks(node, node.text ?? "", onPageLink)}</span>;
    case "paragraph":
      return <p key={key}>{children.length ? children : <br />}</p>;
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      const Tag = (`h${Math.min(4, Math.max(1, level))}` as "h1" | "h2" | "h3" | "h4");
      return <Tag key={key}>{children}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return <ol key={key}>{children}</ol>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList">
          {node.content?.map((item, index) => {
            const checked = item.attrs?.checked === true;
            return (
              <li key={`${key}-${index}`} data-checked={checked ? "true" : "false"}>
                <label>
                  <input type="checkbox" checked={checked} readOnly />
                </label>
                <div>
                  {(item.content ?? []).map((child, childIndex) =>
                    renderNode(child, `${key}-${index}-${childIndex}`, onPageLink),
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      );
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = node.content?.map((child) => child.text ?? "").join("") ?? "";
      if (language.toLowerCase() === "mermaid" && code.trim()) {
        return <MermaidDiagram key={key} source={code} className="my-4 max-h-96" />;
      }
      return (
        <pre key={key} data-language={language}>
          <code>{code}</code>
        </pre>
      );
    }
    case "horizontalRule":
      return <hr key={key} />;
    case "hardBreak":
      return <br key={key} />;
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src ? <img key={key} src={src} alt={alt} loading="lazy" /> : null;
    }
    case "callout": {
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Note";
      const emoji = typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "✦";
      const color = typeof node.attrs?.color === "string" ? node.attrs.color : "saffron";
      return (
        <div key={key} data-type="callout" data-color={color} className="callout-block">
          <div className="callout-title">
            <span>{emoji}</span>
            {title}
          </div>
          <div className="callout-content">{children}</div>
        </div>
      );
    }
    case "pageLink": {
      const pageId = typeof node.attrs?.pageId === "string" ? node.attrs.pageId : "";
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Untitled";
      const icon = typeof node.attrs?.icon === "string" ? node.attrs.icon : "◇";
      return (
        <button
          key={key}
          type="button"
          onClick={() => pageId && onPageLink?.(pageId)}
          className="inline-flex items-center gap-1 border-b border-primary/25 text-link"
        >
          <span className="text-[0.75em]">{icon}</span>
          {title}
        </button>
      );
    }
    case "diagram": {
      const source = typeof node.attrs?.source === "string" ? node.attrs.source : "";
      const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
      if (!source.trim()) return null;
      return (
        <figure key={key} className="my-4">
          <MermaidDiagram source={source} className="max-h-96" />
          {caption ? (
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">
              {caption}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    case "request": {
      const method = typeof node.attrs?.method === "string" ? node.attrs.method : "GET";
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const headers = typeof node.attrs?.headers === "string" ? node.attrs.headers.trim() : "";
      const body = typeof node.attrs?.body === "string" ? node.attrs.body.trim() : "";
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      return (
        <div key={key} className="my-4 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs">
              {method}
            </span>
            <code className="truncate text-xs">{url || "No URL"}</code>
          </div>
          {label ? (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">{label}</p>
          ) : null}
          {headers || body ? (
            <pre className="max-h-56 overflow-auto border-t border-border/60 bg-background/40 px-3 py-2 font-mono text-xs leading-relaxed">
              <code>{[headers, body].filter(Boolean).join("\n\n")}</code>
            </pre>
          ) : null}
          <p className="border-t border-border/60 px-3 py-1 text-xs text-muted-foreground/60">
            Open in Lattice to run this request.
          </p>
        </div>
      );
    }
    case "pageEmbed": {
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Embedded page";
      return (
        <div key={key} className="my-4 rounded-lg border border-border bg-muted/25 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Embedded page</div>
          <div className="mt-1 text-sm font-medium">{title}</div>
        </div>
      );
    }
    case "liveBlock":
      return (
        <div key={key} className="my-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
          Live block · open in Lattice to view
        </div>
      );
    case "database": {
      const fields = Array.isArray(node.attrs?.fields)
        ? (node.attrs.fields as Array<{ id: string; name: string }>)
        : [];
      const rows = Array.isArray(node.attrs?.rows)
        ? (node.attrs.rows as Array<{ id: string; values: Record<string, unknown> }>)
        : [];
      return (
        <div key={key} className="my-4 overflow-x-auto rounded-lg border border-border">
          <table>
            <thead>
              <tr>
                {fields.map((field) => (
                  <th key={field.id}>{field.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {fields.map((field) => (
                    <td key={field.id}>{String(row.values[field.id] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "bookmark": {
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : url;
      const description = typeof node.attrs?.description === "string" ? node.attrs.description : "";
      return (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="my-4 block rounded-lg border border-border bg-muted/20 px-4 py-3 no-underline"
        >
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description || url}</div>
        </a>
      );
    }
    case "table":
      return (
        <div key={key} className="tableWrapper">
          <table>
            <tbody>
              {node.content?.map((row, index) => (
                <tr key={`${key}-${index}`}>
                  {row.content?.map((cell, cellIndex) => {
                    const CellTag = cell.type === "tableHeader" ? "th" : "td";
                    return (
                      <CellTag key={`${key}-${index}-${cellIndex}`}>
                        {(cell.content ?? []).map((child, childIndex) =>
                          renderNode(child, `${key}-${index}-${cellIndex}-${childIndex}`, onPageLink),
                        )}
                      </CellTag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "details": {
      const summary = node.content?.find((child) => child.type === "detailsSummary");
      const content = node.content?.find((child) => child.type === "detailsContent");
      return (
        <details key={key}>
          <summary>{summary?.content?.map((child) => child.text ?? "").join("")}</summary>
          <div>
            {(content?.content ?? []).map((child, index) =>
              renderNode(child, `${key}-detail-${index}`, onPageLink),
            )}
          </div>
        </details>
      );
    }
    case "inlineMath":
    case "mathInline":
      return <span key={key}>{String(node.attrs?.latex ?? node.attrs?.math ?? "")}</span>;
    case "blockMath":
    case "mathBlock":
      return <div key={key}>{String(node.attrs?.latex ?? node.attrs?.math ?? "")}</div>;
    case "youtube":
      return (
        <div key={key} className="my-4 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground">
          YouTube embed · open in Lattice to watch
        </div>
      );
    default:
      return <div key={key}>{children}</div>;
  }
}

export function ReadOnlyDocument({
  doc,
  className,
  compact = false,
  onPageLink,
}: {
  doc: TipTapDoc | null | undefined;
  className?: string;
  compact?: boolean;
  onPageLink?: (pageId: string) => void;
}) {
  if (!doc?.content?.length) {
    return <p className={cn("text-xs text-muted-foreground", className)}>No content yet.</p>;
  }
  return (
    <div className={cn("tiptap", compact && "tiptap-compact", className)}>
      {doc.content.map((node, index) => renderNode(node, `node-${index}`, onPageLink))}
    </div>
  );
}
