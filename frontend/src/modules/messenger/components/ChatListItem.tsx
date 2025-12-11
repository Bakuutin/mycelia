import { usePlatform } from "../core/useMessageRenderer.ts";
import type { Chat } from "@interfaces/messengers.ts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useFormattedTime } from "@/lib/formatTime";

interface ChatListItemProps {
  chat: Chat;
  isSelected: boolean;
  onClick: () => void;
}

export function ChatListItem({ chat, isSelected, onClick }: ChatListItemProps) {
  const platform = usePlatform(chat.platform);
  const lastDate = chat.lastMessageDate ? new Date(chat.lastMessageDate) : null;
  const formattedDate = lastDate ? useFormattedTime(lastDate) : "";

  // If the platform has a custom preview component, use it
  if (platform?.ChatPreviewComponent) {
    return (
      <platform.ChatPreviewComponent 
        chat={chat} 
        isSelected={isSelected} 
        onClick={onClick} 
      />
    );
  }

  const Icon = platform?.icon;

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 p-4 cursor-pointer hover:bg-accent transition-colors border-b",
        isSelected && "bg-accent"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex flex-col overflow-hidden">
            <span className="font-semibold truncate">{chat.name || "Unknown Chat"}</span>
            <div className="flex items-center gap-1">
                 {Icon && <Icon className="w-3 h-3 text-muted-foreground mr-1" />}
                 {chat.platform && (
                   <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 capitalize">
                     {platform?.name || chat.platform}
                   </Badge>
                 )}
            </div>
          </div>
        </div>
        {lastDate && (
          <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
            {formattedDate}
          </span>
        )}
      </div>
    </div>
  );
}

