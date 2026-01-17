document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('wheel-canvas');
    const ctx = canvas.getContext('2d');
    let potDisplay = document.getElementById('pot-amount');
    const timerDisplay = document.getElementById('timer');
    const playersList = document.getElementById('players-list');
    const wheelWrapper = document.getElementById('wheel-spin-wrapper');
    const betInput = document.getElementById('custom-bet-input');
    const betBtn = document.getElementById('place-custom-bet');
    const userBalanceDisplay = document.getElementById('user-balance');
    const statusDot = document.getElementById('status-dot');

    let players = [];

    // ЦЕНТРАЛЬНЫЙ АДРЕС БОТА (Railway Production)
    const BOT_API_URL = "https://jackpot-wheel-production.up.railway.app";

    const params = new URLSearchParams(window.location.search);
    const bParam = params.get('balance');
    let uParam = params.get('user_id');
    let myUsername = "@you";

    // Если в URL нет ID, берем его напрямую из Телеграма (очень важно для кнопки меню!)
    if (window.Telegram && window.Telegram.WebApp.initDataUnsafe.user) {
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        uParam = uParam || user.id;
        myUsername = user.username ? `@${user.username}` : (user.first_name || "@you");
        console.log("UserID loaded from WebApp API:", uParam, "Username:", myUsername);
    }

    let myBalance = 100.00;

    if (bParam !== null) {
        myBalance = parseFloat(bParam);
        localStorage.setItem('test_balance', myBalance.toFixed(2));
    } else {
        myBalance = parseFloat(localStorage.getItem('test_balance')) || 100.00;
    }

    let roundTime = 120; // 2 МИНУТЫ КД
    let isSpinning = false;
    let timerStarted = false;
    let timerInterval = null;
    let botInterval = null;

    const botNames = [
        '@cyber_ghost', '@neon_heart', '@luck_star', '@gold_king', '@void_walker',
        '@hyper_drive', '@quantum_bit', '@plasma_coil', '@nova_flare', '@glitch_fix',
        '@laser_beam', '@acid_rain', '@blaze_it', '@toxic_fog', '@aqua_glow',
        '@sky_link', '@ruby_eye', '@amber_wave', '@signal_lost', '@neon_pulse'
    ];

    // ГЕНЕРАТОР ЦВЕТОВ (Golden Ratio) - Идеально разные цвета
    let colorIndex = 0;
    function getNextNeonColor() {
        const goldenAngle = 137.508; // Золотой угол
        const hue = (colorIndex * goldenAngle) % 360;
        colorIndex++;
        return `hsl(${hue}, 100%, 50%)`; // Максимальная насыщенность (Неон)
    }

    async function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();
        window.Telegram.WebApp.expand();

        // Синхронизируем баланс с ботом ПРИ ЗАПУСКЕ (реальный баланс из БД)
        await syncBalance();
    }

    async function syncBalance() {
        if (!uParam) {
            console.warn("No user_id found in URL or WebApp. Connection status will stay red.");
            return;
        }
        console.log("Attempting to sync with Bot API:", BOT_API_URL);
        try {
            const API_URL = `${BOT_API_URL}/api/balance?user_id=${uParam}`;
            const res = await fetch(API_URL);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();
            if (data.balance !== undefined) {
                myBalance = data.balance;
                updateBalanceUI();
                statusDot.classList.remove('disconnected');
                statusDot.classList.add('connected');
                console.log("✅ Connection Successful! Balance:", myBalance);
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } catch (e) {
            console.error("❌ API Connection Failed:", e.message);
            console.error("Make sure your Bot is running at:", BOT_API_URL);
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
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
        const pIdx = players.findIndex(p => p.name === name);
        if (pIdx >= 0) players[pIdx].bet += amount;
        else {
            // Если цвет не передан (новый игрок/бот), генерируем уникальный
            const finalColor = color || getNextNeonColor();
            players.push({ name, bet: amount, color: finalColor });
        }
        if (!timerStarted) { timerStarted = true; startRound(); }
        updateGameState();
    }

    function updateGameState() {
        const total = players.reduce((s, p) => s + p.bet, 0);
        potDisplay.textContent = total.toFixed(2);

        // ДИНАМИЧЕСКИЙ РАЗМЕР ШРИФТА (только для банка, чтобы всё влезало)
        if (total >= 100000) {
            potDisplay.style.fontSize = "16px";
        } else if (total >= 10000) {
            potDisplay.style.fontSize = "18px";
        } else if (total >= 1000) {
            potDisplay.style.fontSize = "22px";
        } else {
            potDisplay.style.fontSize = "26px";
        }

        if (total > 0) {
            drawWheel(total);
            renderList(total);
        } else {
            drawEmptyWheel();
            playersList.innerHTML = '<div style="text-align:center;padding:10px;color:#4b5563">Waiting for bets...</div>';
        }
    }

    function drawWheel(total) {
        ctx.clearRect(0, 0, 300, 300);
        let start = 0;

        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;

            ctx.save();

            // 2. ПОДСВЕТКА СЗАДИ ЯЧЕЙКИ (Свой цвет для каждого сегмента)
            ctx.shadowBlur = 30;
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

        ctx.restore();

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

    // Хелпер для затемнения цветов для градиента
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
        const sorted = [...players].sort((a, b) => b.bet - a.bet);
        playersList.innerHTML = sorted.map(p => `
            <div class="player-row">
                <div class="player-color" style="background:${p.color}"></div>
                <div class="player-info"><div class="player-name">${p.name}</div><div class="player-bet">${p.bet.toFixed(2)} USDT</div></div>
                <div class="player-percent">${((p.bet / total) * 100).toFixed(1)}%</div>
            </div>
        `).join('');
    }

    betBtn.addEventListener('click', async () => {
        const val = parseFloat(betInput.value);
        if (val >= 0.1 && val <= myBalance) {
            // Сначала уведомляем бота о ставке, чтобы он вычел из БД
            const ok = await notifyBotOfBet(uParam, val);
            if (!ok) {
                window.Telegram.WebApp.showAlert("❌ Ошибка связи с ботом. Ставка не принята.");
                return;
            }

            myBalance -= val;
            updateBalanceUI();
            handleNewBet(val, myUsername, '#10b981');
            betInput.value = '';
        }
    });

    document.querySelectorAll('.quick-btn').forEach(b => {
        b.addEventListener('click', () => {
            if (b.id === 'clear-input') { betInput.value = ''; return; }
            const cur = parseFloat(betInput.value) || 0;
            betInput.value = (cur + parseFloat(b.dataset.amount)).toFixed(2);
        });
    });



    function startRound() {
        timerInterval = setInterval(() => {
            if (roundTime > 0) {
                roundTime--;
                const mins = Math.floor(roundTime / 60);
                const secs = roundTime % 60;
                timerDisplay.textContent = `${mins}:${secs < 10 ? '0' + secs : secs}`;
            }
            else { clearInterval(timerInterval); clearInterval(botInterval); startSpinProcess(); }
        }, 1000);
        let availableBots = [...botNames]; // Пул имен ботов
        botInterval = setInterval(() => {
            if (!isSpinning) {
                // Логика: если боты есть в пуле, заходят новые
                // Если пул пуст, существующие боты докидывают ставки
                if (availableBots.length > 0) {
                    const idx = Math.floor(Math.random() * availableBots.length);
                    const botName = availableBots.splice(idx, 1)[0];
                    // Цвет генерируется автоматически в handleNewBet
                    handleNewBet(Math.floor(Math.random() * 15) + 5, botName, null);
                } else if (players.length > 0) {
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
                winner = p; wStart = (acc / total) * 360; wEnd = ((acc + p.bet) / total) * 360; break;
            }
            acc += p.bet;
        }

        const winCenter = (wStart + wEnd) / 2;
        const targetRotation = (360 * 10) + (360 - winCenter);

        wheelWrapper.style.transition = "none";
        wheelWrapper.style.transform = "rotate(-90deg)";

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                wheelWrapper.style.transition = "transform 6s cubic-bezier(0.1, 0, 0.1, 1)";
                wheelWrapper.style.transform = `rotate(${targetRotation - 90}deg)`;
            });
        });

        setTimeout(async () => {
            const netWin = (total - winner.bet) * 0.95;
            const fee = (total - winner.bet) * 0.05;
            const payout = winner.bet + netWin;

            // В центре пишем кто победил
            timerDisplay.textContent = "Winner!";
            timerDisplay.style.fontSize = "20px";
            timerDisplay.style.color = "#00ffaa";

            // Показываем имя И сумму выигрыша (многострочно)
            const fontSize = winner.name.length > 12 ? "12px" : "15px";
            const potContainer = document.getElementById('pot-total-container');
            potContainer.innerHTML = `
                <div style="font-size: ${fontSize}; color: #fff; font-weight: 700; line-height: 1.1;">${winner.name}</div>
                <div style="font-size: 14px; color: #00ffaa; font-weight: 800; margin-top: 2px;">+${payout.toFixed(2)} USDT</div>
            `;

            // Уведомление ТОЛЬКО если выиграл я
            if (winner.name === myUsername) {
                window.Telegram.WebApp.showAlert(`🚀 ПОБЕДА! Вы выиграли ${payout.toFixed(2)} USDT`);
                myBalance += payout;
                updateBalanceUI();
                // УВЕДОМЛЯЕМ БОТА О ВЫИГРЫШЕ
                await notifyBotOfWin(uParam, payout, fee);
            }

            // Ровно через 3 секунды сбрасываем раунд для новой игры
            setTimeout(() => resetGame(), 3000);
        }, 6500);
    }

    function resetGame() {
        players = [];
        roundTime = 120; // ВОЗВРАЩАЕМ 2 МИНУТЫ
        isSpinning = false;
        timerStarted = false;
        timerDisplay.textContent = "--:--";
        timerDisplay.style.color = "#ef4444";
        timerDisplay.style.fontSize = ""; // Возвращаем компактный размер из CSS

        // СБРОС ЦЕНТРАЛЬНОГО ТАБЛО
        const potContainer = document.getElementById('pot-total-container');
        potContainer.innerHTML = `$ <span id="pot-amount">0.00</span>`;
        potDisplay = document.getElementById('pot-amount'); // Переподключаем элемент

        wheelWrapper.style.transition = "none";
        wheelWrapper.style.transform = "rotate(-90deg)";
        updateGameState();
    }

    async function notifyBotOfWin(userId, amount, fee) {
        if (!userId) return;
        try {
            const API_URL = `${BOT_API_URL}/api/win`;
            await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, amount: amount, fee: fee })
            });
            console.log("Win notified successfully");
        } catch (e) {
            console.error("Win sync failed:", e);
        }
    }

    async function notifyBotOfBet(userId, amount) {
        if (!userId) return true;
        try {
            const API_URL = `${BOT_API_URL}/api/bet`;
            const res = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, amount: amount })
            });
            return res.ok;
        } catch (e) {
            console.error("Bet sync failed:", e);
            return false;
        }
    }

    init();
});
