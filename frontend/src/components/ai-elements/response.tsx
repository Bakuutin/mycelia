"use client";

import { cn } from "@/lib/utils";
import { type ComponentProps, memo } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { MarkdownLink } from "@/components/chat/MarkdownLink";

type ResponseProps = ComponentProps<typeof Streamdown>;

// Module-scope constants: the memo below only compares children, so these
// overrides must be referentially stable.
const markdownComponents = { a: MarkdownLink };

// Streamdown's default harden plugin blocks relative links (/objects/…)
// because it has no defaultOrigin to resolve them against. Re-run it with
// the app's own origin so internal links survive and render as chips.
const hardenPlugin = (defaultRehypePlugins as any).harden;
const rehypePlugins = [
  (defaultRehypePlugins as any).raw,
  (defaultRehypePlugins as any).katex,
  [
    Array.isArray(hardenPlugin) ? hardenPlugin[0] : hardenPlugin,
    {
      allowedImagePrefixes: ["*"],
      allowedLinkPrefixes: ["*"],
      allowedProtocols: ["*"],
      defaultOrigin: globalThis.location?.origin,
      allowDataImages: true,
    },
  ],
];

export const Response = memo(
  ({ className, components, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      components={components ?? markdownComponents}
      rehypePlugins={rehypePlugins as any}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
