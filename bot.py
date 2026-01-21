import asyncio
import logging
import sys
import sqlite3
import os
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardMarkup, InlineKeyboardButton, CallbackQuery, FSInputFile
from aiohttp import web
import aiohttp_cors
import json
import random
import time
import hashlib
import hmac
from urllib.parse import parse_qs

# ---------------------------------------------
# НАСТРОЙКИ
# ---------------------------------------------
BOT_TOKEN = "7967641942:AAH9CafrXRufn_x25U5n9WeVrm6Ty4P6y94"
WEBAPP_URL = "https://onejoi.github.io/jackpot-wheel/"

# ---------------------------------------------
# БАЗА ДАННЫХ (SQLite)
# ---------------------------------------------
def init_db():
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            balance REAL DEFAULT 0.0,
            total_profit REAL DEFAULT 0.0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stats (
            key TEXT PRIMARY KEY,
            value REAL DEFAULT 0.0
        )
    ''')
    # Добавляем запись для профита админа
    cursor.execute('INSERT OR IGNORE INTO stats (key, value) VALUES ("admin_profit", 0.0)')
    conn.commit()
    conn.close()

def get_user_balance(user_id):
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('SELECT balance FROM users WHERE user_id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else 0.0

def update_user_balance(user_id, amount, username=None):
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('INSERT OR IGNORE INTO users (user_id, username, balance) VALUES (?, ?, 0.0)', (user_id, username))
    # Округляем до 2 знаков для точности
    cursor.execute('UPDATE users SET balance = ROUND(balance + ?, 2), username = ? WHERE user_id = ?', (amount, username, user_id))
    conn.commit()
    conn.close()

# ---------------------------------------------
# БЕЗОПАСНОСТЬ (Проверка данных Telegram)
# ---------------------------------------------
def verify_telegram_auth(init_data: str):
    """Проверяет подпись данных от Telegram WebApp"""
    try:
        if not init_data: return None
        
        vals = {k: v[0] for k, v in parse_qs(init_data).items()}
        hash_val = vals.pop('hash', None)
        if not hash_val: return None
        
        data_check_string = "\n".join([f"{k}={v}" for k, v in sorted(vals.items())])
        
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        if calculated_hash == hash_val:
            return json.loads(vals.get('user', '{}'))
        return None
    except:
        return None

# ---------------------------------------------
# БОТ И ГЛОБАЛЬНОЕ СОСТОЯНИЕ ИГРЫ
# ---------------------------------------------
logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Глобальное состояние игры (Source of Truth)
game_state = {
    "round_time": 120,
    "players": [],       # [{name, bet, color}, ...]
    "status": "waiting", # waiting, spinning
    "last_winner": None,
    "total_bank": 0.0,
    "spin_start_ms": 0,
    "round_end_ms": 0    # Точное время окончания раунда
}

# Блокировка для предотвращения Race Condition при ставках
bet_lock = asyncio.Lock()

def reset_global_game():
    game_state["round_time"] = 120
    game_state["players"] = []
    game_state["status"] = "waiting"
    game_state["last_winner"] = None
    game_state["total_bank"] = 0.0
    game_state["spin_start_ms"] = 0
    game_state["round_end_ms"] = 0
    print("♻️ GLOBAL GAME RESET")

def calculate_winner():
    if not game_state["players"]:
        return None
    
    total = sum(p["bet"] for p in game_state["players"])
    win_ticket = sum(p["bet"] for p in game_state["players"]) * (os.urandom(4)[0] / 255) # Рандом
    
    acc = 0
    for p in game_state["players"]:
        if win_ticket >= acc and win_ticket < acc + p["bet"]:
            return p
        acc += p["bet"]
    return game_state["players"][0]

async def game_loop():
    """Фоновый цикл игры, который идет постоянно"""
    print("⚙️ Game Loop Started")
    while True:
        if game_state["status"] == "waiting":
            # Таймер идет ТОЛЬКО если есть хотя бы 2 игрока
            if len(game_state["players"]) >= 2:
                # Если раунд только начался (таймер был 120), ставим метку окончания
                if game_state["round_end_ms"] == 0:
                    game_state["round_end_ms"] = int((time.time() + game_state["round_time"]) * 1000)

                # Каждую секунду обновляем round_time для обратной совместимости
                remaining = int((game_state["round_end_ms"] / 1000) - time.time())
                game_state["round_time"] = max(0, remaining)

                if game_state["round_time"] <= 0:
                    # ВРЕМЯ ВЫШЛО -> КРУТИМ
                    game_state["status"] = "spinning"
                    game_state["spin_start_ms"] = int(time.time() * 1000)
                    winner = calculate_winner()
                    game_state["last_winner"] = winner
                    
                    if winner:
                        total_bank = sum(p["bet"] for p in game_state["players"])
                        print(f"🎰 SPINNING! Bank: {total_bank} USDT. Winner: {winner['name']}")
                        
                        # Если победитель - реальный игрок (есть user_id)
                        if winner.get("user_id"):
                            uid = winner["user_id"]
                            net_win = (total_bank - winner["bet"]) * 0.90 # Налог 10%
                            profit_fee = (total_bank - winner["bet"]) * 0.10
                            payout = winner["bet"] + net_win
                            
                            # Теперь всё (БД и Телеграм) делаем С ЗАДЕРЖКОЙ, чтобы не спойлерить результат
                            async def delayed_payout_process(user_id, amount, fee):
                                await asyncio.sleep(8) # Ждем пока колесо докрутится (6с анимация + запас)
                                
                                # 1. Зачисляем в БД
                                update_user_balance(user_id, amount)
                                
                                # 2. Обновляем профит админа
                                conn = sqlite3.connect('database.db')
                                cursor = conn.cursor()
                                cursor.execute('UPDATE stats SET value = value + ? WHERE key = "admin_profit"', (fee,))
                                conn.commit()
                                conn.close()
                                
                                # 3. Шлем уведомление
                                new_bal = get_user_balance(user_id)
                                try:
                                    await bot.send_message(
                                        user_id,
                                        f"🎰 <b>ПОБЕДА В КОЛЕСЕ!</b>\n\n"
                                        f"💰 Выигрыш: <b>+{amount:.2f} USDT</b>\n"
                                        f"💳 Ваш баланс: <b>{new_bal:.2f} USDT</b>\n\n"
                                        f"<i>Результат зачислен! Удачи!</i>",
                                        parse_mode="HTML"
                                    )
                                except: pass
                            
                            asyncio.create_task(delayed_payout_process(uid, payout, profit_fee))
                    
                    # Ждем 10 секунд (время анимации + показ результата)
                    await asyncio.sleep(10)
                    reset_global_game()

            # Добавляем ботов постоянно (для тестов), до 19 штук
            # Делаем это внутри блока waiting, но вне проверки >= 2 игроков
            if len(game_state["players"]) < 19:
                # Раз в 5-10 секунд закидываем бота
                if os.urandom(1)[0] < 50: 
                    bot_names = ["Apex", "Nova", "Bit", "Zen", "Luna", "Mars", "Pluto", "Orion", "Titan", "Atom", "Bolt", "Flux", "Neon", "Void", "Gold"]
                    bot_suffix = os.urandom(2).hex()
                    b_name = f"@{random.choice(bot_names)}_{bot_suffix}"
                    
                    # Рандомная ставка от 0.1 до 50 USDT
                    b_bet = round(0.1 + (os.urandom(1)[0] / 255) * 49.9, 1)
                    
                    game_state["players"].append({
                        "user_id": None, # Бот
                        "name": b_name,
                        "bet": b_bet,
                        "color": f"hsl({(len(game_state['players']) * 137) % 360}, 100%, 50%)"
                    })
                    print(f"🤖 Bot Joined: {b_name} with {b_bet} USDT")
            
            await asyncio.sleep(1)
        else:
            await asyncio.sleep(1)


@dp.message(Command("start"))
async def start(message: types.Message, user: types.User = None, is_new: bool = False):
    # Если зашли через команду — берем юзера из сообщения.
    # Если позвали из колбэка — используем переданного юзера.
    tgt_user = user if user else message.from_user
    user_id = tgt_user.id
    balance = get_user_balance(user_id)
    
    text = (
        f"🎰 <b>JACKPOT WHEEL</b> — Крути колесо и забирай банк! 🚀🏆\n\n"
        f"👤 Игрок: <b>{tgt_user.full_name}</b>\n"
        f"💰 Баланс: <b>{balance:.2f} USDT</b>\n\n"
        f"💡 <i>Советуем прочитать информацию о проекте перед игрой! 👇</i>"
    )
    
    # Передаем реальный баланс в URL для Mini App
    app_url = f"{WEBAPP_URL}?balance={balance}&user_id={user_id}"
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎲 ИГРАТЬ (НАЧАТЬ)", web_app=WebAppInfo(url=app_url))],
        [InlineKeyboardButton(text="💎 ПОПОЛНИТЬ USDT", callback_data="deposit_menu")],
        [InlineKeyboardButton(text="📤 ВЫВЕСТИ", callback_data="withdraw_menu")],
        [InlineKeyboardButton(text="ℹ️ ИНФОРМАЦИЯ", callback_data="project_info")]
    ])
    
    # Редактируем старое сообщение если можно, иначе шлем новое
    try:
        # Если message - это CallbackQuery message, то .from_user - это Бот
        # Нам нужно понять, был ли это вызов из callback
        if message.from_user.is_bot and not is_new: 
            await message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
        else:
            await message.answer(text, reply_markup=keyboard, parse_mode="HTML")
    except:
        await message.answer(text, reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "project_info")
async def project_info(call: CallbackQuery):
    text = (
        f"<b>ℹ️ О PROJECT JACKPOT WHEEL</b>\n\n"
        f"Это честная игра на удачу. Каждый игрок вносит ставку в USDT. "
        f"Чем выше ставка — тем больше ваш сектор на колесе и выше шанс победы.\n\n"
        f"📝 <b>МЕХАНИКА:</b>\n"
        f"• Минимальная ставка: <b>0.1 USDT</b>\n"
        f"• Время раунда: <b>2 минуты</b>\n"
        f"• Налог игры: <b>10%</b> (берется только с чистого выигрыша)\n"
        f"• Выплаты: Автоматические на кошелек.\n\n"
        f"<i>Пример: Банк 100 USDT, ваша ставка 10 USDT. Вы победили — выигрыш составит 91 USDT (ваши 10 + 81 после налога).</i>"
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="« НАЗАД", callback_data="back_to_start")]
    ])
    await call.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "deposit_menu")
async def deposit_menu(call: CallbackQuery):
    text = (
        f"💎 <b>ПОПОЛНЕНИЕ USDT (TEST)</b>\n\n"
        f"Выберите сумму для пополнения счета.\n"
        f"<i>(Сейчас работает в режиме фейк-теста)</i>"
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="10 USDT", callback_data="buy_10"), InlineKeyboardButton(text="50 USDT", callback_data="buy_50")],
        [InlineKeyboardButton(text="100 USDT", callback_data="buy_100"), InlineKeyboardButton(text="500 USDT", callback_data="buy_500")],
        [InlineKeyboardButton(text="10,000 USDT", callback_data="buy_10000"), InlineKeyboardButton(text="100,000 USDT", callback_data="buy_100000")],
        [InlineKeyboardButton(text="« НАЗАД", callback_data="back_to_start")]
    ])
    await call.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data.startswith("buy_"))
async def process_buy(call: CallbackQuery):
    amount = float(call.data.split("_")[1])
    update_user_balance(call.from_user.id, amount, call.from_user.username)
    await call.answer(f"✅ Баланс пополнен на {amount} USDT!", show_alert=True)
    
    # Сначала удаляем сообщение с кнопками пополнения
    try:
        await call.message.delete()
    except:
        pass

    # Отправляем НОВОЕ чистое меню (т.к. старое удалено)
    await start(call.message, user=call.from_user, is_new=True)

@dp.callback_query(F.data == "back_to_start")
async def back_to_start(call: CallbackQuery):
    await start(call.message, user=call.from_user)

@dp.message(Command("fake_pay"))
async def fake_pay_cmd(message: types.Message):
    try:
        parts = message.text.split()
        amount = float(parts[1])
        update_user_balance(message.from_user.id, amount, message.from_user.username)
        await message.answer(f"✅ Успешно! Зачислено {amount} USDT.\nНажми /start чтобы обновить кнопку входа.")
    except:
        await message.answer("Ошибка. Пример: /fake_pay 10")

@dp.message(Command("set_bal"))
async def set_bal_cmd(message: types.Message):
    # Команда для админа: /set_bal <user_id> <amount>
    # Если без user_id то себе: /set_bal 500
    try:
        parts = message.text.split()
        if len(parts) == 2:
            uid = message.from_user.id
            amount = float(parts[1])
        else:
            uid = int(parts[1])
            amount = float(parts[2])
            
        conn = sqlite3.connect('database.db')
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET balance = ? WHERE user_id = ?', (amount, uid))
        conn.commit()
        conn.close()
        await message.answer(f"💰 Баланс игрока {uid} установлен на {amount} USDT.\nНажми /start для обновления.")
    except Exception as e:
        await message.answer(f"Ошибка: {e}\nПример: /set_bal 1000")

@dp.message(Command("admin"))
async def admin_panel(message: types.Message):
    # В реале тут проверка на твой ID
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('SELECT SUM(balance) FROM users')
    total_users_balance = cursor.fetchone()[0] or 0.0
    cursor.execute('SELECT value FROM stats WHERE key = "admin_profit"')
    admin_profit = cursor.fetchone()[0] or 0.0
    conn.close()
    
async def get_balance_handler(request):
    auth_data = request.headers.get("Telegram-Auth")
    user_data = verify_telegram_auth(auth_data)
    
    if not user_data:
        return web.json_response({"error": "unauthorized"}, status=401)
    
    uid = user_data.get("id")
    balance = get_user_balance(uid)
    print(f"📡 [API] Запрос баланса (защищен): User {uid} -> {balance} USDT")
    return web.json_response({"balance": balance})

async def get_state_handler(request):
    """Отдает состояние игры всем клиентам"""
    # Рассчитываем общий банк перед отправкой
    game_state["total_bank"] = sum(p["bet"] for p in game_state["players"])
    return web.json_response(game_state)

async def handle_bet(request):
    auth_data = request.headers.get("Telegram-Auth")
    user_data = verify_telegram_auth(auth_data)
    
    if not user_data:
        return web.json_response({"error": "unauthorized"}, status=401)
    
    uid = user_data.get("id")
    data = await request.json()
    amount = float(data.get("amount"))
    # Имя берем прямо из проверенных данных Telegram
    name = user_data.get("username") or user_data.get("first_name", "Unknown")
    if user_data.get("username"): name = f"@{name}"
    
    color = data.get("color")

    # ЗАПРЕЩАЕМ СТАВКИ ВО ВРЕМЯ СПИНА
    if game_state["status"] == "spinning":
        return web.json_response({"error": "round_is_spinning"}, status=400)

    # СИНХРОНИЗИРУЕМ ПОТОКИ (Race Condition Protection)
    async with bet_lock:
        # ПРОВЕРЯЕМ БАЛАНС ПЕРЕД СПИСАНИЕМ
        user_balance = get_user_balance(uid)
        if user_balance < amount:
            return web.json_response({"error": "insufficient_funds"}, status=400)

        # 1. Вычитаем ставку из БД
        update_user_balance(uid, -amount)
        
        # 2. Обновляем ГЛОБАЛЬНЫЙ список и БАНК
        game_state["total_bank"] = round(game_state["total_bank"] + amount, 2)
        
        found = False
        for p in game_state["players"]:
            if p["name"] == name:
                p["bet"] = round(p["bet"] + amount, 2)
                found = True
                break
        if not found:
            game_state["players"].append({
                "user_id": uid, 
                "name": name,
                "bet": round(amount, 2),
                "color": color or f"hsl({(len(game_state['players']) * 137) % 360}, 100%, 50%)"
            })

    print(f"💸 [API] СТАВКА: {name} поставил {amount} USDT. Банк: {game_state['total_bank']}")
    return web.json_response({"status": "ok", "new_balance": new_balance})


async def run_api():
    app = web.Application()
    # Разрешаем запросы с GitHub Pages
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
        )
    })
    
    # Регистрация маршрутов
    bal_res = app.router.add_resource("/api/balance")
    cors.add(bal_res.add_route("GET", get_balance_handler))

    bet_res = app.router.add_resource("/api/bet")
    cors.add(bet_res.add_route("POST", handle_bet))
    
    state_res = app.router.add_resource("/api/state")
    cors.add(state_res.add_route("GET", get_state_handler))
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    # Railway дает порт в переменной окружения. Если её нет (локально) - юзаем 5000
    port = int(os.environ.get("PORT", 5000))
    site = web.TCPSite(runner, '0.0.0.0', port)
    
    await site.start()
    print(f"✅ API Server started on port {port} (0.0.0.0)")

async def main():
    init_db()
    print("\n🚀 БОТ ЗАПУЩЕН С БАЗОЙ ДАННЫХ!")
    
    # Запускаем API, бота и игровой цикл параллельно
    await asyncio.gather(
        dp.start_polling(bot),
        run_api(),
        game_loop()
    )

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот остановлен.")
