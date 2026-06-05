from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from dotenv import load_dotenv
import os
from openai import OpenAI
load_dotenv()
TOKEN = os.getenv("TELEGRAM_TOKEN")

client = OpenAI(
    base_url="https://models.inference.ai.azure.com",
    api_key=os.getenv("GITHUB_TOKEN")
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("سلام! من بات D&D هستم. آماده بازی؟")

async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "تو یه Dungeon Master حرفه‌ای هستی برای بازی D&D. با لحن رازآلود و هیجان‌انگیز صحبت کن."},
            {"role": "user", "content": user_text}
        ]
    )
    reply = response.choices[0].message.content
    await update.message.reply_text(reply)
    
app = ApplicationBuilder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))

print("بات شروع به کار کرد...")
app.run_polling()