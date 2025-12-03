import { useState, useRef, useEffect } from "react";
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
import { Message, MessageContent, MessageAvatar } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { Loader } from "@/components/ai-elements/loader";
import { Paperclip, UserIcon, BotIcon } from "lucide-react";
import { apiClient, callResource } from "@/lib/api";
import { ObjectId } from "bson";

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
    role: msg.role,
    content: msg.content,
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

function ChatMessageContent({ message }: { message: any }) {
  const content = message.content;
  const parts = message.parts;

  if (typeof content === 'string') {
    return <Response>{content}</Response>;
  }

  const items = Array.isArray(content) ? content : (Array.isArray(parts) ? parts : []);

  if (items.length > 0) {
    return (
      <>
        {items.map((part: any, index: number) => {
          
          if (typeof part === 'string' || (typeof part === 'object' && part.type === 'text')) {
            return <Response key={index}>{typeof part === 'string' ? part : part.text}</Response>;
          }

          if (typeof part === 'object' && part.type === 'start-step') {
            return (
              <div key={index} className="w-full my-2 first:mt-0 last:mb-0">
                <Loader />
              </div>
            );
          }

          return (
            <div key={index} className="w-full my-2 first:mt-0 last:mb-0">
              <CodeBlock
                code={JSON.stringify(part, null, 2)}
                language="json"
              />
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="w-full">
      <CodeBlock
        code={JSON.stringify(content || parts || message, null, 2)}
        language="json"
      />
    </div>
  );
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
      console.log("onFinish", newChatIdRef.current, chatId);
      if (newChatIdRef.current && newChatIdRef.current !== chatId) {
         navigate(`/chat/${newChatIdRef.current}`, { replace: true });
      }
    },
    onData: (data) => {
      console.log("data", data);
    },
    transport: new DefaultChatTransport<any>({
      api: "/api/chat",
      fetch: async (input, init) => {
        const path = input.toString();

        const response = await apiClient.fetch(path, init);

        const serverChatId = response.headers.get("X-Mycelia-Chat-Id");
        if (serverChatId) {
          console.log("serverChatId", serverChatId);
          newChatIdRef.current = serverChatId;
        }
        return response;
      },
    }),
  });

  useEffect(() => {
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
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {chat.messages.map((message) => (
          <Message key={message.id} from={message.role}>
            <MessageContent variant={message.role === 'user' ? 'contained' : 'flat'}>
              <ChatMessageContent message={message} />
            </MessageContent>
          </Message>
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
