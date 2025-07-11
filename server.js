
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const wss = new WebSocket.Server({ 
  port: process.env.PORT || 8080, 
  host: '0.0.0.0'
});

let clients = new Map();
console.log('AR Remote Assist WebSocket server with enhanced audio support started on port 8080');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, 'ar_server.log');

function writeLog(message) {
    const timestamp = new Date().toISOString();
    fs.appendFile(logFile, `[${timestamp}] ${message}\n`, (err) => {
        if (err) console.error('Failed to write log:', err);
    });
    console.log(`[${timestamp}] ${message}`);
}

wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    writeLog(`New client connected from ${clientIP} for AR Remote Assist with audio`);
    
    clients.set(ws, { 
        role: null, 
        lastSeen: Date.now(), 
        sessionId: generateSessionId(),
        audioEnabled: false,
        ip: clientIP
    });

    ws.on('message', (data) => {
        const client = clients.get(ws);
        if (!client) return;

        client.lastSeen = Date.now();

        try {
            if (data.toString().startsWith('ROLE:')) {
                const role = data.toString().split(':')[1];
                client.role = role;
                writeLog(`👤 Client assigned role: ${role} (Session: ${client.sessionId}, IP: ${client.ip})`);
                ws.send(`ROLE_CONFIRMED:${role}`);
                
                broadcastClientStatus();
                return;
            }

            // Handle binary data (video frames)
            if (data instanceof Buffer && client.role === 'user') {
                const aidClients = Array.from(clients.entries())
                    .filter(([clientWs, clientInfo]) => 
                        clientInfo.role === 'Aid' && clientWs.readyState === WebSocket.OPEN
                    );

                if (aidClients.length > 0) {
                    if (Date.now() % 3000 < 100) {
                        writeLog(`📹 Relaying video frame from user to ${aidClients.length} Aid(s): ${data.length} bytes`);
                    }
                    
                    aidClients.forEach(([clientWs]) => {
                        try {
                            clientWs.send(data);
                        } catch (error) {
                            writeLog(`Error sending frame to Aid: ${error.message}`);
                        }
                    });
                } else {
                    if (Date.now() % 5000 < 100) {
                        writeLog(`No Aid clients available to receive video frame`);
                    }
                }
                return;
            }

            // Parse JSON messages
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'drawing':
                    handleDrawingMessage(message, client, ws);
                    break;
                case 'clear':
                    handleClearMessage(message, client, ws);
                    break;
                case 'offer':
                    handleWebRTCSignaling(message, client, ws, '🎵 WebRTC Offer');
                    break;
                case 'answer':
                    handleWebRTCSignaling(message, client, ws, '🎵 WebRTC Answer');
                    break;
                case 'ice_candidate':
                    handleWebRTCSignaling(message, client, ws, '🧊 ICE Candidate');
                    break;
                case 'audio_call_start':
                    handleAudioCallStart(message, client, ws);
                    break;
                case 'audio_call_end':
                    handleAudioCallEnd(message, client, ws);
                    break;
                case 'audio_status':
                    handleAudioStatus(message, client, ws);
                    break;
                case 'heartbeat':
                    ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
                    break;
                default:
                    writeLog(`Unknown message type from ${client.role}: ${message.type}`);
            }

        } catch (error) {
            writeLog(`Error processing message from ${client.role}: ${error.message}`);
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        writeLog(`Client disconnected: ${client?.role || 'unknown'} (Session: ${client?.sessionId || 'unknown'}, IP: ${client?.ip || 'unknown'})`);
        
        if (client) {
            notifyClientDisconnected(client);
        }
        
        clients.delete(ws);
        broadcastClientStatus();
    });

    ws.on('error', (error) => {
        const client = clients.get(ws);
        writeLog(`WebSocket error for ${client?.role || 'unknown'}: ${error.message}`);
        
        if (client) {
            notifyClientDisconnected(client);
        }
        
        clients.delete(ws);
        broadcastClientStatus();
    });
});

function handleDrawingMessage(message, client, ws) {
    const senderRole = client.role;
    writeLog(`Received 3D drawing from ${senderRole}: ${message.points.length} points`);
    
    const enhancedMessage = {
        ...message,
        timestamp: Date.now(),
        sessionId: client.sessionId,
        is3D: true
    };

    relayToOtherClients(enhancedMessage, senderRole, '3D drawing');
}

function handleClearMessage(message, client, ws) {
    const senderRole = client.role;
    writeLog(`Received clear command from ${senderRole}`);
    
    const clearMessage = {
        ...message,
        timestamp: Date.now(),
        sessionId: client.sessionId
    };

    relayToOtherClients(clearMessage, senderRole, 'clear command');
}

function handleWebRTCSignaling(message, client, ws, logPrefix) {
    const senderRole = client.role;
    writeLog(`${logPrefix} from ${senderRole} (Session: ${client.sessionId})`);
    
    const audioMessage = {
        ...message,
        timestamp: Date.now(),
        sessionId: client.sessionId
    };

    // Relay WebRTC signaling messages to other clients
    const targetClients = Array.from(clients.entries())
        .filter(([clientWs, clientInfo]) => 
            clientInfo.role !== senderRole && clientWs.readyState === WebSocket.OPEN
        );

    if (targetClients.length === 0) {
        writeLog(`No target clients found for WebRTC signaling from ${senderRole}`);
        return;
    }

    targetClients.forEach(([clientWs, clientInfo]) => {
        try {
            writeLog(`Relaying ${message.type} from ${senderRole} to ${clientInfo.role}`);
            clientWs.send(JSON.stringify(audioMessage));
        } catch (error) {
            writeLog(`Error relaying WebRTC signaling: ${error.message}`);
        }
    });
}

function handleAudioCallStart(message, client, ws) {
    const senderRole = client.role;
    writeLog(`Audio call started by ${senderRole} (Session: ${client.sessionId})`);
    
    client.audioEnabled = true;
    
    const callMessage = {
        ...message,
        timestamp: Date.now(),
        sessionId: client.sessionId
    };

    relayToOtherClients(callMessage, senderRole, 'audio call start');
    broadcastClientStatus();
}

function handleAudioCallEnd(message, client, ws) {
    const senderRole = client.role;
    writeLog(`Audio call ended by ${senderRole} (Session: ${client.sessionId})`);
    
    client.audioEnabled = false;
    
    const callMessage = {
        ...message,
        timestamp: Date.now(),
        sessionId: client.sessionId
    };

    relayToOtherClients(callMessage, senderRole, 'audio call end');
    broadcastClientStatus();
}

function handleAudioStatus(message, client, ws) {
    const senderRole = client.role;
    const status = message.status;
    writeLog(`Audio status from ${senderRole}: ${status}`);
    
    const statusMessage = {
        ...message,
        timestamp: Date.now(),
        sessionId: client.sessionId
    };

    relayToOtherClients(statusMessage, senderRole, `audio status: ${status}`);
}

function relayToOtherClients(message, senderRole, logType) {
    const targetClients = Array.from(clients.entries())
        .filter(([clientWs, clientInfo]) => 
            clientInfo.role !== senderRole && clientWs.readyState === WebSocket.OPEN
        );

    if (targetClients.length === 0) {
        writeLog(`No target clients found for ${logType} from ${senderRole}`);
        return;
    }

    targetClients.forEach(([clientWs, clientInfo]) => {
        try {
            writeLog(`Relaying ${logType} from ${senderRole} to ${clientInfo.role}`);
            clientWs.send(JSON.stringify(message));
        } catch (error) {
            writeLog(`Error relaying ${logType}: ${error.message}`);
        }
    });
}

function notifyClientDisconnected(disconnectedClient) {
    const disconnectMessage = {
        type: 'user_disconnected',
        userId: disconnectedClient.sessionId,
        role: disconnectedClient.role,
        timestamp: Date.now()
    };

    clients.forEach((clientInfo, clientWs) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            try {
                clientWs.send(JSON.stringify(disconnectMessage));
            } catch (error) {
                writeLog(`Error notifying client disconnection: ${error.message}`);
            }
        }
    });
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function broadcastClientStatus() {
    const userClients = Array.from(clients.values()).filter(c => c.role === 'user');
    const aidClients = Array.from(clients.values()).filter(c => c.role === 'Aid');
    const audioConnections = Array.from(clients.values()).filter(c => c.audioEnabled);
    
    const status = {
        type: 'client_status',
        users: userClients.length,
        aids: aidClients.length,
        audioConnections: audioConnections.length,
        totalClients: clients.size,
        timestamp: Date.now()
    };

    writeLog(`Broadcasting status: Users=${status.users}, Aids=${status.aids}, Audio=${status.audioConnections}, Total=${status.totalClients}`);

    clients.forEach((client, ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(status));
            } catch (error) {
                writeLog(`Error broadcasting status: ${error.message}`);
            }
        }
    });
}

// Clean up stale connections every 30 seconds
setInterval(() => {
    const now = Date.now();
    let removedCount = 0;

    clients.forEach((client, ws) => {
        if (now - client.lastSeen > 60000) { // 60 seconds timeout
            writeLog(`Removing stale connection: ${client.role} (Session: ${client.sessionId})`);
            ws.terminate();
            clients.delete(ws);
            removedCount++;
        }
    });

    if (removedCount > 0) {
        writeLog(`Cleaned up ${removedCount} stale connections`);
        broadcastClientStatus();
    }
}, 30000);

// Log server status every minute
setInterval(() => {
    const activeClients = clients.size;
    const userCount = Array.from(clients.values()).filter(c => c.role === 'user').length;
    const aidCount = Array.from(clients.values()).filter(c => c.role === 'Aid').length;
    const audioCount = Array.from(clients.values()).filter(c => c.audioEnabled).length;
    
    writeLog(`Server status - Total: ${activeClients}, Users: ${userCount}, Aids: ${aidCount}, Audio: ${audioCount}`);
    
    // Log detailed client info
    clients.forEach((client, ws) => {
        writeLog(`${client.role || 'unknown'} - Session: ${client.sessionId}, Audio: ${client.audioEnabled ? 'ON' : 'OFF'}, IP: ${client.ip}`);
    });
}, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
    writeLog('Server shutting down...');
    
    // Notify all clients about shutdown
    const shutdownMessage = JSON.stringify({
        type: 'server_shutdown',
        message: 'Server is shutting down',
        timestamp: Date.now()
    });
    
    clients.forEach((client, ws) => {
        try {
            ws.send(shutdownMessage);
            ws.close();
        } catch (e) {
            // Ignore errors during shutdown
        }
    });
    
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});
