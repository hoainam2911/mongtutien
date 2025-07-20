const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const WebSocket = require('ws');
const { encryptMessage, decryptMessage, setSessionKeys } = require('./encryption.js');
const fetch = require('node-fetch'); // Thêm ở đầu file
const chromeCookies = require('chrome-cookies-secure');
const { spawn } = require('child_process'); // Thêm để mở tab CMD mới

// Biến để đảm bảo chỉ gọi exit một lần
let isExiting = false;

// Hàm cleanup tổng thể trước khi exit
function cleanupAndExit(exitCode = 1, delay = 3000) {
    if (isExiting) return; // Đảm bảo chỉ gọi một lần
    isExiting = true;
    
    console.log(`\n🔄 Đang dọn dẹp và thoát tool sau ${delay/1000} giây...`);
    
    // Cleanup tất cả timers
    for (let i = 1; i < 1000000; i++) {
        try {
            clearTimeout(i);
            clearInterval(i);
        } catch (e) {
            // Ignore errors
        }
    }
    
    // Cleanup WebSocket connections
    if (global.worldBossHunter && global.worldBossHunter.ws) {
        try {
            global.worldBossHunter.ws.close();
        } catch (e) {
            // Ignore errors
        }
    }
    if (global.personalBossHunter && global.personalBossHunter.ws) {
        try {
            global.personalBossHunter.ws.close();
        } catch (e) {
            // Ignore errors
        }
    }
    
    setTimeout(() => {
        console.log('🚪 Thoát tool...');
        process.exit(exitCode);
    }, delay);
}

// Override process.exit để sử dụng cleanup
const originalExit = process.exit;
process.exit = function(code) {
    if (code !== 0 && !isExiting) {
        cleanupAndExit(code, 3000);
    } else if (!isExiting) {
        originalExit(code);
    }
};

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
        this.selectedMapKey = null; // Lưu bí cảnh đã chọn
        this.errorCount = 0;
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString().bold;
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [✓] ${msg.bold.green}`);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg.bold.magenta}`);
                break;        
            case 'error':
                console.log(`[${timestamp}] [✗] ${msg.bold.red}`);
                break;
            case 'warning':
                console.log(`[${timestamp}] [!] ${msg.bold.yellow}`);
                break;
            default:
                console.log(`[${timestamp}] [ℹ] ${msg.bold.blue}`);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString().bold;
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] ${`Chờ ${i} giây để tiếp tục...`.bold.cyan}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
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
                const newCookie = await getCookieAutoShared();
                if (newCookie) {
                    cookie = newCookie;
                    this.errorCount = 0;
                    this.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                    return await this.getCharacterInfo(cookie);
                } else {
                    this.log('Không lấy lại được cookie mới.', 'error');
                    return null;
                }
            }
            this.log(`Lỗi khi lấy thông tin nhân vật: ${error.message}`, 'error');
            return null;
        }
    }

    async leaveExplore(cookie) {
        const url = "https://mongtutien.online/api/explore/leave";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${cookie}`
            };
            const response = await axios.post(url, {}, { headers, responseType: 'json' });
            if (response.status === 200) {
                this.log('Thoát bí cảnh hiện tại thành công', 'success');
                return true;
            } else {
                this.log(`Không thể thoát bí cảnh: Status ${response.status}`, 'error');
                return false;
            }
        } catch (error) {
            this.log(`Lỗi khi thoát bí cảnh: ${error.message}`, 'error');
            return false;
        }
    }

    async enterExplore(cookie, mapKey) {
        const url = "https://mongtutien.online/api/explore/enter";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${cookie}`
            };
            const payload = { key: mapKey };
            const response = await axios.post(url, payload, { headers, responseType: 'json' });
            const data = response.data;
            if (response.status === 200 && data && data.state) {
                const { state, logs } = data;
                this.log(`Vào bí cảnh ${this.getMapName(mapKey)} thành công, trừ ${this.getSpiritStoneCost(mapKey)} linh thạch`, 'success');
                if (Array.isArray(logs) && logs.length > 0) {
                    logs.forEach(log => this.log(stripHtmlTags(log.text), 'custom'));
                }
                return state;
            } else {
                this.log(`Không thể vào bí cảnh: Status ${response.status}`, 'error');
                this.log(`Response: ${JSON.stringify(data)}`, 'error');
                return null;
            }
        } catch (error) {
            this.log(`Lỗi khi vào bí cảnh: ${error.message}`, 'error');
            if (error.response && error.response.data && error.response.data.error === "Bạn đang ở một bí cảnh khác") {
                this.log('Tài khoản đang ở bí cảnh khác, đang thử thoát...', 'warning');
                const leaveSuccess = await this.leaveExplore(cookie);
                if (leaveSuccess) {
                    this.log('Thử vào lại bí cảnh...', 'info');
                    return await this.enterExplore(cookie, mapKey);
                }
            }
            return null;
        }
    }

    async tickExplore(cookie, mapKey) {
        const url = "https://mongtutien.online/api/explore/tick";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${cookie}`,
                "Accept": "*/*"
            };
            const response = await axios.get(url, { headers, responseType: 'json' });
            const data = response.data;
            if (response.status === 200 && data && data.state) {
                const { logs, state } = data;
                const timeLeft = DateTime.fromISO(state.mapState.endsAt).diff(DateTime.now(), ['hours', 'minutes', 'seconds']).toObject();
                this.log(`Tên: ${state.name}`, 'info');
                this.log(`Cấp: ${state.level}`, 'info');
                this.log(`Vị trí: ${this.getMapName(state.mapState.key)}`, 'info');
                this.log(`Vàng: ${state.gold.toString().cyan}`, 'info');
                this.log(`Linh thạch: ${state.spiritStone.toString().cyan}`, 'info');
                this.log(`Kinh nghiệm: ${state.exp}/${state.nextRealm.exp} (${((state.exp / state.nextRealm.exp) * 100).toFixed(2)}%)`, 'info');
                this.log(`Thời gian còn lại: ${Math.floor(timeLeft.hours)}h ${Math.floor(timeLeft.minutes)}m ${Math.floor(timeLeft.seconds)}s`, 'info');
                if (Array.isArray(logs) && logs.length > 0) {
                    logs.forEach(log => this.log(stripHtmlTags(log.text), 'custom'));
                }
                return { logs, state };
            } else {
                this.log(`Không thể lấy sự kiện bí cảnh: Status ${response.status}`, 'error');
                this.log(`Response: ${JSON.stringify(data)}`, 'error');
                return null;
            }
        } catch (error) {
            this.log(`Lỗi khi lấy sự kiện bí cảnh: ${error.message}`, 'error');
            if (error.response && error.response.data && error.response.data.error === "Quá nhanh, hãy chờ thêm chút.") {
                const waitTime = error.response.data.waitTime || 5000; // Mặc định 5 giây nếu không có waitTime
                this.log(`Đang chờ ${waitTime / 1000} giây do quá nhanh...`, 'warning');
                await this.countdown(waitTime / 1000);
                return await this.tickExplore(cookie, mapKey);
            }
            return null;
        }
    }

    async tickCultivation(cookie) {
        const url = "https://mongtutien.online/api/cultivation/tick";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${cookie}`,
                "Accept": "*/*"
            };
            const response = await axios.get(url, { headers, responseType: 'json' });
            const data = response.data;
            if (response.status === 200 && data && data.state) {
                const { logs, state } = data;
                this.log(`Tên: ${state.name}`, 'info');
                this.log(`Cấp: ${state.level}`, 'info');
                this.log(`Vị trí: ${this.getMapName("cultivate")}`, 'info');
                this.log(`Vàng: ${state.gold.toString().cyan}`, 'info');
                this.log(`Linh thạch: ${state.spiritStone.toString().cyan}`, 'info');
                this.log(`Kinh nghiệm: ${state.exp}/${state.nextRealm.exp} (${((state.exp / state.nextRealm.exp) * 100).toFixed(2)}%)`, 'info');
                if (Array.isArray(logs) && logs.length > 0) {
                    logs.forEach(log => this.log(stripHtmlTags(log.text), 'custom'));
                }
                return { logs, state };
            } else {
                this.log(`Không thể lấy sự kiện tu luyện: Status ${response.status}`, 'error');
                this.log(`Response: ${JSON.stringify(data)}`, 'error');
                return null;
            }
        } catch (error) {
            this.log(`Lỗi khi lấy sự kiện tu luyện: ${error.message}`, 'error');
            if (error.response && error.response.data && error.response.data.error === "Quá nhanh, hãy chờ thêm chút.") {
                const waitTime = error.response.data.waitTime || 5000; // Mặc định 5 giây nếu không có waitTime
                this.log(`Đang chờ ${waitTime / 1000} giây do quá nhanh...`, 'warning');
                await this.countdown(waitTime / 1000);
                return await this.tickCultivation(cookie);
            }
            return null;
        }
    }

    getMapName(mapKey) {
        const mapNames = {
            "linh-coc": "Linh Cốc Cốc",
            "tu-tien-lam": "Tu Tiên Sâm Lâm",
            "thien-canh": "Thiên Cảnh Phong",
            "thien-son": "Thiên Sơn",
            "thien-ha": "Thiên Hạ Hải",
            "thien-gioi": "Thiên Giới Phong",
            "thien-dia": "Thiên Địa Cấm Khu",
            "than-ma-chi-dia": "Thần Ma Chi Địa",
            "cultivate": "Tu Luyện Thường"
        };
        return mapNames[mapKey] || mapKey;
    }

    getSpiritStoneCost(mapKey) {
        const costs = {
            "linh-coc": 10000,
            "tu-tien-lam": 20000,
            "thien-canh": 150000,
            "thien-son": 100000,
            "thien-ha": 500000,
            "thien-gioi": 900000,
            "thien-dia": 500000,
            "than-ma-chi-dia": 5000000
        };
        return costs[mapKey] || 0;
    }

    // Function để lấy cookie từ Chrome
    async getCookieFromChrome() {
        try {
            const cookies = await chromeCookies.getAll('mongtutien.online');
            const nuxtSessionCookie = cookies.find(cookie => cookie.name === 'nuxt-session');
            if (nuxtSessionCookie) {
                console.log('✅ Đã lấy cookie từ Chrome thành công!');
                return nuxtSessionCookie.value;
            } else {
                console.log('❌ Không tìm thấy cookie nuxt-session trong Chrome');
                return null;
            }
        } catch (error) {
            console.log('❌ Lỗi khi lấy cookie từ Chrome:', error.message);
            return null;
        }
    }

    // Function để lấy cookie từ file
    getCookieFromFile() {
        try {
            const cookieFile = path.join(__dirname, 'cookie.txt');
            if (fs.existsSync(cookieFile)) {
                const cookie = fs.readFileSync(cookieFile, 'utf8').split(/\r?\n/)[0].trim(); // Lấy dòng đầu tiên và trim
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

    // Function để lấy cookie tự động (ưu tiên file trước, rồi Chrome)
    async getCookieAuto() {
        console.log('🔄 Đang lấy cookie tự động...');
        // Ưu tiên lấy từ file trước
        let cookie = this.getCookieFromFile();
        if (cookie) return cookie.trim();

        // Nếu không có, thử lấy từ Chrome
        cookie = await this.getCookieFromChrome();
        if (cookie) return cookie.trim();

        // Nếu vẫn không có, yêu cầu nhập thủ công
        console.log('❌ Không thể lấy cookie tự động. Vui lòng nhập thủ công.');
        return null;
    }

    async selectMaps() {
        // Hiển thị menu chọn map chính/phụ với màu sắc đúng yêu cầu
        const colors = require('colors');
        const maps = [
            { key: "linh-coc", name: "Linh Cốc Cốc", cost: 10000 },
            { key: "tu-tien-lam", name: "Tu Tiên Sâm Lâm", cost: 20000 },
            { key: "thien-canh", name: "Thiên Cảnh Phong", cost: 150000 },
            { key: "thien-son", name: "Thiên Sơn", cost: 100000 },
            { key: "thien-ha", name: "Thiên Hạ Hải", cost: 500000 },
            { key: "thien-gioi", name: "Thiên Giới Phong", cost: 900000 },
            { key: "thien-dia", name: "Thiên Địa Cấm Khu", cost: 500000 },
            { key: "than-ma-chi-dia", name: "Thần Ma Chi Địa", cost: 5000000 },
        ];
        console.log('\n' + '========== Chọn bí cảnh =========='.yellow);
        maps.forEach((map, idx) => {
            let nameColored = map.name;
            if (["Linh Cốc Cốc", "Thiên Sơn", "Thiên Địa Cấm Khu", "Thần Ma Chi Địa"].includes(map.name)) nameColored = colors.red(map.name.bold);
            else nameColored = colors.green(map.name.bold);
            console.log(colors.blue(`${idx + 1}.`) + ` ${nameColored} (${map.cost.toLocaleString()} linh thạch)`);
        });
        // Map Tu Luyện Thường
        console.log(colors.blue('9.') + ' ' + colors.yellow('Tu Luyện Thường'.bold) + ' (Không tốn linh thạch)');
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(resolve => {
            rl.question(colors.green('Nhập số để chọn bí cảnh chính (1-9): '), (mainAns) => {
                const mainIdx = parseInt(mainAns) - 1;
                if (mainIdx < 0 || mainIdx > 8) {
                    console.log(colors.red('Lựa chọn không hợp lệ, chọn lại...'));
                    rl.close();
                    resolve(this.selectMaps());
                    return;
                }
                rl.question(colors.green('Nhập số để chọn bí cảnh phụ (1-9, khác bí cảnh chính): '), (subAns) => {
                    const subIdx = parseInt(subAns) - 1;
                    if (subIdx < 0 || subIdx > 8 || subIdx === mainIdx) {
                        console.log(colors.red('Lựa chọn không hợp lệ hoặc trùng bí cảnh chính, chọn lại...'));
                        rl.close();
                        resolve(this.selectMaps());
                        return;
                    }
                    rl.close();
                    // Trả về key map, map Tu Luyện Thường là index 8
                    const mainKey = mainIdx === 8 ? 'cultivate' : maps[mainIdx].key;
                    const subKey = subIdx === 8 ? 'cultivate' : maps[subIdx].key;
                    resolve({ main: mainKey, sub: subKey });
                });
            });
        });
    }

    async main() {
        // Chọn map chính/phụ
        const maps = await this.selectMaps();
        let mainMapKey = maps.main;
        let subMapKey = maps.sub;
        let currentMapKey = mainMapKey;
        let errorCount = 0;
        while (true) {
            // Lấy cookie nếu cần
            if (!this.cookie || this.errorCount >= 10) {
                this.log('Lỗi vượt quá 10 lần hoặc chưa có cookie, đang thử lấy lại từ API...', 'warning');
                if (await this.getCookieAuto()) {
                    this.log('Lấy cookie thành công, tiếp tục chạy tool...', 'success');
                } else {
                    this.log('Lấy cookie thất bại, thử lại sau 5 giây...', 'error');
                    await this.countdown(5);
                    continue;
                }
            }
            const charInfo = await this.getCharacterInfo(this.cookie);
            if (!charInfo) {
                this.log('Không lấy được thông tin nhân vật, thử lại sau 5 giây...', 'error');
                        await this.countdown(5);
                continue;
            }
            this.log(`========== Thông tin nhân vật ==========`, 'custom');
            this.log(`Tên: ${charInfo.name}`, 'info');
            this.log(`Cấp: ${charInfo.level}`, 'info');
            this.log(`Vị trí: ${charInfo.location}`, 'info');
            this.log(`Vàng: ${charInfo.gold}`, 'info');
            this.log(`Linh thạch: ${charInfo.spiritStone}`, 'info');
            this.log(`Kinh nghiệm: ${charInfo.exp}/${charInfo.nextExp} (${((charInfo.exp / charInfo.nextExp) * 100).toFixed(2)}%)`, 'info');
            if (charInfo.spiritStone < this.getSpiritStoneCost(currentMapKey)) {
                this.log(`Không đủ linh thạch cho ${this.getMapName(currentMapKey)}, thử lại sau 5 giây...`, 'warning');
                    await this.countdown(5);
                continue;
                }
            let state = await this.enterExplore(currentMapKey);
                if (!state || !state.mapState) {
                this.log(`Không vào được bí cảnh ${this.getMapName(currentMapKey)}, thử lại sau 5 giây...`, 'warning');
                    await this.countdown(5);
                    continue;
                }
                while (true) {
                const endsAt = require('luxon').DateTime.fromISO(state.mapState.endsAt);
                while (require('luxon').DateTime.now() < endsAt) {
                    const tickResult = await this.tickExplore(currentMapKey);
                    if (!tickResult) {
                        errorCount++;
                        this.log(`Lỗi tick, thử vào lại bí cảnh sau 5 giây... (Lỗi liên tiếp: ${errorCount})`, 'warning');
                            await this.countdown(5);
                        state = await this.enterExplore(currentMapKey);
                            if (!state || !state.mapState) {
                                this.log(`Không vào lại được bí cảnh, thử lại sau...`, 'warning');
                                await this.countdown(5);
                            break;
                        }
                                continue;
                            }
                    state = tickResult.state;
                    // Nếu bị đánh nhiều lần hoặc lỗi liên tiếp, chuyển sang map phụ
                    if (tickResult.logs && tickResult.logs.some(log => log.text.includes('bị đánh'))) {
                        errorCount++;
                        this.log(`Bị đánh! Số lần liên tiếp: ${errorCount}`, 'warning');
                    }
                    if (errorCount >= 2 && currentMapKey === mainMapKey) {
                        this.log(`Bị đánh/lỗi quá nhiều ở ${this.getMapName(mainMapKey)}, chuyển sang ${this.getMapName(subMapKey)}...`, 'warning');
                        currentMapKey = subMapKey;
                        errorCount = 0;
                        break;
                    }
                            await this.countdown(5);
                }
                if (require('luxon').DateTime.now() >= endsAt) {
                    this.log(`Bí cảnh ${this.getMapName(currentMapKey)} đã kết thúc`, 'info');
                    // Nếu đang ở map phụ thì chuyển lại map chính
                    if (currentMapKey === subMapKey) {
                        this.log(`Chuyển về ${this.getMapName(mainMapKey)}...`, 'info');
                        currentMapKey = mainMapKey;
                        errorCount = 0;
                    }
                    break;
                }
            }
        }
    }

    // Thêm method chọn 1 map bí cảnh
    async selectMap() {
        const maps = [
            { key: "linh-coc", name: "Linh Cốc Cốc" },
            { key: "tu-tien-lam", name: "Tu Tiên Sâm Lâm" },
            { key: "thien-canh", name: "Thiên Cảnh Phong" },
            { key: "thien-son", name: "Thiên Sơn" },
            { key: "thien-ha", name: "Thiên Hạ Hải" },
            { key: "thien-gioi", name: "Thiên Giới Phong" },
            { key: "thien-dia", name: "Thiên Địa Cấm Khu" },
            { key: "than-ma-chi-dia", name: "Thần Ma Chi Địa" },
            { key: "cultivate", name: "Tu Luyện Thường" }
        ];
        console.log('\n========== Chọn bí cảnh ==========');
        maps.forEach((map, idx) => {
            console.log(`${idx + 1}. ${map.name}`);
        });
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(resolve => {
            rl.question('Nhập số để chọn bí cảnh (1-9): ', (ans) => {
                const idx = parseInt(ans) - 1;
                if (idx < 0 || idx >= maps.length) {
                    console.log('Lựa chọn không hợp lệ, chọn lại...');
                    rl.close();
                    resolve(this.selectMap());
                    return;
                }
                rl.close();
                resolve(maps[idx].key);
            });
        });
    }
}

class WorldBossAutoHunter {
    constructor(cookie, logFn = console.log) {
        this.cookie = cookie;
        // Sử dụng logFn mới cho log đẹp
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
        this.userId = null; // Sẽ lấy từ server
        this.lastLoggedDamageId = null; // Để tránh log trùng
        this.rejectedBossIds = new Set(); // Lưu ID boss đã bị từ chối
        this.currentBoss = null;
        this.lastAttackTime = 0; // Thời điểm đánh boss gần nhất (ms)
        this.waitingAttack = false; // Đã log "đợi thêm ...s" chưa
        this.bossListTimeout = null; // Timer gửi boss:list
        this.reconnectTimeout = null; // Timer reconnect
        this.lastDamage = null; // Lưu dame cuối cùng
        this.lastBossId = null; // Lưu bossId cuối cùng đã đánh
        this.bossEnded = new Set(); // Lưu các boss đã kết thúc
        this.errorCount = 0;
    }

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
                // Thay vì thoát tool, tiếp tục kiểm tra lại sau 60s nữa
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
            const newCookie = await getCookieAutoShared();
            if (newCookie) {
                this.cookie = newCookie;
                this.errorCount = 0;
                this.log('Đã lấy lại cookie mới, tiếp tục...', 'success');
                // Reconnect ws
                if (this.ws) this.ws.close();
                await this.connect();
            } else {
                this.log('Không lấy lại được cookie mới.', 'error');
            }
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
            if (damage > 0 && bossName) {
                let lines = [];
                lines.push(`⚔️ Dame: ${damage.toLocaleString()} | 👹 Boss: ${bossName}`);
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
                    // Nếu có boss chưa hồi sinh, log thời gian hồi sinh
                    bosses.forEach(boss => {
                        if (boss.spawnedAt && new Date(boss.spawnedAt).getTime() > now) {
                            const ms = new Date(boss.spawnedAt).getTime() - now;
                            const min = Math.floor(ms / 60000);
                            const sec = Math.floor((ms % 60000) / 1000);
                            this.log(`[Boss] ${boss.name} sẽ hồi sinh sau: ${min} phút ${sec.toString().padStart(2, '0')} giây`);
                        }
                    });
                    this.log('[Boss] Không có boss nào xuất hiện, sẽ kiểm tra lại sau...', 'info');
                    if (!this.bossListTimeout) {
                        this.bossListTimeout = setTimeout(() => {
                            this.bossListTimeout = null;
                            this.send({ type: 'boss:list' });
                        }, 60000); // 1 phút
                    }
                } else {
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
                    // Kiểm tra thời gian đánh boss gần nhất
                    const nowMs = Date.now();
                    const timeSinceLastAttack = nowMs - this.lastAttackTime;
                    const waitMs = 6000 - timeSinceLastAttack;
                    const doAttack = () => {
                        this.log(`[Boss] Đánh boss: ${bossToAttack.name} (ID: ${bossToAttack.id})`, 'success');
                        this.send({ type: 'boss:attack', payload: { bossId: bossToAttack.id } });
                        this.currentBoss = bossToAttack;
                        this.lastAttackTime = Date.now();
                        this.waitingAttack = false;
                        // Clear timer khi vào trận
                        if (this.bossListTimeout) {
                            clearTimeout(this.bossListTimeout);
                            this.bossListTimeout = null;
                        }
                        // Không gửi boss:list ngay, chờ boss kết thúc
                        this.log(`[Boss] Đã vào trận boss, chờ kết thúc...`, 'info');
                    };
                    if (timeSinceLastAttack >= 6000) {
                        doAttack();
                    } else {
                        if (!this.waitingAttack) {
                            this.log(`[Boss] Đợi thêm ${(waitMs/1000).toFixed(1)}s để tránh spam đánh boss...`, 'info');
                            this.waitingAttack = true;
                        }
                        setTimeout(doAttack, waitMs);
                    }
                }
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
        // Khi nhận boss:state, log sát thương và máu boss của bạn (giữ lại, nhưng chỉ log khi dame mới)
        if (data.type === 'boss:state' && data.payload) {
            const boss = data.payload;
            const bossName = boss.name;
            const currentHp = boss.currentHp;
            const maxHp = boss.maxHp;
            if (Array.isArray(boss.damageLog)) {
                const myLogs = boss.damageLog.filter(log => log.userId === this.userId);
                if (myLogs.length > 0) {
                    const latest = myLogs[myLogs.length - 1];
                    if (latest._id !== this.lastLoggedDamageId) {
                        this.log(`[Boss] Bạn gây ${latest.damage.toLocaleString()} sát thương | Boss: ${bossName} | HP: ${currentHp.toLocaleString()}/${maxHp.toLocaleString()}`);
                        this.lastLoggedDamageId = latest._id;
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
        // Hiển thị damage khi có thông tin từ server (giữ lại, nhưng chỉ log khi dame > 0 và khác lần trước)
        if (data.type === 'boss:attack' && data.payload && data.payload.damage) {
            const damage = data.payload.damage;
            const bossName = this.currentBoss ? this.currentBoss.name : 'Boss';
            if (damage > 0 && damage !== this.lastDamage) {
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

// Hàm chạy tự động đi boss
async function mainBossAuto() {
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
    
    const hunter = new WorldBossAutoHunter(cookie.trim(), (msg, type) => {
        if (type === 'success') console.log(msg.green);
        else if (type === 'warning') console.log(msg.yellow);
        else if (type === 'error') console.log(msg.red);
        else console.log(msg.cyan);
    });
    global.worldBossHunter = hunter; // Lưu reference để cleanup
    await hunter.start();
    // Dừng lại bằng Ctrl+C
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

async function mainAllAuto(cookie, autoMap) {
    // Biến lưu thời điểm log dame world boss gần nhất
    let lastWorldBossDameLog = 0;
    const bossHunter = new WorldBossAutoHunter(cookie, (msg, type) => {
        const prefix = '[Boss] ';
        // Nếu là log dame world boss thì cập nhật thời gian
        if (msg.includes('[Boss] Dame:')) {
            lastWorldBossDameLog = Date.now();
        }
        if (type === 'success') console.log((prefix + msg).green);
        else if (type === 'warning') console.log((prefix + msg).yellow);
        else if (type === 'error') console.log((prefix + msg).red);
        else console.log((prefix + msg).cyan);
    });
    global.worldBossHunter = bossHunter; // Lưu reference để cleanup
    const personalBossHunter = new PersonalBossAutoHunter(cookie, (msg, type) => {
        const prefix = '[PersonalBoss] ';
        // Nếu vừa log dame world boss < 1.5s thì delay log personal boss
        const now = Date.now();
        const delay = now - lastWorldBossDameLog < 1500 ? 1500 - (now - lastWorldBossDameLog) : 0;
        const logFn = () => {
            if (type === 'success') console.log((prefix + msg).green);
            else if (type === 'warning') console.log((prefix + msg).yellow);
            else if (type === 'error') console.log((prefix + msg).red);
            else console.log((prefix + msg).cyan);
        };
        if (delay > 0) setTimeout(logFn, delay);
        else logFn();
    });
    global.personalBossHunter = personalBossHunter; // Lưu reference để cleanup
    const apiClient = new MongTuTienAPIClient();
    // Chạy Boss World
    console.log('🎯 Khởi động Auto Boss World...');
    bossHunter.start().catch(err => {
        console.log('[Boss] Lỗi khởi động boss hunter:', err);
    });
    // Chạy Boss Cá Nhân
    console.log('⚔️ Khởi động Auto Boss Cá Nhân...');
    personalBossHunter.start().catch(err => {
        console.log('[PersonalBoss] Lỗi khởi động personal boss hunter:', err);
    });
    // Chạy Bí Cảnh
    console.log('🗺️ Khởi động Auto Bí Cảnh...');
    const exploreTask = async () => {
        try {
            let maps = await apiClient.selectMaps();
            let mainMapKey = maps.main;
            let subMapKey = maps.sub;
            let currentMapKey = mainMapKey;
            let errorCount = 0;
            while (true) {
                // Lấy cookie nếu cần
                if (!this.cookie || this.errorCount >= 10) {
                    this.log('Lỗi vượt quá 10 lần hoặc chưa có cookie, đang thử lấy lại từ API...', 'warning');
                    if (await this.getCookieAuto()) {
                        this.log('Lấy cookie thành công, tiếp tục chạy tool...', 'success');
                    } else {
                        this.log('Lấy cookie thất bại, thử lại sau 5 giây...', 'error');
                        await this.countdown(5);
                        continue;
                    }
                }
                const charInfo = await apiClient.getCharacterInfo(this.cookie);
                if (!charInfo) {
                    apiClient.log('Không lấy được thông tin nhân vật, thử lại sau 5 giây...', 'error');
                            await apiClient.countdown(5);
                            continue;
                        }
                if (charInfo.spiritStone < apiClient.getSpiritStoneCost(currentMapKey)) {
                    apiClient.log(`Không đủ linh thạch cho ${apiClient.getMapName(currentMapKey)}, thử lại sau 5 giây...`, 'warning');
                        await apiClient.countdown(5);
                    continue;
                    }
                let state = await apiClient.enterExplore(this.cookie, currentMapKey);
                    if (!state || !state.mapState) {
                    apiClient.log(`Không vào được bí cảnh ${apiClient.getMapName(currentMapKey)}, thử lại sau 5 giây...`, 'warning');
                        await apiClient.countdown(5);
                        continue;
                    }
                    while (true) {
                        const endsAt = require('luxon').DateTime.fromISO(state.mapState.endsAt);
                        while (require('luxon').DateTime.now() < endsAt) {
                        const tickResult = await apiClient.tickExplore(this.cookie, currentMapKey);
                        if (!tickResult) {
                            errorCount++;
                            apiClient.log(`Lỗi tick, thử vào lại bí cảnh sau 5 giây... (Lỗi liên tiếp: ${errorCount})`, 'warning');
                                await apiClient.countdown(5);
                            state = await apiClient.enterExplore(this.cookie, currentMapKey);
                                if (!state || !state.mapState) {
                                apiClient.log(`Không vào lại được bí cảnh, thử lại sau...`, 'warning');
                                    await apiClient.countdown(5);
                                break;
                            }
                                    continue;
                                }
                        state = tickResult.state;
                        // Nếu bị đánh nhiều lần hoặc tick lỗi liên tiếp, chuyển sang map phụ
                        if (tickResult.logs && tickResult.logs.some(log => log.text.includes('bị đánh'))) {
                            errorCount++;
                            apiClient.log(`Bị đánh! Số lần liên tiếp: ${errorCount}`, 'warning');
                        }
                        if (errorCount >= 2 && currentMapKey === mainMapKey) {
                            apiClient.log(`Bị đánh/lỗi quá nhiều ở ${apiClient.getMapName(mainMapKey)}, chuyển sang ${apiClient.getMapName(subMapKey)}...`, 'warning');
                            currentMapKey = subMapKey;
                            errorCount = 0;
                            break;
                        } else if (errorCount >= 2 && currentMapKey === subMapKey) {
                            apiClient.log(`Bị đánh/lỗi quá nhiều ở ${apiClient.getMapName(subMapKey)}, chuyển lại ${apiClient.getMapName(mainMapKey)}...`, 'warning');
                            currentMapKey = mainMapKey;
                            errorCount = 0;
                            break;
                        }
                                await apiClient.countdown(5);
                    }
                    if (require('luxon').DateTime.now() >= endsAt) {
                        apiClient.log(`Bí cảnh ${apiClient.getMapName(currentMapKey)} đã kết thúc`, 'info');
                        // Nếu đang ở map phụ thì chuyển lại map chính
                        if (currentMapKey === subMapKey) {
                            this.log(`Chuyển về ${this.getMapName(mainMapKey)}...`, 'info');
                            currentMapKey = mainMapKey;
                            errorCount = 0;
                        }
                        break;
                    }
                }
            }
        } catch (err) {
            console.log('[Explore] Lỗi khởi động bí cảnh:', err);
        }
    };
    exploreTask().catch(err => {
        console.log('[Explore] Lỗi khởi động bí cảnh:', err);
    });
    console.log('✅ Tất cả chức năng đã khởi động! Dừng bằng Ctrl+C');
    // Xử lý dừng chương trình
    process.on('SIGINT', () => {
        console.log('\n🛑 Đang dừng tất cả chức năng...');
        bossHunter.stop();
        personalBossHunter.stop();
        process.exit(0);
    });
}

async function mainBossAndExplore(cookie, autoMap) {
    const apiClient = new MongTuTienAPIClient();
    let cookieVal = cookie;
    let autoMapVal = autoMap;
    if (!cookieVal) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        cookieVal = await new Promise(resolve => {
            rl.question('Nhập cookie (nuxt-session): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });
    }
    
    console.log('🚀 Khởi động Auto Boss + Bí Cảnh!');
    console.log('📊 Boss World | 🗺️ Bí Cảnh');
    
    // Khởi tạo các client
    const bossHunter = new WorldBossAutoHunter(cookieVal.trim(), (msg, type) => {
        const prefix = '[Boss] ';
        if (type === 'success') console.log((prefix + msg).green);
        else if (type === 'warning') console.log((prefix + msg).yellow);
        else if (type === 'error') console.log((prefix + msg).red);
        else console.log((prefix + msg).cyan);
    });
    global.worldBossHunter = bossHunter; // Lưu reference để cleanup
    
    const exploreClient = new MongTuTienAPIClient();
    
    // Chạy Boss World
    console.log('🎯 Khởi động Auto Boss World...');
    bossHunter.start().catch(err => {
        console.log('[Boss] Lỗi khởi động boss hunter:', err);
    });
    
    // Chạy Bí Cảnh
    console.log('🗺️ Khởi động Auto Bí Cảnh...');
    const exploreTask = async () => {
        try {
            let mapKey = null;
            if (autoMapVal) {
                const maps = [
                    "linh-coc", "tu-tien-lam", "thien-canh", "thien-son", "thien-ha", "thien-gioi", "thien-dia", "than-ma-chi-dia", "cultivate"
                ];
                const idx = parseInt(autoMapVal) - 1;
                if (idx >= 0 && idx < maps.length) mapKey = maps[idx];
            }
            if (!mapKey) {
                const maps = await exploreClient.selectMaps();
                mapKey = maps.main;
                var subMapKey = maps.sub;
            }
            if (!mapKey) {
                console.log('[Explore] Không chọn được bí cảnh, dừng bí cảnh');
                return;
            }
            let state;
            while (true) {
                state = await apiClient.enterExplore(cookieVal, mapKey);
                if (!state || !state.mapState) {
                    console.log('[Explore] Lỗi vào bí cảnh, thử lại sau 5 giây...');
                    await apiClient.countdown(5);
                    continue;
                }
                while (true) {
                    const endsAt = DateTime.fromISO(state.mapState.endsAt);
                    while (DateTime.now() < endsAt) {
                        const tickResult = await apiClient.tickExplore(cookieVal, mapKey);
                        if (tickResult) {
                            state = tickResult.state;
                        } else {
                            console.log('[Explore] Lỗi tick, thử vào lại bí cảnh...');
                            await apiClient.countdown(5);
                            state = await apiClient.enterExplore(cookieVal, mapKey);
                            if (!state || !state.mapState) {
                                console.log('[Explore] Không vào lại được bí cảnh...');
                                await apiClient.countdown(5);
                                continue;
                            }
                        }
                        await apiClient.countdown(5);
                    }
                    console.log(`[Explore] Bí cảnh ${apiClient.getMapName(mapKey)} đã kết thúc, kiểm tra linh thạch...`);
                    // Thoát khỏi bí cảnh trước
                    try {
                        await apiClient.leaveExplore(cookieVal);
                        console.log('[Explore] Đã thoát khỏi bí cảnh');
                    } catch (err) {
                        console.log('[Explore] Lỗi thoát bí cảnh:', err);
                    }
                    const charInfo = await apiClient.getCharacterInfo(cookieVal);
                    if (charInfo && charInfo.spiritStone >= apiClient.getSpiritStoneCost(mapKey)) {
                        console.log(`[Explore] Đủ linh thạch, chạy lại bí cảnh ${apiClient.getMapName(mapKey)}...`);
                        await apiClient.countdown(10);
                        state = await apiClient.enterExplore(cookieVal, mapKey);
                        if (!state || !state.mapState) {
                            console.log('[Explore] Không vào lại được bí cảnh...');
                            await apiClient.countdown(5);
                            continue;
                        }
                    } else {
                        console.log('[Explore] Không đủ linh thạch, dừng bí cảnh...');
                        // Thoát khỏi bí cảnh và dừng
                        try {
                            await apiClient.leaveExplore(cookieVal);
                            console.log('[Explore] Đã thoát khỏi bí cảnh');
                        } catch (err) {
                            console.log('[Explore] Lỗi thoát bí cảnh:', err);
                        }
                        // Dừng vòng lặp bí cảnh
                        return;
                    }
                }
            }
        } catch (err) {
            console.log('[Explore] Lỗi khởi động bí cảnh:', err);
        }
    };
    exploreTask().catch(err => {
        console.log('[Explore] Lỗi khởi động bí cảnh:', err);
    });
    
    console.log('✅ Tất cả chức năng đã khởi động! Dừng bằng Ctrl+C');
    
    // Xử lý dừng chương trình
    process.on('SIGINT', () => {
        console.log('\n🛑 Đang dừng tất cả chức năng...');
        bossHunter.stop();
        process.exit(0);
    });
}

async function mainBossAndPersonalBoss() {
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
    
    console.log('🚀 Khởi động Auto Boss + Boss Cá Nhân!');
    console.log('📊 Boss World | ⚔️ Boss Cá Nhân');
    // Biến lưu thời điểm log dame world boss gần nhất
    let lastWorldBossDameLog = 0;
    // Khởi tạo các client
    const bossHunter = new WorldBossAutoHunter(cookie.trim(), (msg, type) => {
        const prefix = '[Boss] ';
        if (msg.includes('[Boss] Dame:')) {
            lastWorldBossDameLog = Date.now();
        }
        if (type === 'success') console.log((prefix + msg).green);
        else if (type === 'warning') console.log((prefix + msg).yellow);
        else if (type === 'error') console.log((prefix + msg).red);
        else console.log((prefix + msg).cyan);
    });
    global.worldBossHunter = bossHunter; // Lưu reference để cleanup
    const personalBossHunter = new PersonalBossAutoHunter(cookie.trim(), (msg, type) => {
        const prefix = '[PersonalBoss] ';
        const now = Date.now();
        const delay = now - lastWorldBossDameLog < 1500 ? 1500 - (now - lastWorldBossDameLog) : 0;
        const logFn = () => {
            if (type === 'success') console.log((prefix + msg).green);
            else if (type === 'warning') console.log((prefix + msg).yellow);
            else if (type === 'error') console.log((prefix + msg).red);
            else console.log((prefix + msg).cyan);
        };
        if (delay > 0) setTimeout(logFn, delay);
        else logFn();
    });
    global.personalBossHunter = personalBossHunter; // Lưu reference để cleanup
    // Bắt đầu chạy cả hai bot
    await bossHunter.start();
    await personalBossHunter.start();
}

async function mainExploreAndPersonalBoss(cookie, autoMap) {
    const apiClient = new MongTuTienAPIClient();
    let cookieVal = cookie;
    let autoMapVal = autoMap;
    if (!cookieVal) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        cookieVal = await new Promise(resolve => {
            rl.question('Nhập cookie (nuxt-session): ', (input) => {
                rl.close();
                resolve(input.trim());
            });
        });
    }
    console.log('🚀 Khởi động Auto Bí Cảnh + Boss Cá Nhân!');
    console.log('🗺️ Bí Cảnh | ⚔️ Boss Cá Nhân');

    const personalBossHunter = new PersonalBossAutoHunter(cookieVal.trim(), (msg, type) => {
        const prefix = '[PersonalBoss] ';
        if (type === 'success') console.log((prefix + msg).green);
        else if (type === 'warning') console.log((prefix + msg).yellow);
        else if (type === 'error') console.log((prefix + msg).red);
        else console.log((prefix + msg).cyan);
    });
    global.personalBossHunter = personalBossHunter; // Lưu reference để cleanup

    // Chạy Boss Cá Nhân
    console.log('⚔️ Khởi động Auto Boss Cá Nhân...');
    personalBossHunter.start().catch(err => {
        console.log('[PersonalBoss] Lỗi khởi động personal boss hunter:', err);
    });

    // Chạy Bí Cảnh
    console.log('🗺️ Khởi động Auto Bí Cảnh...');
    const exploreTask = async () => {
        try {
            let mapKey = null;
            if (autoMapVal) {
                const maps = [
                    "linh-coc", "tu-tien-lam", "thien-canh", "thien-son", "thien-ha", "thien-gioi", "thien-dia", "than-ma-chi-dia", "cultivate"
                ];
                const idx = parseInt(autoMapVal) - 1;
                if (idx >= 0 && idx < maps.length) mapKey = maps[idx];
            }
            if (!mapKey) {
                const maps = await apiClient.selectMaps();
                mapKey = maps.main;
                var subMapKey = maps.sub;
            }
            if (!mapKey) {
                console.log('[Explore] Không chọn được bí cảnh, dừng bí cảnh');
                return;
            }
            let state;
            while (true) {
                state = await apiClient.enterExplore(cookieVal, mapKey);
                if (!state || !state.mapState) {
                    console.log('[Explore] Lỗi vào bí cảnh, thử lại sau 5 giây...');
                    await apiClient.countdown(5);
                    continue;
                }
                while (true) {
                    const endsAt = DateTime.fromISO(state.mapState.endsAt);
                    while (DateTime.now() < endsAt) {
                        const tickResult = await apiClient.tickExplore(cookieVal, mapKey);
                        if (tickResult) {
                            state = tickResult.state;
                        } else {
                            console.log('[Explore] Lỗi tick, thử vào lại bí cảnh...');
                            await apiClient.countdown(5);
                            state = await apiClient.enterExplore(cookieVal, mapKey);
                            if (!state || !state.mapState) {
                                console.log('[Explore] Không vào lại được bí cảnh...');
                                await apiClient.countdown(5);
                                continue;
                            }
                        }
                        await apiClient.countdown(5);
                    }
                    console.log(`[Explore] Bí cảnh ${apiClient.getMapName(mapKey)} đã kết thúc, kiểm tra linh thạch...`);
                    // Thoát khỏi bí cảnh trước
                    try {
                        await apiClient.leaveExplore(cookieVal);
                        console.log('[Explore] Đã thoát khỏi bí cảnh');
                    } catch (err) {
                        console.log('[Explore] Lỗi thoát bí cảnh:', err);
                    }
                    const charInfo = await apiClient.getCharacterInfo(cookieVal);
                    if (charInfo && charInfo.spiritStone >= apiClient.getSpiritStoneCost(mapKey)) {
                        console.log(`[Explore] Đủ linh thạch, chạy lại bí cảnh ${apiClient.getMapName(mapKey)}...`);
                        await apiClient.countdown(10);
                        state = await apiClient.enterExplore(cookieVal, mapKey);
                        if (!state || !state.mapState) {
                            console.log('[Explore] Không vào lại được bí cảnh...');
                            await apiClient.countdown(5);
                            continue;
                        }
                    } else {
                        console.log('[Explore] Không đủ linh thạch, dừng bí cảnh...');
                        // Thoát khỏi bí cảnh và dừng
                        try {
                            await apiClient.leaveExplore(cookieVal);
                            console.log('[Explore] Đã thoát khỏi bí cảnh');
                        } catch (err) {
                            console.log('[Explore] Lỗi thoát bí cảnh:', err);
                        }
                        // Dừng vòng lặp bí cảnh
                        return;
                    }
                }
            }
        } catch (err) {
            console.log('[Explore] Lỗi khởi động bí cảnh:', err);
        }
    };
    exploreTask().catch(err => {
        console.log('[Explore] Lỗi khởi động bí cảnh:', err);
    });

    console.log('✅ Tất cả chức năng đã khởi động! Dừng bằng Ctrl+C');

    // Xử lý dừng chương trình
    process.on('SIGINT', () => {
        console.log('\n🛑 Đang dừng tất cả chức năng...');
        personalBossHunter.stop();
        process.exit(0);
    });
}

async function mainMenu() {
    // Menu đẹp mắt, căn lề đều, có viền và màu sắc nhẹ nhàng
    const colors = require('colors');
    const menuItems = [
        '1.  Auto đi Boss',
        '2.  Auto Tu Luyện',
        '3.  Auto Bí Cảnh',
        '4.  Auto Boss Cá Nhân',
        '5.  Auto All (Boss + Bí Cảnh + Boss Cá Nhân)',
        '6.  Auto Boss + Bí Cảnh',
        '7.  Auto Boss + Boss Cá Nhân',
        '8.  Auto Bí Cảnh + Boss Cá Nhân',
        '9.  Auto thu thập tài nguyên mỏ',
        '10. Auto Boss Pet Cá Nhân',
        '11. Auto Boss Đạo Lữ',
        '12. Đa nhiệm WS (Mỏ + Boss Cá Nhân + Boss Pet + Boss Đạo Lữ)',
        '0.  Thoát'
    ];
    const title = ' MỘNG TU TIÊN TOOL MENU ';
    const width = Math.max(...menuItems.map(i => i.length), title.length) + 4;
    const border = '═'.repeat(width);
    const pad = (str) => ' '.repeat(Math.floor((width - str.length) / 2)) + str + ' '.repeat(Math.ceil((width - str.length) / 2));
    const showMenu = () => {
        // Border vàng, tiêu đề cyan, menu trắng, hướng dẫn xanh lá
        const borderColor = colors.yellow || ((x) => x);
        const titleColor = colors.cyan || ((x) => x);
        const itemColor = colors.white || ((x) => x);
        const guideColor = colors.green || ((x) => x);
        console.log('\n' + borderColor('╔' + border + '╗'));
        console.log(borderColor('║') + titleColor(pad(title)) + borderColor('║'));
        console.log(borderColor('╠' + border + '╣'));
        menuItems.forEach(item => {
            console.log(borderColor('║ ') + itemColor(item.padEnd(width - 2)) + borderColor(' ║'));
        });
        console.log(borderColor('╚' + border + '╝'));
        console.log(guideColor('Hãy nhập số tương ứng để chọn chế độ. Nhấn 0 hoặc q để thoát.'));
    };
    const promptMenu = () => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('Chọn chế độ: ', async (mode) => {
            rl.close();
            if (mode === '0' || mode.toLowerCase() === 'q') {
                console.log('Đã thoát menu.');
                process.exit(0);
                return;
            }
            if (!['1','2','3','4','5','6','7','8','9','10','11','12'].includes(mode)) {
                console.log('Chế độ không hợp lệ!');
                showMenu();
                promptMenu();
                return;
            }
            // Mở tab CMD mới chạy lại file này với tham số mode
            const cmd = `start cmd /k node mongtutien.js ${mode}`;
            require('child_process').exec(cmd);
            console.log(`Đã mở tab mới cho chế độ ${mode}.`);
            // Hiện lại menu
            showMenu();
            promptMenu();
        });
    };
    showMenu();
    promptMenu();
}

// Xử lý tham số dòng lệnh để chạy chức năng tương ứng
if (require.main === module) {
    process.stdout.write('\uFEFF'); // Ghi BOM UTF-8
    const args = process.argv.slice(2);
    // === BẮT ĐẦU: Đọc mode/map từ cookie.txt nếu không có args ===
    let autoMode = null, autoMainMap = null, autoSubMap = null;
    if (args.length === 0) {
        try {
            const cookieLines = fs.readFileSync(path.join(__dirname, 'cookie.txt'), 'utf8').split(/\r?\n/);
            if (cookieLines.length >= 2) autoMode = cookieLines[1].trim();
            if (cookieLines.length >= 3) autoMainMap = cookieLines[2].trim();
            if (cookieLines.length >= 4) autoSubMap = cookieLines[3].trim();
        } catch (e) {
            // Không có file hoặc lỗi đọc, bỏ qua
        }
    }
    // Nếu có đủ mode, mainMap, subMap thì tự động chạy
    if (args.length === 0 && autoMode && autoMainMap && autoSubMap) {
        (async () => {
            const mode = autoMode;
            if (mode === '1') {
                await mainBossAuto();
            } else if (mode === '2') {
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
                while (true) {
                    const state = await apiClient.tickCultivation(cookie);
                    if (!state) {
                        await apiClient.countdown(5);
                        continue;
                    }
                    await apiClient.countdown(5);
                }
            } else if (mode === '3') {
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
                // Sử dụng autoMainMap và autoSubMap làm lựa chọn map
                let mainMapKey = autoMainMap;
                let subMapKey = autoSubMap;
                if (!mainMapKey || !subMapKey) {
                    const maps = await apiClient.selectMaps();
                    mainMapKey = maps.main;
                    subMapKey = maps.sub;
                }
                if (!mainMapKey || !subMapKey) {
                    apiClient.log('Không chọn được bí cảnh chính hoặc phụ, thoát chương trình', 'error');
                    process.exit(1);
                }
                let currentMapKey = mainMapKey;
                let errorCount = 0;
                let state;
                // === Thêm biến theo dõi exp và thời gian ===
                let lastExp = null;
                let lastExpUpdate = Date.now();
                let isExpTimeout = false;
                let expCheckInterval = setInterval(() => {
                    if (isExpTimeout) return;
                    if (Date.now() - lastExpUpdate > 30000) {
                        isExpTimeout = true;
                        clearInterval(expCheckInterval);
                        apiClient.log('Kinh nghiệm không tăng sau 30 giây, tự động dừng tiến trình!', 'error');
                        process.exit(1);
                    }
                }, 5000);
                // === END biến theo dõi exp ===
                while (true) {
                    if (isExpTimeout) break;
                    if (currentMapKey === "cultivate") {
                        while (true) {
                            if (isExpTimeout) break;
                            state = await apiClient.tickCultivation(cookie);
                            if (state && state.state && typeof state.state.exp === 'number') {
                                if (lastExp === null || state.state.exp > lastExp) {
                                    lastExp = state.state.exp;
                                    lastExpUpdate = Date.now();
                                }
                            }
                            if (!state) {
                                await apiClient.countdown(5);
                                continue;
                            }
                            await apiClient.countdown(5);
                        }
                    } else {
                        state = await apiClient.enterExplore(cookie, currentMapKey);
                        if (isExpTimeout) break;
                        if (!state || !state.mapState) {
                            apiClient.log(`Bỏ qua vào bí cảnh do lỗi, thử lại sau 5 giây...`, 'warning');
                            await apiClient.countdown(5);
                            continue;
                        }
                        while (true) {
                            if (isExpTimeout) break;
                            const endsAt = require('luxon').DateTime.fromISO(state.mapState.endsAt);
                            while (require('luxon').DateTime.now() < endsAt) {
                                if (isExpTimeout) break;
                                const tickResult = await apiClient.tickExplore(cookie, currentMapKey);
                                if (tickResult && tickResult.state && typeof tickResult.state.exp === 'number') {
                                    if (lastExp === null || tickResult.state.exp > lastExp) {
                                        lastExp = tickResult.state.exp;
                                        lastExpUpdate = Date.now();
                                    }
                                }
                                if (!tickResult) {
                                    errorCount++;
                                    apiClient.log('Lỗi tick, thử vào lại bí cảnh sau 5 giây...', 'warning');
                                    await apiClient.countdown(5);
                                    state = await apiClient.enterExplore(cookie, currentMapKey);
                                    if (!state || !state.mapState) {
                                        apiClient.log('Không vào lại được bí cảnh, thử lại sau...', 'warning');
                                        await apiClient.countdown(5);
                                        break;
                                    }
                                } else {
                                    state = tickResult.state;
                                    if (tickResult.logs && tickResult.logs.some(log => log.text.includes('bị đánh'))) {
                                        errorCount++;
                                        apiClient.log(`Bị đánh! Số lần liên tiếp: ${errorCount}`, 'warning');
                                    }
                                }
                                if (errorCount >= 2 && currentMapKey === mainMapKey) {
                                    apiClient.log(`Bị đánh/lỗi quá nhiều ở ${apiClient.getMapName(mainMapKey)}, chuyển sang ${apiClient.getMapName(subMapKey)}...`, 'warning');
                                    currentMapKey = subMapKey;
                                    errorCount = 0;
                                    break;
                                } else if (errorCount >= 2 && currentMapKey === subMapKey) {
                                    apiClient.log(`Bị đánh/lỗi quá nhiều ở ${apiClient.getMapName(subMapKey)}, chuyển lại ${apiClient.getMapName(mainMapKey)}...`, 'warning');
                                    currentMapKey = mainMapKey;
                                    errorCount = 0;
                                    break;
                                }
                                await apiClient.countdown(5);
                            }
                            if (isExpTimeout) break;
                            apiClient.log(`Bí cảnh ${apiClient.getMapName(currentMapKey)} đã kết thúc, kiểm tra linh thạch...`, 'info');
                            const charInfo = await apiClient.getCharacterInfo(cookie);
                            if (charInfo && charInfo.spiritStone >= apiClient.getSpiritStoneCost(currentMapKey)) {
                                apiClient.log(`Đủ linh thạch, đang chạy lại bí cảnh ${apiClient.getMapName(currentMapKey)}...`, 'info');
                                await apiClient.countdown(10);
                                state = await apiClient.enterExplore(cookie, currentMapKey);
                                if (!state || !state.mapState) {
                                    apiClient.log('Không vào lại được bí cảnh, thử lại sau...', 'warning');
                                    await apiClient.countdown(5);
                                    continue;
                                }
                            } else {
                                apiClient.log('Không đủ linh thạch, dừng bí cảnh...', 'warning');
                                try { await apiClient.leaveExplore(cookie); } catch {}
                                clearInterval(expCheckInterval);
                                return;
                            }
                        }
                    }
                }
            } else if (mode === '4') {
                await mainPersonalBossAuto();
            } else if (mode === '5') {
                await mainAllAuto();
            } else if (mode === '6') {
                await mainBossAndExplore();
            } else if (mode === '7') {
                await mainBossAndPersonalBoss();
            } else if (mode === '8') {
                await mainExploreAndPersonalBoss();
            } else if (mode === '9') {
                await mainHeavenMineAutoCollector();
            } else if (mode === '10') {
                await mainPersonalPetBossAuto();
            } else if (mode === '11') {
                await mainPersonalWifeBossAuto();
            } else if (mode === '12') {
                await mainMultiFeatureWS();
            } else {
                console.log('Chế độ không hợp lệ!');
            }
        })();
        return;
    }
    // === KẾT THÚC: Đọc mode/map từ cookie.txt ===
    if (args.length > 0) {
        const mode = args[0];
        (async () => {
        if (mode === '1') {
                await mainBossAuto();
        } else if (mode === '2') {
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
            while (true) {
                    const state = await apiClient.tickCultivation(cookie);
                if (!state) {
                        await apiClient.countdown(5);
                    continue;
                }
                    await apiClient.countdown(5);
            }
        } else if (mode === '3') {
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
                const maps = await apiClient.selectMaps();
                let mainMapKey = maps.main;
                let subMapKey = maps.sub;
                if (!mainMapKey || !subMapKey) {
                    apiClient.log('Không chọn được bí cảnh chính hoặc phụ, thoát chương trình', 'error');
                process.exit(1);
            }
                let currentMapKey = mainMapKey;
                let errorCount = 0;
            let state;
            while (true) {
                    if (currentMapKey === "cultivate") {
                    while (true) {
                            state = await apiClient.tickCultivation(cookie);
                        if (!state) {
                                await apiClient.countdown(5);
                            continue;
                        }
                            await apiClient.countdown(5);
                    }
                } else {
                        state = await apiClient.enterExplore(cookie, currentMapKey);
                    if (!state || !state.mapState) {
                            apiClient.log(`Bỏ qua vào bí cảnh do lỗi, thử lại sau 5 giây...`, 'warning');
                            await apiClient.countdown(5);
                        continue;
                    }
                    while (true) {
                        const endsAt = require('luxon').DateTime.fromISO(state.mapState.endsAt);
                        while (require('luxon').DateTime.now() < endsAt) {
                                const tickResult = await apiClient.tickExplore(cookie, currentMapKey);
                                if (!tickResult) {
                                    errorCount++;
                                    apiClient.log('Lỗi tick, thử vào lại bí cảnh sau 5 giây...', 'warning');
                                    await apiClient.countdown(5);
                                    state = await apiClient.enterExplore(cookie, currentMapKey);
                                if (!state || !state.mapState) {
                                        apiClient.log('Không vào lại được bí cảnh, thử lại sau...', 'warning');
                                        await apiClient.countdown(5);
                                        break;
                                    }
                                } else {
                                    state = tickResult.state;
                                    // Nếu bị đánh, tăng errorCount
                                    if (tickResult.logs && tickResult.logs.some(log => log.text.includes('bị đánh'))) {
                                        errorCount++;
                                        apiClient.log(`Bị đánh! Số lần liên tiếp: ${errorCount}`, 'warning');
                                    }
                                }
                                // Chuyển map khi bị đánh/lỗi liên tiếp 2 lần
                                if (errorCount >= 2 && currentMapKey === mainMapKey) {
                                    apiClient.log(`Bị đánh/lỗi quá nhiều ở ${apiClient.getMapName(mainMapKey)}, chuyển sang ${apiClient.getMapName(subMapKey)}...`, 'warning');
                                    currentMapKey = subMapKey;
                                    errorCount = 0;
                                    break;
                                } else if (errorCount >= 2 && currentMapKey === subMapKey) {
                                    apiClient.log(`Bị đánh/lỗi quá nhiều ở ${apiClient.getMapName(subMapKey)}, chuyển lại ${apiClient.getMapName(mainMapKey)}...`, 'warning');
                                    currentMapKey = mainMapKey;
                                    errorCount = 0;
                                    break;
                                }
                                await apiClient.countdown(5);
                            }
                            apiClient.log(`Bí cảnh ${apiClient.getMapName(currentMapKey)} đã kết thúc, kiểm tra linh thạch...`, 'info');
                            const charInfo = await apiClient.getCharacterInfo(cookie);
                            if (charInfo && charInfo.spiritStone >= apiClient.getSpiritStoneCost(currentMapKey)) {
                                apiClient.log(`Đủ linh thạch, đang chạy lại bí cảnh ${apiClient.getMapName(currentMapKey)}...`, 'info');
                                await apiClient.countdown(10);
                                state = await apiClient.enterExplore(cookie, currentMapKey);
                            if (!state || !state.mapState) {
                                    apiClient.log('Không vào lại được bí cảnh, thử lại sau...', 'warning');
                                    await apiClient.countdown(5);
                                continue;
                            }
                        } else {
                                apiClient.log('Không đủ linh thạch, dừng bí cảnh...', 'warning');
                                try { await apiClient.leaveExplore(cookie); } catch {}
                            return;
                        }
                    }
                }
            }
        } else if (mode === '4') {
                await mainPersonalBossAuto();
        } else if (mode === '5') {
                await mainAllAuto();
        } else if (mode === '6') {
                await mainBossAndExplore();
        } else if (mode === '7') {
                await mainBossAndPersonalBoss();
        } else if (mode === '8') {
                await mainExploreAndPersonalBoss();
            } else if (mode === '9') {
                await mainHeavenMineAutoCollector();
            } else if (mode === '10') {
                await mainPersonalPetBossAuto();
            } else if (mode === '11') {
                await mainPersonalWifeBossAuto();
            } else if (mode === '12') {
                await mainMultiFeatureWS();
            } else {
                console.log('Chế độ không hợp lệ!');
            }
        })();
    } else {
        mainMenu();
    }
}

module.exports = {
    MongTuTienAPIClient,
    WorldBossAutoHunter,
    mainBossAuto,
    PersonalBossAutoHunter,
    mainPersonalBossAuto
};

// Thêm hàm loại bỏ thẻ HTML
function stripHtmlTags(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/<[^>]+>/g, '');
}

// Helper cho log đẹp
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

// ===================== AUTO COLLECT HEAVEN MINE =====================
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

// ===================== AUTO PET BOSS CÁ NHÂN =====================
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

// ===================== AUTO BOSS ĐẠO LỮ =====================
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

// ==== Menu chọn nhiều chức năng ====
async function mainMultiFeatureWS() {
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
    // Menu chọn chức năng
    console.log('\n==== CHỌN CHỨC NĂNG WS ĐA NHIỆM ====');
    console.log('1. Thu thập mỏ');
    console.log('2. Đánh boss cá nhân');
    console.log('3. Đánh boss pet');
    console.log('4. Đánh boss đạo lữ');
    console.log('Nhập nhiều số, cách nhau bởi dấu phẩy (vd: 1,2,3):');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Chọn chức năng: ', async (answer) => {
            rl.close();
        const choices = answer.split(',').map(s => s.trim());
        const features = {
            heavenmine: choices.includes('1'),
            personalBoss: choices.includes('2'),
            petBoss: choices.includes('3'),
            wifeBoss: choices.includes('4')
        };
        const client = new MultiFeatureWebSocketClient(cookie, features);
        // Đăng ký handler theo lựa chọn
        if (features.heavenmine) client.registerHandler(new HeavenMineHandler());
        if (features.personalBoss) client.registerHandler(new PersonalBossHandler());
        if (features.petBoss) client.registerHandler(new PetBossHandler());
        if (features.wifeBoss) client.registerHandler(new WifeBossHandler());
        await client.connect();
        process.on('SIGINT', () => {
            if (client.ws) client.ws.close();
            process.exit(0);
        });
    });
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

// ===================== COOKIE AUTO (DÙNG CHUNG) =====================
async function getCookieAutoShared() {
    const fs = require('fs');
    const path = require('path');
    const axios = require('axios');
    // Ưu tiên lấy từ file data.txt hoặc cookie.txt
    let cookie = null;
    const dataFile = path.join(__dirname, 'data.txt');
    const cookieFile = path.join(__dirname, 'cookie.txt');
    if (fs.existsSync(dataFile)) {
        cookie = fs.readFileSync(dataFile, 'utf8').split(/\r?\n/)[0].trim();
        if (cookie && !cookie.startsWith('#')) {
            console.log('[Cookie] Đã lấy cookie từ data.txt');
            return cookie;
        }
    }
    if (fs.existsSync(cookieFile)) {
        cookie = fs.readFileSync(cookieFile, 'utf8').split(/\r?\n/)[0].trim();
        if (cookie && !cookie.startsWith('#')) {
            console.log('[Cookie] Đã lấy cookie từ cookie.txt');
            return cookie;
        }
    }
    // Nếu không có, thử đăng nhập bằng tài khoản/mật khẩu hardcode
    const url = "https://mongtutien.online/api/auth/login";
    const payload = {
        "email": "phanhoainam.work@gmail.com", // <-- Thay bằng tài khoản của bạn nếu muốn
        "password": "hoaina1234" // <-- Thay bằng mật khẩu của bạn nếu muốn
    };
    try {
        console.log('[Cookie] Đang cố gắng lấy cookie từ API...');
        const response = await axios.post(url, payload, {
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            maxRedirects: 0
        });
        if (response.headers['set-cookie']) {
            const cookieVal = response.headers['set-cookie'][0].split(';')[0].replace('nuxt-session=', '');
            fs.writeFileSync(dataFile, cookieVal);
            console.log('[Cookie] Lấy cookie thành công và ghi vào data.txt');
            return cookieVal;
        } else {
            console.log('[Cookie] Không tìm thấy cookie trong phản hồi API');
            return null;
        }
    } catch (error) {
        console.log('[Cookie] Lỗi khi lấy cookie:', error.message);
        return null;
    }
}
