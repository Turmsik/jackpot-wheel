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
    cursor.execute('UPDATE users SET balance = balance + ?, username = ? WHERE user_id = ?', (amount, username, user_id))
    conn.commit()
    conn.close()

# ---------------------------------------------
# БОТ
# ---------------------------------------------
logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

@dp.message(Command("start"))
async def start(message: types.Message, user: types.User = None):
    tgt_user = user if user else message.from_user
    user_id = tgt_user.id
    balance = get_user_balance(user_id)
    
    text = (
        f"🎰 <b>JACKPOT WHEEL</b>\n\n"
        f"Добро пожаловать, <b>{tgt_user.full_name}</b>! 🚀\n"
        f"Твой баланс: <b>{balance:.2f} USDT</b>\n\n"
        f"👇 Залетай в игру или изучи правила!"
    )
    
    app_url = f"{WEBAPP_URL}?balance={balance}&user_id={user_id}&username={tgt_user.username}"
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎲 ИГРАТЬ", web_app=WebAppInfo(url=app_url))],
        [InlineKeyboardButton(text="ℹ️ О ПРОЕКТЕ (ПРАВИЛА)", callback_data="info_project")],
        [InlineKeyboardButton(text="💎 ПОПОЛНИТЬ USDT", callback_data="deposit_menu")],
        [InlineKeyboardButton(text="📤 ВЫВЕСТИ", callback_data="withdraw_menu")]
    ])
    
    # Важно: Обновляем кнопку меню, чтобы она вела на правильный URL с балансом
    from aiogram.types import MenuButtonWebApp
    try:
        await bot.set_chat_menu_button(
            chat_id=user_id,
            menu_button=MenuButtonWebApp(text="PLAY", web_app=WebAppInfo(url=app_url))
        )
    except Exception as e:
        print(f"Failed to set menu button: {e}")

    # Если это колбэк (например кнопка "Назад"), редактируем, иначе шлем новое
    if user: 
        if isinstance(message, types.Message):
            await message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
        elif isinstance(message, types.CallbackQuery): # На всякий случай
            await message.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await message.answer(text, reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "info_project")
async def info_project_handler(call: CallbackQuery):
    text = (
        "ℹ️ <b>О ПРОЕКТЕ</b>\n\n"
        "🎮 <b>Механика игры:</b>\n"
        "Чем больше твоя ставка — тем больше твой сектор на колесе и выше шанс победы! "
        "Победитель забирает ВЕСЬ БАНК.\n\n"
        "💸 <b>Комиссия и Налог:</b>\n"
        "• <b>10%</b> — Комиссия игры (берется с общего выигрыша).\n"
        "• Эта комиссия покрывает налоги платежных систем и развитие проекта.\n\n"
        "⚡️ Выплаты автоматические и моментальные."
    )
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔙 НАЗАД", callback_data="main_menu")]
    ])
    await call.message.edit_text(text, reply_markup=kb, parse_mode="HTML")

@dp.callback_query(F.data == "main_menu")
async def back_to_main(call: CallbackQuery):
    await start(call.message, user=call.from_user)

@dp.callback_query(F.data == "deposit_menu")
async def deposit_menu(call: CallbackQuery):
    # Удаляем сообщение, если нужно (но лучше редактировать, как сейчас)
    # Если хотим "чистый чат", можно удалять старое и слать новое, 
    # но "edit_text" (как сейчас) — это самый аккуратный способ в Telegram.
    # Оставим edit_text.
    
    text = (
        f"💎 <b>ПОПОЛНЕНИЕ USDT</b>\n\n"
        f"Выберите сумму (Тестовый режим):"
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="10 USDT", callback_data="buy_10"), InlineKeyboardButton(text="50 USDT", callback_data="buy_50")],
        [InlineKeyboardButton(text="100 USDT", callback_data="buy_100"), InlineKeyboardButton(text="500 USDT", callback_data="buy_500")],
        [InlineKeyboardButton(text="10,000 USDT", callback_data="buy_10000"), InlineKeyboardButton(text="100,000 USDT", callback_data="buy_100000")],
        [InlineKeyboardButton(text="« НАЗАД", callback_data="back_to_start")]
    ])
    await call.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "back_to_start")
async def back_to_main_alias(call: CallbackQuery):
    await start(call.message, user=call.from_user)

@dp.callback_query(F.data.startswith("buy_"))
async def process_buy(call: CallbackQuery):
    amount = float(call.data.split("_")[1])
    user_id = call.from_user.id
    
    # Эмуляция процессинга (чтобы игрок понял, что действие идет)
    await call.message.edit_text("⏳ <b>Обработка транзакции...</b>", parse_mode="HTML")
    await asyncio.sleep(1.0)
    
    update_user_balance(user_id, amount, call.from_user.username)
    new_balance = get_user_balance(user_id)
    
    # Успех и авто-возврат
    success_text = (
        f"✅ <b>УСПЕШНО!</b>\n"
        f"Зачислено: +{amount} USDT\n"
        f"Текущий баланс: <b>{new_balance:.2f} USDT</b>"
    )
    
    await call.message.edit_text(success_text, parse_mode="HTML")
    await asyncio.sleep(2.0)
    
    # Возвращаем в главное меню
    await start(call.message, user=call.from_user)

@dp.callback_query(F.data == "withdraw_menu")
async def withdraw_menu(call: CallbackQuery):
    balance = get_user_balance(call.from_user.id)
    text = (
        f"📤 <b>ВЫВОД СРЕДСТВ</b>\n\n"
        f"Твой баланс: <b>{balance:.2f} USDT</b>\n\n"
        f"Минимальная сумма вывода: 5 USDT.\n"
        f"Ведите кошелек USDT (TRC-20) в ответном сообщении (фейк):"
    )
    # Для теста просто кнопка "Вывести всё"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="ВЫВЕСТИ ВСЁ (ФЕЙК)", callback_data="fake_withdraw_all")],
        [InlineKeyboardButton(text="« НАЗАД", callback_data="back_to_start")]
    ])
    await call.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")

@dp.callback_query(F.data == "fake_withdraw_all")
async def fake_withdraw(call: CallbackQuery):
    balance = get_user_balance(call.from_user.id)
    if balance < 5:
        await call.answer("❌ Минималка для вывода 5 USDT", show_alert=True)
    else:
        update_user_balance(call.from_user.id, -balance, call.from_user.username)
        await call.answer(f"✅ Заявка на {balance} USDT принята!\nОжидайте выплату.", show_alert=True)
        await start(call.message, user=call.from_user)

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
    uid_str = request.query.get("user_id")
    if not uid_str:
        return web.json_response({"error": "no user_id"}, status=400)
    
    uid = int(uid_str)
    balance = get_user_balance(uid)
    print(f"📡 [API] Запрос баланса: User {uid} -> {balance} USDT")
    return web.json_response({"balance": balance})

async def handle_bet(request):
    data = await request.json()
    uid = int(data.get("user_id"))
    amount = float(data.get("amount"))

    # Вычитаем ставку из БД сразу
    update_user_balance(uid, -amount)
    new_balance = get_user_balance(uid)
    
    print(f"💸 [API] СТАВКА: User {uid} поставил -{amount} USDT. Остаток: {new_balance}")
    return web.json_response({"status": "ok", "new_balance": new_balance})

async def handle_win(request):
    data = await request.json()
    uid = int(data.get("user_id"))
    win_amount = float(data.get("amount"))
    profit_fee = float(data.get("fee", 0)) 

    print(f"🏆 [API] ВЫИГРЫШ: User {uid} получил +{win_amount} USDT (Комиссия: {profit_fee})")
    
    # 1. Обновляем баланс игрока в БД
    update_user_balance(uid, win_amount)
    
    # 2. Обновляем прибыль админа в БД
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('UPDATE stats SET value = value + ? WHERE key = "admin_profit"', (profit_fee,))
    conn.commit()
    conn.close()

    # 3. Отправляем уведомление в Telegram
    new_balance = get_user_balance(uid)
    try:
        await bot.send_message(
            uid, 
            f"🎰 <b>ПОБЕДА В КОЛЕСЕ!</b>\n\n"
            f"💰 Выигрыш: <b>+{win_amount:.2f} USDT</b>\n"
            f"� Ваш баланс: <b>{new_balance:.2f} USDT</b>\n\n"
            f"<i>Удачи в следующих раундах!</i>",
            parse_mode="HTML"
        )
    except Exception as e:
        logging.error(f"Failed to send win message to {uid}: {e}")

    return web.json_response({"status": "ok", "new_balance": new_balance})

async def get_balance_handler(request):
    uid = request.query.get("user_id")
    if not uid:
        return web.json_response({"error": "no user_id"}, status=400)
    
    balance = get_user_balance(int(uid))
    return web.json_response({"balance": balance})

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
    win_res = app.router.add_resource("/api/win")
    cors.add(win_res.add_route("POST", handle_win))
    
    bal_res = app.router.add_resource("/api/balance")
    cors.add(bal_res.add_route("GET", get_balance_handler))

    bet_res = app.router.add_resource("/api/bet")
    cors.add(bet_res.add_route("POST", handle_bet))
    
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
    
    # Запускаем API и бота параллельно
    await asyncio.gather(
        dp.start_polling(bot),
        run_api()
    )

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот остановлен.")
