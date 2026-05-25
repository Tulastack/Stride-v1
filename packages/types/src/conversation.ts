// ─── Conversation Types ───────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  analysis_id: string | null;
  messages: Message[];
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateConversationRequest {
  analysisId?: string;
}

export interface CreateConversationResponse {
  conversationId: string;
}

export interface SendMessageRequest {
  content: string;
}

export interface SendMessageResponse {
  reply: string;
}
