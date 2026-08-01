import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, getDoc, setDoc, updateDoc, doc, onSnapshot, query, where, addDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
let currentOrderData = null;
let currentCategory = '';
let companyInfo = { name: "TWIN-A", phone: "", address: "", open: "", close: "", broadcast: "", maintenance: false };
let editingProductId = null;
let editingProductStock = true;
let isMaintenanceEnforced = false;
let globalUnsubscribes = [];
let timeUpdaterInterval = null;
let liveOrderUnsubscribe = null;

let globalOrders = [];
let globalExpenses = [];
let globalCategoriesList = [];
let globalProductsList = []; 

let financeUnsubOrders = null;
let financeUnsubExpenses = null;

const getOrderVal = (val) => (val === "" || val === null || val === undefined) ? 999 : Number(val);

const urlParams = new URLSearchParams(window.location.search);
const isQRMode = urlParams.get('qr') === '1';
const expectedHash = window.location.hash || '';

window.toggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
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
    if(financeUnsubOrders) { financeUnsubOrders(); financeUnsubOrders = null; }
    if(financeUnsubExpenses) { financeUnsubExpenses(); financeUnsubExpenses = null; }
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

function getBusinessDateObj(dateInput) {
    const d = new Date(dateInput);
    if(companyInfo.close) {
        const parts = companyInfo.close.split(':');
        if(parts.length === 2) {
            const closeHour = parseInt(parts[0], 10);
            const closeMin = parseInt(parts[1], 10);
            
            if (closeHour >= 0 && closeHour <= 12) {
                const currentHour = d.getHours();
                const currentMin = d.getMinutes();
                if(currentHour < closeHour || (currentHour === closeHour && currentMin < closeMin)) {
                    d.setDate(d.getDate() - 1);
                }
            }
        }
    }
    return d;
}

function getBusinessDateStr(dateInput) {
    if(!dateInput) return "";
    const d = getBusinessDateObj(dateInput);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}.${m}.${y}`;
}

function injectDashboardUI() {
    if(document.getElementById('dashboard-view')) return;

    const style = document.createElement('style');
    style.innerHTML = `
        .dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .dash-card { background: var(--card-bg); border-top: 4px solid var(--accent); padding: 25px; border-radius: 6px; box-shadow: 0 8px 20px rgba(0,0,0,0.06); border-left:1px solid var(--border); border-right:1px solid var(--border); border-bottom:1px solid var(--border); }
        .dash-card h4 { color: var(--gray); font-size: 11px; margin-bottom: 12px; font-family: var(--font-body); letter-spacing: 1px; margin-top:0; font-weight:900; }
        .dash-card .val { font-size: 28px; font-weight: 900; color: var(--text); font-family: var(--font-head); letter-spacing:1px; }
        .dash-bar-wrap { margin-bottom: 15px; }
        .dash-bar-info { display: flex; justify-content: space-between; font-size: 11px; font-weight: 900; margin-bottom: 6px; color: var(--text); letter-spacing:1px; }
        .dash-bar-bg { width: 100%; background: var(--bg); height: 8px; border-radius: 4px; overflow: hidden; border:1px solid var(--border); }
        .dash-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 1s ease-in-out; }
        .dash-msg { text-align: center; padding: 50px 20px; background: var(--card-bg); border: 2px dashed var(--border); border-radius: 8px; color: var(--gray); font-weight: 800; line-height: 1.6; font-size:12px; }
    `;
    document.head.appendChild(style);

    const viewContainer = document.querySelector('.view-container');
    if(viewContainer) {
        const mainDash = document.createElement('main');
        mainDash.id = 'dashboard-view';
        mainDash.className = 'view';
        mainDash.style.display = 'none';
        mainDash.innerHTML = `
            <div class="flex-row" style="justify-content:space-between; align-items:center; margin-bottom:25px; flex-wrap:wrap; border-bottom:1px solid var(--border); padding-bottom:15px;">
                <h3 style="font-family:var(--font-head); color:var(--text); margin:0; font-size:20px; letter-spacing:3px;">GÜNLÜK ÖZET <span style="color:var(--accent);">(DASHBOARD)</span></h3>
                <div class="flex-row">
                    <input type="date" id="dashboard-date-filter" style="width:auto; padding:10px 15px; font-size:12px; border-radius:4px; font-weight:900; background:var(--card-bg); border-color:var(--accent); color:var(--text); cursor:pointer;">
                    <button id="dashboard-refresh-btn" class="btn-blue" style="padding:11px 15px; font-size:12px; border-radius:4px;" title="Raporu Yeniden Hesapla ve Güncelle">🔄 YENİLE</button>
                </div>
            </div>
            <div id="dashboard-content"></div>
        `;
        const footer = viewContainer.querySelector('.app-footer');
        viewContainer.insertBefore(mainDash, footer);
        
        document.getElementById('dashboard-date-filter').addEventListener('change', (e) => {
            loadDashboardData(e.target.value);
        });
        
        document.getElementById('dashboard-refresh-btn').addEventListener('click', () => {
            const currentDate = document.getElementById('dashboard-date-filter').value;
            if(currentDate) loadDashboardData(currentDate, true);
        });
    }

    const adminNav = document.getElementById('admin-nav');
    if(adminNav) {
        const dashBtn = document.createElement('button');
        dashBtn.className = 'nav-btn';
        dashBtn.dataset.target = 'dashboard-view';
        dashBtn.innerHTML = 'DASHBOARD';
        
        if(adminNav.children.length >= 3) {
            adminNav.insertBefore(dashBtn, adminNav.children[3]);
        } else {
            adminNav.appendChild(dashBtn);
        }

        dashBtn.addEventListener('click', () => switchView('dashboard'));
    }
}

async function bootSystem() {
    if (expectedHash !== '' && expectedHash !== '#') {
        hideAllScreens();
        const fScreen = document.getElementById('404-screen');
        fScreen.style.display = 'flex';
        fScreen.classList.add('active');
        return;
    }

    try {
        const fetchSettings = getDoc(doc(db, "settings", "global"));
        const snap = await Promise.race([
            fetchSettings,
            new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 4000))
        ]);
        if (snap && snap.exists()) {
            companyInfo = snap.data();
            applyGlobalSettings();
        } else if (snap) {
            await setDoc(doc(db, "settings", "global"), companyInfo);
        }
    } catch(e) {}

    if (isQRMode) {
        hideAllScreens();
        const qrScreen = document.getElementById('qr-menu-app');
        qrScreen.style.display = 'flex';
        qrScreen.classList.add('active');
        listenQRCategoriesAndProducts();
        return;
    }

    const savedUserId = localStorage.getItem('twinA_uid');
    if (savedUserId) {
        try {
            const fetchUser = getDoc(doc(db, "users", savedUserId));
            const docSnap = await Promise.race([
                fetchUser,
                new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 4000))
            ]);
            if(docSnap && docSnap.exists()) {
                const data = docSnap.data();
                if(data.status !== 'passive') {
                    currentUser = { ...data, docId: docSnap.id };
                    startApp();
                    return;
                }
            }
        } catch(e) { }
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
        document.body.classList.add('has-broadcast');
    } else {
        banner.style.display = 'none';
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
}

document.getElementById('maintenance-admin-login-btn').addEventListener('click', () => {
    isMaintenanceEnforced = false;
    hideAllScreens();
    const loginScreen = document.getElementById('login-screen');
    loginScreen.style.display = 'flex';
    loginScreen.classList.add('active');
});

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
    const submitBtn = document.getElementById('login-submit-btn');

    errorBox.style.display = 'none';
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "BEKLENİYOR...";
    submitBtn.disabled = true;
    
    try {
        const performLogin = async () => {
            const q1 = query(collection(db, "users"), where("id", "==", id), where("password", "==", pass));
            let snap = await getDocs(q1);
            if (!snap.empty) return snap.docs[0];

            const q2 = query(collection(db, "users"), where("name", "==", id), where("password", "==", pass));
            snap = await getDocs(q2);
            if (!snap.empty) return snap.docs[0];

            return null;
        };

        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000));
        const userDoc = await Promise.race([performLogin(), timeout]);

        if (userDoc) {
            const data = userDoc.data();
            if(data.status === 'passive') {
                errorBox.textContent = 'HESABINIZ PASİFE ALINMIŞTIR!';
                errorBox.style.display = 'block';
            } else if(companyInfo.maintenance && data.role !== 'admin') {
                errorBox.textContent = 'SİSTEM BAKIMDA! SADECE YÖNETİCİLER GİRİŞ YAPABİLİR.';
                errorBox.style.display = 'block';
            } else {
                currentUser = { ...data, docId: userDoc.id };
                localStorage.setItem('twinA_uid', userDoc.id);
                startApp();
                return; 
            }
        } else {
            errorBox.textContent = 'HATALI İSİM/ID VEYA ŞİFRE!';
            errorBox.style.display = 'block';
        }
    } catch (error) {
        if (error.message === "timeout") {
            errorBox.textContent = 'AĞ BAĞLANTISI GECİKTİ! LÜTFEN TEKRAR TIKLAYIN.';
        } else {
            errorBox.textContent = 'BAĞLANTI HATASI!';
        }
        errorBox.style.display = 'block';
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

async function startApp() {
    hideAllScreens();
    const mainApp = document.getElementById('main-app');
    mainApp.style.display = 'flex';
    mainApp.classList.add('active');
    document.getElementById('active-user-name').textContent = currentUser.name.toUpperCase();

    if (currentUser.role === 'admin') {
        injectDashboardUI(); 
        document.getElementById('admin-nav').style.display = 'flex';
        document.getElementById('staff-nav').style.display = 'none';
        
        const dateInput = document.getElementById('history-date-filter');
        if(dateInput) {
            dateInput.value = toYYYYMMDD(getBusinessDateObj(new Date())); 
        }
    } else {
        document.getElementById('admin-nav').style.display = 'none';
        document.getElementById('staff-nav').style.display = 'flex';
    }

    try {
        const fetchTables = getDocs(collection(db, "tables"));
        const snap = await Promise.race([
            fetchTables,
            new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 4000))
        ]);
        if (snap && snap.empty) {
            const batch = writeBatch(db);
            for (let i = 1; i <= 28; i++) {
                batch.set(doc(db, "tables", `MASA ${i}`), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '' });
            }
            await batch.commit();
        }
    } catch(e){}

    switchView('tables');
    listenTables();
    listenCategories(); 
    
    if(currentUser.role === 'admin') { 
        listenStaff(); 
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
        settings: document.getElementById('settings-view'),
        'staff-settings': document.getElementById('staff-settings-view'),
        dashboard: document.getElementById('dashboard-view') 
    };

    Object.values(viewElements).forEach(v => { if(v) v.style.display = 'none'; });
    if(viewElements[viewName]) viewElements[viewName].style.display = 'block';

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.dataset.target === `${viewName}-view`) btn.classList.add('active');
    });

    if(viewName === 'finance' && currentUser && currentUser.role === 'admin') {
        const dateInput = document.getElementById('history-date-filter');
        if(dateInput && !financeUnsubOrders) {
            if(!dateInput.value) dateInput.value = toYYYYMMDD(getBusinessDateObj(new Date()));
            loadFinanceDataForDate(dateInput.value); 
        }
    }

    if(viewName === 'dashboard' && currentUser && currentUser.role === 'admin') {
        const dFilter = document.getElementById('dashboard-date-filter');
        if(dFilter && !dFilter.value) {
            dFilter.value = toYYYYMMDD(getBusinessDateObj(new Date()));
        }
        loadDashboardData(dFilter.value);
    }
}

async function loadDashboardData(isoDateStr, forceRefresh = false) {
    const content = document.getElementById('dashboard-content');
    if(!content) return;
    content.innerHTML = '<div class="dash-msg">Veriler yükleniyor...</div>';

    const [y, m, d] = isoDateStr.split('-');
    const targetDateStr = `${d}.${m}.${y}`;
    
    const todayStr = getBusinessDateStr(new Date());
    if (targetDateStr === todayStr && !forceRefresh) {
        content.innerHTML = `
            <div class="dash-msg" style="border-color: var(--accent);">
                <h3 style="color:var(--accent); margin-bottom:10px; font-family:var(--font-head); font-size:18px;">BUGÜNÜN VERİLERİ BEKLENİYOR</h3>
                Bu işletme gününe ait veriler henüz kalıcı olarak derlenmemiştir.<br>
                Güncel canlı durumu <b>Kasa & Geçmiş</b> bölümünden takip edebilirsiniz.<br><br>
                <span style="font-size:11px;">(Bugünün detaylı istatistikleri gece kapanış saatinde otomatik analiz edilip sadece tek bir veriye dönüştürülecek ve bu ekrana sabitlenecektir.)</span>
            </div>`;
        return;
    }

    const reportRef = doc(db, "daily_reports", targetDateStr);
    try {
        const reportSnap = await getDoc(reportRef);
        if (reportSnap.exists() && !forceRefresh) {
            renderDashboard(reportSnap.data(), targetDateStr);
        } else {
            content.innerHTML = '<div class="dash-msg">Veriler okunup sıfırdan analiz ediliyor, lütfen bekleyin... (Bu işlem bir güne özel tek seferliktir)</div>';
            
            const closeParts = (companyInfo.close || "00:00").split(':');
            const cH = parseInt(closeParts[0], 10);
            const cM = parseInt(closeParts[1], 10);

            const startDate = new Date(parseInt(y), parseInt(m)-1, parseInt(d), cH, cM, 0);
            const endDate = new Date(startDate.getTime());
            endDate.setDate(endDate.getDate() + 1);

            const startIso = startDate.toISOString();
            const endIso = endDate.toISOString();

            const qOrders = query(collection(db, "orders"), where("createdAt", ">=", startIso), where("createdAt", "<", endIso));
            const orderSnaps = await getDocs(qOrders);
            
            const qExpenses = query(collection(db, "expenses"), where("time", ">=", startIso), where("time", "<", endIso));
            const expSnaps = await getDocs(qExpenses);

            let totalIncome = 0; let totalDiscount = 0; let tableCount = 0;
            let itemCounts = {}; let waiterTotals = {}; 
            let payMethods = { "Nakit": 0, "Kredi Kartı": 0, "Yemek Kartı": 0 };
            let totalExp = 0;

            orderSnaps.forEach(docSnap => {
                const o = docSnap.data();
                if(o.status !== 'closed') return;
                
                tableCount++;
                
                const appliedDiscount = parseFloat(o.discountAmount) || 0;
                
                totalIncome += (parseFloat(o.total) || 0) - appliedDiscount;
                totalDiscount += appliedDiscount;

                (o.items || []).forEach(item => {
                    if(!item.deleted) {
                        if(!itemCounts[item.name]) itemCounts[item.name] = { qty: 0, rev: 0 };
                        itemCounts[item.name].qty++;
                        itemCounts[item.name].rev += (parseFloat(item.price) || 0);

                        if(!waiterTotals[item.waiter]) waiterTotals[item.waiter] = { itemsAdded: 0, collected: 0 };
                        waiterTotals[item.waiter].itemsAdded++;
                    }
                });

                (o.partialPayments || []).forEach(p => {
                    if(payMethods[p.method] !== undefined) payMethods[p.method] += (parseFloat(p.amount) || 0);
                    if(!waiterTotals[p.user]) waiterTotals[p.user] = { itemsAdded: 0, collected: 0 };
                    waiterTotals[p.user].collected += (parseFloat(p.amount) || 0);
                });
            });

            expSnaps.forEach(docSnap => {
                totalExp += docSnap.data().amount;
            });

            const topProducts = Object.keys(itemCounts)
                .map(k => ({ name: k, ...itemCounts[k] }))
                .sort((a, b) => b.qty - a.qty);

            const staffPerformances = Object.keys(waiterTotals)
                .map(k => ({ name: k, ...waiterTotals[k] }))
                .sort((a, b) => b.collected - a.collected);

            const netKasa = totalIncome - totalExp;
            const avgTicket = tableCount > 0 ? (totalIncome / tableCount) : 0;

            const reportData = {
                date: targetDateStr,
                compiledAt: new Date().toISOString(),
                totalIncome,
                totalExp,
                netKasa,
                totalDiscount,
                tableCount,
                avgTicket,
                topProducts,
                staffPerformances,
                payMethods
            };

            await setDoc(reportRef, reportData);
            renderDashboard(reportData, targetDateStr);
        }
    } catch (error) {
        console.error(error);
        content.innerHTML = '<div class="dash-msg" style="color:var(--red); border-color:var(--red);">Veriler yüklenirken bir hata oluştu!</div>';
    }
}

function renderDashboard(data, dateStr) {
    const content = document.getElementById('dashboard-content');
    
    let productsHtml = '';
    if (data.topProducts.length > 0) {
        const maxQty = data.topProducts[0].qty;
        data.topProducts.forEach(p => {
            const pct = (p.qty / maxQty) * 100;
            productsHtml += `
                <div class="dash-bar-wrap">
                    <div class="dash-bar-info"><span>${p.name} (${p.qty} Adet)</span> <span style="color:var(--accent);">${p.rev.toFixed(2)} ₺</span></div>
                    <div class="dash-bar-bg"><div class="dash-bar-fill" style="width: ${pct}%"></div></div>
                </div>
            `;
        });
    } else {
        productsHtml = '<div style="font-size:11px; color:var(--gray);">Bu güne ait satış bulunamadı.</div>';
    }

    let staffHtml = '';
    if (data.staffPerformances.length > 0) {
        data.staffPerformances.forEach((s) => {
            staffHtml += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--border);">
                    <strong style="font-size:12px; color:var(--text);">${s.name}</strong>
                    <div style="text-align:right; font-size:10px;">
                        <span style="color:var(--gray);">Tahsilat:</span> <b style="color:var(--accent);">${s.collected.toFixed(2)} ₺</b><br>
                        <span style="color:var(--gray); font-size:9px;">İşlenen Ürün: ${s.itemsAdded} Adet</span>
                    </div>
                </div>
            `;
        });
    } else {
        staffHtml = '<div style="font-size:11px; color:var(--gray);">Personel kaydı yok.</div>';
    }

    content.innerHTML = `
        <div class="dash-grid">
            <div class="dash-card">
                <h4>NET KASA (CİRO - MASRAF)</h4>
                <div class="val" style="color:var(--green);">${data.netKasa.toFixed(2)} ₺</div>
                <div style="font-size:11px; color:var(--gray); margin-top:8px; font-weight:800; letter-spacing:1px;">
                    CİRO: <span style="color:var(--text);">${data.totalIncome.toFixed(2)} ₺</span> | MASRAF: <span style="color:var(--red);">${data.totalExp.toFixed(2)} ₺</span>
                </div>
            </div>
            <div class="dash-card">
                <h4>TOPLAM HİZMET & SEPET ORTALAMASI</h4>
                <div class="val">${data.tableCount} <span style="font-size:12px; color:var(--gray);">MASA HİZMETİ</span></div>
                <div style="font-size:11px; color:var(--gray); margin-top:8px; font-weight:800; letter-spacing:1px;">
                    MASA BAŞI ORTALAMA HARCAMA: <span style="color:var(--accent);">${data.avgTicket.toFixed(2)} ₺</span>
                </div>
            </div>
        </div>

        <div class="dash-grid">
            <div class="dash-card">
                <h4 style="color:var(--accent); border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:15px;">TÜM ÜRÜNLER (ÇOK SATANDAN AZA)</h4>
                <div style="max-height: 350px; overflow-y: auto; padding-right: 5px;">${productsHtml}</div>
            </div>
            <div class="dash-card">
                <h4 style="color:var(--blue); border-bottom:1px solid var(--border); padding-bottom:10px; margin-bottom:15px;">PERSONEL LİDERLİK TABLOSU</h4>
                <div style="max-height: 350px; overflow-y: auto; padding-right: 5px;">${staffHtml}</div>
            </div>
        </div>

        <div class="dash-grid">
            <div class="dash-card" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;">
                <div>
                    <h4>TAHSİLAT TİPLERİ</h4>
                    <div style="font-size:12px; font-weight:800; color:var(--gray); line-height:1.6;">
                        NAKİT: <b style="color:var(--text);">${data.payMethods['Nakit'].toFixed(2)} ₺</b><br>
                        K.KARTI: <b style="color:var(--text);">${data.payMethods['Kredi Kartı'].toFixed(2)} ₺</b><br>
                        Y.KARTI: <b style="color:var(--text);">${data.payMethods['Yemek Kartı'].toFixed(2)} ₺</b>
                    </div>
                </div>
                <div style="text-align:right;">
                    <h4 style="color:var(--red);">TOPLAM UYGULANAN İSKONTO/İKRAM</h4>
                    <div class="val" style="color:var(--red);">- ${(Number(data.totalDiscount) || 0).toFixed(2)} ₺</div>
                </div>
            </div>
        </div>
        <div style="text-align:right; font-size:9px; color:var(--gray); font-weight:bold; margin-top:10px; letter-spacing:1px;">
            SON DERLENME ZAMANI: ${new Date(data.compiledAt).toLocaleString('tr-TR')}
        </div>
    `;
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
        const batch = writeBatch(db);
        for(let i = currentCount + 1; i <= targetCount; i++) {
            batch.set(doc(db, "tables", `MASA ${i}`), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '', reservedColor: null, timestamp: null });
        }
        await batch.commit();
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
        const batch = writeBatch(db);
        for(let i = targetCount + 1; i <= currentCount; i++) {
            batch.delete(doc(db, "tables", `MASA ${i}`));
        }
        await batch.commit();
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
        try {
            const targetId = data['target-table-select'];
            if(!targetId) return;

            const targetData = tableDataStore[targetId];
            const orderData = currentOrderData;
            
            if(!targetData || !orderData) return;

            const batch = writeBatch(db);

            if(targetData.status === 'empty') {
                batch.update(doc(db, "orders", currentOrderDocId), { 
                    tableId: targetId, 
                    logs: [...(orderData.logs||[]), createLog("Masa Taşındı", `${currentTableId} -> ${targetId}`)] 
                });
                batch.update(doc(db, "tables", targetId), { 
                    status: 'active', currentOrderId: currentOrderDocId, totalAmount: orderData.total, paidAmount: orderData.paid, timestamp: new Date().toISOString() 
                });
                batch.update(doc(db, "tables", currentTableId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, timestamp: null });
                
                currentOrderDocId = null;
                currentOrderData = null;
                switchView('tables');

                await batch.commit();
                showModal('BAŞARILI', 'Masa başarıyla taşındı.', '', null, true);

            } else if (targetData.status === 'active') {
                const targetOrderSnap = await getDoc(doc(db, "orders", targetData.currentOrderId));
                const targetOrderData = targetOrderSnap.data();
                
                const mergedItems = [...(targetOrderData.items||[]), ...(orderData.items||[])];
                const mergedPayments = [...(targetOrderData.partialPayments||[]), ...(orderData.partialPayments||[])];
                const mergedLogs = [...(targetOrderData.logs||[]), ...(orderData.logs||[]), createLog("Adisyon Birleştirildi", `${currentTableId} hesabı bu masaya aktarıldı.`)];
                const mergedTotal = (targetOrderData.total||0) + (orderData.total||0);
                const mergedPaid = (targetOrderData.paid||0) + (orderData.paid||0);

                batch.update(doc(db, "orders", targetData.currentOrderId), {
                    items: mergedItems, partialPayments: mergedPayments, total: mergedTotal, paid: mergedPaid, logs: mergedLogs
                });
                batch.update(doc(db, "tables", targetId), { totalAmount: mergedTotal, paidAmount: mergedPaid });
                
                batch.update(doc(db, "orders", currentOrderDocId), { status: 'merged_deleted' });
                batch.update(doc(db, "tables", currentTableId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, timestamp: null });

                currentOrderDocId = null;
                currentOrderData = null;
                switchView('tables');

                await batch.commit();
                showModal('BAŞARILI', 'Adisyonlar başarıyla birleştirildi.', '', null, true);
            }
        } catch(err) {
            showModal('HATA', 'Taşıma işlemi başarısız: ' + err.message, '', null, true);
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
            createNewOrder(tableName);
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
            createNewOrder(tableName);
        };
        document.getElementById('mod-cancel-res').onclick = async () => {
            closeModal();
            await updateDoc(doc(db, "tables", tableName), { status: 'empty', reservedName: '', reservedColor: null, timestamp: null });
        };
    } else if (tableData.status === 'active') {
        openOrderView(tableName, tableData.currentOrderId);
    }
}

function createNewOrder(tableName) {
    const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
    const orderRef = doc(db, "orders", orderId);
    const ts = new Date().toISOString();
    
    const newOrderData = {
        tableId: tableName, status: 'open', items: [], partialPayments: [], paid: 0, total: 0, 
        createdAt: ts, creator: currentUser.name, logs: [createLog("Masa Açıldı", `${tableName} siparişe açıldı.`)]
    };

    currentOrderDocId = orderId;
    currentTableId = tableName;
    currentOrderData = newOrderData;

    const batch = writeBatch(db);
    batch.set(orderRef, newOrderData);
    batch.update(doc(db, "tables", tableName), { status: 'active', currentOrderId: orderId, reservedName: '', totalAmount: 0, paidAmount: 0, timestamp: ts });
    batch.commit().catch(()=>{});

    openOrderView(tableName, orderId);
}

function openOrderView(tableName, orderId) {
    document.getElementById('current-table-name').textContent = tableName;
    document.getElementById('current-order-id').textContent = "ID: " + orderId;
    currentOrderDocId = orderId;

    document.getElementById('adisyon-items').innerHTML = '';
    document.getElementById('payment-logs').innerHTML = '';
    document.getElementById('adisyon-subtotal').textContent = '0 ₺';
    document.getElementById('adisyon-total').textContent = '0 ₺';

    switchView('order');
    listenOrderData(orderId);
}

document.getElementById('back-to-tables').addEventListener('click', () => {
    currentOrderDocId = null;
    currentOrderData = null;
    if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; } 

    document.getElementById('adisyon-items').innerHTML = '';
    document.getElementById('payment-logs').innerHTML = '';
    document.getElementById('adisyon-subtotal').textContent = '0 ₺';
    document.getElementById('adisyon-total').textContent = '0 ₺';

    switchView('tables');
});

function listenCategories() {
    if(window.unsubCats) window.unsubCats();
    window.unsubCats = onSnapshot(collection(db, "categories"), (snapshot) => {
        globalCategoriesList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        globalCategoriesList.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));
        renderCategoriesUI();
    });
    globalUnsubscribes.push(window.unsubCats);
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
    
    if(!window.unsubProds) listenProducts();
    else renderProductsUI();
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
        const batch = writeBatch(db);
        snap.forEach((d) => {
            batch.update(doc(db, "products", d.id), { cat: newName });
        });
        await batch.commit();
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

function listenProducts() {
    if(window.unsubProds) window.unsubProds();
    window.unsubProds = onSnapshot(collection(db, "products"), (snapshot) => {
        globalProductsList = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        renderProductsUI();
    });
    globalUnsubscribes.push(window.unsubProds);
}

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

        const isStock = p.stock !== false; 

        if(container && p.cat === currentCategory) {
            const div = document.createElement('div');
            div.className = `product-card ${!isStock ? 'out-of-stock' : ''}`;
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
            if(isStock) div.addEventListener('click', () => addItemToOrder(p));
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
                const isStock = p.stock !== false; 
                divA.className = `admin-list-item`;
                
                let attrHtml = '';
                if(p.desc) attrHtml += `İçerik: ${p.desc} | `;
                if(p.cal) attrHtml += `Kalori: ${p.cal} | `;
                if(p.allergen) attrHtml += `Alerjen: ${p.allergen} | `;
                
                let safeName = p.name.replace(/'/g, "\\'");
                let safeDesc = p.desc ? p.desc.replace(/'/g, "\\'") : '';
                
                divA.innerHTML = `
                    <div class="info" style="${!isStock ? 'opacity:0.5; filter:grayscale(1);' : ''}">
                        <strong>${p.name} ${!isStock ? '<span style="color:var(--red); font-size:10px;">(TÜKENDİ)</span>' : ''}</strong>
                        <div style="font-size:11px; color:var(--gray); margin-bottom:5px;">
                            ${attrHtml} ${p.vegan ? '<span style="color:var(--green); font-weight:900;">VEGAN</span>' : ''}
                        </div>
                        <span style="color:var(--gray); font-size:12px; font-weight:900; letter-spacing:1px;">FİYAT: <span style="color:var(--accent);">${p.price} ₺</span> | SIRA: <span style="color:var(--accent);">${p.order !== "" && p.order !== undefined ? p.order : 'Yok'}</span></span>
                    </div>
                    <div class="admin-actions">
                        <button class="action-btn ${isStock ? 'btn-cancel' : 'btn-confirm'}" onclick="toggleStock('${p.id}', ${!isStock})">${isStock ? 'TÜKENDİ YAP' : 'SATIŞA AÇ'}</button>
                        <button class="action-btn btn-blue" onclick="editProduct('${p.id}', '${safeName}', ${p.price}, '${safeDesc}', '${p.cal || ''}', '${p.allergen || ''}', '${p.cat}', ${p.vegan}, '${p.order !== undefined ? p.order : ''}', ${isStock})">DÜZENLE</button>
                        <button class="action-btn btn-red" onclick="deleteProduct('${p.id}')">SİL</button>
                    </div>
                `;
                adminContainer.appendChild(divA);
            });
        });
    }
}

window.toggleStock = (id, state) => { 
    updateDoc(doc(db, "products", id), { stock: state }).catch(()=>{}); 
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

function renderAdisyon(o) {
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
                    <button type="button" class="note-item-btn" onclick="addNoteToItem('${currentOrderDocId}', ${g.indices[0]}, '${g.note || ''}')">NOT</button>
                    <button type="button" class="del-item-btn" onclick="deleteOrderItem(${g.indices[g.indices.length - 1]})">✖</button>
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
}

function listenOrderData(orderId) {
    if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; }
    
    if (!currentOrderData || currentOrderData.tableId !== currentTableId) {
        currentOrderData = { items: [], partialPayments: [], paid: 0, total: 0, logs: [] };
    }
    renderAdisyon(currentOrderData);

    liveOrderUnsubscribe = onSnapshot(doc(db, "orders", orderId), (docSnap) => {
        if (currentOrderDocId !== orderId) return; 
        if(docSnap.exists()) {
            currentOrderData = docSnap.data();
            renderAdisyon(currentOrderData);
        }
    });
}

window.addItemToOrder = function(product) {
    if(!currentOrderDocId) return;
    if(!currentOrderData) currentOrderData = { items: [], partialPayments: [], paid: 0, total: 0, logs: [] };
    
    const items = currentOrderData.items || [];
    const logs = currentOrderData.logs || [];
    let currentTotal = currentOrderData.total || 0;

    items.push({ name: product.name, price: product.price, waiter: currentUser.name, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}) });
    logs.push(createLog("ÜRÜN EKLENDİ", `1x ${product.name} eklendi.`));
    currentTotal += product.price;

    currentOrderData.items = items;
    currentOrderData.logs = logs;
    currentOrderData.total = currentTotal;

    renderAdisyon(currentOrderData);

    const batch = writeBatch(db);
    batch.update(doc(db, "orders", currentOrderDocId), { items: items, logs: logs, total: currentTotal });
    batch.update(doc(db, "tables", currentTableId), { totalAmount: currentTotal });
    batch.commit().catch(()=>{});
};

window.deleteOrderItem = function(index) {
    if(!currentOrderDocId || !currentOrderData) return;
    
    const items = currentOrderData.items || [];
    const logs = currentOrderData.logs || [];
    let currentTotal = currentOrderData.total || 0;

    if(items[index] && !items[index].deleted) {
        items[index].deleted = true;
        items[index].deletedBy = currentUser.name;
        
        currentTotal -= items[index].price;
        logs.push(createLog("ÜRÜN İPTALİ", `1x ${items[index].name} listeden çıkarıldı.`));
        
        currentOrderData.items = items;
        currentOrderData.logs = logs;
        currentOrderData.total = currentTotal;
        
        renderAdisyon(currentOrderData);

        const batch = writeBatch(db);
        batch.update(doc(db, "orders", currentOrderDocId), { items: items, logs: logs, total: currentTotal });
        batch.update(doc(db, "tables", currentTableId), { totalAmount: currentTotal });
        batch.commit().catch(()=>{});
    }
};

window.addNoteToItem = function(orderId, index, currentNote) {
    showModal('ÜRÜNE NOT EKLE', 'Siparişe özel not giriniz (Örn: Şekersiz, Ketçapsız vb.):', `
        <input type="text" id="item-note" value="${currentNote}" placeholder="Notunuz...">
    `, (data) => {
        if(!currentOrderData) return;
        const items = currentOrderData.items || [];
        if(items[index]) {
            items[index].note = data['item-note'];
            
            currentOrderData.items = items;
            renderAdisyon(currentOrderData);
            
            updateDoc(doc(db, "orders", orderId), { items: items }).catch(()=>{});
        }
    });
};

document.getElementById('partial-pay-btn').addEventListener('click', () => {
    if(!currentOrderDocId || !currentOrderData) return;
    showModal('KISMİ ÖDEME', 'ALINACAK TUTARI VE YÖNTEMİ SEÇİNİZ:', `
        <input type="number" id="pay-amt" placeholder="Tutar (₺)">
        <select id="pay-method">
            <option value="Kredi Kartı">Kredi Kartı</option>
            <option value="Nakit">Nakit</option>
            <option value="Yemek Kartı">Yemek Kartı</option>
        </select>
    `, (data) => {
        const amt = Number(data['pay-amt']);
        const method = data['pay-method'];
        if(amt > 0) {
            const pays = currentOrderData.partialPayments || [];
            const logs = currentOrderData.logs || [];
            
            const newPaid = (currentOrderData.paid || 0) + amt;
            
            pays.push({ amount: amt, method: method, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}), user: currentUser.name });
            logs.push(createLog("ÖDEME ALINDI", `${method} ile tahsilat yapıldı: ${amt} ₺`));
            
            currentOrderData.paid = newPaid;
            currentOrderData.partialPayments = pays;
            currentOrderData.logs = logs;
            renderAdisyon(currentOrderData);

            const batch = writeBatch(db);
            batch.update(doc(db, "orders", currentOrderDocId), { partialPayments: pays, paid: newPaid, logs: logs });
            batch.update(doc(db, "tables", currentTableId), { paidAmount: newPaid });
            batch.commit().catch(()=>{});
            
            showModal('BAŞARILI', 'Kısmi ödeme kaydedildi.', '', null, true);
        }
    });
});

document.getElementById('item-pay-btn').addEventListener('click', () => {
    if(!currentOrderDocId || !currentOrderData) return;
    
    const items = currentOrderData.items || [];
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
            <option value="Kredi Kartı">Kredi Kartı</option>
            <option value="Nakit">Nakit</option>
            <option value="Yemek Kartı">Yemek Kartı</option>
        </select>
    `;

    showModal('ÜRÜN BAZLI ÖDEME', 'Ödenecek ürünleri seçiniz:', checklistHtml, (data) => {
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
            const pays = currentOrderData.partialPayments || [];
            const logs = currentOrderData.logs || [];
            let freshItems = currentOrderData.items || [];
            
            selectedIndices.forEach(idx => {
                freshItems[idx].paid = true;
            });
            
            const newPaid = (currentOrderData.paid || 0) + totalToPay;
            
            pays.push({ amount: totalToPay, method: method, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}), user: currentUser.name });
            logs.push(createLog("ÜRÜN BAZLI ÖDEME", `${method} ile tahsil edildi: ${totalToPay} ₺ (${itemNames.join(', ')})`));
            
            currentOrderData.items = freshItems;
            currentOrderData.paid = newPaid;
            currentOrderData.partialPayments = pays;
            currentOrderData.logs = logs;
            renderAdisyon(currentOrderData);

            const batch = writeBatch(db);
            batch.update(doc(db, "orders", currentOrderDocId), { items: freshItems, partialPayments: pays, paid: newPaid, logs: logs });
            batch.update(doc(db, "tables", currentTableId), { paidAmount: newPaid });
            batch.commit().catch(()=>{});
            
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

document.getElementById('close-table-btn').addEventListener('click', () => {
    if(!currentOrderDocId || !currentOrderData) return;
    
    const oId = currentOrderDocId;
    const tId = currentTableId;
    const d = currentOrderData;
    const remaining = (d.total || 0) - (d.paid || 0);

    if(remaining > 0) {
        showModal('MASAYI KAPAT', `KALAN HESAP: <b style="color:var(--accent); font-size:18px;" id="modal-rem-total">${remaining} ₺</b><br><br>TAHSİLAT BİLGİLERİ:`, `
            <div style="margin-bottom: 15px; text-align: left;">
                <label style="font-size:11px; font-weight:900; color:var(--text); letter-spacing:1px;">İSKONTO YÜZDESİ (%):</label>
                <input type="number" id="discount-percent" placeholder="Örn: 10 (İndirim yoksa boş bırakın)" min="0" max="100" style="margin-top: 6px; padding: 12px; font-size:14px;">
            </div>
            <select id="pay-method-full" style="padding: 12px; font-size:14px;">
                <option value="Kredi Kartı">Kredi Kartı</option>
                <option value="Nakit">Nakit</option>
                <option value="Yemek Kartı">Yemek Kartı</option>
            </select>
        `, (data) => {
            const method = data['pay-method-full'];
            const discPercent = parseFloat(data['discount-percent']) || 0;
            
            let discountAmount = 0;
            let finalRemaining = remaining;
            const pays = d.partialPayments || [];
            const logs = d.logs || [];

            if(discPercent > 0) {
                discountAmount = (remaining * discPercent) / 100;
                finalRemaining = remaining - discountAmount;
                logs.push(createLog("İSKONTO UYGULANDI", `%${discPercent} oranında (${discountAmount.toFixed(2)} ₺) indirim yapıldı.`));
            }

            if(finalRemaining > 0) {
                pays.push({ amount: finalRemaining, method: method, time: new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'}), user: currentUser.name, note: "Kapanış" });
                logs.push(createLog("HESAP KAPATILDI", `Kalan ${finalRemaining.toFixed(2)} ₺ ${method} ile tahsil edilerek masa kapatıldı.`));
            } else {
                logs.push(createLog("HESAP KAPATILDI", `Tutarın tamamı (%100) iskonto edildiği için tahsilat alınmadı.`));
            }
            
            currentOrderDocId = null;
            currentOrderData = null;
            if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; }
            
            document.getElementById('adisyon-items').innerHTML = '';
            document.getElementById('payment-logs').innerHTML = '';
            document.getElementById('adisyon-subtotal').textContent = '0 ₺';
            document.getElementById('adisyon-total').textContent = '0 ₺';

            switchView('tables');
            showModal('BAŞARILI', 'Hesap tahsil edildi ve masa kapatıldı.', '', null, true);

            const batch = writeBatch(db);
            batch.update(doc(db, "orders", oId), { 
                partialPayments: pays, 
                paid: d.paid + finalRemaining, 
                discountPercent: discPercent,
                discountAmount: discountAmount,
                logs: logs, 
                status: 'closed', 
                closedAt: new Date().toISOString() 
            });
            batch.update(doc(db, "tables", tId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '', reservedColor: null, timestamp: null });
            batch.commit().catch(()=>{});
        });

        setTimeout(() => {
            const discInput = document.getElementById('discount-percent');
            const remTotal = document.getElementById('modal-rem-total');
            if(discInput && remTotal) {
                discInput.addEventListener('input', (e) => {
                    let val = parseFloat(e.target.value) || 0;
                    if(val < 0) val = 0;
                    if(val > 100) val = 100;
                    const newTotal = remaining - ((remaining * val) / 100);
                    remTotal.textContent = `${newTotal.toFixed(2)} ₺`;
                });
            }
        }, 100);

    } else {
        showModal('MASAYI KAPAT', 'AÇIK HESAP BULUNMUYOR. MASA BOŞALTILACAKTIR. ONAYLIYOR MUSUNUZ?', '', () => {
            const logs = d.logs || [];
            logs.push(createLog("MASA KAPATILDI", `Açık hesap olmadan masa boşaltıldı.`));
            
            currentOrderDocId = null;
            currentOrderData = null;
            if(liveOrderUnsubscribe) { liveOrderUnsubscribe(); liveOrderUnsubscribe = null; }
            
            document.getElementById('adisyon-items').innerHTML = '';
            document.getElementById('payment-logs').innerHTML = '';
            document.getElementById('adisyon-subtotal').textContent = '0 ₺';
            document.getElementById('adisyon-total').textContent = '0 ₺';

            switchView('tables');
            showModal('BAŞARILI', 'Masa boşaltıldı.', '', null, true);

            const batch = writeBatch(db);
            batch.update(doc(db, "orders", oId), { status: 'closed', logs: logs, closedAt: new Date().toISOString() });
            batch.update(doc(db, "tables", tId), { status: 'empty', currentOrderId: null, totalAmount: 0, paidAmount: 0, reservedName: '', reservedColor: null, timestamp: null });
            batch.commit().catch(()=>{});
        });
    }
});

document.getElementById('print-order-btn').addEventListener('click', () => {
    if(!currentOrderData) return;
    const o = currentOrderData;
    
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
    showModal('ŞİFRE SIFIRLA', 'YENİ ŞİFREYİ GİRİNİZ:', '<input type="text" id="new-p">', (d) => {
        if(d['new-p']) {
            updateDoc(doc(db, "users", id), { password: d['new-p'] }).then(()=>{
                showModal('BAŞARILI', 'Şifre sıfırlandı.', '', null, true);
            });
        }
    });
};
window.toggleStaffRole = (id, currentRole) => {
    updateDoc(doc(db, "users", id), { role: currentRole === 'admin' ? 'waiter' : 'admin' }).catch(()=>{});
};
window.toggleStaffStatus = (id, currentStatus) => {
    updateDoc(doc(db, "users", id), { status: currentStatus === 'passive' ? 'active' : 'passive' }).catch(()=>{});
};
window.deleteStaff = (id) => {
    showModal('PERSONELİ SİL', 'BU PERSONELİ SİSTEMDEN KALICI OLARAK SİLMEK İSTEDİĞİNİZE EMİN MİSİNİZ?', '', () => {
        deleteDoc(doc(db, "users", id)).then(()=>{
            showModal('BAŞARILI', 'Personel silindi.', '', null, true);
        });
    });
};

document.getElementById('update-staff-pass-btn').addEventListener('click', () => {
    const oldP = document.getElementById('staff-old-pass').value.trim();
    const newP = document.getElementById('staff-new-pass').value.trim();
    
    if(!oldP || !newP) return;

    if(oldP !== currentUser.password) {
        showModal('HATA', 'MEVCUT ŞİFRENİZİ YANLIŞ GİRDİNİZ!', '', null, true);
        return;
    }

    updateDoc(doc(db, "users", currentUser.docId), { password: newP }).then(()=>{
        currentUser.password = newP;
        showModal('BAŞARILI', 'ŞİFRENİZ GÜNCELLENDİ.', '', null, true);
        document.getElementById('staff-old-pass').value = '';
        document.getElementById('staff-new-pass').value = '';
    });
});

document.getElementById('update-credentials-btn').addEventListener('click', () => {
    const id = document.getElementById('admin-new-id').value.trim() || currentUser.id;
    const pass = document.getElementById('admin-new-pass').value.trim() || currentUser.password;
    updateDoc(doc(db, "users", currentUser.docId), { id: id, password: pass }).then(()=>{
        showModal('BAŞARILI', 'GİRİŞ BİLGİLERİNİZ GÜNCELLENDİ.', '', null, true);
    });
});

document.getElementById('update-company-btn').addEventListener('click', () => {
    const newSettings = {
        name: document.getElementById('company-name').value,
        phone: document.getElementById('company-phone').value,
        address: document.getElementById('company-address').value,
        open: document.getElementById('company-open').value,
        close: document.getElementById('company-close').value
    };
    updateDoc(doc(db, "settings", "global"), newSettings).then(()=>{
        companyInfo = { ...companyInfo, ...newSettings };
        applyGlobalSettings();
        showModal('BAŞARILI', 'AYARLAR KAYDEDİLDİ.', '', null, true);
    });
});

document.getElementById('toggle-maintenance-btn').addEventListener('click', () => {
    const nextState = !companyInfo.maintenance;
    updateDoc(doc(db, "settings", "global"), { maintenance: nextState }).then(()=>{
        companyInfo.maintenance = nextState;
        applyGlobalSettings();
    });
});

document.getElementById('send-broadcast-btn').addEventListener('click', () => {
    const msg = document.getElementById('broadcast-msg').value;
    updateDoc(doc(db, "settings", "global"), { broadcast: msg }).then(()=>{
        companyInfo.broadcast = msg;
        applyGlobalSettings();
    });
});
document.getElementById('clear-broadcast-btn').addEventListener('click', () => {
    document.getElementById('broadcast-msg').value = '';
    updateDoc(doc(db, "settings", "global"), { broadcast: "" }).then(()=>{
        companyInfo.broadcast = "";
        applyGlobalSettings();
    });
});

function loadFinanceDataForDate(isoDateStr) {
    if(!isoDateStr) return;
    if(financeUnsubOrders) { financeUnsubOrders(); financeUnsubOrders = null; }
    if(financeUnsubExpenses) { financeUnsubExpenses(); financeUnsubExpenses = null; }

    const [y, m, d] = isoDateStr.split('-');
    const closeParts = (companyInfo.close || "00:00").split(':');
    const cH = parseInt(closeParts[0], 10);
    const cM = parseInt(closeParts[1], 10);

    const startDate = new Date(parseInt(y), parseInt(m)-1, parseInt(d), cH, cM, 0);
    const endDate = new Date(startDate.getTime());
    endDate.setDate(endDate.getDate() + 1);

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    const qOrders = query(collection(db, "orders"), where("createdAt", ">=", startIso), where("createdAt", "<", endIso));
    financeUnsubOrders = onSnapshot(qOrders, (snapshot) => {
        globalOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(o => o.status === 'closed');
        renderFinanceTotals();
        renderFinanceHistoryList();
    });
    globalUnsubscribes.push(() => { if(financeUnsubOrders) financeUnsubOrders(); });

    const qExp = query(collection(db, "expenses"), where("time", ">=", startIso), where("time", "<", endIso));
    financeUnsubExpenses = onSnapshot(qExp, (snapshot) => {
        globalExpenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFinanceTotals();
        renderFinanceHistoryList();
    });
    globalUnsubscribes.push(() => { if(financeUnsubExpenses) financeUnsubExpenses(); });
}

document.getElementById('history-date-filter')?.addEventListener('change', (e) => {
    loadFinanceDataForDate(e.target.value);
});

function renderFinanceTotals() {
    const filterInput = document.getElementById('history-date-filter').value;
    if(!filterInput) return;
    
    const [y, m, d] = filterInput.split('-');
    const targetDateStr = `${d}.${m}.${y}`;

    let todayIncome = 0;
    let todayExpense = 0;
    let tNak = 0; let tKK = 0; let tYK = 0;

    globalOrders.forEach(o => {
        const formatClosed = getBusinessDateStr(o.createdAt || o.closedAt);
        
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
        const formatExp = getBusinessDateStr(e.time);
        
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
        const formatExp = getBusinessDateStr(e.time);

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
        const formatClosed = getBusinessDateStr(o.createdAt || o.closedAt);
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

        const isDiscounted = o.discountAmount > 0;
        const discountText = isDiscounted ? `<span style="font-size:10px; color:var(--red); font-weight:900; margin-right:8px; border:1px solid var(--red); padding:2px 6px; border-radius:4px;">%${o.discountPercent} İSKONTO</span>` : '';
        const finalTot = o.total - (o.discountAmount || 0);

        historyContainer.innerHTML += `
            <div class="history-item">
                <div class="history-header" onclick="this.parentElement.classList.toggle('open')">
                    <span>${o.tableId} | SAAT: ${new Date(o.closedAt).toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}</span>
                    <div style="display:flex; align-items:center;">
                        ${discountText}
                        <span style="color:var(--accent); font-weight:900; font-size:14px; font-family:var(--font-head);">${finalTot.toFixed(2)} ₺</span>
                    </div>
                </div>
                <div class="history-body">${logHtml || 'Kayıt yok.'}</div>
            </div>
        `;
    });

    if(filteredOrders.length === 0) {
        historyContainer.innerHTML = '<p style="color:var(--gray); padding:15px; font-weight:bold; font-size:11px;">Bu tarihe ait sipariş kaydı bulunamadı.</p>';
    }
}

document.getElementById('z-report-btn').addEventListener('click', () => {
    const filterInput = document.getElementById('history-date-filter').value || toYYYYMMDD(getBusinessDateObj(new Date()));
    const [y, m, d] = filterInput.split('-');
    const reportDisplayDate = `${d}.${m}.${y}`;

    let totalNakit = 0; let totalKK = 0; let totalYK = 0;
    let userTotals = {}; let dailyExpenses = 0; let totalDiscount = 0;

    globalOrders.forEach(o => {
        const formatClosed = getBusinessDateStr(o.createdAt || o.closedAt);

        if(formatClosed === reportDisplayDate) {
            if(o.discountAmount) totalDiscount += o.discountAmount;

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
        const formatExp = getBusinessDateStr(e.time);
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
            <div class="print-flex print-bold"><span>NAKİT:</span><span>${totalNakit.toFixed(2)} TL</span></div>
            <div class="print-flex print-bold"><span>KREDİ KARTI:</span><span>${totalKK.toFixed(2)} TL</span></div>
            <div class="print-flex print-bold"><span>YEMEK KARTI:</span><span>${totalYK.toFixed(2)} TL</span></div>
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size:14px;"><span>GÜNLÜK CİRO:</span><span>${ciro.toFixed(2)} TL</span></div>
            <div class="print-flex print-bold" style="color:var(--gray);"><span>UYGULANAN İSKONTO:</span><span>- ${totalDiscount.toFixed(2)} TL</span></div>
            <div class="print-flex print-bold"><span>GÜNLÜK MASRAF:</span><span>- ${dailyExpenses.toFixed(2)} TL</span></div>
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size:16px;"><span>NET KASA:</span><span>${net.toFixed(2)} TL</span></div>
            
            <h3 style="margin-top:20px; border-bottom:1px solid #000; padding-bottom:5px; font-family:serif;">PERSONEL BAZLI TAHSİLAT</h3>
    `;

    Object.keys(userTotals).forEach(u => {
        const ut = userTotals[u];
        html += `
            <div style="margin-bottom: 10px;">
                <b style="font-size:13px;">${u}</b>
                <div class="print-flex"><span>Nakit:</span><span>${ut.Nakit.toFixed(2)} TL</span></div>
                <div class="print-flex"><span>KK:</span><span>${ut['Kredi Kartı'].toFixed(2)} TL</span></div>
                <div class="print-flex"><span>YK:</span><span>${ut['Yemek Kartı'].toFixed(2)} TL</span></div>
                <div class="print-flex print-bold" style="border-top:1px dashed #ccc; padding-top:2px;"><span>Toplam:</span><span>${ut.Toplam.toFixed(2)} TL</span></div>
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
        html += `<div class="print-flex"><span>${g.qty}x ${g.name}</span><span>${g.totalPrice.toFixed(2)} TL</span></div>`;
        if(g.note) html += `<div style="font-size:10px; margin-top:-3px; margin-bottom:3px;">Not: ${g.note}</div>`;
    });

    html += `<div class="print-div"></div>`;
    
    (o.partialPayments || []).forEach(p => {
        html += `<div class="print-flex" style="font-size:10px;"><span>${p.method} ile:</span><span>${p.amount.toFixed(2)} TL</span></div>`;
    });

    html += `
            <div class="print-div"></div>
            <div class="print-flex print-bold" style="font-size: 14px;"><span>ARA TOPLAM:</span><span>${o.total.toFixed(2)} TL</span></div>
    `;

    if(o.discountAmount > 0) {
        html += `<div class="print-flex print-bold" style="font-size: 12px;"><span>İSKONTO (%${o.discountPercent}):</span><span>- ${o.discountAmount.toFixed(2)} TL</span></div>`;
    }
    
    const finalTotal = o.total - (o.discountAmount || 0);

    html += `
            <div class="print-flex print-bold" style="font-size: 14px; margin-top: 5px;"><span>TOPLAM:</span><span>${finalTotal.toFixed(2)} TL</span></div>
            <div class="print-flex"><span>ÖDENEN:</span><span>${(o.paid || 0).toFixed(2)} TL</span></div>
            <div class="print-flex print-bold" style="font-size: 14px;"><span>KALAN:</span><span>${(finalTotal - (o.paid || 0)).toFixed(2)} TL</span></div>
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
        }
    } catch(e) {}
});

window.deleteExpense = (id) => {
    showModal('MASRAFI SİL', 'BU MASRAFI SİLMEK İSTEDİĞİNİZE EMİN MİSİNİZ?', '', async () => { 
        await deleteDoc(doc(db, "expenses", id)); 
    });
};

async function listenQRCategoriesAndProducts() {
    let globalCats = [];
    let globalProds = [];

    window.renderQR = () => {
        const catContainer = document.getElementById('qr-categories-container');
        const prodContainer = document.getElementById('qr-products-container');
        if(!catContainer || !prodContainer) return;

        catContainer.innerHTML = '';
        prodContainer.innerHTML = '';

        if(globalCats.length === 0) return;
        
        if(!currentCategory || !globalCats.some(c => c.name === currentCategory)) {
            currentCategory = globalCats[0].name;
        }

        globalCats.forEach(c => {
            const btn = document.createElement('button');
            btn.className = `qr-cat-btn ${currentCategory === c.name ? 'active' : ''}`;
            btn.textContent = c.name;
            btn.onclick = () => { currentCategory = c.name; window.renderQR(); };
            catContainer.appendChild(btn);
        });

        const activeProds = globalProds.filter(p => p.cat === currentCategory);
        activeProds.forEach(p => {
            const isStock = p.stock !== false;
            prodContainer.innerHTML += `
                <div class="qr-product-card" style="${!isStock ? 'opacity:0.4;' : ''}">
                    <div class="qr-prod-info">
                        <div class="qr-prod-name">${p.name} ${!isStock ? '<span style="color:var(--red); font-size:10px; font-weight:900; letter-spacing:1px; font-family:var(--font-body);">(TÜKENDİ)</span>' : ''}</div>
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

    try {
        const catsSnap = await getDocs(collection(db, "categories"));
        globalCats = [...catsSnap.docs].map(d => d.data());
        globalCats.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));

        const prodsSnap = await getDocs(collection(db, "products"));
        globalProds = [...prodsSnap.docs].map(d => d.data());
        globalProds.sort((a,b) => getOrderVal(a.order) - getOrderVal(b.order));

        if(typeof window.renderQR === 'function') window.renderQR();
    } catch(e) {
        console.error("QR Yükleme Hatası:", e);
    }
}
