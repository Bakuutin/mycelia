import type { Platform } from "../core/types.ts";
import { defaultPlatform } from "./default.tsx";
import { Send, PhoneCall, Video, File, Download } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);

  return parts.join(" ");
}

const TelegramMessageComponent: Platform["MessageComponent"] = ({ message }) => {
  const raw = message.raw;

  // Handle Phone Call Service Messages
  if (raw?.type === "service" && raw?.action === "phone_call") {
     const actor = raw.actor || "Unknown User";
     const duration = raw.duration_seconds ? formatDuration(raw.duration_seconds) : null;
     const discardReason = raw.discard_reason;

     return (
         <div className="flex items-center justify-center w-full my-4">
            <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-4 py-2 rounded-full shadow-sm border">
                    <PhoneCall className="w-4 h-4" />
                    <span className="font-medium">{actor}</span>
                    <span>called</span>
                    {duration && <span className="font-mono text-xs opacity-80">({duration})</span>}
                </div>
                {discardReason && (
                    <span className="text-[10px] text-muted-foreground opacity-60 uppercase tracking-wider">
                        {discardReason.replace(/_/g, " ")}
                    </span>
                )}
            </div>
         </div>
     );
  }

  // Handle Video Messages (Circular Video / Video Note)
  if (raw?.media_type === "video_message" || (raw?.mime_type === "video/mp4" && raw?.width === raw?.height)) {
    const mediaItem = message.media?.find(m => m.type === "video");
    const videoUrl = mediaItem?.url || mediaItem?.path;
    const duration = raw.duration_seconds ? formatDuration(raw.duration_seconds) : null;

    return (
        <defaultPlatform.MessageComponent message={message}>
           <div className="flex flex-col items-center justify-center gap-2 p-2 bg-muted/20 rounded-full aspect-square w-48 h-48 border-4 border-muted overflow-hidden relative group">
                {videoUrl ? (
                    <video src={videoUrl} controls className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center text-muted-foreground">
                        <Video className="w-8 h-8 opacity-50 mb-1" />
                        <span className="text-xs font-semibold">Video Message</span>
                        {duration && <span className="text-[10px] opacity-70">{duration}</span>}
                        <span className="text-[9px] opacity-50 mt-1 italic">File not available</span>
                    </div>
                )}
           </div>
        </defaultPlatform.MessageComponent>
    );
  }

  // Handle Generic File Messages (Documents/APKs/etc)
  if (raw?.file_name || raw?.mime_type) {
    const fileName = raw.file_name || "Unknown File";
    const mimeType = raw.mime_type || "application/octet-stream";
    const mediaItem = message.media?.find(m => m.type === "file");
    const fileUrl = mediaItem?.url || mediaItem?.path;
    
    // Check if this is likely just a document attachment logic
    const isGenericFile = !message.text && !message.media?.some(m => m.type === "image" || m.type === "video" || m.type === "audio");

    if (isGenericFile || raw.file_name) {
        return (
            <defaultPlatform.MessageComponent message={message}>
                <div className="flex items-center gap-3 p-3 border bg-card/50 max-w-sm">
                    <div className="bg-primary/10 p-2 rounded-lg">
                        <File className="w-6 h-6 text-primary" />
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-medium truncate" title={fileName}>
                            {fileName}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                            {mimeType}
                        </span>
                    </div>
                    {fileUrl && (
                        <a href={fileUrl} download={fileName} target="_blank" rel="noreferrer">
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                                <Download className="w-4 h-4" />
                            </Button>
                        </a>
                    )}
                </div>
            </defaultPlatform.MessageComponent>
        );
    }
  }

  // Fallback to default renderer
  return <defaultPlatform.MessageComponent message={message} />;
};

export const telegramPlatform: Platform = {
  ...defaultPlatform,
  id: "telegram",
  name: "Telegram",
  icon: Send,
  MessageComponent: TelegramMessageComponent,
};
