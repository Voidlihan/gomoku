const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// Указываем серверу отдавать статические файлы (index.html, картинки) из корневой папки
app.use(express.static(path.join(__dirname, './')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let waitingPlayer = null;
const games = new Map();

// --- Твой алгоритм Гомоку (проверка победы) ---
function checkWin(board, row, col, player) {
    const directions = [
        [[0, 1], [0, -1]],   // Горизонталь
        [[1, 0], [-1, 0]],   // Вертикаль
        [[1, 1], [-1, -1]], // Диагональ ↘
        [[1, -1], [-1, 1]]  // Диагональ ↙
    ];
    for (const dir of directions) {
        let count = 1;
        for (const [dr, dc] of dir) {
            let r = row + dr;
            let c = col + dc;
            while (r >= 0 && r < 10 && c >= 0 && c < 10 && board[r][c] === player) {
                count++;
                r += dr;
                c += dc;
            }
        }
        if (count >= 5) return true;
    }
    return false;
}

// --- Логика подключений через Веб-сокеты ---
wss.on('connection', (ws) => {
    let players = []; // Будем использовать простой массив для надежности теста в облаке
    let board = Array(10).fill(0).map(() => Array(10).fill(0));
    let currentTurn = 0; // 0 - black, 1 - white

    wss.on('connection', (ws) => {
        console.log('Новое подключение к веб-сокету');

        if (players.length >= 2) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Комната полная!' }));
            ws.close();
            return;
        }

        players.push(ws);
        const playerColor = players.length === 1 ? 'black' : 'white';
        
        // СРАЗУ отправляем цвет игроку, чтобы фронтенд отвис!
        ws.send(JSON.stringify({ type: 'INIT', color: playerColor }));

        // Если собралась пара — даем команду старта
        if (players.length === 2) {
            players[0].send(JSON.stringify({ type: 'START', turn: true, message: 'Игра началась! Ваш ход' }));
            players[1].send(JSON.stringify({ type: 'START', turn: false, message: 'Игра началась! Ожидайте хода соперника' }));
        }

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                const playerIndex = players.indexOf(ws);

                if (data.type === 'MOVE') {
                    if (playerIndex !== currentTurn) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Сейчас не ваш ход!' }));
                        return;
                    }

                    const { row, col } = data;
                    if (board[row][col] !== 0) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Клетка занята!' }));
                        return;
                    }

                    const stone = playerIndex === 0 ? 1 : 2;
                    board[row][col] = stone;

                    // Рассылаем ход всем
                    players.forEach(p => {
                        if (p.readyState === ws.OPEN) {
                            p.send(JSON.stringify({ type: 'UPDATE', row, col, color: playerIndex === 0 ? 'black' : 'white' }));
                        }
                    });

                    // Проверка победы
                    if (checkWin(board, row, col, stone)) {
                        players.forEach(p => {
                            p.send(JSON.stringify({ type: 'GAMEOVER', message: playerIndex === 0 ? 'Черные победили!' : 'Белые победили!' }));
                        });
                        // Сброс
                        board = Array(10).fill(0).map(() => Array(10).fill(0));
                        players = [];
                        return;
                    }

                    // Смена хода
                    currentTurn = currentTurn === 0 ? 1 : 0;
                    players[currentTurn].send(JSON.stringify({ type: 'YOUR_TURN' }));
                }
            } catch (e) {
                console.error(e);
            }
        });

        ws.on('close', () => {
            players = players.filter(p => p !== ws);
            board = Array(10).fill(0).map(() => Array(10).fill(0));
            currentTurn = 0;
            players.forEach(p => {
                if (p.readyState === ws.OPEN) {
                    p.send(JSON.stringify({ type: 'GAMEOVER', message: 'Соперник отключился. Игра сброшена.' }));
                }
            });
            players = [];
        });
    });
});

// Запуск сервера
server.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});