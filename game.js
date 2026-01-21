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

    let roundTime = 120;
    let isSpinning = false;
    let syncInterval = null;

    const botNames = [
        '@cyber_ghost', '@neon_heart', '@luck_star', '@gold_king', '@void_walker',
        '@hyper_drive', '@quantum_bit', '@plasma_coil', '@nova_flare', '@glitch_fix',
        '@laser_beam', '@acid_rain', '@blaze_it', '@toxic_fog', '@aqua_glow',
        '@sky_link', '@ruby_eye', '@amber_wave', '@signal_lost', '@neon_pulse'
    ];

    // ГЕНЕРАТОР ЦВЕТОВ (Golden Ratio) - Идеально разные цвета
    let colorIndex = Math.floor(Math.random() * 360);
    function getNextNeonColor() {
        // Используем Золотой Угол для максимального разброса
        const goldenAngle = 137.508;
        const hue = (colorIndex * goldenAngle) % 360;
        colorIndex += 1; // Увеличиваем индекс для следующего игрока
        return `hsl(${hue}, 100%, 50%)`; // Максимальная насыщенность (Неон)
    }

    async function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();

        // ТЕМНАЯ ТЕМА ДЛЯ ВСЕГО ПРИЛОЖЕНИЯ
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.expand();
            window.Telegram.WebApp.setHeaderColor('#0d0e12');
            window.Telegram.WebApp.setBackgroundColor('#0d0e12');
        }

        // Синхронизируем баланс с ботом ПРИ ЗАПУСКЕ (реальный баланс из БД)
        await syncBalance();

        // Запуск ПЕРМАНЕНТНОЙ синхронизации раундов
        startSyncLoop();
    }

    async function syncBalance() {
        if (!uParam) {
            console.warn("No user_id found in URL or WebApp. Connection status will stay red.");
            return;
        }
        console.log("Attempting to sync with Bot API:", BOT_API_URL);
        try {
            const API_URL = `${BOT_API_URL}/api/balance?user_id=${uParam}`;
            const res = await fetch(API_URL, {
                headers: {
                    "Authorization": window.Telegram.WebApp.initData || ""
                }
            });
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

    async function syncGame() {
        try {
            const res = await fetch(`${BOT_API_URL}/api/state`);
            const state = await res.json();

            // 1. Синхронизируем список игроков
            players = state.players;

            // 2. Синхронизируем таймер
            roundTime = state.round_time;

            // 3. Синхронизируем статус раунда
            if (state.status === 'spinning' && !isSpinning) {
                // Сервер сказал крутить!
                startSpinProcess(state.last_winner);
            } else if (state.status === 'waiting' && isSpinning) {
                // Раунд закончился на сервере, сбрасываем локально
                resetGame();
            }

            // Обновляем UI только если не крутим прямо сейчас
            if (!isSpinning) {
                const mins = Math.floor(roundTime / 60);
                const secs = roundTime % 60;
                timerDisplay.textContent = `${mins}:${secs < 10 ? '0' + secs : secs}`;
                timerDisplay.style.color = "#FF0000";
                timerDisplay.style.fontSize = "";
                updateGameState();

                // СИНХРОНИЗИРУЕМ БАЛАНС (для работы на 2 устройствах)
                syncBalance();
            }

            // Блокируем кнопку ставки во время спина
            if (state.status === 'spinning' || isSpinning) {
                betBtn.disabled = true;
                betBtn.style.opacity = "0.5";
                betBtn.textContent = "ROLLING...";
            } else {
                betBtn.disabled = false;
                betBtn.style.opacity = "1";
                betBtn.textContent = "В ИГРУ";
            }

        } catch (e) {
            console.error("Sync Error:", e);
        }
    }

    function startSyncLoop() {
        if (syncInterval) clearInterval(syncInterval);
        syncGame(); // Первый запуск сразу
        syncInterval = setInterval(syncGame, 1000); // Опрос каждую секунду
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

        // 1. Сначала рисуем ГЛОУ (свечение) для каждого сегмента отдельно
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;
            ctx.save();
            ctx.beginPath();
            ctx.arc(150, 150, 142, start, start + slice);

            // Внешний мощный ореол (ЯРКИЙ НЕОН)
            ctx.shadowBlur = 60;
            ctx.shadowColor = p.color;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 10; // Еще толще для яркости
            ctx.stroke();

            // Внутренний горящий фокус
            ctx.shadowBlur = 25;
            ctx.stroke();

            ctx.restore();
            start += slice;
        });

        // 2. Затем рисуем сами сегменты поверх, чтобы перекрыть внутренние тени
        start = 0;
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(150, 150);
            ctx.arc(150, 150, 148, start, start + slice);
            ctx.closePath();

            ctx.fillStyle = p.color;
            ctx.fill();

            // ТЁМНЫЕ РАЗДЕЛИТЕЛИ МЕЖДУ СЕГМЕНТАМИ
            ctx.strokeStyle = '#0a0a0f';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(150, 150);
            ctx.lineTo(150 + 148 * Math.cos(start), 150 + 148 * Math.sin(start));
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

        // Получаем текущие ID элементов в списке
        const currentElements = Array.from(playersList.children);
        const playerMap = new Map();

        sorted.forEach((p, index) => {
            const chance = ((p.bet / total) * 100).toFixed(1);
            let rowIdx = currentElements.findIndex(el => el.getAttribute('data-name') === p.name);

            if (rowIdx >= 0) {
                // ОБНОВЛЯЕМ существующую строку
                const row = currentElements[rowIdx];
                row.querySelector('.player-bet').textContent = `${p.bet.toFixed(2)} USDT`;
                row.querySelector('.player-percent').textContent = `${chance}%`;
                row.style.order = index; // Сортировка через CSS order
                playerMap.set(p.name, row);
                currentElements.splice(rowIdx, 1);
            } else {
                // СОЗДАЕМ новую строку
                const row = document.createElement('div');
                row.className = 'player-row';
                row.setAttribute('data-name', p.name);
                row.style.order = index;
                row.innerHTML = `
                    <div class="player-color" style="background:${p.color}"></div>
                    <div class="player-info">
                        <div class="player-name">${p.name}</div>
                        <div class="player-bet">${p.bet.toFixed(2)} USDT</div>
                    </div>
                    <div class="player-percent">${chance}%</div>
                `;
                playersList.appendChild(row);
                playerMap.set(p.name, row);
            }
        });

        // Удаляем тех, кого больше нет (например после ресета)
        currentElements.forEach(el => el.remove());
    }

    betBtn.addEventListener('click', async () => {
        if (isSpinning) return;
        const val = parseFloat(betInput.value);
        if (val >= 0.1 && val <= myBalance) {
            // Сначала уведомляем бота о ставке, чтобы он вычел из БД
            const myColor = getNextNeonColor(); // Берем свой неон
            const ok = await notifyBotOfBet(uParam, val, myUsername, myColor);
            if (!ok) {
                window.Telegram.WebApp.showAlert("❌ Ошибка связи с ботом. Ставка не принята.");
                return;
            }

            myBalance -= val;
            updateBalanceUI();
            betInput.value = '';
            // Локально не добавляем, ждем синхронизации syncGame()
        }
    });

    document.querySelectorAll('.quick-btn').forEach(b => {
        b.addEventListener('click', () => {
            if (b.id === 'clear-input') { betInput.value = ''; return; }
            const cur = parseFloat(betInput.value) || 0;
            betInput.value = (cur + parseFloat(b.dataset.amount)).toFixed(2);
        });
    });



    function startSpinProcess(serverWinner) {
        if (isSpinning) return;
        isSpinning = true;

        timerDisplay.textContent = "ROLLING";
        timerDisplay.style.color = "#fbbf24";

        const total = players.reduce((s, p) => s + p.bet, 0);

        // Победитель теперь приходит от сервера для всех одинаково
        let winner = serverWinner || players[0];

        // Находим реальный индекс/сектор победителя в текущем списке
        let acc = 0, wStart = 0, wEnd = 360;
        for (let p of players) {
            if (p.name === winner.name) {
                wStart = (acc / total) * 360;
                wEnd = ((acc + p.bet) / total) * 360;
                winner = p; // Берем объект с цветом
                break;
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
            const netWin = (total - winner.bet) * 0.90; // НАЛОГ 10% (было 5%)
            const fee = (total - winner.bet) * 0.10;
            const payout = winner.bet + netWin;

            // В центре пишем кто победил
            timerDisplay.textContent = "Winner!";
            timerDisplay.style.fontSize = "20px";
            timerDisplay.style.color = "#FF0000"; // ВСЕГДА КРАСНЫЙ

            // Показываем имя И сумму выигрыша (многострочно)
            const fontSize = winner.name.length > 12 ? "12px" : "15px";
            const potContainer = document.getElementById('pot-total-container');
            potContainer.innerHTML = `
                <div style="font-size: ${fontSize}; color: #fff; font-weight: 700; line-height: 1.1;">${winner.name}</div>
                <div style="font-size: 14px; color: #00FF00; font-weight: 800; margin-top: 2px;">+${payout.toFixed(2)} USDT</div>
            `;

            // Уведомление ТОЛЬКО если выиграл я
            if (winner.name === myUsername) {
                window.Telegram.WebApp.showAlert(`🚀 ПОБЕДА! Вы выиграли ${payout.toFixed(2)} USDT`);
                // Синхронизируем баланс с сервером ПОСЛЕ выигрыша
                setTimeout(() => syncBalance(), 1000);
            }

            // Ровно через 3 секунды сбрасываем раунд для новой игры
            setTimeout(() => resetGame(), 3000);
        }, 6500);
    }

    function resetGame() {
        players = [];
        colorIndex = Math.floor(Math.random() * 360); // РАНДОМНЫЙ ЦВЕТ ДЛЯ ВСЕХ В НОВОМ РАУНДЕ
        roundTime = 120; // ВОЗВРАЩАЕМ 2 МИНУТЫ
        isSpinning = false;
        timerStarted = false;
        timerDisplay.textContent = "--:--";
        timerDisplay.style.color = "#FF0000";
        timerDisplay.style.fontSize = ""; // Возвращаем компактный размер из CSS

        // СБРОС ЦЕНТРАЛЬНОГО ТАБЛО
        const potContainer = document.getElementById('pot-total-container');
        potContainer.innerHTML = `$ <span id="pot-amount">0.00</span>`;
        potDisplay = document.getElementById('pot-amount'); // Переподключаем элемент

        wheelWrapper.style.transition = "none";
        wheelWrapper.style.transform = "rotate(-90deg)";
        updateGameState();
    }


    async function notifyBotOfBet(userId, amount, name, color) {
        if (!userId) return true;
        try {
            const API_URL = `${BOT_API_URL}/api/bet`;
            const res = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": window.Telegram.WebApp.initData || ""
                },
                body: JSON.stringify({
                    user_id: userId,
                    amount: amount,
                    name: name,
                    color: color
                })
            });
            return res.ok;
        } catch (e) {
            console.error("Bet sync failed:", e);
            return false;
        }
    }

    init();
});
