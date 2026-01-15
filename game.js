document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('wheel-canvas');
    const ctx = canvas.getContext('2d');
    const potDisplay = document.getElementById('pot-amount');
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
    const uParam = params.get('user_id'); // Берем ID юзера из ссылки
    let myBalance = 100.00;

    if (bParam !== null) {
        myBalance = parseFloat(bParam);
        localStorage.setItem('test_balance', myBalance.toFixed(2));
    } else {
        myBalance = parseFloat(localStorage.getItem('test_balance')) || 100.00;
    }

    let roundTime = 30;
    let isSpinning = false;
    let timerStarted = false;
    let timerInterval = null;
    let botInterval = null;

    const botPool = [
        { name: '@crypto_king', color: '#00fbff' }, // Electric Cyan
        { name: '@ton_master', color: '#ff00ff' }, // Magenta
        { name: '@lucky_guy', color: '#bfff00' },   // Toxic Green
        { name: '@whale_🐋', color: '#ffff00' },    // Pure Yellow
        { name: '@degen_1337', color: '#ff6b00' }   // Bright Orange
    ];

    async function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();
        window.Telegram.WebApp.expand();

        // Синхронизируем баланс с ботом ПРИ ЗАПУСКЕ (реальный баланс из БД)
        await syncBalance();
    }

    async function syncBalance() {
        if (!uParam) return;
        try {
            const API_URL = `${BOT_API_URL}/api/balance?user_id=${uParam}`;
            const res = await fetch(API_URL);
            const data = await res.json();
            if (data.balance !== undefined) {
                myBalance = data.balance;
                updateBalanceUI();
                statusDot.classList.remove('disconnected');
                statusDot.classList.add('connected');
                console.log("Balance synced with Bot API:", myBalance);
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } catch (e) {
            console.error("Balance sync failed. Bot down?");
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
        else players.push({ name, bet: amount, color });
        if (!timerStarted) { timerStarted = true; startRound(); }
        updateGameState();
    }

    function updateGameState() {
        const total = players.reduce((s, p) => s + p.bet, 0);
        potDisplay.textContent = total.toFixed(2);
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

        // Рисуем свечение под колесом
        ctx.shadowBlur = 15;
        ctx.shadowColor = "rgba(255, 255, 255, 0.1)";

        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;

            // Основной сектор
            ctx.beginPath();
            ctx.moveTo(150, 150);
            ctx.arc(150, 150, 148, start, start + slice);
            ctx.closePath();

            ctx.shadowBlur = 0; // Отключаем тень для заливки, чтобы не мылило
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.9; // Делаем почти непрозрачным для яркости
            ctx.fill();
            ctx.globalAlpha = 1.0;

            // Неоновая тонкая граница
            ctx.beginPath();
            ctx.arc(150, 150, 148, start, start + slice);
            ctx.strokeStyle = '#fff'; // Яркая белая сердцевина неона
            ctx.lineWidth = 1.5;
            ctx.shadowBlur = 15; // Больше свечения
            ctx.shadowColor = p.color; // Цветное свечение неона
            ctx.stroke();

            // Дополнительный тонкий контур для эффекта "сияния"
            ctx.lineWidth = 0.5;
            ctx.shadowBlur = 2;
            ctx.stroke();

            start += slice;
        });

        // Сбрасываем тени
        ctx.shadowBlur = 0;
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
            handleNewBet(val, '@you', '#10b981');
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
            if (roundTime > 0) { roundTime--; timerDisplay.textContent = `0:${roundTime < 10 ? '0' + roundTime : roundTime}`; }
            else { clearInterval(timerInterval); clearInterval(botInterval); startSpinProcess(); }
        }, 1000);
        botInterval = setInterval(() => {
            if (!isSpinning) {
                const bot = botPool[Math.floor(Math.random() * botPool.length)];
                handleNewBet(Math.floor(Math.random() * 15) + 5, bot.name, bot.color);
            }
        }, 3000);
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

            timerDisplay.textContent = "WINNER!";
            timerDisplay.style.color = "#10b981";

            window.Telegram.WebApp.showAlert(`ПОБЕДИТЕЛЬ: ${winner.name}\nВыигрыш: ${payout.toFixed(2)} USDT`);

            if (winner.name === '@you') {
                myBalance += payout;
                updateBalanceUI();
                // УВЕДОМЛЯЕМ БОТА О ВЫИГРЫШЕ
                await notifyBotOfWin(uParam, payout, fee);
            }

            // Просто сбрасываем раунд, деньги остаются в памяти
            setTimeout(() => resetGame(), 3000);
        }, 6500);
    }

    function resetGame() {
        players = [];
        roundTime = 30;
        isSpinning = false;
        timerStarted = false;
        timerDisplay.textContent = "--:--";
        timerDisplay.style.color = "#ef4444";
        potDisplay.textContent = "0.00";
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
