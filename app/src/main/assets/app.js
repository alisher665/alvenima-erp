const statusDiv = document.getElementById('status');
let isRecording = false;
let currentMicMode = 'splash';
let awaitingConfirm = false;
let pendingDeleteAction = null;
let wasRecordingBeforeTts = false;
let pendingItemId = null;
let currentView = null;
let warehouseFilterMode = 'all';
let editingWarehouseId = null;

// Глобальное состояние открытых аккордеонов.
const openAccordions = {
    smeta: new Set(),
    finance: new Set(),
    diary: new Set(),
    warehouse: new Set()
};

function clearAccordionState(screen) {
    if (openAccordions[screen]) openAccordions[screen].clear();
}

function logStatus(msg) {
    if (statusDiv) {
        statusDiv.innerText = msg;
        statusDiv.style.display = 'block';
    }
}

const MONTH_NAMES = { "01": "Январь", "02": "Февраль", "03": "Март", "04": "Апрель", "05": "Май", "06": "Июнь", "07": "Июль", "08": "Август", "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь" };

let objectsList = JSON.parse(localStorage.getItem('my_objects')) || [];
let currentObject = localStorage.getItem('current_object') || '';
let settings = JSON.parse(localStorage.getItem('my_settings')) || { company: '', phone: '', currency: '₽' };

function getStorageKey(baseName) {
    let obj = currentObject ? currentObject : 'default';
    return obj + '_' + baseName;
}

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

    if (typeof loadLogo === 'function') {
        loadLogo();
    }
}

window.exportData = function() {
    let backupData = {};
    for (let i = 0; i < localStorage.length; i++) {
        let key = localStorage.key(i);
        backupData[key] = localStorage.getItem(key);
    }
    let jsonStr = JSON.stringify(backupData, null, 2);

    let d = new Date();
    let pad = n => (n < 10 ? '0' + n : '' + n);
    let stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
    let fileName = "ALVENIMA_BACKUP_" + stamp + ".json";

    statusDiv.innerText = "⏳ Сохраняю бэкап...";
    statusDiv.style.color = "#00c2ff";

    if (window.AndroidApp && window.AndroidApp.saveBackupToDownloads) {
        try {
            window.AndroidApp.saveBackupToDownloads(jsonStr, fileName);
        } catch (e) {
            statusDiv.innerText = "❌ Ошибка вызова Java: " + e.message;
            statusDiv.style.color = "#ff4444";
        }
    } else {
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

window.switchView = function(viewId) {
    if (currentMicMode === 'smeta')   clearAccordionState('smeta');
    if (currentMicMode === 'finance') clearAccordionState('finance');
    if (currentMicMode === 'diary')   clearAccordionState('diary');

    document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-' + viewId).classList.remove('hidden');

    currentMicMode = viewId;
    currentView = viewId;

    if (viewId === 'smeta')   renderEstimate();
    if (viewId === 'finance') renderFinance();
    if (viewId === 'diary')   renderDiary();
    if (viewId === 'warehouse') renderWarehouse();

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

    const objectName = currentObject || 'Не выбран';
    const badgeIds = ['badge-smeta', 'badge-finance', 'badge-diary', 'badge-reminders', 'badge-warehouse', 'badge-settings'];
    badgeIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '📁 ' + objectName;
    });

    logStatus(`Экран: ${viewId}.`);
};

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

    if (cleanText.includes("очисти") || cleanText.includes("очистить") || cleanText.includes("сбрось") || cleanText.includes("сбросить")) {
        if (currentMicMode === 'smeta') { document.getElementById('work-name').value = ''; document.getElementById('work-qty').value = ''; document.getElementById('work-price').value = ''; }
        else if (currentMicMode === 'finance') { document.getElementById('fin-category').value = ''; document.getElementById('fin-amount').value = ''; }
        else if (currentMicMode === 'diary') { document.getElementById('diary-input').value = ''; }
        else if (currentMicMode === 'reminders') { document.getElementById('rem-text').value = ''; document.getElementById('rem-date').value = ''; document.getElementById('rem-time').value = ''; }
        else if (currentMicMode === 'warehouse') { document.getElementById('wh-name').value = ''; document.getElementById('wh-qty').value = ''; document.getElementById('wh-price').value = ''; }
        statusDiv.innerText = "🧹 Поля очищены!"; speak("Очищено"); return;
    }

    if (cleanText.includes("главная") || cleanText.includes("меню") || cleanText.includes("назад")) { switchView(currentObject ? 'home' : 'objects'); return; }
    if (cleanText === "смета" || cleanText.includes("открой смету")) { switchView('smeta'); return; }
    if (cleanText === "финансы" || cleanText.includes("открой финансы")) { switchView('finance'); return; }
    if (cleanText === "дневник" || cleanText.includes("открой дневник")) { switchView('diary'); return; }
    if (cleanText === "напоминания" || cleanText.includes("открой напоминания")) { switchView('reminders'); return; }
    if (cleanText === "склад" || cleanText.includes("открой склад")) { switchView('warehouse'); return; }
    if (cleanText === "настройки" || cleanText.includes("открой настройки")) { switchView('settings'); return; }

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

    if (currentMicMode === 'smeta') parseSmetaVoice(lower);
    else if (currentMicMode === 'finance') parseFinanceVoice(lower);
    else if (currentMicMode === 'diary') parseDiaryVoice(lower);
    else if (currentMicMode === 'reminders') parseReminderVoice(lower);
    else if (currentMicMode === 'warehouse') parseWarehouseVoice(lower);
}

function parseSmetaVoice(lower) {
    let isAutoSmeta = settings.autosave === true;
    if ((lower.includes("добавь") || lower.includes("сохрани") || lower.includes("запиши")) && document.getElementById('work-name').value.trim() !== '') {
        addToEstimate(); return;
    }
    let words = lower.split(/\s+/);
    let nameWords = []; let qty = 0; let currentNum = 0; let unit = "м²"; let price = 0; let priceCurrent = 0; let afterPo = false;
    for (let i = 0; i < words.length; i++) {
        let w = words[i].replace(/[^а-я0-9.]/g, '');
        if (!w) continue;
        if (w === "по" || w === "за") { afterPo = true; continue; }
        if (w.match(/^\d+(\.\d+)?$/)) { if (afterPo) price += parseFloat(w); else qty += parseFloat(w); continue; }
        if (NUMBERS_MAP[w] !== undefined) {
            let val = NUMBERS_MAP[w];
            if (val >= 1000) { if (afterPo) { if (priceCurrent === 0) priceCurrent = 1; price += priceCurrent * val; priceCurrent = 0; } else { if (currentNum === 0) currentNum = 1; qty += currentNum * val; currentNum = 0; } }
            else { if (afterPo) priceCurrent += val; else currentNum += val; }
            continue;
        }
        if (w === "половиной") { afterPo ? price += 0.5 : qty += 0.5; continue; }
        if (w === "полтора") { afterPo ? price += 1.5 : qty += 1.5; continue; }
        if (UNITS_MAP[w] !== undefined) { unit = UNITS_MAP[w]; continue; }
        if (w === "на" || w === "с" || w === "и" || w === "в" || w === "от" || w === "до" || w === "добавь" || w === "добавить" || w === "запиши" || w === "сохрани") continue;
        nameWords.push(words[i]);
    }
    qty += currentNum; price += priceCurrent;
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
    } else { statusDiv.innerText = "Данные вставлены."; }

    let priceVal = parseFloat(document.getElementById('work-price').value);
    if (isAutoSmeta && finalName && qty > 0 && !isNaN(priceVal) && priceVal > 0) {
        addToEstimate(); statusDiv.innerText = "✅ Автосохранено в Смету!"; speak("Сохранено");
    }
}

function parseFinanceVoice(lower) {
    if (lower.includes('удали') || lower.includes('удалить')) {
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

    if (lower.includes('сохрани') || lower.includes('добавь') || lower.includes('запиши')) {
        const typeEl = document.getElementById('fin-type');
        const categoryEl = document.getElementById('fin-category');
        const amountEl = document.getElementById('fin-amount');
        if (!categoryEl.value.trim() || !parseFloat(amountEl.value)) { speak("Поля пустые"); return; }
        financeData.push({ id: Date.now(), type: typeEl.value, category: categoryEl.value, amount: parseFloat(amountEl.value), date: new Date().toLocaleDateString('ru-RU') });
        localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData));
        categoryEl.value = ''; amountEl.value = '';
        renderFinance();
        statusDiv.innerText = "✅ Сохранено!"; speak("Сохранено"); return;
    }

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

    if (settings.autosave && finalName && amount > 0) {
        financeData.push({ id: Date.now(), type: type, category: finalName.charAt(0).toUpperCase() + finalName.slice(1), amount: amount, date: new Date().toLocaleDateString('ru-RU') });
        localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData));
        document.getElementById('fin-category').value = '';
        document.getElementById('fin-amount').value = '';
        renderFinance();
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
        localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData));
        inputEl.value = '';
        renderDiary();
        statusDiv.innerText = "✅ Запись сохранена!"; speak("Сохранено"); return;
    }
    let cleanText = lower.replace(/сохрани|добавь|запиши/g, '').trim();
    if (cleanText.length > 0) {
        if (inputEl.value.trim() !== '') { inputEl.value += ' ' + cleanText; } else { inputEl.value = cleanText.charAt(0).toUpperCase() + cleanText.slice(1); }
        statusDiv.innerText = "📝 Текст добавлен в поле. Скажите 'Сохрани', чтобы записать.";
    }
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
// СКЛАД (НОВАЯ ЛОГИКА)
// ==========================================
function renderWarehouse() {
  const box = document.getElementById('warehouse-list');
  if (!box) return;

  // Синхронизируем активную кнопку фильтра при отрисовке
  const activeBtn = document.querySelector(`.filter-btn[data-filter="${warehouseFilterMode || 'all'}"]`);
  if (activeBtn) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
  }

  const key = getStorageKey('warehouse');
  let data = [];
  try {
    data = JSON.parse(localStorage.getItem(key) || '[]');
  } catch (e) {
    data = [];
  }
  if (!Array.isArray(data)) data = [];

    // 1. Поиск
    const searchInput = document.getElementById('wh-search');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // --- НОВЫЙ БЛОК: Умное автозаполнение формы ---
  if (query.length > 0 && editingWarehouseId === null) {
      const foundItem = data.find(i => i.name.toLowerCase().includes(query));
      if (foundItem) {
          const nameEl = document.getElementById('wh-name');
          const qtyEl = document.getElementById('wh-qty');
          const unitEl = document.getElementById('wh-unit');
          const priceEl = document.getElementById('wh-price');
          const categoryEl = document.getElementById('wh-category');
          const addBtn = document.getElementById('add-wh-btn');
          const cancelBtn = document.getElementById('cancel-edit-wh-btn');

          // Заполняем только если поле пустое
          if (nameEl && nameEl.value.trim() === '') {
              nameEl.value = foundItem.name;
              if (qtyEl) qtyEl.value = foundItem.qty || 0;
              if (unitEl) unitEl.value = foundItem.unit || 'шт.';
              if (priceEl) priceEl.value = foundItem.price || '';
              if (categoryEl && foundItem.category) categoryEl.value = foundItem.category;

              // Включаем режим редактирования
              editingWarehouseId = foundItem.id;
              if (addBtn) addBtn.innerText = "Сохранить изменения";
              if (cancelBtn) cancelBtn.classList.remove('hidden');
          }
      }
  } else if (query.length === 0 && editingWarehouseId === null) {
      // Очистка формы при пустом поиске
      const nameEl = document.getElementById('wh-name');
      if (nameEl && nameEl.value !== '') {
          document.getElementById('wh-name').value = '';
          document.getElementById('wh-qty').value = '';
          document.getElementById('wh-price').value = '';
      }
  }

    // ----------------------------------------------
    // 2. Фильтр
  if (typeof warehouseFilterMode === 'undefined' || !warehouseFilterMode) {
    warehouseFilterMode = 'all';
  }

  // 3. Применяем поиск + фильтр
  let filtered = data.filter(item => {
    const name = (item.name || '').toLowerCase();
    const cat = (item.category || '').toLowerCase();
    const matchQuery = !query || name.indexOf(query) !== -1 || cat.indexOf(query) !== -1;
    if (!matchQuery) return false;

    const qty = Number(item.qty) || 0;
    if (warehouseFilterMode === 'low') return qty > 0 && qty <= 5;
    if (warehouseFilterMode === 'out') return qty <= 0;
    return true;
  });

  // 4. Плашка предупреждений
  updateWarehouseWarnings(data);

  // 5. Пустое состояние
  // 5. Пустое состояние
  if (filtered.length === 0) {
    box.innerHTML = '<div class="empty-state" style="text-align:center; color:#ff9800; padding:20px; font-weight:bold;">' +
      (data.length === 0
        ? 'Склад пуст. Добавьте материал.'
        : 'Ничего не найдено по текущему фильтру или поиску.') +
      '</div>';

    const totalRow = document.getElementById('wh-total-row');
    if (totalRow) totalRow.style.display = 'none';
    return;
  }

  // 6. Группировка по категориям
  const groups = {};
  filtered.forEach(item => {
    const cat = item.category && item.category.trim() ? item.category.trim() : 'Без категории';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  // 7. Сортировка категорий по алфавиту
  const categories = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'ru'));

  // 8. Рендер аккордеонов
  let html = '';
  categories.forEach(cat => {
    const isOpen = openAccordions.warehouse.has(cat);
    const items = groups[cat].slice().sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'ru')
    );

    html += '<div class="wh-category-block" data-category="' + cat + '" style="margin-bottom:15px; background:#1a1a1a; border-radius:10px; overflow:hidden; border:1px solid #333;">';
    html += '<div class="wh-category-header" onclick="toggleWarehouseCategory(\'' + cat.replace(/'/g, "\\'") + '\')" style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px; background:#222; cursor:pointer; font-weight:bold; color:#fff;">';
    html += '<span class="wh-category-arrow">' + (isOpen ? '▾' : '▸') + '</span>';
    html += '<span class="wh-category-name" style="flex:1; margin-left:10px;">' + cat + '</span>';
    html += '<span class="wh-category-count" style="background:#333; color:#00c2ff; padding:2px 8px; border-radius:10px; font-size:12px;">' + items.length + '</span>';
    html += '</div>';

    if (isOpen) {
      html += '<div class="wh-category-body" style="padding:10px;">';
      items.forEach(item => {
        const qty = Number(item.qty) || 0;
        const qtyColor = qty <= 0 ? 'color:#ff4444; font-weight:bold;' : (qty <= 5 ? 'color:#ff9800; font-weight:bold;' : 'color:#aaa;');
        html += '<div class="wh-card" style="display:flex; justify-content:space-between; align-items:center; background:#151515; border:1px solid #222; border-radius:8px; padding:10px; margin-bottom:8px;">';
        html += '<div class="wh-card-main">';
        html += '<div class="wh-card-title" style="font-weight:bold; font-size:14px; color:#fff;">' + (item.name || '') + '</div>';
        html += '<div class="wh-card-qty" style="font-size:13px; ' + qtyColor + '">' + qty + ' ' + (item.unit || '') + '</div>';
        if (item.price) {
          html += '<div class="wh-card-price" style="font-size:12px; color:#666;">' + item.price + ' ₽</div>';
        }
        html += '</div>';
        html += '<div class="wh-card-actions" style="display:flex; gap:5px;">';

        // Кнопка отслеживания (вкл/выкл)
        const isTracked = item.trackQty !== false; // По умолчанию включено
        const bellColor = isTracked ? '#00c2ff' : '#555';
        html += '<button class="wh-btn" onclick="toggleWarehouseTracking(' + item.id + ')" style="background:#222; border:1px solid #444; color:' + bellColor + '; border-radius:6px; padding:5px 10px; cursor:pointer;" title="Отслеживать остаток">🔔</button>';

        html += '<button class="wh-btn" onclick="changeWarehouseQty(' + item.id + ', 1)" style="background:#222; border:1px solid #444; color:#00ff88; border-radius:6px; padding:5px 10px; cursor:pointer;">+</button>';
        html += '<button class="wh-btn" onclick="changeWarehouseQty(' + item.id + ', -1)" style="background:#222; border:1px solid #444; color:#ff9800; border-radius:6px; padding:5px 10px; cursor:pointer;">-</button>';
        html += '<button class="wh-btn" onclick="startEditWarehouse(' + item.id + ')" style="background:#222; border:1px solid #444; color:#00c2ff; border-radius:6px; padding:5px 10px; cursor:pointer;">✏️</button>';
        html += '<button class="wh-btn" onclick="deleteWarehouseItem(' + item.id + ')" style="background:#222; border:1px solid #444; color:#ff4444; border-radius:6px; padding:5px 10px; cursor:pointer;">✕</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  });

  box.innerHTML = html;

  // --- РАСЧЕТ ОБЩЕЙ СТОИМОСТИ СКЛАДА ---
  const totalRow = document.getElementById('wh-total-row');
  const totalSumEl = document.getElementById('wh-total-sum');

  if (totalRow && totalSumEl) {
      // Считаем по всему массиву data, а не по отфильтрованному
      const totalCost = data.reduce((sum, item) => {
          const qty = Number(item.qty) || 0;
          const price = Number(item.price) || 0;
          return sum + (qty * price);
      }, 0);

      if (totalCost > 0) {
          totalRow.style.display = 'flex';
          totalSumEl.innerText = totalCost.toLocaleString('ru-RU') + ' ' + (settings.currency || '₽');
      } else {
          totalRow.style.display = 'none';
      }
  }
}

// Раскрытие/сворачивание категории
function toggleWarehouseCategory(cat) {
    if (openAccordions.warehouse.has(cat)) {
        openAccordions.warehouse.delete(cat);
    } else {
        openAccordions.warehouse.add(cat);
    }
    renderWarehouse();
}

// Изменение количества (+/-)
function changeWarehouseQty(id, delta) {
    let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    let item = data.find(i => i.id === id);
    if (item) {
        item.qty = (Number(item.qty) || 0) + delta;
        if (item.qty < 0) item.qty = 0;
        localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(data));
        renderWarehouse();
        logStatus('Количество обновлено: ' + item.name);
    }
}

// Удаление материала
function deleteWarehouseItem(id) {
    if (confirm('Удалить этот материал со склада?')) {
        let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
        data = data.filter(i => i.id !== id);
        localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(data));
        if (editingWarehouseId === id) {
            cancelEditWarehouse();
        } else {
            renderWarehouse();
        }
        logStatus('Материал удален.');
    }
}

function toggleWarehouseTracking(id) {
    let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    let item = data.find(i => i.id === id);
    if (item) {
        // Если было true или не задано, ставим false, и наоборот
        item.trackQty = (item.trackQty === false) ? true : false;
        localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(data));
        renderWarehouse();
        logStatus(item.trackQty ? 'Отслеживание включено' : 'Отслеживание выключено');
    }
}

// Редактирование материала
function startEditWarehouse(id) {
    let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    const item = data.find(i => i.id === id);
    if (!item) return;

    document.getElementById('wh-name').value = item.name;
    document.getElementById('wh-qty').value = item.qty;
    document.getElementById('wh-unit').value = item.unit;
    document.getElementById('wh-price').value = item.price || '';

    // --- НОВЫЙ БЛОК ---
    const categoryEl = document.getElementById('wh-category');
    if (categoryEl && item.category) {
        categoryEl.value = item.category;
    }
    // ------------------

    editingWarehouseId = id;
    const cancelBtn = document.getElementById('cancel-edit-wh-btn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    document.getElementById('add-wh-btn').innerText = "Сохранить изменения";

    const formCard = document.getElementById('wh-form-card');
    if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
    logStatus("✏️ Режим редактирования");
}

function cancelEditWarehouse() {
    editingWarehouseId = null;
    document.getElementById('wh-name').value = '';
    document.getElementById('wh-qty').value = '';
    document.getElementById('wh-price').value = '';
    const cancelBtn = document.getElementById('cancel-edit-wh-btn');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    document.getElementById('add-wh-btn').innerText = "Добавить (Приход)";
    logStatus("Редактирование отменено");
}

function updateWarehouseWarnings(data) {
    const block = document.getElementById('wh-warning-block');
    const list = document.getElementById('wh-warning-list');
    if (!block || !list) return;

    const lowItems = data.filter(item => {
        const qty = Number(item.qty) || 0;
        // Если у материала явно выключено отслеживание, пропускаем его
        if (item.trackQty === false) return false;

        return qty > 0 && qty <= 5;
    });

    if (lowItems.length === 0) {
        block.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    let html = '';
    lowItems.forEach(item => {
        html += '• ' + item.name + ' (осталось ' + item.qty + ' ' + (item.unit || '') + ')<br>';
    });

    list.innerHTML = html;
    block.style.display = 'block';
}

function setWarehouseFilter(mode) {
    warehouseFilterMode = mode;
    renderWarehouse();
}

function addWarehouseManual() {
    const nameEl = document.getElementById('wh-name');
    const qtyEl = document.getElementById('wh-qty');
    const unitEl = document.getElementById('wh-unit');
    const priceEl = document.getElementById('wh-price');
    const categoryEl = document.getElementById('wh-category');

    const name = nameEl.value.trim();
    const qty = parseFloat(qtyEl.value) || 0;
    const unit = unitEl.value;
    const price = parseFloat(priceEl.value) || 0;
    const category = categoryEl ? categoryEl.value : 'Без категории';

    if (!name) { logStatus('Ошибка: Введите название материала'); return; }
    if (qty <= 0) { logStatus('Ошибка: Количество должно быть больше 0'); return; }

    let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];

    if (editingWarehouseId !== null) {
        // РЕЖИМ РЕДАКТИРОВАНИЯ
        const index = data.findIndex(i => i.id === editingWarehouseId);
        if (index !== -1) {
            data[index] = { ...data[index], name, qty, unit, price, category };
        }
        editingWarehouseId = null;
        const cancelBtn = document.getElementById('cancel-edit-wh-btn');
        if (cancelBtn) cancelBtn.classList.add('hidden');
        document.getElementById('add-wh-btn').innerText = "Добавить (Приход)";
    } else {
        // РЕЖИМ ДОБАВЛЕНИЯ
        const existingItem = data.find(i => i.name.toLowerCase() === name.toLowerCase() && i.unit === unit);
        if (existingItem) {
            existingItem.qty = (Number(existingItem.qty) || 0) + qty;
            if (price > 0) existingItem.price = price;
            existingItem.category = category;
        } else {
            data.push({
                id: Date.now(),
                name: name,
                category: category,
                qty: qty,
                unit: unit,
                price: price
        });
        openAccordions.warehouse.add(category);
    }
}

    localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(data));

    nameEl.value = '';
    qtyEl.value = '';
    priceEl.value = '';
    if (categoryEl) categoryEl.selectedIndex = 0;

    logStatus('Сохранено на склад');
    speak("Сохранено");
}

function parseWarehouseVoice(lower) {
    statusDiv.innerText = '🔍 Услышано: ' + lower;

    if (lower.includes('покажи все') || lower.includes('все материалы')) {
        setWarehouseFilter('all'); statusDiv.innerText = 'Показаны все материалы'; speak("Показаны все материалы"); return;
    }
    if (lower.includes('покажи заканчивающиеся') || lower.includes('что заканчивается') || lower.includes('мало осталось')) {
        setWarehouseFilter('low'); statusDiv.innerText = 'Показаны заканчивающиеся материалы'; speak("Показаны заканчивающиеся материалы"); return;
    }
    if (lower.includes('покажи отсутствующие') || lower.includes('нет в наличии') || lower.includes('что кончилось')) {
        setWarehouseFilter('out'); statusDiv.innerText = 'Показаны отсутствующие материалы'; speak("Показаны отсутствующие материалы"); return;
    }

    let text = lower.replace(/[^а-яё0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    let words = text.split(' ').filter(w => w.length > 0);

    function getNumber(str) {
        if (!str) return 0;
        let arr = str.split(' '); let result = 0; let current = 0;
        for (let w of arr) {
            let cleanW = w.replace(/[^а-яё0-9]/g, '');
            if (!cleanW) continue;
            if (cleanW.match(/^\d+$/)) { current += parseFloat(cleanW); }
            else if (NUMBERS_MAP[cleanW] !== undefined) {
                let val = NUMBERS_MAP[cleanW];
                if (val >= 1000) { if (current === 0) current = 1; result += current * val; current = 0; }
                else { current += val; }
            }
        }
        return result + current;
    }

    let isIncome = lower.includes('добавь') || lower.includes('приход') || lower.includes('купил') || lower.includes('закупи');
    let isExpense = lower.includes('расход') || lower.includes('спиши') || lower.includes('потратил') || lower.includes('израсходовал');

    if (!isIncome && !isExpense) {
        statusDiv.innerText = "⚠️ Не понял команду. Скажите 'Добавь 5 мешков цемента' или 'Расход 2 кг гвоздей'."; return;
    }

    let nameWords = []; let qty = 0; let unit = 'шт.';
    let skipWords = ['добавь', 'приход', 'купил', 'закупи', 'расход', 'спиши', 'потратил', 'израсходовал', 'материал', 'на', 'со', 'склада', 'склад', 'и', 'в'];

    for (let i = 0; i < words.length; i++) {
        let w = words[i].replace(/[^а-яё0-9]/g, '');
        if (!w) continue;
        if (skipWords.includes(w)) continue;
        if (w.match(/^\d+$/) || NUMBERS_MAP[w] !== undefined) { qty += getNumber(w); continue; }
        if (w === 'мешок' || w === 'мешка' || w === 'мешков' || w === 'меш') { unit = 'меш.'; continue; }
        if (w === 'кг' || w === 'килограмм' || w === 'килограмма' || w === 'килограммов') { unit = 'кг'; continue; }
        if (w === 'метр' || w === 'метра' || w === 'метров') { unit = 'м.'; continue; }
        if (w === 'штука' || w === 'штуки' || w === 'штук') { unit = 'шт.'; continue; }
        if (w === 'литр' || w === 'литра' || w === 'литров') { unit = 'л.'; continue; }
        nameWords.push(words[i]);
    }

    let finalName = nameWords.join(" ").trim();
    if (finalName.length > 0) { finalName = finalName.charAt(0).toUpperCase() + finalName.slice(1); }
    else { statusDiv.innerText = "⚠️ Не понял название материала."; speak("Не понял название"); return; }
    if (qty <= 0) { statusDiv.innerText = "⚠️ Не понял количество. Скажите, например: 'Добавь 5 цемента'."; speak("Не понял количество"); return; }

    let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    let item = data.find(i => i.name.toLowerCase().includes(finalName.toLowerCase()));

    if (isIncome) {
        if (item) {
            item.qty = (Number(item.qty) || 0) + qty;
            logStatus(`Приход: ${item.name} +${qty} ${unit}. Теперь ${item.qty}`); speak(`Принято ${qty} ${unit} ${item.name}`);
        } else {
            data.push({ id: Date.now(), name: finalName, category: 'Без категории', qty: qty, unit: unit, price: 0 });
            logStatus(`Добавлен новый материал: ${finalName} - ${qty} ${unit}`); speak(`Добавлен новый материал ${finalName}`);
            openAccordions.warehouse.add('Без категории');
        }
    } else if (isExpense) {
        if (!item) { statusDiv.innerText = `⚠️ Материал "${finalName}" не найден.`; speak("Материал не найден"); return; }
        if (item.qty < qty) { statusDiv.innerText = `⚠️ На складе только ${item.qty} ${item.unit}. Нельзя списать ${qty}.`; speak(`На складе только ${item.qty}`); return; }
        item.qty = (Number(item.qty) || 0) - qty;
        logStatus(`Расход: ${item.name} -${qty} ${unit}. Остаток ${item.qty}`); speak(`Списано ${qty} ${unit} ${item.name}. Остаток ${item.qty}`);
    }
    localStorage.setItem(getStorageKey('warehouse'), JSON.stringify(data));
    renderWarehouse();
}

function createWarehousePdfHtml() {
    const dateStr = new Date().toLocaleDateString('ru-RU');
    let rowsHtml = '';
    let total = 0;

    let data = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];
    data.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));

    data.forEach((item, index) => {
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        const sum = qty * price;
        total += sum;

        rowsHtml += `<tr>
            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
            <td style="border: 1px solid #000; padding: 8px;">${item.name || ''}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: center;">${item.unit || ''}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${qty}</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right;">${price.toLocaleString('ru-RU')} ₽</td>
            <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: bold;">${sum.toLocaleString('ru-RU')} ₽</td>
        </tr>`;
    });

    const savedLogo = localStorage.getItem('my_logo');
    let logoHtml = savedLogo ? `<img src="${savedLogo}" style="max-height: 60px; max-width: 120px; object-fit: contain; margin-bottom: 5px;">` : '';

    let companyStr = settings.company ? `<b>${settings.company}</b><br>` : '';
    let phoneStr = settings.phone ? `<br>Тел: ${settings.phone}` : '';

    return `<div style="font-family: 'Times New Roman', Times, serif; color: #000; background: #fff; padding: 30px; width: 800px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
            <div>
                <h1 style="margin: 0; font-size: 24px; text-transform: uppercase;">Отчет по складу</h1>
                <p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">Дата: ${dateStr}<br>Объект: ${currentObject}</p>
            </div>
            <div style="text-align: right;">
                ${logoHtml}
                <p style="margin: 0; font-size: 14px;">${companyStr}Исполнитель${phoneStr}</p>
            </div>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
            <thead>
                <tr style="background: #eee;">
                    <th style="border: 1px solid #000; padding: 8px;">№</th>
                    <th style="border: 1px solid #000; padding: 8px; text-align: left;">Наименование материала</th>
                    <th style="border: 1px solid #000; padding: 8px;">Ед. изм.</th>
                    <th style="border: 1px solid #000; padding: 8px;">Кол-во</th>
                    <th style="border: 1px solid #000; padding: 8px;">Цена</th>
                    <th style="border: 1px solid #000; padding: 8px;">Сумма</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        <div style="text-align: right; margin-bottom: 30px;">
            <h2 style="margin: 0; font-size: 18px; border-bottom: 2px solid #000; display: inline-block; padding-bottom: 5px;">ИТОГО: ${total.toLocaleString('ru-RU')} ₽</h2>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 30px; font-size: 14px;">
            <div style="width: 45%;">
                <p style="margin: 0 0 20px 0;"><b>Сдал (Кладовщик):</b></p>
                <div style="border-bottom: 1px solid #000; width: 100%; margin-bottom: 5px;"></div>
                <p style="margin: 0; font-size: 12px; text-align: center; color: #555;">(подпись)</p>
            </div>
            <div style="width: 45%;">
                <p style="margin: 0 0 20px 0;"><b>Принял (Прораб):</b></p>
                <div style="border-bottom: 1px solid #000; width: 100%; margin-bottom: 5px;"></div>
                <p style="margin: 0; font-size: 12px; text-align: center; color: #555;">(подпись)</p>
            </div>
        </div>
    </div>`;
}

async function exportWarehousePDF() {
    if (!window.jspdf || !window.html2canvas) {
        alert("Библиотеки для PDF не загружены.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;

    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.innerHTML = createWarehousePdfHtml();
    document.body.appendChild(tempDiv);

    try {
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

        const pdfBase64 = doc.output('datauristring');
        if (window.AndroidApp && window.AndroidApp.savePdf) {
            window.AndroidApp.savePdf(pdfBase64);
            logStatus('PDF сохранен!');
        } else {
            doc.save(`Склад_${new Date().getTime()}.pdf`);
        }
    } catch (error) {
        console.error(error);
        alert("Ошибка при создании PDF: " + error.message);
    }
}

// ==========================================
// СМЕТА, ФИНАНСЫ, ДНЕВНИК, НАПОМИНАНИЯ
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

let currentEstimate = JSON.parse(localStorage.getItem(getStorageKey('estimate'))) || [];
currentEstimate = currentEstimate.map((item, index) => { if (!item.date) item.date = new Date().toLocaleDateString('ru-RU'); if (!item.id) item.id = Date.now() + index; return item; });

function toggleAccordion(id, iconId) {
    const c = document.getElementById(id);
    const i = document.getElementById(iconId);
    if (!c) return;

    let screen = null;
    if (id.startsWith('smeta-')) screen = 'smeta';
    else if (id.startsWith('finance-')) screen = 'finance';
    else if (id.startsWith('diary-')) screen = 'diary';

    const isHidden = c.classList.contains('hidden');
    if (isHidden) {
        c.classList.remove('hidden');
        if (i) i.innerText = '▲';
        if (screen) openAccordions[screen].add(id);
    } else {
        c.classList.add('hidden');
        if (i) i.innerText = '▼';
        if (screen) openAccordions[screen].delete(id);
    }
}

function renderEstimate() {
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

    let tree = {}; let grandTotal = 0;
    currentEstimate.forEach(item => {
        let parts = item.date.split('.');
        let year = parts[2]; let month = parts[1];
        if (!tree[year]) tree[year] = {};
        if (!tree[year][month]) tree[year][month] = {};
        if (!tree[year][month][item.date]) tree[year][month][item.date] = [];
        tree[year][month][item.date].push(item);
        grandTotal += item.total;
    });

    const state = openAccordions.smeta;
    let sortedYears = Object.keys(tree).sort((a, b) => parseInt(b) - parseInt(a));
    let fullHtml = '';

    sortedYears.forEach(year => {
        let yearTotal = 0;
        Object.values(tree[year]).forEach(m => Object.values(m).forEach(d => d.forEach(i => yearTotal += i.total)));

        const yearContentId = `smeta-year-content-${year}`;
        const yearIconId = `smeta-year-icon-${year}`;
        const yearOpen = state.has(yearContentId);

        fullHtml += `<div class="year-group" style="margin-bottom: 15px;">
            <div class="year-header" onclick="toggleAccordion('${yearContentId}', '${yearIconId}')" style="background: linear-gradient(135deg, #1a2a33, #0d1a20); padding: 15px 18px; border-radius: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: bold; color: #00c2ff; border: 1px solid #00c2ff;">
                <span>📅 ${year} год</span>
                <span style="display: flex; gap: 12px; align-items: center;">
                    <span style="color: #00ff88; font-size: 15px;">${yearTotal.toLocaleString('ru-RU')} ₽</span>
                    <span id="${yearIconId}">${yearOpen ? '▲' : '▼'}</span>
                </span>
            </div>
            <div id="${yearContentId}" class="${yearOpen ? '' : 'hidden'}" style="margin-top: 10px; padding-left: 12px; border-left: 2px solid #00c2ff;">`;

        let sortedMonths = Object.keys(tree[year]).sort((a, b) => parseInt(b) - parseInt(a));
        sortedMonths.forEach(month => {
            let key = year + '-' + month; let monthTotal = 0;
            Object.values(tree[year][month]).forEach(d => d.forEach(i => monthTotal += i.total));

            const monthContentId = `smeta-month-content-${key}`;
            const monthIconId = `smeta-month-icon-${key}`;
            const monthOpen = state.has(monthContentId);

            fullHtml += `<div class="month-group" style="margin-bottom: 12px;">
                <div class="month-header" onclick="toggleAccordion('${monthContentId}', '${monthIconId}')" style="background: #222; padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; border: 1px solid #444;">
                    <span>📆 ${MONTH_NAMES[month]} ${year}</span>
                    <span style="display: flex; gap: 12px; align-items: center;">
                        <span style="color: #00ff88; font-size: 14px;">${monthTotal.toLocaleString('ru-RU')} ₽</span>
                        <span id="${monthIconId}">${monthOpen ? '▲' : '▼'}</span>
                    </span>
                </div>
                <div id="${monthContentId}" class="${monthOpen ? '' : 'hidden'}" style="margin-top: 8px; padding-left: 12px; border-left: 2px solid #444;">`;

            let sortedDays = Object.keys(tree[year][month]).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0]));
            sortedDays.forEach(date => {
                let items = tree[year][month][date];
                let dayTotal = 0;
                items.forEach(i => dayTotal += i.total);
                let safeId = date.replace(/\./g, '_');

                const dayContentId = `smeta-day-content-${safeId}`;
                const dayIconId = `smeta-day-icon-${safeId}`;
                const dayOpen = state.has(dayContentId);

                fullHtml += `<div class="day-group" style="margin-bottom: 8px;">
                    <div class="day-header" onclick="toggleAccordion('${dayContentId}', '${dayIconId}')" style="background: #1f1f1f; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #ccc; border-radius: 6px; border: 1px solid #333;">
                        <span>📅 ${date}</span>
                        <span style="display: flex; gap: 12px; align-items: center;">
                            <span style="color: #00ff88; font-size: 13px;">${dayTotal.toLocaleString('ru-RU')} ₽</span>
                            <span id="${dayIconId}">${dayOpen ? '▲' : '▼'}</span>
                        </span>
                    </div>
                    <div id="${dayContentId}" class="${dayOpen ? '' : 'hidden'}" style="background: #111; padding: 0 12px; border-radius: 0 0 6px 6px;">`;

                [...items].sort((a, b) => b.id - a.id).forEach(item => {
                    fullHtml += `<div class="estimate-item"><div class="item-info"><div class="item-name">${item.name}</div><div class="item-details">${item.qty} ${item.unit} × ${item.price} ₽</div></div><div style="display:flex; align-items:center;"><div class="item-total">${item.total.toLocaleString('ru-RU')} ₽</div><button class="delete-item-btn" onclick="deleteEstimateItem(${item.id})">✕</button></div></div>`;
                });
                fullHtml += `</div></div>`;
            });
            fullHtml += `</div></div>`;
        });
        fullHtml += `</div></div>`;
    });

    listDiv.innerHTML = fullHtml;
    totalRow.style.display = 'flex';
    totalSumSpan.innerText = grandTotal.toLocaleString('ru-RU') + ' ₽';
    exportButtons.style.display = 'flex';

    logStatus(`Смета обновлена. Открыто блоков: ${openAccordions.smeta.size}`);
}

function addToEstimate() {
    const name = document.getElementById('work-name').value;
    const qty = parseFloat(document.getElementById('work-qty').value);
    const unit = document.getElementById('work-unit').value;
    const price = parseFloat(document.getElementById('work-price').value);
    if (!name || isNaN(qty) || isNaN(price)) { alert("Ошибка: заполните все поля!"); return; }
    let savedPrices = JSON.parse(localStorage.getItem(getStorageKey('prices'))) || {}; savedPrices[name.trim().toLowerCase()] = price; localStorage.setItem(getStorageKey('prices'), JSON.stringify(savedPrices));
    currentEstimate.push({ id: Date.now(), name, qty, unit, price, total: qty * price, date: new Date().toLocaleDateString('ru-RU') });
    localStorage.setItem(getStorageKey('estimate'), JSON.stringify(currentEstimate));
    document.getElementById('work-name').value = ''; document.getElementById('work-qty').value = ''; document.getElementById('work-price').value = '';
    renderEstimate();
}

window.deleteEstimateItem = (id) => {
    currentEstimate = currentEstimate.filter(i => i.id !== id);
    localStorage.setItem(getStorageKey('estimate'), JSON.stringify(currentEstimate));
    renderEstimate();
};
document.getElementById('add-btn').addEventListener('click', addToEstimate);

let financeData = JSON.parse(localStorage.getItem(getStorageKey('finance'))) || [];

window.addFinanceManual = function() {
    const type = document.getElementById('fin-type').value;
    const category = document.getElementById('fin-category').value.trim();
    const amountRaw = document.getElementById('fin-amount').value;
    const amount = parseFloat(String(amountRaw).replace(',', '.'));

    if (!category || isNaN(amount) || amount <= 0) {
        alert("Заполните название и сумму!");
        return;
    }

    financeData.push({
        id: Date.now(),
        type: type,
        category: category.charAt(0).toUpperCase() + category.slice(1),
        amount: amount,
        date: new Date().toLocaleDateString('ru-RU')
    });

    localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData));

    document.getElementById('fin-category').value = '';
    document.getElementById('fin-amount').value = '';

    renderFinance();

    statusDiv.innerText = "✅ Запись добавлена вручную!";
    statusDiv.style.color = "#00ff88";
    setTimeout(()=>{statusDiv.innerText='';}, 2000);
};

function renderFinance() {
    const listDiv = document.getElementById('finance-list');
    if (!listDiv) return;

    let tree = {}; let grandTotal = 0;
    financeData.forEach(item => {
        let parts = item.date.split('.');
        let year = parts[2]; let month = parts[1];
        if (!tree[year]) tree[year] = {};
        if (!tree[year][month]) tree[year][month] = {};
        if (!tree[year][month][item.date]) tree[year][month][item.date] = [];
        tree[year][month][item.date].push(item);
        grandTotal += item.amount;
    });

    const state = openAccordions.finance;
    let sortedYears = Object.keys(tree).sort((a, b) => parseInt(b) - parseInt(a));
    let fullHtml = '';

    sortedYears.forEach(year => {
        let yearTotal = 0;
        Object.values(tree[year]).forEach(m => Object.values(m).forEach(d => d.forEach(i => yearTotal += i.amount)));

        const yearContentId = `finance-year-content-${year}`;
        const yearIconId = `finance-year-icon-${year}`;
        const yearOpen = state.has(yearContentId);

        fullHtml += `<div class="year-group" style="margin-bottom: 15px;">
            <div class="year-header" onclick="toggleAccordion('${yearContentId}', '${yearIconId}')" style="background: linear-gradient(135deg, #1a2a33, #0d1a20); padding: 15px 18px; border-radius: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: bold; color: #00c2ff; border: 1px solid #00c2ff;">
                <span>📅 ${year} год</span>
                <span style="display: flex; gap: 12px; align-items: center;">
                    <span style="color: #00ff88; font-size: 15px;">${yearTotal.toLocaleString('ru-RU')} ₽</span>
                    <span id="${yearIconId}">${yearOpen ? '▲' : '▼'}</span>
                </span>
            </div>
            <div id="${yearContentId}" class="${yearOpen ? '' : 'hidden'}" style="margin-top: 10px; padding-left: 12px; border-left: 2px solid #00c2ff;">`;

        Object.keys(tree[year]).sort((a, b) => parseInt(b) - parseInt(a)).forEach(month => {
            let key = year + '-' + month; let monthTotal = 0;
            Object.values(tree[year][month]).forEach(d => d.forEach(i => monthTotal += i.amount));

            const monthContentId = `finance-month-content-${key}`;
            const monthIconId = `finance-month-icon-${key}`;
            const monthOpen = state.has(monthContentId);

            fullHtml += `<div class="month-group" style="margin-bottom: 12px;">
                <div class="month-header" onclick="toggleAccordion('${monthContentId}', '${monthIconId}')" style="background: #222; padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; border: 1px solid #444;">
                    <span>📆 ${MONTH_NAMES[month]} ${year}</span>
                    <span style="display: flex; gap: 12px; align-items: center;">
                        <span style="color: #00ff88; font-size: 14px;">${monthTotal.toLocaleString('ru-RU')} ₽</span>
                        <span id="${monthIconId}">${monthOpen ? '▲' : '▼'}</span>
                    </span>
                </div>
                <div id="${monthContentId}" class="${monthOpen ? '' : 'hidden'}" style="margin-top: 8px; padding-left: 12px; border-left: 2px solid #444;">`;

            Object.keys(tree[year][month]).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0])).forEach(date => {
                let items = tree[year][month][date]; let dayTotal = 0;
                items.forEach(i => dayTotal += i.amount);
                let safeId = date.replace(/\./g, '_');

                const dayContentId = `finance-day-content-${safeId}`;
                const dayIconId = `finance-day-icon-${safeId}`;
                const dayOpen = state.has(dayContentId);

                fullHtml += `<div class="day-group" style="margin-bottom: 8px;">
                    <div class="day-header" onclick="toggleAccordion('${dayContentId}', '${dayIconId}')" style="background: #1f1f1f; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #ccc; border-radius: 6px; border: 1px solid #333;">
                        <span>📅 ${date}</span>
                        <span style="display: flex; gap: 12px; align-items: center;">
                            <span style="color: #00ff88; font-size: 13px;">${dayTotal.toLocaleString('ru-RU')} ₽</span>
                            <span id="${dayIconId}">${dayOpen ? '▲' : '▼'}</span>
                        </span>
                    </div>
                    <div id="${dayContentId}" class="${dayOpen ? '' : 'hidden'}" style="background: #111; padding: 0 12px; border-radius: 0 0 6px 6px;">`;

                [...items].sort((a, b) => b.id - a.id).forEach(item => {
                    const sign  = item.type === 'expense' ? '−' : '+';
                    const color = item.type === 'expense' ? '#ff4444' : '#00ff88';
                    const label = item.type === 'expense' ? 'Расход' : 'Приход';
                    fullHtml += `<div class="finance-item">
                        <div class="item-info">
                            <div class="item-name">${item.category}</div>
                            <div class="item-details">${label}</div>
                        </div>
                        <div style="display:flex; align-items:center;">
                            <div class="item-total" style="color:${color};">${sign}${item.amount.toLocaleString('ru-RU')} ₽</div>
                            <button class="delete-item-btn" onclick="deleteFinance(${item.id})">✕</button>
                        </div>
                    </div>`;
                });
                fullHtml += `</div></div>`;
            });
            fullHtml += `</div></div>`;
        });
        fullHtml += `</div></div>`;
    });

    listDiv.innerHTML = fullHtml;

    const balanceEl = document.getElementById('finance-balance-sum');
    if (balanceEl) {
        let incomeTotal = 0;
        let expenseTotal = 0;
        financeData.forEach(item => {
            if (item.type === 'income') incomeTotal += item.amount;
            if (item.type === 'expense') expenseTotal += item.amount;
        });
        let balance = incomeTotal - expenseTotal;
        balanceEl.innerText = balance.toLocaleString('ru-RU') + ' ' + (settings.currency || '₽');
        balanceEl.style.color = balance >= 0 ? '#00ff88' : '#ff4444';
    }

    logStatus(`Финансы обновлены. Открыто блоков: ${openAccordions.finance.size}`);
}
window.deleteFinance = (id) => {
    financeData = financeData.filter(i => i.id !== id);
    localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData));
    renderFinance();
};
window.clearAllFinance = () => { if (confirm("Удалить ВСЕ финансовые записи?")) { financeData = []; localStorage.setItem(getStorageKey('finance'), JSON.stringify(financeData)); renderFinance(); } };

let diaryData = JSON.parse(localStorage.getItem(getStorageKey('diary'))) || [];
function renderDiary() {
    const listDiv = document.getElementById('diary-list');
    if (!listDiv) return;

    let tree = {};
    diaryData.forEach(item => {
        let parts = item.date.split('.');
        let year = parts[2]; let month = parts[1];
        if (!tree[year]) tree[year] = {};
        if (!tree[year][month]) tree[year][month] = {};
        if (!tree[year][month][item.date]) tree[year][month][item.date] = [];
        tree[year][month][item.date].push(item);
    });

    const state = openAccordions.diary;
    let sortedYears = Object.keys(tree).sort((a, b) => parseInt(b) - parseInt(a));
    let fullHtml = '';

    sortedYears.forEach(year => {
        const yearContentId = `diary-year-content-${year}`;
        const yearIconId = `diary-year-icon-${year}`;
        const yearOpen = state.has(yearContentId);

        fullHtml += `<div class="year-group" style="margin-bottom: 15px;">
            <div class="year-header" onclick="toggleAccordion('${yearContentId}', '${yearIconId}')" style="background: linear-gradient(135deg, #1a2a33, #0d1a20); padding: 15px 18px; border-radius: 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: bold; color: #00c2ff; border: 1px solid #00c2ff;">
                <span>📅 ${year} год</span>
                <span id="${yearIconId}">${yearOpen ? '▲' : '▼'}</span>
            </div>
            <div id="${yearContentId}" class="${yearOpen ? '' : 'hidden'}" style="margin-top: 10px; padding-left: 12px; border-left: 2px solid #00c2ff;">`;

        Object.keys(tree[year]).sort((a, b) => parseInt(b) - parseInt(a)).forEach(month => {
            let key = year + '-' + month;
            const monthContentId = `diary-month-content-${key}`;
            const monthIconId = `diary-month-icon-${key}`;
            const monthOpen = state.has(monthContentId);

            fullHtml += `<div class="month-group" style="margin-bottom: 12px;">
                <div class="month-header" onclick="toggleAccordion('${monthContentId}', '${monthIconId}')" style="background: #222; padding: 12px 16px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #fff; border: 1px solid #444;">
                    <span>📆 ${MONTH_NAMES[month]} ${year}</span>
                    <span id="${monthIconId}">${monthOpen ? '▲' : '▼'}</span>
                </div>
                <div id="${monthContentId}" class="${monthOpen ? '' : 'hidden'}" style="margin-top: 8px; padding-left: 12px; border-left: 2px solid #444;">`;

            Object.keys(tree[year][month]).sort((a, b) => parseInt(b.split('.')[0]) - parseInt(a.split('.')[0])).forEach(date => {
                let items = tree[year][month][date];
                let safeId = date.replace(/\./g, '_');
                const dayContentId = `diary-day-content-${safeId}`;
                const dayIconId = `diary-day-icon-${safeId}`;
                const dayOpen = state.has(dayContentId);

                fullHtml += `<div class="day-group" style="margin-bottom: 8px;">
                    <div class="day-header" onclick="toggleAccordion('${dayContentId}', '${dayIconId}')" style="background: #1f1f1f; padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #ccc; border-radius: 6px; border: 1px solid #333;">
                        <span>📅 ${date}</span>
                        <span id="${dayIconId}">${dayOpen ? '▲' : '▼'}</span>
                    </div>
                    <div id="${dayContentId}" class="${dayOpen ? '' : 'hidden'}" style="background: #111; padding: 0 12px; border-radius: 0 0 6px 6px;">`;

                [...items].sort((a, b) => b.id - a.id).forEach(item => {
                    fullHtml += `<div class="diary-item"><div class="item-info"><div class="item-name">${item.text || item.name || ''}</div></div><button class="delete-item-btn" onclick="deleteDiary(${item.id})">✕</button></div>`;
                });
                fullHtml += `</div></div>`;
            });
            fullHtml += `</div></div>`;
        });
        fullHtml += `</div></div>`;
    });

    listDiv.innerHTML = fullHtml;
    logStatus(`Дневник обновлён. Открыто блоков: ${openAccordions.diary.size}`);
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
    renderDiary();
});
window.deleteDiary = (id) => {
    diaryData = diaryData.filter(i => i.id !== id);
    localStorage.setItem(getStorageKey('diary'), JSON.stringify(diaryData));
    renderDiary();
};
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
    let active = remindersData.filter(r => r.time > Date.now()).sort((a,b) => a.time - b.time);
    let past = remindersData.filter(r => r.time <= Date.now()).sort((a,b) => b.time - a.time);
    if (active.length === 0 && past.length === 0) { listDiv.innerHTML = '<p style="color: #666; font-size: 14px; text-align: center;">Нет напоминаний</p>'; return; }
    let html = '';
    if (active.length > 0) {
        html += '<h4 style="color: #00c2ff; margin-bottom: 10px;">Активные:</h4>';
        active.forEach(r => {
            html += `<div class="reminder-item"><div class="reminder-info"><div class="reminder-text">${r.text}</div><div class="reminder-time">⏰ ${r.dateStr}</div></div><button class="delete-item-btn" onclick="deleteReminder(${r.id})">✕</button></div>`;
        });
    }
    if (past.length > 0) {
        html += '<h4 style="color: #666; margin-top: 20px; margin-bottom: 10px;">Прошедшие:</h4>';
        past.forEach(r => {
            html += `<div class="reminder-item" style="opacity: 0.5;"><div class="reminder-info"><div class="reminder-text">${r.text}</div><div class="reminder-time">⏰ ${r.dateStr}</div></div><button class="delete-item-btn" onclick="deleteReminder(${r.id})">✕</button></div>`;
        });
    }
    listDiv.innerHTML = html;
}
window.deleteReminder = (id) => { remindersData = remindersData.filter(r => r.id !== id); localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData)); renderReminders(); };
window.clearAllReminders = () => { if (confirm("Удалить все напоминания?")) { remindersData = []; localStorage.setItem(getStorageKey('reminders'), JSON.stringify(remindersData)); renderReminders(); } };

let warehouseData = JSON.parse(localStorage.getItem(getStorageKey('warehouse'))) || [];

// Экспорт PDF
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

clearAccordionState('smeta');
clearAccordionState('finance');
clearAccordionState('diary');
renderEstimate();
renderFinance();
renderDiary();
renderReminders();
renderWarehouse();