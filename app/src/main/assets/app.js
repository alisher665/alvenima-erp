const statusDiv = document.getElementById('status');
let isRecording = false;
let openTodayAfterRender = false;
let currentMicMode = 'splash';
let awaitingConfirm = false;
let pendingDeleteAction = null;
let wasRecordingBeforeTts = false;
let pendingItemId = null;

const MONTH_NAMES = { "01": "Январь", "02": "Февраль", "03": "Март", "04": "Апрель", "05": "Май", "06": "Июнь", "07": "Июль", "08": "Август", "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь" };

// ==========================================
// ЛОГИКА ОБЪЕКТОВ И ИЗОЛЯЦИИ ДАННЫХ
// ==========================================
let objectsList = JSON.parse(localStorage.getItem('my_objects')) || [];
let currentObject = localStorage.getItem('current_object') || '';
let settings = JSON.parse(localStorage.getItem('my_settings')) || { company: '', phone: '', currency: '₽' };

function getStorageKey(baseName) {
    let obj = currentObject ? currentObject : 'default';
    return obj + '_' + baseName;
}

// ==========================================
// НАСТРОЙКИ
// ==========================================
window.saveSettings = function() {
    settings.company = document.getElementById('set-company').value;
    settings.phone = document.getElementById('set-phone').value;
    settings.currency = document.getElementById('set-currency').value;

    const autosaveCb = document.getElementById('setting-autosave');
    if (autosaveCb) settings.autosave = autosaveCb.checked;

    localStorage.setItem('my_settings', JSON.stringify(settings));
    statusDiv.innerText = "Настройки сохранены!";
    statusDiv.style.color = "lightgreen";
    setTimeout(()=>{statusDiv.innerText='';}, 2000);
};

function loadSettingsUI() {
    document.getElementById('set-company').value = settings.company || '';
    document.getElementById('set-phone').value = settings.phone || '';
    document.getElementById('set-currency').value = settings.currency || '₽';

    const autosaveCb = document.getElementById('setting-autosave');
    if (autosaveCb) autosaveCb.checked = settings.autosave || false;
}

window.exportData = function() {
    // Собираем все ключи localStorage
    let backupData = {};
    for (let i = 0; i < localStorage.length; i++) {
        let key = localStorage.key(i);
        backupData[key] = localStorage.getItem(key);
    }
    let jsonStr = JSON.stringify(backupData, null, 2);

    // Безопасное имя файла (без точек в дате)
    let d = new Date();
    let pad = n => (n < 10 ? '0' + n : '' + n);
    let stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
              + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
    let fileName = "ALVENIMA_BACKUP_" + stamp + ".json";

    statusDiv.innerText = "⏳ Сохраняю бэкап...";
    statusDiv.style.color = "#00c2ff";

    if (window.AndroidApp && window.AndroidApp.saveBackupToDownloads) {
        try {
            window.AndroidApp.saveBackupToDownloads(jsonStr, fileName);
            // Результат придёт в onBackupSaved
        } catch (e) {
            statusDiv.innerText = "❌ Ошибка вызова Java: " + e.message;
            statusDiv.style.color = "#ff4444";
        }
    } else {
        // Фолбэк для теста в обычном браузере
        try {
            let blob = new Blob([jsonStr], { type: 'application/json' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            statusDiv.innerText = "✅ Бэкап сохранён (браузер): " + fileName;
            statusDiv.style.color = "#00ff88";
        } catch (e) {
            statusDiv.innerText = "❌ Ошибка бэкапа: " + e.message;
            statusDiv.style.color = "#ff4444";
        }
    }
};

// Колбэк из Java после сохранения бэкапа
window.onBackupSaved = function(ok, info) {
    if (ok) {
        statusDiv.innerText = "✅ " + info;
        statusDiv.style.color = "#00ff88";
    } else {
        statusDiv.innerText = "❌ " + info;
        statusDiv.style.color = "#ff4444";
    }
    setTimeout(() => { statusDiv.innerText = ''; statusDiv.style.color = ''; }, 5000);
};

window.clearAllAppData = function() {
    if (confirm("ВНИМАНИЕ! Это удалит ВСЕ объекты, сметы и настройки. Вы уверены?")) {
        localStorage.clear();
        location.reload();
    }
};

// ==========================================
// СПЛЭШ И ОБЪЕКТЫ
// ==========================================
function renderSplash() {
    const container = document.getElementById('objects-list-container');
    if (!container) return;
    if (objectsList.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; margin-bottom: 20px;">Нет добавленных объектов.<br>Нажмите кнопку ниже.</p>';
        return;
    }
    let html = '';
    objectsList.forEach(obj => {
        html += `
        <div style="display:flex; gap: 10px; width: 100%;">
            <button class="object-btn" style="flex:1;" onclick="selectObject('${obj}')"><span>🏢 ${obj}</span><span class="arrow">→</span></button>
            <button style="background:#ff4444; border:none; border-radius:12px; width:50px; color:white; font-size:20px; cursor:pointer;" onclick="deleteObject('${obj}')">✕</button>
        </div>`;
    });
    container.innerHTML = html;
}

window.deleteObject = function(name) {
    if (confirm(`Вы уверены, что хотите удалить объект "${name}" и ВСЕ его данные?`)) {
        let keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key.startsWith(name + '_')) keysToRemove.push(key);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        objectsList = objectsList.filter(obj => obj !== name);
        localStorage.setItem('my_objects', JSON.stringify(objectsList));
        if (currentObject === name) {
            currentObject = '';
            localStorage.removeItem('current_object');
        }
        renderSplash();
    }
};

window.addNewObjectPrompt = function() {
    let name = prompt("Введите адрес или название объекта:");
    if (name && name.trim() !== "") {
        name = name.trim();
        if (!objectsList.includes(name)) {
            objectsList.push(name);
            localStorage.setItem('my_objects', JSON.stringify(objectsList));
        }
        selectObject(name);
    }
};

window.selectObject = function(name) {
    currentObject = name;
    localStorage.setItem('current_object', currentObject);
    currentEstimate = JSON.parse(localStorage.getItem(getStorageKey('estimate'))) || [];
    financeData = JSON.parse(localStorage.getItem(getStorageKey('finance'))) || [];
    diaryData = JSON.parse(localStorage.getItem(getStorageKey('diary'))) || [];
    remindersData = JSON.parse(localStorage.getItem(getStorageKey('reminders'))) || [];
    warehouseData = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    renderEstimate(); renderFinance(); renderDiary(); renderReminders(); renderWarehouse();
    switchView('home');
    statusDiv.innerText = "Открыт объект: " + currentObject;
    statusDiv.style.color = "lightgreen";
    setTimeout(()=>{statusDiv.innerText='';}, 2000);
};

window.selectPersonalMode = function() {
    currentObject = "Личный блок";
    localStorage.setItem('current_object', currentObject);
    currentEstimate = JSON.parse(localStorage.getItem(getStorageKey('estimate'))) || [];
    financeData = JSON.parse(localStorage.getItem(getStorageKey('finance'))) || [];
    diaryData = JSON.parse(localStorage.getItem(getStorageKey('diary'))) || [];
    remindersData = JSON.parse(localStorage.getItem(getStorageKey('reminders'))) || [];
    warehouseData = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    renderEstimate(); renderFinance(); renderDiary(); renderReminders(); renderWarehouse();
    switchView('home');
    statusDiv.innerText = "Открыт Личный блок";
    statusDiv.style.color = "lightgreen";
    setTimeout(()=>{statusDiv.innerText='';}, 2000);
};

// ==========================================
// НАВИГАЦИЯ (КОНТЕКСТ ДЛЯ МИКРОФОНА)
// ==========================================
window.switchView = function(viewId) {
    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-' + viewId).classList.remove('hidden');
    currentMicMode = viewId;
    let micBtn = document.getElementById('floating-mic');
    if (viewId === 'splash' || viewId === 'objects') {
        micBtn.classList.add('hidden');
    } else {
        micBtn.classList.remove('hidden');
        if (isRecording) {
            micBtn.classList.add('recording');
            micBtn.innerText = '🛑';
        } else {
            micBtn.classList.remove('recording');
            micBtn.innerText = '🎤';
        }
    }
    statusDiv.innerText = '';
    if (viewId === 'objects') renderSplash();
    if (viewId === 'home') document.getElementById('current-object-name').innerText = currentObject || 'Не выбран';
    if (viewId === 'settings') loadSettingsUI();
};

// ==========================================
// МИКРОФОН (ПЕРЕТАСКИВАНИЕ)
// ==========================================
const micBtn = document.getElementById('floating-mic');
let isDragging = false;
let hasMoved = false;
let startX, startY, initialX, initialY;

const savedX = localStorage.getItem('mic_x');
const savedY = localStorage.getItem('mic_y');
if (savedX && savedY) {
    micBtn.style.left = savedX + 'px';
    micBtn.style.top = savedY + 'px';
    micBtn.style.bottom = 'auto';
    micBtn.style.right = 'auto';
}

micBtn.addEventListener('touchstart', (e) => {
    isDragging = true;
    hasMoved = false;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    initialX = micBtn.offsetLeft;
    initialY = micBtn.offsetTop;
    micBtn.style.transition = 'none';
});

micBtn.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    hasMoved = true;
    const touch = e.touches[0];
    let dx = touch.clientX - startX;
    let dy = touch.clientY - startY;
    let newX = initialX + dx;
    let newY = initialY + dy;
    const maxW = window.innerWidth - micBtn.offsetWidth;
    const maxH = window.innerHeight - micBtn.offsetHeight;
    newX = Math.max(0, Math.min(newX, maxW));
    newY = Math.max(0, Math.min(newY, maxH));
    micBtn.style.left = newX + 'px';
    micBtn.style.top = newY + 'px';
    micBtn.style.bottom = 'auto';
    micBtn.style.right = 'auto';
    e.preventDefault();
});

micBtn.addEventListener('touchend', (e) => {
    isDragging = false;
    micBtn.style.transition = 'transform 0.1s, background 0.3s';
    if (hasMoved) {
        localStorage.setItem('mic_x', micBtn.style.left.replace('px', ''));
        localStorage.setItem('mic_y', micBtn.style.top.replace('px', ''));
    } else {
        if (currentMicMode !== 'splash' && currentMicMode !== 'objects') {
            e.preventDefault();
            toggleMic();
        }
    }
});

// ==========================================
// ГОЛОС И TTS
// ==========================================
function speak(text) {
    if (isRecording && window.AndroidApp && window.AndroidApp.stopVosk) {
        wasRecordingBeforeTts = true; window.AndroidApp.stopVosk(); isRecording = false;
        micBtn.classList.remove('recording'); micBtn.innerText = '🎤';
    }
    if (window.AndroidApp && window.AndroidApp.speak) window.AndroidApp.speak(text);
}

window.onTtsDone = function() {
    if (wasRecordingBeforeTts) {
        wasRecordingBeforeTts = false;
        if (window.AndroidApp && window.AndroidApp.startVosk) {
            window.AndroidApp.startVosk(); isRecording = true;
            micBtn.classList.add('recording'); micBtn.innerText = '🛑';
            statusDiv.innerText = 'Слушаю...';
        }
    }
};

window.onModelLoaded = () => { statusDiv.innerText = 'Модель готова!'; setTimeout(()=>{statusDiv.innerText='';}, 2000); };
window.onVoskResult = (text) => { if (text && text.trim() !== "") { statusDiv.innerText = 'Вы сказали: ' + text; } };

window.toggleMic = () => {
    if (!isRecording) {
        if (window.AndroidApp) window.AndroidApp.startVosk();
        isRecording = true;
        micBtn.classList.add('recording'); micBtn.innerText = '🛑';
        statusDiv.innerText = 'Говорите...';
    } else {
        if (window.AndroidApp) window.AndroidApp.stopVosk();
        isRecording = false;
        micBtn.classList.remove('recording'); micBtn.innerText = '🎤';
        statusDiv.innerText = 'Обработка...';
    }
};

// ==========================================
// ПАРСИНГ
// ==========================================
const NUMBERS_MAP = { "ноль": 0, "один": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13, "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18, "девятнадцать": 19, "двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80, "девяносто": 90, "сто": 100, "двести": 200, "триста": 300, "четыреста": 400, "пятьсот": 500, "шестьсот": 600, "семьсот": 700, "восемьсот": 800, "девятьсот": 900, "тысяча": 1000, "тысячи": 1000, "тысяч": 1000, "миллион": 1000000, "миллиона": 1000000, "миллионов": 1000000 };
const UNITS_MAP = { "квадрат": "м²", "квадратов": "м²", "квадрата": "м²", "кв": "м²", "м2": "м²", "метр": "м.п.", "метров": "м.п.", "метра": "м.п.", "погонных": "м.п.", "штука": "шт.", "штук": "шт.", "штуки": "шт.", "шт": "шт.", "комплект": "компл.", "комплектов": "компл." };

let voiceBuffer = ""; let voiceTimer = null;
window.handleVoiceInput = (text) => {
    voiceBuffer += " " + text; statusDiv.innerText = 'Слушаю: ' + voiceBuffer.trim();
    if (voiceTimer) clearTimeout(voiceTimer);
    voiceTimer = setTimeout(() => { let finalText = voiceBuffer.trim(); voiceBuffer = ""; processVoiceCommand(finalText); }, 1200);
};

function processVoiceCommand(text) {
    let lower = text.toLowerCase().replace(/,/g, '.');
    let cleanText = lower.replace(/[^а-яё0-9]/g, ' ').replace(/\s+/g, ' ').trim();

    if (awaitingConfirm) {
        let hasNo = cleanText.split(' ').includes('нет') || cleanText.includes('отмена');
        let hasYes = cleanText.split(' ').includes('да') || cleanText.includes('подтверждаю');
        if (hasNo) {
            statusDiv.innerText = "❌ Отменено."; speak("Отменено");
            awaitingConfirm = false; pendingDeleteAction = null; pendingItemId = null; return;
        }
        if (hasYes) {
            if (pendingDeleteAction === 'smeta') { currentEstimate = []; localStorage.setItem(getStorageKey('estimate'), JSON.stringify(currentEstimate)); renderEstimate(); }
            else if (pendingDeleteAction === 'finance') { financeData = []; localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData)); renderFinance(); }
            else if (pendingDeleteAction === 'diary') { diaryData = []; localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData)); renderDiary(); }
            else if (pendingDeleteAction === 'reminders') { remindersData = []; localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData)); renderReminders(); }
            else if (pendingDeleteAction === 'warehouse') { warehouseData = []; localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(warehouseData)); renderWarehouse(); }
            else if (pendingDeleteAction === 'warehouse_item') { warehouseData = warehouseData.filter(i => i.id !== pendingItemId); localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(warehouseData)); renderWarehouse(); }
            else if (pendingDeleteAction === 'finance_item') { financeData = financeData.filter(i => i.id !== pendingItemId); localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData)); renderFinance(); }
            statusDiv.innerText = "✅ Удалено!"; speak("Удалено");
            awaitingConfirm = false; pendingDeleteAction = null; pendingItemId = null; return;
        }
        awaitingConfirm = false; pendingDeleteAction = null; pendingItemId = null; statusDiv.innerText = "Отменено."; speak("Отменено");
    }

    // КОМАНДА ОЧИСТКИ ПОЛЕЙ
    if (cleanText.includes("очисти") || cleanText.includes("очистить") || cleanText.includes("сбрось") || cleanText.includes("сбросить")) {
        if (currentMicMode === 'smeta') {
            document.getElementById('work-name').value = ''; document.getElementById('work-qty').value = ''; document.getElementById('work-price').value = '';
        } else if (currentMicMode === 'finance') {
            document.getElementById('fin-category').value = ''; document.getElementById('fin-amount').value = '';
        } else if (currentMicMode === 'diary') {
            document.getElementById('diary-input').value = '';
        } else if (currentMicMode === 'reminders') {
            document.getElementById('rem-text').value = ''; document.getElementById('rem-date').value = ''; document.getElementById('rem-time').value = '';
        } else if (currentMicMode === 'warehouse') {
            document.getElementById('wh-name').value = ''; document.getElementById('wh-qty').value = ''; document.getElementById('wh-price').value = '';
        }
        statusDiv.innerText = "🧹 Поля очищены!"; speak("Очищено"); return;
    }

    // НАВИГАЦИЯ
    if (cleanText.includes("главная") || cleanText.includes("меню") || cleanText.includes("назад")) { switchView(currentObject ? 'home' : 'objects'); return; }
    if (cleanText === "смета" || cleanText.includes("открой смету")) { switchView('smeta'); return; }
    if (cleanText === "финансы" || cleanText.includes("открой финансы")) { switchView('finance'); return; }
    if (cleanText === "дневник" || cleanText.includes("открой дневник")) { switchView('diary'); return; }
    if (cleanText === "напоминания" || cleanText.includes("открой напоминания")) { switchView('reminders'); return; }
    if (cleanText === "склад" || cleanText.includes("открой склад")) { switchView('warehouse'); return; }
    if (cleanText === "настройки" || cleanText.includes("открой настройки")) { switchView('settings'); return; }

    // КОМАНДЫ УДАЛЕНИЯ ВСЕГО
    let isDeleteSmeta = /удал(ить|и)?\s+смет[уа]/.test(cleanText);
    let isDeleteFin = /удал(ить|и)?\s+финанс[ыа]/.test(cleanText);
    let isDeleteDiary = /удал(ить|и)?\s+дневник[а]?/.test(cleanText);
    let isDeleteReminders = /удал(ить|и)?\s+напоминани[яй]/.test(cleanText);
    let isDeleteWarehouse = /удал(ить|и)?\s+склад/.test(cleanText);

    if (isDeleteSmeta || isDeleteFin || isDeleteDiary || isDeleteReminders || isDeleteWarehouse) {
        awaitingConfirm = true;
        pendingDeleteAction = isDeleteSmeta ? 'smeta' : (isDeleteFin ? 'finance' : (isDeleteDiary ? 'diary' : (isDeleteReminders ? 'reminders' : 'warehouse')));
        speak("Вы уверены?"); statusDiv.innerText = "⚠️ Удалить всё? Скажите 'Да' или 'Нет'."; return;
    }

    // КОНТЕКСТНЫЕ КОМАНДЫ
    if (currentMicMode === 'smeta') parseSmetaVoice(lower);
    else if (currentMicMode === 'finance') parseFinanceVoice(lower);
    else if (currentMicMode === 'diary') parseDiaryVoice(lower);
    else if (currentMicMode === 'reminders') parseReminderVoice(lower);
    else if (currentMicMode === 'warehouse') parseWarehouseVoice(lower);
}

function parseSmetaVoice(lower) {
    let isAutoSmeta = settings.autosave === true;

    if ((lower.includes("добавь") || lower.includes("сохрани") || lower.includes("запиши")) && document.getElementById('work-name').value.trim() !== '') {
        addToEstimate();
        return;
    }

    let words = lower.split(/\s+/);
    let nameWords = [];
    let qty = 0;
    let currentNum = 0;
    let unit = "м²";
    let price = 0;
    let priceCurrent = 0;
    let afterPo = false;

    for (let i = 0; i < words.length; i++) {
        let w = words[i].replace(/[^а-я0-9.]/g, '');
        if (!w) continue;

        if (w === "по" || w === "за") { afterPo = true; continue; }

        if (w.match(/^\d+(\.\d+)?$/)) {
            if (afterPo) price += parseFloat(w); else qty += parseFloat(w);
            continue;
        }

        if (NUMBERS_MAP[w] !== undefined) {
            let val = NUMBERS_MAP[w];
            if (val >= 1000) {
                if (afterPo) { if (priceCurrent === 0) priceCurrent = 1; price += priceCurrent * val; priceCurrent = 0; }
                else { if (currentNum === 0) currentNum = 1; qty += currentNum * val; currentNum = 0; }
            } else {
                if (afterPo) priceCurrent += val; else currentNum += val;
            }
            continue;
        }

        if (w === "половиной") { afterPo ? price += 0.5 : qty += 0.5; continue; }
        if (w === "полтора") { afterPo ? price += 1.5 : qty += 1.5; continue; }
        if (UNITS_MAP[w] !== undefined) { unit = UNITS_MAP[w]; continue; }
        if (w === "на" || w === "с" || w === "и" || w === "в" || w === "от" || w === "до" || w === "добавь" || w === "добавить" || w === "запиши" || w === "сохрани") continue;

        nameWords.push(words[i]);
    }

    qty += currentNum;
    price += priceCurrent;

    let finalName = nameWords.join(" ").trim();
    if (finalName.length > 0) { finalName = finalName.charAt(0).toUpperCase() + finalName.slice(1); } else { finalName = "Работа"; }

    document.getElementById('work-name').value = finalName;
    if (qty > 0) document.getElementById('work-qty').value = qty;
    if (price > 0) document.getElementById('work-price').value = price;

    const unitSelect = document.getElementById('work-unit');
    for (let i = 0; i < unitSelect.options.length; i++) { if (unitSelect.options[i].value === unit) { unitSelect.selectedIndex = i; break; } }

    let savedPrices = JSON.parse(localStorage.getItem(getStorageKey('prices'))) || {};
    if (!price && savedPrices[finalName.trim().toLowerCase()]) {
        document.getElementById('work-price').value = savedPrices[finalName.trim().toLowerCase()];
        statusDiv.innerText = `Цена подставлена: ${savedPrices[finalName.trim().toLowerCase()]} ₽.`;
    } else {
        statusDiv.innerText = "Данные вставлены.";
    }

    let priceVal = parseFloat(document.getElementById('work-price').value);
    if (isAutoSmeta && finalName && qty > 0 && !isNaN(priceVal) && priceVal > 0) {
        addToEstimate();
        statusDiv.innerText = "✅ Автосохранено в Смету!";
        speak("Сохранено");
    }
}

function parseFinanceVoice(lower) {
    // 1. УДАЛЕНИЕ
    if (lower.includes('удали') || lower.includes('удалить')) {
        let isIncome = lower.includes('приход') || lower.includes('доход');
        let isExpense = lower.includes('расход') || lower.includes('потрат');
        let words = lower.replace(/[^а-яё0-9\s]/g, ' ').split(' ');
        let nameWords = []; let amount = 0;
        let skip = ['удали', 'удалить', 'расход', 'приход', 'доход', 'потрат', 'на', 'за', 'в'];
        for (let w of words) {
            let cleanW = w.replace(/[^а-яё0-9]/g, ''); if (!cleanW) continue;
            if (skip.includes(cleanW)) continue;
            if (cleanW.match(/^\d+$/)) { amount += parseFloat(cleanW); continue; }
            if (NUMBERS_MAP[cleanW] !== undefined) { amount += NUMBERS_MAP[cleanW]; continue; }
            nameWords.push(cleanW);
        }
        let searchName = nameWords.join(' ').trim().toLowerCase();
        const itemIndex = financeData.findIndex(i => (i.category.toLowerCase().includes(searchName) && (amount === 0 || i.amount === amount)));
        if (itemIndex === -1) { statusDiv.innerText = "⚠️ Запись не найдена."; speak("Не найдено"); return; }
        awaitingConfirm = true; pendingDeleteAction = 'finance_item'; pendingItemId = financeData[itemIndex].id;
        statusDiv.innerText = `⚠️ Удалить? Скажите Да или Нет.`; speak("Вы уверены?"); return;
    }

    // 2. СОХРАНЕНИЕ (по команде)
    if (lower.includes('сохрани') || lower.includes('добавь') || lower.includes('запиши')) {
        const typeEl = document.getElementById('fin-type');
        const categoryEl = document.getElementById('fin-category');
        const amountEl = document.getElementById('fin-amount');
        if (!categoryEl.value.trim() || !parseFloat(amountEl.value)) { speak("Поля пустые"); return; }
        financeData.push({ id: Date.now(), type: typeEl.value, category: categoryEl.value, amount: parseFloat(amountEl.value), date: new Date().toLocaleDateString('ru-RU') });
        localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData));
        openTodayAfterRender = true;
        renderFinance(); categoryEl.value = ''; amountEl.value = '';
        statusDiv.innerText = "✅ Сохранено!"; speak("Сохранено"); return;
    }

    // 3. ЗАПОЛНЕНИЕ ПОЛЕЙ
    let type = 'income';
    if (lower.includes('потрат') || lower.includes('расход') || lower.includes('куп') || lower.includes('отда')) { type = 'expense'; }
    let words = lower.split(/\s+/); let nameWords = []; let amount = 0;
    for (let i = 0; i < words.length; i++) {
        let w = words[i].replace(/[^а-я0-9.]/g, ''); if (!w) continue;
        if (w.match(/^\d+$/)) { amount += parseFloat(w); continue; }
        if (NUMBERS_MAP[w] !== undefined) { amount += NUMBERS_MAP[w]; continue; }
        if (w.match(/^(заказчик|выплатил|заплатил|потратил|отдал|получил|купил|рублей|с|и|в|на)$/)) { continue; }
        nameWords.push(words[i]);
    }
    let finalName = nameWords.join(" ").trim() || (type === 'income' ? 'Поступление' : 'Расход');

    document.getElementById('fin-type').value = type;
    document.getElementById('fin-category').value = finalName.charAt(0).toUpperCase() + finalName.slice(1);
    document.getElementById('fin-amount').value = amount > 0 ? amount : '';

    // АВТОСОХРАНЕНИЕ
    if (settings.autosave && finalName && amount > 0) {
        financeData.push({ id: Date.now(), type: type, category: finalName.charAt(0).toUpperCase() + finalName.slice(1), amount: amount, date: new Date().toLocaleDateString('ru-RU') });
        localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData));
        openTodayAfterRender = true;
        renderFinance();

        document.getElementById('fin-category').value = '';
        document.getElementById('fin-amount').value = '';

        statusDiv.innerText = "✅ Автосохранено в Финансы!";
        speak("Сохранено");
    } else {
        statusDiv.innerText = "📝 В поля. Скажите 'Сохрани'.";
        speak('Данные вставлены');
    }
}

function parseDiaryVoice(lower) {
    const inputEl = document.getElementById('diary-input');
    let isAuto = settings.autosave === true;
    if ((lower.includes('сохрани') || lower.includes('добавь') || lower.includes('запиши') || isAuto) && inputEl.value.trim() !== '') {
        const now = new Date();
        diaryData.push({ id: Date.now(), text: inputEl.value.trim(), date: now.toLocaleDateString('ru-RU'), time: now.toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}) });
        localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData)); openTodayAfterRender = true; renderDiary(); inputEl.value = '';
        statusDiv.innerText = "✅ Запись сохранена!"; speak("Сохранено"); return;
    }
    let cleanText = lower.replace(/сохрани|добавь|запиши/g, '').trim();
    if (cleanText.length > 0) {
        if (inputEl.value.trim() !== '') { inputEl.value += ' ' + cleanText; } else { inputEl.value = cleanText.charAt(0).toUpperCase() + cleanText.slice(1); }
        statusDiv.innerText = "📝 Текст добавлен в поле. Скажите 'Сохрани', чтобы записать.";
    }
}

// ==========================================
// ПАРСЕР СКЛАДА
// ==========================================
function parseWarehouseVoice(lower) {
    statusDiv.innerText = '🔍 Услышано: ' + lower;
    let text = lower.replace(/[^а-яё0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    let words = text.split(' ').filter(w => w.length > 0);

    const localMap = {
        'ноль':0,'один':1,'одна':1,'два':2,'две':2,'три':3,'четыре':4,'пять':5,
        'шесть':6,'семь':7,'восемь':8,'девять':9,'десять':10,'одиннадцать':11,
        'двенадцать':12,'тринадцать':13,'четырнадцать':14,'пятнадцать':15,
        'шестнадцать':16,'семнадцать':17,'восемнадцать':18,'девятнадцать':19,
        'двадцать':20,'тридцать':30,'сорок':40,'пятьдесят':50,'шестьдесят':60,
        'семьдесят':70,'восемьдесят':80,'девяносто':90,'сто':100,'двести':200,
        'триста':300,'четыреста':400,'пятьсот':500,'шестьсот':600,'семьсот':700,
        'восемьсот':800,'девятьсот':900,
        'тысяча':1000, 'тысячи':1000, 'тысяч':1000,
        'миллион':1000000, 'миллиона':1000000, 'миллионов':1000000
    };

    function getNumber(str) {
        if (!str) return 0;
        let arr = str.split(' '); let result = 0; let current = 0;
        for (let w of arr) {
            let cleanW = w.replace(/[^а-яё0-9]/g, '');
            if (!cleanW) continue;
            if (cleanW.match(/^\d+$/)) { current += parseFloat(cleanW); }
            else if (localMap[cleanW] !== undefined) {
                let val = localMap[cleanW];
                if (val >= 1000) { if (current === 0) current = 1; result += current * val; current = 0; }
                else { current += val; }
            }
        }
        return result + current;
    }

    // УДАЛЕНИЕ ИЛИ ВЫЧЕТ
    if (words.includes('удали') || words.includes('удалить')) {
        let nameWord = ""; let qtyToRemove = 0;
        let skip = ['удали', 'удалить', 'материал', 'на', 'со', 'склада', 'мешок', 'мешка', 'мешков', 'меш', 'кг', 'метр', 'штук', 'штуки'];
        for (let w of words) {
            let cleanW = w.replace(/[^а-яё0-9]/g, '');
            if (!cleanW) continue;
            if (skip.includes(cleanW)) continue;
            if (cleanW.match(/^\d+$/) || localMap[cleanW] !== undefined) { qtyToRemove += (cleanW.match(/^\d+$/) ? parseFloat(cleanW) : localMap[cleanW]); }
            else if (!nameWord) { nameWord = cleanW; }
        }
        if (!nameWord) { statusDiv.innerText = "⚠️ Не понял, что удалить. Скажите: 'Удали цемент'"; speak("Не понял"); return; }
        const itemIndex = warehouseData.findIndex(i => i.name.toLowerCase().includes(nameWord.toLowerCase()));
        if (itemIndex === -1) { statusDiv.innerText = `⚠️ Материал "${nameWord}" не найден.`; speak(`Не найдено`); return; }
        const item = warehouseData[itemIndex];
        if (qtyToRemove > 0) {
            if (qtyToRemove > item.qty) { statusDiv.innerText = `⚠️ На складе только ${item.qty} ${item.unit}. Нельзя вычесть ${qtyToRemove}.`; speak("Недостаточно материала"); return; }
            item.qty -= qtyToRemove; item.id = Date.now();
            localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(warehouseData)); renderWarehouse();
            statusDiv.innerText = `✅ Вычтено: ${qtyToRemove} ${item.unit} "${item.name}". Остаток: ${item.qty}`; speak(`Вычтено`); return;
        }
        awaitingConfirm = true; pendingDeleteAction = 'warehouse_item'; pendingItemId = item.id;
        statusDiv.innerText = `⚠️ Удалить "${item.name}" полностью? Скажите 'Да' или 'Нет'.`; speak(`Вы уверены?`); return;
    }

    // ДОБАВЛЕНИЕ
    let isOnlyAdd = (words.length === 1 || (words.length === 2 && words[0] === 'на')) && (words.includes('добавь') || words.includes('добавить') || words.includes('сохрани') || words.includes('сохранить'));
    if (isOnlyAdd) {
        const nameEl = document.getElementById('wh-name'); const qtyEl = document.getElementById('wh-qty'); const addBtn = document.getElementById('add-wh-btn');
        if (nameEl && nameEl.value.trim() !== '' && qtyEl && parseFloat(qtyEl.value) > 0 && addBtn) {
            addBtn.click(); statusDiv.innerText = `✅ Сохранено: ${nameEl.value}`; speak('Сохранено');
        } else { statusDiv.innerText = "⚠️ Поля пустые. Сначала продиктуйте материал."; speak('Поля пустые'); }
        return;
    }

    // ЗАПОЛНЕНИЕ ПОЛЕЙ
    let poIndex = -1;
    for (let i = 0; i < words.length; i++) { if (words[i] === 'по' || words[i] === 'цена' || words[i] === 'за') { poIndex = i; break; } }
    let qtyPart = ''; let pricePart = '';
    if (poIndex !== -1) { qtyPart = words.slice(0, poIndex).join(' '); pricePart = words.slice(poIndex + 1).join(' '); } else { qtyPart = text; pricePart = ''; }
    let qty = getNumber(qtyPart); let price = getNumber(pricePart);
    let unit = 'шт.';
    if (qtyPart.includes('меш')) unit = 'меш.';
    else if (qtyPart.includes('кг') || qtyPart.includes('килограмм')) unit = 'кг';
    else if (qtyPart.includes('метр') || qtyPart.includes('м.')) unit = 'м.';
    else if (qtyPart.includes('квадрат') || qtyPart.includes('м2')) unit = 'м²';
    let skipWords = ['по','цена','за','добавь','добавьте','добавить','на','склад','запиши','запишите','сохрани','сохраните','и','с','в','рублей','рубль','рубля','мешок','мешка','мешков','меш','кг','килограмм','килограмма','килограммов','метр','метра','метров','квадрат','квадратов','квадрата','м2','штука','штук','штуки','шт'];
    let nameWords = [];
    for (let w of words) {
        let cleanW = w.replace(/[^а-яё]/g, '');
        if (!cleanW) continue;
        if (skipWords.includes(cleanW)) continue;
        if (localMap[cleanW] !== undefined) continue;
        if (cleanW.match(/^\d+$/)) continue;
        nameWords.push(w);
    }
    let finalName = nameWords.join(' ').trim();
    if (finalName.length > 0) { finalName = finalName.charAt(0).toUpperCase() + finalName.slice(1); } else { finalName = 'Материал'; }
    const nameEl = document.getElementById('wh-name'); const qtyEl = document.getElementById('wh-qty'); const priceEl = document.getElementById('wh-price'); const unitEl = document.getElementById('wh-unit');
    if (nameEl) nameEl.value = finalName;
    if (qtyEl) qtyEl.value = qty > 0 ? qty : '';
    if (priceEl) priceEl.value = price > 0 ? price : '';
    if (unitEl) { for (let i = 0; i < unitEl.options.length; i++) { if (unitEl.options[i].value === unit) { unitEl.selectedIndex = i; break; } } }
        // АВТОСОХРАНЕНИЕ ДЛЯ СКЛАДА
        if (settings.autosave === true && finalName && qty > 0) {
            const addBtn = document.getElementById('add-wh-btn');
            if (addBtn) {
                addBtn.click();
                return;
            }
        }
    statusDiv.innerText = `📦 В поля: ${finalName} | Кол-во: ${qty} | Цена: ${price}`;
    speak('Данные вставлены');
}

function parseReminderVoice(lower) {
    let now = new Date(); let targetDate = new Date(now.getTime()); let foundTime = false; let hour = -1; let minute = -1;
    let relMatch = lower.match(/через\s+([а-яё0-9]+)\s*(минут|минуту|минуты|час|часа|часов)?/);
    if (relMatch) {
        let valStr = relMatch[1]; let val = parseInt(valStr) || NUMBERS_MAP[valStr] || 0; let unit = relMatch[2] || "минут";
        if (unit.startsWith("минут")) targetDate.setMinutes(now.getMinutes() + val);
        else if (unit.startsWith("час")) targetDate.setHours(now.getHours() + val);
        foundTime = true;
    }
    if (!foundTime) {
        let timeMatch = lower.match(/в\s+(\d{1,2})[\s:]?(\d{2})/);
        if (timeMatch) { hour = parseInt(timeMatch[1]); minute = parseInt(timeMatch[2]); foundTime = true; }
        else { timeMatch = lower.match(/в\s+(\d{1,2})/); if (timeMatch) { hour = parseInt(timeMatch[1]); minute = 0; foundTime = true; } }
    }
    if (!foundTime) {
        let words = lower.split(/\s+/);
        for (let i = 0; i < words.length; i++) {
            let w = words[i].replace(/[^а-яё]/g, '');
            if (w === "в" && i + 1 < words.length) {
                let h = NUMBERS_MAP[words[i+1].replace(/[^а-яё]/g, '')];
                if (h !== undefined && h <= 23) {
                    hour = h;
                    if (i + 2 < words.length) { let m = NUMBERS_MAP[words[i+2].replace(/[^а-яё]/g, '')]; if (m !== undefined && m < 60) minute = m; }
                    foundTime = true; break;
                }
            }
        }
    }
    if (lower.includes("завтра")) targetDate.setDate(targetDate.getDate() + 1);
    if (lower.includes("послезавтра")) targetDate.setDate(targetDate.getDate() + 2);
    if (foundTime && hour !== -1) {
        if (minute === -1) minute = 0;
        if ((lower.includes("дня") || lower.includes("вечера")) && hour > 0 && hour < 12) hour += 12;
        targetDate.setHours(hour, minute, 0, 0);
    }
    if (targetDate.getTime() < now.getTime() && !lower.includes("завтра") && !lower.includes("послезавтра")) targetDate.setDate(targetDate.getDate() + 1);
    if (!foundTime) { statusDiv.innerText = "Не понял время. Скажите: 'Через 5 минут' или 'В 15:30'"; return; }
    let eventText = lower.replace(/напомни|напоминание|завтра|послезавтра|сегодня/g, '').replace(/через\s+[а-яё0-9]+\s*(минут|минуту|минуты|час|часа|часов)?/g, '').replace(/в\s+\d{1,2}[\s:]?\d{0,2}/g, '').replace(/дня|вечера|утра/g, '').trim();
    if (!eventText) eventText = "Напоминание";
    if (window.AndroidApp && window.AndroidApp.setAlarm) {
        let timestamp = targetDate.getTime();
        window.AndroidApp.setAlarm(timestamp, eventText);
        remindersData.push({ id: Date.now(), text: eventText, time: timestamp, dateStr: targetDate.toLocaleString('ru-RU') });
        localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData)); renderReminders();
        statusDiv.innerText = `⏰ Установлено: ${eventText}`; speak("Установлено");
    } else { statusDiv.innerText = "Ошибка: Нет доступа к будильнику"; }
}

// ==========================================
// ЛОГОТИП ДЛЯ PDF
// ==========================================
window.handleLogoUpload = function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            localStorage.setItem('my_logo', e.target.result);
            updateLogoPreview();
            statusDiv.innerText = "Логотип сохранен!"; statusDiv.style.color = "lightgreen";
        };
        reader.readAsDataURL(file);
    }
};

function updateLogoPreview() {
    const savedLogo = localStorage.getItem('my_logo'); const previewDiv = document.getElementById('logo-preview');
    if (previewDiv) {
        if (savedLogo) { previewDiv.innerHTML = `<img src="${savedLogo}" style="max-height: 50px; max-width: 100px; border-radius: 5px; border: 1px solid #444; background: white; padding: 2px;"><button onclick="removeLogo()" style="background: none; border: none; color: #ff4444; font-size: 12px; cursor: pointer; text-decoration: underline;">Удалить</button>`; }
        else { previewDiv.innerHTML = '<span style="color: #666; font-size: 12px;">Логотип не выбран</span>'; }
    }
}

window.removeLogo = function() { localStorage.removeItem('my_logo'); updateLogoPreview(); };

// ==========================================
// РЕНДЕРЫ СПИСКОВ
// ==========================================
let currentEstimate = JSON.parse(localStorage.getItem(getStorageKey('estimate'))) || [];
currentEstimate = currentEstimate.map((item, index) => { if (!item.date) item.date = new Date().toLocaleDateString('ru-RU'); if (!item.id) item.id = Date.now() + index; return item; });
function getTodayParts() { let today = new Date(); return { year: today.getFullYear().toString(), month: ('0' + (today.getMonth() + 1)).slice(-2), day: today.toLocaleDateString('ru-RU') }; }

function toggleAccordion(id, iconId) {
    let c = document.getElementById(id); let i = document.getElementById(iconId);
    if (!c) return;
    if (c.classList.contains('hidden')) { c.classList.remove('hidden'); i.innerText = '▲'; }
    else { c.classList.add('hidden'); i.innerText = '▼'; }
}

function renderEstimate() {
    if (openTodayAfterRender) {
        statusDiv.innerText = "DEBUG(smeta): today=" + getTodayParts().day
            + " | flag=" + openTodayAfterRender
            + " | keys=" + Object.keys(currentEstimate.reduce((acc, i) => { acc[i.date] = 1; return acc; }, {})).join(',');
    }
    const listDiv = document.getElementById('estimate-list');
    const totalRow = document.getElementById('total-row');
    const totalSumSpan = document.getElementById('total-sum');
    const exportButtons = document.getElementById('export-buttons');

    if (currentEstimate.length === 0) {
        listDiv.innerHTML = '<p style="color: #666; font-size: 14px; text-align: center;">Смета пока пуста</p>';
        totalRow.style.display = 'none';
        exportButtons.style.display = 'none';
        return;
    }

    let todayParts = getTodayParts();
    let todaySafeId = todayParts.day.replace(/\./g, '_');
    let shouldOpenToday = openTodayAfterRender;

    let tree = {}; let grandTotal = 0;
    currentEstimate.forEach(item => {
        let parts = item.date.split('.');
        let year = parts[2];
        let month = parts[1];
        if (!tree[year]) tree[year] = {};
        if (!tree[year][month]) tree[year][month] = {};
        if (!tree[year][month][item.date]) tree[year][month][item.date] = [];
        tree[year][month][item.date].push(item);
        grandTotal += item.total;
    });

    let sortedYears = Object.keys(tree).sort((a, b) => parseInt(b) - parseInt(a));
    let fullHtml = '';

    sortedYears.forEach(year => {
        let yearExp = false; let yearTotal = 0;
        Object.values(tree[year]).forEach(m => Object.values(m).forEach(d => d.forEach(i => yearTotal += i.total)));
        fullHtml += `<div class="year-group" style="margin-bottom: 15px;"><div class="year-header" onclick="toggleAccordion('smeta-year-content-${year}', 'smeta-year-icon-${year}')" style="background: linear-gradient(135deg, #1a2a33, #0d1a20); padding: 15px 18px; border-radius: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: bold; color: #00c2ff; border: 1px solid #00c2ff;"><span>📅 ${year} год</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: #00ff88; font-size: 15px;">${yearTotal.toLocaleString('ru-RU')} ₽</span><span id="smeta-year-icon-${year}">▼</span></span></div><div id="smeta-year-content-${year}" class="hidden" style="margin-top: 10px; padding-left: 12px; border-left: 2px solid #00c2ff;">`;

        let sortedMonths = Object.keys(tree[year]).sort((a, b) => parseInt(b) - parseInt(a));
        sortedMonths.forEach(month => {
            let key = year + '-' + month; let monthExp = false; let monthTotal = 0;
            Object.values(tree[year][month]).forEach(d => d.forEach(i => monthTotal += i.total));
            fullHtml += `<div class="month-group" style="margin-bottom: 12px;"><div class="month-header" onclick="toggleAccordion('smeta-month-content-${key}', 'smeta-month-icon-${key}')" style="background: #222; padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; border: 1px solid #444;"><span>📆 ${MONTH_NAMES[month]} ${year}</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: #00ff88; font-size: 14px;">${monthTotal.toLocaleString('ru-RU')} ₽</span><span id="smeta-month-icon-${key}">▼</span></span></div><div id="smeta-month-content-${key}" class="hidden" style="margin-top: 8px; padding-left: 12px; border-left: 2px solid #444;">`;

            let sortedDays = Object.keys(tree[year][month]).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0]));
            sortedDays.forEach(date => {
                let dayExp = false; let items = tree[year][month][date]; let dayTotal = 0; items.forEach(i => dayTotal += i.total); let safeId = date.replace(/\./g, '_');
                fullHtml += `<div class="day-group" style="margin-bottom: 8px;"><div class="day-header" onclick="toggleAccordion('smeta-day-content-${safeId}', 'smeta-day-icon-${safeId}')" style="background: #1f1f1f; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #ccc; border-radius: 6px; border: 1px solid #333;"><span>📅 ${date}</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: #00ff88; font-size: 13px;">${dayTotal.toLocaleString('ru-RU')} ₽</span><span id="smeta-day-icon-${safeId}">▼</span></span></div><div id="smeta-day-content-${safeId}" class="hidden" style="background: #111; padding: 0 12px; border-radius: 0 0 6px 6px;">`;
                [...items].sort((a, b) => b.id - a.id).forEach(item => { fullHtml += `<div class="estimate-item"><div class="item-info"><div class="item-name">${item.name}</div><div class="item-details">${item.qty} ${item.unit} × ${item.price} ₽</div></div><div style="display:flex; align-items:center;"><div class="item-total">${item.total.toLocaleString('ru-RU')} ₽</div><button class="delete-item-btn" onclick="deleteEstimateItem(${item.id})">✕</button></div></div>`; });
                fullHtml += `</div></div>`;
            });
            fullHtml += `</div></div>`;
        });
        fullHtml += `</div></div>`;
    });

    if (shouldOpenToday) {
        openTodayAfterRender = false;
        let todayContainer = `<div id="smeta-day-content-${todaySafeId}" class="hidden"`;
        if (fullHtml.includes(todayContainer)) {
            fullHtml = fullHtml.replace(todayContainer, `<div id="smeta-day-content-${todaySafeId}"`);
            fullHtml = fullHtml.replace(`id="smeta-day-icon-${todaySafeId}">▼`, `id="smeta-day-icon-${todaySafeId}">▲`);
        }
    }

    listDiv.innerHTML = fullHtml;
    totalRow.style.display = 'flex';
    totalSumSpan.innerText = grandTotal.toLocaleString('ru-RU') + ' ₽';
    exportButtons.style.display = 'flex';
}

function addToEstimate() {
    const name = document.getElementById('work-name').value; const qty = parseFloat(document.getElementById('work-qty').value); const unit = document.getElementById('work-unit').value; const price = parseFloat(document.getElementById('work-price').value);
    if (!name || isNaN(qty) || isNaN(price)) { alert("Ошибка: заполните все поля!"); return; }
    let savedPrices = JSON.parse(localStorage.getItem(getStorageKey('prices'))) || {}; savedPrices[name.trim().toLowerCase()] = price; localStorage.setItem(getStorageKey('prices'), JSON.stringify(savedPrices));
    currentEstimate.push({ id: Date.now(), name, qty, unit, price, total: qty * price, date: new Date().toLocaleDateString('ru-RU') });
    localStorage.setItem(getStorageKey('estimate'), JSON.stringify(currentEstimate));
    document.getElementById('work-name').value = ''; document.getElementById('work-qty').value = ''; document.getElementById('work-price').value = '';
    openTodayAfterRender = true;
    renderEstimate();
}
window.deleteEstimateItem = (id) => { currentEstimate = currentEstimate.filter(i => i.id !== id); localStorage.setItem(getStorageKey('estimate'), JSON.stringify(currentEstimate)); renderEstimate(); };
document.getElementById('add-btn').addEventListener('click', addToEstimate);

let financeData = JSON.parse(localStorage.getItem(getStorageKey('finance'))) || [];

window.addFinanceManual = function() {
    const type = document.getElementById('fin-type').value; const category = document.getElementById('fin-category').value.trim(); const amountRaw = document.getElementById('fin-amount').value;
    const amount = parseFloat(String(amountRaw).replace(',', '.'));
    if (!category || isNaN(amount) || amount <= 0) { alert("Заполните название и сумму!"); return; }
    financeData.push({ id: Date.now(), type: type, category: category.charAt(0).toUpperCase() + category.slice(1), amount: amount, date: new Date().toLocaleDateString('ru-RU') });
    localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData)); openTodayAfterRender = true; renderFinance();
    document.getElementById('fin-category').value = ''; document.getElementById('fin-amount').value = '';
    statusDiv.innerText = "✅ Запись добавлена вручную!"; statusDiv.style.color = "#00ff88"; setTimeout(()=>{statusDiv.innerText='';}, 2000);
};

function renderFinance() {
    if (openTodayAfterRender) {
        statusDiv.innerText = "DEBUG(fin): today=" + getTodayParts().day
            + " | flag=" + openTodayAfterRender
            + " | keys=" + Object.keys(financeData.reduce((acc, i) => { acc[i.date] = 1; return acc; }, {})).join(',');
    }
    const listDiv = document.getElementById('finance-list');
    const balanceSpan = document.getElementById('finance-balance-sum');

    if (financeData.length === 0) {
        listDiv.innerHTML = '<p style="color: #666; font-size: 14px; text-align: center;">Записей пока нет</p>';
        balanceSpan.innerText = '0 ₽';
        return;
    }

    let todayParts = getTodayParts();
    let todaySafeId = todayParts.day.replace(/\./g, '_');
    let shouldOpenToday = openTodayAfterRender;

    let balance = 0; let tree = {};
    financeData.forEach(item => { if (!item.date || !item.date.includes('.')) return; let p = item.date.split('.'); let year = p[2]; let month = p[1]; if (!tree[year]) tree[year] = {}; if (!tree[year][month]) tree[year][month] = {}; if (!tree[year][month][item.date]) tree[year][month][item.date] = []; tree[year][month][item.date].push(item); balance += item.type === 'income' ? item.amount : -item.amount; });
    let sortedYears = Object.keys(tree).sort((a, b) => parseInt(b) - parseInt(a)); let fullHtml = '';

    sortedYears.forEach(year => {
        let yearTotal = 0;
        Object.values(tree[year]).forEach(m => Object.values(m).forEach(d => d.forEach(i => yearTotal += i.type === 'income' ? i.amount : -i.amount)));
        let yColor = yearTotal >= 0 ? '#00ff88' : '#ff4444'; let ySign = yearTotal > 0 ? '+' : '';
        fullHtml += `<div class="year-group" style="margin-bottom: 15px;"><div class="year-header" onclick="toggleAccordion('fin-year-content-${year}', 'fin-year-icon-${year}')" style="background: linear-gradient(135deg, #1a2a33, #0d1a20); padding: 15px 18px; border-radius: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: bold; color: #00c2ff; border: 1px solid #00c2ff;"><span>📅 ${year} год</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: ${yColor}; font-size: 15px;">${ySign}${yearTotal.toLocaleString('ru-RU')} ₽</span><span id="fin-year-icon-${year}">▼</span></span></div><div id="fin-year-content-${year}" class="hidden" style="margin-top: 10px; padding-left: 12px; border-left: 2px solid #00c2ff;">`;
        let sortedMonths = Object.keys(tree[year]).sort((a, b) => parseInt(b) - parseInt(a));
        sortedMonths.forEach(month => {
            let key = year + '-' + month; let monthTotal = 0;
            Object.values(tree[year][month]).forEach(d => d.forEach(i => monthTotal += i.type === 'income' ? i.amount : -i.amount));
            let mColor = monthTotal >= 0 ? '#00ff88' : '#ff4444'; let mSign = monthTotal > 0 ? '+' : '';
            fullHtml += `<div class="month-group" style="margin-bottom: 12px;"><div class="month-header" onclick="toggleAccordion('fin-month-content-${key}', 'fin-month-icon-${key}')" style="background: #222; padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; border: 1px solid #444;"><span>📆 ${MONTH_NAMES[month]} ${year}</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: ${mColor}; font-size: 14px;">${mSign}${monthTotal.toLocaleString('ru-RU')} ₽</span><span id="fin-month-icon-${key}">▼</span></span></div><div id="fin-month-content-${key}" class="hidden" style="margin-top: 8px; padding-left: 12px; border-left: 2px solid #444;">`;
            let sortedDays = Object.keys(tree[year][month]).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0]));
            sortedDays.forEach(date => {
                let items = tree[year][month][date]; let dayTotal = 0; items.forEach(i => dayTotal += i.type === 'income' ? i.amount : -i.amount);
                let dColor = dayTotal >= 0 ? '#00ff88' : '#ff4444'; let dSign = dayTotal > 0 ? '+' : ''; let safeId = date.replace(/\./g, '_');
                fullHtml += `<div class="day-group" style="margin-bottom: 8px;"><div class="day-header" onclick="toggleAccordion('fin-day-content-${safeId}', 'fin-day-icon-${safeId}')" style="background: #1f1f1f; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #ccc; border-radius: 6px; border: 1px solid #333;"><span>📅 ${date}</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: ${dColor}; font-size: 13px;">${dSign}${dayTotal.toLocaleString('ru-RU')} ₽</span><span id="fin-day-icon-${safeId}">▼</span></span></div><div id="fin-day-content-${safeId}" class="hidden" style="background: #111; padding: 0 12px; border-radius: 0 0 6px 6px;">`;
                [...items].sort((a, b) => b.id - a.id).forEach(item => { const isInc = item.type === 'income'; const s = isInc ? '+' : '-'; const c = isInc ? 'type-income' : 'type-expense'; fullHtml += `<div class="finance-item"><div class="finance-info"><div class="finance-name">${item.category}</div><div class="finance-type ${c}">${isInc ? 'Приход' : 'Расход'}</div></div><div style="display:flex; align-items:center;"><div class="finance-amount ${c}">${s}${item.amount.toLocaleString('ru-RU')} ₽</div><button class="delete-item-btn" onclick="deleteFinance(${item.id})">✕</button></div></div>`; });
                fullHtml += `</div></div>`;
            });
            fullHtml += `</div></div>`;
        });
        fullHtml += `</div></div>`;
    });

    if (shouldOpenToday) {
        openTodayAfterRender = false;
        let todayContainer = `<div id="fin-day-content-${todaySafeId}" class="hidden"`;
        if (fullHtml.includes(todayContainer)) {
            fullHtml = fullHtml.replace(todayContainer, `<div id="fin-day-content-${todaySafeId}"`);
            fullHtml = fullHtml.replace(`id="fin-day-icon-${todaySafeId}">▼`, `id="fin-day-icon-${todaySafeId}">▲`);
        }
    }

    listDiv.innerHTML = fullHtml;
    const bColor = balance >= 0 ? '#00ff88' : '#ff4444';
    balanceSpan.style.color = bColor;
    balanceSpan.innerText = balance.toLocaleString('ru-RU') + ' ₽';
}
window.deleteFinance = (id) => { financeData = financeData.filter(i => i.id !== id); localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData)); renderFinance(); };
window.clearAllFinance = () => { if (confirm("Удалить ВСЕ финансовые записи?")) { financeData = []; localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData)); renderFinance(); } };

let diaryData = JSON.parse(localStorage.getItem(getStorageKey('diary'))) || [];
function renderDiary() {
    if (openTodayAfterRender) {
        statusDiv.innerText = "DEBUG(diary): today=" + getTodayParts().day
            + " | flag=" + openTodayAfterRender
            + " | keys=" + Object.keys(diaryData.reduce((acc, i) => { acc[i.date] = 1; return acc; }, {})).join(',');
    }
    const listDiv = document.getElementById('diary-list');

    if (diaryData.length === 0) {
        listDiv.innerHTML = '<p style="color: #666; font-size: 14px; text-align: center;">Записей пока нет</p>';
        return;
    }

    let todayParts = getTodayParts();
    let todaySafeId = todayParts.day.replace(/\./g, '_');
    let shouldOpenToday = openTodayAfterRender;

    let tree = {}; diaryData.forEach(item => { if (!item.date || !item.date.includes('.')) return; let p = item.date.split('.'); let year = p[2]; let month = p[1]; if (!tree[year]) tree[year] = {}; if (!tree[year][month]) tree[year][month] = {}; if (!tree[year][month][item.date]) tree[year][month][item.date] = []; tree[year][month][item.date].push(item); });
    let sortedYears = Object.keys(tree).sort((a, b) => parseInt(b) - parseInt(a)); let fullHtml = '';

    sortedYears.forEach(year => {
        let yearCount = 0; Object.values(tree[year]).forEach(m => Object.values(m).forEach(d => d.forEach(i => yearCount++)));
        fullHtml += `<div class="year-group" style="margin-bottom: 15px;"><div class="year-header" onclick="toggleAccordion('diary-year-content-${year}', 'diary-year-icon-${year}')" style="background: linear-gradient(135deg, #1a2a33, #0d1a20); padding: 15px 18px; border-radius: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: bold; color: #00c2ff; border: 1px solid #00c2ff;"><span>📅 ${year} год</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: #00c2ff; font-size: 14px;">${yearCount} зап.</span><span id="diary-year-icon-${year}">▼</span></span></div><div id="diary-year-content-${year}" class="hidden" style="margin-top: 10px; padding-left: 12px; border-left: 2px solid #00c2ff;">`;
        let sortedMonths = Object.keys(tree[year]).sort((a, b) => parseInt(b) - parseInt(a));
        sortedMonths.forEach(month => {
            let key = year + '-' + month; let monthCount = 0; Object.values(tree[year][month]).forEach(d => d.forEach(i => monthCount++));
            fullHtml += `<div class="month-group" style="margin-bottom: 12px;"><div class="month-header" onclick="toggleAccordion('diary-month-content-${key}', 'diary-month-icon-${key}')" style="background: #222; padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; border: 1px solid #444;"><span>📆 ${MONTH_NAMES[month]} ${year}</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: #00c2ff; font-size: 14px;">${monthCount} зап.</span><span id="diary-month-icon-${key}">▼</span></span></div><div id="diary-month-content-${key}" class="hidden" style="margin-top: 8px; padding-left: 12px; border-left: 2px solid #444;">`;
            let sortedDays = Object.keys(tree[year][month]).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0]));
            sortedDays.forEach(date => {
                let items = tree[year][month][date]; let safeId = date.replace(/\./g, '_');
                fullHtml += `<div class="day-group" style="margin-bottom: 8px;"><div class="day-header" onclick="toggleAccordion('diary-day-content-${safeId}', 'diary-day-icon-${safeId}')" style="background: #1f1f1f; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #ccc; border-radius: 6px; border: 1px solid #333;"><span>📅 ${date}</span><span style="display: flex; gap: 12px; align-items: center;"><span style="color: #00c2ff; font-size: 13px;">${items.length} зап.</span><span id="diary-day-icon-${safeId}">▼</span></span></div><div id="diary-day-content-${safeId}" class="hidden" style="background: #111; padding: 0 12px; border-radius: 0 0 6px 6px;">`;
                [...items].sort((a, b) => b.id - a.id).forEach(item => { fullHtml += `<div class="diary-item"><div class="diary-info"><div class="diary-text">${item.text}</div><div class="diary-time">${item.time}</div></div><button class="delete-item-btn" onclick="deleteDiary(${item.id})">✕</button></div>`; });
                fullHtml += `</div></div>`;
            });
            fullHtml += `</div></div>`;
        });
        fullHtml += `</div></div>`;
    });

    if (shouldOpenToday) {
        openTodayAfterRender = false;
        let todayContainer = `<div id="diary-day-content-${todaySafeId}" class="hidden"`;
        if (fullHtml.includes(todayContainer)) {
            fullHtml = fullHtml.replace(todayContainer, `<div id="diary-day-content-${todaySafeId}"`);
            fullHtml = fullHtml.replace(`id="diary-day-icon-${todaySafeId}">▼`, `id="diary-day-icon-${todaySafeId}">▲`);
        }
    }

    listDiv.innerHTML = fullHtml;
}
document.getElementById('add-diary-btn').addEventListener('click', () => {
    const val = document.getElementById('diary-input').value.trim();
    if (!val) return;
    const now = new Date();
    diaryData.push({
        id: Date.now(),
        text: val,
        date: now.toLocaleDateString('ru-RU'),
        time: now.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})
    });
    localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData));
    document.getElementById('diary-input').value = '';
    openTodayAfterRender = true;
    renderDiary();
});
window.deleteDiary = (id) => { diaryData = diaryData.filter(i => i.id !== id); localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData)); renderDiary(); };
window.clearAllDiary = () => { if (confirm("Удалить ВСЕ записи дневника?")) { diaryData = []; localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData)); renderDiary(); } };

let remindersData = JSON.parse(localStorage.getItem(getStorageKey('reminders'))) || [];
window.addReminderManual = function() {
    const textInput = document.getElementById('rem-text').value.trim();
    const dateInput = document.getElementById('rem-date').value;
    const timeInput = document.getElementById('rem-time').value;
    if (!textInput || !dateInput || !timeInput) { alert("Заполните текст, дату и время!"); return; }
    const targetDate = new Date(dateInput + 'T' + timeInput);
    const timestamp = targetDate.getTime();
    if (timestamp < Date.now()) { alert("Нельзя ставить напоминание на прошлое время!"); return; }
    if (window.AndroidApp && window.AndroidApp.setAlarm) { window.AndroidApp.setAlarm(timestamp, textInput); }
    remindersData.push({ id: Date.now(), text: textInput, time: timestamp, dateStr: targetDate.toLocaleString('ru-RU') });
    localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData));
    renderReminders();
    document.getElementById('rem-text').value = ''; document.getElementById('rem-date').value = ''; document.getElementById('rem-time').value = '';
    statusDiv.innerText = "✅ Напоминание добавлено!"; statusDiv.style.color = "#00ff88"; setTimeout(()=>{statusDiv.innerText='';}, 2000);
};

function renderReminders() {
    const listDiv = document.getElementById('reminders-list');
    let active = remindersData.filter(r => r.time > Date.now()).sort((a,b) => a.time - b.time); let past = remindersData.filter(r => r.time <= Date.now()).sort((a,b) => b.time - a.time);
    if (active.length === 0 && past.length === 0) { listDiv.innerHTML = '<p style="color: #666; font-size: 14px; text-align: center;">Нет напоминаний</p>'; return; }
    let html = '';
    if (active.length > 0) { html += '<h4 style="color: #00c2ff; margin-bottom: 10px;">Активные:</h4>'; active.forEach(r => { html += `<div class="reminder-item"><div class="reminder-info"><div class="reminder-text">${r.text}</div><div class="reminder-time">⏰ ${r.dateStr}</div></div><button class="delete-item-btn" onclick="deleteReminder(${r.id})">✕</button></div>`; }); }
    if (past.length > 0) { html += '<h4 style="color: #666; margin-top: 20px; margin-bottom: 10px;">Прошедшие:</h4>'; past.forEach(r => { html += `<div class="reminder-item" style="opacity: 0.5;"><div class="reminder-info"><div class="reminder-text">${r.text}</div><div class="reminder-time">⏰ ${r.dateStr}</div></div><button class="delete-item-btn" onclick="deleteReminder(${r.id})">✕</button></div>`; }); }
    listDiv.innerHTML = html;
}
window.deleteReminder = (id) => { remindersData = remindersData.filter(r => r.id !== id); localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData)); renderReminders(); };
window.clearAllReminders = () => { if (confirm("Удалить все напоминания?")) { remindersData = []; localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData)); renderReminders(); } };

let warehouseData = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
document.getElementById('add-wh-btn').addEventListener('click', () => {
    const nameInput = (document.getElementById('wh-name').value || '').trim(); const qtyRaw = document.getElementById('wh-qty').value; const unit = document.getElementById('wh-unit').value; const priceRaw = document.getElementById('wh-price').value;
    const qty = parseFloat(String(qtyRaw).replace(',', '.')); const price = parseFloat(String(priceRaw).replace(',', '.')) || 0;
    if (!nameInput || isNaN(qty)) { alert("Заполните название и количество!"); return; }
    const existingIndex = warehouseData.findIndex(item => item.name.toLowerCase() === nameInput.toLowerCase());
    if (existingIndex !== -1) {
        warehouseData[existingIndex].qty += qty;
        if (price > 0) { warehouseData[existingIndex].price = price; }
        warehouseData[existingIndex].id = Date.now();
    } else { warehouseData.push({ id: Date.now(), name: nameInput, qty, unit, price }); }
    localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(warehouseData));
    document.getElementById('wh-name').value = ''; document.getElementById('wh-qty').value = ''; document.getElementById('wh-price').value = '';
    renderWarehouse();
});

function renderWarehouse() {
    const listDiv = document.getElementById('warehouse-list');
    if (warehouseData.length === 0) { listDiv.innerHTML = '<p style="color: #666; font-size: 14px; text-align: center;">Склад пуст</p>'; return; }
    let html = '';
    warehouseData.sort((a,b) => b.id - a.id).forEach(item => {
        const isLowStock = item.qty < 10;
        const qtyColor = isLowStock ? '#ff4444' : '#00ff88';
        const warningIcon = isLowStock ? ' ⚠️' : '';
        html += `
        <div class="warehouse-item" style="border-left: 3px solid ${isLowStock ? '#ff4444' : '#00c2ff'}; display: flex; justify-content: space-between; align-items: center; padding-right: 10px;">
            <div class="warehouse-info" style="flex: 1;">
                <div class="warehouse-name">${item.name}${warningIcon}</div>
                <div class="warehouse-details">Остаток: <span style="color: ${qtyColor}; font-weight: bold;">${item.qty} ${item.unit}</span> • Цена: ${item.price} ₽</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="writeOffWarehouseItem(${item.id})" style="background: #ff9800; color: white; border: none; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; font-weight: bold;">Списать</button>
                <button class="delete-item-btn" onclick="deleteWarehouseItem(${item.id})">✕</button>
            </div>
        </div>`;
    });
    listDiv.innerHTML = html;
}

window.writeOffWarehouseItem = function(id) {
    const item = warehouseData.find(i => i.id === id);
    if (!item) return;
    let amountStr = prompt(`Сколько списать "${item.name}"? (Остаток: ${item.qty} ${item.unit})`);
    if (amountStr === null) return;
    let amount = parseFloat(String(amountStr).replace(',', '.'));
    if (isNaN(amount) || amount <= 0) { alert("Введите правильное число больше нуля!"); return; }
    if (amount > item.qty) { if (!confirm(`Внимание! Вы пытаетесь списать ${amount}, а на складе только ${item.qty}. Продолжить (уйти в минус)?`)) { return; } }
    item.qty -= amount;
    item.id = Date.now();
    localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(warehouseData));
    renderWarehouse();
};
window.deleteWarehouseItem = (id) => { warehouseData = warehouseData.filter(i => i.id !== id); localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(warehouseData)); renderWarehouse(); };

// ==========================================
// PDF
// ==========================================
function createPdfHtml() {
    const dateStr = new Date().toLocaleDateString('ru-RU'); const docNumber = Math.floor(Date.now() / 1000).toString().slice(-4);
    let rowsHtml = ''; let total = 0;
    currentEstimate.forEach((item, index) => { total += item.total; rowsHtml += `<tr><td style="border: 1px solid #000; padding: 10px; text-align: center;">${index + 1}</td><td style="border: 1px solid #000; padding: 10px;">${item.name}</td><td style="border: 1px solid #000; padding: 10px; text-align: center;">${item.unit}</td><td style="border: 1px solid #000; padding: 10px; text-align: right;">${item.qty}</td><td style="border: 1px solid #000; padding: 10px; text-align: right;">${item.price.toLocaleString('ru-RU')} ₽</td><td style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold;">${item.total.toLocaleString('ru-RU')} ₽</td></tr>`; });

    const savedLogo = localStorage.getItem('my_logo');
    let logoHtml = savedLogo ? `<img src="${savedLogo}" style="max-height: 80px; max-width: 150px; object-fit: contain; margin-bottom: 10px;">` : '';

    let companyStr = settings.company ? `<b>${settings.company}</b><br>` : '';
    let phoneStr = settings.phone ? `<br>Тел: ${settings.phone}` : '';

    return `<div style="font-family: 'Times New Roman', Times, serif; color: #000; background: #fff; padding: 40px; width: 800px;"><div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px;"><div><h1 style="margin: 0; font-size: 28px; text-transform: uppercase;">Смета на работы</h1><p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">№ ${docNumber} от ${dateStr}<br>Объект: ${currentObject}</p></div><div style="text-align: right;">${logoHtml}<p style="margin: 0; font-size: 14px;">${companyStr}Исполнитель${phoneStr}</p><p style="margin: 5px 0 0 0; font-size: 14px;">Сформировано в «ALVENIMA»</p></div></div><table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;"><thead><tr style="background: #eee;"><th style="border: 1px solid #000; padding: 10px;">№</th><th style="border: 1px solid #000; padding: 10px; text-align: left;">Наименование работ</th><th style="border: 1px solid #000; padding: 10px;">Ед. изм.</th><th style="border: 1px solid #000; padding: 10px;">Кол-во</th><th style="border: 1px solid #000; padding: 10px;">Цена за ед.</th><th style="border: 1px solid #000; padding: 10px;">Сумма</th></tr></thead><tbody>${rowsHtml}</tbody></table><div style="text-align: right; margin-bottom: 50px;"><h2 style="margin: 0; font-size: 20px; border-bottom: 2px solid #000; display: inline-block; padding-bottom: 5px;">ИТОГО: ${total.toLocaleString('ru-RU')} ₽</h2></div><div style="display: flex; justify-content: space-between; margin-top: 50px; font-size: 14px;"><div style="width: 45%;"><p style="margin: 0 0 20px 0;"><b>Заказчик:</b></p><div style="border-bottom: 1px solid #000; width: 100%; margin-bottom: 5px;"></div><p style="margin: 0; font-size: 12px; text-align: center; color: #555;">(подпись)</p></div><div style="width: 45%;"><p style="margin: 0 0 20px 0;"><b>Исполнитель:</b></p><div style="border-bottom: 1px solid #000; width: 100%; margin-bottom: 5px;"></div><p style="margin: 0; font-size: 12px; text-align: center; color: #555;">(подпись)</p></div></div></div>`;
}

async function generatePdfDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.innerHTML = createPdfHtml();
    document.body.appendChild(tempDiv);
    const canvas = await html2canvas(tempDiv, { scale: 2, backgroundColor: '#ffffff' });
    document.body.removeChild(tempDiv);
    const pxPerMm = canvas.width / usableWidth;
    const pageContentHeightPx = (pageHeight - margin * 2) * pxPerMm;
    let renderedHeight = 0;
    let pageIndex = 0;
    while (renderedHeight < canvas.height) {
        const sliceHeight = Math.min(pageContentHeightPx, canvas.height - renderedHeight);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeight;
        const ctx = sliceCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, renderedHeight, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
        const sliceHeightMm = sliceHeight / pxPerMm;
        if (pageIndex > 0) doc.addPage();
        doc.addImage(imgData, 'JPEG', margin, margin, usableWidth, sliceHeightMm);
        renderedHeight += sliceHeight;
        pageIndex++;
    }
    return doc;
}

window.downloadPDF = async () => {
    const doc = await generatePdfDoc();
    const pdfBase64 = doc.output('datauristring');
    if (window.AndroidApp) { window.AndroidApp.savePdf(pdfBase64); } else { doc.save(`Смета_${new Date().getTime()}.pdf`); }
};

window.shareEstimate = async () => {
    const doc = await generatePdfDoc();
    const pdfBase64 = doc.output('datauristring');
    if (window.AndroidApp) { window.AndroidApp.sharePdf(pdfBase64); } else { alert("Отправка файлов доступна только в приложении."); }
};

// ==========================================
// СВАЙПЫ ДЛЯ ПЕРЕКЛЮЧЕНИЯ ЭКРАНОВ (С АНИМАЦИЕЙ)
// ==========================================
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
const swipeViews = ['home', 'smeta', 'finance', 'diary', 'reminders', 'warehouse'];

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipeGesture();
}, { passive: true });

function handleSwipeGesture() {
    if (currentMicMode === 'splash' || currentMicMode === 'objects') return;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        let currentIndex = swipeViews.indexOf(currentMicMode);
        if (currentIndex === -1) return;
        let targetViewId = null;
        let animationClass = '';
        if (diffX > 0) {
            if (currentIndex > 0) { targetViewId = swipeViews[currentIndex - 1]; animationClass = 'slide-in-left'; }
            else { targetViewId = 'objects'; animationClass = 'slide-in-left'; }
        } else {
            if (currentIndex < swipeViews.length - 1) { targetViewId = swipeViews[currentIndex + 1]; animationClass = 'slide-in-right'; }
        }
        if (targetViewId) {
            switchView(targetViewId);
            const newViewElement = document.getElementById('view-' + targetViewId);
            if (newViewElement) {
                newViewElement.classList.add(animationClass);
                setTimeout(() => { newViewElement.classList.remove(animationClass); }, 300);
            }
        }
    }
}

// ==========================================
// АВТОСОХРАНЕНИЕ ТУМБЛЕРА ПРИ КЛИКЕ
// ==========================================
setTimeout(() => {
    const autosaveCb = document.getElementById('setting-autosave');
    if (autosaveCb) {
        autosaveCb.addEventListener('change', function() {
            settings.autosave = this.checked;
            localStorage.setItem('my_settings', JSON.stringify(settings));

            statusDiv.innerText = this.checked ? "✅ Автосохранение ВКЛ" : "❌ Автосохранение ВЫКЛ";
            statusDiv.style.color = this.checked ? "#00ff88" : "#ff4444";
            setTimeout(()=>{statusDiv.innerText='';}, 2000);
        });
    }
}, 1000);

renderSplash();

setTimeout(() => {
    let splash = document.getElementById('view-splash');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => {
            splash.style.display = 'none';
            switchView('objects');
        }, 600);
    }
}, 2500);

updateLogoPreview();
renderEstimate();
renderFinance();
renderDiary();
renderReminders();
renderWarehouse();