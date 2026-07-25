// Si deseas forzar un servidor backend específico para WebSockets (ej: 'midominio.com' o 'backend.midominio.com'), ponlo aquí.
// Si se deja nulo (null), detectará automáticamente el host actual.
const CUSTOM_BACKEND_HOST = null;

export class ChatEngine extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.status = 'DISCONNECTED'; // CONNECTING, CONNECTED, DISCONNECTED
    this.nickname = null;
    this.avatar = null;
    this.onlineUsers = [];
    this.rooms = [];
    this.messages = []; // Mensajes en memoria
    this.isPersistent = false; // Por defecto modo efímero
    
    // Cargar configuración guardada
    this.loadSettings();
    // Cargar mensajes si está en modo persistente
    this.loadMessages();

    // Intentar conectar automáticamente al iniciar
    this.connect();
  }

  // Cargar configuraciones del localStorage
  loadSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('privachat_settings'));
      if (settings) {
        this.isPersistent = !!settings.isPersistent;
        this.nickname = settings.nickname || null;
        this.avatar = settings.avatar || null;
      }
    } catch (e) {
      console.error('Error al cargar configuraciones:', e);
    }
  }

  // Guardar configuraciones actuales en localStorage
  saveSettings() {
    try {
      localStorage.setItem('privachat_settings', JSON.stringify({
        isPersistent: this.isPersistent,
        nickname: this.nickname,
        avatar: this.avatar
      }));
    } catch (e) {
      console.error('Error al guardar configuraciones:', e);
    }
  }

  // Establecer el modo de persistencia
  setPersistence(enabled) {
    this.isPersistent = enabled;
    this.saveSettings();
    if (enabled) {
      this.saveMessagesToStorage();
    } else {
      // Si se desactiva, eliminar mensajes de localStorage
      localStorage.removeItem('privachat_messages');
    }
    this.dispatchEvent(new CustomEvent('persistence_change', { detail: enabled }));
  }

  // Cargar mensajes desde la fuente apropiada
  loadMessages() {
    if (this.isPersistent) {
      try {
        const stored = localStorage.getItem('privachat_messages');
        this.messages = stored ? JSON.parse(stored) : [];
      } catch (e) {
        console.error('Error al cargar mensajes de localStorage:', e);
        this.messages = [];
      }
    } else {
      this.messages = [];
    }
  }

  // Guardar mensajes a localStorage (solo si está activo el modo persistencia)
  saveMessagesToStorage() {
    if (this.isPersistent) {
      try {
        localStorage.setItem('privachat_messages', JSON.stringify(this.messages));
      } catch (e) {
        console.error('Error al guardar mensajes en localStorage:', e);
        // Si el localStorage está lleno (por ejemplo por imágenes), alertar o limitar
        if (e.name === 'QuotaExceededError') {
          console.warn('Límite de almacenamiento excedido, recortando historial antiguo.');
          this.messages = this.messages.slice(-50); // Mantener últimos 50 mensajes
          localStorage.setItem('privachat_messages', JSON.stringify(this.messages));
        }
      }
    }
  }

  // Limpiar todos los datos locales y del caché
  clearAllData() {
    this.messages = [];
    this.nickname = null;
    this.avatar = null;
    this.isPersistent = false;
    this.onlineUsers = [];
    
    // Limpiar localStorage
    localStorage.removeItem('privachat_settings');
    localStorage.removeItem('privachat_messages');
    
    // Cerrar conexión
    if (this.ws) {
      this.ws.close();
    }
    
    this.dispatchEvent(new CustomEvent('data_cleared'));
    this.connect(); // Reconectar como usuario anónimo
  }

  // Limpiar chat actual (por ejemplo, para una sala específica)
  clearActiveChat(chatId, isPrivate = false) {
    if (isPrivate) {
      // Filtrar mensajes privados con este destinatario/remitente
      this.messages = this.messages.filter(msg => {
        const isDM = msg.recipient && !msg.roomId;
        if (!isDM) return true;
        const matches = (msg.sender === chatId && msg.recipient === this.nickname) ||
                        (msg.sender === this.nickname && msg.recipient === chatId);
        return !matches;
      });
    } else {
      // Filtrar mensajes de esta sala pública
      this.messages = this.messages.filter(msg => msg.roomId !== chatId);
    }
    
    this.saveMessagesToStorage();
    this.dispatchEvent(new CustomEvent('messages_updated'));
  }

  // Conectar al servidor WebSocket
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.setStatus('CONNECTING');
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Si tienes un CUSTOM_BACKEND_HOST lo usa, si no, usa el host actual o GitHub Pages fallback
    let backendHost = CUSTOM_BACKEND_HOST || window.location.host;
    if (!CUSTOM_BACKEND_HOST && (window.location.hostname.endsWith('github.io') || window.location.hostname.endsWith('github.dev'))) {
      backendHost = 'privachat-backend.onrender.com';
    }
    
    const wsUrl = `${wsProtocol}//${backendHost}`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.setStatus('CONNECTED');
      // Si ya teníamos un nickname registrado, volvemos a unirnos
      if (this.nickname) {
        this.join(this.nickname, this.avatar);
      }
    };

    this.ws.onmessage = (event) => {
      this.handleServerMessage(event.data);
    };

    this.ws.onclose = () => {
      this.setStatus('DISCONNECTED');
      this.onlineUsers = [];
      this.dispatchEvent(new CustomEvent('users_updated'));
      
      // Reintentar conexión en 3 segundos
      setTimeout(() => {
        if (this.status === 'DISCONNECTED') {
          this.connect();
        }
      }, 3000);
    };

    this.ws.onerror = (error) => {
      console.error('Error de WebSocket:', error);
      this.setStatus('DISCONNECTED');
    };
  }

  setStatus(newStatus) {
    this.status = newStatus;
    this.dispatchEvent(new CustomEvent('status_change', { detail: this.status }));
  }

  // Enviar mensaje crudo al servidor
  sendRaw(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  // Validar si un nickname está disponible en el servidor
  checkNickname(nickname) {
    this.sendRaw({
      type: 'check_nickname',
      nickname
    });
  }

  // Registrarse con un nickname y avatar
  join(nickname, avatar) {
    this.nickname = nickname;
    this.avatar = avatar;
    this.saveSettings();
    this.sendRaw({
      type: 'join',
      nickname,
      avatar
    });
  }

  // Convertir archivo de imagen a Base64
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
    });
  }

  // Enviar mensaje a sala pública
  async sendGroupMessage(roomId, content, file = null) {
    let imageData = null;
    if (file) {
      imageData = await this.fileToBase64(file);
    }

    this.sendRaw({
      type: 'group_message',
      roomId,
      content,
      image: imageData
    });
  }

  // Enviar mensaje privado a un usuario
  async sendPrivateMessage(recipient, content, file = null) {
    let imageData = null;
    if (file) {
      imageData = await this.fileToBase64(file);
    }

    this.sendRaw({
      type: 'private_message',
      recipient,
      content,
      image: imageData
    });
  }

  // Notificar estado de escritura
  sendTyping(isTyping, targetNickname = null, roomId = null) {
    this.sendRaw({
      type: 'typing',
      isTyping,
      target: targetNickname,
      roomId
    });
  }

  // Manejar todos los mensajes entrantes del servidor
  handleServerMessage(rawData) {
    try {
      const data = JSON.parse(rawData);
      
      switch (data.type) {
        case 'ping': {
          this.sendRaw({ type: 'pong' });
          break;
        }

        case 'nickname_check_result': {
          this.dispatchEvent(new CustomEvent('nickname_checked', { detail: data }));
          break;
        }

        case 'join_result': {
          if (data.success) {
            this.rooms = data.rooms;
            this.nickname = data.nickname;
            this.avatar = data.avatar;
            this.saveSettings();
            this.dispatchEvent(new CustomEvent('joined', { detail: data }));
          } else {
            this.nickname = null;
            this.avatar = null;
            this.saveSettings();
            this.dispatchEvent(new CustomEvent('join_failed', { detail: data.error }));
          }
          break;
        }

        case 'user_joined': {
          this.onlineUsers = data.onlineUsers;
          this.dispatchEvent(new CustomEvent('users_updated'));
          this.dispatchEvent(new CustomEvent('presence', { 
            detail: { type: 'join', user: data.user } 
          }));
          break;
        }

        case 'user_left': {
          this.onlineUsers = data.onlineUsers;
          this.dispatchEvent(new CustomEvent('users_updated'));
          this.dispatchEvent(new CustomEvent('presence', { 
            detail: { type: 'leave', nickname: data.nickname } 
          }));
          break;
        }

        case 'group_message': {
          const { message } = data;
          this.messages.push(message);
          this.saveMessagesToStorage();
          this.dispatchEvent(new CustomEvent('message_received', { detail: message }));
          break;
        }

        case 'private_message': {
          const { message } = data;
          this.messages.push(message);
          this.saveMessagesToStorage();
          this.dispatchEvent(new CustomEvent('message_received', { detail: message }));
          break;
        }

        case 'typing': {
          this.dispatchEvent(new CustomEvent('typing_status', { detail: data }));
          break;
        }

        case 'error': {
          console.error('Mensaje de error del servidor:', data.message);
          this.dispatchEvent(new CustomEvent('server_error', { detail: data.message }));
          break;
        }
      }
    } catch (e) {
      console.error('Error al parsear mensaje de servidor:', e);
    }
  }
}
