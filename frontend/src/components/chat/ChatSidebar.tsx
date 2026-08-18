import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useFormattedTime } from "@/lib/formatTime";
import type { MemoryChatSummary } from "@/lib/chat";

function ChatListItem({
  chat,
  selected,
  onRename,
  onFavorite,
}: {
  chat: MemoryChatSummary;
  selected: boolean;
  onRename: (chatId: string, title: string) => Promise<void>;
  onFavorite: (chatId: string, favorite: boolean) => Promise<void>;
}) {
  const chatId = chat._id.toString();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chat.title || chat.name || "New Chat");
  const inputRef = useRef<HTMLInputElement>(null);
  const displayTitle = chat.title || chat.name || "New Chat";
  const date = chat.lastMessageDate
    ? new Date(chat.lastMessageDate)
    : new Date(chat.createdAt);
  const time = useFormattedTime(date);
  const model = chat.lastResponseModel || chat.model || "Default model";

  useEffect(() => setTitle(displayTitle), [displayTitle]);
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = async () => {
    const next = title.trim();
    if (next && next !== displayTitle) await onRename(chatId, next);
    else setTitle(displayTitle);
    setEditing(false);
  };

  const content = (
    <>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-red-500/20">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        {editing
          ? (
            <Input
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void save()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save();
                }
                if (event.key === "Escape") {
                  setTitle(displayTitle);
                  setEditing(false);
                }
              }}
              aria-label="Chat title"
              className="h-8"
            />
          )
          : (
            <div className="line-clamp-2 pr-1 text-sm font-medium leading-5">
              {displayTitle}
            </div>
          )}
        <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <span>{chat.messageCount} messages</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate font-mono" title={model}>
            {model}
          </span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0" title={date.toLocaleString()}>{time}</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {chat.lastRun?.state &&
            !["completed", "cancelled"].includes(chat.lastRun.state) && (
            <Badge variant="outline" className="h-4 px-1 text-[9px] capitalize">
              {chat.lastRun.state.replace("_", " ")}
            </Badge>
          )}
          {chat.unread && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Unread
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "group relative border-b px-3 py-3 transition-colors hover:bg-muted/50",
        selected && "bg-muted",
      )}
    >
      <div className="flex items-start gap-2">
        {editing
          ? (
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {content}
            </div>
          )
          : (
            <Link
              to={`/chat/${chatId}`}
              aria-current={selected ? "page" : undefined}
              className="flex min-w-0 flex-1 items-start gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={displayTitle}
            >
              {content}
            </Link>
          )}
        <div className="flex shrink-0 flex-col gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7",
              !chat.favoritedAt &&
                "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
            aria-label={chat.favoritedAt
              ? "Remove from favorites"
              : "Add to favorites"}
            onClick={() => void onFavorite(chatId, !chat.favoritedAt)}
          >
            <Star
              className={cn(
                "h-3.5 w-3.5",
                chat.favoritedAt && "fill-amber-400 text-amber-500",
              )}
            />
          </Button>
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label="Rename chat"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatSidebar({
  chats,
  selectedChatId,
  loading,
  loadingMore,
  hasMore,
  error,
  query,
  favoritesOnly,
  onQueryChange,
  onFavoritesOnlyChange,
  onNewChat,
  onRetry,
  onLoadMore,
  onRename,
  onFavorite,
}: {
  chats: MemoryChatSummary[];
  selectedChatId?: string;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error?: string;
  query: string;
  favoritesOnly: boolean;
  onQueryChange: (query: string) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onNewChat: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onRename: (chatId: string, title: string) => Promise<void>;
  onFavorite: (chatId: string, favorite: boolean) => Promise<void>;
}) {
  const favorites = chats.filter((chat) => Boolean(chat.favoritedAt));
  const recent = chats.filter((chat) => !chat.favoritedAt);
  const sections = favoritesOnly
    ? [{ label: "Favorites", items: favorites }]
    : [
      { label: "Favorites", items: favorites },
      {
        label: favorites.length > 0 ? "Recent" : "Conversations",
        items: recent,
      },
    ];

  return (
    <aside
      className="flex h-full min-w-0 flex-col"
      aria-label="AI chat conversations"
    >
      <div className="border-b bg-muted/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Conversations</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewChat}
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant={favoritesOnly ? "secondary" : "outline"}
            size="icon"
            onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
            aria-label={favoritesOnly
              ? "Show all chats"
              : "Show favorites only"}
          >
            <Star
              className={cn(
                "h-4 w-4",
                favoritesOnly && "fill-amber-400 text-amber-500",
              )}
            />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {loading
          ? (
            <div className="space-y-3 p-3" aria-label="Loading chats">
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-20 w-full" />
              ))}
            </div>
          )
          : error
          ? (
            <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4" /> Could not load chats
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={onRetry}
              >
                Retry
              </Button>
            </div>
          )
          : chats.length === 0
          ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No conversations found
            </div>
          )
          : (
            <div>
              {sections.map((section) =>
                section.items.length > 0 && (
                  <section key={section.label} aria-label={section.label}>
                    <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      {section.label}
                    </div>
                    {section.items.map((chat) => (
                      <ChatListItem
                        key={chat._id.toString()}
                        chat={chat}
                        selected={selectedChatId === chat._id.toString()}
                        onRename={onRename}
                        onFavorite={onFavorite}
                      />
                    ))}
                  </section>
                )
              )}
              {hasMore && (
                <div className="p-3 text-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={loadingMore}
                    onClick={onLoadMore}
                  >
                    {loadingMore ? "Loading…" : "Load older chats"}
                  </Button>
                </div>
              )}
            </div>
          )}
      </ScrollArea>
    </aside>
  );
}
