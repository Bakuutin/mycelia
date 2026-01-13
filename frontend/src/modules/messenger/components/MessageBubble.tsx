import type { Message } from "@myceliasdk/messengers.ts";
import { useMessageRenderer } from "../core/useMessageRenderer.ts";

export function MessageBubble({ message }: { message: Message }) {
  const MessageComponent = useMessageRenderer(message);

  if (!MessageComponent) {
    return <div>Unsupported message type</div>;
  }

  return <MessageComponent message={message} />;
}

