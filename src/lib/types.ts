export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type SenderType = 'visitor' | 'agent';

export interface Conversation {
  id: string;
  tenant_id: string;
  visitor_id: string;
  status: ConversationStatus;
  created_at: string;
  last_message_at: string;
  last_activity_at: string;
  subject: string | null;
  resolved_at: string | null;
}

export interface Message {
  id: string;
  tenant_id: string;
  conversation_id: string;
  sender_type: SenderType;
  body: string;
  created_at: string;
}
