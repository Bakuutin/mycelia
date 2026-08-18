import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Pin, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ModelSelector } from "@/components/ModelSelector";
import { ChatToolSelector } from "@/components/chat/ChatToolSelector";
import { cn } from "@/lib/utils";
import {
  type MemoryChatMessage,
  type MemoryChatSummary,
  messageText,
} from "@/lib/chat";
import type {
  ChatToolCatalogEntry,
  ChatToolPolicy,
} from "@myceliasdk/messengers.ts";

export function ChatThreadHeader({
  chat,
  title,
  status,
  selectedModel,
  selectedProviderId,
  resolvedModel,
  toolPolicy,
  toolCatalog,
  pinnedMessages,
  controlsDisabled,
  onBack,
  onRename,
  onFavorite,
  onModelChange,
  onToolPolicyChange,
  onJumpToMessage,
}: {
  chat?: MemoryChatSummary;
  title: string;
  status: string;
  selectedModel: string;
  selectedProviderId?: string;
  resolvedModel: string;
  toolPolicy: ChatToolPolicy;
  toolCatalog: ChatToolCatalogEntry[];
  pinnedMessages: MemoryChatMessage[];
  controlsDisabled?: boolean;
  onBack: () => void;
  onRename: (title: string) => Promise<void>;
  onFavorite: (favorite: boolean) => Promise<void>;
  onModelChange: (model: string, providerProfileId?: string) => Promise<void>;
  onToolPolicyChange: (policy: ChatToolPolicy) => Promise<void>;
  onJumpToMessage: (messageId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nextTitle, setNextTitle] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setNextTitle(title), [title]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const saveTitle = async () => {
    const trimmed = nextTitle.trim();
    if (trimmed && trimmed !== title) await onRename(trimmed);
    else setNextTitle(title);
    setEditing(false);
  };

  return (
    <header className="border-b bg-muted/20 px-3 py-3 sm:px-4">
      <div className="flex min-w-0 items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {editing
              ? (
                <div className="flex min-w-0 flex-1 gap-1">
                  <Input
                    ref={inputRef}
                    value={nextTitle}
                    onChange={(event) => setNextTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveTitle();
                      if (event.key === "Escape") {
                        setNextTitle(title);
                        setEditing(false);
                      }
                    }}
                    className="h-8"
                    aria-label="Chat title"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void saveTitle()}
                    aria-label="Save chat title"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditing(false)}
                    aria-label="Cancel rename"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )
              : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={!chat}
                  className="min-w-0 truncate rounded text-left text-base font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={`${title} — click to rename`}
                >
                  {title}
                </button>
              )}
            <Badge
              variant={status === "Error" ? "destructive" : "outline"}
              className={cn(
                "shrink-0",
                status === "Answering" && "border-blue-500/40 text-blue-600",
                status === "Needs approval" &&
                  "border-amber-500/40 text-amber-600",
              )}
              role="status"
              aria-live="polite"
            >
              {status}
            </Badge>
          </div>
          <div
            className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            title={resolvedModel}
          >
            Next response: {selectedModel || "configured default"}
            {selectedModel && resolvedModel !== selectedModel
              ? ` → ${resolvedModel}`
              : ""}
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={`${pinnedMessages.length} pinned messages`}
            >
              <Pin
                className={cn(
                  "h-4 w-4",
                  pinnedMessages.length > 0 && "fill-primary/20 text-primary",
                )}
              />
              {pinnedMessages.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] text-primary-foreground">
                  {pinnedMessages.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(360px,calc(100vw-2rem))]"
          >
            <div className="mb-2 font-medium">Pinned messages</div>
            {pinnedMessages.length === 0
              ? (
                <p className="text-sm text-muted-foreground">
                  Pin useful messages to find them quickly.
                </p>
              )
              : (
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {pinnedMessages.map((message) => (
                    <button
                      key={message.id}
                      type="button"
                      onClick={() => onJumpToMessage(message.id)}
                      className="w-full rounded-md p-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="line-clamp-2">
                        {messageText(message) || "Tool activity"}
                      </span>
                      <span className="text-[10px] capitalize text-muted-foreground">
                        {message.role}
                      </span>
                    </button>
                  ))}
                </div>
              )}
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void onFavorite(!chat?.favoritedAt)}
          aria-label={chat?.favoritedAt
            ? "Remove chat from favorites"
            : "Add chat to favorites"}
          disabled={!chat}
        >
          <Star
            className={cn(
              "h-4 w-4",
              chat?.favoritedAt && "fill-amber-400 text-amber-500",
            )}
          />
        </Button>
      </div>
      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(220px,1fr)_auto]">
        <div className="min-w-0">
          <ModelSelector
            value={selectedModel}
            onChange={() => {}}
            providerValue={selectedProviderId}
            onSelectWithProvider={(model, providerProfileId) =>
              void onModelChange(model, providerProfileId)}
            disabled={controlsDisabled}
            placeholder="Use configured chat default"
            className="min-w-0 max-w-full"
            prefetch
          />
        </div>
        <ChatToolSelector
          policy={toolPolicy}
          catalog={toolCatalog}
          disabled={controlsDisabled}
          onChange={(policy) => void onToolPolicyChange(policy)}
        />
      </div>
    </header>
  );
}
