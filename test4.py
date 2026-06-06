from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
from openai import OpenAI
from dotenv import load_dotenv
import os
import edge_tts

load_dotenv()

TOKEN = os.getenv("TELEGRAM_TOKEN")
client = OpenAI(
    base_url="https://models.inference.ai.azure.com",
    api_key=os.getenv("GITHUB_TOKEN")
)

user_preferences = {}

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [
            InlineKeyboardButton("🔊 ویس", callback_data="voice"),
            InlineKeyboardButton("💬 متن", callback_data="text")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text("نوع خروجی رو انتخاب کن:", reply_markup=reply_markup)

async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    user_preferences[user_id] = query.data
    mode = "ویس" if query.data == "voice" else "متن"
    await query.edit_message_text(f"حالت {mode} انتخاب شد! حالا بنویس.")

async def get_ai_reply(text):
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "تو یه Dungeon Master حرفه‌ای هستی برای بازی D&D. با لحن رازآلود و هیجان‌انگیز صحبت کن."},
            {"role": "user", "content": text}
        ]
    )
    return response.choices[0].message.content

async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    user_text = update.message.text
    reply = await get_ai_reply(user_text)
    
    mode = user_preferences.get(user_id, "text")
    
    if mode == "voice":
        vowel_response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "متن فارسی زیر رو اعراب‌گذاری کن و آن را برای گرفتن ویس اماده کن. فقط متن اعراب‌گذاری شده رو برگردون و آن را برای گرفتن ویس اماده کن، هیچ توضیح اضافه‌ای نده."},
                {"role": "user", "content": reply}
            ]
        )
        voweled_reply = vowel_response.choices[0].message.content
        communicate = edge_tts.Communicate(voweled_reply, "fa-IR-DilaraNeural")
        await communicate.save("voice.mp3")
        with open("voice.mp3", "rb") as audio:
            await update.message.reply_voice(audio)
    else:
        await update.message.reply_text(reply)

app = ApplicationBuilder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(CallbackQueryHandler(button))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))

print("بات شروع به کار کرد...")
app.run_polling()