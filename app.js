import { ChatEngine } from './chat-engine.js';
import { generateAvatar } from './avatar-generator.js';

// Inicializar Lucide Icons
function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// INICIALIZACIÓN DE VARIABLES DE ESTADO LOCAL
const engine = new ChatEngine();
let activeChat = { id: 'general', type: 'group' };
let selectedFile = null;
let currentAvatarDataUrl = '';
let checkNicknameTimeout = null;
let isTypingState = false;
let stopTypingTimeout = null;

// Mapa para rastrear estados de "escribiendo..." de otros usuarios
// clave: 'room-RoomId' o 'user-Nickname' -> { timeoutId, element }
const activeTypingIndicators = new Map();

// Rastrear mensajes no leídos
// clave: 'room-RoomId' o 'user-Nickname' -> contador (int)
const unreadCounts = new Map();

// ELEMENTOS DEL DOM
const DOM = {
  // Pantallas
  welcomeScreen: document.getElementById('welcome-screen'),
  chatScreen: document.getElementById('chat-screen'),
  
  // Login/Registro
  loginForm: document.getElementById('login-form'),
  nicknameInput: document.getElementById('nickname-input'),
  nicknameStatusIndicator: document.getElementById('nickname-status-indicator'),
  nicknameFeedback: document.getElementById('nickname-feedback'),
  persistenceToggle: document.getElementById('persistence-toggle'),
  btnEnterChat: document.getElementById('btn-enter-chat'),
  avatarPreview: document.getElementById('avatar-preview'),
  btnRandomizeAvatar: document.getElementById('btn-randomize-avatar'),
  
  // Sidebar e Interfaz
  mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
  sidebarLeft: document.getElementById('sidebar-left'),
  connectionBadge: document.getElementById('connection-badge'),
  mobileConnectionDot: document.getElementById('mobile-connection-dot'),
  currentUserAvatar: document.getElementById('current-user-avatar'),
  currentUserName: document.getElementById('current-user-name'),
  btnLogout: document.getElementById('btn-logout'),
  roomsList: document.getElementById('rooms-list'),
  usersList: document.getElementById('users-list'),
  usersOnlineCount: document.getElementById('users-online-count'),
  btnTogglePersistenceSidebar: document.getElementById('btn-toggle-persistence-sidebar'),
  persistenceModeLabel: document.getElementById('persistence-mode-label'),
  btnClearAll: document.getElementById('btn-clear-all'),
  
  // Área Central de Chat
  activeChatTitle: document.getElementById('active-chat-title'),
  activeChatDesc: document.getElementById('active-chat-desc'),
  messagesFeed: document.getElementById('messages-feed'),
  typingIndicator: document.getElementById('typing-indicator'),
  
  // Input de Mensajes
  imagePreviewBar: document.getElementById('image-preview-bar'),
  attachedImagePreview: document.getElementById('attached-image-preview'),
  btnRemoveAttachedImage: document.getElementById('btn-remove-attached-image'),
  chatInputForm: document.getElementById('chat-input-form'),
  imageUploadInput: document.getElementById('image-upload-input'),
  btnTriggerUpload: document.getElementById('btn-trigger-upload'),
  messageInput: document.getElementById('message-input'),
  btnSendMessage: document.getElementById('btn-send-message'),
  
  // Sidebar Derecha (Detalles)
  sidebarDetails: document.getElementById('sidebar-details'),
  btnToggleDetails: document.getElementById('btn-toggle-details'),
  btnCloseDetails: document.getElementById('btn-close-details'),
  detailsIcon: document.getElementById('details-icon'),
  detailsTitle: document.getElementById('details-title'),
  detailsDescription: document.getElementById('details-description'),
  btnClearChatHistory: document.getElementById('btn-clear-chat-history'),
  btnDownloadTranscript: document.getElementById('btn-download-transcript'),
  
  // Modales
  imageViewerModal: document.getElementById('image-viewer-modal'),
  modalImg: document.getElementById('modal-img'),
  closeImageViewer: document.getElementById('close-image-viewer'),
  imageViewerCaption: document.getElementById('image-viewer-caption'),
  btnDownloadModalImg: document.getElementById('btn-download-modal-img'),
  mentionSuggestions: document.getElementById('mention-suggestions'),
  
  createRoomModal: document.getElementById('create-room-modal'),
  btnAddRoom: document.getElementById('btn-add-room'),
  btnCloseRoomModal: document.getElementById('btn-close-room-modal'),
  btnCancelCreateRoom: document.getElementById('btn-cancel-create-room'),
  createRoomForm: document.getElementById('create-room-form'),
  newRoomName: document.getElementById('new-room-name'),
  newRoomDesc: document.getElementById('new-room-desc')
};

// Crear overlay de sidebar móvil si no existe
let sidebarOverlay = document.querySelector('.sidebar-overlay');
if (!sidebarOverlay) {
  sidebarOverlay = document.createElement('div');
  sidebarOverlay.className = 'sidebar-overlay';
  document.querySelector('.chat-container').appendChild(sidebarOverlay);
}

// -------------------------------------------------------------
// EVENT LISTENERS DEL MOTOR DE CHAT (CHAT ENGINE)
// -------------------------------------------------------------

// Cambios de estado de conexión
engine.addEventListener('status_change', (e) => {
  const status = e.detail;
  updateConnectionUI(status);
});

// Verificación de nickname único
engine.addEventListener('nickname_checked', (e) => {
  const { available, nickname, error } = e.detail;
  
  if (!DOM.nicknameInput.value.trim()) return;
  
  if (available) {
    DOM.nicknameStatusIndicator.innerHTML = '<i data-lucide="check" class="text-success"></i>';
    DOM.nicknameFeedback.innerText = 'Nickname disponible';
    DOM.nicknameFeedback.className = 'feedback-text success';
    DOM.btnEnterChat.disabled = false;
  } else {
    DOM.nicknameStatusIndicator.innerHTML = '<i data-lucide="x" class="text-danger"></i>';
    DOM.nicknameFeedback.innerText = error || 'Este nickname ya está en uso';
    DOM.nicknameFeedback.className = 'feedback-text error';
    DOM.btnEnterChat.disabled = true;
  }
  initLucide();
});

// Registro exitoso del usuario
engine.addEventListener('joined', (e) => {
  const { nickname, avatar } = e.detail;
  
  // Cambiar pantallas
  DOM.welcomeScreen.classList.remove('active');
  DOM.chatScreen.classList.add('active');
  
  // Cargar perfil en la UI
  DOM.currentUserAvatar.src = avatar;
  DOM.currentUserName.innerText = nickname;
  
  // Establecer botón de persistencia en barra lateral
  updatePersistenceButtonUI(engine.isPersistent);
  
  // Forzar refresco de interfaz
  renderRooms();
  renderOnlineUsers();
  renderMessages();
  updateChatDetailsPanel();
});

// Fallo al registrarse
engine.addEventListener('join_failed', (e) => {
  alert(`Error al ingresar: ${e.detail}`);
  DOM.welcomeScreen.classList.add('active');
  DOM.chatScreen.classList.remove('active');
});

// Lista de usuarios actualizada
engine.addEventListener('users_updated', () => {
  renderOnlineUsers();
});

// Eventos de presencia (unión/salida de usuarios)
engine.addEventListener('presence', (e) => {
  const { type, user, nickname } = e.detail;
  
  // Si estamos en #general o en la sala del usuario que sale, agregar mensaje de sistema
  let systemMsg = null;
  if (type === 'join') {
    systemMsg = {
      id: 'sys-' + Math.random(),
      type: 'system',
      content: `${user.nickname} se ha unido al chat.`,
      icon: 'user-plus',
      styleClass: 'join',
      timestamp: Date.now()
    };
  } else if (type === 'leave') {
    systemMsg = {
      id: 'sys-' + Math.random(),
      type: 'system',
      content: `${nickname} ha salido del chat.`,
      icon: 'user-minus',
      styleClass: 'leave',
      timestamp: Date.now()
    };
  }

  if (systemMsg && activeChat.id === 'general') {
    engine.messages.push(systemMsg);
    renderMessages();
  }
});

// Nuevo mensaje recibido
engine.addEventListener('message_received', (e) => {
  const message = e.detail;
  const isForActiveChat = isMessageForCurrentChat(message);

  if (isForActiveChat) {
    renderMessages();
    scrollToBottom();
  } else {
    // Incrementar contador de no leídos
    let key = '';
    if (message.roomId) {
      key = `room-${message.roomId}`;
    } else {
      // Mensaje privado: la clave es el remitente (no yo)
      const partner = message.sender === engine.nickname ? message.recipient : message.sender;
      key = `user-${partner}`;
    }
    
    const count = unreadCounts.get(key) || 0;
    unreadCounts.set(key, count + 1);
    
    // Reproducir un sonido leve de notificación (opcional/silenciado por defecto)
    playNotificationSound();
    
    // Actualizar barras laterales
    renderRooms();
    renderOnlineUsers();
  }
});

// Cambio en modo de persistencia
engine.addEventListener('persistence_change', (e) => {
  updatePersistenceButtonUI(e.detail);
});

// Limpieza de datos total
engine.addEventListener('data_cleared', () => {
  // Redirigir a welcome screen
  DOM.welcomeScreen.classList.add('active');
  DOM.chatScreen.classList.remove('active');
  DOM.nicknameInput.value = '';
  DOM.nicknameFeedback.innerText = '';
  DOM.nicknameStatusIndicator.innerHTML = '';
  DOM.btnEnterChat.disabled = true;
  unreadCounts.clear();
  selectedFile = null;
  resetImageAttachmentUI();
  generateInitialAvatar();
});

// Mensajes actualizados (por vaciado manual)
engine.addEventListener('messages_updated', () => {
  renderMessages();
});

// Estados de escritura
engine.addEventListener('typing_status', (e) => {
  const { sender, roomId, isTyping } = e.detail;
  
  // Evitar procesar mis propios estados de escritura
  if (sender === engine.nickname) return;
  
  const key = roomId ? `room-${roomId}` : `user-${sender}`;
  
  if (isTyping) {
    // Si no está en el mapa, agregar
    if (activeTypingIndicators.has(key)) {
      clearTimeout(activeTypingIndicators.get(key).timeoutId);
    }
    
    const timeoutId = setTimeout(() => {
      removeTypingIndicator(key);
    }, 4000); // Expiración de 4 segundos
    
    activeTypingIndicators.set(key, { sender, roomId, timeoutId });
  } else {
    removeTypingIndicator(key);
  }
  
  updateTypingUI();
});

// -------------------------------------------------------------
// EVENT LISTENERS DEL DOM (UI)
// -------------------------------------------------------------

// Cargar estado inicial al cargar página
window.addEventListener('DOMContentLoaded', () => {
  initLucide();

  // Variables locales para sugerencias de mención
  let suggestionMatches = [];
  let selectedSuggestionIndex = -1;

  const showSuggestions = (matches) => {
    suggestionMatches = matches;
    selectedSuggestionIndex = 0;
    
    DOM.mentionSuggestions.innerHTML = '';
    matches.forEach((user, idx) => {
      const item = document.createElement('div');
      item.className = `suggestion-item ${idx === 0 ? 'active' : ''}`;
      item.innerHTML = `
        <img class="suggestion-avatar" src="${user.avatar}" alt="${user.nickname}">
        <span class="suggestion-nickname">${user.nickname}</span>
      `;
      
      item.addEventListener('click', () => {
        selectSuggestion(user.nickname);
      });
      
      DOM.mentionSuggestions.appendChild(item);
    });
    
    DOM.mentionSuggestions.classList.add('active');
  };

  const hideSuggestions = () => {
    suggestionMatches = [];
    selectedSuggestionIndex = -1;
    DOM.mentionSuggestions.innerHTML = '';
    DOM.mentionSuggestions.classList.remove('active');
  };

  const selectSuggestion = (nickname) => {
    const text = DOM.messageInput.value;
    const cursor = DOM.messageInput.selectionStart;
    const textBeforeCursor = text.slice(0, cursor);
    const words = textBeforeCursor.split(/\s/);
    const lastWord = words[words.length - 1] || '';
    
    const beforeWord = textBeforeCursor.slice(0, textBeforeCursor.length - lastWord.length);
    const afterWord = text.slice(cursor);
    
    DOM.messageInput.value = beforeWord + `@${nickname} ` + afterWord;
    hideSuggestions();
    
    // Enfocar y colocar cursor después del nickname insertado
    const newCursor = beforeWord.length + nickname.length + 2; // @ + espacio
    DOM.messageInput.focus();
    DOM.messageInput.setSelectionRange(newCursor, newCursor);
  };

  const updateActiveSuggestionItem = () => {
    const items = DOM.mentionSuggestions.querySelectorAll('.suggestion-item');
    items.forEach((item, idx) => {
      if (idx === selectedSuggestionIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  };
  
  // Configurar toggle inicial
  DOM.persistenceToggle.checked = engine.isPersistent;
  
  // Si no está registrado, generar un avatar inicial
  if (!engine.nickname) {
    generateInitialAvatar();
  }

  // Escuchar inputs del nickname para validación
  DOM.nicknameInput.addEventListener('input', () => {
    const val = DOM.nicknameInput.value.trim();
    
    // Limpiar feedbacks
    DOM.nicknameStatusIndicator.innerHTML = '';
    DOM.nicknameFeedback.innerText = '';
    DOM.btnEnterChat.disabled = true;
    
    if (checkNicknameTimeout) clearTimeout(checkNicknameTimeout);
    
    if (!val) return;
    
    // Generar un nuevo avatar con este nickname como semilla
    currentAvatarDataUrl = generateAvatar(val);
    DOM.avatarPreview.src = currentAvatarDataUrl;
    
    DOM.nicknameStatusIndicator.innerHTML = '<i data-lucide="loader" class="animate-spin text-warning"></i>';
    initLucide();

    // Debounce de 400ms para no saturar al servidor de WebSockets
    checkNicknameTimeout = setTimeout(() => {
      if (engine.status === 'CONNECTED') {
        engine.checkNickname(val);
      } else {
        // Fallback si no hay conexión al servidor todavía
        DOM.nicknameStatusIndicator.innerHTML = '<i data-lucide="alert-triangle" class="text-warning"></i>';
        DOM.nicknameFeedback.innerText = 'Desconectado del servidor de validación';
        DOM.nicknameFeedback.className = 'feedback-text error';
        DOM.btnEnterChat.disabled = false; // Permitir de todas formas, revalidará al unirse
        initLucide();
      }
    }, 4500000 ? 400 : 400); // 400ms
  });

  // Generar avatar aleatorio en el botón de random
  DOM.btnRandomizeAvatar.addEventListener('click', () => {
    const randomSeed = Math.random().toString(36).substring(7);
    const mockName = DOM.nicknameInput.value.trim() || `Anon_${randomSeed}`;
    currentAvatarDataUrl = generateAvatar(mockName + randomSeed);
    DOM.avatarPreview.src = currentAvatarDataUrl;
  });

  // Formulario de login
  DOM.loginForm.addEventListener('submit', () => {
    const nickname = DOM.nicknameInput.value.trim();
    if (nickname && currentAvatarDataUrl) {
      engine.join(nickname, currentAvatarDataUrl);
    }
  });

  // Toggle de persistencia en login
  DOM.persistenceToggle.addEventListener('change', (e) => {
    engine.setPersistence(e.target.checked);
  });

  // Toggle de persistencia en barra lateral
  DOM.btnTogglePersistenceSidebar.addEventListener('click', () => {
    engine.setPersistence(!engine.isPersistent);
  });

  // Logout
  DOM.btnLogout.addEventListener('click', () => {
    if (confirm('¿Estás seguro de que quieres cerrar la sesión? Se desconectará de las salas.')) {
      engine.clearAllData();
    }
  });

  // Limpiar todo
  DOM.btnClearAll.addEventListener('click', () => {
    if (confirm('ATENCIÓN: Esto borrará por completo tu nickname, configuración e historial de chat almacenado en este navegador. ¿Proceder?')) {
      engine.clearAllData();
    }
  });

  // Mostrar modal de nueva sala
  DOM.btnAddRoom.addEventListener('click', () => {
    DOM.createRoomModal.classList.add('active');
    DOM.newRoomName.focus();
  });

  // Cancelar y cerrar modal sala
  const closeModal = () => {
    DOM.createRoomModal.classList.remove('active');
    DOM.createRoomForm.reset();
  };
  DOM.btnCloseRoomModal.addEventListener('click', closeModal);
  DOM.btnCancelCreateRoom.addEventListener('click', closeModal);

  // Crear sala submit
  DOM.createRoomForm.addEventListener('submit', () => {
    const rawName = DOM.newRoomName.value.trim();
    const desc = DOM.newRoomDesc.value.trim() || 'Sala creada por usuario';
    
    if (!rawName) return;
    
    // Normalizar a minúsculas y sin caracteres especiales raros para el ID de sala
    const roomId = rawName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    
    // Comprobar si ya existe
    const exists = engine.rooms.some(r => r.id === roomId);
    if (exists) {
      alert('Esta sala ya existe');
      return;
    }
    
    // Agregar sala
    const newRoom = { id: roomId, name, description: desc };
    engine.rooms.push(newRoom);
    
    // Cerrar modal
    closeModal();
    
    // Refrescar salas y cambiar a la recién creada
    renderRooms();
    changeActiveChat(roomId, 'group');
  });

  // Enviar Mensaje
  DOM.chatInputForm.addEventListener('submit', async () => {
    const text = DOM.messageInput.value.trim();
    const file = selectedFile;
    
    if (!text && !file) return;
    
    // Limpiar input y barra de previsualización inmediatamente (optimismo visual)
    DOM.messageInput.value = '';
    resetImageAttachmentUI();
    
    // Detener indicador de escritura
    sendTypingStatus(false);
    
    try {
      if (activeChat.type === 'group') {
        await engine.sendGroupMessage(activeChat.id, text, file);
      } else {
        await engine.sendPrivateMessage(activeChat.id, text, file);
      }
    } catch (e) {
      alert(`Error al enviar mensaje: ${e.message}`);
    }
  });

  // Detectar escritura y autocompletado de mención
  DOM.messageInput.addEventListener('input', () => {
    if (!isTypingState) {
      sendTypingStatus(true);
    }
    
    if (stopTypingTimeout) clearTimeout(stopTypingTimeout);
    
    stopTypingTimeout = setTimeout(() => {
      sendTypingStatus(false);
    }, 2500); // Detener estado si no escribe en 2.5 seg

    // Autocompletado con @
    const text = DOM.messageInput.value;
    const cursor = DOM.messageInput.selectionStart;
    const textBeforeCursor = text.slice(0, cursor);
    const words = textBeforeCursor.split(/\s/);
    const lastWord = words[words.length - 1] || '';
    
    if (lastWord.startsWith('@')) {
      const query = lastWord.slice(1).toLowerCase();
      // Filtrar usuarios activos menos yo
      const matches = engine.onlineUsers.filter(u => 
        u.nickname !== engine.nickname && 
        u.nickname.toLowerCase().startsWith(query)
      );
      
      if (matches.length > 0) {
        showSuggestions(matches);
      } else {
        hideSuggestions();
      }
    } else {
      hideSuggestions();
    }
  });

  // Manejar teclado para navegar y seleccionar sugerencias
  DOM.messageInput.addEventListener('keydown', (e) => {
    if (suggestionMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex + 1) % suggestionMatches.length;
        updateActiveSuggestionItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedSuggestionIndex = (selectedSuggestionIndex - 1 + suggestionMatches.length) % suggestionMatches.length;
        updateActiveSuggestionItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const activeUser = suggestionMatches[selectedSuggestionIndex];
        if (activeUser) {
          selectSuggestion(activeUser.nickname);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideSuggestions();
      }
    }
  });

  // Adjuntar imagen botones
  DOM.btnTriggerUpload.addEventListener('click', () => {
    DOM.imageUploadInput.click();
  });

  DOM.imageUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Solo se admiten archivos de imagen');
        return;
      }
      
      // Validar peso máximo de 3MB para evitar saturar el WebSocket
      if (file.size > 3 * 1024 * 1024) {
        alert('La imagen supera el límite de 3MB de seguridad.');
        return;
      }

      selectedFile = file;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        DOM.attachedImagePreview.src = e.target.result;
        DOM.imagePreviewBar.classList.add('active');
      };
      reader.readAsDataURL(file);
    }
  });

  DOM.btnRemoveAttachedImage.addEventListener('click', () => {
    resetImageAttachmentUI();
  });

  // Cerrar sesión al cerrar la pestaña o recargar (solo si es efímero)
  window.addEventListener('beforeunload', () => {
    if (!engine.isPersistent) {
      // Intentamos cerrar la conexión limpiamente
      if (engine.ws) {
        engine.ws.close();
      }
    }
  });

  // Toggle de barra de detalles derecha
  DOM.btnToggleDetails.addEventListener('click', () => {
    DOM.sidebarDetails.classList.toggle('inactive');
  });
  
  DOM.btnCloseDetails.addEventListener('click', () => {
    DOM.sidebarDetails.classList.add('inactive');
  });

  // Acciones en panel de detalles
  DOM.btnClearChatHistory.addEventListener('click', () => {
    const chatName = activeChat.type === 'group' ? `#${activeChat.id}` : `@${activeChat.id}`;
    if (confirm(`¿Vaciar todo el historial local con ${chatName}? No afectará a los otros participantes.`)) {
      engine.clearActiveChat(activeChat.id, activeChat.type === 'private');
    }
  });

  DOM.btnDownloadTranscript.addEventListener('click', () => {
    downloadChatTranscript();
  });

  // Comportamientos móviles
  DOM.mobileMenuToggle.addEventListener('click', () => {
    DOM.sidebarLeft.classList.add('active');
    sidebarOverlay.classList.add('active');
  });

  sidebarOverlay.addEventListener('click', () => {
    DOM.sidebarLeft.classList.remove('active');
    sidebarOverlay.classList.remove('active');
  });

  // Modal visualizador de imagen grande
  DOM.closeImageViewer.addEventListener('click', () => {
    DOM.imageViewerModal.classList.remove('active');
  });
  
  // Cerrar visor al hacer click fuera de la foto
  DOM.imageViewerModal.addEventListener('click', (e) => {
    if (e.target === DOM.imageViewerModal || e.target === DOM.closeImageViewer) {
      DOM.imageViewerModal.classList.remove('active');
    }
  });

  // Ocultar sugerencias al hacer clic fuera del input
  document.addEventListener('click', (e) => {
    if (DOM.mentionSuggestions && !DOM.mentionSuggestions.contains(e.target) && e.target !== DOM.messageInput) {
      hideSuggestions();
    }
  });

  // Event delegation en el feed de mensajes para DMs y menciones clickables
  DOM.messagesFeed.addEventListener('click', (e) => {
    const senderEl = e.target.closest('.sender-name');
    if (senderEl) {
      const sender = senderEl.dataset.sender;
      if (sender && sender !== engine.nickname) {
        changeActiveChat(sender, 'private');
      }
      return;
    }

    const mentionEl = e.target.closest('.clickable-mention');
    if (mentionEl) {
      const nick = mentionEl.dataset.nickname;
      if (nick && nick !== engine.nickname) {
        changeActiveChat(nick, 'private');
      }
      return;
    }
  });
});

// -------------------------------------------------------------
// FUNCIONES AUXILIARES DE LA UI Y LÓGICA
// -------------------------------------------------------------

function generateInitialAvatar() {
  const randomSeed = Math.random().toString(36).substring(7);
  currentAvatarDataUrl = generateAvatar(`User_${randomSeed}`);
  DOM.avatarPreview.src = currentAvatarDataUrl;
}

function updateConnectionUI(status) {
  // Remover todas las clases
  DOM.connectionBadge.className = 'connection-badge';
  DOM.mobileConnectionDot.className = 'connection-status-dot';
  
  const label = DOM.connectionBadge.querySelector('.badge-label');
  
  switch (status) {
    case 'CONNECTED':
      DOM.connectionBadge.classList.add('connected');
      DOM.mobileConnectionDot.classList.add('connected');
      label.innerText = 'Seguro';
      break;
    case 'CONNECTING':
      DOM.connectionBadge.classList.add('connecting');
      DOM.mobileConnectionDot.classList.add('connecting');
      label.innerText = 'Conectando';
      break;
    case 'DISCONNECTED':
    default:
      DOM.connectionBadge.classList.add('disconnected');
      DOM.mobileConnectionDot.classList.add('disconnected');
      label.innerText = 'Desconectado';
      break;
  }
}

function updatePersistenceButtonUI(isPersistent) {
  if (isPersistent) {
    DOM.persistenceModeLabel.innerText = 'Modo Persistente';
    DOM.btnTogglePersistenceSidebar.classList.remove('btn-secondary');
    DOM.btnTogglePersistenceSidebar.classList.add('btn-primary');
    if (DOM.persistenceToggle) DOM.persistenceToggle.checked = true;
  } else {
    DOM.persistenceModeLabel.innerText = 'Modo Efímero';
    DOM.btnTogglePersistenceSidebar.classList.remove('btn-primary');
    DOM.btnTogglePersistenceSidebar.classList.add('btn-secondary');
    if (DOM.persistenceToggle) DOM.persistenceToggle.checked = false;
  }
}

// Cambiar el chat seleccionado
function changeActiveChat(chatId, type) {
  activeChat = { id: chatId, type };
  
  // Limpiar no leídos
  const key = `${type === 'group' ? 'room' : 'user'}-${chatId}`;
  unreadCounts.delete(key);
  
  // Quitar sidebar móvil si estuviera abierto
  DOM.sidebarLeft.classList.remove('active');
  sidebarOverlay.classList.remove('active');
  
  // Refrescar paneles
  renderRooms();
  renderOnlineUsers();
  renderMessages();
  updateChatDetailsPanel();
  scrollToBottom();
  
  // Enfocar input
  DOM.messageInput.focus();
}

// Renderizar lista de salas
function renderRooms() {
  DOM.roomsList.innerHTML = '';
  
  engine.rooms.forEach(room => {
    const key = `room-${room.id}`;
    const unread = unreadCounts.get(key) || 0;
    const isActive = activeChat.type === 'group' && activeChat.id === room.id;
    
    const div = document.createElement('div');
    div.className = `list-item ${isActive ? 'active' : ''}`;
    div.innerHTML = `
      <div class="list-item-content">
        <i data-lucide="hash" class="list-item-avatar" style="padding: 3px; color: var(--text-muted)"></i>
        <span class="list-item-name">${room.name}</span>
      </div>
      ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
    `;
    
    div.addEventListener('click', () => {
      changeActiveChat(room.id, 'group');
    });
    
    DOM.roomsList.appendChild(div);
  });
  
  initLucide();
}

// Renderizar lista de usuarios online
function renderOnlineUsers() {
  DOM.usersList.innerHTML = '';
  
  // Filtrar para no mostrarme a mí mismo en la lista
  const otherUsers = engine.onlineUsers.filter(u => u.nickname !== engine.nickname);
  DOM.usersOnlineCount.innerText = otherUsers.length;
  
  if (otherUsers.length === 0) {
    DOM.usersList.innerHTML = `<div style="padding: 10px 20px; font-size: 0.8rem; color: var(--text-dim); text-align: center;">Nadie más en línea</div>`;
    return;
  }
  
  otherUsers.forEach(user => {
    const key = `user-${user.nickname}`;
    const unread = unreadCounts.get(key) || 0;
    const isActive = activeChat.type === 'private' && activeChat.id === user.nickname;
    
    const div = document.createElement('div');
    div.className = `list-item ${isActive ? 'active' : ''}`;
    div.innerHTML = `
      <div class="list-item-content">
        <img class="list-item-avatar" src="${user.avatar}" alt="${user.nickname}">
        <span class="list-item-name">${user.nickname}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
        <span class="list-item-indicator"></span>
      </div>
    `;
    
    div.addEventListener('click', () => {
      changeActiveChat(user.nickname, 'private');
    });
    
    DOM.usersList.appendChild(div);
  });
  
  initLucide();
}

// Comprobar si el mensaje entrante es para el panel de chat actual
function isMessageForCurrentChat(message) {
  if (activeChat.type === 'group') {
    return message.roomId === activeChat.id;
  } else {
    // Para privado, el mensaje debe ser entre el usuario activo y yo
    const isPrivate = !message.roomId;
    if (!isPrivate) return false;
    
    const matches = (message.sender === activeChat.id && message.recipient === engine.nickname) ||
                    (message.sender === engine.nickname && message.recipient === activeChat.id);
    return matches;
  }
}

// Renderizar los mensajes del chat activo
function renderMessages() {
  DOM.messagesFeed.innerHTML = '';
  
  // Filtrar mensajes de acuerdo al chat activo
  const filteredMessages = engine.messages.filter(msg => {
    if (activeChat.type === 'group') {
      return msg.roomId === activeChat.id;
    } else {
      // Privados entre activeChat.id y yo
      if (msg.roomId) return false;
      if (msg.type === 'system') return false;
      return (msg.sender === activeChat.id && msg.recipient === engine.nickname) ||
             (msg.sender === engine.nickname && msg.recipient === activeChat.id);
    }
  });

  if (filteredMessages.length === 0) {
    const isGroup = activeChat.type === 'group';
    const name = isGroup ? `#${activeChat.id}` : `@${activeChat.id}`;
    DOM.messagesFeed.innerHTML = `
      <div style="margin: auto; text-align: center; max-width: 320px; padding: 40px 20px; display: flex; flex-direction: column; gap: 12px; color: var(--text-dim);">
        <div style="width: 50px; height: 50px; border-radius: 50%; background-color: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; margin: 0 auto; color: var(--text-muted)">
          <i data-lucide="${isGroup ? 'hash' : 'lock'}"></i>
        </div>
        <h4 style="color: var(--text-muted)">El historial está vacío</h4>
        <p style="font-size: 0.8rem; line-height: 1.4;">Los mensajes enviados aquí ${isGroup ? 'se difunden públicamente' : 'están cifrados y son 100% privados'}. No quedan guardados en ningún servidor.</p>
      </div>
    `;
    initLucide();
    return;
  }

  filteredMessages.forEach(msg => {
    if (msg.type === 'system') {
      const sysDiv = document.createElement('div');
      sysDiv.className = `system-message ${msg.styleClass || ''}`;
      sysDiv.innerHTML = `
        <i data-lucide="${msg.icon || 'info'}"></i>
        <span>${msg.content}</span>
      `;
      DOM.messagesFeed.appendChild(sysDiv);
      return;
    }

    const isOwn = msg.sender === engine.nickname;
    const isPrivateMessage = !msg.roomId;
    
    // Formatear hora
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Comprobar si el usuario actual fue mencionado en este mensaje
    const hasMention = msg.content && msg.content.includes(`@${engine.nickname}`);
    
    const row = document.createElement('div');
    row.className = `message-row ${isOwn ? 'own' : ''} ${isPrivateMessage ? 'private-chat' : ''} ${hasMention ? 'mentioned' : ''}`;
    
    // Formatear menciones de arroba a etiquetas HTML con clase clickable-mention
    let formattedContent = escapeHTML(msg.content);
    formattedContent = formattedContent.replace(/@([a-zA-Z0-9_À-ÿ-]+)/g, (match, nick) => {
      return `<span class="mention clickable-mention" data-nickname="${nick}">@${nick}</span>`;
    });
    
    row.innerHTML = `
      <img class="msg-avatar" src="${msg.avatar}" alt="${msg.sender}">
      <div class="message-box">
        <div class="message-meta">
          <span class="sender-name" data-sender="${msg.sender}">${isOwn ? 'Tú' : msg.sender}</span>
          ${isPrivateMessage ? `<span class="private-badge"><i data-lucide="lock" style="width: 10px; height: 10px;"></i> Privado</span>` : ''}
          <span class="msg-time">${timeStr}</span>
        </div>
        <div class="message-content-bubble">
          <div class="message-content">${formattedContent}</div>
          ${msg.image ? `<img class="message-attachment-img" src="${msg.image}" alt="Imagen adjunta">` : ''}
        </div>
      </div>
    `;
    
    // Añadir listener para abrir imagen grande en modal si existe adjunto
    if (msg.image) {
      const img = row.querySelector('.message-attachment-img');
      img.addEventListener('click', () => {
        openImageViewer(msg.image, `Enviado por ${msg.sender} el ${new Date(msg.timestamp).toLocaleString()}`);
      });
    }

    DOM.messagesFeed.appendChild(row);
  });

  initLucide();
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Hacer scroll al fondo de la conversación
function scrollToBottom() {
  DOM.messagesFeed.scrollTop = DOM.messagesFeed.scrollHeight;
}

// Resetear los inputs e UI de adjuntar imagen
function resetImageAttachmentUI() {
  selectedFile = null;
  DOM.imageUploadInput.value = '';
  DOM.attachedImagePreview.src = '';
  DOM.imagePreviewBar.classList.remove('active');
}

// Actualizar el panel lateral de detalles de chat (derecha)
function updateChatDetailsPanel() {
  const isGroup = activeChat.type === 'group';
  
  if (isGroup) {
    const room = engine.rooms.find(r => r.id === activeChat.id) || { name: activeChat.id, description: 'Sala de chat' };
    DOM.activeChatTitle.innerText = `#${room.name}`;
    DOM.activeChatDesc.innerText = room.description;
    
    DOM.detailsTitle.innerText = `#${room.name}`;
    DOM.detailsDescription.innerText = room.description;
    DOM.detailsIcon.setAttribute('data-lucide', 'hash');
  } else {
    // Buscar avatar del destinatario
    const user = engine.onlineUsers.find(u => u.nickname === activeChat.id) || { avatar: generateAvatar(activeChat.id) };
    
    DOM.activeChatTitle.innerText = `@${activeChat.id}`;
    DOM.activeChatDesc.innerText = 'Chat directo y privado (Seguro)';
    
    DOM.detailsTitle.innerText = `@${activeChat.id}`;
    DOM.detailsDescription.innerText = 'Mensajería directa encriptada en tránsito. Ningún dato se almacena fuera del navegador.';
    DOM.detailsIcon.setAttribute('data-lucide', 'lock');
  }
  
  initLucide();
}

// Abrir imagen grande en pantalla completa
function openImageViewer(src, caption) {
  DOM.modalImg.src = src;
  DOM.imageViewerCaption.innerText = caption;
  DOM.btnDownloadModalImg.href = src;
  DOM.imageViewerModal.classList.add('active');
}

// Enviar estado de escritura al servidor
function sendTypingStatus(isTyping) {
  if (engine.status !== 'CONNECTED') return;
  
  isTypingState = isTyping;
  if (activeChat.type === 'group') {
    engine.sendTyping(isTyping, null, activeChat.id);
  } else {
    engine.sendTyping(isTyping, activeChat.id, null);
  }
}

// Eliminar un indicador de escritura
function removeTypingIndicator(key) {
  const ind = activeTypingIndicators.get(key);
  if (ind) {
    clearTimeout(ind.timeoutId);
    activeTypingIndicators.delete(key);
  }
}

// Actualizar la lista en pantalla de personas escribiendo
function updateTypingUI() {
  // Buscar si alguien escribe en el chat activo
  let typingUsernames = [];
  
  activeTypingIndicators.forEach(value => {
    if (activeChat.type === 'group' && value.roomId === activeChat.id) {
      typingUsernames.push(value.sender);
    } else if (activeChat.type === 'private' && !value.roomId && value.sender === activeChat.id) {
      typingUsernames.push(value.sender);
    }
  });

  if (typingUsernames.length > 0) {
    const text = typingUsernames.length === 1 
      ? `<b>${typingUsernames[0]}</b> está escribiendo...`
      : `Varios usuarios están escribiendo...`;
    
    DOM.typingIndicator.querySelector('.typing-text').innerHTML = text;
    DOM.typingIndicator.classList.add('active');
  } else {
    DOM.typingIndicator.classList.remove('active');
  }
}

// Descargar historial del chat activo
function downloadChatTranscript() {
  // Filtrar los mismos mensajes
  const filtered = engine.messages.filter(msg => {
    if (activeChat.type === 'group') {
      return msg.roomId === activeChat.id;
    } else {
      if (msg.roomId || msg.type === 'system') return false;
      return (msg.sender === activeChat.id && msg.recipient === engine.nickname) ||
             (msg.sender === engine.nickname && msg.recipient === activeChat.id);
    }
  });

  if (filtered.length === 0) {
    alert('No hay historial de chat para exportar.');
    return;
  }

  // Dar formato legible
  let outputText = `HISTORIAL DE CHAT: ${activeChat.type === 'group' ? '#' : '@'}${activeChat.id}\n`;
  outputText += `Exportado el: ${new Date().toLocaleString()}\n`;
  outputText += `==========================================\n\n`;

  filtered.forEach(msg => {
    if (msg.type === 'system') {
      outputText += `[SISTEMA] [${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.content}\n`;
    } else {
      const time = new Date(msg.timestamp).toLocaleString();
      outputText += `[${time}] ${msg.sender}: ${msg.content}\n`;
      if (msg.image) {
        outputText += `[Imagen Adjunta: Incluida en formato Base64/Objeto]\n`;
      }
    }
  });

  const blob = new Blob([outputText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `privachat_historial_${activeChat.id}_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Reproducir sonido sutil de notificación (campana apagada si no interactúa, atrapado por navegadores)
function playNotificationSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Crear oscilador simple
    const osc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioContext.currentTime); // D5 note
    osc.frequency.setValueAtTime(880, audioContext.currentTime + 0.1); // A5 note
    
    gainNode.gain.setValueAtTime(0.05, audioContext.currentTime); // Volumen sutil
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35); // Apagado rápido
    
    osc.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    osc.start();
    osc.stop(audioContext.currentTime + 0.35);
  } catch (e) {
    // Ignorar errores de autoplay del navegador si el usuario no ha hecho foco todavía
  }
}
