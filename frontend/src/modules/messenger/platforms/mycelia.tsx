import type { Platform } from "../core/types.ts";
import { defaultPlatform } from "./default.tsx";
import { User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatRelativeTime } from "@/lib/formatTime";
import { cn } from "@/lib/utils";
import { Response } from "@/components/ai-elements/response";
import { normalizeMessageParts } from "@/lib/chatUiMessages";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

interface MyceliaMessageProps {
  message: import("@myceliasdk/messengers.ts").Message;
  children?: React.ReactNode;
}

interface ParsedMessageContent {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: Array<{
    uiType: string;
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    output?: unknown;
    error?: string;
    state: 'input-available' | 'output-available' | 'output-error';
  }>;
}

function parseMessageContent(raw: any): ParsedMessageContent {
  const role = raw?.role === 'user' ? 'user' : 'assistant';
  const parts = normalizeMessageParts(raw?.parts, raw?.content);
  const textContent = parts
    .filter((part: any) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('\n\n');
  const toolCalls: ParsedMessageContent['toolCalls'] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;

    const type = (part as any).type;
    const state = (part as any).state;
    if (
      typeof type !== "string" ||
      (!type.startsWith("tool-") && type !== "dynamic-tool") ||
      typeof state !== "string"
    ) {
      continue;
    }

    const toolName = type === "dynamic-tool"
      ? String((part as any).toolName ?? "dynamic-tool")
      : type.slice(5);
    const approvalReason = (part as any).approval?.reason;
    const displayState = state === "output-available"
      ? "output-available"
      : state === "output-error" || state === "output-denied"
        ? "output-error"
        : "input-available";

    toolCalls.push({
      uiType: type,
      toolCallId: String((part as any).toolCallId),
      toolName,
      input: ((part as any).input ?? {}) as Record<string, unknown>,
      output: state === "output-available" ? (part as any).output : undefined,
      error: state === "output-error"
        ? String((part as any).errorText ?? "Tool execution failed.")
        : state === "output-denied"
          ? String(approvalReason ?? "Tool execution denied.")
          : undefined,
      state: displayState,
    });
  }
  
  return { role, content: textContent, toolCalls };
}

function ToolCallDisplay({ toolCall }: { toolCall: ParsedMessageContent['toolCalls'][0] }) {
  return (
    <Tool className="group">
      <ToolHeader
        title={toolCall.toolName}
        type={toolCall.uiType as any}
        state={toolCall.state}
      />
      <ToolContent>
        <ToolInput input={toolCall.input} />
        <ToolOutput
          output={toolCall.output}
          errorText={toolCall.error}
        />
      </ToolContent>
    </Tool>
  );
}

function MyceliaMessageBubble({ message }: MyceliaMessageProps) {
  const navigate = useNavigate();
  const formattedDate = formatRelativeTime(new Date(message.timestamp));
  const raw = message.raw;
  
  const { role, content, toolCalls } = parseMessageContent(raw);
  const isUser = role === 'user';
  const hasToolCalls = toolCalls.length > 0;
  const hasContent = content.length > 0;
  
  const senderName = isUser 
    ? (raw?.from || raw?.sender_name || "You")
    : "Mycelia";

  const handleSenderClick = () => {
    if (message.senderId) {
      navigate(`/objects/${message.senderId.toString()}`);
    }
  };

  return (
    <div className={cn(
      "flex w-full py-2 group",
      isUser ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "flex gap-3 max-w-[85%] sm:max-w-[75%]",
        isUser ? "flex-row-reverse" : "flex-row"
      )}>
        {/* Avatar */}
        <div className={cn(
          "shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
          isUser 
            ? "bg-primary/10 text-primary" 
            : "bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-red-500/20"
        )}>
          {isUser ? (
            <User className="w-4 h-4" />
          ) : (
            <span className="text-base" role="img" aria-label="Mycelia">🍄</span>
          )}
        </div>
        
        {/* Message Content */}
        <div className="flex flex-col min-w-0 gap-1">
          {/* Header */}
          <div className={cn(
            "flex items-center gap-2",
            isUser ? "justify-end" : "justify-start"
          )}>
            <span 
              className={cn(
                "text-xs font-medium cursor-pointer hover:underline underline-offset-2 transition-colors",
                isUser 
                  ? "text-primary" 
                  : "text-amber-600 dark:text-amber-400"
              )}
              onClick={handleSenderClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSenderClick();
                }
              }}
            >
              {senderName}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {formattedDate}
            </span>
          </div>
          
          {/* Tool Calls */}
          {hasToolCalls && (
            <div className="space-y-2 w-full">
              {toolCalls.map((tc) => (
                <ToolCallDisplay key={tc.toolCallId} toolCall={tc} />
              ))}
            </div>
          )}
          
          {/* Bubble - only show if there's text content */}
          {hasContent && (
            <div className={cn(
              "relative rounded-2xl px-4 py-3",
              isUser 
                ? "bg-primary text-primary-foreground rounded-tr-sm" 
                : "bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-amber-950/30 border border-amber-200/50 dark:border-amber-800/30 rounded-tl-sm"
            )}>
              {/* Mycelia glow effect for assistant */}
              {!isUser && (
                <div className="absolute inset-0 rounded-2xl rounded-tl-sm bg-gradient-to-br from-amber-500/5 to-orange-500/5 pointer-events-none" />
              )}
              
              {/* Content */}
              <div className={cn(
                "relative text-sm leading-relaxed",
                isUser ? "" : "text-foreground"
              )}>
                {isUser ? (
                  <span className="whitespace-pre-wrap">{content}</span>
                ) : (
                  <Response className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5">
                    {content}
                  </Response>
                )}
              </div>
            </div>
          )}
          
          {/* Fallback for completely empty messages */}
          {!hasContent && !hasToolCalls && (
            <div className={cn(
              "relative rounded-2xl px-4 py-3",
              "bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-amber-950/30 border border-amber-200/50 dark:border-amber-800/30 rounded-tl-sm"
            )}>
              <span className="text-muted-foreground italic text-sm">Empty message</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const MyceliaMessageComponent: Platform["MessageComponent"] = ({ message }) => {
  const raw = message.raw;
  
  const parts = normalizeMessageParts(raw?.parts, raw?.content);
  const hasContent = parts.length > 0 || !!raw?.role;
  
  if (hasContent) {
    return <MyceliaMessageBubble message={message} />;
  }

  return <defaultPlatform.MessageComponent message={message} />;
};

export const myceliaPlatform: Platform = {
  ...defaultPlatform,
  id: "mycelia",
  name: "Mycelia",
  icon: () => (
    <span>🍄</span>
  ),
  MessageComponent: MyceliaMessageComponent,
};
