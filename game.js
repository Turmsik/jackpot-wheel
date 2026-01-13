document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const canvas = document.getElementById('wheel-canvas');
    const ctx = canvas.getContext('2d');
    const potDisplay = document.getElementById('pot-amount');
    const timerDisplay = document.getElementById('timer');
    const playersList = document.getElementById('players-list');
    const wheelElement = document.getElementById('wheel-canvas');
    const betInput = document.getElementById('custom-bet-input');
    const betBtn = document.getElementById('place-custom-bet');
    const quickBtns = document.querySelectorAll('.quick-btn');
    const clearBtn = document.getElementById('clear-input');
    const userBalanceDisplay = document.getElementById('user-balance');

    // --- GAME STATE ---
    let players = []; // Stores objects: { name, bet, color }
    let myBalance = 100.00;
    let roundTime = 120;
    let isSpinning = false;
    let timerStarted = false;
    let timerInterval = null;
    let botInterval = null;

    // --- BOT POOL ---
    const botPool = [
        { name: '@crypto_king', color: '#6366f1' },
        { name: '@ton_master', color: '#a855f7' },
        { name: '@lucky_guy', color: '#ec4899' },
        { name: '@whale_🐋', color: '#f43f5e' },
        { name: '@degen_1337', color: '#ef4444' }
    ];

    // --- INITIALIZATION ---
    function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();
        window.Telegram.WebApp.expand();
        console.log("GAME V5: LOADED");
    }

    function updateBalanceUI() {
        userBalanceDisplay.textContent = myBalance.toFixed(2);
    }

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    }

    // --- BETTING CORE ---
    function handleNewBet(amount, name, color) {
        if (isSpinning) return;

        // 🛡 SUMMATION LOGIC: Strictly check if player exists
        const pIdx = players.findIndex(p => p.name.trim() === name.trim());

        if (pIdx >= 0) {
            players[pIdx].bet += amount;
            console.log(`Updated ${name} total bet to ${players[pIdx].bet}`);
        } else {
            players.push({ name: name.trim(), bet: amount, color: color });
            console.log(`Added new player: ${name}`);
        }

        // Start round if first bet
        if (!timerStarted) {
            timerStarted = true;
            startRound();
        }

        updateGameState();
    }

    function updateGameState() {
        const total = players.reduce((sum, p) => sum + p.bet, 0);
        potDisplay.textContent = total.toFixed(2);

        if (total > 0) {
            drawWheel(total);
            renderPlayerList(total);
        } else {
            drawEmptyWheel();
            playersList.innerHTML = '<div class="empty-state" style="text-align:center; padding:15px; color:#4b5563; font-size:11px;">Ожидание ставок...</div>';
        }
    }

    // --- WHEEL DRAWING (MONOLITHIC SEGMENTS) ---
    function drawWheel(total) {
        const cx = canvas.width / (2 * window.devicePixelRatio);
        const cy = canvas.height / (2 * window.devicePixelRatio);
        const r = cx;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let startAngle = 0;
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, startAngle, startAngle + slice);
            ctx.closePath();
            ctx.fillStyle = p.color;
            ctx.fill();
            // Inner lines
            ctx.strokeStyle = '#18191c';
            ctx.lineWidth = 1;
            ctx.stroke();
            startAngle += slice;
        });
    }

    function drawEmptyWheel() {
        const cx = canvas.width / (2 * window.devicePixelRatio);
        const cy = canvas.height / (2 * window.devicePixelRatio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.arc(cx, cy, cx, 0, 2 * Math.PI);
        ctx.fillStyle = '#2a2d35';
        ctx.fill();
    }

    // --- PLAYER LIST RENDERING ---
    function renderPlayerList(total) {
        playersList.innerHTML = '';
        // Sort by bet for the UI list
        const sorted = [...players].sort((a, b) => b.bet - a.bet);

        sorted.forEach(p => {
            const percent = ((p.bet / total) * 100).toFixed(1);
            const div = document.createElement('div');
            div.className = 'player-row';
            div.innerHTML = `
                <div class="player-color" style="background: ${p.color};"></div>
                <div class="player-info">
                    <div class="player-name">${p.name}</div>
                    <div class="player-bet">${p.bet.toFixed(2)} USDT</div>
                </div>
                <div class="player-percent">${percent}%</div>
            `;
            playersList.appendChild(div);
        });
    }

    // --- EVENTS ---
    betBtn.addEventListener('click', () => {
        const val = parseFloat(betInput.value);
        if (isNaN(val) || val < 0.1) return;
        if (val > myBalance) {
            window.Telegram.WebApp.showAlert("Недостаточно баланса!");
            return;
        }

        myBalance -= val;
        updateBalanceUI();
        handleNewBet(val, '@you', '#10b981');
        betInput.value = '';
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    });

    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const cur = parseFloat(betInput.value) || 0;
            betInput.value = (cur + parseFloat(btn.dataset.amount)).toFixed(2);
        });
    });

    clearBtn.addEventListener('click', () => { betInput.value = ''; });

    // --- ROUND LOGIC ---
    function startRound() {
        timerInterval = setInterval(() => {
            if (roundTime > 0) {
                roundTime--;
                const m = Math.floor(roundTime / 60);
                const s = roundTime % 60;
                timerDisplay.textContent = `${m}:${s < 10 ? '0' + s : s}`;
            } else {
                clearInterval(timerInterval);
                clearInterval(botInterval);
                spinWheel();
            }
        }, 1000);

        botInterval = setInterval(spawnBotBet, 4000);
    }

    function spawnBotBet() {
        if (isSpinning) return;
        const bot = botPool[Math.floor(Math.random() * botPool.length)];
        const amount = Math.floor(Math.random() * 10) + 1;
        handleNewBet(amount, bot.name, bot.color);
    }

    function spinWheel() {
        isSpinning = true;
        timerDisplay.textContent = "ROLLING";
        timerDisplay.style.color = "#fbbf24";

        const total = getTotalPot();
        const winningTicket = Math.random() * total;
        let acc = 0;
        let winner = players[0];
        let wStart = 0, wEnd = 0;

        for (let p of players) {
            if (winningTicket >= acc && winningTicket < acc + p.bet) {
                winner = p;
                wStart = (acc / total) * 360;
                wEnd = ((acc + p.bet) / total) * 360;
                break;
            }
            acc += p.bet;
        }

        const winCenter = (wStart + wEnd) / 2;
        const rotation = (360 * 6) + (360 - winCenter) - 90;

        wheelElement.style.transition = "transform 6s cubic-bezier(0.1, 0, 0.1, 1)";
        wheelElement.style.transform = `rotate(${rotation}deg)`;

        setTimeout(() => {
            // Fair payout calculation
            const othersMoney = total - winner.bet;
            const fee = othersMoney * 0.05;
            const payout = total - fee;

            timerDisplay.textContent = "WINNER!";
            timerDisplay.style.color = "#10b981";

            if (winner.name === '@you') {
                myBalance += payout;
                updateBalanceUI();
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                window.Telegram.WebApp.showAlert(`ПОБЕДА! 🎉 Вы выиграли ${payout.toFixed(2)} USDT`);
            } else {
                window.Telegram.WebApp.showAlert(`Выиграл ${winner.name}. Попробуйте еще раз!`);
            }

            setTimeout(() => location.reload(), 4000);
        }, 6500);
    }

    init();
});
