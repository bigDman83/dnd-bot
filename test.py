from openai import OpenAI
import json
from dotenv import load_dotenv
import os
load_dotenv()
client = OpenAI(
    base_url="https://models.inference.ai.azure.com",
    api_key=os.getenv("GITHUB_TOKEN")
)

# خوندن حافظه از فایل
def load_memory():
   if os.path.exists("memory.json"):
    with open("memory.json", "r", encoding="utf-8") as f:
        content = f.read().strip()
        if content:
            return json.loads(content)
    return {}

# ذخیره حافظه در فایل
def save_memory(memory):
    with open("memory.json", "w", encoding="utf-8") as f:
        json.dump(memory, f, ensure_ascii=False, indent=2)

memory = load_memory()

messages = [
    {"role": "system", "content": f"""تو یه دستیار هوشمند هستی.
اطلاعاتی که از کاربر می‌دونی: {json.dumps(memory, ensure_ascii=False)}

وظیفه مهم: اگه کاربر اطلاعات مهمی گفت (اسم، سن، علاقه‌ها، اهداف)،
آخر جوابت این تگ رو اضافه کن:
[SAVE: {{"کلید": "مقدار"}}]
مثال: [SAVE: {{"اسم": "علی"}}]"""}
]

print("چت شروع شد! (برای خروج 'خروج' بنویس)\n")

while True:
    user_input = input("تو: ")
    if user_input == "خروج":
        break

    messages.append({"role": "user", "content": user_input})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )

    reply = response.choices[0].message.content

    # تشخیص و ذخیره اطلاعات
    if "[SAVE:" in reply:
        start = reply.index("[SAVE:") + 6
        end = reply.index("]", start)
        try:
            new_data = json.loads(reply[start:end])
            memory.update(new_data)
            save_memory(memory)
            print(f"✅ ذخیره شد: {new_data}")
        except:
            pass
        reply = reply[:reply.index("[SAVE:")].strip()

    messages.append({"role": "assistant", "content": reply})
    print(f"\nAI: {reply}\n")