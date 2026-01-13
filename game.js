document.addEventListener('DOMContentLoaded', () => {
    // Canvas & Context
    const canvas = document.getElementById('wheel-canvas');
    const ctx = canvas.getContext('2d');

    // UI Elements
    const potDisplay = document.getElementById('pot-amount');
    const timerDisplay = document.getElementById('timer');
    const playersList = document.getElementById('players-list');
    const wheelElement = document.getElementById('wheel-canvas');
    const betInput = document.getElementById('custom-bet-input');
    const betBtn = document.getElementById('place-custom-bet');
    const quickBtns = document.querySelectorAll('.quick-btn');
    const clearBtn = document.getElementById('clear-input');
    const userBalanceDisplay = document.getElementById('user-balance');

    // Game State
    let players = [];
    let myBalance = 100.00;
    let roundTime = 120;
    let isSpinning = false;
    let timerStarted = false;
    let timerInterval = null;

    // --- BOTS CONFIGURATION ---
    const botNames = [
        '@crypto_king', '@ton_master', '@lucky_guy', '@whale_🐋',
        '@degen_1337', '@usdt_miner', '@jackpot_hunter', '@moon_boi',
        '@diamond_hands', '@hustler_tg'
    ];
    const botColors = [
        '#6366f1', '#a855f7', '#ec4899', '#f43f5e',
        '#ef4444', '#f97316', '#eab308', '#22c55e',
        '#06b6d4', '#3b82f6'
    ];

    // --- INITIALIZATION ---
    function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();
        window.Telegram.WebApp.expand();
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

    // --- CORE LOGIC ---
    function getTotalPot() {
        return players.reduce((sum, p) => sum + p.bet, 0);
    }

    function updateGameState() {
        const total = getTotalPot();
        potDisplay.textContent = total.toFixed(2);

        if (total > 0) {
            drawWheel(total);
            updateFeed(total);
        } else {
            playersList.innerHTML = '<div class="empty-state" style="text-align:center; padding:20px; color:#4b5563; font-size:12px;">Ожидание первой ставки...</div>';
            drawEmptyWheel();
        }
    }

    function drawEmptyWheel() {
        const centerX = canvas.width / (2 * window.devicePixelRatio);
        const centerY = canvas.height / (2 * window.devicePixelRatio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.arc(centerX, centerY, centerX, 0, 2 * Math.PI);
        ctx.fillStyle = '#2a2d35';
        ctx.fill();
        ctx.strokeStyle = '#18191c';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function drawWheel(total) {
        const centerX = canvas.width / (2 * window.devicePixelRatio);
        const centerY = canvas.height / (2 * window.devicePixelRatio);
        const radius = centerX;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let startAngle = 0;

        players.forEach(player => {
            const sliceAngle = (player.bet / total) * 2 * Math.PI;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();
            ctx.fillStyle = player.color;
            ctx.fill();
            ctx.strokeStyle = '#18191c';
            ctx.lineWidth = 2;
            ctx.stroke();
            startAngle += sliceAngle;
        });
    }

    function updateFeed(total) {
        playersList.innerHTML = '';
        const sortedPlayers = [...players].sort((a, b) => b.bet - a.bet);

        sortedPlayers.forEach(player => {
            const percent = ((player.bet / total) * 100).toFixed(1);
            const div = document.createElement('div');
            div.className = 'player-row';
            div.innerHTML = `
                <div class="player-color" style="background: ${player.color};"></div>
                <div class="player-info">
                    <div class="player-name">${player.name}</div>
                    <div class="player-bet">${player.bet.toFixed(2)} USDT</div>
                </div>
                <div class="player-percent">${percent}%</div>
            `;
            playersList.appendChild(div);
        });
    }

    // --- BOT SYSTEM ---
    function spawnBotBet() {
        if (isSpinning || !timerStarted) return;

        // Randomly skip a beat for natural feel
        if (Math.random() > 0.4) return;

        const botIdx = Math.floor(Math.random() * botNames.length);
        const name = botNames[botIdx];
        const color = botColors[botIdx];
        const amount = (Math.random() * 10 + 0.5); // Random bet 0.5 - 10.5

        const pIdx = players.findIndex(p => p.name === name);
        if (pIdx >= 0) {
            players[pIdx].bet += amount;
        } else {
            players.push({ name, bet: amount, color });
        }

        updateGameState();
    }

    // --- INTERACTION ---
    betBtn.addEventListener('click', () => {
        const val = parseFloat(betInput.value);
        if (isNaN(val) || val < 0.1) {
            window.Telegram.WebApp.showAlert("Min 0.1 USDT");
            return;
        }
        if (val > myBalance) {
            window.Telegram.WebApp.showAlert("Мало денег!");
            return;
        }

        placeBet(val);
        betInput.value = '';
    });

    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const cur = parseFloat(betInput.value) || 0;
            betInput.value = (cur + parseFloat(btn.dataset.amount)).toFixed(2);
        });
    });

    clearBtn.addEventListener('click', () => {
        betInput.value = '';
    });

    function placeBet(amount) {
        if (isSpinning) return;

        myBalance -= amount;
        updateBalanceUI();

        const myIndex = players.findIndex(p => p.name === '@you');
        if (myIndex >= 0) {
            players[myIndex].bet += amount;
        } else {
            players.push({ name: '@you', bet: amount, color: '#10b981' });
        }

        if (!timerStarted) {
            startTimer();
            timerStarted = true;
            // Bot simulation starts
            setInterval(spawnBotBet, 3000);
        }

        updateGameState();
        window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
    }

    function startTimer() {
        timerInterval = setInterval(() => {
            if (roundTime > 0) {
                roundTime--;
                const m = Math.floor(roundTime / 60);
                const s = roundTime % 60;
                timerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            } else {
                clearInterval(timerInterval);
                spinWheel();
            }
        }, 1000);
    }

    function spinWheel() {
        isSpinning = true;
        timerDisplay.textContent = "ROLLING";
        timerDisplay.style.color = "#fbbf24";

        const total = getTotalPot();
        const winningTicket = Math.random() * total;

        let acc = 0;
        let winner = players[0];
        let wStart = 0;
        let wEnd = 0;

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
        const targetRot = (360 * 5) + (360 - winCenter) - 90;

        wheelElement.style.transition = "transform 6s cubic-bezier(0.1, 0, 0.1, 1)";
        wheelElement.style.transform = `rotate(${targetRot}deg)`;

        setTimeout(() => {
            const othersMoney = total - winner.bet;
            const houseFee = othersMoney * 0.05;
            const netWin = othersMoney - houseFee;
            const finalPayout = winner.bet + netWin;

            timerDisplay.textContent = "WINNER!";
            timerDisplay.style.color = "#10b981";

            if (winner.name === '@you') {
                myBalance += finalPayout;
                updateBalanceUI();
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                window.Telegram.WebApp.showAlert(`ВЫ ВЫИГРАЛИ! 🎉 +${finalPayout.toFixed(2)} USDT`);
            } else {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
                window.Telegram.WebApp.showAlert(`Выиграл ${winner.name}. Повезет в следующий раз!`);
            }

            setTimeout(resetGame, 5000);
        }, 6500);
    }

    function resetGame() {
        players = [];
        roundTime = 120;
        isSpinning = false;
        timerStarted = false;
        wheelElement.style.transition = "none";
        wheelElement.style.transform = "rotate(-90deg)";
        timerDisplay.textContent = "--:--";
        timerDisplay.style.color = "#fff";
        updateGameState();
    }

    init();
});
