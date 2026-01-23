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
import hmac
import hashlib
import urllib.parse
from operator import itemgetter
from aiocryptopay import AioCryptoPay, Networks

# ---------------------------------------------
# НАСТРОЙКИ
# ---------------------------------------------
BOT_TOKEN = "7967641942:AAH9CafrXRufn_x25U5n9WeVrm6Ty4P6y94"
WEBAPP_URL = "https://turmsik.github.io/jackpot-wheel/"
VERSION = "4.6"

# ТОКЕН КРИПТОБОТА (Для тестов используй токен из @CryptoTestPayBot)
CRYPTO_PAY_TOKEN = os.environ.get("CRYPTO_PAY_TOKEN", "ВАШ_ТОКЕН_ТУТ") 
crypto = AioCryptoPay(token=CRYPTO_PAY_TOKEN, network=Networks.TEST_NET)

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
    cursor.execute('INSERT OR IGNORE INTO stats (key, value) VALUES ("admin_profit", 0.0)')
    
    # МИГРАЦИЯ: Если баланс у юзеров в старом формате (флоат), переводим в центы
    cursor.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)')
    cursor.execute('SELECT value FROM metadata WHERE key = "migration_v2_cents"')
    if not cursor.fetchone():
        print("🔧 Running Database Migration to Cents...")
        cursor.execute('UPDATE users SET balance = CAST(balance * 100 AS INTEGER)')
        cursor.execute('INSERT INTO metadata (key, value) VALUES ("migration_v2_cents", "done")')
        print("✅ Migration Completed!")

    conn.commit()
    conn.close()

def get_user_balance(user_id):
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('SELECT balance FROM users WHERE user_id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return row[0] / 100.0 # Конвертируем центы в USDT для отображения
    return 0.0

def update_user_balance(user_id, amount_cents, username=None):
    """Обновляет баланс в ЦЕНТАХ (целое число)"""
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute('INSERT OR IGNORE INTO users (user_id, username, balance) VALUES (?, ?, 0.0)', (user_id, username))
    cursor.execute('UPDATE users SET balance = balance + ?, username = ? WHERE user_id = ?', (amount_cents, username, user_id))
    conn.commit()
    conn.close()

# ---------------------------------------------
# БОТ И ГЛОБАЛЬНОЕ СОСТОЯНИЕ ИГРЫ
# ---------------------------------------------
def verify_init_data(init_data: str) -> dict:
    """Проверка подлинности данных и возвращение данных пользователя"""
    if not init_data:
        return None
    
    try:
        vals = {k: v for k, v in urllib.parse.parse_qsl(init_data)}
        if 'hash' not in vals:
            return None
            
        check_hash = vals.pop('hash')
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(vals.items(), key=itemgetter(0)))
        
        secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        h = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        if h == check_hash:
            # Извлекаем данные пользователя
            user_data = json.loads(vals.get('user', '{}'))
            return user_data
        return None
    except Exception as e:
        print(f"⚠️ InitData verification error: {e}")
        return None

logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Глобальное состояние игры (Source of Truth)
game_state = {
    "round_time": 120,
    "players": [],       # [{name, bet, color}, ...]
    "status": "waiting", # waiting, spinning
    "last_winner": None,
    "total_bank": 0.0
}

def reset_global_game():
    game_state["round_time"] = 120
    game_state["players"] = []
    game_state["status"] = "waiting"
    game_state["last_winner"] = None
    game_state["total_bank"] = 0.0
    print("♻️ GLOBAL GAME RESET")

def calculate_winner():
    if not game_state["players"]:
        return None
    
    total_cents = sum(int(p["bet"] * 100) for p in game_state["players"])
    win_ticket = total_cents * (os.urandom(4)[0] / 255) # Рандом
    
    acc = 0
    for p in game_state["players"]:
        p_bet_cents = int(p["bet"] * 100)
        if win_ticket >= acc and win_ticket < acc + p_bet_cents:
            return p
        acc += p_bet_cents
    return game_state["players"][0]

async def game_loop():
    """Фоновый цикл игры, который идет постоянно"""
    print("⚙️ Game Loop Started")
    while True:
        if game_state["status"] == "waiting":
            # Таймер идет ТОЛЬКО если есть хотя бы 2 игрока (или 1 игрок и боты)
            if len(game_state["players"]) >= 2:
                if game_state["round_time"] > 0:
                    game_state["round_time"] -= 1
                else:
                    # ВРЕМЯ ВЫШЛО -> КРУТИМ
                    game_state["status"] = "spinning"
                    winner = calculate_winner()
                    game_state["last_winner"] = winner
                    
                    if winner:
                        # Считаем в центах для точности
                        total_cents = sum(int(p["bet"] * 100) for p in game_state["players"])
                        print(f"🎰 SPINNING! Bank: {total_cents/100:.2f} USDT. Winner: {winner['name']}")
                        
                        # Кому платим?
                        if winner.get("user_id"):
                            # 1. Победил реальный игрок
                            uid = winner["user_id"]
                            winner_bet_cents = int(winner["bet"] * 100)
                            
                            net_win_cents = int((total_cents - winner_bet_cents) * 0.90) # Налог 10%
                            profit_fee_cents = (total_cents - winner_bet_cents) - net_win_cents
                            payout_cents = winner_bet_cents + net_win_cents
                            
                            async def delayed_payout(user_id, amount_cents, fee_cents):
                                await asyncio.sleep(8)
                                update_user_balance(user_id, amount_cents)
                                # Записываем доход админа
                                conn = sqlite3.connect('database.db')
                                cursor = conn.cursor()
                                cursor.execute('UPDATE stats SET value = value + ? WHERE key = "admin_profit"', (fee_cents,))
                                conn.commit()
                                conn.close()
                                
                                try:
                                    new_bal = get_user_balance(user_id)
                                    await bot.send_message(
                                        user_id,
                                        f"🎰 <b>ПОБЕДА!</b>\n\n💰 Выигрыш: <b>+{amount_cents/100:.2f} USDT</b>\n💳 Баланс: <b>{new_bal:.2f} USDT</b>",
                                        parse_mode="HTML"
                                    )
                                except: pass
                            
                            asyncio.create_task(delayed_payout(uid, payout_cents, profit_fee_cents))
                        else:
                            # 2. Победил БОТ (вся ставка реальных игроков идет в доход админу)
                            # Считаем сумму ставок ТОЛЬКО реальных игроков
                            real_players_total_cents = sum(int(p["bet"] * 100) for p in game_state["players"] if p.get("user_id"))
                            
                            if real_players_total_cents > 0:
                                async def delayed_bot_profit(fee_cents):
                                    await asyncio.sleep(8)
                                    conn = sqlite3.connect('database.db')
                                    cursor = conn.cursor()
                                    cursor.execute('UPDATE stats SET value = value + ? WHERE key = "admin_profit"', (fee_cents,))
                                    conn.commit()
                                    conn.close()
                                    print(f"📈 Bot won. Admin profit increased by {fee_cents/100:.2f} USDT")
                                
                                asyncio.create_task(delayed_bot_profit(real_players_total_cents))

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

async def check_payments():
    """Фоновая задача для проверки оплаченных счетов"""
    print("💎 CryptoPay Polling Started")
    processed_invoices = set()
    
    while True:
        try:
            # Получаем последние 50 счетов
            invoices = await crypto.get_invoices(status='paid', count=50)
            if invoices:
                for inv in invoices:
                    if inv.invoice_id not in processed_invoices:
                        # Проверяем, наш ли это юзер (мы не храним связку ID в этом примере, 
                        # поэтому для теста просто логируем. 
                        # В реале нужно при создании счета передавать payload=user_id)
                        uid = inv.payload
                        if uid:
                            amount_cents = int(inv.amount * 100)
                            update_user_balance(int(uid), amount_cents)
                            
                            try:
                                await bot.send_message(
                                    int(uid), 
                                    f"✅ <b>ПОПОЛНЕНИЕ УСПЕШНО!</b>\n\n"
                                    f"💰 Зачислено: <b>{inv.amount:.2f} USDT</b>\n"
                                    f"🚀 Удачи в игре!"
                                )
                            except: pass
                        
                        processed_invoices.add(inv.invoice_id)
        except Exception as e:
            # Если токен неверный, будет спамить ошибку, поэтому засыпаем подольше
            if "Unauthorized" in str(e):
                await asyncio.sleep(60)
            else:
                print(f"⚠️ Payment Check Error: {e}")
                
        await asyncio.sleep(5)


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
    
    try:
        # Создаем настоящий счет в Crypto Pay
        invoice = await crypto.create_invoice(
            asset='USDT', 
            amount=amount, 
            payload=str(call.from_user.id) # Передаем ID пользователя
        )
        
        text = (
            f"💎 <b>СЧЕТ НА ОПЛАТУ СОЗДАН</b>\n\n"
            f"💰 Сумма: <b>{amount} USDT</b>\n"
            f"🔗 Ссылка: <a href='{invoice.bot_invoice_url}'>Оплатить в Crypto Bot</a>\n\n"
            f"<i>После оплаты баланс пополнится автоматически в течение 10-30 секунд.</i>"
        )
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💳 ОПЛАТИТЬ", url=invoice.bot_invoice_url)],
            [InlineKeyboardButton(text="« НАЗАД", callback_data="deposit_menu")]
        ])
        
        await call.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
        await call.answer()
    except Exception as e:
        print(f"❌ CryptoPay Invoice Error: {type(e).__name__}: {e}")
        # Если ошибка Unauthorized, значит токен не подходит для сети (Testnet/Mainnet)
        if "Unauthorized" in str(e):
            print("⚠️ ОШИБКА: Токен не прошел проверку! Проверь, что в Railway вставлен токен от @CryptoTestPayBot (для TEST_NET).")
        await call.answer("Ошибка при создании счета. Проверь API Токен.", show_alert=True)

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
    # ВАЖНО: Впиши сюда свой Telegram ID для защиты!
    ADMIN_IDS = [217731773, 0] # Замени 0 на свой ID (можно узнать в @userinfobot)
    
    if message.from_user.id not in ADMIN_IDS:
        return await message.answer("🚫 Доступ запрещен. Только для владельца.")

    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    
    # Считаем сумму всех балансов юзеров (в центах)
    cursor.execute('SELECT SUM(balance) FROM users')
    total_users_balance_cents = cursor.fetchone()[0] or 0
    
    # Считаем прибыль админа (в центах)
    cursor.execute('SELECT value FROM stats WHERE key = "admin_profit"')
    admin_profit_cents = cursor.fetchone()[0] or 0
    
    conn.close()
    
    report = (
        f"📊 <b>ФИНАНСОВЫЙ ОТЧЕТ (v4.2)</b>\n\n"
        f"👥 <b>Чаша Игроков:</b> <code>{total_users_balance_cents/100:.2f} USDT</code>\n"
        f"<i>(Столько денег игроки могут вывести прямо сейчас)</i>\n\n"
        f"💰 <b>Твоя Чистая Прибыль:</b> <code>{admin_profit_cents/100:.2f} USDT</code>\n"
        f"<i>(Твой заработок с налогов и проигрышей ботам)</i>\n\n"
        f"💳 <b>Всего на кошельке:</b> <code>{(total_users_balance_cents + admin_profit_cents)/100:.2f} USDT</code>"
    )
    
    await message.answer(report, parse_mode="HTML")
    
async def get_balance_handler(request):
    init_data = request.headers.get("Authorization")
    user_info = verify_init_data(init_data)
    if not user_info:
        return web.json_response({"error": "unauthorized"}, status=401)

    uid = user_info.get("id")
    if not uid:
        return web.json_response({"error": "no user_id in initData"}, status=400)
    
    balance = get_user_balance(uid)
    return web.json_response({"balance": balance})

async def get_state_handler(request):
    """Отдает состояние игры всем клиентам"""
    # Рассчитываем общий банк перед отправкой
    game_state["total_bank"] = sum(p["bet"] for p in game_state["players"])
    return web.json_response(game_state)

async def handle_bet(request):
    init_data = request.headers.get("Authorization")
    user_info = verify_init_data(init_data)
    if not user_info:
        return web.json_response({"error": "unauthorized"}, status=401)

    uid = user_info.get("id")
    data = await request.json()
    amount = float(data.get("amount"))
    name = user_info.get("username", user_info.get("first_name", "Unknown"))
    if not name.startswith("@") and user_info.get("username"):
        name = f"@{name}"
    color = data.get("color")

    # ЗАПРЕЩАЕМ СТАВКИ ВО ВРЕМЯ СПИНА
    if game_state["status"] == "spinning":
        return web.json_response({"error": "round_is_spinning"}, status=400)

    # 1. Проверка баланса перед списанием
    current_balance = get_user_balance(uid)
    if current_balance < amount:
        print(f"🚫 [API] ОТКАЗ: У {name} не хватает денег ({current_balance} < {amount})")
        return web.json_response({"error": "insufficient_funds"}, status=400)

    # 2. Вычитаем ставку из БД (в центах)
    amount_cents = int(amount * 100)
    update_user_balance(uid, -amount_cents)
    new_balance = get_user_balance(uid)
    
    # 2. Добавляем в ГЛОБАЛЬНЫЙ список игроков
    # Проверяем, есть ли уже такой игрок
    found = False
    for p in game_state["players"]:
        if p["name"] == name:
            p["bet"] += amount
            found = True
            break
    if not found:
        game_state["players"].append({
            "user_id": uid, # Сохраняем ID для выплаты на сервере
            "name": name,
            "bet": amount,
            "color": color or f"hsl({(len(game_state['players']) * 137) % 360}, 100%, 50%)"
        })

    print(f"💸 [API] СТАВКА: {name} поставил {amount} USDT. Остаток: {new_balance}")
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

async def setup_menu_button():
    """Устанавливает кнопку Mini App рядом с полем ввода"""
    try:
        from aiogram.types import MenuButtonWebApp, WebAppInfo as AIOWebAppInfo
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="Играть 🎮",
                web_app=AIOWebAppInfo(url=WEBAPP_URL)
            )
        )
        print("✅ Menu Button updated successfully!")
    except Exception as e:
        print(f"⚠️ Failed to update menu button: {e}")

async def main():
    init_db()
    print(f"\n🚀 БОТ ЗАПУЩЕН (v{VERSION}) С БАЗОЙ ДАННЫХ!")
    await setup_menu_button()
    
    # Запускаем API, бота и игровой цикл параллельно
    await asyncio.gather(
        dp.start_polling(bot),
        run_api(),
        game_loop(),
        check_payments()
    )

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот остановлен.")
