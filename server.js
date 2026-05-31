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
    console.log('Новый игрок подключился');

    if (!waitingPlayer) {
        waitingPlayer = ws;
        ws.send(JSON.stringify({ type: 'WAITING', message: 'Ожидание соперника...' }));
    } else {
        const player1 = waitingPlayer;
        const player2 = ws;
        waitingPlayer = null;

        const gameId = Date.now().toString();
        const gameState = {
            id: gameId,
            players: [player1, player2],
            board: Array(10).fill(0).map(() => Array(10).fill(0)),
            turn: 0 // 0 - Черные (Player 1), 1 - Белые (Player 2)
        };

        games.set(player1, gameState);
        games.set(player2, gameState);

        player1.send(JSON.stringify({ type: 'START', color: 'black', turn: true, message: 'Игра началась! Ваш ход (Черные)' }));
        player2.send(JSON.stringify({ type: 'START', color: 'white', turn: false, message: 'Игра началась! Ход соперника (Белые)' }));
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const game = games.get(ws);

            if (!game && data.type === 'MOVE') return;

            if (data.type === 'MOVE') {
                const playerIndex = game.players.indexOf(ws);
                if (playerIndex !== game.turn) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Сейчас не ваш ход!' }));
                    return;
                }

                const { row, col } = data;
                if (game.board[row][col] !== 0) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Клетка уже занята!' }));
                    return;
                }

                const playerColor = playerIndex === 0 ? 1 : 2;
                game.board[row][col] = playerColor;

                // Рассылаем обновление обоим игрокам
                game.players.forEach((p) => {
                    p.send(JSON.stringify({ type: 'UPDATE', row, col, color: playerIndex === 0 ? 'black' : 'white' }));
                });

                // Проверяем победу
                if (checkWin(game.board, row, col, playerColor)) {
                    game.players.forEach((p) => {
                        p.send(JSON.stringify({ type: 'GAMEOVER', winner: playerIndex === 0 ? 'black' : 'white', message: playerIndex === 0 ? 'Черные победили!' : 'Белые победили!' }));
                    });
                    games.delete(game.players[0]);
                    games.delete(game.players[1]);
                    return;
                }

                // Передаем ход
                game.turn = game.turn === 0 ? 1 : 0;
                game.players[game.turn].send(JSON.stringify({ type: 'YOUR_TURN' }));
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });

    ws.on('close', () => {
        console.log('Игрок отключился');
        if (waitingPlayer === ws) waitingPlayer = null;
        
        const game = games.get(ws);
        if (game) {
            game.players.forEach((p) => {
                if (p !== ws && p.readyState === ws.OPEN) {
                    p.send(JSON.stringify({ type: 'GAMEOVER', message: 'Соперник покинул игру. Вы победили!' }));
                }
                games.delete(p);
            });
        }
    });
});

// Запуск сервера
server.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});