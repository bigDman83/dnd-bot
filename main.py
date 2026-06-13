from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes, ConversationHandler
from openai import OpenAI
from dotenv import load_dotenv
import edge_tts
import os
import database

load_dotenv()

TOKEN = os.getenv("TELEGRAM_TOKEN")
client = OpenAI(
    base_url="https://models.inference.ai.azure.com",
    api_key=os.getenv("GITHUB_TOKEN")
)

user_preferences = {}
user_active_character = {}

# مراحل ساخت کاراکتر
CHOOSE_NAME, CHOOSE_RACE, CHOOSE_CLASS = range(3)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    telegram_id = update.message.from_user.id
    username = update.message.from_user.first_name
    
    database.register_player(telegram_id, username)
    
    keyboard = [
        [InlineKeyboardButton("⚔️ ساخت کاراکتر جدید", callback_data="new_character")],
        [InlineKeyboardButton("📜 کاراکترهام", callback_data="my_characters")],
        [InlineKeyboardButton("🎮 شروع بازی", callback_data="play")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        f"سلام {username}! به دنیای D&D خوش اومدی! 🐉\nچی می‌خوای انجام بدی؟",
        reply_markup=reply_markup
    )

async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id

    if query.data == "voice":
        user_preferences[user_id] = "voice"
        await query.edit_message_text("حالت ویس انتخاب شد! 🔊")
    
    elif query.data == "text":
        user_preferences[user_id] = "text"
        await query.edit_message_text("حالت متن انتخاب شد! 💬")

    elif query.data == "my_characters":
        characters = database.get_characters(user_id)
        if not characters:
            await query.edit_message_text("هنوز کاراکتری نساختی! از /newchar شروع کن.")
        else:
            text = "کاراکترهات:\n\n"
            keyboard = []
            for char in characters:
                text += f"⚔️ {char['name']} — {char['class_name'] or 'بدون کلاس'} سطح {char['level']}\n"
                keyboard.append([InlineKeyboardButton(
                    f"انتخاب {char['name']}", 
                    callback_data=f"select_char_{char['id']}"
                )])
            await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

    elif query.data.startswith("select_char_"):
        char_id = int(query.data.split("_")[-1])
        user_active_character[user_id] = char_id
        await query.edit_message_text(f"کاراکتر انتخاب شد! حالا می‌تونی بازی کنی. /play رو بزن.")

    elif query.data == "play":
        keyboard = [
            [InlineKeyboardButton("🔊 ویس", callback_data="voice"),
             InlineKeyboardButton("💬 متن", callback_data="text")]
        ]
        await query.edit_message_text(
            "نوع خروجی رو انتخاب کن:",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )

async def new_character(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("اسم کاراکترت رو بنویس:")
    return CHOOSE_NAME

async def choose_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['char_name'] = update.message.text
    
    races = database.get_connection().execute('SELECT * FROM Races').fetchall()
    keyboard = [[InlineKeyboardButton(race['name'], callback_data=f"race_{race['id']}")] for race in races]
    await update.message.reply_text("نژاد رو انتخاب کن:", reply_markup=InlineKeyboardMarkup(keyboard))
    return CHOOSE_RACE

async def choose_race(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data['race_id'] = int(query.data.split("_")[1])
    
    classes = database.get_connection().execute('SELECT * FROM Classes').fetchall()
    keyboard = [[InlineKeyboardButton(cls['name'], callback_data=f"class_{cls['id']}")] for cls in classes]
    await query.edit_message_text("کلاس رو انتخاب کن:", reply_markup=InlineKeyboardMarkup(keyboard))
    return CHOOSE_CLASS

async def choose_class(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user_id = query.from_user.id
    class_id = int(query.data.split("_")[1])
    
    char_id = database.create_character(
        user_id,
        context.user_data['char_name'],
        context.user_data['race_id'],
        class_id
    )
    
    if char_id:
        user_active_character[user_id] = char_id
        await query.edit_message_text(f"کاراکتر {context.user_data['char_name']} ساخته شد! 🎉\nحالا می‌تونی بازی کنی.")
    else:
        await query.edit_message_text("مشکلی پیش اومد. دوباره امتحان کن.")
    
    return ConversationHandler.END

async def get_ai_reply(text, user_id):
    char_id = user_active_character.get(user_id)
    character_info = ""
    
    if char_id:
        conn = database.get_connection()
        char = conn.execute('''
            SELECT Characters.name, Classes.name as class_name, 
                   Races.name as race_name, Characters.level
            FROM Characters
            LEFT JOIN Character_Classes ON Characters.id = Character_Classes.character_id
            LEFT JOIN Classes ON Character_Classes.class_id = Classes.id
            LEFT JOIN Races ON Characters.race_id = Races.id
            WHERE Characters.id = ?
        ''', (char_id,)).fetchone()
        conn.close()
        
        if char:
            character_info = f"بازیکن با کاراکتر {char['name']}، نژاد {char['race_name']}، کلاس {char['class_name']}، سطح {char['level']} بازی می‌کنه."

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": f"""تو یه Dungeon Master حرفه‌ای هستی برای بازی D&D. 
با لحن رازآلود و هیجان‌انگیز صحبت کن. {character_info}"""},
            {"role": "user", "content": text}
        ]
    )
    return response.choices[0].message.content

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("عملیات لغو شد.")
    return ConversationHandler.END

conv_handler = ConversationHandler(
    entry_points=[CommandHandler("newchar", new_character)],
    states={
        CHOOSE_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, choose_name)],
        CHOOSE_RACE: [CallbackQueryHandler(choose_race, pattern="^race_")],
        CHOOSE_CLASS: [CallbackQueryHandler(choose_class, pattern="^class_")],
    },
    fallbacks=[CommandHandler("cancel", cancel)],
)

async def echo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    user_text = update.message.text
    reply = await get_ai_reply(user_text, user_id)
    
    mode = user_preferences.get(user_id, "text")
    
    if mode == "voice":
        vowel_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": """متن فارسی زیر را برای تبدیل به گفتار آماده کن:
- تمام کلمات را کامل اعراب‌گذاری کن
- بعد از هر عبارت مهم یک ویرگول اضافه کن
- اعداد را به حروف بنویس
- فقط متن آماده‌شده را برگردان"""},
                {"role": "user", "content": reply}
            ]
        )
        voweled_reply = vowel_response.choices[0].message.content
        communicate = edge_tts.Communicate(voweled_reply, "fa-IR-FaridNeural", rate="-10%", pitch="-5Hz")
        await communicate.save("voice.mp3")
        with open("voice.mp3", "rb") as audio:
            await update.message.reply_voice(audio)
    else:
        await update.message.reply_text(reply)

conv_handler = ConversationHandler(
    entry_points=[CommandHandler("newchar", new_character)],
    states={
        CHOOSE_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, choose_name)],
        CHOOSE_RACE: [CallbackQueryHandler(choose_race, pattern="^race_")],
        CHOOSE_CLASS: [CallbackQueryHandler(choose_class, pattern="^class_")],
    },
    fallbacks=[]
)

app = ApplicationBuilder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(conv_handler)
app.add_handler(CallbackQueryHandler(button))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, echo))

print("بات شروع به کار کرد...")
app.run_polling()