const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const port = process.env.PORT || 8080;

app.use(express.static(path.join(__dirname, './')));


function checkWin(board, row, col, player) {
    const directions = [
        [[0, 1], [0, -1]],
        [[1, 0], [-1, 0]],
        [[1, 1], [-1, -1]],
        [[1, -1], [-1, 1]] 
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


const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);


    let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1);

    if (!roomId) {
        roomId = socket.id;
        rooms[roomId] = {
            players: [socket],
            board: Array(10).fill(0).map(() => Array(10).fill(0)),
            currentTurn: 0 
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'black';
        
        socket.emit('init', { color: 'black', message: 'You`re black. Wait for opponent...' });
    } else {
        const room = rooms[roomId];
        room.players.push(socket);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'white';

        socket.emit('init', { color: 'white', message: 'You`re white, the game begins now!' });

        room.players[0].emit('start', { turn: true, message: 'The game has started! Your turn (Black)' });
        room.players[1].emit('start', { turn: false, message: 'The game has started! Opponents turn (White)' });
    }

    socket.on('move', (data) => {
        const room = rooms[socket.roomId];
        if (!room) return;

        const playerIndex = room.players.indexOf(socket);
        
        if (playerIndex !== room.currentTurn) {
            socket.emit('error_msg', 'Not your turn!');
            return;
        }

        const { row, col } = data;
        if (room.board[row][col] !== 0) {
            socket.emit('error_msg', 'This square is already occupied!');
            return;
        }
        
        const stone = playerIndex === 0 ? 1 : 2;
        room.board[row][col] = stone;


        io.to(socket.roomId).emit('update', { row, col, color: socket.color });


        if (checkWin(room.board, row, col, stone)) {
            const winText = playerIndex === 0 ? 'Black wins!' : 'White wins!';
            io.to(socket.roomId).emit('gameover', winText);
            delete rooms[socket.roomId]; 
            return;
        }

        // Передаем ход следующему (0 - Черные, 1 - Белые)
        room.currentTurn = room.currentTurn === 0 ? 1 : 0;

        // Отправляем ОБОИМ игрокам событие смены хода
        room.players[0].emit('turn_change', { turn: room.currentTurn === 0, msg: room.currentTurn === 0 ? "Your turn (Black)!" : "Opponents turn (White)..." });
        room.players[1].emit('turn_change', { turn: room.currentTurn === 1, msg: room.currentTurn === 1 ? "Your turn (White)!" : "Opponents turn (Black)..." });
    });

    socket.on('update', (data) => {
        const cell = document.querySelector(`[data-row='${data.row}'][data-col='${data.col}']`);
        if (cell) cell.classList.add(data.color); // Добавляет класс 'black' или 'white'
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const room = rooms[socket.roomId];
        
        if (room) {
            io.to(socket.roomId).emit('gameover', 'Opponent left the game. Session restarting...');
            
            room.players.forEach(p => {
                if (p.id !== socket.id) {
                    p.disconnect(true);
                }
            });

            delete rooms[socket.roomId];
        }
    });
    // socket.on('disconnect', () => {
    //     console.log(`User left the game: ${socket.id}`);
    //     const room = rooms[socket.roomId];
    //     if (room) {
    //         io.to(socket.roomId).emit('gameover', 'Opponent disconnected. Session is closed!');
    //         delete rooms[socket.roomId];
    //     }
    // });
});

server.listen(port, () => {
    console.log(`The server Socket.io has been started on ${port}`);
});