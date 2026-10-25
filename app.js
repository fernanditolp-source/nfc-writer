/**
 * NFC Studio Web - Core Engine
 * Integrates Web NFC API (NDEFReader) with haptics, Web Audio synth, batch writing and desktop simulator.
 */

// State Management
const HISTORY_KEY = 'nfc_studio_history_v2';
const HISTORY_SETTING_KEY = 'nfc_studio_history_enabled';
const TAG_CAPACITIES = Object.freeze({
  NTAG213: 144,
  NTAG215: 504,
  NTAG216: 888
});

function readHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    return [];
  }
}

const state = {
  soundEnabled: true,
  isNfcSupported: false,
  isSimulatorActive: false,
  currentType: 'url',
  isWriting: false,
  isReading: false,
  batchCount: 0,
  abortController: null,
  selectedTag: 'NTAG213',
  history: readHistory(),
  historyEnabled: localStorage.getItem(HISTORY_SETTING_KEY) === 'true',
};

// Web Audio API Synthesizer (No external MP3 files needed)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (!state.soundEnabled) return;
  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    if (type === 'success') {
      // Pleasant futuristic two-tone chime
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
      osc2.frequency.setValueAtTime(880, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.28); // D6

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);

      osc1.start(now);
      osc2.start(now + 0.1);
      osc1.stop(now + 0.35);
      osc2.stop(now + 0.35);
    } else if (type === 'error') {
      // Gentle warning buzz
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.22);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'ping') {
      // Radar subtle blip
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, now); // C6
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch (err) {
    console.debug('Audio error:', err);
  }
}

// Haptic feedback for mobile
function triggerVibrate(pattern = [80, 50, 80]) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

function escapeWifiField(value) {
  return String(value)
    .split('\\').join('\\\\')
    .split(';').join('\\;')
    .split(':').join('\\:')
    .split(',').join('\\,')
    .split('"').join('\\"');
}

function estimateRecordBytes(records) {
  return records.reduce((total, record) => {
    const payloadBytes = typeof record.data === 'string'
      ? new TextEncoder().encode(record.data).length
      : record.data instanceof Uint8Array
        ? record.data.length
        : 0;
    return total + payloadBytes + 8;
  }, 0);
}

function getSelectedTagCapacity() {
  return TAG_CAPACITIES[state.selectedTag] || TAG_CAPACITIES.NTAG213;
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.replaceChildren(
    Object.assign(document.createElement('span'), { textContent: icon }),
    Object.assign(document.createElement('span'), { textContent: String(message) })
  );
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// Check Web NFC support and Secure Context
function checkNfcCompatibility() {
  const badge = document.getElementById('compat-badge');
  const banner = document.getElementById('compat-banner');
  const compatTitle = document.getElementById('compat-title');
  const compatDesc = document.getElementById('compat-desc');

  const hasNdef = 'NDEFReader' in window;
  const isSecure = window.isSecureContext;

  if (hasNdef && isSecure) {
    state.isNfcSupported = true;
    badge.textContent = 'NFC Disponible';
    badge.className = 'badge ready';
    banner.classList.add('hidden');
  } else {
    state.isNfcSupported = false;
    badge.textContent = 'Simulador / Sin NFC';
    badge.className = 'badge sim';
    banner.classList.remove('hidden');

    if (!isSecure) {
      compatTitle.textContent = 'Conexión no segura (HTTPS requerida)';
      compatDesc.textContent = 'Web NFC exige abrir la página en HTTPS o localhost. Mira la guía de conexión en el botón (?)';
    } else {
      compatTitle.textContent = 'Dispositivo sin Web NFC detectado';
      compatDesc.textContent = 'Para grabar físicamente, abre esta web en Google Chrome desde un Android con NFC. Puedes probar todas las funciones usando el Simulador aquí.';
    }
  }
}

// Build NDEF records based on user selection
function buildRecords() {
  const type = state.currentType;
  let records = [];
  let summaryText = '';

  switch (type) {
    case 'url': {
      let rawUrl = document.getElementById('input-url').value.trim();
      if (!rawUrl) throw new Error('Por favor ingresa una URL válida');
      if (!/^https?:\/\//i.test(rawUrl)) {
        rawUrl = 'https://' + rawUrl;
      }
      try {
        const parsedUrl = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
          throw new Error();
        }
        rawUrl = parsedUrl.href;
      } catch (error) {
        throw new Error('Ingresa una URL válida (por ejemplo, ejemplo.com)');
      }
      records = [{ recordType: 'url', data: rawUrl }];
      summaryText = rawUrl;
      break;
    }

    case 'text': {
      const text = document.getElementById('input-text').value.trim();
      if (!text) throw new Error('Por favor ingresa algún texto');
      records = [{ recordType: 'text', data: text }];
      summaryText = text.substring(0, 50) + (text.length > 50 ? '...' : '');
      break;
    }

    case 'vcard': {
      const fname = document.getElementById('vcard-fname').value.trim();
      const lname = document.getElementById('vcard-lname').value.trim();
      const phone = document.getElementById('vcard-phone').value.trim();
      const email = document.getElementById('vcard-email').value.trim();
      const org = document.getElementById('vcard-org').value.trim();
      const title = document.getElementById('vcard-title').value.trim();
      const url = document.getElementById('vcard-url').value.trim();

      if (!fname && !lname && !phone && !email) {
        throw new Error('Ingresa al menos nombre o teléfono para la tarjeta de contacto');
      }

      const fullName = [fname, lname].filter(Boolean).join(' ');
      const escapeVCard = value => String(value).replace(/[\\;,\r\n]/g, match => ({
        '\\': '\\\\', ';': '\\;', ',': '\\,', '\r': '\\n', '\n': '\\n'
      }[match]));
      let vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\n';
      vcard += `N:${escapeVCard(lname)};${escapeVCard(fname)};;;\r\n`;
      vcard += `FN:${escapeVCard(fullName || 'Contacto NFC')}\r\n`;
      if (org) vcard += `ORG:${escapeVCard(org)}\r\n`;
      if (title) vcard += `TITLE:${escapeVCard(title)}\r\n`;
      if (phone) vcard += `TEL;TYPE=CELL,VOICE:${phone}\r\n`;
      if (email) vcard += `EMAIL;TYPE=PREF,INTERNET:${email}\r\n`;
      if (url) {
        try {
          const parsedUrl = new URL(url);
          if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
        } catch (error) {
          throw new Error('El sitio web del contacto no es válido');
        }
        vcard += `URL:${url}\r\n`;
      }
      vcard += 'END:VCARD';

      records = [{
        recordType: 'mime',
        mediaType: 'text/vcard',
        data: new TextEncoder().encode(vcard)
      }];
      summaryText = `Contacto: ${fullName || phone}`;
      break;
    }

    case 'wifi': {
      const ssid = document.getElementById('wifi-ssid').value.trim();
      const pass = document.getElementById('wifi-pass').value;
      const auth = document.getElementById('wifi-auth').value;
      const hidden = document.getElementById('wifi-hidden').checked;

      if (!ssid) throw new Error('Por favor ingresa el nombre de la red Wi-Fi (SSID)');

      // Standard Android Wi-Fi tag format: WIFI:S:<SSID>;T:<WPA|WEP|nopass>;P:<PASSWORD>;H:<true|false>;;
      const wifiPayload = `WIFI:S:${escapeWifiField(ssid)};T:${auth};P:${escapeWifiField(pass)};H:${hidden ? 'true' : 'false'};;`;
      records = [{ recordType: 'text', data: wifiPayload }];
      summaryText = `Wi-Fi: ${ssid} (${auth})`;
      break;
    }

    case 'whatsapp': {
      const phone = document.getElementById('wa-phone').value.replace(/[^0-9]/g, '');
      const msg = document.getElementById('wa-msg').value.trim();
      if (!phone) throw new Error('Ingresa el número de WhatsApp con código de país');

      let waUrl = `https://wa.me/${phone}`;
      if (msg) waUrl += `?text=${encodeURIComponent(msg)}`;
      records = [{ recordType: 'url', data: waUrl }];
      summaryText = `WhatsApp: +${phone}`;
      break;
    }

    case 'phone': {
      const phone = document.getElementById('phone-number').value.trim();
      if (!phone) throw new Error('Ingresa el número de teléfono');
      records = [{ recordType: 'url', data: `tel:${phone}` }];
      summaryText = `Llamar a: ${phone}`;
      break;
    }

    case 'email': {
      const to = document.getElementById('email-to').value.trim();
      const subject = document.getElementById('email-subject').value.trim();
      const body = document.getElementById('email-body').value.trim();
      if (!to) throw new Error('Ingresa un correo electrónico de destino');

      let mailto = `mailto:${to}`;
      const params = [];
      if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
      if (body) params.push(`body=${encodeURIComponent(body)}`);
      if (params.length) mailto += `?${params.join('&')}`;

      records = [{ recordType: 'url', data: mailto }];
      summaryText = `Email: ${to}`;
      break;
    }

    case 'json': {
      const mime = document.getElementById('custom-mime').value.trim() || 'application/json';
      const content = document.getElementById('custom-data').value.trim();
      if (!content) throw new Error('Ingresa los datos para el registro personalizado');
      if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) {
        throw new Error('El tipo MIME no es válido');
      }

      records = [{
        recordType: 'mime',
        mediaType: mime,
        data: new TextEncoder().encode(content)
      }];
      summaryText = `MIME [${mime}]: ${content.substring(0, 30)}...`;
      break;
    }
  }

  return { records, summaryText, type };
}

// Calculate and update payload size estimation
function updateSizeEstimate() {
  try {
    const { records } = buildRecords();
    const bytes = estimateRecordBytes(records);
    const capacity = getSelectedTagCapacity();

    const countEl = document.getElementById('bytes-count');
    const fillEl = document.getElementById('size-progress');
    const capacityLabel = document.getElementById('chip-capacity-label');
    countEl.textContent = bytes;
    capacityLabel.textContent = `Capacidad seleccionada: ${state.selectedTag} (${capacity}B)`;

    const pct = Math.min(100, Math.round((bytes / capacity) * 100));
    fillEl.style.width = `${Math.max(5, pct)}%`;

    if (bytes > capacity) {
      fillEl.className = 'progress-fill danger';
    } else if (bytes > capacity * 0.8) {
      fillEl.className = 'progress-fill warning';
    } else {
      fillEl.className = 'progress-fill';
    }
  } catch (e) {
    // Missing input is fine
  }
}

// Save write action to History
function getFormSnapshot(type) {
  const selectors = {
    url: ['input-url'], text: ['input-text'],
    vcard: ['vcard-fname', 'vcard-lname', 'vcard-phone', 'vcard-email', 'vcard-org', 'vcard-title', 'vcard-url'],
    wifi: ['wifi-ssid', 'wifi-pass', 'wifi-auth', 'wifi-hidden'],
    whatsapp: ['wa-phone', 'wa-msg'], phone: ['phone-number'],
    email: ['email-to', 'email-subject', 'email-body'], json: ['custom-mime', 'custom-data']
  }[type] || [];
  return Object.fromEntries(selectors.map(id => {
    const el = document.getElementById(id);
    return [id, el?.type === 'checkbox' ? el.checked : (el?.value || '')];
  }));
}

function applyFormSnapshot(fields) {
  Object.entries(fields || {}).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  });
}

function saveToHistory(summaryText, type) {
  const item = {
    id: Date.now(),
    date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    type,
    tag: state.selectedTag,
    summary: summaryText,
    fields: getFormSnapshot(type)
  };
  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop();
  if (state.historyEnabled) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  }
  renderHistory();
}

function renderHistory() {
  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');

  if (!state.history.length) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyEl);
    emptyEl.style.display = 'block';
    return;
  }

  listEl.innerHTML = '';
  state.history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `
      <div class="history-details">
        <div class="history-title-row">
          <span class="history-type-tag">${item.type.toUpperCase()}</span>
          <span class="history-time">${item.date}</span>
        </div>
        <div class="history-payload">${escapeHtml(item.summary)}</div>
      </div>
      <button class="btn-mini" data-id="${item.id}" title="Reutilizar">Usar</button>
    `;
    el.querySelector('button').addEventListener('click', () => loadHistoryItem(item));
    listEl.appendChild(el);
  });
}

function loadHistoryItem(item) {
  // Switch to write tab and load type
  switchTab('tab-write');
  if (item.tag && TAG_CAPACITIES[item.tag]) {
    document.querySelector(`.tag-option[data-tag="${item.tag}"]`)?.click();
  }
  selectType(item.type);

  if (item.fields) {
    applyFormSnapshot(item.fields);
  } else if (item.type === 'url') {
    document.getElementById('input-url').value = item.summary.replace(/^https?:\/\//, '');
  } else if (item.type === 'text') {
    document.getElementById('input-text').value = item.summary;
  }
  updateSizeEstimate();
  showToast(`Plantilla cargada: ${item.type.toUpperCase()}`, 'info');
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

// WRITE NFC PROCESS
async function startNfcWrite() {
  let recordsData;
  try {
    recordsData = buildRecords();
  } catch (err) {
    showToast(err.message, 'error');
    playSound('error');
    return;
  }

  const estimatedBytes = estimateRecordBytes(recordsData.records);
  const tagCapacity = getSelectedTagCapacity();
  if (estimatedBytes > tagCapacity) {
    showToast(`El contenido ocupa aproximadamente ${estimatedBytes}B y supera la capacidad del ${state.selectedTag} (${tagCapacity}B).`, 'error');
    playSound('error');
    return;
  }

  const isBatch = document.getElementById('chk-batch-mode').checked;
  const isLock = document.getElementById('chk-lock-tag').checked;

  if (isLock) {
    const confirmLock = confirm(
      '⚠️ ATENCIÓN: Has marcado "Hacer Chip de Solo Lectura".\n\n' +
      'Esta operación es permanente e IRREVERSIBLE. El chip no podrá borrarse ni volverse a escribir nunca más.\n\n' +
      '¿Deseas continuar?'
    );
    if (!confirmLock) return;
  }

  // Open Radar Modal
  openModal('write', isBatch);
  state.isWriting = true;
  state.abortController = new AbortController();

  if (!state.isNfcSupported || state.isSimulatorActive) {
    // Simulator flow
    setupSimulatorTrigger(async () => {
      handleSuccessfulWrite(recordsData, isBatch, false, true);
    });
    return;
  }

  // Real Web NFC API execution
  try {
    const ndef = new NDEFReader();
    const signal = state.abortController.signal;

    if (isLock && typeof ndef.makeReadOnly !== 'function') {
      throw new Error('Este navegador no permite bloquear chips como solo lectura.');
    }

    const performWrite = async () => {
      setModalStatus('Acerca el chip a la antena del teléfono...');
      playSound('ping');

      await ndef.write(recordsData.records, { signal, overwrite: true });

      if (isLock) {
        setModalStatus('Bloqueando chip como solo lectura...');
        await ndef.makeReadOnly({ signal });
      }

      handleSuccessfulWrite(recordsData, isBatch, isLock, false);
    };

    if (isBatch) {
      while (state.isWriting) {
        await performWrite();
        if (state.isWriting) setModalStatus('Chip grabado ✅. Acerca el SIGUIENTE chip...');
      }
    } else {
      await performWrite();
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Operación NFC cancelada por el usuario');
    } else {
      console.error('Error al escribir NFC:', err);
      let msg = 'Error al escribir el chip';
      if (err.name === 'NotAllowedError') {
        msg = 'Permiso NFC denegado en Chrome';
      } else if (err.name === 'NotSupportedError') {
        msg = 'Dispositivo o chip no compatible con NDEF';
      } else if (err.name === 'NetworkError') {
        msg = 'Chip retirado demasiado rápido. Mantenlo firme.';
      }
      showToast(err.message && err.message.startsWith('Este navegador') ? err.message : msg, 'error');
      playSound('error');
      closeModal();
    }
  }
}

function handleSuccessfulWrite(recordsData, isBatch, isLock, simulated = false) {
  state.batchCount++;
  playSound('success');
  triggerVibrate([100, 50, 100, 50, 150]);
  saveToHistory(recordsData.summaryText, recordsData.type);

  const lockLabel = isLock ? ' (Bloqueado)' : '';
  showToast(`¡Chip grabado con éxito!${lockLabel}${simulated ? ' (Simulación)' : ''}`, 'success');

  if (isBatch) {
    document.getElementById('batch-count-num').textContent = state.batchCount;
    setModalStatus('¡Éxito! Acerca el SIGUIENTE chip...');
  } else {
    setTimeout(closeModal, 1100);
  }
}

// READ NFC PROCESS
async function startNfcRead() {
  const readChip = document.getElementById('read-status-chip');
  const readBtnText = document.getElementById('btn-read-text');

  if (state.isReading) {
    stopNfcRead();
    return;
  }

  openModal('read', false);
  state.isReading = true;
  state.abortController = new AbortController();
  readChip.textContent = 'Buscando...';
  readChip.className = 'tag-chip live-chip active';
  readBtnText.textContent = 'Detener Escaneo';

  if (!state.isNfcSupported || state.isSimulatorActive) {
    setupSimulatorTrigger(() => {
      handleSimulatedRead();
    });
    return;
  }

  try {
    const ndef = new NDEFReader();
    await ndef.scan({ signal: state.abortController.signal });

    ndef.onreadingerror = () => {
      showToast('Error al leer el chip. Intenta apoyarlo nuevamente.', 'error');
      playSound('error');
    };

    ndef.onreading = (event) => {
      playSound('success');
      triggerVibrate([80, 50, 80]);
      closeModal();
      displayReadTag(event.serialNumber, event.message.records);
    };

  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast('No se pudo activar el lector NFC: ' + err.message, 'error');
      playSound('error');
    }
    stopNfcRead();
    closeModal();
  }
}

function stopNfcRead() {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  state.isReading = false;
  const readChip = document.getElementById('read-status-chip');
  const readBtnText = document.getElementById('btn-read-text');
  readChip.textContent = 'Inactivo';
  readChip.className = 'tag-chip live-chip';
  readBtnText.textContent = 'Escanear Chip NFC';
}

function displayReadTag(serialNumber, records) {
  const resultCard = document.getElementById('tag-result-card');
  const uidEl = document.getElementById('tag-uid');
  const listEl = document.getElementById('tag-records-list');

  uidEl.textContent = serialNumber || '04:A2:8B:11:39:6F';
  listEl.innerHTML = '';

  if (!records || !records.length) {
    listEl.innerHTML = '<div class="record-item"><div class="record-content">Chip vacío (sin registros NDEF)</div></div>';
  } else {
    records.forEach((record, idx) => {
      const parsed = parseNdefRecord(record);
      const itemEl = document.createElement('div');
      itemEl.className = 'record-item';
      itemEl.innerHTML = `
        <div class="record-meta">
          <span class="record-type-badge">${escapeHtml(record.recordType)} (${parsed.displayType})</span>
          <span>#${idx + 1}</span>
        </div>
        <div class="record-content font-mono">${escapeHtml(parsed.text)}</div>
      `;
      listEl.appendChild(itemEl);
    });
  }

  resultCard.classList.remove('hidden');
  resultCard.scrollIntoView({ behavior: 'smooth' });
  showToast('¡Chip NFC leído correctamente!', 'success');
}

function parseNdefRecord(record) {
  let displayType = 'Desconocido';
  let text = '';

  try {
    if (record.recordType === 'text') {
      displayType = 'Texto';
      const textDecoder = new TextDecoder(record.encoding || 'utf-8');
      text = textDecoder.decode(record.data);
    } else if (record.recordType === 'url') {
      displayType = 'URL';
      const textDecoder = new TextDecoder();
      text = textDecoder.decode(record.data);
    } else if (record.recordType === 'mime') {
      displayType = record.mediaType || 'MIME';
      const textDecoder = new TextDecoder();
      text = textDecoder.decode(record.data);
    } else {
      displayType = record.recordType;
      const textDecoder = new TextDecoder();
      text = textDecoder.decode(record.data);
    }
  } catch (e) {
    text = `[Binario: ${record.data ? record.data.byteLength : 0} bytes]`;
  }

  return { displayType, text };
}

// Simulator Trigger Setup (for Mac/Desktop or browsers without Web NFC)
function setupSimulatorTrigger(callback) {
  const simBtn = document.getElementById('btn-sim-trigger-tap');
  simBtn.classList.remove('hidden');
  simBtn.onclick = () => {
    callback();
  };
}

function handleSimulatedRead() {
  playSound('success');
  triggerVibrate([80, 50, 80]);
  closeModal();

  const fakeUID = Array.from({ length: 7 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  const dummyRecords = [
    {
      recordType: 'url',
      data: new TextEncoder().encode('https://antigravity.dev')
    },
    {
      recordType: 'text',
      encoding: 'utf-8',
      data: new TextEncoder().encode('Chip NFC NTAG215 Demo #042')
    }
  ];

  displayReadTag(fakeUID, dummyRecords);
}

// UI Modals & Radar Management
function openModal(mode, isBatch) {
  const modal = document.getElementById('nfc-modal');
  const title = document.getElementById('modal-title');
  const desc = document.getElementById('modal-desc');
  const batchBadge = document.getElementById('modal-batch-counter');
  const simBtn = document.getElementById('btn-sim-trigger-tap');

  modal.classList.remove('hidden');
  simBtn.classList.add('hidden');

  if (mode === 'write') {
    title.textContent = isBatch ? 'Modo Lote: Grabando Chips' : 'Listo para Grabar';
    desc.textContent = 'Acerca el chip NFC a la antena de tu dispositivo.';
    if (isBatch) {
      batchBadge.classList.remove('hidden');
      document.getElementById('batch-count-num').textContent = state.batchCount;
    } else {
      batchBadge.classList.add('hidden');
    }
  } else {
    title.textContent = 'Listo para Leer';
    desc.textContent = 'Acerca cualquier chip o tarjeta NFC para leer su información.';
    batchBadge.classList.add('hidden');
  }

  setModalStatus('Esperando contacto con chip...');
}

function setModalStatus(text) {
  const el = document.getElementById('modal-status-text');
  if (el) el.textContent = text;
}

function closeModal() {
  const modal = document.getElementById('nfc-modal');
  modal.classList.add('hidden');
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  state.isWriting = false;
  stopNfcRead();
}

// Navigation & Tab Switching
function switchTab(targetTabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isTarget = btn.getAttribute('data-tab') === targetTabId;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.toggle('active', tab.id === targetTabId);
  });
}

function selectType(type) {
  state.currentType = type;
  document.querySelectorAll('.type-pill').forEach(pill => {
    pill.classList.toggle('active', pill.getAttribute('data-type') === type);
  });

  document.querySelectorAll('.form-group-type').forEach(form => {
    form.classList.toggle('active', form.id === `form-${type}`);
  });

  updateSizeEstimate();
}

// Initialization and Event Listeners
function init() {
  checkNfcCompatibility();

  // Remove the legacy history format, which stored complete payloads (including
  // possible Wi-Fi passwords) without an explicit opt-in.
  if (localStorage.getItem('nfc_studio_history')) {
    localStorage.removeItem('nfc_studio_history');
    showToast('Se eliminó el historial antiguo por seguridad.', 'info');
  }

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  // Type pills
  document.querySelectorAll('.type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      selectType(pill.getAttribute('data-type'));
    });
  });

  document.querySelectorAll('.tag-option').forEach(option => {
    option.addEventListener('click', () => {
      state.selectedTag = option.getAttribute('data-tag');
      document.querySelectorAll('.tag-option').forEach(item => {
        const selected = item === option;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      document.getElementById('selected-tag-label').textContent = state.selectedTag;
      updateSizeEstimate();
    });
  });

  // Quick fill example chips
  document.querySelectorAll('.chip-example').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('input-url');
      input.value = chip.getAttribute('data-fill');
      input.focus();
      updateSizeEstimate();
    });
  });

  // Input listeners for size estimator
  document.querySelectorAll('input, textarea, select').forEach(el => {
    el.addEventListener('input', updateSizeEstimate);
    el.addEventListener('change', updateSizeEstimate);
  });

  // Sound Toggle
  const btnSound = document.getElementById('btn-sound-toggle');
  const iconSoundOn = document.getElementById('icon-sound-on');
  const iconSoundOff = document.getElementById('icon-sound-off');
  btnSound.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    iconSoundOn.classList.toggle('hidden', !state.soundEnabled);
    iconSoundOff.classList.toggle('hidden', state.soundEnabled);
    showToast(state.soundEnabled ? 'Sonidos activados' : 'Sonidos silenciados', 'info');
    if (state.soundEnabled) playSound('ping');
  });

  // Help Modal
  document.getElementById('btn-info-modal').addEventListener('click', () => {
    document.getElementById('help-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-help').addEventListener('click', () => {
    document.getElementById('help-modal').classList.add('hidden');
  });
  document.getElementById('help-modal').addEventListener('click', (e) => {
    if (e.target.id === 'help-modal') e.target.classList.add('hidden');
  });

  // Simulator Toggle
  document.getElementById('btn-enable-simulator').addEventListener('click', () => {
    state.isSimulatorActive = true;
    showToast('Modo Simulador activado. Puedes probar lectura y escritura en tu navegador.', 'info');
    const badge = document.getElementById('compat-badge');
    badge.textContent = 'Simulador Activo';
    badge.className = 'badge sim';
  });

  // Buttons
  document.getElementById('btn-start-write').addEventListener('click', startNfcWrite);
  document.getElementById('btn-start-read').addEventListener('click', startNfcRead);
  document.getElementById('btn-cancel-nfc').addEventListener('click', closeModal);

  // Clone from read to writer
  document.getElementById('btn-clone-to-writer').addEventListener('click', () => {
    const uid = document.getElementById('tag-uid').textContent;
    const records = document.querySelectorAll('#tag-records-list .record-item');
    if (records.length) {
      const content = records[0].querySelector('.record-content').textContent;
      switchTab('tab-write');
      if (/^https?:\/\//i.test(content)) {
        selectType('url');
        document.getElementById('input-url').value = content;
      } else {
        selectType('text');
        document.getElementById('input-text').value = content;
      }
      updateSizeEstimate();
      showToast('Contenido copiado al Grabador', 'success');
    }
  });

  // Clear history
  const historyConsent = document.getElementById('chk-save-history');
  historyConsent.checked = state.historyEnabled;
  historyConsent.addEventListener('change', () => {
    state.historyEnabled = historyConsent.checked;
    localStorage.setItem(HISTORY_SETTING_KEY, String(state.historyEnabled));
    if (state.historyEnabled) {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
      showToast('Historial local activado', 'info');
    } else {
      localStorage.removeItem(HISTORY_KEY);
      state.history = [];
      renderHistory();
      showToast('Historial local desactivado y borrado', 'info');
    }
  });

  document.getElementById('btn-clear-history').addEventListener('click', () => {
    if (confirm('¿Deseas borrar todo el historial?')) {
      state.history = [];
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
      showToast('Historial vaciado', 'info');
    }
  });

  // Copy read tag UID & records
  document.getElementById('btn-copy-read').addEventListener('click', () => {
    const uid = document.getElementById('tag-uid').textContent;
    const records = Array.from(document.querySelectorAll('#tag-records-list .record-item'))
      .map(r => r.querySelector('.record-content').textContent)
      .join('\n');
    navigator.clipboard.writeText(`UID: ${uid}\n${records}`);
    showToast('Copiado al portapapeles', 'success');
  });

  // Initial calculation and history render
  updateSizeEstimate();
  renderHistory();
}

document.addEventListener('DOMContentLoaded', init);
