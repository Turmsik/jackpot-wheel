document.addEventListener('DOMContentLoaded', () => {
    const log = (msg) => {
        const div = document.getElementById('debug-log');
        if (div) div.innerHTML += `<div>> ${msg}</div>`;
        console.log(msg);
    };

    log("Запуск скрипта V4...");

    const canvas = document.getElementById('wheel-canvas');
    const ctx = canvas.getContext('2d');
    const potDisplay = document.getElementById('pot-amount');
    const timerDisplay = document.getElementById('timer');
    const playersList = document.getElementById('players-list');
    const wheelElement = document.getElementById('wheel-canvas');
    const betInput = document.getElementById('custom-bet-input');
    const betBtn = document.getElementById('place-custom-bet');
    const userBalanceDisplay = document.getElementById('user-balance');
    const forceBotBtn = document.getElementById('force-bots');

    let players = [];
    let myBalance = 100.00;
    let roundTime = 120;
    let isSpinning = false;
    let botInterval = null;

    const botNames = ['@whale', '@pro', '@king', '@luck', '@ton'];
    const botColors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#ef4444'];

    function init() {
        resizeCanvas();
        updateBalanceUI();
        log("Инициализация готова.");
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.expand();
        }
    }

    function spawnBotBet() {
        if (isSpinning) return;
        const name = botNames[Math.floor(Math.random() * botNames.length)];
        const amount = Math.floor(Math.random() * 10) + 1;

        const pIdx = players.findIndex(p => p.name === name);
        if (pIdx >= 0) players[pIdx].bet += amount;
        else players.push({ name, bet: amount, color: botColors[players.length % botColors.length] });

        log(`Бот ${name} поставил ${amount}`);
        updateGameState();
    }

    forceBotBtn.addEventListener('click', () => {
        log("Вызов ботов вручную...");
        if (!botInterval) {
            botInterval = setInterval(spawnBotBet, 2000);
            startTimer();
            log("Боты активированы!");
        }
    });

    betBtn.addEventListener('click', () => {
        const val = parseFloat(betInput.value);
        if (isNaN(val) || val < 0.1) return;
        myBalance -= val;
        updateBalanceUI();
        players.push({ name: '@you', bet: val, color: '#10b981' });
        log(`Вы поставили ${val}`);
        updateGameState();
        if (!botInterval) {
            botInterval = setInterval(spawnBotBet, 2000);
            startTimer();
        }
    });

    function updateBalanceUI() { userBalanceDisplay.textContent = myBalance.toFixed(2); }
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = 300 * dpr;
        canvas.height = 300 * dpr;
        ctx.scale(dpr, dpr);
    }
    function updateGameState() {
        const total = players.reduce((s, p) => s + p.bet, 0);
        potDisplay.textContent = total.toFixed(2);
        drawWheel(total);
        playersList.innerHTML = players.map(p => `
            <div style="display:flex; gap:10px; padding:5px; border-bottom:1px solid #222">
                <div style="width:10px; height:10px; background:${p.color}"></div>
                <div>${p.name}: ${p.bet}$</div>
            </div>
        `).join('');
    }

    function drawWheel(total) {
        ctx.clearRect(0, 0, 300, 300);
        let start = 0;
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(150, 150); ctx.arc(150, 150, 150, start, start + slice);
            ctx.fillStyle = p.color; ctx.fill();
            start += slice;
        });
    }

    function startTimer() {
        setInterval(() => {
            if (roundTime > 0) {
                roundTime--;
                timerDisplay.textContent = roundTime;
            } else { location.reload(); }
        }, 1000);
    }

    init();
});
