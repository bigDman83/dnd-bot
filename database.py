import sqlite3
from datetime import datetime

DB_PATH = "DnD.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ثبت بازیکن جدید
def register_player(telegram_id, name):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT OR IGNORE INTO players (telegram_id, name)
            VALUES (?, ?)
        ''', (telegram_id, name))
        conn.commit()
        return True
    except Exception as e:
        print(f"خطا: {e}")
        return False
    finally:
        conn.close()

# گرفتن اطلاعات بازیکن
def get_player(telegram_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM players WHERE telegram_id = ?', (telegram_id,))
    player = cursor.fetchone()
    conn.close()
    return player

# گرفتن کاراکترهای یه بازیکن
def get_characters(telegram_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT Characters.*, Classes.name as class_name
        FROM Characters
        JOIN players ON Characters.player_id = players.id
        LEFT JOIN Character_Classes ON Characters.id = Character_Classes.character_id
        LEFT JOIN Classes ON Character_Classes.class_id = Classes.id
        WHERE players.telegram_id = ?
    ''', (telegram_id,))
    characters = cursor.fetchall()
    conn.close()
    return characters

# ساخت کاراکتر جدید
def create_character(telegram_id, name, race_id, class_id):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        player = get_player(telegram_id)
        if not player:
            return False
        
        cursor.execute('''
            INSERT INTO Characters (name, race_id, level, 
                strength, dexterity, constitution,
                intelligence, wisdom, charisma,
                hit_points, armor_class, player_id)
            VALUES (?, ?, 1, 10, 10, 10, 10, 10, 10, 10, 10, ?)
        ''', (name, race_id, player['id']))
        
        char_id = cursor.lastrowid
        
        cursor.execute('''
            INSERT INTO Character_Classes (character_id, class_id, class_level)
            VALUES (?, ?, 1)
        ''', (char_id, class_id))
        
        conn.commit()
        return char_id
    except Exception as e:
        print(f"خطا: {e}")
        return False
    finally:
        conn.close()

# ذخیره خلاصه داستان
def save_story(player_id, summary):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO story_log (player_id, session_date, summary)
        VALUES (?, ?, ?)
    ''', (player_id, datetime.now().strftime("%Y-%m-%d %H:%M"), summary))
    conn.commit()
    conn.close()