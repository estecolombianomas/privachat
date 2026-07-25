import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Estado en memoria (no persistente)
// Mapa de nickname (string) -> { socket: WebSocket, avatar: string, joinedAt: number }
const connectedUsers = new Map();

// Salas por defecto
const defaultRooms = [
  { id: 'general', name: 'General', description: 'Sala general de conversación' },
  { id: 'tech', name: 'Tecnología', description: 'Charlas sobre programación y gadgets' },
  { id: 'gaming', name: 'Videojuegos', description: 'Espacio para gamers' },
  { id: 'random', name: 'Random', description: 'Conversaciones aleatorias y memes' }
];

// Generar un ID único para los mensajes
function generateId() {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
}

// Obtener lista de usuarios activos (sin el objeto socket)
function getActiveUsersList() {
  const list = [];
  connectedUsers.forEach((value, key) => {
    list.push({
      nickname: key,
      avatar: value.avatar,
      joinedAt: value.joinedAt
    });
  });
  return list;
}

// Difundir un mensaje a todos los usuarios conectados
function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  let userNickname = null;

  // Enviar mensaje ping para mantener conexión y comprobar latencia
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  ws.on('message', (rawData) => {
    try {
      const message = JSON.parse(rawData);
      
      switch (message.type) {
        case 'check_nickname': {
          const { nickname } = message;
          if (!nickname || nickname.trim() === '') {
            ws.send(JSON.stringify({ type: 'nickname_check_result', available: false, error: 'Nickname inválido' }));
            break;
          }
          
          const normalizedNick = nickname.trim().toLowerCase();
          let isTaken = false;
          for (const key of connectedUsers.keys()) {
            if (key.toLowerCase() === normalizedNick) {
              isTaken = true;
              break;
            }
          }
          
          ws.send(JSON.stringify({
            type: 'nickname_check_result',
            nickname: nickname.trim(),
            available: !isTaken
          }));
          break;
        }

        case 'join': {
          const { nickname, avatar } = message;
          if (!nickname || nickname.trim() === '') {
            ws.send(JSON.stringify({ type: 'join_result', success: false, error: 'Nickname inválido' }));
            break;
          }

          const trimmedNick = nickname.trim();
          const normalizedNick = trimmedNick.toLowerCase();
          
          // Doble comprobación de nickname duplicado
          let isTaken = false;
          for (const key of connectedUsers.keys()) {
            if (key.toLowerCase() === normalizedNick) {
              isTaken = true;
              break;
            }
          }

          if (isTaken) {
            ws.send(JSON.stringify({ type: 'join_result', success: false, error: 'Este nickname ya está en uso' }));
            break;
          }

          // Registrar usuario
          userNickname = trimmedNick;
          connectedUsers.set(userNickname, {
            socket: ws,
            avatar: avatar || '',
            joinedAt: Date.now()
          });

          // Confirmar éxito al cliente y enviar salas iniciales
          ws.send(JSON.stringify({
            type: 'join_result',
            success: true,
            nickname: userNickname,
            avatar: avatar,
            rooms: defaultRooms
          }));

          // Notificar a todos la unión del nuevo usuario y lista actualizada
          broadcast({
            type: 'user_joined',
            user: { nickname: userNickname, avatar },
            onlineUsers: getActiveUsersList()
          });
          break;
        }

        case 'group_message': {
          if (!userNickname || !connectedUsers.has(userNickname)) {
            ws.send(JSON.stringify({ type: 'error', message: 'No estás registrado en la sesión' }));
            break;
          }

          const { roomId, content, image } = message;
          if (!roomId || (!content && !image)) break;

          const senderData = connectedUsers.get(userNickname);

          broadcast({
            type: 'group_message',
            message: {
              id: generateId(),
              roomId,
              sender: userNickname,
              avatar: senderData.avatar,
              content: content || '',
              image: image || null,
              timestamp: Date.now()
            }
          });
          break;
        }

        case 'private_message': {
          if (!userNickname || !connectedUsers.has(userNickname)) {
            ws.send(JSON.stringify({ type: 'error', message: 'No estás registrado en la sesión' }));
            break;
          }

          const { recipient, content, image } = message;
          if (!recipient || (!content && !image)) break;

          const senderData = connectedUsers.get(userNickname);
          const recipientData = connectedUsers.get(recipient);

          const privateMsg = {
            id: generateId(),
            sender: userNickname,
            recipient: recipient,
            avatar: senderData.avatar,
            content: content || '',
            image: image || null,
            timestamp: Date.now()
          };

          // Enviar únicamente al destinatario
          if (recipientData && recipientData.socket.readyState === ws.OPEN) {
            recipientData.socket.send(JSON.stringify({
              type: 'private_message',
              message: privateMsg
            }));
          }

          // Enviar copia de confirmación al emisor
          ws.send(JSON.stringify({
            type: 'private_message',
            message: privateMsg
          }));
          break;
        }

        case 'typing': {
          if (!userNickname) break;
          const { target, isTyping, roomId } = message;
          
          if (roomId) {
            // Escribiendo en una sala pública (difundir a todos excepto al emisor)
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === 1) {
                client.send(JSON.stringify({
                  type: 'typing',
                  sender: userNickname,
                  roomId,
                  isTyping
                }));
              }
            });
          } else if (target) {
            // Escribiendo en privado a un usuario específico
            const recipientData = connectedUsers.get(target);
            if (recipientData && recipientData.socket.readyState === ws.OPEN) {
              recipientData.socket.send(JSON.stringify({
                type: 'typing',
                sender: userNickname,
                isTyping
              }));
            }
          }
          break;
        }

        case 'pong': {
          // Latencia o respuesta de heartbeat recibida
          break;
        }
      }
    } catch (err) {
      console.error('Error procesando mensaje:', err);
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    if (userNickname && connectedUsers.has(userNickname)) {
      connectedUsers.delete(userNickname);
      // Notificar a todos sobre la salida
      broadcast({
        type: 'user_left',
        nickname: userNickname,
        onlineUsers: getActiveUsersList()
      });
    }
  });

  ws.on('error', (err) => {
    console.error(`Error en el socket del usuario ${userNickname || 'no registrado'}:`, err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor de PrivaChat ejecutándose en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
