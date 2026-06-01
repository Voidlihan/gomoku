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
const activeTimers = {}; // Storage for server-side turn timeouts

// Function to handle turn timeouts on the server
function resetRoomTimer(roomId) {
    // Clear previous timer if it exists
    if (activeTimers[roomId]) {
        clearTimeout(activeTimers[roomId]);
    }

    // Start a strict 60-second countdown
    activeTimers[roomId] = setTimeout(() => {
        const room = rooms[roomId];
        if (!room) return;

        // The player whose turn it currently is loses due to timeout
        const losingPlayerIndex = room.currentTurn;
        const winningPlayerIndex = losingPlayerIndex === 0 ? 1 : 0;

        const loserColor = losingPlayerIndex === 0 ? 'Black' : 'White';
        const winnerColor = winningPlayerIndex === 0 ? 'Black' : 'White';

        // Broadcast timeout gameover message
        io.to(roomId).emit('gameover', `Game Over! ${loserColor} ran out of time. ${winnerColor} wins!`);

        // Disconnect remaining sockets to clean up the queue
        room.players.forEach(p => p.disconnect(true));

        // Clean up memory
        delete rooms[roomId];
        delete activeTimers[roomId];
    }, 60000); // 60 seconds
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1);

    if (!roomId) {
        roomId = socket.id;
        rooms[roomId] = {
            players: [socket],
            board: Array(10).fill(0).map(() => Array(10).fill(0)),
            currentTurn: 0 // 0 - Black, 1 - White
        };
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'black';
        
        socket.emit('init', { color: 'black', message: 'You are BLACK. Waiting for an opponent...' });
    } else {
        const room = rooms[roomId];
        room.players.push(socket);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.color = 'white';

        socket.emit('init', { color: 'white', message: 'You are WHITE. Match is starting!' });

        // Trigger initial match start
        room.players[0].emit('start', { turn: true, message: 'Game started! Your turn (Black)' });
        room.players[1].emit('start', { turn: false, message: 'Game started! Opponent\'s turn (Black)' });
        
        // Start the authoritative server timer for the first turn
        resetRoomTimer(roomId);
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
            const winText = playerIndex === 0 ? 'Black wins the game!' : 'White wins the game!';
            io.to(socket.roomId).emit('gameover', winText);
            if (activeTimers[socket.roomId]) clearTimeout(activeTimers[socket.roomId]);
            room.players.forEach(p => p.disconnect(true));
            delete rooms[socket.roomId];
            return;
        }

        // Switch turn
        room.currentTurn = room.currentTurn === 0 ? 1 : 0;

        // Reset and restart the 60s countdown for the next turn
        resetRoomTimer(socket.roomId);

        // Notify both clients about the turn change
        room.players[0].emit('turn_change', { turn: room.currentTurn === 0, msg: room.currentTurn === 0 ? "Your turn (Black)!" : "Opponent's turn (White)..." });
        room.players[1].emit('turn_change', { turn: room.currentTurn === 1, msg: room.currentTurn === 1 ? "Your turn (White)!" : "Opponent's turn (Black)..." });
    });

    socket.on('disconnect', () => {
        console.log(`User left the game: ${socket.id}`);
        const room = rooms[socket.roomId];
        
        if (room) {
            io.to(socket.roomId).emit('gameover', 'Your opponent left the game. Session closing...');
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