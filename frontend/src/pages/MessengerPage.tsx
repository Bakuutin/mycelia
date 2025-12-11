import { useEffect, useState, useRef } from "react";
import { useSearchParams, useParams, useNavigate } from "react-router-dom";
import { ObjectId } from "bson";
import { callResource } from "@/lib/api";
import type { Chat, Message as IMessage } from "@interfaces/messengers.ts";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

// Messenger Module Imports
import { registry } from "@/modules/messenger/core/registry.ts";
import { defaultPlatform } from "@/modules/messenger/platforms/default.tsx";
import { telegramPlatform } from "@/modules/messenger/platforms/telegram.tsx";
import { signalPlatform } from "@/modules/messenger/platforms/signal.tsx";
import { myceliaPlatform } from "@/modules/messenger/platforms/mycelia.tsx";
import { ChatListItem } from "@/modules/messenger/components/ChatListItem.tsx";
import { MessageBubble } from "@/modules/messenger/components/MessageBubble.tsx";

// Register platforms
registry.register(defaultPlatform);
registry.register(telegramPlatform);
registry.register(signalPlatform);
registry.register(myceliaPlatform);
registry.setDefault(defaultPlatform.id);

export default function MessengerPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  
  // Fetch Chats
  useEffect(() => {
    const fetchChats = async () => {
      try {
        setLoadingChats(true);
        const result = await callResource("mongo", {
          action: "find",
          collection: "chats",
          query: {},
          options: {
            sort: { lastMessageDate: -1 },
          },
        });
        setChats(result);
      } catch (err) {
        console.error("Failed to fetch chats", err);
      } finally {
        setLoadingChats(false);
      }
    };
    
    fetchChats();
  }, []);

  // Fetch Messages for selected chat
  useEffect(() => {
    if (!chatId) {
        setMessages([]);
        return;
    }
    
    const fetchMessages = async () => {
      try {
        setLoadingMessages(true);
        const result = await callResource("mongo", {
          action: "find",
          collection: "messages",
          query: { chatId: { $oid: chatId } }, 
          options: {
            sort: { timestamp: -1 },
            limit: 1000 
          },
        });
        setMessages(result.reverse());
      } catch (err) {
        console.error("Failed to fetch messages", err);
      } finally {
        setLoadingMessages(false);
      }
    };

    fetchMessages();
  }, [chatId]);

  // Scroll to bottom when messages are loaded
  useEffect(() => {
    if (!loadingMessages && messages.length > 0) {
      // Small timeout to ensure rendering is complete
      const timer = setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [messages, loadingMessages, chatId]);
  
  const selectedChat = chats.find(c => c._id.toString() === chatId);

  return (
    <div className="h-[calc(100vh-6rem)] w-full overflow-hidden border rounded-lg shadow-sm bg-background">
      <ResizablePanelGroup direction="horizontal">
        {/* Chat List */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className="h-full flex flex-col">
            <div className="p-4 border-b bg-muted/40">
              <h2 className="font-semibold">Chats</h2>
            </div>
            <ScrollArea className="flex-1">
              {loadingChats ? (
                 <div className="p-4 space-y-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                 </div>
              ) : (
                <div className="flex flex-col">
                  {chats.map((chat) => (
                    <ChatListItem 
                        key={chat._id.toString()} 
                        chat={chat} 
                        isSelected={chatId === chat._id.toString()}
                        onClick={() => navigate(`/messaging/${chat._id.toString()}`)}
                    />
                  ))}
                  {chats.length === 0 && (
                      <div className="p-8 text-center text-muted-foreground">
                          No chats found
                      </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>
        
        <ResizableHandle />
        
        {/* Message Thread */}
        <ResizablePanel defaultSize={70}>
            {chatId ? (
                <div className="h-full flex flex-col">
                    <div className="p-4 border-b flex items-center justify-between bg-muted/40">
                        <div className="flex items-center gap-3">
                             <div>
                                 <h2 className="font-semibold text-sm">{selectedChat?.name}</h2>
                                 <p className="text-xs text-muted-foreground capitalize">{selectedChat?.platform}</p>
                             </div>
                        </div>
                    </div>
                    <ScrollArea className="flex-1 p-0">
                         {loadingMessages ? (
                             <div className="p-4 space-y-4">
                                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-3/4" />)}
                             </div>
                         ) : (
                             <div className="flex flex-col p-4 pb-4 space-y-4">
                                 {messages.map((msg) => (
                                     <MessageBubble key={msg._id.toString()} message={msg} />
                                 ))}
                                 <div ref={bottomRef} />
                                 {messages.length === 0 && (
                                     <div className="p-8 text-center text-muted-foreground">
                                         No messages in this chat
                                     </div>
                                 )}
                             </div>
                         )}
                    </ScrollArea>
                </div>
            ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground bg-muted/10">
                    <div className="text-center">
                        <p>Select a chat to view messages</p>
                    </div>
                </div>
            )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
