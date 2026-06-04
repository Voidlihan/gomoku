const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const port = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, './')));

function checkWin(board, row, col, player) {
    const directions = [
        [[0, 1], [0, -1]],   // Horizontal
        [[1, 0], [-1, 0]],   // Vertical
        [[1, 1], [-1, -1]], // Diagonal ↘
        [[1, -1], [-1, 1]]  // Diagonal ↙
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
const activeTimers = {};

function resetRoomTimer(roomId) {
    if (activeTimers[roomId]) {
        clearTimeout(activeTimers[roomId]);
    }

    const expiresAt = Date.now() + 60000;

    activeTimers[roomId] = setTimeout(() => {
        const room = rooms[roomId];
        if (!room) return;

        const losingPlayerIndex = room.currentTurn;
        const winningPlayerIndex = losingPlayerIndex === 0 ? 1 : 0;

        const loserName = room.players[losingPlayerIndex].username;
        const winnerName = room.players[winningPlayerIndex].username;

        io.to(roomId).emit('gameover', `Game Over! ${loserName} ran out of time. ${winnerName} wins!`);

        room.players.forEach(p => p.disconnect(true));

        delete rooms[roomId];
        delete activeTimers[roomId];
    }, 60000);

    return expiresAt;
}

io.use((socket, next) => {
    const username = socket.handshake.auth.username;
    if (!username || username.trim() === "") {
        return next(new Error("Authentication failed: Username is required"));
    }
    socket.username = username.trim();
    next();
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.username} (${socket.id})`);

    socket.on('ping_sync', (clientTimestamp) => {
        socket.emit('pong_sync', {
            clientTimestamp: clientTimestamp,
            serverTimestamp: Date.now()
        });
    });

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
        
        socket.emit('init', { color: 'black', message: `Welcome ${socket.username}! You are BLACK. Waiting for an opponent...` });
    } else {
        const room = rooms[roomId];
        room.players.push(socket);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'white';

        socket.emit('init', { color: 'white', message: `Welcome ${socket.username}! You are WHITE. Match is starting!` });

        const expiresAt = resetRoomTimer(roomId);

        const p1 = room.players[0];
        const p2 = room.players[1];

        p1.emit('start', { turn: true, expiresAt, message: `Game started! Your turn, ${p1.username} (Black). Opponent: ${p2.username}` });
        p2.emit('start', { turn: false, expiresAt, message: `Game started! ${p1.username}'s turn (Black). You are White.` });
    }

    socket.on('move', (data) => {
        const room = rooms[socket.roomId];
        if (!room) return;

        const playerIndex = room.players.indexOf(socket);
        
        if (playerIndex !== room.currentTurn) {
            socket.emit('error_msg', 'It is not your turn!');
            return;
        }

        const { row, col } = data;
        if (room.board[row][col] !== 0) {
            socket.emit('error_msg', 'This cell is already occupied!');
            return;
        }

        const stone = playerIndex === 0 ? 1 : 2;
        room.board[row][col] = stone;

        io.to(socket.roomId).emit('update', { row, col, color: socket.color });

        if (checkWin(room.board, row, col, stone)) {
            io.to(socket.roomId).emit('gameover', `Match over! ${socket.username} wins the game!`);
            if (activeTimers[socket.roomId]) clearTimeout(activeTimers[socket.roomId]);
            room.players.forEach(p => p.disconnect(true));
            delete rooms[socket.roomId];
            return;
        }

        room.currentTurn = room.currentTurn === 0 ? 1 : 0;
        const expiresAt = resetRoomTimer(socket.roomId);

        const nextPlayer = room.players[room.currentTurn];

        room.players[0].emit('turn_change', { turn: room.currentTurn === 0, expiresAt, msg: room.currentTurn === 0 ? "Your turn!" : `${nextPlayer.username}'s turn...` });
        room.players[1].emit('turn_change', { turn: room.currentTurn === 1, expiresAt, msg: room.currentTurn === 1 ? "Your turn!" : `${nextPlayer.username}'s turn...` });
    });

    socket.on('disconnect', () => {
        console.log(`User left the game: ${socket.username}`);
        const room = rooms[socket.roomId];
        
        if (room) {
            io.to(socket.roomId).emit('gameover', `Game over! ${socket.username} left the match. Session closing...`);
            if (activeTimers[socket.roomId]) clearTimeout(activeTimers[socket.roomId]);
            
            room.players.forEach(p => {
                if (p.id !== socket.id) {
                    p.disconnect(true);
                }
            });

            delete rooms[socket.roomId];
        }
    });
});

server.listen(port, () => {
    console.log(`The server Socket.io has been started on ${port}`);
});