import { useState, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
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
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Paperclip } from "lucide-react";
import { apiClient } from "@/lib/api";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chat = useChat({
    transport: new DefaultChatTransport<any>({
      api: "/api/chat",
      fetch: async (input, init) => {
        const path = input.toString()
        return apiClient.fetch(path, init);
      },
    }),
  });

  const handleInputSubmit = (value: { text?: string; files?: any[] }, event: React.FormEvent<HTMLFormElement>) => {
    if (value.text) {
      chat.sendMessage({
        text: value.text,
      });
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {chat.messages.map((msg) => (
          <Message key={msg.id} from={msg.role === "user" ? "user" : "assistant"}>
            <MessageContent>
              {
                JSON.stringify(msg, null, 2)
              }
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
            disabled={status === 'streaming' || status === 'submitted'}
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
            <PromptInputSubmit disabled={!input?.trim() || status === 'streaming' || status === 'submitted'} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
