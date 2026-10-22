import { api } from "sdk";

// آیا این کاربر ادمین (یا سازنده‌ی) گروهه؟
export async function isGroupAdmin(chatId, userId) {
  const member = await api.getChatMember({ chat_id: chatId, user_id: userId });
  return !!member && ["creator", "administrator"].includes(member.status);
}