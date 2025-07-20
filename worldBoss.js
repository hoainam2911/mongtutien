const colors = require('colors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ====== Hàm phụ trợ cần thiết ======
// prettyBox: copy từ mongtutien.js hoặc import nếu dùng chung
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
// cleanupAndExit: copy từ mongtutien.js hoặc import nếu dùng chung
function cleanupAndExit(exitCode = 1, delay = 3000) {
    // Đơn giản hóa cho file riêng lẻ
    setTimeout(() => {
        process.exit(exitCode);
    }, delay);
}
// getCookieAutoShared: nếu cần, import hoặc copy vào đây
// (bạn có thể bổ sung nếu class cần dùng)

// ====== Hàm lấy cookie tự động từ file cookie.txt ======
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

class WorldBossAutoHunter {
    constructor(cookie, logFn = console.log) {
        this.cookie = cookie;
        this.log = (msg, type = 'info') => {
            const now = new Date();
            const time = now.toLocaleTimeString();
            let icon = 'ℹ️';
            let color = 'cyan';
            if (type === 'success') { icon = '🟢'; color = 'green'; }
            else if (type === 'warning') { icon = '🟡'; color = 'yellow'; }
            else if (type === 'error') { icon = '🔴'; color = 'red'; }
            else if (type === 'custom') { icon = '✨'; color = 'magenta'; }
            else if (type === 'attack') { icon = '⚔️'; color = 'blue'; }
            else if (type === 'reward') { icon = '🏆'; color = 'yellow'; }
            else if (type === 'boss') { icon = '👹'; color = 'cyan'; }
            let line = `[${time}] ${icon} ${msg}`;
            if (colors[color]) line = colors[color](line);
            logFn(line);
        };
        this.ws = null;
        this.isRunning = false;
        this.heartbeatInterval = null;
        this.userId = null;
        this.lastLoggedDamageId = null;
        this.rejectedBossIds = new Set();
        this.currentBoss = null;
        this.lastAttackTime = 0;
        this.waitingAttack = false;
        this.bossListTimeout = null;
        this.reconnectTimeout = null;
        this.lastDamage = null;
        this.lastBossId = null;
        this.bossEnded = new Set();
        this.errorCount = 0;
    }
    // --- Toàn bộ methods của class WorldBossAutoHunter ---
    connect() {
        return new Promise((resolve, reject) => {
            const wsUrl = 'wss://mongtutien.online/ws-boss';
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    'Cookie': `nuxt-session=${this.cookie}`
                }
            });
            this.ws.on('open', () => {
                this.log('[Boss] Đã kết nối WebSocket boss!', 'success');
                this.send({ type: 'boss:list' });
                this.heartbeatInterval = setInterval(() => {
                    this.send({ type: 'ping', data: {} });
                }, 10000);
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = null;
                }
                resolve();
            });
            this.ws.on('close', (code, reason) => {
                this.log(`[Boss] Mất kết nối WebSocket boss! Tool sẽ tự động tắt hoàn toàn.`, 'error');
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                if (this.bossListTimeout) clearTimeout(this.bossListTimeout);
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                process.exit(1); // Thoát hoàn toàn, không restart
            });
            this.ws.on('error', (err) => {
                this.log(`[Boss] Lỗi WebSocket boss: ${err.message}. Tool sẽ tự động tắt hoàn toàn.`, 'error');
                if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
                if (this.bossListTimeout) clearTimeout(this.bossListTimeout);
                if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
                process.exit(1); // Thoát hoàn toàn, không restart
            });
        });
    }

    send(obj) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    async start() {
        this.isRunning = true;
        await this.connect();
        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                this.handleMessage(msg);
            } catch (e) {
                this.log(`[Boss] Lỗi parse message: ${e.message}`, 'error');
            }
        });
        // Gửi boss:list đều đặn mỗi 11 giây
        this.autoListInterval = setInterval(() => {
            this.send({ type: 'boss:list' });
        }, 11000);
        // Kiểm tra kết nối sau 30 giây
        setTimeout(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.log(`[Boss] WebSocket không kết nối sau 30s, thoát tool...`, 'error');
                cleanupAndExit(1, 3000);
            } else {
                this.log(`[Boss] WebSocket kết nối ổn định`, 'success');
            }
        }, 30000);
        // Kiểm tra hoạt động sau 60 giây
        setTimeout(() => {
            if (!this.currentBoss && !this.lastAttackTime) {
                this.log(`[Boss] Không có hoạt động boss sau 60s, tiếp tục chờ...`, 'warning');
                setTimeout(() => {
                    this.send({ type: 'boss:list' });
                }, 60000);
            } else {
                this.log(`[Boss] Tool hoạt động bình thường`, 'success');
            }
        }, 60000);
    }

    // Thêm hàm cập nhật currentBoss từ payload nếu có
    updateCurrentBossFromPayload(payload) {
        if (!payload) return;
        // Ưu tiên id, name, máu
        const id = payload.bossId || payload.id || payload._id;
        const name = payload.bossName || payload.name;
        const currentHp = payload.currentHp || payload.hp;
        const maxHp = payload.maxHp || payload.hp;
        if (id && name) {
            this.currentBoss = {
                id,
                name,
                currentHp,
                maxHp
            };
        }
    }

    async handleMessage(msg) {
        let data = msg;
        if (typeof msg === 'string') {
            try { data = JSON.parse(msg); } catch (e) { return; }
        }
        // Xử lý lỗi xác thực
        if (data.error && (data.error.includes('cookie') || data.error.includes('xác thực') || data.error.includes('401'))) {
            this.errorCount++;
            if (this.errorCount > 3) {
                this.log('Lỗi xác thực quá nhiều lần, dừng chức năng boss thế giới.', 'error');
                if (this.ws) this.ws.close();
                return;
            }
            this.log('Lỗi xác thực, đang lấy lại cookie...', 'warning');
            // getCookieAutoShared is not defined in this file, so this part is commented out
            // const newCookie = await getCookieAutoShared();
            // if (newCookie) {
            //     this.cookie = newCookie;
            //     this.errorCount = 0;
            //     this.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
            //     // Reconnect ws
            //     if (this.ws) this.ws.close();
            //     await this.connect();
            // } else {
            //     this.log('Không lấy lại được cookie mới.', 'error');
            // }
            return;
        }
        // Cập nhật currentBoss từ payload nếu có
        if (data.payload) this.updateCurrentBossFromPayload(data.payload);
        // Luôn log dame mỗi lần nhận được, ưu tiên lấy tên boss, máu boss từ payload
        if (data.type === 'boss:attack' && data.payload && data.payload.damage) {
            const damage = data.payload.damage;
            const bossName = data.payload.bossName || (this.currentBoss ? this.currentBoss.name : '');
            const currentHp = data.payload.currentHp || (this.currentBoss ? this.currentBoss.currentHp : undefined);
            const maxHp = data.payload.maxHp || (this.currentBoss ? this.currentBoss.maxHp : undefined);
            // Lọc chỉ log dame của mình
            if (damage > 0 && bossName && data.payload.userId && this.userId && data.payload.userId === this.userId) {
                let lines = [];
                lines.push(`⚔️ Dame của bạn: ${damage.toLocaleString()} | 👹 Boss: ${bossName}`);
                if (typeof currentHp === 'number' && typeof maxHp === 'number')
                    lines.push(`❤️ HP: ${currentHp.toLocaleString()} / ${maxHp.toLocaleString()}`);
                this.log(prettyBox('World Boss', lines, 'blue'), 'attack');
                this.lastDamage = damage;
            }
        }
        // Khi boss kết thúc, log bảng xếp hạng và thưởng đẹp
        if (data.type === 'boss:end' && data.payload && data.payload.bossId) {
            this.bossEnded.add(data.payload.bossId);
            this.lastDamage = 0;
            this.currentBoss = null;
            // Log bảng xếp hạng và thưởng
            const ranking = data.payload.ranking || [];
            const reward = data.payload.reward || {};
            let lines = [];
            if (ranking.length > 0) {
                lines.push('🏅 Bảng xếp hạng:');
                ranking.slice(0,5).forEach((r, i) => {
                    lines.push(` ${i+1}. ${r.name} - ${r.damage.toLocaleString()} dame`);
                });
            }
            if (reward.honor || reward.spiritStone || reward.equipment || reward.item) {
                lines.push('🏆 Thưởng:');
                if (reward.honor) lines.push(`  - Honor: ${reward.honor}`);
                if (reward.spiritStone) lines.push(`  - Linh thạch: ${reward.spiritStone.toLocaleString()}`);
                if (reward.equipment) lines.push(`  - Trang bị: ${reward.equipment}`);
                if (reward.item) lines.push(`  - Vật phẩm: ${reward.item}`);
            }
            this.log(prettyBox('Kết thúc Boss Thế Giới', lines, 'green'), 'reward');
        }
        // Xử lý message log để tìm thông tin damage (luôn log nếu có dame)
        if (data.type === 'log' && data.payload && data.payload.text) {
            const text = data.payload.text;
            const damageMatch = text.match(/(\d+(?:,\d+)*) sát thương/);
            if (damageMatch) {
                const damage = parseInt(damageMatch[1].replace(/,/g, ''));
                const bossName = data.payload.bossName || (this.currentBoss ? this.currentBoss.name : 'Boss');
                const currentHp = data.payload.currentHp || (this.currentBoss ? this.currentBoss.currentHp : undefined);
                const maxHp = data.payload.maxHp || (this.currentBoss ? this.currentBoss.maxHp : undefined);
                if (damage > 0) {
                    if (typeof currentHp === 'number' && typeof maxHp === 'number') {
                        this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName} | HP: ${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`);
                    } else {
                        this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName}`);
                    }
                    this.lastDamage = damage;
                }
            }
        }
        // Xử lý message warn để tìm thông tin damage (luôn log nếu có dame)
        if (data.type === 'warn' && data.payload && data.payload.text) {
            const text = data.payload.text;
            const damageMatch = text.match(/(\d+(?:,\d+)*) sát thương/);
            if (damageMatch) {
                const damage = parseInt(damageMatch[1].replace(/,/g, ''));
                const bossName = data.payload.bossName || (this.currentBoss ? this.currentBoss.name : 'Boss');
                const currentHp = data.payload.currentHp || (this.currentBoss ? this.currentBoss.currentHp : undefined);
                const maxHp = data.payload.maxHp || (this.currentBoss ? this.currentBoss.maxHp : undefined);
                if (damage > 0) {
                    if (typeof currentHp === 'number' && typeof maxHp === 'number') {
                        this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName} | HP: ${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`);
                    } else {
                        this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName}`);
                    }
                    this.lastDamage = damage;
                }
            }
            if (text.includes('đã tham gia một trận Boss khác rồi')) {
                if (this.currentBoss) {
                    this.log(`[Boss] ⚠️ Boss "${this.currentBoss.name}" đang trong trận. Thêm vào danh sách bỏ qua...`, 'warning');
                    this.rejectedBossIds.add(this.currentBoss.id);
                }
                // Không set this.currentBoss = null ở đây
                setTimeout(() => this.send({ type: 'boss:list' }), 10000); // 10 giây
            }
        }
        // Xử lý boss:list như cũ (giữ lại log khi gửi lệnh boss:attack)
        if (data.type === 'boss:list') {
            if (Array.isArray(data.payload)) {
                const bosses = data.payload;
                const now = Date.now();
                const available = bosses.filter(boss => {
                    return !boss.spawnedAt || now >= new Date(boss.spawnedAt).getTime();
                });
                if (available.length === 0) {
                    bosses.forEach(boss => {
                        if (boss.spawnedAt && new Date(boss.spawnedAt).getTime() > now) {
                            const ms = new Date(boss.spawnedAt).getTime() - now;
                            const min = Math.floor(ms / 60000);
                            const sec = Math.floor((ms % 60000) / 1000);
                            this.log(`[Boss] ${boss.name} sẽ hồi sinh sau: ${min} phút ${sec.toString().padStart(2, '0')} giây`);
                        }
                    });
                    this.log('[Boss] Không có boss nào xuất hiện, sẽ kiểm tra lại sau...', 'info');
                    return;
                }
                // Có boss xuất hiện, clear timer nếu có
                if (this.bossListTimeout) {
                    clearTimeout(this.bossListTimeout);
                    this.bossListTimeout = null;
                }
                // Tìm boss không bị từ chối và không phải "Ám Dạ Huyền Hồn"
                const bossToAttack = available.find(boss => 
                    !this.rejectedBossIds.has(boss.id) && boss.name !== 'Ám Dạ Huyền Hồn'
                ) || available.find(boss => !this.rejectedBossIds.has(boss.id)) || available[0];
                // Nếu tất cả boss đều bị từ chối, reset danh sách sau 5 phút
                if (available.every(boss => this.rejectedBossIds.has(boss.id))) {
                    this.log(`[Boss] Tất cả boss đều bị từ chối. Reset danh sách sau 5 phút...`, 'warning');
                    setTimeout(() => {
                        this.rejectedBossIds.clear();
                        this.log(`[Boss] Đã reset danh sách boss bị từ chối`, 'info');
                    }, 300000); // 5 phút
                }
                // Gửi lệnh đánh boss ngay khi nhận được boss:list mới nhất
                this.log(`[Boss] Đánh boss: ${bossToAttack.name} (ID: ${bossToAttack.id})`, 'success');
                this.send({ type: 'boss:attack', payload: { bossId: bossToAttack.id } });
                this.currentBoss = bossToAttack;
                this.lastAttackTime = Date.now();
                this.waitingAttack = false;
                if (this.bossListTimeout) {
                    clearTimeout(this.bossListTimeout);
                    this.bossListTimeout = null;
                }
                this.log(`[Boss] Đã vào trận boss, chờ kết thúc...`, 'info');
            }
        } else if (data.type === 'boss:end') {
            this.log('[Boss] Boss đã kết thúc!', 'success');
            // Log thông tin thưởng nếu có
            if (data.payload) {
                const ranking = data.payload.ranking || [];
                const reward = data.payload.reward || {};
                
                // Tìm vị trí của bạn trong ranking
                const myRank = ranking.findIndex(r => r.userId === this.userId) + 1;
                if (myRank > 0) {
                    this.log(`[Boss] Bạn đứng thứ ${myRank} với ${ranking[myRank-1].damage.toLocaleString()} damage`, 'success');
                }
                
                // Log thưởng
                if (reward.honor || reward.spiritStone || reward.equipment || reward.item) {
                    this.log('[Boss] Nhận thưởng:', 'success');
                    if (reward.honor) this.log(`  - Honor: ${reward.honor}`, 'success');
                    if (reward.spiritStone) this.log(`  - Linh thạch: ${reward.spiritStone.toLocaleString()}`, 'success');
                    if (reward.equipment) this.log(`  - Trang bị: ${reward.equipment}`, 'success');
                    if (reward.item) this.log(`  - Vật phẩm: ${reward.item}`, 'success');
                }
            }
            if (this.bossListTimeout) {
                clearTimeout(this.bossListTimeout);
                this.bossListTimeout = null;
            }
            setTimeout(() => this.send({ type: 'boss:list' }), 6000); // 1 phút
        }
        // Lấy userId từ state nếu chưa có (chỉ log 1 lần)
        if (data.type === 'state' && data.payload && data.payload.userId) {
            if (!this.userId) {
                this.userId = data.payload.userId;
                this.log(`[Boss] Đã lấy userId: ${this.userId}`, 'info');
            } else {
                this.userId = data.payload.userId;
            }
        }
        // Lưu dame khi nhận damage:boss:taken và log ngay nếu có máu boss (luôn log nếu có dame)
        if (data.type === 'damage:boss:taken' && data.payload && typeof data.payload.damageBossTaken === 'number') {
            const damage = data.payload.damageBossTaken;
            const bossName = data.payload.bossName || (this.currentBoss ? this.currentBoss.name : '');
            const currentHp = data.payload.currentHp || (this.currentBoss ? this.currentBoss.currentHp : undefined);
            const maxHp = data.payload.maxHp || (this.currentBoss ? this.currentBoss.maxHp : undefined);
            if (damage > 0) {
                this.lastDamage = damage;
                if (typeof currentHp === 'number' && typeof maxHp === 'number') {
                    this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName} | HP: ${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`);
                } else {
                    this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName}`);
                }
            }
        }
        // Khi nhận boss:state thì log dame và máu boss nếu có dame lưu lại (chỉ log khi dame > 0), sau đó reset lastDamage
        if (data.type === 'boss:state' && data.payload) {
            const bossName = data.payload.name || (this.currentBoss ? this.currentBoss.name : 'Boss');
            const currentHp = data.payload.currentHp || data.payload.hp || (this.currentBoss ? this.currentBoss.currentHp : 0);
            const maxHp = data.payload.maxHp || data.payload.hp || (this.currentBoss ? this.currentBoss.maxHp : 0);
            if (this.lastDamage > 0) {
                this.log(`[Boss] Dame: ${this.lastDamage.toLocaleString()} | Boss: ${bossName} | HP: ${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`);
                this.lastDamage = 0;
            }
        }
        // Khi nhận boss:state, log tổng sát thương trước, dame mới nhất sau
        if (data.type === 'boss:state' && data.payload && this.userId) {
            const boss = data.payload;
            const bossName = boss.name;
            const currentHp = boss.currentHp;
            const maxHp = boss.maxHp;
            // 1. Log tổng sát thương của bạn
            if (Array.isArray(boss.participants)) {
                const me = boss.participants.find(p => p.userId === this.userId);
                if (me) {
                    const sorted = boss.participants.slice().sort((a, b) => b.totalDamage - a.totalDamage);
                    const myRank = sorted.findIndex(p => p.userId === this.userId) + 1;
                    this.log(`[Boss] Tổng sát thương của bạn gây ${me.totalDamage.toLocaleString()} đứng thứ ${myRank}/${boss.participants.length}`);
                }
            }
            // 2. Log dame mới nhất của bạn
            if (Array.isArray(boss.damageLog)) {
                const myLogs = boss.damageLog.filter(log => log.userId === this.userId);
                if (myLogs.length > 0) {
                    const latest = myLogs[myLogs.length - 1];
                    if (latest._id !== this.lastLoggedDamageId) {
                        this.lastLoggedDamageId = latest._id;
                        this.log(`[Boss] Bạn vừa gây ra ${latest.damage.toLocaleString()} dame | Boss: ${bossName} | HP: ${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`);
                    }
                }
            }
        }
        // Thêm xử lý cho message attack để hiển thị damage (chỉ log khi dame > 0 và khác lần trước)
        if (data.type === 'boss:attack' && data.payload) {
            const damage = data.payload.damage;
            const bossName = data.payload.bossName || 'Boss';
            if (damage && damage > 0 && damage !== this.lastDamage) {
                this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName}`);
                this.lastDamage = damage;
            }
        }
        // Xử lý khi thoát khỏi trận Boss thành công (giữ lại)
        if (data.type === 'boss:leave') {
            this.log(`[Boss] ✅ Đã thoát khỏi trận Boss hiện tại`, 'success');
            if (this.bossListTimeout) {
                clearTimeout(this.bossListTimeout);
                this.bossListTimeout = null;
            }
            setTimeout(() => this.send({ type: 'boss:list' }), 6000); // 1 phút
        }
        // Hiển thị damage khi có thông tin từ server (luôn log, không cần kiểm tra dame khác lần trước)
        if (data.type === 'boss:attack' && data.payload && data.payload.damage) {
            const damage = data.payload.damage;
            const bossName = this.currentBoss ? this.currentBoss.name : 'Boss';
            if (damage > 0) {
                this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName}`);
                this.lastDamage = damage;
            }
        }
        // Hiển thị damage khi có message từ server về việc đánh boss (giữ lại, nhưng chỉ log khi dame > 0 và khác lần trước)
        if (data.type === 'system' && data.payload && data.payload.text) {
            const text = data.payload.text;
            const damageMatch = text.match(/(\d+(?:,\d+)*) sát thương/);
            if (damageMatch) {
                const damage = parseInt(damageMatch[1].replace(/,/g, ''));
                const bossName = this.currentBoss ? this.currentBoss.name : 'Boss';
                if (damage > 0 && damage !== this.lastDamage) {
                    this.log(`[Boss] Dame: ${damage.toLocaleString()} | Boss: ${bossName}`);
                    this.lastDamage = damage;
                }
            }
        }
        // Có thể bổ sung các xử lý khác nếu cần
    }

    stop() {
        this.isRunning = false;
        if (this.ws) this.ws.close();
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.autoListInterval) clearInterval(this.autoListInterval);
    }
}

// ====== Đoạn thực thi mẫu để chạy độc lập ======
if (require.main === module) {
    let cookie = getCookieFromFile();
    if (cookie) {
        const hunter = new WorldBossAutoHunter(cookie.trim());
        hunter.start();
    } else {
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('Nhập cookie (nuxt-session): ', async (cookieInput) => {
            rl.close();
            const hunter = new WorldBossAutoHunter(cookieInput.trim());
            await hunter.start();
        });
    }
}

module.exports = WorldBossAutoHunter; 