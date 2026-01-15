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
        { name: '@cyber_ghost', color: '#00e5ff' }, // Electric Cyan
        { name: '@neon_heart', color: '#ff00ff' }, // Vivid Magenta
        { name: '@luck_star', color: '#39ff14' },  // Neon Lime
        { name: '@gold_king', color: '#ffcc00' },  // Bright Gold
        { name: '@void_walker', color: '#bc13fe' } // Electric Purple
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
            ctx.beginPath();
            ctx.moveTo(150, 150);
            ctx.arc(150, 150, 148, start, start + slice);
            ctx.closePath();

            // 1. ПИЦЦА-ГРАДИЕНТ (Свет из центра)
            // Центр осветлен до половины ячейки, затем уходит в темноту
            const grad = ctx.createRadialGradient(150, 150, 0, 150, 150, 150);
            grad.addColorStop(0, "#fff"); // Центр - белый свет
            grad.addColorStop(0.5, p.color); // До середины - основной яркий цвет
            grad.addColorStop(1, adjustColor(p.color, -120)); // Края - очень темный неон

            ctx.fillStyle = grad;
            ctx.fill();

            // 2. ТОНКАЯ ГРАНИЦА ЦВЕТА ЯЧЕЙКИ (как просил)
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1.5;
            ctx.shadowBlur = 5;
            ctx.shadowColor = p.color;

            // Сама дуга
            ctx.beginPath();
            ctx.arc(150, 150, 148, start, start + slice);
            ctx.stroke();

            // Боковые линии (спицы)
            ctx.beginPath();
            ctx.moveTo(150, 150);
            const endX = 150 + 148 * Math.cos(start);
            const endY = 150 + 148 * Math.sin(start);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            ctx.restore();
            start += slice;
        });

        // 3. ОБЩИЙ БЛЕСК СВЕРХУ (Стекло)
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
            if (winner.name === '@you') {
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
        roundTime = 30;
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
