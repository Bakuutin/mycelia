import type { Platform } from "../core/types.ts";
import { defaultPlatform } from "./default.tsx";
import { Sparkles, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useFormattedTime } from "@/lib/formatTime";
import { cn } from "@/lib/utils";
import { Response } from "@/components/ai-elements/response";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

interface MyceliaMessageProps {
  message: import("@interfaces/messengers.ts").Message;
  children?: React.ReactNode;
}

interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: { type: string; value: unknown };
  error?: string;
}

interface ParsedMessageContent {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: Array<{
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
  
  const content = raw?.content;
  let textContent = '';
  const toolCalls: ParsedMessageContent['toolCalls'] = [];
  
  if (typeof content === 'string') {
    textContent = content;
  } else if (Array.isArray(content)) {
    const textParts = content
      .filter((part: any) => part?.type === 'text' && part?.text)
      .map((part: any) => part.text)
      .join('\n\n');
    
    textContent = textParts;
    
    // Extract tool calls and results
    const toolCallParts = content.filter((part: any) => part?.type === 'tool-call') as ToolCallPart[];
    const toolResultParts = content.filter((part: any) => part?.type === 'tool-result') as ToolResultPart[];
    
    for (const call of toolCallParts) {
      const result = toolResultParts.find(r => r.toolCallId === call.toolCallId);
      toolCalls.push({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input || {},
        output: result?.output?.value,
        error: result?.error,
        state: result?.error ? 'output-error' : result ? 'output-available' : 'input-available',
      });
    }
  }
  
  return { role, content: textContent, toolCalls };
}

function ToolCallDisplay({ toolCall }: { toolCall: ParsedMessageContent['toolCalls'][0] }) {
  return (
    <Tool className="group">
      <ToolHeader
        title={toolCall.toolName}
        type="tool-call"
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
  const formattedDate = useFormattedTime(new Date(message.timestamp));
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
  
  const hasContent = raw?.content && (
    typeof raw.content === 'string' 
      ? raw.content.length > 0 
      : (Array.isArray(raw.content) && raw.content.length > 0)
  );
  
  if (hasContent || raw?.role) {
    return <MyceliaMessageBubble message={message} />;
  }

  return <defaultPlatform.MessageComponent message={message} />;
};

export const myceliaPlatform: Platform = {
  ...defaultPlatform,
  id: "mycelia",
  name: "Mycelia",
  icon: Sparkles,
  MessageComponent: MyceliaMessageComponent,
};
