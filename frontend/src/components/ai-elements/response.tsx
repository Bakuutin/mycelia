"use client";

import { cn } from "@/lib/utils";
import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";
import { MarkdownLink } from "@/components/chat/MarkdownLink";

type ResponseProps = ComponentProps<typeof Streamdown>;

// Module-scope constant: the memo below only compares children, so the
// components override must be referentially stable.
const markdownComponents = { a: MarkdownLink };

export const Response = memo(
  ({ className, components, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      components={components ?? markdownComponents}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
