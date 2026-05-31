const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // Разрешаем подключения с любых устройств
});

const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, './')));

// --- Функция проверки победы (Гомоку) ---
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

// Хранилище активных комнат
const rooms = {};

io.on('connection', (socket) => {
    console.log(`Подключился пользователь: ${socket.id}`);

    // Ищем свободную комнату, где ждет один игрок
    let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1);

    if (!roomId) {
        // Создаем новую комнату, если все заняты
        roomId = socket.id;
        rooms[roomId] = {
            players: [socket],
            board: Array(10).fill(0).map(() => Array(10).fill(0)),
            currentTurn: 0 // 0 - Черные, 1 - Белые
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'black';
        
        socket.emit('init', { color: 'black', message: 'Вы Черные. Ожидание соперника...' });
    } else {
        // Добавляем второго игрока в найденную комнату
        const room = rooms[roomId];
        room.players.push(socket);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'white';

        socket.emit('init', { color: 'white', message: 'Вы Белые. Игра начинается!' });

        // Запускаем игру для ОБОИХ игроков в этой комнате
        room.players[0].emit('start', { turn: true, message: 'Игра началась! Ваш ход (Черные)' });
        room.players[1].emit('start', { turn: false, message: 'Игра началась! Ход соперника (Белые)' });
    }

    // Обработка хода игрока
    socket.on('move', (data) => {
        const room = rooms[socket.roomId];
        if (!room) return;

        const playerIndex = room.players.indexOf(socket);
        
        // Валидация: твой ли ход?
        if (playerIndex !== room.currentTurn) {
            socket.emit('error_msg', 'Сейчас не ваш ход!');
            return;
        }

        const { row, col } = data;
        if (room.board[row][col] !== 0) {
            socket.emit('error_msg', 'Клетка уже занята!');
            return;
        }

        // Записываем ход (1 - черные, 2 - белые)
        const stone = playerIndex === 0 ? 1 : 2;
        room.board[row][col] = stone;

        // Отправляем обновление ВСЕМ в комнате
        io.to(socket.roomId).emit('update', { row, col, color: socket.color });

        // Проверяем победу
        if (checkWin(room.board, row, col, stone)) {
            const winText = playerIndex === 0 ? 'Черные победили!' : 'Белые победили!';
            io.to(socket.roomId).emit('gameover', winText);
            delete rooms[socket.roomId]; // Удаляем комнату после игры
            return;
        }

        // Передаем ход следующему
        room.currentTurn = room.currentTurn === 0 ? 1 : 0;
        room.players[room.currentTurn].emit('your_turn');
    });

    // Обработка отключения
    socket.on('disconnect', () => {
        console.log(`Пользователь отключился: ${socket.id}`);
        const room = rooms[socket.roomId];
        if (room) {
            io.to(socket.roomId).emit('gameover', 'Соперник покинул игру. Сессия закрыта.');
            delete rooms[socket.roomId];
        }
    });
});

server.listen(port, () => {
    console.log(`Сервер Socket.io запущен на порту ${port}`);
});