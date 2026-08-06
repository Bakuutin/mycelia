import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ObjectChip, TimeRangeChip } from "@/components/chat/chips";

const OBJECT_LINK_RE = /^\/objects\/([a-fA-F0-9]{24})$/;

function textOf(children: ReactNode): string | undefined {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    const text = children.filter((c) => typeof c === "string").join("");
    return text || undefined;
  }
  return undefined;
}

/**
 * Absolute URLs pointing at this app (same origin, or a localhost Mycelia
 * endpoint in older messages) are reduced to their in-app path so they get
 * chip treatment too.
 */
function toInternalHref(href: string): string {
  if (href.startsWith("/")) return href;
  try {
    const url = new URL(href);
    const sameApp = url.origin === globalThis.location?.origin ||
      /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
    if (sameApp && url.pathname.startsWith("/")) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // not a valid absolute URL — fall through
  }
  return href;
}

/**
 * Anchor renderer for assistant markdown. Internal links become interactive
 * chips (object / time-range) or SPA navigations; external links open in a
 * new tab.
 */
export function MarkdownLink(
  { href: rawHref, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>,
) {
  const navigate = useNavigate();

  if (!rawHref) return <span {...props}>{children}</span>;

  const href = toInternalHref(rawHref);

  const objectMatch = href.match(OBJECT_LINK_RE);
  if (objectMatch) {
    return <ObjectChip id={objectMatch[1]} fallbackLabel={textOf(children)} />;
  }

  if (href.startsWith("/timeline?") || href.startsWith("/transcript?")) {
    return <TimeRangeChip href={href} label={textOf(children)} />;
  }

  if (href.startsWith("/")) {
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      navigate(href);
    };
    return (
      <a href={href} onClick={handleClick} {...props}>
        {children}
      </a>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  );
}
