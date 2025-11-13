"use client";

import {
  EmojiPicker as EmojiPickerPrimitive,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";
import { LoaderIcon, SearchIcon, X } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Icon } from "@/types/icon";

function EmojiPicker({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Root>) {
  return (
    <EmojiPickerPrimitive.Root
      className={cn(
        "bg-popover text-popover-foreground isolate flex h-full w-fit flex-col overflow-hidden rounded-md",
        className,
      )}
      data-slot="emoji-picker"
      {...props}
    />
  );
}

function EmojiPickerSearch({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Search>) {
  return (
    <div
      className={cn("flex h-9 items-center gap-2 border-b px-3", className)}
      data-slot="emoji-picker-search-wrapper"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <EmojiPickerPrimitive.Search
        className="outline-hidden placeholder:text-muted-foreground flex h-9 w-full rounded-md bg-transparent py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        data-slot="emoji-picker-search"
        {...props}
      />
    </div>
  );
}

function EmojiPickerRow({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="scroll-my-1 px-1" data-slot="emoji-picker-row">
      {children}
    </div>
  );
}

function EmojiPickerEmoji({
  emoji,
  className,
  ...props
}: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      className={cn(
        "data-[active]:bg-accent flex size-7 items-center justify-center rounded-sm text-base",
        className,
      )}
      data-slot="emoji-picker-emoji"
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({
  category,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className="bg-popover text-muted-foreground px-3 pb-2 pt-3.5 text-xs leading-none"
      data-slot="emoji-picker-category-header"
    >
      {category.label}
    </div>
  );
}

function EmojiPickerContent({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Viewport>) {
  return (
    <EmojiPickerPrimitive.Viewport
      className={cn("outline-hidden relative flex-1", className)}
      data-slot="emoji-picker-viewport"
      {...props}
    >
      <EmojiPickerPrimitive.Loading
        className="absolute inset-0 flex items-center justify-center text-muted-foreground"
        data-slot="emoji-picker-loading"
      >
        <LoaderIcon className="size-4 animate-spin" />
      </EmojiPickerPrimitive.Loading>
      <EmojiPickerPrimitive.Empty
        className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm"
        data-slot="emoji-picker-empty"
      >
        No emoji found.
      </EmojiPickerPrimitive.Empty>
      <EmojiPickerPrimitive.List
        className="select-none pb-1"
        components={{
          Row: EmojiPickerRow,
          Emoji: EmojiPickerEmoji,
          CategoryHeader: EmojiPickerCategoryHeader,
        }}
        data-slot="emoji-picker-list"
      />
    </EmojiPickerPrimitive.Viewport>
  );
}

function EmojiPickerFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-w-(--frimousse-viewport-width) flex w-full min-w-0 items-center gap-1 border-t p-2",
        className,
      )}
      data-slot="emoji-picker-footer"
      {...props}
    >
      <EmojiPickerPrimitive.ActiveEmoji>
        {({ emoji }) =>
          emoji
            ? (
              <>
                <div className="flex size-7 flex-none items-center justify-center text-lg">
                  {emoji.emoji}
                </div>
                <span className="text-secondary-foreground truncate text-xs">
                  {emoji.label}
                </span>
              </>
            )
            : (
              <span className="text-muted-foreground ml-1.5 flex h-7 items-center truncate text-xs">
                Select an emoji…
              </span>
            )}
      </EmojiPickerPrimitive.ActiveEmoji>
    </div>
  );
}

interface EmojiPickerButtonProps {
  value?: Icon;
  onChange: (icon: Icon) => void;
}

function EmojiPickerButton({ value, onChange }: EmojiPickerButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleEmojiSelect = (emoji: string) => {
    onChange({ text: emoji });
    setIsOpen(false);
  };

  const handleRemove = () => {
    onChange(undefined);
    setIsOpen(false);
  };

  const displayIcon = value && "text" in value
    ? value.text
    : value && "base64" in value
    ? (
      <img
        src={`data:image/png;base64,${value.base64}`}
        alt="icon"
        className="w-6 h-6"
      />
    )
    : null;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="w-[2.5rem] p-0"
      >
        {displayIcon || "🫥"}
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 top-full mt-2 z-50 bg-popover border rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between p-2 border-b">
              <h3 className="text-sm font-semibold">Pick an emoji</h3>
              <div className="flex gap-1">
                {value && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRemove}
                    className="h-8 px-2"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="h-80">
              <EmojiPicker
                onEmojiSelect={(emoji) => handleEmojiSelect(emoji.emoji)}
              >
                <EmojiPickerSearch placeholder="Search emoji..." />
                <EmojiPickerContent />
                <EmojiPickerFooter />
              </EmojiPicker>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export {
  EmojiPicker,
  EmojiPickerButton,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
};
