const colors = require('colors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DateTime } = require('luxon');
const { encryptMessage, decryptMessage, setSessionKeys } = require('./encryption.js');
// ====== Hàm phụ trợ ======
function prettyBox(title, lines, color = 'cyan') {
    const width = Math.max(title.length, ...lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;
    const top = `┌${'─'.repeat(width-2)}┐`;
    const mid = `│ ${title.padEnd(width-4)} │`;
    const sep = `├${'─'.repeat(width-2)}┤`;
    const content = lines.map(l => `│ ${l.padEnd(width-4)} │`).join('\n');
    const bot = `└${'─'.repeat(width-2)}┘`;
    let box = [top, mid, sep, content, bot].join('\n');
    if (colors[color]) box = colors[color](box);
    return box;
}

function cleanupAndExit(code = 0) {
    console.log(colors.yellow('\nĐang thoát...'));
    process.exit(code);
}

function getCookieFromFile() {
    try {
        const cookieFile = path.join(__dirname, 'cookie1.txt');
        if (fs.existsSync(cookieFile)) {
            const cookie = fs.readFileSync(cookieFile, 'utf8').split(/\r?\n/)[0].trim();
            if (cookie && !cookie.startsWith('#')) {
                console.log('✅ Đã lấy cookie từ file cookie.txt!');
                return cookie;
            }
        }
        return null;
    } catch (error) {
        console.log('❌ Lỗi khi đọc file cookie.txt:', error.message);
        return null;
    }
}

// ====== Hàm loại bỏ thẻ HTML ======
function stripHtmlTags(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/<[^>]+>/g, '');
}



// ====== Định nghĩa class MongTuTienAPIClient ======
class MongTuTienAPIClient {
    constructor() {
        this.baseHeaders = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "vi,en;q=0.9,en-GB;q=0.8,en-US;q=0.7",
            "Content-Type": "application/json",
            "Origin": "https://mongtutien.online",
            "Referer": "https://mongtutien.online/",
            "Sec-Ch-Ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Microsoft Edge";v="138"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
        };
        this.selectedMapKey = null;
        this.errorCount = 0;
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [✓] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;
            case 'error':
                console.log(`[${timestamp}] [✗] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [!] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
        }
    }

    async getCharacterInfo(cookie) {
        const url = "https://mongtutien.online/api/character/me";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${cookie}`
            };
            const response = await axios.get(url, { headers, responseType: 'json' });
            if (response.status === 200) {
                const { character } = response.data;
                return {
                    name: character.name,
                    level: character.level,
                    location: character.location,
                    gold: character.gold,
                    spiritStone: character.spiritStone,
                    exp: character.exp,
                    nextExp: character.nextRealm.exp
                };
            } else {
                this.log(`Không thể lấy thông tin nhân vật: Status ${response.status}`, 'error');
                return null;
            }
        } catch (error) {
            if (error.response && error.response.status === 401) {
                this.errorCount++;
                if (this.errorCount > 3) {
                    this.log('Lỗi xác thực quá nhiều lần, dừng auto bí cảnh.', 'error');
                    return null;
                }
                this.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
                // Nếu bạn có hàm getCookieAutoShared thì gọi ở đây, nếu không thì bỏ qua
                // const newCookie = await getCookieAutoShared();
                // if (newCookie) {
                //     cookie = newCookie;
                //     this.errorCount = 0;
                //     this.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                //     return await this.getCharacterInfo(cookie);
                // } else {
                //     this.log('Không lấy lại được cookie mới.', 'error');
                //     return null;
                // }
                return null;
            }
            this.log(`Lỗi khi lấy thông tin nhân vật: ${error.message}`, 'error');
            return null;
        }
    }


    getCookieFromFile() {
        try {
            const cookieFile = path.join(__dirname, 'cookie.txt');
            if (fs.existsSync(cookieFile)) {
                const cookie = fs.readFileSync(cookieFile, 'utf8').split(/\r?\n/)[0].trim();
                if (cookie && !cookie.startsWith('#')) {
                    console.log('✅ Đã lấy cookie từ file cookie.txt!');
                    return cookie;
                }
            }
            console.log('❌ Không tìm thấy cookie trong file cookie.txt');
            return null;
        } catch (error) {
            console.log('❌ Lỗi khi đọc file cookie.txt:', error.message);
            return null;
        }
    }

    async getCookieAuto() {
        console.log('🔄 Đang lấy cookie tự động...');
        let cookie = this.getCookieFromFile();
        if (cookie) return cookie.trim();
        // Nếu không có, yêu cầu nhập thủ công
        console.log('❌ Không thể lấy cookie tự động. Vui lòng nhập thủ công.');
        return null;
    }
}


class PersonalBossAutoHunter {
    constructor(cookie, logFn = console.log) {
        this.cookie = cookie;
        // Sử dụng logFn mới cho log đẹp
        this.log = (msg, type = 'info') => {
            const now = new Date();
            const time = now.toLocaleTimeString();
            let icon = 'ℹ️';
            let color = 'magenta';
            if (type === 'success') { icon = '🟢'; color = 'green'; }
            else if (type === 'warning') { icon = '🟡'; color = 'yellow'; }
            else if (type === 'error') { icon = '🔴'; color = 'red'; }
            else if (type === 'custom') { icon = '✨'; color = 'cyan'; }
            else if (type === 'attack') { icon = '⚔️'; color = 'blue'; }
            else if (type === 'reward') { icon = '🏆'; color = 'yellow'; }
            else if (type === 'boss') { icon = '👤'; color = 'magenta'; }
            let line = `[${time}] ${icon} ${msg}`;
            if (colors[color]) line = colors[color](line);
            logFn(line);
        };
        this.ws = null;
        this.heartbeatInterval = null;
        this.pingInterval = null;
        this.bossQueue = [];
        this.bossList = [];
        this.defeatedBossIds = new Set();
        this.isAttacking = false;
        this.isRunning = false;
        this.userId = null;
        this.lastLoggedDamageId = null;
        this.hasSessionKey = false;
        this.reconnectTimeout = null;
        // ĐÃ BỎ this.pendingClaimMines
        this.errorCount = 0;
    }
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = 'wss://mongtutien.online/ws';
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Cookie': `nuxt-session=${this.cookie}`
                }
            });
            this.ws.on('open', () => {
                this.log('[PersonalBoss] Đã kết nối WebSocket boss cá nhân!');
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = null;
                }
                // Không gửi gì cả, chỉ chờ nhận sessionKey
                resolve();
            });
            this.ws.on('close', (code, reason) => {
                this.log(`[PersonalBoss] Mất kết nối WebSocket boss cá nhân! Tool sẽ tự động tắt hoàn toàn.`, 'error');
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                process.exit(1); // Thoát hoàn toàn, không restart
            });
            this.ws.on('error', (err) => {
                this.log(`[PersonalBoss] Lỗi WebSocket boss cá nhân: ${err.message}. Tool sẽ tự động tắt hoàn toàn.`, 'error');
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                process.exit(1); // Thoát hoàn toàn, không restart
            });
            this.ws.on('message', (msg) => {
                this.handleMessage(msg);
            });
        });
    }
    safeSend(type, payload = {}) {
        if (!this.hasSessionKey) {
            this.log('[PersonalBoss] Chưa có sessionKey, bỏ qua gửi lệnh');
            return;
        }
        try {
            const packet = encryptMessage({ type, payload });
            this.send(packet);
        } catch (err) {
            this.log(`[PersonalBoss] Lỗi mã hóa: ${err.message}`, 'error');
            this.hasSessionKey = false;
        }
    }
    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet);
        } else {
            this.log('[PersonalBoss] WebSocket không mở', 'error');
        }
    }
    async start() {
        this.isRunning = true;
        await this.connect();
        setTimeout(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.log(`[PersonalBoss] WebSocket không kết nối sau 30s, thoát tool...`, 'error');
                cleanupAndExit(1, 3000);
            } else {
                this.log(`[PersonalBoss] WebSocket kết nối ổn định`, 'success');
            }
        }, 30000);
    }
    stop() {
        this.isRunning = false;
        if (this.ws) this.ws.close();
    }
    handleMessage(msg) {
        let data = msg;
        if (Buffer.isBuffer(msg)) {
            try {
                const str = msg.toString('utf8');
                data = JSON.parse(str);
            } catch (e) { return; }
        } else if (typeof msg === 'string') {
            try { data = JSON.parse(msg); } catch (e) { return; }
        }
        // Xử lý nhận sessionKey
        if (data.type === 'sessionKey' && data.payload) {
            setSessionKeys(data.payload);
            this.hasSessionKey = true;
            this.log('Đã nhận sessionKey và thiết lập mã hóa!', 'success');
            // Gửi lệnh lấy danh sách boss cá nhân ngay sau khi nhận sessionKey
                this.safeSend('personal:boss:list');
            this.log('[SEND] Gửi lệnh lấy danh sách boss cá nhân...', 'info');
            // Đặt interval gửi lại lệnh lấy danh sách boss cá nhân mỗi 60s
            if (this.listInterval) clearInterval(this.listInterval);
            this.listInterval = setInterval(() => {
                this.safeSend('personal:boss:list');
                this.log('[SEND] Gửi lệnh lấy danh sách boss cá nhân...', 'info');
            }, 60000);
            return;
        }
        // Lấy userId từ online:players (KHÔNG cần kiểm tra myName)
        if (data.type === 'online:players' && Array.isArray(data.payload)) {
            if (!this.userId && data.payload.length > 0) {
                this.userId = data.payload[0].userId;
                this.log(`[AUTO] Đã lấy userId của bạn: ${this.userId}`, 'success');
            }
            return;
        }
        // Khi nhận danh sách boss cá nhân
        if (data.type === 'personal:boss:list' && Array.isArray(data.payload)) {
            this.log(`[RECV] Đã nhận danh sách boss cá nhân (${data.payload.length} boss).`, 'info');
            this.bossList = data.payload;
            const now = Date.now();
            let readyCount = 0;
            for (const boss of this.bossList) {
                let status = '';
                if (!boss.spawnedAt || (boss.spawnedAt && new Date(boss.spawnedAt).getTime() <= now)) {
                    if (boss.currentHp > 0) {
                        status = 'Có thể tấn công';
                        readyCount++;
                    } else {
                        status = 'Đã chết';
                    }
                } else {
                    const ms = new Date(boss.spawnedAt).getTime() - now;
                    const min = Math.floor(ms / 60000);
                    const sec = Math.floor((ms % 60000) / 1000);
                    status = `Hồi sinh sau ${min} phút ${sec.toString().padStart(2, '0')} giây`;
                }
                this.log(`Boss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} | ${status}`,'info');
            }
            // Lọc boss đã hồi sinh và chưa chết
            this.attackQueue = this.bossList.filter(boss => {
                const timeLeft = boss.spawnedAt ? Math.max(0, new Date(boss.spawnedAt).getTime() - now) : 0;
                return (!boss.spawnedAt || timeLeft <= 0) && boss.currentHp > 0;
            });
            if (this.attackQueue.length > 0 && !this.isAttacking) {
                this.attackNextBoss();
            } else if (this.attackQueue.length === 0) {
                this.log('Không có boss cá nhân nào sẵn sàng để đánh. Chờ boss mới hồi sinh...', 'info');
            }
            return;
        }
        // Khi nhận thông báo nhận thưởng từ boss cá nhân (system message)
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
        // Xử lý cảnh báo hoặc lỗi nếu cần
        if (data.type === 'warn' && data.payload && typeof data.payload.text === 'string') {
            this.log(`⚠️ ${data.payload.text}`, 'warning');
        }
        if (data.error && typeof data.error === 'string') {
            this.log(`Lỗi: ${data.error}`, 'error');
        }
    }
    attackNextBoss() {
        if (this.isAttacking || !this.attackQueue || this.attackQueue.length === 0) {
                this.isAttacking = false;
            return;
        }
        this.isAttacking = true;
        const boss = this.attackQueue.shift();
        if (!boss) {
            this.isAttacking = false;
            return;
        }
        this.log(`[SEND] Gửi lệnh tấn công boss cá nhân: ${boss.name} (ID: ${boss.id})`,'attack');
        this.safeSend('personal:boss:attack', { bossId: boss.id });
        setTimeout(() => {
            this.isAttacking = false;
            this.attackNextBoss();
        }, 5000);
    }
}

async function mainPersonalBossAuto() {
    const apiClient = new MongTuTienAPIClient();
    let cookie = await apiClient.getCookieAuto();
    
    if (!cookie) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        cookie = await new Promise(resolve => {
            rl.question('Nhập cookie (nuxt-session): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });
    }
    
    const client = new PersonalBossAutoHunter(cookie.trim(), (msg, type) => {
        if (type === 'success') console.log(msg.green);
        else if (type === 'warning') console.log(msg.yellow);
        else if (type === 'error') console.log(msg.red);
        else console.log(msg.cyan);
    });
    global.personalBossHunter = client; // Lưu reference để cleanup
    await client.start();
    // Dừng lại bằng Ctrl+C
}
class PersonalPetBossAutoHunter {
    constructor(cookie, logFn = console.log) {
        this.cookie = cookie;
        this.log = (msg, type = 'info') => {
            const now = new Date();
            const time = now.toLocaleTimeString();
            let icon = '🐾';
            let color = 'cyan';
            if (type === 'success') { icon = '🟢'; color = 'green'; }
            else if (type === 'warning') { icon = '🟡'; color = 'yellow'; }
            else if (type === 'error') { icon = '🔴'; color = 'red'; }
            else if (type === 'attack') { icon = '⚔️'; color = 'blue'; }
            else if (type === 'reward') { icon = '🏆'; color = 'yellow'; }
            let line = `[${time}] ${icon} ${msg}`;
            if (colors[color]) line = colors[color](line);
            logFn(line);
        };
        this.ws = null;
        this.hasSessionKey = false;
        this.bossList = [];
        this.isAttacking = false;
        this.attackQueue = [];
        this.userId = null;
        this.myName = null;
        this.apiClient = new MongTuTienAPIClient();
        this.listInterval = null;
    }
    async ensureCharacterName() {
        if (!this.myName) {
            const charInfo = await this.apiClient.getCharacterInfo(this.cookie);
            if (charInfo && charInfo.name) {
                this.myName = charInfo.name;
                this.log(`[AUTO] Đã lấy tên nhân vật từ API: ${this.myName}`, 'success');
            } else {
                this.log('Không thể lấy tên nhân vật từ API!', 'warning');
            }
        }
    }
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = 'wss://mongtutien.online/ws';
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Cookie': `nuxt-session=${this.cookie}`
                }
            });
            this.ws.on('open', () => {
                this.log('Đã kết nối WebSocket pet boss!', 'success');
                resolve();
            });
            this.ws.on('close', () => {
                this.log('Mất kết nối WebSocket pet boss!', 'error');
                process.exit(1);
            });
            this.ws.on('error', (err) => {
                this.log(`Lỗi WebSocket pet boss: ${err.message}`, 'error');
                process.exit(1);
            });
            this.ws.on('message', (msg) => {
                this.handleMessage(msg);
            });
        });
    }
    safeSend(type, payload = {}) {
        if (!this.hasSessionKey) return;
        try {
            if (type === 'personal:pet:boss:list') {
                this.log('[SEND] Gửi lệnh lấy danh sách boss pet cá nhân...', 'info');
            }
            const packet = encryptMessage({ type, payload });
            this.send(packet);
        } catch (err) {
            this.log(`Lỗi mã hóa: ${err.message}`, 'error');
            this.hasSessionKey = false;
        }
    }
    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet);
        }
    }
    async start() {
        await this.ensureCharacterName();
        await this.connect();
        this.log('Đang chờ sessionKey...', 'info');
    }
    stop() {
        if (this.ws) this.ws.close();
        if (this.listInterval) clearInterval(this.listInterval);
    }
    handleMessage(msg) {
        let data = msg;
        if (Buffer.isBuffer(msg)) {
            try {
                const str = msg.toString('utf8');
                data = JSON.parse(str);
            } catch (e) { return; }
        } else if (typeof msg === 'string') {
            try { data = JSON.parse(msg); } catch (e) { return; }
        }
        // Nhận sessionKey
        if (data.type === 'sessionKey' && data.payload) {
            setSessionKeys(data.payload);
            this.hasSessionKey = true;
            this.log('Đã nhận sessionKey và thiết lập mã hóa!', 'success');
            // Sau khi nhận sessionKey, gửi lệnh lấy danh sách boss pet cá nhân
            this.safeSend('personal:pet:boss:list');
            this.listInterval = setInterval(() => {
                this.safeSend('personal:pet:boss:list');
            }, 60000);
            return;
        }
        // Lấy userId từ online:players nếu tên trùng với myName
        if (this.myName && data.type === 'online:players' && Array.isArray(data.payload)) {
            const found = data.payload.find(u => (u.name || '').toLowerCase() === this.myName.toLowerCase());
            if (found) {
                this.userId = found.userId;
                this.log(`[AUTO] Đã lấy userId từ online:players: ${this.userId} (name: ${this.myName})`, 'success');
            }
            return;
        }
        // Khi nhận danh sách boss pet cá nhân
        if (data.type === 'personal:pet:boss:list' && Array.isArray(data.payload)) {
            this.log(`[RECV] Đã nhận danh sách boss pet cá nhân (${data.payload.length} boss).`, 'info');
            this.bossList = data.payload;
            const now = Date.now();
            let readyCount = 0;
            for (const boss of this.bossList) {
                let status = '';
                if (!boss.spawnedAt || (boss.spawnedAt && new Date(boss.spawnedAt).getTime() <= now)) {
                    if (boss.currentHp > 0) {
                        status = 'Có thể tấn công';
                        readyCount++;
                    } else {
                        status = 'Đã chết';
                    }
                } else {
                    const ms = new Date(boss.spawnedAt).getTime() - now;
                    const min = Math.floor(ms / 60000);
                    const sec = Math.floor((ms % 60000) / 1000);
                    status = `Hồi sinh sau ${min} phút ${sec.toString().padStart(2, '0')} giây`;
                }
                this.log(`Boss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} | ${status}`,'info');
            }
            // Lọc boss đã hồi sinh và chưa chết
            this.attackQueue = this.bossList.filter(boss => {
                const timeLeft = boss.spawnedAt ? Math.max(0, new Date(boss.spawnedAt).getTime() - now) : 0;
                return (!boss.spawnedAt || timeLeft <= 0) && boss.currentHp > 0;
            });
            if (this.attackQueue.length > 0 && !this.isAttacking) {
                this.attackNextBoss();
            } else if (this.attackQueue.length === 0) {
                this.log('Không có boss pet cá nhân nào sẵn sàng để đánh. Chờ boss mới hồi sinh...', 'info');
            }
        }
        // Khi nhận kết quả tấn công hoặc phần thưởng
        if (data.type === 'personal:boss:attack:success') {
            this.log('Đã tấn công boss pet cá nhân thành công!', 'success');
        }
        if (data.type === 'personal:pet:boss:reward' && data.payload) {
            let lines = [];
            lines.push('🏆 Thưởng:');
            Object.entries(data.payload).forEach(([k, v]) => {
                lines.push(`  - ${k}: ${JSON.stringify(v)}`);
            });
            this.log(prettyBox('Kết thúc Boss Pet Cá Nhân', lines, 'green'), 'reward');
        }
        // Khi nhận thông báo nhận thưởng từ boss pet cá nhân (system message)
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
        // Khi nhận cảnh báo hoặc lỗi
        if (data.type === 'warn' && data.payload && typeof data.payload.text === 'string') {
            this.log(`⚠️ ${data.payload.text}`, 'warning');
        }
        if (data.error && typeof data.error === 'string') {
            this.log(`Lỗi: ${data.error}`, 'error');
        }
    }
    attackNextBoss() {
        if (this.isAttacking || this.attackQueue.length === 0) {
            this.isAttacking = false;
            return;
        }
        this.isAttacking = true;
        const boss = this.attackQueue.shift();
        if (!boss) {
            this.isAttacking = false;
            return;
        }
        this.log(`[PET BOSS] Đang đánh boss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`,'attack');
        this.safeSend('personal:boss:attack', { bossId: boss.id });
        setTimeout(() => {
            this.isAttacking = false;
            this.attackNextBoss();
        }, 5000);
    }
}
async function mainPersonalPetBossAuto() {
    const apiClient = new MongTuTienAPIClient();
    let cookie = await apiClient.getCookieAuto();
            if (!cookie) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                cookie = await new Promise(resolve => {
                    rl.question('Nhập cookie (nuxt-session): ', (input) => {
                        rl.close();
                        resolve(input.trim());
                    });
                });
    }
    const hunter = new PersonalPetBossAutoHunter(cookie.trim(), (msg, type) => {
        if (type === 'success') console.log(msg.green);
        else if (type === 'warning') console.log(msg.yellow);
        else if (type === 'error') console.log(msg.red);
        else if (type === 'attack') console.log(msg.blue);
        else if (type === 'reward') console.log(msg.yellow);
        else console.log(msg.cyan);
    });
    global.personalPetBossHunter = hunter;
    await hunter.start();
    process.on('SIGINT', () => {
        hunter.stop();
        process.exit(0);
    });
}
class PersonalWifeBossAutoHunter {
    constructor(cookie, logFn = console.log) {
        this.cookie = cookie;
        this.log = (msg, type = 'info') => {
            const now = new Date();
            const time = now.toLocaleTimeString();
            let icon = '💞';
            let color = 'magenta';
            if (type === 'success') { icon = '🟢'; color = 'green'; }
            else if (type === 'warning') { icon = '🟡'; color = 'yellow'; }
            else if (type === 'error') { icon = '🔴'; color = 'red'; }
            else if (type === 'attack') { icon = '⚔️'; color = 'blue'; }
            else if (type === 'reward') { icon = '🏆'; color = 'yellow'; }
            let line = `[${time}] ${icon} ${msg}`;
            if (colors[color]) line = colors[color](line);
            logFn(line);
        };
        this.ws = null;
        this.hasSessionKey = false;
        this.bossList = [];
        this.isAttacking = false;
        this.attackQueue = [];
        this.userId = null;
        this.myName = null;
        this.apiClient = new MongTuTienAPIClient();
        this.listInterval = null;
    }
    async ensureCharacterName() {
        if (!this.myName) {
            const charInfo = await this.apiClient.getCharacterInfo(this.cookie);
            if (charInfo && charInfo.name) {
                this.myName = charInfo.name;
                this.log(`[AUTO] Đã lấy tên nhân vật từ API: ${this.myName}`, 'success');
            } else {
                this.log('Không thể lấy tên nhân vật từ API!', 'warning');
            }
        }
    }
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = 'wss://mongtutien.online/ws';
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Cookie': `nuxt-session=${this.cookie}`
                }
            });
            this.ws.on('open', () => {
                this.log('Đã kết nối WebSocket boss đạo lữ!', 'success');
                resolve();
            });
            this.ws.on('close', () => {
                this.log('Mất kết nối WebSocket boss đạo lữ!', 'error');
                process.exit(1);
            });
            this.ws.on('error', (err) => {
                this.log(`Lỗi WebSocket boss đạo lữ: ${err.message}`, 'error');
                process.exit(1);
            });
            this.ws.on('message', (msg) => {
                this.handleMessage(msg);
            });
        });
    }
    safeSend(type, payload = {}) {
        if (!this.hasSessionKey) return;
        try {
            if (type === 'personal:wife:boss:list') {
                this.log('[SEND] Gửi lệnh lấy danh sách boss đạo lữ...', 'info');
            }
            const packet = encryptMessage({ type, payload });
            this.send(packet);
        } catch (err) {
            this.log(`Lỗi mã hóa: ${err.message}`, 'error');
            this.hasSessionKey = false;
        }
    }
    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet);
        }
    }
    async start() {
        await this.ensureCharacterName();
        await this.connect();
        this.log('Đang chờ sessionKey...', 'info');
    }
    stop() {
        if (this.ws) this.ws.close();
        if (this.listInterval) clearInterval(this.listInterval);
    }
    handleMessage(msg) {
        let data = msg;
        if (Buffer.isBuffer(msg)) {
            try {
                const str = msg.toString('utf8');
                data = JSON.parse(str);
            } catch (e) { return; }
        } else if (typeof msg === 'string') {
            try { data = JSON.parse(msg); } catch (e) { return; }
        }
        // Nhận sessionKey
        if (data.type === 'sessionKey' && data.payload) {
            setSessionKeys(data.payload);
            this.hasSessionKey = true;
            this.log('Đã nhận sessionKey và thiết lập mã hóa!', 'success');
            // Sau khi nhận sessionKey, gửi lệnh lấy danh sách boss đạo lữ
            this.safeSend('personal:wife:boss:list');
            this.listInterval = setInterval(() => {
                this.safeSend('personal:wife:boss:list');
            }, 60000);
            return;
        }
        // Lấy userId từ online:players nếu tên trùng với myName
        if (this.myName && data.type === 'online:players' && Array.isArray(data.payload)) {
            const found = data.payload.find(u => (u.name || '').toLowerCase() === this.myName.toLowerCase());
            if (found) {
                this.userId = found.userId;
                this.log(`[AUTO] Đã lấy userId từ online:players: ${this.userId} (name: ${this.myName})`, 'success');
            }
            return;
        }
        // Khi nhận danh sách boss đạo lữ
        if (data.type === 'personal:wife:boss:list' && Array.isArray(data.payload)) {
            this.log(`[RECV] Đã nhận danh sách boss đạo lữ (${data.payload.length} boss).`, 'info');
            this.bossList = data.payload;
            const now = Date.now();
            let readyCount = 0;
            for (const boss of this.bossList) {
                let status = '';
                if (!boss.spawnedAt || (boss.spawnedAt && new Date(boss.spawnedAt).getTime() <= now)) {
                    if (boss.currentHp > 0) {
                        status = 'Có thể tấn công';
                        readyCount++;
                    } else {
                        status = 'Đã chết';
                    }
                } else {
                    const ms = new Date(boss.spawnedAt).getTime() - now;
                    const min = Math.floor(ms / 60000);
                    const sec = Math.floor((ms % 60000) / 1000);
                    status = `Hồi sinh sau ${min} phút ${sec.toString().padStart(2, '0')} giây`;
                }
                this.log(`Boss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} | ${status}`,'info');
            }
            // Lọc boss đã hồi sinh và chưa chết
            this.attackQueue = this.bossList.filter(boss => {
                const timeLeft = boss.spawnedAt ? Math.max(0, new Date(boss.spawnedAt).getTime() - now) : 0;
                return (!boss.spawnedAt || timeLeft <= 0) && boss.currentHp > 0;
            });
            if (this.attackQueue.length > 0 && !this.isAttacking) {
                this.attackNextBoss();
            } else if (this.attackQueue.length === 0) {
                this.log('Không có boss đạo lữ nào sẵn sàng để đánh. Chờ boss mới hồi sinh...', 'info');
            }
        }
        // Khi nhận kết quả tấn công hoặc phần thưởng
        if (data.type === 'personal:boss:attack:success') {
            this.log('Đã tấn công boss đạo lữ thành công!', 'success');
        }
        if (data.type === 'personal:wife:boss:reward' && data.payload) {
            let lines = [];
            lines.push('🏆 Thưởng:');
            Object.entries(data.payload).forEach(([k, v]) => {
                lines.push(`  - ${k}: ${JSON.stringify(v)}`);
            });
            this.log(prettyBox('Kết thúc Boss Đạo Lữ', lines, 'green'), 'reward');
        }
        // Khi nhận thông báo nhận thưởng từ boss đạo lữ (system message)
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
        // Khi nhận cảnh báo hoặc lỗi
        if (data.type === 'warn' && data.payload && typeof data.payload.text === 'string') {
            this.log(`⚠️ ${data.payload.text}`, 'warning');
        }
        if (data.error && typeof data.error === 'string') {
            this.log(`Lỗi: ${data.error}`, 'error');
        }
    }
    attackNextBoss() {
        if (this.isAttacking || !this.attackQueue || this.attackQueue.length === 0) {
            this.isAttacking = false;
            return;
        }
        this.isAttacking = true;
        const boss = this.attackQueue.shift();
        if (!boss) {
            this.isAttacking = false;
            return;
        }
        this.log(`[ĐẠO LỮ] Đang đánh boss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()}`,'attack');
        this.safeSend('personal:boss:attack', { bossId: boss.id });
        setTimeout(() => {
            this.isAttacking = false;
            this.attackNextBoss();
        }, 5000);
    }
}

async function mainPersonalWifeBossAuto() {
    const apiClient = new MongTuTienAPIClient();
    let cookie = await apiClient.getCookieAuto();
    if (!cookie) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        cookie = await new Promise(resolve => {
            rl.question('Nhập cookie (nuxt-session): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });
    }
    const hunter = new PersonalWifeBossAutoHunter(cookie.trim(), (msg, type) => {
        if (type === 'success') console.log(msg.green);
        else if (type === 'warning') console.log(msg.yellow);
        else if (type === 'error') console.log(msg.red);
        else if (type === 'attack') console.log(msg.blue);
        else if (type === 'reward') console.log(msg.yellow);
        else console.log(msg.magenta);
    });
    global.personalWifeBossHunter = hunter;
    await hunter.start();
    process.on('SIGINT', () => {
        hunter.stop();
        process.exit(0);
    });
}
class HeavenMineAutoCollector {
    constructor(cookie, logFn = console.log) {
        this.cookie = cookie;
        this.log = (msg, type = 'info') => {
            const now = new Date();
            const time = now.toLocaleTimeString();
            let icon = '⛏️';
            let color = 'cyan';
            if (type === 'success') { icon = '🟢'; color = 'green'; }
            else if (type === 'warning') { icon = '🟡'; color = 'yellow'; }
            else if (type === 'error') { icon = '🔴'; color = 'red'; }
            else if (type === 'claim') { icon = '💎'; color = 'yellow'; }
            let line = `[${time}] ${icon} ${msg}`;
            if (colors[color]) line = colors[color](line);
            logFn(line);
        };
        this.ws = null;
        this.userId = null;
        this.myName = null; // Sẽ lấy từ API
        this.mineList = [];
        this.claimInterval = null;
        this.hasSessionKey = false;
        this.pendingClaimMines = new Set();
        this.apiClient = new MongTuTienAPIClient();
        this.initialized = false;
    }
    async ensureCharacterName() {
        if (!this.myName) {
            const charInfo = await this.apiClient.getCharacterInfo(this.cookie);
            if (charInfo && charInfo.name) {
                this.myName = charInfo.name;
                this.log(`[AUTO] Đã lấy tên nhân vật từ API: ${this.myName}`, 'success');
            } else {
                this.log('Không thể lấy tên nhân vật từ API!', 'warning');
            }
        }
    }
    async start() {
        await this.ensureCharacterName();
        await this.connect();
        this.log('Đang chờ sessionKey...', 'info');
    }
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = 'wss://mongtutien.online/ws';
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Cookie': `nuxt-session=${this.cookie}`
                }
            });
            this.ws.on('open', () => {
                this.log('Đã kết nối WebSocket mỏ!', 'success');
                resolve();
            });
            this.ws.on('close', () => {
                this.log('Mất kết nối WebSocket mỏ!', 'error');
                process.exit(1);
            });
            this.ws.on('error', (err) => {
                this.log(`Lỗi WebSocket mỏ: ${err.message}`, 'error');
                process.exit(1);
            });
            this.ws.on('message', (msg) => {
                this.handleMessage(msg);
            });
        });
    }
    safeSend(type, payload = {}) {
        if (!this.hasSessionKey) {
            return;
        }
        try {
            const packet = encryptMessage({ type, payload });
            this.send(packet);
        } catch (err) {
            this.log(`Lỗi mã hóa: ${err.message}`, 'error');
            this.hasSessionKey = false;
        }
    }
    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet);
        }
    }
    stop() {
        if (this.ws) this.ws.close();
        if (this.claimInterval) clearInterval(this.claimInterval);
    }
    handleMessage(msg) {
        let data = msg;
        if (Buffer.isBuffer(msg)) {
            try {
                const str = msg.toString('utf8');
                data = JSON.parse(str);
            } catch (e) { return; }
        } else if (typeof msg === 'string') {
            try { data = JSON.parse(msg); } catch (e) { return; }
        }
        // Nhận sessionKey
        if (data.type === 'sessionKey' && data.payload) {
            setSessionKeys(data.payload);
            this.hasSessionKey = true;
            this.log('Đã nhận sessionKey và thiết lập mã hóa!', 'success');
            // Gửi lần lượt các lệnh cần thiết để server trả về heavenmine:list
            this.safeSend('hongmong:status');
            setTimeout(() => this.safeSend('hongmong:top'), 300);
            setTimeout(() => this.safeSend('heavenmine:status'), 600);
            setTimeout(() => {
                this.safeSend('heavenmine:list');
                this.claimInterval = setInterval(() => {
                    this.safeSend('heavenmine:list');
                }, 120000);
            }, 1000);
            return;
        }
        // Lấy userId từ online:players nếu tên trùng với myName
        if (this.myName && data.type === 'online:players' && Array.isArray(data.payload)) {
            const found = data.payload.find(u => (u.name || '').toLowerCase() === this.myName.toLowerCase());
            if (found) {
                this.userId = found.userId;
                this.log(`[AUTO] Đã lấy userId từ online:players: ${this.userId} (name: ${this.myName})`, 'success');
                // Chủ động gửi lại heavenmine:list ngay sau khi lấy được userId
                this.pendingClaimMines.clear(); // reset trạng thái pending
                this.safeSend('heavenmine:list');
            }
            return;
        }
        // Khi nhận danh sách mỏ
        if (data.type === 'heavenmine:list' && Array.isArray(data.payload)) {
            this.mineList = data.payload;
            if (!this.myName) {
                this.log('Chưa xác định được tên nhân vật của bạn, không thể nhận tài nguyên!', 'warning');
                return;
            }
            let mineCount = 0, claimCount = 0, waitLog = false;
            const myMines = this.mineList.filter(mine => mine.ownerId && (mine.ownerId.name || '').toLowerCase() === this.myName.toLowerCase());
            // Nếu có nhiều mỏ cùng tên, log ra danh sách ownerId._id để xác nhận
            if (myMines.length > 1) {
                const ids = myMines.map(m => m.ownerId._id).join(', ');
                this.log(`[CẢNH BÁO] Có nhiều mỏ trùng tên '${this.myName}'. Các ownerId._id: ${ids}`, 'warning');
            }
            for (const mine of myMines) {
                mineCount++;
                if ((mine.accumulated && (mine.accumulated.spiritStones > 0 || mine.accumulated.wifeEssence > 0)) && !this.pendingClaimMines.has(mine._id)) {
                    this.log(`Mỏ Lv${mine.level} có tài nguyên: +${mine.accumulated.spiritStones} linh thạch, +${mine.accumulated.wifeEssence} tín vật. Đang nhận...`, 'claim');
                    this.safeSend('heavenmine:claim');
                    claimCount++;
                    this.pendingClaimMines.add(mine._id);
                } else if (mine.accumulated && (mine.accumulated.spiritStones > 0 || mine.accumulated.wifeEssence > 0)) {
                    waitLog = true;
                }
            }
            if (mineCount === 0) {
                this.log('Không có mỏ nào thuộc về bạn!', 'warning');
            } else if (claimCount === 0 && waitLog) {
                this.log('Có tài nguyên nhưng chưa thể nhận, có thể phải đợi thêm thời gian!', 'warning');
            } else if (claimCount === 0) {
                this.log('Không có tài nguyên nào để nhận ở các mỏ của bạn.', 'info');
            }
        }
        // Khi nhận thành công
        if (data.type === 'heavenmine:claim:success') {
            this.log('Đã nhận tài nguyên mỏ thành công!', 'success');
            this.pendingClaimMines.clear();
        }
        // Khi nhận cảnh báo chưa đủ thời gian tích lũy
        if (data.type === 'warn' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('Chưa thể nhận!')) {
            this.log(`⚠️ ${data.payload.text}`, 'warning');
        }
        // Xử lý lỗi chữ ký
        if (data.error && data.error.includes('chữ ký')) {
            this.log(`Lỗi chữ ký: ${data.error}`, 'error');
            this.hasSessionKey = false;
        }
        // Khi nhận thông báo nhận thưởng từ heavenmine (system message)
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
    }
}

async function mainHeavenMineAutoCollector() {
    const apiClient = new MongTuTienAPIClient();
    let cookie = await apiClient.getCookieAuto();
    if (!cookie) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        cookie = await new Promise(resolve => {
            rl.question('Nhập cookie (nuxt-session): ', (input) => {
            rl.close();
                resolve(input.trim());
            });
        });
    }
    const collector = new HeavenMineAutoCollector(cookie.trim(), (msg, type) => {
        if (type === 'success') console.log(msg.green);
        else if (type === 'warning') console.log(msg.yellow);
        else if (type === 'error') console.log(msg.red);
        else if (type === 'claim') console.log(msg.yellow);
        else console.log(msg.cyan);
    });
    global.heavenMineCollector = collector;
    await collector.start();
    process.on('SIGINT', () => {
        collector.stop();
        process.exit(0);
    });
}
// ===================== MULTI FEATURE WS CLIENT =====================
class MultiFeatureWebSocketClient {
    constructor(cookie, features = {}) {
        this.cookie = cookie;
        this.ws = null;
        this.hasSessionKey = false;
        this.handlers = [];
        this.features = features; // { heavenmine: true, personalBoss: true, petBoss: true, wifeBoss: true }
        this.sessionKeys = null;
    }
    registerHandler(handler) {
        this.handlers.push(handler);
        handler.setClient(this);
    }
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = 'wss://mongtutien.online/ws';
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Cookie': `nuxt-session=${this.cookie}`
                }
            });
            this.ws.on('open', () => {
                this.log('Đã kết nối WebSocket đa chức năng!', 'success');
                resolve();
            });
            this.ws.on('close', () => {
                this.log('Mất kết nối WebSocket!', 'error');
                process.exit(1);
            });
            this.ws.on('error', (err) => {
                this.log(`Lỗi WebSocket: ${err.message}`, 'error');
                process.exit(1);
            });
            this.ws.on('message', (msg) => {
                this.handleMessage(msg);
            });
        });
    }
    log(msg, type = 'info') {
        const now = new Date();
        const time = now.toLocaleTimeString();
        let icon = '🌐';
        let color = 'cyan';
        if (type === 'success') { icon = '🟢'; color = 'green'; }
        else if (type === 'warning') { icon = '🟡'; color = 'yellow'; }
        else if (type === 'error') { icon = '🔴'; color = 'red'; }
        let line = `[${time}] ${icon} ${msg}`;
        if (colors[color]) line = colors[color](line);
        console.log(line);
    }
    send(packet) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(packet);
        }
    }
    safeSend(type, payload = {}) {
        if (!this.hasSessionKey) return;
        try {
            const packet = encryptMessage({ type, payload });
            this.send(packet);
        } catch (err) {
            this.log(`Lỗi mã hóa: ${err.message}`, 'error');
            this.hasSessionKey = false;
        }
    }
    handleMessage(msg) {
        let data = msg;
        if (Buffer.isBuffer(msg)) {
            try {
                const str = msg.toString('utf8');
                data = JSON.parse(str);
            } catch (e) { return; }
        } else if (typeof msg === 'string') {
            try { data = JSON.parse(msg); } catch (e) { return; }
        }
        // Xử lý sessionKey chung
        if (data.type === 'sessionKey' && data.payload) {
            setSessionKeys(data.payload);
            this.hasSessionKey = true;
            this.sessionKeys = data.payload;
            this.log('Đã nhận sessionKey và thiết lập mã hóa!', 'success');
            // Gọi onSessionReady cho từng handler
            for (const h of this.handlers) {
                if (typeof h.onSessionReady === 'function') h.onSessionReady();
            }
            return;
        }
        // Phân phối message cho từng handler
        for (const h of this.handlers) {
            if (typeof h.handleMessage === 'function') h.handleMessage(data);
        }
    }
}
// ==== Ví dụ handler cho mỏ ====
class HeavenMineHandler {
    constructor() {
        this.client = null;
        this.myName = null;
        this.mineList = [];
        this.claimInterval = null;
        this.apiClient = new MongTuTienAPIClient();
        this.initialized = false;
        this.errorCount = 0;
    }
    setClient(client) { this.client = client; }
    async ensureCharacterName() {
        if (!this.myName) {
            const charInfo = await this.apiClient.getCharacterInfo(this.client.cookie);
            if (charInfo && charInfo.name) {
                this.myName = charInfo.name;
                this.client.log(`[AUTO] Đã lấy tên nhân vật từ API: ${this.myName}`, 'success');
                } else {
                this.client.log('Không thể lấy tên nhân vật từ API!', 'warning');
            }
        }
    }
    async onSessionReady() {
        if (!this.initialized) {
            await this.ensureCharacterName();
            this.initialized = true;
        }
        this.startLoop();
    }
    startLoop() {
        const doListAndClaim = () => {
            this.client.safeSend('hongmong:status');
            setTimeout(() => this.client.safeSend('hongmong:top'), 300);
            setTimeout(() => this.client.safeSend('heavenmine:status'), 600);
            setTimeout(() => {
                this.client.safeSend('heavenmine:list');
                this.client.log('[SEND] Gửi lệnh lấy danh sách mỏ...', 'info');
            }, 1000);
        };
        doListAndClaim();
        this.claimInterval = setInterval(doListAndClaim, 120000);
    }
    async handleMessage(data) {
        // Xử lý lỗi xác thực
        if (data.error && (data.error.includes('cookie') || data.error.includes('xác thực') || data.error.includes('401'))) {
            this.errorCount++;
            if (this.errorCount > 3) {
                this.client.log('Lỗi xác thực quá nhiều lần, dừng chức năng mỏ.', 'error');
                if (this.claimInterval) clearInterval(this.claimInterval);
                return;
            }
            this.client.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
            const newCookie = await getCookieAutoShared();
            if (newCookie) {
                this.client.cookie = newCookie;
                this.apiClient.cookie = newCookie;
                this.errorCount = 0;
                this.client.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                // Gửi lại lệnh lấy danh sách mỏ
                this.client.safeSend('heavenmine:list');
                            } else {
                this.client.log('Không lấy lại được cookie mới.', 'error');
            }
            return;
        }
        if (data.type === 'heavenmine:list' && Array.isArray(data.payload)) {
            this.mineList = data.payload;
            const myMines = this.mineList.filter(mine =>
                mine.ownerId && (mine.ownerId.name || '').toLowerCase() === (this.myName || '').toLowerCase()
            );
            this.client.log(`[RECV] Đã nhận danh sách mỏ của bạn (${myMines.length} mỏ).`, 'info');
            let claimMines = myMines.filter(mine =>
                mine.accumulated && (mine.accumulated.spiritStones > 0 || mine.accumulated.wifeEssence > 0)
            );
            if (myMines.length === 0) {
                this.client.log('Không có mỏ nào thuộc về bạn!', 'warning');
            } else if (claimMines.length === 0) {
                this.client.log('Không có tài nguyên nào để nhận ở các mỏ của bạn.', 'info');
            } else {
                this.client.log(`Sẽ nhận tài nguyên ở ${claimMines.length} mỏ sau 2 giây...`, 'info');
                setTimeout(() => {
                    for (const mine of claimMines) {
                        let info = `Mỏ Lv${mine.level} | +${mine.accumulated.spiritStones} linh thạch, +${mine.accumulated.wifeEssence} tín vật. Đang nhận...`;
                        this.client.log(info, 'claim');
                        this.client.safeSend('heavenmine:claim');
                    }
                }, 2000);
            }
        }
        if (data.type === 'heavenmine:claim:success') {
            this.client.log('Đã nhận tài nguyên mỏ thành công!', 'success');
        }
        if (data.type === 'warn' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('Chưa thể nhận!')) {
            this.client.log(`⚠️ ${data.payload.text}`, 'warning');
        }
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.client.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
    }
}

// ==== Ví dụ handler cho boss cá nhân ====
class PersonalBossHandler {
    constructor() {
        this.client = null;
        this.userId = null;
        this.bossList = [];
        this.attackQueue = [];
        this.isAttacking = false;
        this.listInterval = null;
        this.errorCount = 0;
    }
    setClient(client) { this.client = client; }
    onSessionReady() {
        this.client.safeSend('personal:boss:list');
        this.client.log('[SEND] Gửi lệnh lấy danh sách boss cá nhân...', 'info');
        this.listInterval = setInterval(() => {
            this.client.safeSend('personal:boss:list');
            this.client.log('[SEND] Gửi lệnh lấy danh sách boss cá nhân...', 'info');
        }, 60000);
    }
    async handleMessage(data) {
        // Xử lý lỗi xác thực
        if (data.error && (data.error.includes('cookie') || data.error.includes('xác thực') || data.error.includes('401'))) {
            this.errorCount++;
            if (this.errorCount > 3) {
                this.client.log('Lỗi xác thực quá nhiều lần, dừng chức năng boss cá nhân.', 'error');
                if (this.listInterval) clearInterval(this.listInterval);
                return;
            }
            this.client.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
            const newCookie = await getCookieAutoShared();
            if (newCookie) {
                this.client.cookie = newCookie;
                this.errorCount = 0;
                this.client.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                this.client.safeSend('personal:boss:list');
                        } else {
                this.client.log('Không lấy lại được cookie mới.', 'error');
            }
                            return;
                        }
        if (data.type === 'personal:boss:list' && Array.isArray(data.payload)) {
            this.client.log(`[RECV] Đã nhận danh sách boss cá nhân (${data.payload.length} boss).`, 'info');
            this.bossList = data.payload;
            const now = Date.now();
            for (const boss of this.bossList) {
                let status = '';
                if (!boss.spawnedAt || (boss.spawnedAt && new Date(boss.spawnedAt).getTime() <= now)) {
                    if (boss.currentHp > 0) {
                        status = 'Có thể tấn công';
                    } else {
                        status = 'Đã chết';
                    }
                } else {
                    const ms = new Date(boss.spawnedAt).getTime() - now;
                    const min = Math.floor(ms / 60000);
                    const sec = Math.floor((ms % 60000) / 1000);
                    status = `Hồi sinh sau ${min} phút ${sec.toString().padStart(2, '0')} giây`;
                }
                this.client.log(`PersonalBoss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} | ${status}`,'info');
            }
            // Lọc boss đã hồi sinh và chưa chết
            this.attackQueue = this.bossList.filter(boss => {
                const timeLeft = boss.spawnedAt ? Math.max(0, new Date(boss.spawnedAt).getTime() - now) : 0;
                return (!boss.spawnedAt || timeLeft <= 0) && boss.currentHp > 0;
            });
            if (this.attackQueue.length > 0 && !this.isAttacking) {
                this.attackNextBoss();
            } else if (this.attackQueue.length === 0) {
                this.client.log('Không có boss cá nhân nào sẵn sàng để đánh. Chờ boss mới hồi sinh...', 'info');
            }
        }
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.client.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
    }
    attackNextBoss() {
        if (this.isAttacking || !this.attackQueue || this.attackQueue.length === 0) {
            this.isAttacking = false;
            return;
        }
        this.isAttacking = true;
        const boss = this.attackQueue.shift();
        if (!boss) {
            this.isAttacking = false;
            return;
        }
        this.client.log(`[SEND] Gửi lệnh tấn công boss cá nhân: ${boss.name} (ID: ${boss.id})`,'attack');
        this.client.safeSend('personal:boss:attack', { bossId: boss.id });
        setTimeout(() => {
            this.isAttacking = false;
            this.attackNextBoss();
        }, 5000);
    }
}

// ==== Handler cho boss pet ====
class PetBossHandler {
    constructor() {
        this.client = null;
        this.userId = null;
        this.bossList = [];
        this.attackQueue = [];
        this.isAttacking = false;
        this.listInterval = null;
        this.errorCount = 0;
    }
    setClient(client) { this.client = client; }
    onSessionReady() {
        this.client.safeSend('personal:pet:boss:list');
        this.listInterval = setInterval(() => {
            this.client.safeSend('personal:pet:boss:list');
        }, 60000);
    }
    async handleMessage(data) {
        // Xử lý lỗi xác thực
        if (data.error && (data.error.includes('cookie') || data.error.includes('xác thực') || data.error.includes('401'))) {
            this.errorCount++;
            if (this.errorCount > 3) {
                this.client.log('Lỗi xác thực quá nhiều lần, dừng chức năng boss pet.', 'error');
                if (this.listInterval) clearInterval(this.listInterval);
                return;
            }
            this.client.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
            const newCookie = await getCookieAutoShared();
            if (newCookie) {
                this.client.cookie = newCookie;
                this.errorCount = 0;
                this.client.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                this.client.safeSend('personal:pet:boss:list');
        } else {
                this.client.log('Không lấy lại được cookie mới.', 'error');
            }
            return;
        }
        if (data.type === 'personal:pet:boss:list' && Array.isArray(data.payload)) {
            this.client.log(`[RECV] Đã nhận danh sách boss pet cá nhân (${data.payload.length} boss).`, 'info');
            this.bossList = data.payload;
            const now = Date.now();
            for (const boss of this.bossList) {
                let status = '';
                if (!boss.spawnedAt || (boss.spawnedAt && new Date(boss.spawnedAt).getTime() <= now)) {
                    if (boss.currentHp > 0) {
                        status = 'Có thể tấn công';
                    } else {
                        status = 'Đã chết';
                    }
                } else {
                    const ms = new Date(boss.spawnedAt).getTime() - now;
                    const min = Math.floor(ms / 60000);
                    const sec = Math.floor((ms % 60000) / 1000);
                    status = `Hồi sinh sau ${min} phút ${sec.toString().padStart(2, '0')} giây`;
                }
                this.client.log(`PetBoss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} | ${status}`,'info');
            }
            // Lọc boss đã hồi sinh và chưa chết
            this.attackQueue = this.bossList.filter(boss => {
                const timeLeft = boss.spawnedAt ? Math.max(0, new Date(boss.spawnedAt).getTime() - now) : 0;
                return (!boss.spawnedAt || timeLeft <= 0) && boss.currentHp > 0;
            });
            if (this.attackQueue.length > 0 && !this.isAttacking) {
                this.attackNextBoss();
            } else if (this.attackQueue.length === 0) {
                this.client.log('Không có boss pet cá nhân nào sẵn sàng để đánh. Chờ boss mới hồi sinh...', 'info');
            }
        }
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.client.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
    }
    attackNextBoss() {
        if (this.isAttacking || !this.attackQueue || this.attackQueue.length === 0) {
            this.isAttacking = false;
            return;
        }
        this.isAttacking = true;
        const boss = this.attackQueue.shift();
        if (!boss) {
            this.isAttacking = false;
            return;
        }
        this.client.log(`[SEND] Gửi lệnh tấn công boss pet cá nhân: ${boss.name} (ID: ${boss.id})`,'attack');
        this.client.safeSend('personal:boss:attack', { bossId: boss.id });
        setTimeout(() => {
            this.isAttacking = false;
            this.attackNextBoss();
        }, 5000);
    }
}

// ==== Handler cho boss đạo lữ ====
class WifeBossHandler {
    constructor() {
        this.client = null;
        this.userId = null;
        this.bossList = [];
        this.attackQueue = [];
        this.isAttacking = false;
        this.listInterval = null;
        this.errorCount = 0;
    }
    setClient(client) { this.client = client; }
    onSessionReady() {
        this.client.safeSend('personal:wife:boss:list');
        this.listInterval = setInterval(() => {
            this.client.safeSend('personal:wife:boss:list');
        }, 60000);
    }
    async handleMessage(data) {
        // Xử lý lỗi xác thực
        if (data.error && (data.error.includes('cookie') || data.error.includes('xác thực') || data.error.includes('401'))) {
            this.errorCount++;
            if (this.errorCount > 3) {
                this.client.log('Lỗi xác thực quá nhiều lần, dừng chức năng boss đạo lữ.', 'error');
                if (this.listInterval) clearInterval(this.listInterval);
                return;
            }
            this.client.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
            const newCookie = await getCookieAutoShared();
            if (newCookie) {
                this.client.cookie = newCookie;
                this.errorCount = 0;
                this.client.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                this.client.safeSend('personal:wife:boss:list');
            } else {
                this.client.log('Không lấy lại được cookie mới.', 'error');
            }
            return;
        }
        if (data.type === 'personal:wife:boss:list' && Array.isArray(data.payload)) {
            this.client.log(`[RECV] Đã nhận danh sách boss đạo lữ (${data.payload.length} boss).`, 'info');
            this.bossList = data.payload;
            const now = Date.now();
            for (const boss of this.bossList) {
                let status = '';
                if (!boss.spawnedAt || (boss.spawnedAt && new Date(boss.spawnedAt).getTime() <= now)) {
                    if (boss.currentHp > 0) {
                        status = 'Có thể tấn công';
                    } else {
                        status = 'Đã chết';
                    }
                } else {
                    const ms = new Date(boss.spawnedAt).getTime() - now;
                    const min = Math.floor(ms / 60000);
                    const sec = Math.floor((ms % 60000) / 1000);
                    status = `Hồi sinh sau ${min} phút ${sec.toString().padStart(2, '0')} giây`;
                }
                this.client.log(`WifeBoss: ${boss.name} | HP: ${boss.currentHp.toLocaleString()} / ${boss.maxHp.toLocaleString()} | ${status}`,'info');
            }
            // Lọc boss đã hồi sinh và chưa chết
            this.attackQueue = this.bossList.filter(boss => {
                const timeLeft = boss.spawnedAt ? Math.max(0, new Date(boss.spawnedAt).getTime() - now) : 0;
                return (!boss.spawnedAt || timeLeft <= 0) && boss.currentHp > 0;
            });
            if (this.attackQueue.length > 0 && !this.isAttacking) {
                this.attackNextBoss();
            } else if (this.attackQueue.length === 0) {
                this.client.log('Không có boss đạo lữ nào sẵn sàng để đánh. Chờ boss mới hồi sinh...', 'info');
            }
        }
        if (data.type === 'system' && data.payload && typeof data.payload.text === 'string' && data.payload.text.includes('🎁 Từ')) {
            this.client.log(`[THƯỞNG] ${data.payload.text}`, 'reward');
        }
    }
    attackNextBoss() {
        if (this.isAttacking || !this.attackQueue || this.attackQueue.length === 0) {
            this.isAttacking = false;
            return;
        }
        this.isAttacking = true;
        const boss = this.attackQueue.shift();
        if (!boss) {
            this.isAttacking = false;
            return;
        }
        this.client.log(`[SEND] Gửi lệnh tấn công boss đạo lữ: ${boss.name} (ID: ${boss.id})`,'attack');
        this.client.safeSend('personal:boss:attack', { bossId: boss.id });
        setTimeout(() => {
            this.isAttacking = false;
            this.attackNextBoss();
        }, 5000);
    }
}
// ==== Menu chọn nhiều chức năng (giao diện đẹp, rõ ràng) ====
async function mainMultiFeatureWS() {
    const apiClient = new MongTuTienAPIClient();
    let cookie = await apiClient.getCookieAuto();
    if (!cookie) {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        cookie = await new Promise(resolve => {
            rl.question('Nhập cookie (nuxt-session): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });
    }
    // Hiển thị menu đẹp
    const menuLines = [
        '1. Thu thập mỏ',
        '2. Đánh boss cá nhân',
        '3. Đánh boss pet',
        '4. Đánh boss đạo lữ',
        '5. Đánh tháp',
        '',
        'Nhập nhiều số, cách nhau bởi dấu phẩy (vd: 1,2,3):'
    ];
    console.log(prettyBox('CHỌN CHỨC NĂNG WS ĐA NHIỆM', menuLines, 'cyan'));
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Chọn chức năng: ', async (answer) => {
        const choices = answer.split(',').map(s => s.trim()).filter(Boolean);
        if (choices.length === 0) {
            console.log(colors.red('Bạn chưa chọn chức năng nào!'));
            rl.close();
            return mainMultiFeatureWS();
        }
        // Hiển thị lại xác nhận lựa chọn (bỏ xác nhận y/n, chạy luôn)
        const features = {
            heavenmine: choices.includes('1'),
            personalBoss: choices.includes('2'),
            petBoss: choices.includes('3'),
            wifeBoss: choices.includes('4'),
            tower: choices.includes('5')
        };
        const featuresMap = {
            '1': 'Thu thập mỏ',
            '2': 'Đánh boss cá nhân',
            '3': 'Đánh boss pet',
            '4': 'Đánh boss đạo lữ',
            '5': 'Đánh tháp'
        };
        const selected = choices.map(c => featuresMap[c] || c).join(', ');
        console.log(prettyBox('ĐANG CHẠY', [selected], 'green'));
        rl.close();
        const client = new MultiFeatureWebSocketClient(cookie, features);
        if (features.heavenmine) client.registerHandler(new HeavenMineHandler());
        if (features.personalBoss) client.registerHandler(new PersonalBossHandler());
        if (features.petBoss) client.registerHandler(new PetBossHandler());
        if (features.wifeBoss) client.registerHandler(new WifeBossHandler());
        if (features.tower) client.registerHandler(new TowerHandler());
        await client.connect();
        process.on('SIGINT', () => {
            if (client.ws) client.ws.close();
            process.exit(0);
        });
    });
}

// ====== Đoạn thực thi mẫu để chạy độc lập ======
if (require.main === module) {
    (async () => {
        const apiClient = new MongTuTienAPIClient();
        let cookie = await apiClient.getCookieAuto();
        if (!cookie) {
            const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
            cookie = await new Promise(resolve => {
                rl.question('Nhập cookie (nuxt-session): ', (input) => {
                    rl.close();
                    resolve(input.trim());
                });
            });
        }
        // Tự động chọn tất cả các chức năng 1,2,3,4,5
        const features = {
            heavenmine: true,
            personalBoss: true,
            petBoss: true,
            wifeBoss: true,
            tower: true
        };
        const client = new MultiFeatureWebSocketClient(cookie, features);
        client.registerHandler(new HeavenMineHandler());
        client.registerHandler(new PersonalBossHandler());
        client.registerHandler(new PetBossHandler());
        client.registerHandler(new WifeBossHandler());
        client.registerHandler(new TowerHandler());
        await client.connect();
        process.on('SIGINT', () => {
            if (client.ws) client.ws.close();
            process.exit(0);
        });
    })();
} 

class TowerHandler {
    constructor() {
        this.client = null;
        this.currentFloor = 1;
        this.isChallenging = false;
        this.infoInterval = null;
        this.challengeTimeout = null;
        this.errorCount = 0;
    }
    setClient(client) { this.client = client; }
    onSessionReady() {
        this.client.safeSend('tower:info', {});
        this.client.safeSend('tower:ranking', {});
        this.infoInterval = setInterval(() => {
            this.client.safeSend('tower:info', {});
            this.client.safeSend('tower:ranking', {});
        }, 60000);
    }
    async handleMessage(data) {
        // Xử lý lỗi xác thực
        if (data.error && (data.error.includes('cookie') || data.error.includes('xác thực') || data.error.includes('401'))) {
            this.errorCount++;
            if (this.errorCount > 3) {
                this.client.log('Lỗi xác thực quá nhiều lần, dừng chức năng tháp.', 'error');
                if (this.infoInterval) clearInterval(this.infoInterval);
                if (this.challengeTimeout) clearTimeout(this.challengeTimeout);
                return;
            }
            this.client.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
            const newCookie = await getCookieAutoShared && await getCookieAutoShared();
            if (newCookie) {
                this.client.cookie = newCookie;
                this.errorCount = 0;
                this.client.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                this.client.safeSend('tower:info', {});
            } else {
                this.client.log('Không lấy lại được cookie mới.', 'error');
            }
            return;
        }
        if (data.type === 'tower:info' && data.payload && data.payload.floor) {
            const floor = data.payload.floor;
            const monster = data.payload.monster;
            this.currentFloor = floor;
            this.client.log(`[THÁP] Tầng ${floor} - Gặp ${monster ? monster.name : '???'}`,'info');
            if (!this.isChallenging) {
                this.challengeFloor(floor);
            }
        }
        if (data.type === 'tower:ranking' && Array.isArray(data.payload)) {
            this.client.log(`[THÁP] Top 10 xếp hạng tháp:`, 'info');
            data.payload.slice(0, 10).forEach((item, idx) => {
                this.client.log(`  #${idx+1}: ${item.name || 'Ẩn danh'} (Lv${item.level || '?'}, ${item.realm || '?'})`, 'info');
            });
        }
        if (data.type === 'log' && Array.isArray(data.payload)) {
            data.payload.filter(l => l.type === 'tower').forEach(l => {
                const clean = this.cleanTowerLog(l.text);
                if (clean) this.client.log(`[THÁP] ${clean}`, this.highlightType(clean));
            });
        }
    }
    challengeFloor(floor) {
        this.isChallenging = true;
        this.client.log(`[THÁP] Gửi lệnh khiêu chiến tầng ${floor}...`, 'attack');
        this.client.safeSend('tower:challenge', { floor });
        if (this.challengeTimeout) clearTimeout(this.challengeTimeout);
        this.challengeTimeout = setTimeout(() => {
            this.isChallenging = false;
            this.client.safeSend('tower:info', {});
        }, 15000); // 15s mỗi lần
    }
    // Lọc và làm đẹp log tháp
    cleanTowerLog(html) {
        if (!html) return '';
        // Loại bỏ thẻ img, div, span, b, i, class, style, chỉ giữ text
        let text = html
            .replace(/<img[^>]*>/g, '')
            .replace(/<div[^>]*>/g, '')
            .replace(/<span[^>]*>/g, '')
            .replace(/<b[^>]*>/g, '')
            .replace(/<i[^>]*>/g, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        // Làm nổi bật các sự kiện quan trọng
        text = text.replace(/(CHÍ MẠNG!|ĐÒN HIỂM!|Vượt tầng|thành công trấn áp|hấp thụ [\d,\.]+ sinh lực|hồi phục [\d,\.]+ điểm|cướp đoạt [\d,\.]+ sinh lực)/g, (m) => m.toUpperCase());
        return text;
    }
    // Xác định loại log để đổi màu
    highlightType(text) {
        if (/CHÍ MẠNG|ĐÒN HIỂM|trấn áp|VƯỢT TẦNG|thành công/.test(text)) return 'success';
        if (/hấp thụ|hồi phục|cướp đoạt/.test(text)) return 'reward';
        if (/né tránh|tránh được|hóa giải|không gây sát thương|ra đòn hụt/.test(text)) return 'warning';
        return 'info';
    }
} 