const BOT_API_URL = "https://mini-app-jackpot-3.onrender.com";

// Глобальные переменные
const canvas = document.getElementById('wheel-canvas');
const ctx = canvas.getContext('2d');
const wheelWrapper = document.getElementById('wheel-spin-wrapper');
const playersList = document.getElementById('players-list');
const timerDisplay = document.getElementById('timer');
const potDisplay = document.getElementById('pot-amount');
const userBalanceDisplay = document.getElementById('user-balance');
const statusDot = document.getElementById('status-dot');

let players = [];
let myBalance = 0;
let isSpinning = false;
let roundTime = 120; // 2 минуты раунд
let timerInterval = null;
let botInterval = null;
let timerStarted = false;

// Получаем параметры из URL
const urlParams = new URLSearchParams(window.location.search);
const uParam = urlParams.get('user_id');
const myUsername = urlParams.get('username') || "You";
// Инициализируем баланс сразу из URL, если есть, иначе 0
myBalance = parseFloat(urlParams.get('balance')) || 0;

// Если баланс пришел из URL - считаем, что мы "подключены" (данные есть)
if (urlParams.has('balance')) {
    statusDot.classList.add('connected');
    statusDot.classList.remove('disconnected');
}

// Генерация уникальных цветов (Golden Ratio)
let colorHue = 0;
function getNextColor() {
    colorHue += 0.618033988749895; // Golden Ratio
    colorHue %= 1;
    return hslToHex(colorHue * 360, 90, 60);
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// Имена ботов
const botNames = [
    '@cyber_ghost', '@neon_heart', '@luck_star', '@gold_king', '@void_walker',
    '@hyper_drive', '@quantum_bit', '@plasma_coil', '@nova_flare', '@glitch_fix',
    '@laser_beam', '@acid_rain', '@blaze_it', '@toxic_fog', '@aqua_glow',
    '@sky_link', '@ruby_eye', '@amber_wave', '@signal_lost', '@neon_pulse'
];

async function init() {
    resizeCanvas();
    updateBalanceUI();
    updateGameState();
    window.Telegram.WebApp.expand();

    // Синхронизируем баланс с ботом ПРИ ЗАПУСКЕ
    await syncBalance();
}

async function syncBalance() {
    if (!uParam) {
        console.warn("No user_id found in URL. Connection status will stay red.");
        return;
    }
    try {
        const res = await fetch(`${BOT_API_URL}/api/balance?user_id=${uParam}`);
        if (res.ok) {
            const data = await res.json();
            myBalance = data.balance;
            updateBalanceUI();
            statusDot.classList.add('connected');
            statusDot.classList.remove('disconnected');
            console.log("✅ Connection Successful! Balance:", myBalance);
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
    } catch (e) {
        console.error("❌ API Connection Failed:", e.message);
        // Если баланс уже есть (из URL), не пугаем юзера красной лампой
        if (myBalance === 0) {
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
        } else {
            console.log("⚠️ API fail, but using URL balance (Offline Mode)");
        }
    }
}

function updateBalanceUI() {
    userBalanceDisplay.textContent = myBalance.toFixed(2);
    localStorage.setItem('test_balance', myBalance.toFixed(2));
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 300 * dpr;
    canvas.height = 300 * dpr;
    ctx.scale(dpr, dpr);
}

function handleNewBet(amount, name, color) {
    if (isSpinning) return;

    // Если цвет не передан (новый игрок) — генерируем новый
    if (!color) {
        const existing = players.find(p => p.name === name);
        color = existing ? existing.color : getNextColor();
    }

    const pIdx = players.findIndex(p => p.name === name);
    if (pIdx >= 0) players[pIdx].bet += amount;
    else players.push({ name, bet: amount, color });

    updateGameState();

    // Запуск таймера при первой ставке
    if (!timerStarted) {
        timerStarted = true;
        roundTime = 120;
        startRound();
    }
}

function updateGameState() {
    const total = players.reduce((sum, p) => sum + p.bet, 0);

    const potContainer = document.getElementById('pot-total-container');
    potContainer.innerHTML = `$ <span id="pot-amount">${total.toFixed(2)}</span>`;

    if (total === 0) drawEmptyWheel();
    else drawWheel(total);

    renderList(total);
}

function drawWheel(total) {
    ctx.clearRect(0, 0, 300, 300);
    let start = 0;

    players.forEach(p => {
        const slice = (p.bet / total) * 2 * Math.PI;

        ctx.save();

        // СВЕЧЕНИЕ ПОД ЦВЕТ ЯЧЕЙКИ (Сзади)
        ctx.shadowBlur = 40;
        ctx.shadowColor = p.color;

        ctx.beginPath();
        ctx.moveTo(150, 150);
        ctx.arc(150, 150, 148, start, start + slice);
        ctx.closePath();

        // ПЛОСКИЙ ЦВЕТ (без градиента)
        ctx.fillStyle = p.color;
        ctx.fill();

        // ТЁМНЫЕ РАЗДЕЛИТЕЛИ МЕЖДУ СЕГМЕНТАМИ
        ctx.strokeStyle = '#0a0a0f';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(150, 150);
        const endX = 150 + 148 * Math.cos(start);
        const endY = 150 + 148 * Math.sin(start);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.restore();
        start += slice;
    });

    // ОБЩИЙ БЛЕСК СВЕРХУ (Стекло)
    ctx.save();
    ctx.beginPath();
    ctx.arc(150, 150, 148, 0, Math.PI * 2);
    const shine = ctx.createRadialGradient(150, 50, 10, 150, 150, 250);
    shine.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    shine.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = shine;
    ctx.fill();
    ctx.restore();

    ctx.shadowBlur = 0;
}

function adjustColor(hex, amt) {
    let usePound = false;
    if (hex[0] == "#") { hex = hex.slice(1); usePound = true; }
    let num = parseInt(hex, 16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

function drawEmptyWheel() {
    ctx.clearRect(0, 0, 300, 300);
    ctx.beginPath();
    ctx.arc(150, 150, 148, 0, Math.PI * 2);
    ctx.fillStyle = '#13141a';
    ctx.fill();

    ctx.strokeStyle = '#2a2d35';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function renderList(total) {
    // Сортируем игроков по ставке. Клонируем, чтобы не портить основной массив для рендера колеса
    const sorted = [...players].sort((a, b) => b.bet - a.bet);

    // Получаем текущие элементы
    const existingRows = Array.from(playersList.children);

    // Удаляем выбывших
    existingRows.forEach(row => {
        const name = row.id.replace('player-row-', '');
        if (!players.find(p => p.name === name)) {
            row.remove();
        }
    });

    // Добавляем или обновляем
    sorted.forEach((p, index) => {
        let row = document.getElementById(`player-row-${p.name}`);

        // Если строки нет - создаем
        if (!row) {
            row = document.createElement('div');
            row.id = `player-row-${p.name}`;
            row.className = 'player-row';
            row.innerHTML = `
                <div class="player-color" style="background:${p.color}"></div>
                <div class="player-info">
                    <div class="player-name">${p.name}</div>
                    <div class="player-bet">0.00 USDT</div>
                </div>
                <div class="player-percent">0%</div>
            `;
            playersList.appendChild(row);
        }

        // Обновляем данные
        row.querySelector('.player-bet').textContent = `${p.bet.toFixed(2)} USDT`;
        row.querySelector('.player-percent').textContent = `${((p.bet / total) * 100).toFixed(1)}%`;

        // Порядок (визуальная сортировка через CSS order)
        row.style.order = index;
    });
}

// Заглушка для обновления баланса (локально)
// Реальное обновление идет через syncBalance()
function updateBalance(amount) {
    if (myBalance + amount < 0) return false;
    myBalance += amount;
    updateBalanceUI();
    updateServerBalance(myBalance); // Сразу сохраняем на сервер
    return true;
}

// =======================
// УПРАВЛЕНИЕ СТАВКАМИ
// =======================

// 1. Кастомная ставка "В ИГРУ"
const placeCustomBetBtn = document.getElementById('place-custom-bet');
const customBetInput = document.getElementById('custom-bet-input');

placeCustomBetBtn.addEventListener('click', () => {
    if (customBetInput.value) {
        let val = parseFloat(customBetInput.value);
        if (val >= 1) { // МИН СТАВКА 1 USDT
            if (val > myBalance) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
                window.Telegram.WebApp.showAlert("Недостаточно средств!");
                return;
            }
            const myColor = (players.find(p => p.name === myUsername) || {}).color || getNextColor();
            updateBalance(-val);
            handleNewBet(val, myUsername, myColor);
            customBetInput.value = '';
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        } else {
            window.Telegram.WebApp.showAlert("Минимальная ставка: 1 USDT");
        }
    }
});

// 2. Быстрые ставки (+1, +5, +10, +100)
document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        // Кнопка очистки
        if (btn.id === 'clear-input') {
            customBetInput.value = '';
            return;
        }

        const amt = parseFloat(btn.dataset.amount);
        if (amt > myBalance) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
            return;
        }

        const myColor = (players.find(p => p.name === myUsername) || {}).color || getNextColor();
        updateBalance(-amt);
        handleNewBet(amt, myUsername, myColor);
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('light');
    });
});


// =======================
// ИГРОВОЙ ЦИКЛ
// =======================

function startRound() {
    if (timerInterval) clearInterval(timerInterval);
    if (botInterval) clearInterval(botInterval);

    timerInterval = setInterval(() => {
        if (roundTime > 0) {
            roundTime--;
            const mins = Math.floor(roundTime / 60);
            const secs = roundTime % 60;
            timerDisplay.textContent = `${mins}:${secs < 10 ? '0' + secs : secs}`;
        }
        else {
            clearInterval(timerInterval);
            clearInterval(botInterval);
            startSpinProcess();
        }
    }, 1000);

    // Логика ботов
    let usedBotNames = [];
    botInterval = setInterval(() => {
        if (!isSpinning) {
            if (Math.random() > 0.3 && usedBotNames.length < botNames.length) {
                // Добавляем нового бота
                const availableNames = botNames.filter(n => !usedBotNames.includes(n));
                if (availableNames.length > 0) {
                    const name = availableNames[Math.floor(Math.random() * availableNames.length)];
                    usedBotNames.push(name);
                    handleNewBet(Math.floor(Math.random() * 15) + 5, name, null);
                }
            } else if (players.length > 0) {
                // Добавляем ставку существующему
                const existingBot = players[Math.floor(Math.random() * players.length)];
                if (existingBot.name !== myUsername) {
                    handleNewBet(Math.floor(Math.random() * 10) + 3, existingBot.name, existingBot.color);
                }
            }
        }
    }, 2000);
}

function startSpinProcess() {
    isSpinning = true;
    timerDisplay.textContent = "ROLLING";
    timerDisplay.style.color = "#fbbf24";

    const total = players.reduce((s, p) => s + p.bet, 0);
    const winTicket = Math.random() * total;
    let acc = 0, winner = players[0], wStart = 0, wEnd = 0;

    for (let p of players) {
        if (winTicket >= acc && winTicket < acc + p.bet) {
            winner = p;
            wStart = (acc / total) * 360;
            wEnd = ((acc + p.bet) / total) * 360;
            break;
        }
        acc += p.bet;
    }

    const winCenter = (wStart + wEnd) / 2;
    const targetRotation = (360 * 10) + (270 - winCenter);

    wheelWrapper.style.transition = "none";
    wheelWrapper.style.transform = "rotate(0deg)";

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            wheelWrapper.style.transition = "transform 6s cubic-bezier(0.1, 0, 0.1, 1)";
            wheelWrapper.style.transform = `rotate(${targetRotation}deg)`;
        });
    });

    setTimeout(async () => {
        // КОМИССИЯ 10%
        const netWin = (total - winner.bet) * 0.90;
        const fee = (total - winner.bet) * 0.10;
        const payout = winner.bet + netWin;

        timerDisplay.textContent = "WINNER!";
        timerDisplay.style.fontSize = "20px";
        timerDisplay.style.color = "#00ffaa";

        const fontSize = winner.name.length > 12 ? "14px" : "18px";
        const potContainer = document.getElementById('pot-total-container');

        potContainer.innerHTML = `
            <div style="font-size: ${fontSize}; color: #fff; font-weight: 700; margin-bottom: 5px;">${winner.name}</div>
            <div style="font-size: 16px; color: #00ffaa; font-weight: 800;">+${payout.toFixed(2)} USDT</div>
        `;

        // Если выиграл юзер
        if (winner.name === myUsername) {
            window.Telegram.WebApp.showAlert(`🚀 ПОБЕДА! Вы выиграли ${payout.toFixed(2)} USDT`);
            myBalance += payout;
            updateBalanceUI();
            await updateServerBalance(myBalance);
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }

        // Уведомляем сервер (бота) о победе
        await notifyBotOfWin(uParam, payout, fee);

        setTimeout(resetGame, 5000);
    }, 6000);
}

function resetGame() {
    players = [];
    roundTime = 120;
    isSpinning = false;
    timerStarted = false;
    timerDisplay.textContent = "--:--";
    timerDisplay.style.color = "#ef4444";
    timerDisplay.style.fontSize = "";

    const potContainer = document.getElementById('pot-total-container');
    potContainer.innerHTML = `$ <span id="pot-amount">0.00</span>`;

    wheelWrapper.style.transition = "none";
    wheelWrapper.style.transform = "rotate(-90deg)";
    updateGameState();
}

async function updateServerBalance(newBalance) {
    if (!uParam) return;
    try {
        await fetch(`${BOT_API_URL}/api/balance`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: uParam, balance: newBalance })
        });
    } catch (e) {
        console.error("Save balance failed", e);
    }
}

async function notifyBotOfWin(userId, amount, fee) {
    if (!userId) return;
    try {
        await fetch(`${BOT_API_URL}/api/win`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, amount: amount, fee: fee })
        });
    } catch (e) { console.error("Notify win failed", e); }
}

// Запуск
init();
