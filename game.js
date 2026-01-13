document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const canvas = document.getElementById('wheel-canvas');
    const ctx = canvas.getContext('2d');
    const potDisplay = document.getElementById('pot-amount');
    const timerDisplay = document.getElementById('timer');
    const playersList = document.getElementById('players-list');
    const wheelWrapper = document.getElementById('wheel-spin-wrapper');
    const betInput = document.getElementById('custom-bet-input');
    const betBtn = document.getElementById('place-custom-bet');
    const quickBtns = document.querySelectorAll('.quick-btn');
    const clearBtn = document.getElementById('clear-input');
    const userBalanceDisplay = document.getElementById('user-balance');

    // --- GAME STATE ---
    let players = [];
    let myBalance = 100.00;
    let roundTime = 30; // Shortened for better testing experience!
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
        console.log("GAME V5.1: READY");
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

    function handleNewBet(amount, name, color) {
        if (isSpinning) return;

        const pIdx = players.findIndex(p => p.name.trim() === name.trim());
        if (pIdx >= 0) {
            players[pIdx].bet += amount;
        } else {
            players.push({ name: name.trim(), bet: amount, color: color });
        }

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
            playersList.innerHTML = '<div class="empty-state">Ожидание...</div>';
        }
    }

    function drawWheel(total) {
        const cx = canvas.width / (2 * window.devicePixelRatio);
        const cy = canvas.height / (2 * window.devicePixelRatio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let start = 0;
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, cx, start, start + slice); ctx.closePath();
            ctx.fillStyle = p.color; ctx.fill();
            ctx.strokeStyle = '#18191c'; ctx.lineWidth = 1; ctx.stroke();
            start += slice;
        });
    }

    function drawEmptyWheel() {
        const cx = canvas.width / (2 * window.devicePixelRatio);
        const cy = canvas.height / (2 * window.devicePixelRatio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath(); ctx.arc(cx, cy, cx, 0, 2 * Math.PI);
        ctx.fillStyle = '#2a2d35'; ctx.fill();
    }

    function renderPlayerList(total) {
        playersList.innerHTML = '';
        [...players].sort((a, b) => b.bet - a.bet).forEach(p => {
            const pct = ((p.bet / total) * 100).toFixed(1);
            const div = document.createElement('div');
            div.className = 'player-row';
            div.innerHTML = `<div class="player-color" style="background:${p.color}"></div><div class="player-info"><div class="player-name">${p.name}</div><div class="player-bet">${p.bet.toFixed(2)} USDT</div></div><div class="player-percent">${pct}%</div>`;
            playersList.appendChild(div);
        });
    }

    betBtn.addEventListener('click', () => {
        const val = parseFloat(betInput.value);
        if (isNaN(val) || val < 0.1 || val > myBalance) return;
        myBalance -= val; updateBalanceUI();
        handleNewBet(val, '@you', '#10b981');
        betInput.value = '';
    });

    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const cur = parseFloat(betInput.value) || 0;
            betInput.value = (cur + parseFloat(btn.dataset.amount)).toFixed(2);
        });
    });

    clearBtn.addEventListener('click', () => { betInput.value = ''; });

    function startRound() {
        timerInterval = setInterval(() => {
            if (roundTime > 0) {
                roundTime--;
                timerDisplay.textContent = `0:${roundTime < 10 ? '0' + roundTime : roundTime}`;
            } else {
                clearInterval(timerInterval);
                clearInterval(botInterval);
                spinWheel();
            }
        }, 1000);
        botInterval = setInterval(spawnBotBet, 3000);
    }

    function spawnBotBet() {
        if (isSpinning) return;
        const bot = botPool[Math.floor(Math.random() * botPool.length)];
        handleNewBet(Math.floor(Math.random() * 10) + 1, bot.name, bot.color);
    }

    function spinWheel() {
        isSpinning = true;
        timerDisplay.textContent = "ROLLING";
        timerDisplay.style.color = "#fbbf24";

        const total = getTotalPot();
        const winTicket = Math.random() * total;
        let acc = 0, winner = players[0], wStart = 0, wEnd = 0;

        for (let p of players) {
            if (winTicket >= acc && winTicket < acc + p.bet) {
                winner = p; wStart = (acc / total) * 360; wEnd = ((acc + p.bet) / total) * 360; break;
            }
            acc += p.bet;
        }

        const winCenter = (wStart + wEnd) / 2;
        const rotation = (360 * 6) + (360 - winCenter); // Removed the -90 correction as wrapper is already at -90

        console.log(`Spinning to winner: ${winner.name}, rotation: ${rotation}`);

        // Force Reflow
        wheelWrapper.style.transition = "none";
        wheelWrapper.style.transform = "rotate(-90deg)";
        void wheelWrapper.offsetWidth;

        wheelWrapper.style.transition = "transform 6s cubic-bezier(0.1, 0, 0.1, 1)";
        wheelWrapper.style.transform = `rotate(${rotation - 90}deg)`;

        setTimeout(() => {
            const netWin = (total - winner.bet) * 0.95;
            const payout = winner.bet + netWin;
            timerDisplay.textContent = "WINNER!";
            timerDisplay.style.color = "#10b981";
            window.Telegram.WebApp.showAlert(`ПОБЕДИТЕЛЬ: ${winner.name}\nВыигрыш: ${payout.toFixed(2)} USDT`);
            if (winner.name === '@you') { myBalance += payout; updateBalanceUI(); }
            setTimeout(() => location.reload(), 4000);
        }, 6500);
    }

    init();
});
