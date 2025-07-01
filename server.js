const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
// const wss = new WebSocket.Server({ port: 8080, host: '192.168.10.179'});
// const wss = new WebSocket.Server({ port: 8080, host: '172.26.102.151'});
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
let clients = new Map();
console.log('WebSocket server started on port 8080');
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}
const logFile = path.join(logDir, 'server.log');
function writeLog(message) {
    const timestamp = new Date().toISOString();
    fs.appendFile(logFile, `[${timestamp}] ${message}\n`, (err) => {
        if (err) console.error('Failed to write log:', err);
    });
}
wss.on('connection', (ws) => {
    console.log('New client connected');
    console.log()
    clients.set(ws, { role: null, lastSeen: Date.now() });
    ws.on('message', (data) => {
        const client = clients.get(ws);
        if (!client) return;
        client.lastSeen = Date.now();
        try {
            if (data.toString().startsWith('ROLE:')) {
                const role = data.toString().split(':')[1];
                client.role = role;
                console.log(`Client assigned role: ${role}`);
                ws.send(`ROLE_CONFIRMED:${role}`);
                return;
            }

            if (data instanceof Buffer && client.role === 'user') {
                clients.forEach((clientInfo, clientWs) => {
                    if (clientInfo.role === 'Aid' && clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(data);
                    }
                });
                return;
            }

            const message = JSON.parse(data.toString());

            
            if (message.type === 'drawing' || message.type === 'clear') {
                const senderRole = client.role;
                console.log(`Received ${message.type} from ${senderRole}`);
                clients.forEach((clientInfo, clientWs) => {
                    if (clientInfo.role !== senderRole && clientWs.readyState === WebSocket.OPEN) {
                        console.log(`Relaying ${message.type} from ${senderRole} to ${clientInfo.role}`);
                        clientWs.send(JSON.stringify(message));
                    }
                });
            } else {
                writeLog(`Received message from ${client.role}: ${data}`);
            }

        } catch (error) {
            console.error('Error processing message:', error);
            writeLog(`Error: ${error.message}`);
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        console.log(`Client disconnected: ${client?.role || 'unknown'}`);
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        writeLog(`WebSocket error: ${error.message}`);
        clients.delete(ws);
    });
});

setInterval(() => {
    const now = Date.now();
    clients.forEach((client, ws) => {
        if (now - client.lastSeen > 60000) {
            console.log(`Removing stale connection: ${client.role}`);
            ws.terminate();
            clients.delete(ws);
        }
    });
}, 30000);

console.log('WebSocket server is ready to handle connections');
