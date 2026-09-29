export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  contact?: TelegramContact;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}
