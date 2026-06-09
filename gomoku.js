let socket = null;
let myColor = null;
let isMyTurn = false;
let countdownInterval = null;
let timeLeft = 60;
let clockOffset = 0; 

const statusDiv = document.getElementById('status');
const timerDiv = document.getElementById('timer');
const boardDiv = document.getElementById('board');
const authOverlay = document.getElementById('auth-overlay');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');

for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.addEventListener('click', makeMove);
        boardDiv.appendChild(cell);
    }
}

joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) {
        alert("Name cannot be empty!");
        return;
    }
    
    authOverlay.style.display = 'none';
    statusDiv.innerText = "Connecting to server cluster...";

    socket = io({
        auth: { username: name }
    });

    setupSocketListeners();
});

function setupSocketListeners() {
    socket.on('connect', () => {
        socket.emit('ping_sync', Date.now());
    });

    socket.on('pong_sync', (data) => {
        const now = Date.now();
        const rtt = now - data.clientTimestamp;
        const estimatedServerTime = data.serverTimestamp + (rtt / 2);
        clockOffset = estimatedServerTime - now;
        console.log(`Clock sync done. Offset: ${clockOffset}ms, RTT: ${rtt}ms`);
    });

    socket.on('init', (data) => {
        myColor = data.color;
        statusDiv.innerText = data.message;
    });

    socket.on('start', (data) => {
        isMyTurn = data.turn;
        statusDiv.innerText = data.message;
        startVisualTimer(data.expiresAt);
    });

    socket.on('update', (data) => {
        const cell = document.querySelector(`[data-row='${data.row}'][data-col='${data.col}']`);
        if (cell) cell.classList.add(data.color);
    });

    socket.on('turn_change', (data) => {
        isMyTurn = data.turn;
        statusDiv.innerText = data.msg;
        startVisualTimer(data.expiresAt);
    });

    socket.on('error_msg', (msg) => {
        alert(msg);
    });

    socket.on('gameover', (msg) => {
        clearInterval(countdownInterval);
        alert(msg);
        location.reload();
    });
}

function startVisualTimer(expiresAt) {
    clearInterval(countdownInterval);

    function updateDisplay() {
        const now = Date.now();
        const calibratedLocalTime = now + clockOffset;
        timeLeft = Math.ceil((expiresAt - calibratedLocalTime) / 1000);

        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            timerDiv.innerText = "Time's up!";
        } else {
            timerDiv.innerText = `Time: ${timeLeft}s`;
            if (timeLeft <= 15) {
                timerDiv.style.color = "#c0392b";
            } else {
                timerDiv.style.color = "#e74c3c";
            }
        }
    }

    updateDisplay();
    countdownInterval = setInterval(updateDisplay, 1000);
}

function makeMove(e) {
    if (!socket || !isMyTurn) {
        alert("It is not your turn yet!");
        return;
    }
    const row = e.target.dataset.row;
    const col = e.target.dataset.col;

    socket.emit('move', {
        row: parseInt(row),
        col: parseInt(col)
    });
}