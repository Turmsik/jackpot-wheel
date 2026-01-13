document.addEventListener('DOMContentLoaded', () => {
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

    let players = [];
    let myBalance = 100.00;
    let roundTime = 120;
    let isSpinning = false;
    let timerStarted = false;
    let timerInterval = null;
    let botInterval = null;

    const botNames = ['@crypto_king', '@ton_master', '@lucky_guy', '@whale_🐋', '@degen_1337', '@usdt_miner', '@jackpot_hunter'];
    const botColors = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#eab308'];

    function init() {
        resizeCanvas();
        updateBalanceUI();
        updateGameState();
        window.Telegram.WebApp.expand();

        // AUTO-START BOTS FOR TESTING !!!
        console.log("FORCE STARTING BOTS...");
        timerStarted = true;
        startTimer();
        botInterval = setInterval(spawnBotBet, 1500); // Very fast for testing
    }

    function spawnBotBet() {
        if (isSpinning) return;
        const botIdx = Math.floor(Math.random() * botNames.length);
        const name = botNames[botIdx];
        const color = botColors[botIdx];
        const amount = (Math.random() * 5 + 1);
        const pIdx = players.findIndex(p => p.name === name);
        if (pIdx >= 0) players[pIdx].bet += amount;
        else players.push({ name, bet: amount, color });
        updateGameState();
    }

    function updateBalanceUI() { userBalanceDisplay.textContent = myBalance.toFixed(2); }

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    }

    function getTotalPot() { return players.reduce((sum, p) => sum + p.bet, 0); }

    function updateGameState() {
        const total = getTotalPot();
        potDisplay.textContent = total.toFixed(2);
        if (total > 0) { drawWheel(total); updateFeed(total); }
        else { drawEmptyWheel(); }
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

    function drawWheel(total) {
        const cx = canvas.width / (2 * window.devicePixelRatio);
        const cy = canvas.height / (2 * window.devicePixelRatio);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let start = 0;
        players.forEach(p => {
            const slice = (p.bet / total) * 2 * Math.PI;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, cx, start, start + slice); ctx.closePath();
            ctx.fillStyle = p.color; ctx.fill();
            ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.stroke();
            start += slice;
        });
    }

    function updateFeed(total) {
        playersList.innerHTML = '';
        [...players].sort((a, b) => b.bet - a.bet).forEach(p => {
            const div = document.createElement('div');
            div.className = 'player-row';
            div.innerHTML = `<div class="player-color" style="background:${p.color}"></div><div class="player-info"><div>${p.name}</div><div>${p.bet.toFixed(2)} USDT</div></div>`;
            playersList.appendChild(div);
        });
    }

    betBtn.addEventListener('click', () => {
        const val = parseFloat(betInput.value);
        if (isNaN(val) || val < 0.1 || val > myBalance) return;
        myBalance -= val; updateBalanceUI();
        const myIndex = players.findIndex(p => p.name === '@you');
        if (myIndex >= 0) players[myIndex].bet += val;
        else players.push({ name: '@you', bet: val, color: '#10b981' });
        updateGameState();
    });

    function startTimer() {
        timerInterval = setInterval(() => {
            if (roundTime > 0) {
                roundTime--;
                const m = Math.floor(roundTime / 60);
                const s = roundTime % 60;
                timerDisplay.textContent = `${m}:${s < 10 ? '0' + s : s}`;
            } else {
                clearInterval(timerInterval); clearInterval(botInterval);
                spinWheel();
            }
        }, 1000);
    }

    function spinWheel() {
        isSpinning = true;
        const total = getTotalPot();
        const winTicket = Math.random() * total;
        let acc = 0; let winner = players[0];
        players.forEach(p => { if (winTicket >= acc && winTicket < acc + p.bet) winner = p; acc += p.bet; });
        wheelElement.style.transition = "transform 5s cubic-bezier(0.1, 0, 0.1, 1)";
        wheelElement.style.transform = `rotate(${360 * 5 + Math.random() * 360}deg)`;
        setTimeout(() => {
            if (winner.name === '@you') { myBalance += total; updateBalanceUI(); }
            window.Telegram.WebApp.showAlert(`Winner: ${winner.name}`);
            setTimeout(() => location.reload(), 3000);
        }, 5500);
    }

    init();
});
