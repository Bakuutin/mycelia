import { useState, useRef, useEffect, useMemo } from "react";
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
  PromptInputTools,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputSpeechButton,
} from "@/components/ai-elements/prompt-input";
import { Loader } from "@/components/ai-elements/loader";
import { Paperclip } from "lucide-react";
import { apiClient, callResource } from "@/lib/api";
import { ObjectId } from "bson";
import { myceliaPlatform } from "@/modules/messenger/platforms/mycelia";
import type { Message as MessengerMessage } from "@interfaces/messengers";

async function fetchMessages(chatId: string) {
  const messages = await callResource("mongo", {
    action: "find",
    collection: "messages",
    query: {
      chatId: new ObjectId(chatId),
    },
    options: {
      sort: { createdAt: 1 },
    },
  });

  return messages.map((msg: any) => ({
    id: msg._id.toString(),
    role: msg.raw?.role || msg.role,
    content: msg.raw?.content || msg.content,
    createdAt: new Date(msg.createdAt),
    toolInvocations: msg.toolCalls?.map((call: any) => {
      const result = msg.toolResults?.find(
        (r: any) => r.toolCallId === call.toolCallId
      );
      if (result) {
        return {
          state: "result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: call.args,
          result: result.result,
        };
      }
      return {
        state: "call",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: call.args,
      };
    }),
  }));
}

function isValidObjectId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

function toMessengerMessage(message: any): MessengerMessage {
  const content = message.content;
  const parts = message.parts;
  
  let normalizedContent: string | Array<{ type: string; text: string }>;
  
  if (typeof content === 'string') {
    normalizedContent = content;
  } else if (Array.isArray(content)) {
    normalizedContent = content;
  } else if (Array.isArray(parts)) {
    normalizedContent = parts
      .filter((p: any) => typeof p === 'string' || (p?.type === 'text' && p?.text))
      .map((p: any) => typeof p === 'string' ? { type: 'text', text: p } : p);
  } else {
    normalizedContent = '';
  }
  
  const messageId = isValidObjectId(message.id) ? new ObjectId(message.id) : new ObjectId();
  
  return {
    _id: messageId,
    chatId: new ObjectId(),
    senderId: new ObjectId(),
    platform: "mycelia",
    externalId: message.id,
    timestamp: message.createdAt || new Date(),
    createdAt: message.createdAt || new Date(),
    updatedAt: message.createdAt || new Date(),
    raw: {
      role: message.role,
      content: normalizedContent,
    },
  };
}

function ChatMessage({ message }: { message: any }) {
  const messengerMessage = useMemo(() => toMessengerMessage(message), [message]);
  const MessageComponent = myceliaPlatform.MessageComponent;
  
  const isStreaming = message.parts?.some((p: any) => p?.type === 'start-step');
  
  if (isStreaming) {
    return (
      <div className="flex w-full py-2">
        <div className="flex gap-3">
          <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-red-500/20">
            <span className="text-base" role="img" aria-label="Mycelia">🍄</span>
          </div>
          <div className="flex items-center">
            <Loader />
          </div>
        </div>
      </div>
    );
  }
  
  return <MessageComponent message={messengerMessage} />;
}

export default function ChatPage() {
  const [searchParams] = useSearchParams();
  const params = useParams();
  const navigate = useNavigate();
  const chatId = params.chatId ?? searchParams.get("id") ?? undefined;
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const newChatIdRef = useRef<string | null>(null);

  const chat = useChat({
    id: chatId,
    onFinish: () => {
      if (!chatId && newChatIdRef.current) {
        const newId = newChatIdRef.current;
        newChatIdRef.current = null;
        navigate(`/chat/${newId}`, { replace: true });
      }
    },
    transport: new DefaultChatTransport<any>({
      api: "/api/chat",
      body: { chatId },
      fetch: async (input, init) => {
        const path = input.toString();

        const response = await apiClient.fetch(path, init);

        const serverChatId = response.headers.get("X-Mycelia-Chat-Id");
        if (serverChatId) {
          newChatIdRef.current = serverChatId;
        }
        return response;
      },
    }),
  });

  useEffect(() => {
    console.log("chatId changed", chatId);
    if (chatId) {
       fetchMessages(chatId).then(msgs => chat.setMessages(msgs));
    }
  }, [chatId]);

  const handleInputSubmit = (value: { text?: string; files?: any[] }, event: React.FormEvent<HTMLFormElement>) => {
    if (value.text) {
      chat.sendMessage({ text: value.text });
      setInput("");
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {chat.messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
      </div>

      <div className="p-4">
        <PromptInput
          onSubmit={handleInputSubmit}
          className="border rounded-lg bg-background shadow-sm"
        >
          <PromptInputTextarea
            ref={textareaRef}
            placeholder="Type a message..."
            value={input}
            onChange={handleTextareaChange}
            disabled={chat.status === 'streaming' || chat.status === 'submitted'}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger>
                  <Paperclip className="size-4" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent>
                  <PromptInputActionMenuItem>Upload File</PromptInputActionMenuItem>
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputSpeechButton textareaRef={textareaRef} />
            </PromptInputTools>
            <PromptInputSubmit disabled={!input?.trim() || chat.status === 'streaming' || chat.status === 'submitted'} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
