import type { ComponentType, ReactNode } from "react";
import type { Chat, Message } from "@interfaces/messengers.ts";

export interface Platform {
  id: string; // e.g., 'telegram', 'whatsapp', 'signal'
  name: string;
  icon?: ComponentType<{ className?: string }>;
  MessageComponent: ComponentType<{ message: Message; children?: ReactNode }>;
  ChatPreviewComponent?: ComponentType<{ chat: Chat; isSelected?: boolean; onClick?: () => void }>;
}
