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

    let waitingPlayer = null; // Сюда сажаем игрока, который ждет пару

    wss.on('connection', (ws) => {
        console.log('Новое подключение к веб-сокету');

        // Если никто не ждет, текущий игрок становится ожидающим (Черным)
        if (!waitingPlayer) {
            waitingPlayer = ws;
            ws.playerColor = 'black'; // Закрепляем цвет прямо в объекте сокета
            ws.send(JSON.stringify({ type: 'INIT', color: 'black' }));
            console.log('Игрок 1 подключился и ждет (Черные)');
        } 
        // Если кто-то уже ждет, создаем пару!
        else {
            const player1 = waitingPlayer; // Это Черный
            const player2 = ws;            // Это Белый
            waitingPlayer = null;          // Очищаем слот ожидания для следующих игроков

            player2.playerColor = 'white'; // Закрепляем цвет за вторым сокетом
            
            // Связываем их друг с другом, чтобы сокеты знали своих оппонентов
            player1.opponent = player2;
            player2.opponent = player1;

            // Создаем для этой пары чистую матрицу поля 10x10 прямо внутри их сессии
            const gameBoard = Array(10).fill(0).map(() => Array(10).fill(0));
            player1.board = gameBoard;
            player2.board = gameBoard;
            
            // Переменная хода (true - ход этого игрока)
            player1.isTurn = true;  // Черные ходят первыми
            player2.isTurn = false; // Белые ждут

            // Отправляем инициализацию Белому игроку
            player2.send(JSON.stringify({ type: 'INIT', color: 'white' }));

            // Даем команду СТАРТ обоим игрокам
            player1.send(JSON.stringify({ type: 'START', turn: true, message: 'Игра началась! Ваш ход (Черные)' }));
            player2.send(JSON.stringify({ type: 'START', turn: false, message: 'Игра началась! Ход соперника (Белые)' }));
            
            console.log('Игрок 2 подключился. Игра запущена!');
        }

        // Обработка ходов
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                if (data.type === 'MOVE') {
                    // 1. Проверяем, началась ли игра (есть ли оппонент)
                    if (!ws.opponent) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Игра еще не началась, нет соперника!' }));
                        return;
                    }
                    // 2. Проверяем, его ли сейчас ход
                    if (!ws.isTurn) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Сейчас не ваш ход!' }));
                        return;
                    }

                    const { row, col } = data;
                    // 3. Проверяем, свободна ли клетка
                    if (ws.board[row][col] !== 0) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Клетка уже занята!' }));
                        return;
                    }

                    // Записываем ход (1 - черные, 2 - белые)
                    const stoneType = ws.playerColor === 'black' ? 1 : 2;
                    ws.board[row][col] = stoneType;

                    // Отправляем обновление обоим игрокам
                    const updateMessage = JSON.stringify({ type: 'UPDATE', row, col, color: ws.playerColor });
                    ws.send(updateMessage);
                    ws.opponent.send(updateMessage);

                    // Проверяем победу (функция checkWin должна быть объявлена в файле выше)
                    if (checkWin(ws.board, row, col, stoneType)) {
                        const winMsg = ws.playerColor === 'black' ? 'Черные победили!' : 'Белые победили!';
                        ws.send(JSON.stringify({ type: 'GAMEOVER', message: `Вы победили! ${winMsg}` }));
                        ws.opponent.send(JSON.stringify({ type: 'GAMEOVER', message: `Вы проиграли! ${winMsg}` }));
                        
                        // Разрываем связи игры
                        if(ws.opponent) ws.opponent.opponent = null;
                        ws.opponent = null;
                        return;
                    }

                    // Переключаем ход
                    ws.isTurn = false;
                    ws.opponent.isTurn = true;

                    // Говорим оппоненту, что теперь его ход
                    ws.opponent.send(JSON.stringify({ type: 'YOUR_TURN' }));
                }
            } catch (e) {
                console.error('Ошибка сообщения:', e);
            }
        });

        // Обработка отключения
        ws.on('close', () => {
            console.log(`Игрок (${ws.playerColor || 'Без цвета'}) отключился`);
            
            if (waitingPlayer === ws) {
                waitingPlayer = null;
            }

            if (ws.opponent) {
                ws.opponent.send(JSON.stringify({ type: 'GAMEOVER', message: 'Соперник покинул игру. Сессия закрыта.' }));
                ws.opponent.opponent = null;
            }
        });
    });
});

// Запуск сервера
server.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});