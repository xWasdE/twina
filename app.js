import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, setDoc, updateDoc, doc, onSnapshot, query, where, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDzTVIzmntO7ohuHxYYexXRi-vtPk_WCeY",
    authDomain: "twin-a-28bc0.firebaseapp.com",
    projectId: "twin-a-28bc0",
    storageBucket: "twin-a-28bc0.firebasestorage.app",
    messagingSenderId: "156821876298",
    appId: "1:156821876298:web:3b58554508c40a881bc0b3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUser = null;
let currentTableId = null;
let currentOrderDocId = null;
let currentCategory = '';
let companyInfo = { name: "TWIN-A", phone: "", address: "", open: "", close: "", broadcast: "", maintenance: false, menuVersion: "1" };
let editingProductId = null;
let editingProductStock = true;
let isMaintenanceEnforced = false;
let globalUnsubscribes = [];
let timeUpdaterInterval = null;
let liveOrderUnsubscribe = null;

let globalOrders = [];
let globalExpenses = [];
let chartInstances = {};
let globalCategoriesList = [];
let globalProductsList = []; 

const getOrderVal = (val) => (val === "" || val === null || val === undefined) ? 999 : Number(val);

const urlParams = new URLSearchParams(window.location.search);
const isQRMode = urlParams.get('qr') === '1';
const expectedHash = window.location.hash || '';

const maintBtn = document.getElementById('maintenance-admin-login-btn');
if (maintBtn) maintBtn.textContent = "ANA SAYFAYA DÖN";

window.toggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if(document.getElementById('dashboard-view') && document.getElementById('dashboard-view').style.display === 'block') {
        if(typeof initDashboard === 'function') initDashboard(); 
    }
};

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    document.getElementById('theme-toggle-login')?.addEventListener('click', window.toggleTheme);
    document.getElementById('theme-toggle-app')?.addEventListener('click', window.toggleTheme);
    document.getElementById('qr-theme-toggle')?.addEventListener('click', window.toggleTheme);
}
initTheme();

setInterval(() => {
    const clock = document.getElementById('system-clock');
    if(clock) clock.innerText = new Date().toLocaleTimeString('tr-TR');
}, 1000);

function showModal(title, desc, inputsHtml, onConfirm, isAlert = false, hideActions = false) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-desc').innerHTML = desc;
    document.getElementById('modal-inputs').innerHTML = inputsHtml || '';
    
    const actionsDiv = document.getElementById('modal-actions-container');
    if(hideActions) {
        actionsDiv.style.display = 'none';
    } else {
        actionsDiv.style.display = 'flex';
    }

    let confirmBtn = document.getElementById('modal-confirm');
    let cancelBtn = document.getElementById('modal-cancel');
    
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    
    confirmBtn.replaceWith(newConfirmBtn);
    cancelBtn.replaceWith(newCancelBtn);
    
    confirmBtn = newConfirmBtn;
    cancelBtn = newCancelBtn;

    if(isAlert) {
        cancelBtn.style.display = 'none';
        confirmBtn.textContent = 'TAMAM';
    } else {
        cancelBtn.style.display = 'block';
        confirmBtn.textContent = 'ONAYLA';
    }
    
    modal.classList.add('active');

    const cleanup = () => {
        modal.classList.remove('active');
    };

    cancelBtn.addEventListener('click', cleanup);
    confirmBtn.addEventListener('click', () => {
        const inputData = {};
        document.querySelectorAll('#modal-inputs input:not([type="checkbox"]), #modal-inputs select').forEach(el => { 
            inputData[el.id] = el.value; 
        });
        if(onConfirm) onConfirm(inputData);
        cleanup();
    });
}

window.closeModal = () => {
    document.getElementById('custom-modal').classList.remove('active');
};

function createLog(action, detail) {
    return { time: new Date().toISOString(), user: currentUser ? currentUser.name : 'Sistem', action: action, detail: detail };
}

function hideAllScreens() {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
}

function clearAllListeners() {
    globalUnsubscribes.forEach(unsub => unsub());
    globalUnsubscribes = [];
    if(timeUpdaterInterval) clearInterval(timeUpdaterInterval);
}

function formatDuration(isoString) {
    if(!isoString) return "";
    const diff = Math.floor((new Date() - new Date(isoString)) / 60000); 
    if(diff < 1) return "Az önce";
    if(diff < 60) return `${diff} dk`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins > 0 ? `${hours} sa ${mins} dk` : `${hours} sa`;
}

function getCompanyPrintHeader() {
    return `
        <h2 style="text-align: center; border-bottom: 1px dashed black; padding-bottom: 5px; font-family:serif; font-size:18px; margin:0;">${companyInfo.name || 'TWIN-A'}</h2>
        ${companyInfo.address ? `<p style="text-align: center; margin: 5px 0 0 0; font-size:11px;">${companyInfo.address}</p>` : ''}
        ${companyInfo.phone ? `<p style="text-align: center; margin: 3px 0 0 0; font-size:11px;">Tel: ${companyInfo.phone}</p>` : ''}
        <div class="print-div"></div>
    `;
}

function toYYYYMMDD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function bootSystem() {
    if (expectedHash !== '' && expectedHash !== '#') {
        hideAllScreens();
        const fScreen = document.getElementById('404-screen');
        fScreen.style.display = 'flex';
        fScreen.classList.add('active');
        return;
    }

    onSnapshot(doc(db, "settings", "global"), (snap) => {
        if (snap.exists()) {
            companyInfo = snap.data();
            applyGlobalSettings();
        } else {
            setDoc(doc(db, "settings", "global"), companyInfo);
        }
    });

    if (isQRMode) {
        hideAllScreens();
        const qrScreen = document.getElementById('qr-menu-app');
        qrScreen.style.display = 'flex';
        qrScreen.classList.add('active');
        loadQRCategoriesAndProducts();
        return;
    }

    const savedUserId = localStorage.getItem('twinA_uid');
    if (savedUserId) {
        try {
            const docSnap = await getDoc(doc(db, "users", savedUserId));
            if(docSnap.exists()) {
                const data = docSnap.data();
                if(data.status !== 'passive') {
                    currentUser = { ...data, docId: docSnap.id };
                    startApp();
                    return;
                }
            }
        } catch(e) { console.error(e); }
    }
    
    hideAllScreens();
    const loginScreen = document.getElementById('login-screen');
    loginScreen.style.display = 'flex';
    loginScreen.classList.add('active');
}

function applyGlobalSettings() {
    document.getElementById('header-company-name').textContent = companyInfo.name || 'TWIN-A';
    document.getElementById('company-name').value = companyInfo.name || '';
    document.getElementById('company-phone').value = companyInfo.phone || '';
    document.getElementById('company-address').value = companyInfo.address || '';
    document.getElementById('company-open').value = companyInfo.open || '';
    document.getElementById('company-close').value = companyInfo.close || '';
    
    const qrTitle = document.getElementById('qr-company-name');
    if(qrTitle) qrTitle.textContent = companyInfo.name || 'TWIN-A';
    
    const banner = document.getElementById('broadcast-banner');
    if(companyInfo.broadcast && companyInfo.broadcast.trim() !== "") {
        banner.innerHTML = `📢 <b>ÖZEL DUYURU:</b> ${companyInfo.broadcast}`;
        banner.style.display = 'block';
        banner.style.visibility = 'visible';
        banner.style.pointerEvents = 'auto';
        document.body.classList.add('has-broadcast');
    } else {
        banner.innerHTML = '';
        banner.style.display = 'none';
        banner.style.visibility = 'hidden';
        banner.style.pointerEvents = 'none';
        document.body.classList.remove('has-broadcast');
    }

    const mntBtn = document.getElementById('toggle-maintenance-btn');
    if(mntBtn) {
        mntBtn.textContent = companyInfo.maintenance ? "BAKIM MODUNU KAPAT (SİSTEMİ AÇ)" : "SİSTEMİ BAKIMA AL";
        mntBtn.className = companyInfo.maintenance ? "btn-green" : "btn-red";
    }

    if (companyInfo.maintenance) {
        if (isQRMode || (currentUser && currentUser.role !== 'admin')) {
            isMaintenanceEnforced = true;
            hideAllScreens();
            const mScreen = document.getElementById('maintenance-screen');
            mScreen.style.display = 'flex';
            mScreen.classList.add('active');
        }
    } else {
        if(isMaintenanceEnforced) {
            window.location.reload(); 
        }
    }

    const localVersion = localStorage.getItem('twinA_menu_version');
    const remoteVersion = companyInfo.menuVersion || '1';
    if(localVersion !== remoteVersion) {
        if(isQRMode) {
            loadQRCategoriesAndProducts();
        } else if (currentUser) {
            fetchMenuData(); 
        }
    }
}

if(document.getElementById('maintenance-admin-login-btn')) {
    document.getElementById('maintenance-admin-login-btn').addEventListener('click', () => {
        isMaintenanceEnforced = false;
        hideAllScreens();
        const loginScreen = document.getElementById('login-screen');
        loginScreen.style.display = 'flex';
        loginScreen.classList.add('active');
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSystem);
} else {
    bootSystem();
}

window.addEventListener('hashchange', () => {
    if(window.location.hash && window.location.hash !== '#') {
        hideAllScreens();
        const fScreen = document.getElementById('404-screen');
        fScreen.style.display = 'flex';
        fScreen.classList.add('active');
    } else {
        bootSystem();
    }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('user-id').value.trim();
    const pass = document.getElementById('user-pass').value.trim();
    const errorBox = document.getElementById('login-error');
    errorBox.style.display = 'none';
    
    try {
        const q1 = query(collection(db, "users"), where("id", "==", id), where("password", "==", pass));
        const q2 = query(collection(db, "users"), where("name", "==", id), where("password", "==", pass));
        
        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const userDoc = !snap1.empty ? snap1.docs[0] : (!snap2.empty ? snap2.docs[0] : null);

        if (userDoc) {
            const data = userDoc.data();
            if(data.status === 'passive') {
                errorBox.textContent = 'HESABINIZ PASİFE ALINMIŞTIR!';
                errorBox.style.display = 'block';
                return;
            }
            if(companyInfo.maintenance && data.role !== 'admin') {
                errorBox.textContent = 'SİSTEM BAKIMDA! SADECE YÖNETİCİLER GİRİŞ YAPABİLİR.';
                errorBox.style.display = 'block';
                return;
            }
            currentUser = { ...data, docId: userDoc.id };
            localStorage.setItem('twinA_uid', userDoc.id);
            startApp();
        } else {
            errorBox.textContent = 'HATALI İSİM/ID VEYA ŞİFRE!';
            errorBox.style.display = 'block';
        }
    } catch (error) {
        errorBox.textContent = 'BAĞLANTI HATASI!';
        errorBox.style.display = 'block';
    }
});

function startApp() {
    hideAllScreens();
    const mainApp = document.getElementById('main-app');
    mainApp.style.display = 'flex';
    mainApp.classList.add('active');
    document.getElementById('active-user-name').textContent = currentUser.name.toUpperCase();

    if (currentUser.role === 'admin') {
        document.getElementById('admin-nav').style.display = 'flex';
        document.getElementById('staff-nav').style.display = 'none';
    } else {
        document.getElementById('admin-nav').style.display = 'none';
        document.getElementById('staff-nav').style.display = 'flex';
    }

    getDocs(collection(db, "tables")).then(snap => {
        if (snap.empty) {
            for (let i = 1; i <= 28; i++) {
                setDoc(doc(db, "tables", `MASA ${i}`), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '' });
            }
        }
    }).catch(e => console.error(e));

    switchView('tables');
    listenTables();
    loadMenuSmart();
    
    if(currentUser.role === 'admin') { 
        listenStaff(); 
        
        const dateInput = document.getElementById('history-date-filter');
        if(dateInput) {
            dateInput.value = toYYYYMMDD(new Date()); 
            loadFinanceForDate(dateInput.value); 
        }
        
        const sDate = document.getElementById('dash-start-date');
        const eDate = document.getElementById('dash-end-date');
        if(sDate && !sDate.value) sDate.value = toYYYYMMDD(new Date());
        if(eDate && !eDate.value) eDate.value = toYYYYMMDD(new Date());
    }
}

document.getElementById('logout-btn').addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem('twinA_uid');
    clearAllListeners();
    hideAllScreens();
    const loginScreen = document.getElementById('login-screen');
    loginScreen.style.display = 'flex';
    loginScreen.classList.add('active');
    document.getElementById('login-form').reset();
});

document.getElementById('show-qr-btn').addEventListener('click', () => {
    const qrUrl = window.location.origin + window.location.pathname + '?qr=1';
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrUrl)}&color=2C2A26&bgcolor=FFFFFF`;
    
    showModal('QR MENÜ BAĞLANTISI', '', `
        <div id="qr-display-box">
            <img src="${qrImgUrl}" alt="QR Kod">
            <p style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:10px; letter-spacing:1px;">MİSAFİRLER İÇİN DİJİTAL MENÜ ADRESİ:</p>
            <a href="${qrUrl}" target="_blank" style="font-size:11px;">${qrUrl}</a>
        </div>
    `, () => {}, true);
});

function switchView(viewName) {
    const viewElements = {
        tables: document.getElementById('tables-view'),
        order: document.getElementById('order-view'),
        menu: document.getElementById('menu-view'),
        staff: document.getElementById('staff-view'),
        finance: document.getElementById('finance-view'),
        dashboard: document.getElementById('dashboard-view'),
        settings: document.getElementById('settings-view'),
        'staff-settings': document.getElementById('staff-settings-view')
    };

    Object.values(viewElements).forEach(v => { if(v) v.style.display = 'none'; });
    if(viewElements[viewName]) viewElements[viewName].style.display = 'block';

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.dataset.target === `${viewName}-view`) btn.classList.add('active');
    });

    if(viewName === 'dashboard' && currentUser && currentUser.role === 'admin') {
        initDashboard();
    }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.target;
        if(target) switchView(target.replace('-view', ''));
    });
});

let tableDataStore = {};
function listenTables() {
    const unsub = onSnapshot(collection(db, "tables"), (snapshot) => {
        const container = document.getElementById('tables-container');
        if(!container) return;
        
        tableDataStore = {};
        const sortedDocs = [...snapshot.docs].sort((a, b) => parseInt(a.id.replace(/\D/g, '')) - parseInt(b.id.replace(/\D/g, '')));

        container.innerHTML = '';
        sortedDocs.forEach(docSnap => {
            const data = docSnap.data();
            tableDataStore[docSnap.id] = data;
            const div = document.createElement('div');
            
            if(data.status === 'empty') div.className = 'table-card table-empty';
            else if(data.status === 'active') div.className = 'table-card table-full';
            else if(data.status === 'reserved') {
                div.className = 'table-card table-reserved';
                if(data.reservedColor) {
                    div.style.borderColor = data.reservedColor;
                    div.style.color = data.reservedColor;
                }
            }

            let html = `<span>${docSnap.id}</span>`;
            if(data.status === 'reserved' && data.reservedName) {
                html += `<div class="res-name" style="background:${data.reservedColor || 'var(--text)'}; color:var(--bg);">${data.reservedName}</div>`;
                html += `<div class="table-time" data-time="${data.timestamp}"></div>`;
            }
            if(data.status === 'active') {
                const rem = (data.totalAmount || 0) - (data.paidAmount || 0);
                html += `<span class="table-total">${rem} ₺</span>`;
                html += `<div class="table-time" data-time="${data.timestamp}"></div>`;
            }
            
            div.innerHTML = html;
            div.addEventListener('click', () => handleTableClick(docSnap.id, data));
            container.appendChild(div);
        });
        updateTableTimes();
        
        const tCountInput = document.getElementById('table-count-input');
        if(tCountInput && !tCountInput.dataset.modified) {
            tCountInput.value = sortedDocs.length;
        }
    });
    globalUnsubscribes.push(unsub);
    
    timeUpdaterInterval = setInterval(updateTableTimes, 30000); 
}

document.getElementById('update-table-count-btn')?.addEventListener('click', async () => {
    const targetCount = parseInt(document.getElementById('table-count-input').value);
    if(!targetCount || targetCount < 1) return;
    
    const snap = await getDocs(collection(db, "tables"));
    let existingTables = [];
    snap.forEach(d => {
        const num = parseInt(d.id.replace(/\D/g, ''));
        if(!isNaN(num)) existingTables.push({id: d.id, num: num, data: d.data()});
    });
    existingTables.sort((a,b) => a.num - b.num);
    
    const currentCount = existingTables.length > 0 ? existingTables[existingTables.length - 1].num : 0;
    
    if (targetCount > currentCount) {
        for(let i = currentCount + 1; i <= targetCount; i++) {
            await setDoc(doc(db, "tables", `MASA ${i}`), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '', reservedColor: null, timestamp: null });
        }
        showModal('BAŞARILI', `Masa sayısı ${targetCount} olarak güncellendi.`, '', null, true);
    } else if (targetCount < currentCount) {
        let canDelete = true;
        for(let i = targetCount + 1; i <= currentCount; i++) {
            const t = existingTables.find(x => x.num === i);
            if(t && t.data.status !== 'empty') {
                canDelete = false;
                break;
            }
        }
        if(!canDelete) {
            showModal('HATA', 'Silinmek istenen masalar arasında dolu veya rezerve olanlar var. Lütfen önce o masaları kapatın.', '', null, true);
            return;
        }
        for(let i = targetCount + 1; i <= currentCount; i++) {
            await deleteDoc(doc(db, "tables", `MASA ${i}`));
        }
        showModal('BAŞARILI', `Masa sayısı ${targetCount} olarak düşürüldü.`, '', null, true);
    } else {
        showModal('BİLGİ', 'Masa sayısı zaten aynı.', '', null, true);
    }
});

function updateTableTimes() {
    document.querySelectorAll('.table-time').forEach(el => {
        const t = el.getAttribute('data-time');
        if(t && t !== 'undefined' && t !== 'null') {
            el.textContent = formatDuration(t);
        }
    });
}

document.getElementById('transfer-table-btn').addEventListener('click', async () => {
    if(!currentOrderDocId || !currentTableId) return;

    const snap = await getDocs(collection(db, "tables"));
    let existingTables = [];
    snap.forEach(d => {
        if(d.id !== currentTableId && (d.data().status === 'empty' || d.data().status === 'active')) {
            existingTables.push({ id: d.id, num: parseInt(d.id.replace(/\D/g, '')), status: d.data().status });
        }
    });
    existingTables.sort((a,b) => a.num - b.num);

    let optionsHtml = '<select id="target-table-select">';
    existingTables.forEach(t => {
        let statusText = t.status === 'active' ? '(Dolu - Birleştir)' : '(Müsait - Taşı)';
        optionsHtml += `<option value="${t.id}">${t.id} ${statusText}</option>`;
    });
    optionsHtml += '</select>';

    showModal('MASA TAŞI / BİRLEŞTİR', 'Hedef masayı seçiniz:', optionsHtml, async (data) => {
        const targetId = data['target-table-select'];
        if(!targetId) return;

        const targetTableSnap = await getDoc(doc(db, "tables", targetId));
        const targetData = targetTableSnap.data();
        const currentOrderSnap = await getDoc(doc(db, "orders", currentOrderDocId));
        const orderData = currentOrderSnap.data();

        if(targetData.status === 'empty') {
            await updateDoc(doc(db, "orders", currentOrderDocId), { 
                tableId: targetId, 
                logs: [...(orderData.logs||[]), createLog("Masa Taşındı", `${currentTableId} -> ${targetId}`)] 
            });
            await updateDoc(doc(db, "tables", targetId), { 
                status: 'active', currentOrderId: currentOrderDocId, totalAmount: orderData.total, paidAmount: orderData.paid, timestamp: new Date().toISOString() 
            });
            await updateDoc(doc(db, "tables", currentTableId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, timestamp: null });
            
            showModal('BAŞARILI', 'Masa başarıyla taşındı.', '', null, true);
            currentOrderDocId = null;
            switchView('tables');

        } else if (targetData.status === 'active') {
            const targetOrderSnap = await getDoc(doc(db, "orders", targetData.currentOrderId));
            const targetOrderData = targetOrderSnap.data();
            
            const mergedItems = [...(targetOrderData.items||[]), ...(orderData.items||[])];
            const mergedPayments = [...(targetOrderData.partialPayments||[]), ...(orderData.partialPayments||[])];
            const mergedLogs = [...(targetOrderData.logs||[]), ...(orderData.logs||[]), createLog("Adisyon Birleştirildi", `${currentTableId} hesabı bu masaya aktarıldı.`)];
            const mergedTotal = (targetOrderData.total||0) + (orderData.total||0);
            const mergedPaid = (targetOrderData.paid||0) + (orderData.paid||0);

            await updateDoc(doc(db, "orders", targetData.currentOrderId), {
                items: mergedItems, partialPayments: mergedPayments, total: mergedTotal, paid: mergedPaid, logs: mergedLogs
            });
            await updateDoc(doc(db, "tables", targetId), { totalAmount: mergedTotal, paidAmount: mergedPaid });
            
            await updateDoc(doc(db, "orders", currentOrderDocId), { status: 'merged_deleted' });
            await updateDoc(doc(db, "tables", currentTableId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, timestamp: null });

            showModal('BAŞARILI', 'Adisyonlar başarıyla birleştirildi.', '', null, true);
            currentOrderDocId = null;
            switchView('tables');
        }
    });
});

function handleTableClick(tableName, tableData) {
    currentTableId = tableName;

    if(tableData.status === 'empty') {
        showModal('MASA İŞLEMİ', `<strong style="color:var(--accent); font-size:20px; letter-spacing:2px; font-family:var(--font-head);">${tableName}</strong><br><br>İşlem Seçiniz:`, `
            <button id="mod-open" class="btn-confirm" style="padding:14px; margin-bottom:10px; width:100%; border:none; border-radius:6px; color:var(--bg); font-weight:900; cursor:pointer;">SİPARİŞE AÇ</button>
            <button id="mod-res" class="btn-cancel" style="padding:14px; width:100%; border:none; border-radius:6px; color:white; font-weight:900; cursor:pointer; margin-bottom:10px;">REZERVE ET</button>
            <button onclick="closeModal()" class="btn-cancel" style="padding:14px; width:100%; border:none; border-radius:6px; background:transparent; color:var(--text); border:1px solid var(--border); font-weight:900; cursor:pointer;">İPTAL</button>
        `, null, false, true);
        
        document.getElementById('mod-open').onclick = async () => {
            closeModal();
            await createNewOrder(tableName);
        };
        document.getElementById('mod-res').onclick = () => {
            showModal('REZERVASYON YAP', `Müşteri Bilgisi Giriniz:`, `
                <input type="text" id="res-name" placeholder="Rezervasyon Sahibi">
                <select id="res-color">
                    <option value="#BFA37D">GOLD / BRONZ</option>
                    <option value="#756D60">KOYU GRİ</option>
                    <option value="#8B453A">BORDO</option>
                    <option value="#4B637B">LACİVERT</option>
                </select>
            `, async (data) => {
                const n = data['res-name'];
                const c = data['res-color'];
                await updateDoc(doc(db, "tables", tableName), { status: 'reserved', reservedName: n, reservedColor: c, timestamp: new Date().toISOString() });
            });
        };
    } else if (tableData.status === 'reserved') {
        showModal('REZERVASYON', `<strong style="color:var(--accent); font-size:20px; letter-spacing:2px; font-family:var(--font-head);">${tableName}</strong><br><br>Rezervasyon Sahibi: <b style="color:var(--text);">${tableData.reservedName}</b>`, `
            <button id="mod-open-res" class="btn-confirm" style="padding:14px; margin-bottom:10px; width:100%; border:none; border-radius:6px; color:var(--bg); font-weight:900; cursor:pointer;">MASAYI AÇ (SİPARİŞE BAŞLA)</button>
            <button id="mod-cancel-res" class="btn-red" style="padding:14px; width:100%; border:none; border-radius:6px; color:white; font-weight:900; cursor:pointer; margin-bottom:10px;">İPTAL ET (MÜSAİT YAP)</button>
            <button onclick="closeModal()" class="btn-cancel" style="padding:14px; width:100%; border:none; border-radius:6px; background:transparent; color:var(--text); border:1px solid var(--border); font-weight:900; cursor:pointer;">VAZGEÇ</button>
        `, null, false, true);
        
        document.getElementById('mod-open-res').onclick = async () => {
            closeModal();
            await createNewOrder(tableName);
        };
        document.getElementById('mod-cancel-res').onclick = async () => {
            closeModal();
            await updateDoc(doc(db, "tables", tableName), { status: 'empty', reservedName: '', reservedColor: null, timestamp: null });
        };
    } else if (tableData.status === 'active') {
        openOrderView(tableName, tableData.currentOrderId);
    }
}

async function createNewOrder(tableName) {
    const orderId = 'ORD-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    const orderRef = doc(db, "orders", orderId);
    const ts = new Date().toISOString();
    
    await setDoc(orderRef, {
        tableId: tableName, status: 'open', items: [], partialPayments: [], paid: 0, total: 0, 
        createdAt: ts, creator: currentUser.name, logs: [createLog("Masa Açıldı", `${tableName} siparişe açıldı.`)]
    });
    await updateDoc(doc(db, "tables", tableName), { status: 'active', currentOrderId: orderId, reservedName: '', totalAmount: 0, paidAmount: 0, timestamp: ts });
    openOrderView(tableName, orderId);
}

function openOrderView(tableName, orderId) {
    document.getElementById('current-table-name').textContent = tableName;
    document.getElementById('current-order-id').textContent = "ID: " + orderId;
    currentOrderDocId = orderId;
    switchView('order');
    listenOrderData(orderId);
}

document.getElementById('back-to-tables').addEventListener('click', () => {
    currentOrderDocId = null;
    if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; } 
    switchView('tables');
});

async function bumpMenuVersion() {
    await updateDoc(doc(db, "settings", "global"), { menuVersion: Date.now().toString() });
}

async function fetchMenuData() {
    const [catSnap, prodSnap] = await Promise.all([
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "products"))
    ]);
    
    globalCategoriesList = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    globalCategoriesList.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));
    
    globalProductsList = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    globalProductsList.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));
    
    localStorage.setItem('twinA_menu', JSON.stringify({ cats: globalCategoriesList, prods: globalProductsList }));
    localStorage.setItem('twinA_menu_version', companyInfo.menuVersion || '1');
    
    renderCategoriesUI();
    renderProductsUI();
}

function loadMenuSmart() {
    const localMenu = localStorage.getItem('twinA_menu');
    const localVersion = localStorage.getItem('twinA_menu_version');
    const remoteVersion = companyInfo.menuVersion || '1';

    if (localMenu && localVersion === remoteVersion) {
        const parsed = JSON.parse(localMenu);
        globalCategoriesList = parsed.cats;
        globalProductsList = parsed.prods;
        renderCategoriesUI();
        renderProductsUI();
    } else {
        fetchMenuData();
    }
}

function renderCategoriesUI() {
    const catOrder = document.getElementById('categories-container');
    const catSelect = document.getElementById('new-product-category');
    const editCatSelect = document.getElementById('edit-cat-select');
    
    let selectedCatId = editCatSelect ? editCatSelect.value : '';
    
    if(catOrder) catOrder.innerHTML = ''; 
    if(catSelect) catSelect.innerHTML = '';
    if(editCatSelect) editCatSelect.innerHTML = '<option value="">Kategori Seçin</option>';
    
    let validCurrentCat = globalCategoriesList.some(c => c.name === currentCategory);
    
    if(!validCurrentCat && globalCategoriesList.length > 0) {
        currentCategory = globalCategoriesList[0].name;
    }
    
    globalCategoriesList.forEach((cat) => {
        if(catOrder) {
            const btn = document.createElement('button');
            btn.className = `cat-btn ${currentCategory === cat.name ? 'active' : ''}`;
            btn.textContent = cat.name;
            btn.onclick = () => { 
                currentCategory = cat.name; 
                renderCategoriesUI(); 
                renderProductsUI(); 
            };
            catOrder.appendChild(btn);
        }

        if(catSelect) {
            const opt = document.createElement('option');
            opt.value = cat.name; opt.textContent = cat.name;
            catSelect.appendChild(opt);
        }
        
        if(editCatSelect) {
            const opt = document.createElement('option');
            opt.value = cat.id; opt.textContent = cat.name;
            editCatSelect.appendChild(opt);
        }
    });
    
    if(editCatSelect && selectedCatId) {
        editCatSelect.value = selectedCatId;
    }
}

document.getElementById('add-category-btn').addEventListener('click', async () => {
    const name = document.getElementById('cat-name').value.trim().toUpperCase();
    const orderVal = document.getElementById('cat-order').value;
    const order = orderVal !== '' ? parseInt(orderVal) : ''; 
    
    if(name) {
        await addDoc(collection(db, "categories"), { name: name, order: order });
        document.getElementById('cat-name').value = '';
        document.getElementById('cat-order').value = '';
        showModal('BAŞARILI', 'Kategori eklendi.', '', null, true);
    }
});

document.getElementById('edit-cat-select').addEventListener('change', (e) => {
    const catId = e.target.value;
    const cat = globalCategoriesList.find(c => c.id === catId);
    if(cat) {
        document.getElementById('edit-cat-name').value = cat.name;
        document.getElementById('edit-cat-order').value = cat.order !== undefined ? cat.order : '';
    } else {
        document.getElementById('edit-cat-name').value = '';
        document.getElementById('edit-cat-order').value = '';
    }
});

document.getElementById('update-cat-btn').addEventListener('click', async () => {
    const catId = document.getElementById('edit-cat-select').value;
    const newName = document.getElementById('edit-cat-name').value.trim().toUpperCase();
    const orderVal = document.getElementById('edit-cat-order').value;
    const newOrder = orderVal !== '' ? parseInt(orderVal) : '';
    
    if(!catId || !newName) {
        showModal('HATA', 'Lütfen güncellenecek kategoriyi seçin ve yeni ismi girin.', '', null, true);
        return;
    }
    
    const cat = globalCategoriesList.find(c => c.id === catId);
    if(!cat) return;
    const oldName = cat.name;
    
    await updateDoc(doc(db, "categories", catId), { name: newName, order: newOrder });
    
    if(oldName !== newName) {
        const q = query(collection(db, "products"), where("cat", "==", oldName));
        const snap = await getDocs(q);
        const updatePromises = [];
        snap.forEach((d) => {
            updatePromises.push(updateDoc(doc(db, "products", d.id), { cat: newName }));
        });
        await Promise.all(updatePromises);
    }
    
    document.getElementById('edit-cat-select').value = '';
    document.getElementById('edit-cat-name').value = '';
    document.getElementById('edit-cat-order').value = '';
    showModal('BAŞARILI', 'Kategori güncellendi.', '', null, true);
});

document.getElementById('delete-cat-btn').addEventListener('click', () => {
    const catId = document.getElementById('edit-cat-select').value;
    if(!catId) {
        showModal('HATA', 'Lütfen silinecek kategoriyi seçin.', '', null, true);
        return;
    }
    showModal('KATEGORİ SİL', 'Bu kategoriyi silerseniz içindeki ürünler MENÜDE GÖRÜNMEZ. Emin misiniz?', '', async () => {
        await deleteDoc(doc(db, "categories", catId));
        document.getElementById('edit-cat-select').value = '';
        document.getElementById('edit-cat-name').value = '';
        document.getElementById('edit-cat-order').value = '';
        showModal('BAŞARILI', 'Kategori silindi.', '', null, true);
    });
});

function renderProductsUI() {
    const container = document.getElementById('products-container');
    const adminContainer = document.getElementById('admin-menu-list');
    if(container) container.innerHTML = '';
    if(adminContainer) adminContainer.innerHTML = '';

    let allProducts = [...globalProductsList];
    allProducts.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));

    const productsByCategory = {};
    allProducts.forEach(p => {
        if(!productsByCategory[p.cat]) productsByCategory[p.cat] = [];
        productsByCategory[p.cat].push(p);

        if(container && p.cat === currentCategory) {
            const div = document.createElement('div');
            div.className = `product-card ${!p.stock ? 'out-of-stock' : ''}`;
            div.innerHTML = `
                <div>
                    <div class="prod-name">${p.name}</div>
                    <div class="prod-badges">
                        ${p.cal ? `<span class="mini-badge">Kalori: ${p.cal}</span>` : ''}
                        ${p.allergen ? `<span class="mini-badge" style="color:var(--accent); background:transparent; border-color:var(--accent);">Alerjen: ${p.allergen}</span>` : ''}
                        ${p.vegan ? `<span class="mini-badge" style="color:var(--green); border-color:var(--green); background:transparent;">VEGAN</span>` : ''}
                    </div>
                </div>
                <div class="prod-price">${p.price} ₺</div>
            `;
            if(p.stock) div.addEventListener('click', () => addItemToOrder(p));
            container.appendChild(div);
        }
    });

    if(adminContainer) {
        Object.keys(productsByCategory).sort((a,b) => {
            const catA = globalCategoriesList.find(c => c.name === a);
            const catB = globalCategoriesList.find(c => c.name === b);
            return getOrderVal(catA ? catA.order : null) - getOrderVal(catB ? catB.order : null);
        }).forEach(cat => {
            adminContainer.innerHTML += `<div class="menu-group-title"><span>${cat}</span></div>`;
            productsByCategory[cat].forEach(p => {
                const divA = document.createElement('div');
                divA.className = `admin-list-item`;
                
                let attrHtml = '';
                if(p.desc) attrHtml += `İçerik: ${p.desc} | `;
                if(p.cal) attrHtml += `Kalori: ${p.cal} | `;
                if(p.allergen) attrHtml += `Alerjen: ${p.allergen} | `;
                
                let safeName = p.name.replace(/'/g, "\\'");
                let safeDesc = p.desc ? p.desc.replace(/'/g, "\\'") : '';
                
                divA.innerHTML = `
                    <div class="info" style="${!p.stock ? 'opacity:0.5; filter:grayscale(1);' : ''}">
                        <strong>${p.name} ${!p.stock ? '<span style="color:var(--red); font-size:10px;">(TÜKENDİ)</span>' : ''}</strong>
                        <div style="font-size:11px; color:var(--gray); margin-bottom:5px;">
                            ${attrHtml} ${p.vegan ? '<span style="color:var(--green); font-weight:900;">VEGAN</span>' : ''}
                        </div>
                        <span style="color:var(--gray); font-size:12px; font-weight:900; letter-spacing:1px;">FİYAT: <span style="color:var(--accent);">${p.price} ₺</span> | SIRA: <span style="color:var(--accent);">${p.order !== "" && p.order !== undefined ? p.order : 'Yok'}</span></span>
                    </div>
                    <div class="admin-actions">
                        <button class="action-btn ${p.stock ? 'btn-cancel' : 'btn-confirm'}" onclick="toggleStock('${p.id}', ${!p.stock})">${p.stock ? 'TÜKENDİ YAP' : 'SATIŞA AÇ'}</button>
                        <button class="action-btn btn-blue" onclick="editProduct('${p.id}', '${safeName}', ${p.price}, '${safeDesc}', '${p.cal || ''}', '${p.allergen || ''}', '${p.cat}', ${p.vegan}, '${p.order !== undefined ? p.order : ''}', ${p.stock})">DÜZENLE</button>
                        <button class="action-btn btn-red" onclick="deleteProduct('${p.id}')">SİL</button>
                    </div>
                `;
                adminContainer.appendChild(divA);
            });
        });
    }
}

window.toggleStock = async (id, state) => { 
    await updateDoc(doc(db, "products", id), { stock: state }); 
};
window.deleteProduct = (id) => {
    showModal('ÜRÜNÜ SİL', 'BU ÜRÜNÜ SİLMEK İSTEDİĞİNİZE EMİN MİSİNİZ?', '', async () => { 
        await deleteDoc(doc(db, "products", id)); 
        showModal('BAŞARILI', 'Ürün silindi.', '', null, true);
    });
};

window.editProduct = (id, name, price, desc, cal, allergen, cat, vegan, order, stock) => {
    editingProductId = id;
    editingProductStock = stock;
    document.getElementById('product-form-title').textContent = "ÜRÜNÜ DÜZENLE";
    document.getElementById('new-product-name').value = name;
    document.getElementById('new-product-price').value = price;
    document.getElementById('new-product-desc').value = desc !== 'undefined' && desc !== 'null' ? desc : '';
    document.getElementById('new-product-cal').value = cal !== 'undefined' && cal !== 'null' ? cal : '';
    document.getElementById('new-product-allergen').value = allergen !== 'undefined' && allergen !== 'null' ? allergen : '';
    document.getElementById('new-product-category').value = cat;
    document.getElementById('new-product-vegan').checked = vegan === true;
    document.getElementById('new-product-order').value = (order !== 'undefined' && order !== 'null' && order !== '') ? order : '';
    
    document.getElementById('save-product-btn').textContent = "ÜRÜNÜ GÜNCELLE";
    document.getElementById('save-product-btn').className = "btn-green";
    document.getElementById('cancel-edit-btn').style.display = 'block';
    
    switchView('menu');
};

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    editingProductId = null;
    document.getElementById('product-form-title').textContent = "YENİ ÜRÜN EKLE";
    document.getElementById('save-product-btn').textContent = "ÜRÜNÜ KAYDET";
    document.getElementById('save-product-btn').className = "btn-accent";
    document.getElementById('cancel-edit-btn').style.display = 'none';
    document.querySelectorAll('#product-form input').forEach(i => {
        if(i.type === 'checkbox') i.checked = false;
        else i.value = ''; 
    });
});

document.getElementById('save-product-btn').addEventListener('click', async () => {
    const orderVal = document.getElementById('new-product-order').value;
    const data = {
        name: document.getElementById('new-product-name').value,
        price: Number(document.getElementById('new-product-price').value),
        desc: document.getElementById('new-product-desc').value,
        cal: document.getElementById('new-product-cal').value,
        allergen: document.getElementById('new-product-allergen').value,
        cat: document.getElementById('new-product-category').value,
        vegan: document.getElementById('new-product-vegan').checked,
        order: orderVal !== '' ? parseInt(orderVal) : '',
        stock: editingProductId ? editingProductStock : true
    };
    if(data.name && data.price) {
        if(editingProductId) {
            await updateDoc(doc(db, "products", editingProductId), data);
            showModal('BAŞARILI', 'Ürün güncellendi.', '', null, true);
        } else {
            await addDoc(collection(db, "products"), data);
            showModal('BAŞARILI', 'Ürün eklendi.', '', null, true);
        }
        document.getElementById('cancel-edit-btn').click();
    }
});

function listenOrderData(orderId) {
    if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; }
    liveOrderUnsubscribe = onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if(!docSnap.exists()) return;
        const o = docSnap.data();
        const list = document.getElementById('adisyon-items');
        if(!list) return;
        list.innerHTML = '';
        let currentTotal = 0;

        let groups = {};
        (o.items || []).forEach((item, index) => {
            if(!item.deleted) currentTotal += item.price;
            
            let key = `${item.name}|${item.note || ''}|${item.deleted ? 'deleted' : 'active'}`;
            if(!groups[key]) {
                groups[key] = { ...item, qty: 0, indices: [] };
            }
            groups[key].qty++;
            groups[key].totalPrice = groups[key].qty * item.price;
            groups[key].indices.push(index);
        });

        Object.values(groups).forEach(g => {
            const div = document.createElement('div');
            div.className = 'adisyon-item';
            div.innerHTML = `
                <div class="item-info">
                    <span class="item-name ${g.deleted ? 'item-deleted' : ''}">${g.qty}x ${g.name} ${g.deleted ? '<small style="color:var(--red); font-size:10px; font-weight:900; letter-spacing:1px;">(İPTAL)</small>' : ''}</span>
                    ${g.note ? `<span style="font-size:11px; color:var(--accent); font-weight:800; background:var(--bg); padding:2px 6px; border-radius:4px; display:inline-block; margin-top:2px;">Not: ${g.note}</span>` : ''}
                    <span class="item-waiter" style="margin-top:2px;">${g.time} | EKLEYEN: ${g.waiter} ${g.deleted ? `| SİLEN: ${g.deletedBy}` : ''}</span>
                </div>
                <div class="flex-row">
                    <span class="item-price ${g.deleted ? 'item-deleted' : ''}">${g.totalPrice} ₺</span>
                    ${!g.deleted ? `
                        <button class="note-item-btn" onclick="addNoteToItem('${orderId}', ${g.indices[0]}, '${g.note || ''}')">NOT</button>
                        <button class="del-item-btn" onclick="deleteOrderItem(${g.indices[g.indices.length - 1]})">✖</button>
                    ` : ''}
                </div>
            `;
            list.appendChild(div);
        });

        const logs = document.getElementById('payment-logs');
        logs.innerHTML = '';
        let totalPaid = o.paid || 0;
        (o.partialPayments || []).forEach(p => {
            logs.innerHTML += `<div>- ${p.amount} ₺ ALINDI [${p.method}] (${p.time}) | TAHSİL: ${p.user}</div>`;
        });

        document.getElementById('adisyon-subtotal').textContent = `${currentTotal} ₺`;
        document.getElementById('adisyon-total').textContent = `${currentTotal - totalPaid} ₺`;
    });
}

async function addItemToOrder(product) {
    if(!currentOrderDocId) return;
    const orderRef = doc(db, "orders", currentOrderDocId);
    const snap = await getDoc(orderRef);
    const data = snap.data();
    const items = data.items || [];
    const logs = data.logs || [];
    
    items.push({ name: product.name, price: product.price, waiter: currentUser.name, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}) });
    logs.push(createLog("ÜRÜN EKLENDİ", `1x ${product.name} eklendi.`));
    
    const newTotal = (data.total || 0) + product.price;
    
    await Promise.all([
        updateDoc(orderRef, { items: items, logs: logs, total: newTotal }),
        updateDoc(doc(db, "tables", currentTableId), { totalAmount: newTotal })
    ]);
}

window.deleteOrderItem = async (index) => {
    if(!currentOrderDocId) return;
    const orderRef = doc(db, "orders", currentOrderDocId);
    const snap = await getDoc(orderRef);
    const data = snap.data();
    const items = data.items || [];
    const logs = data.logs || [];
    
    if(items[index] && !items[index].deleted) {
        items[index].deleted = true;
        items[index].deletedBy = currentUser.name;
        
        const newTotal = (data.total || 0) - items[index].price;
        
        logs.push(createLog("ÜRÜN İPTALİ", `1x ${items[index].name} listeden çıkarıldı.`));
        
        await Promise.all([
            updateDoc(orderRef, { items: items, logs: logs, total: newTotal }),
            updateDoc(doc(db, "tables", currentTableId), { totalAmount: newTotal })
        ]);
    }
};

window.addNoteToItem = (orderId, index, currentNote) => {
    showModal('ÜRÜNE NOT EKLE', 'Siparişe özel not giriniz (Örn: Şekersiz, Ketçapsız vb.):', `
        <input type="text" id="item-note" value="${currentNote}" placeholder="Notunuz...">
    `, async (data) => {
        const orderRef = doc(db, "orders", orderId);
        const snap = await getDoc(orderRef);
        const items = snap.data().items || [];
        if(items[index]) {
            items[index].note = data['item-note'];
            await updateDoc(orderRef, { items: items });
        }
    });
};

document.getElementById('partial-pay-btn').addEventListener('click', () => {
    if(!currentOrderDocId) return;
    showModal('KISMİ ÖDEME', 'ALINACAK TUTARI VE YÖNTEMİ SEÇİNİZ:', `
        <input type="number" id="pay-amt" placeholder="Tutar (₺)">
        <select id="pay-method">
            <option value="Nakit">Nakit</option>
            <option value="Kredi Kartı">Kredi Kartı</option>
            <option value="Yemek Kartı">Yemek Kartı</option>
        </select>
    `, async (data) => {
        const amt = Number(data['pay-amt']);
        const method = data['pay-method'];
        if(amt > 0) {
            const ref = doc(db, "orders", currentOrderDocId);
            const snap = await getDoc(ref);
            const d = snap.data();
            const pays = d.partialPayments || [];
            const logs = d.logs || [];
            
            const newPaid = (d.paid || 0) + amt;
            pays.push({ amount: amt, method: method, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}), user: currentUser.name });
            logs.push(createLog("ÖDEME ALINDI", `${method} ile tahsilat yapıldı: ${amt} ₺`));
            
            await updateDoc(ref, { partialPayments: pays, paid: newPaid, logs: logs });
            await updateDoc(doc(db, "tables", currentTableId), { paidAmount: newPaid });
            showModal('BAŞARILI', 'Kısmi ödeme kaydedildi.', '', null, true);
        }
    });
});

document.getElementById('item-pay-btn').addEventListener('click', async () => {
    if(!currentOrderDocId) return;
    const snap = await getDoc(doc(db, "orders", currentOrderDocId));
    const o = snap.data();
    const items = o.items || [];
    
    let checklistHtml = '<div id="item-pay-list" style="max-height:180px; overflow-y:auto; text-align:left; margin-bottom:15px; border:1px solid var(--border); padding:10px; border-radius:6px;">';
    let hasUnpaid = false;
    
    items.forEach((item, idx) => {
        if(!item.deleted && !item.paid) {
            hasUnpaid = true;
            checklistHtml += `
                <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
                    <input type="checkbox" class="item-pay-check custom-checkbox" data-idx="${idx}" data-price="${item.price}" data-name="${item.name}">
                    <span style="font-weight:bold; font-size:12px; color:var(--text);">${item.name} - <span style="color:var(--accent);">${item.price} ₺</span></span>
                </label>
            `;
        }
    });
    checklistHtml += '</div>';

    if(!hasUnpaid) {
        showModal('BİLGİ', 'Ödenecek açık ürün bulunmuyor.', '', null, true);
        return;
    }

    checklistHtml += `
        <div style="font-size:13px; font-weight:900; margin-bottom:10px;">SEÇİLEN TOPLAM: <span id="item-pay-total" style="color:var(--accent); font-size:18px;">0</span> ₺</div>
        <select id="item-pay-method">
            <option value="Nakit">Nakit</option>
            <option value="Kredi Kartı">Kredi Kartı</option>
            <option value="Yemek Kartı">Yemek Kartı</option>
        </select>
    `;

    showModal('ÜRÜN BAZLI ÖDEME', 'Ödenecek ürünleri seçiniz:', checklistHtml, async (data) => {
        const method = data['item-pay-method'];
        
        let totalToPay = 0;
        let selectedIndices = [];
        let itemNames = [];
        
        document.querySelectorAll('.item-pay-check:checked').forEach(chk => {
            selectedIndices.push(parseInt(chk.getAttribute('data-idx')));
            totalToPay += parseFloat(chk.getAttribute('data-price'));
            itemNames.push(chk.getAttribute('data-name'));
        });

        if(totalToPay > 0) {
            const ref = doc(db, "orders", currentOrderDocId);
            const refSnap = await getDoc(ref);
            const d = refSnap.data();
            const pays = d.partialPayments || [];
            const logs = d.logs || [];
            let freshItems = d.items || [];
            
            selectedIndices.forEach(idx => {
                freshItems[idx].paid = true;
            });
            
            const newPaid = (d.paid || 0) + totalToPay;
            pays.push({ amount: totalToPay, method: method, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}), user: currentUser.name });
            logs.push(createLog("ÜRÜN BAZLI ÖDEME", `${method} ile tahsil edildi: ${totalToPay} ₺ (${itemNames.join(', ')})`));
            
            await updateDoc(ref, { items: freshItems, partialPayments: pays, paid: newPaid, logs: logs });
            await updateDoc(doc(db, "tables", currentTableId), { paidAmount: newPaid });
            showModal('BAŞARILI', 'Seçilen ürünlerin ödemesi alındı.', '', null, true);
        }
    });

    setTimeout(() => {
        const checks = document.querySelectorAll('.item-pay-check');
        const totalEl = document.getElementById('item-pay-total');
        checks.forEach(c => {
            c.addEventListener('change', () => {
                let t = 0;
                document.querySelectorAll('.item-pay-check:checked').forEach(chk => {
                    t += parseFloat(chk.getAttribute('data-price'));
                });
                totalEl.textContent = t;
            });
        });
    }, 100);
});

document.getElementById('close-table-btn').addEventListener('click', async () => {
    if(!currentOrderDocId) return;
    const ref = doc(db, "orders", currentOrderDocId);
    const snap = await getDoc(ref);
    const d = snap.data();
    const remaining = (d.total || 0) - (d.paid || 0);

    if(remaining > 0) {
        showModal('MASAYI KAPAT', `KALAN HESAP: <b style="color:var(--accent); font-size:18px;">${remaining} ₺</b><br><br>TAHSİLAT YÖNTEMİNİ SEÇİNİZ:`, `
            <select id="pay-method-full">
                <option value="Nakit">Nakit</option>
                <option value="Kredi Kartı">Kredi Kartı</option>
                <option value="Yemek Kartı">Yemek Kartı</option>
            </select>
        `, async (data) => {
            const method = data['pay-method-full'];
            const pays = d.partialPayments || [];
            const logs = d.logs || [];

            pays.push({ amount: remaining, method: method, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}), user: currentUser.name, note: "Kapanış" });
            logs.push(createLog("HESAP KAPATILDI", `Kalan ${remaining} ₺ ${method} ile tahsil edilerek masa kapatıldı.`));
            
            await updateDoc(ref, { partialPayments: pays, paid: d.total, logs: logs, status: 'closed', closedAt: new Date().toISOString() });
            await updateDoc(doc(db, "tables", currentTableId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '', reservedColor: null, timestamp: null });
            currentOrderDocId = null;
            if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; }
            switchView('tables');
            
            const dateInput = document.getElementById('history-date-filter');
            if (dateInput && dateInput.value) {
                loadFinanceForDate(dateInput.value);
            }
            
            showModal('BAŞARILI', 'Hesap tahsil edildi ve masa kapatıldı.', '', null, true);
        });
    } else {
        showModal('MASAYI KAPAT', 'AÇIK HESAP BULUNMUYOR. MASA BOŞALTILACAKTIR. ONAYLIYOR MUSUNUZ?', '', async () => {
            const logs = d.logs || [];
            logs.push(createLog("MASA KAPATILDI", `Açık hesap olmadan masa boşaltıldı.`));
            await updateDoc(ref, { status: 'closed', logs: logs, closedAt: new Date().toISOString() });
            await updateDoc(doc(db, "tables", currentTableId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '', reservedColor: null, timestamp: null });
            currentOrderDocId = null;
            if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; }
            switchView('tables');
            
            const dateInput = document.getElementById('history-date-filter');
            if (dateInput && dateInput.value) {
                loadFinanceForDate(dateInput.value);
            }
            
            showModal('BAŞARILI', 'Masa boşaltıldı.', '', null, true);
        });
    }
});

document.getElementById('print-order-btn').addEventListener('click', async () => {
    if(!currentOrderDocId) return;
    const snap = await getDoc(doc(db, "orders", currentOrderDocId));
    const o = snap.data();
    
    let html = `
        <div style="width: 100%; max-width: 350px; margin: 0 auto;">
            ${getCompanyPrintHeader()}
            <div class="print-flex"><span class="print-bold">Masa:</span><span>${o.tableId}</span></div>
            <div class="print-flex"><span class="print-bold">Tarih:</span><span>${new Date().toLocaleString('tr-TR')}</span></div>
            <div class="print-div"></div>
    `;
    
    let groups = {};
    (o.items || []).forEach((item) => {
        if(!item.deleted) {
            let key = `${item.name}|${item.note || ''}`;
            if(!groups[key]) groups[key] = { ...item, qty: 0 };
            groups[key].qty++;
            groups[key].totalPrice = groups[key].qty * item.price;
        }
    });

    Object.values(groups).forEach(g => {
        html += `<div class="print-flex"><span>${g.qty}x ${g.name}</span><span>${g.totalPrice} TL</span></div>`;
        if(g.note) html += `<div style="font-size:10px; margin-top:-3px; margin-bottom:3px;">Not: ${g.note}</div>`;
    });

    html += `<div class="print-div"></div>`;
    
    (o.partialPayments || []).forEach(p => {
        html += `<div class="print-flex" style="font-size:10px;"><span>${p.method} ile:</span><span>${p.amount} TL</span></div>`;
    });

    html += `
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size: 14px;"><span>TOPLAM:</span><span>${o.total} TL</span></div>
            <div class="print-flex"><span>ÖDENEN:</span><span>${o.paid || 0} TL</span></div>
            <div class="print-flex print-bold" style="font-size: 14px;"><span>KALAN:</span><span>${o.total - (o.paid || 0)} TL</span></div>
            <p style="text-align: center; margin-top: 15px; border-top: 1px dashed black; padding-top: 5px;">Bizi Tercih Ettiğiniz İçin Teşekkürler.</p>
        </div>
    `;

    const pf = document.getElementById('print-frame');
    pf.innerHTML = html;
    window.print();
});

function listenStaff() {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
        const container = document.getElementById('admin-staff-list');
        if(!container) return;
        container.innerHTML = '';
        snapshot.docs.forEach(docSnap => {
            const u = docSnap.data();
            const div = document.createElement('div');
            div.className = `admin-list-item ${u.status === 'passive' ? 'passive' : ''}`;
            
            let actionsHtml = `<button class="action-btn btn-blue" onclick="resetStaffPass('${docSnap.id}')">ŞİFRE</button>`;
            
            if (docSnap.id === currentUser.docId) {
                actionsHtml += `<span style="color:var(--accent); font-size:10px; font-weight:900; margin-left:10px;">(BU SENSİN)</span>`;
            } else {
                actionsHtml += `
                    <button class="action-btn btn-confirm" onclick="toggleStaffRole('${docSnap.id}', '${u.role}')">${u.role === 'admin' ? 'GARSON YAP' : 'ADMİN YAP'}</button>
                    <button class="action-btn btn-cancel" onclick="toggleStaffStatus('${docSnap.id}', '${u.status}')">${u.status === 'passive' ? 'AKTİFLEŞTİR' : 'PASİFE AL'}</button>
                    <button class="action-btn btn-red" onclick="deleteStaff('${docSnap.id}')">SİL</button>
                `;
            }

            div.innerHTML = `
                <div class="info">
                    <strong>${u.name} ${u.status === 'passive' ? '<span style="color:var(--red); font-size:10px;">(PASİF)</span>' : ''}</strong>
                    <span style="color:var(--gray); font-size:11px; font-weight:800; letter-spacing:1px;">ROL: ${u.role === 'admin' ? 'YÖNETİCİ' : 'GARSON'} | İSİM: ${u.id || u.name}</span>
                </div>
                <div class="admin-actions">
                    ${actionsHtml}
                </div>
            `;
            container.appendChild(div);
        });
    });
    globalUnsubscribes.push(unsub);
}

document.getElementById('save-staff-btn').addEventListener('click', async () => {
    const name = document.getElementById('new-staff-name').value.trim();
    const pass = document.getElementById('new-staff-pass').value.trim();
    const role = document.getElementById('new-staff-role').value;
    
    if(!name || !pass) return;

    const q1 = query(collection(db, "users"), where("name", "==", name));
    const snap = await getDocs(q1);
    if(!snap.empty) {
        showModal('HATA', 'BU İSİMDE BİR PERSONEL SİSTEMDE ZATEN KAYITLI!', '', null, true);
        return;
    }

    const genId = Math.floor(1000 + Math.random() * 9000).toString();
    await addDoc(collection(db, "users"), { id: genId, name: name, password: pass, role: role, status: 'active' });
    document.getElementById('new-staff-name').value = ''; document.getElementById('new-staff-pass').value = '';
    showModal('BAŞARILI', `PERSONEL EKLENDİ.<br><br><b style="font-size:24px; color:var(--accent); letter-spacing:3px; font-family:var(--font-head);">ID: ${genId}</b>`, '', null, true);
});

window.resetStaffPass = (id) => {
    showModal('ŞİFRE SIFIRLA', 'YENİ ŞİFREYİ GİRİNİZ:', '<input type="text" id="new-p">', async (d) => {
        if(d['new-p']) {
            await updateDoc(doc(db, "users", id), { password: d['new-p'] });
            showModal('BAŞARILI', 'Şifre sıfırlandı.', '', null, true);
        }
    });
};
window.toggleStaffRole = async (id, currentRole) => {
    await updateDoc(doc(db, "users", id), { role: currentRole === 'admin' ? 'waiter' : 'admin' });
};
window.toggleStaffStatus = async (id, currentStatus) => {
    await updateDoc(doc(db, "users", id), { status: currentStatus === 'passive' ? 'active' : 'passive' });
};
window.deleteStaff = (id) => {
    showModal('PERSONELİ SİL', 'BU PERSONELİ SİSTEMDEN KALICI OLARAK SİLMEK İSTEDİĞİNİZE EMİN MİSİNİZ?', '', async () => {
        await deleteDoc(doc(db, "users", id));
        showModal('BAŞARILI', 'Personel silindi.', '', null, true);
    });
};

document.getElementById('update-staff-pass-btn').addEventListener('click', async () => {
    const oldP = document.getElementById('staff-old-pass').value.trim();
    const newP = document.getElementById('staff-new-pass').value.trim();
    
    if(!oldP || !newP) return;

    if(oldP !== currentUser.password) {
        showModal('HATA', 'MEVCUT ŞİFRENİZİ YANLIŞ GİRDİNİZ!', '', null, true);
        return;
    }

    await updateDoc(doc(db, "users", currentUser.docId), { password: newP });
    currentUser.password = newP;
    showModal('BAŞARILI', 'ŞİFRENİZ GÜNCELLENDİ.', '', null, true);
    document.getElementById('staff-old-pass').value = '';
    document.getElementById('staff-new-pass').value = '';
});

document.getElementById('update-credentials-btn').addEventListener('click', async () => {
    const id = document.getElementById('admin-new-id').value.trim() || currentUser.id;
    const pass = document.getElementById('admin-new-pass').value.trim() || currentUser.password;
    await updateDoc(doc(db, "users", currentUser.docId), { id: id, password: pass });
    showModal('BAŞARILI', 'GİRİŞ BİLGİLERİNİZ GÜNCELLENDİ.', '', null, true);
});

document.getElementById('update-company-btn').addEventListener('click', async () => {
    await updateDoc(doc(db, "settings", "global"), {
        name: document.getElementById('company-name').value,
        phone: document.getElementById('company-phone').value,
        address: document.getElementById('company-address').value,
        open: document.getElementById('company-open').value,
        close: document.getElementById('company-close').value
    });
    showModal('BAŞARILI', 'AYARLAR KAYDEDİLDİ.', '', null, true);
});

document.getElementById('toggle-maintenance-btn').addEventListener('click', async () => {
    const nextState = !companyInfo.maintenance;
    await updateDoc(doc(db, "settings", "global"), { maintenance: nextState });
});

document.getElementById('send-broadcast-btn').addEventListener('click', async () => {
    const msg = document.getElementById('broadcast-msg').value;
    await updateDoc(doc(db, "settings", "global"), { broadcast: msg });
});
document.getElementById('clear-broadcast-btn').addEventListener('click', async () => {
    document.getElementById('broadcast-msg').value = '';
    await updateDoc(doc(db, "settings", "global"), { broadcast: "" });
});

document.getElementById('force-menu-update-btn')?.addEventListener('click', async () => {
    await bumpMenuVersion();
    showModal('BAŞARILI', 'Menü tüm cihazlar (Garsonlar ve QR) için güncellendi.', '', null, true);
});

document.getElementById('history-date-filter').addEventListener('change', (e) => {
    loadFinanceForDate(e.target.value);
});

async function loadFinanceForDate(dateStr) {
    if(!dateStr) return;
    const [y, m, d] = dateStr.split('-');
    
    const startD = new Date(`${y}-${m}-${d}T00:00:00`);
    const endD = new Date(`${y}-${m}-${d}T23:59:59.999`);

    const qOrders = query(collection(db, "orders"), 
        where("closedAt", ">=", startD.toISOString()),
        where("closedAt", "<=", endD.toISOString())
    );

    const qExpenses = query(collection(db, "expenses"), 
        where("time", ">=", startD.toISOString()),
        where("time", "<=", endD.toISOString())
    );

    const [snapO, snapE] = await Promise.all([getDocs(qOrders), getDocs(qExpenses)]);
    
    globalOrders = snapO.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    globalExpenses = snapE.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    renderFinanceTotals();
    renderFinanceHistoryList();
}

function renderFinanceTotals() {
    const filterInput = document.getElementById('history-date-filter').value;
    if(!filterInput) return;
    
    const [y, m, d] = filterInput.split('-');
    const targetDateStr = `${d}.${m}.${y}`;

    let todayIncome = 0;
    let todayExpense = 0;
    let tNak = 0; let tKK = 0; let tYK = 0;

    globalOrders.forEach(o => {
        const closedDateArr = new Date(o.closedAt).toLocaleDateString('tr-TR').split('.');
        const formatClosed = `${closedDateArr[0].padStart(2, '0')}.${closedDateArr[1].padStart(2, '0')}.${closedDateArr[2]}`;
        
        if(formatClosed === targetDateStr) {
            todayIncome += o.total;
            (o.partialPayments || []).forEach(p => {
                if(p.method === 'Nakit') tNak += p.amount;
                if(p.method === 'Kredi Kartı') tKK += p.amount;
                if(p.method === 'Yemek Kartı') tYK += p.amount;
            });
        }
    });

    globalExpenses.forEach(e => {
        const expDateArr = new Date(e.time).toLocaleDateString('tr-TR').split('.');
        const formatExp = `${expDateArr[0].padStart(2, '0')}.${expDateArr[1].padStart(2, '0')}.${expDateArr[2]}`;
        
        if(formatExp === targetDateStr) {
            todayExpense += e.amount;
        }
    });

    document.getElementById('today-income').textContent = `${todayIncome} ₺`;
    document.getElementById('today-expense').textContent = `${todayExpense} ₺`;
    document.getElementById('today-net').textContent = `${todayIncome - todayExpense} ₺`;

    const typesContainer = document.getElementById('finance-types');
    if(typesContainer) {
        typesContainer.innerHTML = `
            <div>NAKİT: <span style="color:var(--accent);">${tNak} ₺</span></div>
            <div>K.KARTI: <span style="color:var(--accent);">${tKK} ₺</span></div>
            <div>Y.KARTI: <span style="color:var(--accent);">${tYK} ₺</span></div>
        `;
    }
}

function renderFinanceHistoryList() {
    const filterInput = document.getElementById('history-date-filter').value; 
    if(!filterInput) return;
    
    const [y, m, d] = filterInput.split('-');
    const targetDateStr = `${d}.${m}.${y}`;

    const historyContainer = document.getElementById('finance-history-list');
    const expenseContainer = document.getElementById('expense-list');
    
    historyContainer.innerHTML = '';
    expenseContainer.innerHTML = '';

    globalExpenses.forEach(e => {
        const expDateArr = new Date(e.time).toLocaleDateString('tr-TR').split('.');
        const formatExp = `${expDateArr[0].padStart(2, '0')}.${expDateArr[1].padStart(2, '0')}.${expDateArr[2]}`;

        if(formatExp === targetDateStr) {
            expenseContainer.innerHTML += `
                <div class="expense-item">
                    <div style="flex:1; font-weight:900; font-size:11px; color:var(--text); letter-spacing:1px;">${e.desc} <span style="color:var(--gray); font-size:9px;">(${e.user})</span></div>
                    <div style="color:var(--red); font-weight:900; margin-right:15px; font-size:13px;">- ${e.amount} ₺</div>
                    <button class="action-btn btn-cancel" type="button" onclick="event.stopPropagation(); deleteExpense('${e.id}')">SİL</button>
                </div>
            `;
        }
    });

    if(expenseContainer.innerHTML === '') expenseContainer.innerHTML = '<p style="color:var(--gray); font-size:11px;">Kayıt yok.</p>';

    const filteredOrders = globalOrders.filter(o => {
        const closedDateArr = new Date(o.closedAt).toLocaleDateString('tr-TR').split('.');
        const formatClosed = `${closedDateArr[0].padStart(2, '0')}.${closedDateArr[1].padStart(2, '0')}.${closedDateArr[2]}`;
        return formatClosed === targetDateStr;
    });
    
    filteredOrders.sort((a,b) => new Date(b.closedAt) - new Date(a.closedAt)).forEach(o => {
        let logHtml = `<div><strong style="color:var(--accent); font-size:12px; letter-spacing:1px;">SİPARİŞ İÇERİĞİ:</strong></div>`;
        
        let groups = {};
        (o.items || []).forEach((item) => {
            let key = `${item.name}|${item.note || ''}|${item.deleted ? 'deleted' : 'active'}`;
            if(!groups[key]) groups[key] = { ...item, qty: 0 };
            groups[key].qty++;
            groups[key].totalPrice = groups[key].qty * item.price;
        });

        Object.values(groups).forEach(g => {
            logHtml += `<div class="log-line" style="${g.deleted ? 'text-decoration:line-through; color:var(--red);' : ''}">
                - ${g.qty}x ${g.name} (${g.totalPrice} ₺) ${g.note ? `[Not: ${g.note}]` : ''} ${g.deleted ? `[İptal: ${g.deletedBy}]` : ''}
            </div>`;
        });
        
        logHtml += `<div style="margin-top:15px;"><strong style="color:var(--accent); font-size:12px; letter-spacing:1px;">İŞLEM GEÇMİŞİ:</strong></div>`;
        (o.logs || []).forEach(l => {
            const t = new Date(l.time).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});
            logHtml += `<div class="log-line"><span class="log-time">[${t}]</span> <b style="color:var(--text);">${l.user}</b>: ${l.action} <i style="color:var(--gray);">(${l.detail})</i></div>`;
        });
        
        logHtml += `<button class="btn-accent" type="button" style="margin-top:10px; padding:6px 12px; font-size:10px;" onclick="event.stopPropagation(); printSpecificOrder('${o.id}')">🖨️ BU ADİSYONU YAZDIR</button>`;

        historyContainer.innerHTML += `
            <div class="history-item">
                <div class="history-header" onclick="this.parentElement.classList.toggle('open')">
                    <span>${o.tableId} | SAAT: ${new Date(o.closedAt).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}</span>
                    <span style="color:var(--accent); font-weight:900; font-size:14px; font-family:var(--font-head);">${o.total} ₺</span>
                </div>
                <div class="history-body">${logHtml || 'Kayıt yok.'}</div>
            </div>
        `;
    });

    if(filteredOrders.length === 0) {
        historyContainer.innerHTML = '<p style="color:var(--gray); padding:15px; font-weight:bold; font-size:11px;">Bu tarihe ait sipariş kaydı bulunamadı.</p>';
    }
}

document.getElementById('z-report-btn').addEventListener('click', async () => {
    const filterInput = document.getElementById('history-date-filter').value || toYYYYMMDD(new Date());
    const [y, m, d] = filterInput.split('-');
    const reportDisplayDate = `${d}.${m}.${y}`;

    let totalNakit = 0; let totalKK = 0; let totalYK = 0;
    let userTotals = {}; let dailyExpenses = 0;

    globalOrders.forEach(o => {
        const closedDateArr = new Date(o.closedAt).toLocaleDateString('tr-TR').split('.');
        const formatClosed = `${closedDateArr[0].padStart(2, '0')}.${closedDateArr[1].padStart(2, '0')}.${closedDateArr[2]}`;

        if(formatClosed === reportDisplayDate) {
            (o.partialPayments || []).forEach(p => {
                const amt = p.amount; const user = p.user;
                if(p.method === 'Nakit') totalNakit += amt;
                else if(p.method === 'Kredi Kartı') totalKK += amt;
                else if(p.method === 'Yemek Kartı') totalYK += amt;

                if(!userTotals[user]) userTotals[user] = { Nakit: 0, 'Kredi Kartı': 0, 'Yemek Kartı': 0, Toplam: 0 };
                userTotals[user][p.method] += amt;
                userTotals[user].Toplam += amt;
            });
        }
    });

    globalExpenses.forEach(e => {
        const expDateArr = new Date(e.time).toLocaleDateString('tr-TR').split('.');
        const formatExp = `${expDateArr[0].padStart(2, '0')}.${expDateArr[1].padStart(2, '0')}.${expDateArr[2]}`;

        if(formatExp === reportDisplayDate) {
            dailyExpenses += e.amount;
        }
    });

    const ciro = totalNakit + totalKK + totalYK;
    const net = ciro - dailyExpenses;

    let html = `
        <div style="width: 100%; max-width: 400px; margin: 0 auto;">
            ${getCompanyPrintHeader()}
            <h3 style="text-align: center; margin-top: 10px; font-family:serif;">GÜNLÜK (Z) RAPORU</h3>
            <p style="text-align: center; font-size:11px;">Rapor Tarihi: ${reportDisplayDate}</p>
            
            <div class="print-div"></div>
            <div class="print-flex print-bold"><span>NAKİT:</span><span>${totalNakit} TL</span></div>
            <div class="print-flex print-bold"><span>KREDİ KARTI:</span><span>${totalKK} TL</span></div>
            <div class="print-flex print-bold"><span>YEMEK KARTI:</span><span>${totalYK} TL</span></div>
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size:14px;"><span>GÜNLÜK CİRO:</span><span>${ciro} TL</span></div>
            <div class="print-flex print-bold"><span>GÜNLÜK MASRAF:</span><span>- ${dailyExpenses} TL</span></div>
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size:16px;"><span>NET KASA:</span><span>${net} TL</span></div>
            
            <h3 style="margin-top:20px; border-bottom:1px solid #000; padding-bottom:5px; font-family:serif;">PERSONEL BAZLI TAHSİLAT</h3>
    `;

    Object.keys(userTotals).forEach(u => {
        const ut = userTotals[u];
        html += `
            <div style="margin-bottom: 10px;">
                <b style="font-size:13px;">${u}</b>
                <div class="print-flex"><span>Nakit:</span><span>${ut.Nakit} TL</span></div>
                <div class="print-flex"><span>KK:</span><span>${ut['Kredi Kartı']} TL</span></div>
                <div class="print-flex"><span>YK:</span><span>${ut['Yemek Kartı']} TL</span></div>
                <div class="print-flex print-bold" style="border-top:1px dashed #ccc; padding-top:2px;"><span>Toplam:</span><span>${ut.Toplam} TL</span></div>
            </div>
        `;
    });

    html += `</div>`;
    
    const pf = document.getElementById('print-frame');
    pf.innerHTML = html;
    window.print();
});

window.printSpecificOrder = (orderId) => {
    const o = globalOrders.find(x => x.id === orderId);
    if(!o) return;
    
    let html = `
        <div style="width: 100%; max-width: 350px; margin: 0 auto;">
            ${getCompanyPrintHeader()}
            <div class="print-flex"><span class="print-bold">Masa:</span><span>${o.tableId}</span></div>
            <div class="print-flex"><span class="print-bold">Tarih:</span><span>${new Date(o.closedAt).toLocaleString('tr-TR')}</span></div>
            <div class="print-div"></div>
    `;
    
    let groups = {};
    (o.items || []).forEach((item) => {
        if(!item.deleted) {
            let key = `${item.name}|${item.note || ''}`;
            if(!groups[key]) groups[key] = { ...item, qty: 0 };
            groups[key].qty++;
            groups[key].totalPrice = groups[key].qty * item.price;
        }
    });

    Object.values(groups).forEach(g => {
        html += `<div class="print-flex"><span>${g.qty}x ${g.name}</span><span>${g.totalPrice} TL</span></div>`;
        if(g.note) html += `<div style="font-size:10px; margin-top:-3px; margin-bottom:3px;">Not: ${g.note}</div>`;
    });

    html += `<div class="print-div"></div>`;
    
    (o.partialPayments || []).forEach(p => {
        html += `<div class="print-flex" style="font-size:10px;"><span>${p.method} ile:</span><span>${p.amount} TL</span></div>`;
    });

    html += `
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size: 14px;"><span>TOPLAM:</span><span>${o.total} TL</span></div>
            <div class="print-flex"><span>ÖDENEN:</span><span>${o.paid || 0} TL</span></div>
            <div class="print-flex print-bold" style="font-size: 14px;"><span>KALAN:</span><span>${o.total - (o.paid || 0)} TL</span></div>
            <p style="text-align: center; margin-top: 15px; border-top: 1px dashed black; padding-top: 5px;">Bizi Tercih Ettiğiniz İçin Teşekkürler.</p>
        </div>
    `;

    const pf = document.getElementById('print-frame');
    pf.innerHTML = html;
    window.print();
};

document.getElementById('save-expense-btn').addEventListener('click', async () => {
    try {
        const amt = Number(document.getElementById('expense-amount').value);
        const desc = document.getElementById('expense-desc').value.trim();
        if(amt > 0 && desc) {
            await addDoc(collection(db, "expenses"), { amount: amt, desc: desc, user: currentUser ? currentUser.name : 'Bilinmeyen', time: new Date().toISOString() });
            document.getElementById('expense-amount').value = ''; document.getElementById('expense-desc').value = '';
            
            const dateInput = document.getElementById('history-date-filter');
            if(dateInput) loadFinanceForDate(dateInput.value);
        }
    } catch(e) {
        console.error(e);
    }
});

window.deleteExpense = (id) => {
    showModal('MASRAFI SİL', 'BU MASRAFI SİLMEK İSTEDİĞİNİZE EMİN MİSİNİZ?', '', async () => { 
        await deleteDoc(doc(db, "expenses", id)); 
        const dateInput = document.getElementById('history-date-filter');
        if(dateInput) loadFinanceForDate(dateInput.value);
    });
};

async function loadQRCategoriesAndProducts() {
    let globalCats = [];
    let globalProds = [];

    window.renderQR = () => {
        const catContainer = document.getElementById('qr-categories-container');
        const prodContainer = document.getElementById('qr-products-container');
        if(!catContainer || !prodContainer) return;

        catContainer.innerHTML = '';
        prodContainer.innerHTML = '';

        if(globalCats.length === 0) return;
        if(!currentCategory) currentCategory = globalCats[0].name;

        globalCats.forEach(c => {
            const btn = document.createElement('button');
            btn.className = `qr-cat-btn ${currentCategory === c.name ? 'active' : ''}`;
            btn.textContent = c.name;
            btn.onclick = () => { currentCategory = c.name; window.renderQR(); };
            catContainer.appendChild(btn);
        });

        const activeProds = globalProds.filter(p => p.cat === currentCategory);
        activeProds.forEach(p => {
            prodContainer.innerHTML += `
                <div class="qr-product-card" style="${!p.stock ? 'opacity:0.4;' : ''}">
                    <div class="qr-prod-info">
                        <div class="qr-prod-name">${p.name} ${!p.stock ? '<span style="color:var(--red); font-size:10px; font-weight:900; letter-spacing:1px; font-family:var(--font-body);">(TÜKENDİ)</span>' : ''}</div>
                        ${p.desc ? `<div class="qr-prod-desc">${p.desc}</div>` : ''}
                        <div class="flex-row" style="margin-top:2px;">
                            ${p.cal ? `<span class="qr-badge">Kalori: ${p.cal}</span>` : ''}
                            ${p.allergen ? `<span class="qr-badge" style="color:var(--accent); border-color:var(--accent);">Alerjen: ${p.allergen}</span>` : ''}
                            ${p.vegan ? `<span class="qr-badge" style="color:var(--green); border-color:var(--green);">VEGAN</span>` : ''}
                        </div>
                    </div>
                    <div class="qr-prod-price">${p.price} ₺</div>
                </div>
            `;
        });
    };

    const localMenu = localStorage.getItem('twinA_menu');
    const localVersion = localStorage.getItem('twinA_menu_version');
    const remoteVersion = companyInfo.menuVersion || '1';

    if (localMenu && localVersion === remoteVersion) {
        const parsed = JSON.parse(localMenu);
        globalCats = parsed.cats;
        globalProds = parsed.prods;
        window.renderQR();
    } else {
        try {
            const [catSnap, prodSnap] = await Promise.all([
                getDocs(collection(db, "categories")),
                getDocs(collection(db, "products"))
            ]);
            
            globalCats = catSnap.docs.map(d => d.data());
            globalCats.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));
            
            globalProds = prodSnap.docs.map(d => d.data());
            globalProds.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));
            
            localStorage.setItem('twinA_menu', JSON.stringify({ cats: globalCats, prods: globalProds }));
            localStorage.setItem('twinA_menu_version', remoteVersion);
            
            window.renderQR();
        } catch(e) {
            console.error(e);
        }
    }
}

async function initDashboard() {
    const dashTotalOrders = document.getElementById('dash-total-orders');
    const dashTotalRev = document.getElementById('dash-total-revenue');
    const dashBestItem = document.getElementById('dash-best-item');
    if(!dashTotalOrders) return; 

    document.getElementById('dash-range-select').addEventListener('change', (e) => {
        if(e.target.value === 'custom') {
            document.getElementById('dash-custom-range').style.display = 'flex';
        } else {
            document.getElementById('dash-custom-range').style.display = 'none';
            applyDashboardRange(e.target.value);
        }
    });

    document.getElementById('dash-apply-btn').addEventListener('click', () => {
        const s = document.getElementById('dash-start-date').value;
        const e = document.getElementById('dash-end-date').value;
        if(s && e) {
            updateDashboardData(s, e);
        } else {
            showModal('HATA', 'Lütfen başlangıç ve bitiş tarihlerini seçiniz.', '', null, true);
        }
    });

    const select = document.getElementById('dash-range-select');
    if(select.value !== 'custom') {
        applyDashboardRange(select.value);
    } else {
        document.getElementById('dash-apply-btn').click();
    }
}

function applyDashboardRange(val) {
    const end = new Date();
    const start = new Date();

    if (val === 'today') {
    } else if (val === 'yesterday') {
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
    } else {
        start.setDate(start.getDate() - (parseInt(val) - 1));
    }
    
    updateDashboardData(toYYYYMMDD(start), toYYYYMMDD(end));
}

async function updateDashboardData(startDateStr, endDateStr) {
    const dashTotalOrders = document.getElementById('dash-total-orders');
    const dashTotalRev = document.getElementById('dash-total-revenue');
    const dashBestItem = document.getElementById('dash-best-item');

    const startD = new Date(`${startDateStr}T00:00:00`);
    const endD = new Date(`${endDateStr}T23:59:59.999`);

    const qOrders = query(collection(db, "orders"), 
        where("closedAt", ">=", startD.toISOString()),
        where("closedAt", "<=", endD.toISOString())
    );

    const snap = await getDocs(qOrders);
    const dashOrders = snap.docs.map(d => d.data());

    let totalRev = 0;
    let totalOrders = 0;
    let itemCounts = {};
    let aggRevenues = {};

    const diffDays = Math.floor((endD - startD) / (1000 * 60 * 60 * 24));
    const isMonthly = diffDays > 90;

    if (isMonthly) {
        let curr = new Date(startD.getFullYear(), startD.getMonth(), 1);
        while(curr <= endD) {
            let mStr = `${curr.getFullYear()}-${String(curr.getMonth()+1).padStart(2,'0')}`;
            aggRevenues[mStr] = 0;
            curr.setMonth(curr.getMonth() + 1);
        }
    } else {
        for(let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
            aggRevenues[toYYYYMMDD(new Date(d))] = 0;
        }
    }

    dashOrders.forEach(o => {
        const od = new Date(o.closedAt);
        const dKey = isMonthly 
            ? `${od.getFullYear()}-${String(od.getMonth()+1).padStart(2,'0')}`
            : toYYYYMMDD(od);

        if(aggRevenues[dKey] !== undefined) {
            totalOrders++;
            totalRev += o.total;
            aggRevenues[dKey] += o.total;

            (o.items || []).forEach(item => {
                if(!item.deleted) {
                    if(!itemCounts[item.name]) itemCounts[item.name] = 0;
                    itemCounts[item.name]++;
                }
            });
        }
    });

    dashTotalOrders.textContent = totalOrders;
    dashTotalRev.textContent = `${totalRev} ₺`;

    let sortedItems = Object.entries(itemCounts).sort((a,b) => b[1] - a[1]);
    if(sortedItems.length > 0) {
        dashBestItem.textContent = `${sortedItems[0][0]} (${sortedItems[0][1]} Adet)`;
    } else {
        dashBestItem.textContent = "Veri Yok";
    }

    let chartLabels = [];
    if(isMonthly) {
        chartLabels = Object.keys(aggRevenues).map(m => {
            const [y, mo] = m.split('-'); return `${mo}/${y}`;
        });
    } else {
        chartLabels = Object.keys(aggRevenues).map(d => {
            const p = d.split('-'); return `${p[2]}.${p[1]}`;
        });
    }

    renderCharts(chartLabels, Object.values(aggRevenues), sortedItems.slice(0,5));
}

function renderCharts(labelsRev, dataRev, topItems) {
    const ctxRev = document.getElementById('revenueChart');
    const ctxProd = document.getElementById('productsChart');

    if(chartInstances.rev) chartInstances.rev.destroy();
    if(chartInstances.prod) chartInstances.prod.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#F0EAD6' : '#2C2A26';
    const gridColor = isDark ? '#2D2A26' : '#D1C9B8';

    Chart.defaults.color = textColor;
    Chart.defaults.font.family = "'Montserrat', sans-serif";

    chartInstances.rev = new Chart(ctxRev, {
        type: 'line',
        data: {
            labels: labelsRev,
            datasets: [{
                label: 'Ciro (₺)',
                data: dataRev,
                borderColor: '#D4AF37',
                backgroundColor: 'rgba(212, 175, 55, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#D4AF37'
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: { grid: { color: gridColor } },
                y: { grid: { color: gridColor }, beginAtZero: true }
            },
            plugins: { legend: { display: false } }
        }
    });

    const labelsProd = topItems.map(i => i[0]);
    const dataProd = topItems.map(i => i[1]);

    chartInstances.prod = new Chart(ctxProd, {
        type: 'bar',
        data: {
            labels: labelsProd,
            datasets: [{
                label: 'Satış Adedi',
                data: dataProd,
                backgroundColor: ['#D4AF37', '#5C7561', '#5C7A96', '#A65648', '#8A847A'],
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: gridColor }, beginAtZero: true }
            },
            plugins: { legend: { display: false } }
        }
    });
}
