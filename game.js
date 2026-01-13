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
    const depositBtn = document.getElementById('fake-deposit');
    const modal = document.getElementById('deposit-modal');
    const closeModal = document.getElementById('close-modal');
    const amountBtns = document.querySelectorAll('.amount-btn');

    let players = [];

    const params = new URLSearchParams(window.location.search);
    const bParam = params.get('balance');
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
        { name: '@crypto_king', color: '#6366f1' },
        { name: '@ton_master', color: '#a855f7' },
        { name: '@lucky_guy', color: '#ec4899' },
        { name: '@whale_🐋', color: '#f43f5e' },
        { name: '@degen_1337', color: '#ef4444' }
    ];

    function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();
        window.Telegram.WebApp.expand();
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
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(150, 150); ctx.arc(150, 150, 150, start, start + slice); ctx.closePath();
            ctx.fillStyle = p.color; ctx.fill();
            ctx.strokeStyle = '#18191c'; ctx.lineWidth = 1; ctx.stroke();
            start += slice;
        });
    }

    function drawEmptyWheel() {
        ctx.clearRect(0, 0, 300, 300); ctx.beginPath(); ctx.arc(150, 150, 150, 0, Math.PI * 2);
        ctx.fillStyle = '#2a2d35'; ctx.fill();
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

    betBtn.addEventListener('click', () => {
        const val = parseFloat(betInput.value);
        if (val >= 0.1 && val <= myBalance) {
            myBalance -= val; updateBalanceUI(); handleNewBet(val, '@you', '#10b981');
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

    // --- DEPOSIT MODAL LOGIC ---
    depositBtn.addEventListener('click', () => { modal.style.display = 'flex'; });
    closeModal.addEventListener('click', () => { modal.style.display = 'none'; });

    amountBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseFloat(btn.dataset.val);
            window.Telegram.WebApp.showConfirm(`ФЕЙК-ОПЛАТА: Вы пополняете на ${val}$ для теста.`, (ok) => {
                if (ok) {
                    myBalance += val;
                    updateBalanceUI();
                    window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                    modal.style.display = 'none';
                }
            });
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

        setTimeout(() => {
            const netWin = (total - winner.bet) * 0.95;
            const payout = winner.bet + netWin;
            timerDisplay.textContent = "WINNER!";
            timerDisplay.style.color = "#10b981";
            window.Telegram.WebApp.showAlert(`ПОБЕДИТЕЛЬ: ${winner.name}\nВыигрыш: ${payout.toFixed(2)} USDT`);
            if (winner.name === '@you') { myBalance += payout; updateBalanceUI(); }
            setTimeout(() => location.reload(), 3000);
        }, 6500);
    }

    init();
});
