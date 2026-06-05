import sqlite3

# ساخت دیتابیس
conn = sqlite3.connect('dnd.db')
cursor = conn.cursor()

# ساخت جدول
cursor.execute('''
    CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY,
        name TEXT,
        character_class TEXT,
        level INTEGER,
        hp INTEGER
    )
''')

# اضافه کردن کاراکتر
cursor.execute('''
    INSERT INTO characters (name, character_class, level, hp)
    VALUES (?, ?, ?, ?)
''', ('الیسیوس', 'جادوگر', 1, 20))

conn.commit()

# خوندن اطلاعات
cursor.execute('SELECT * FROM characters')
print(cursor.fetchall())

conn.close()