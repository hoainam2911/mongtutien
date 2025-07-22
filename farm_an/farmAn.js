const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const { DateTime } = require('luxon');

class FarmAnAPIClient {
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
        this.errorCount = 0; // Đếm lỗi liên tiếp để reset cookie
        this.kickedCount = 0; // Đếm lỗi bị đá để chuyển map
        this.noLogCount = 0; // Đếm lỗi "Không tìm thấy log trong phản hồi"
        this.currentMapKey = null;
        this.mainMapKey = null;
        this.fallbackMapKey = null;
        this.cookie = null;
        this.mapList = {
            1: "linh-coc",
            2: "tu-tien-lam",
            3: "thien-canh",
            4: "thien-son",
            5: "thien-ha",
            6: "thien-gioi",
            7: "thien-dia",
            8: "than-ma",
            9: "cultivate"
        };
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString().bold;
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [✓] ${msg.bold.green}`);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${this.formatCustomLog(msg).bold.magenta}`);
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

    formatCustomLog(msg) {
        return msg
            .replace(/<span class='text-yellow-300 font-bold'>([\d]+)<\/span>/g, (match, num) => num.bold.yellow)
            .replace(/<span class='text-blue-300 font-semibold'>(.*?)<\/span>/g, (match, text) => text.bold.blue)
            .replace(/<span class='text-cyan-300 font-semibold'>(.*?)<\/span>/g, (match, text) => text.bold.cyan)
            .replace(/<span class='text-emerald-400 font-semibold'>(.*?)<\/span>/g, (match, text) => text.bold.green);
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString().bold;
            process.stdout.write(`[${timestamp}] [*] ${`Chờ ${i} giây để tiếp tục...`.bold.cyan}\r`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        process.stdout.write('\r');
    }

    async getCookie() {
        const url = "https://mongtutien.online/api/auth/login";
        const payload = {
            "email": "phanhoainam.work@gmail.com",
            "password": "hoaina1234"
        };
        try {
            this.log('Đang cố gắng lấy cookie từ API...', 'info');
            const response = await axios.post(url, payload, { headers: this.baseHeaders, maxRedirects: 0 });
            if (response.headers['set-cookie']) {
                const cookie = response.headers['set-cookie'][0].split(';')[0].replace('nuxt-session=', '');
                fs.writeFileSync(path.join(__dirname, 'data.txt'), cookie);
                this.cookie = cookie;
                this.log('Lấy cookie thành công và ghi vào data.txt', 'success');
                this.errorCount = 0;
                this.kickedCount = 0;
                this.noLogCount = 0;
                this.log(`Reset errorCount về 0 sau khi lấy cookie`, 'info');
                this.log(`Reset kickedCount về 0 sau khi lấy cookie`, 'info');
                this.log(`Reset noLogCount về 0 sau khi lấy cookie`, 'info');
                return true;
            } else {
                this.errorCount++;
                this.log(`Không tìm thấy cookie trong phản hồi API, errorCount = ${this.errorCount}`, 'error');
                return false;
            }
        } catch (error) {
            this.errorCount++;
            this.log(`Lỗi khi lấy cookie: ${JSON.stringify(error, null, 2)}, errorCount = ${this.errorCount}`, 'error');
            return false;
        }
    }

    async getCharacterInfo() {
        if (!this.cookie) {
            this.log('Chưa có cookie, đang lấy từ API...', 'warning');
            if (!await this.getCookie()) return null;
        }
        const url = "https://mongtutien.online/api/character/me";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${this.cookie}`
            };
            const response = await axios.get(url, { headers, responseType: 'json' });
            if (response.status === 200) {
                const { character } = response.data;
                this.errorCount = 0; // Reset errorCount khi thành công
                this.noLogCount = 0;
                this.log(`Reset errorCount về 0 sau khi lấy thông tin nhân vật`, 'info');
                this.log(`Reset noLogCount về 0 sau khi lấy thông tin nhân vật`, 'info');
                this.log(`========== Thông tin nhân vật ==========`, 'custom');
                this.log(`Tên: ${character.name}`.bold.yellow, 'info');
                this.log(`Cấp: ${character.level}`.bold.cyan, 'info');
                this.log(`Vị trí: ${character.location}`.bold.cyan, 'info');
                this.log(`Vàng: ${character.gold.toString().cyan}`.bold.cyan, 'info');
                this.log(`Linh thạch: ${character.spiritStone.toString().cyan}`.bold.cyan, 'info');
                this.log(`Kinh nghiệm: ${character.exp}/${character.nextRealm.exp} (${((character.exp / character.nextRealm.exp) * 100).toFixed(2)}%)`.bold.cyan, 'info');
                this.log(`errorCount hiện tại: ${this.errorCount}`, 'info');
                this.log(`kickedCount hiện tại: ${this.kickedCount}`, 'info');
                this.log(`noLogCount hiện tại: ${this.noLogCount}`, 'info');
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
                this.errorCount++;
                this.log(`Không thể lấy thông tin nhân vật: Status ${response.status}, Chi tiết: ${JSON.stringify(response.data, null, 2)}, errorCount = ${this.errorCount}`, 'error');
                return null;
            }
        } catch (error) {
            this.errorCount++;
            this.log(`Lỗi khi lấy thông tin nhân vật: ${JSON.stringify(error, null, 2)}, errorCount = ${this.errorCount}`, 'error');
            return null;
        }
    }

    async leaveExplore() {
        if (!this.cookie) return false;
        const url = "https://mongtutien.online/api/explore/leave";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${this.cookie}`
            };
            const response = await axios.post(url, {}, { headers, responseType: 'json' });
            if (response.status === 200) {
                this.log('Thoát bí cảnh hiện tại thành công', 'success');
                this.errorCount = 0; // Reset errorCount khi thành công
                this.noLogCount = 0;
                this.log(`Reset errorCount về 0 sau khi thoát bí cảnh`, 'info');
                this.log(`Reset noLogCount về 0 sau khi thoát bí cảnh`, 'info');
                return true;
            } else {
                this.errorCount++;
                this.log(`Không thể thoát bí cảnh: Status ${response.status}, Chi tiết: ${JSON.stringify(response.data, null, 2)}, errorCount = ${this.errorCount}`, 'error');
                return false;
            }
        } catch (error) {
            this.errorCount++;
            this.log(`Lỗi khi thoát bí cảnh: ${JSON.stringify(error, null, 2)}, errorCount = ${this.errorCount}`, 'error');
            return false;
        }
    }

    async enterExplore(mapKey) {
        if (!this.cookie) return null;
        const url = "https://mongtutien.online/api/explore/enter";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${this.cookie}`
            };
            const payload = { key: mapKey };
            const response = await axios.post(url, payload, { headers, responseType: 'json' });
            const data = response.data;
            if (response.status === 200 && data && data.state) {
                const { state, logs } = data;
                this.log(`Vào bí cảnh ${this.getMapName(mapKey)} thành công, trừ ${this.getSpiritStoneCost(mapKey).toLocaleString()} linh thạch`, 'success');
                this.errorCount = 0; // Reset errorCount khi thành công
                this.noLogCount = 0;
                this.log(`Reset errorCount về 0 sau khi vào bí cảnh thành công`, 'info');
                this.log(`Reset noLogCount về 0 sau khi vào bí cảnh thành công`, 'info');
                if (Array.isArray(logs)) {
                    logs.forEach(log => {
                        this.log(log.text, 'custom');
                        if (log.text.includes("bị đánh") || log.text.includes("bị tấn công") || log.text.includes("bị đánh bại")) {
                            this.errorCount++;
                            this.log(`Bị đánh! errorCount = ${this.errorCount}`, 'error');
                        }
                    });
                } else {
                    this.noLogCount++;
                    this.errorCount++;
                    this.log(`Không tìm thấy log trong phản hồi, noLogCount = ${this.noLogCount}, errorCount = ${this.errorCount}`, 'warning');
                    if (this.noLogCount >= 5) {
                        this.log(`Không tìm thấy log ${this.noLogCount} lần liên tiếp, thoát bí cảnh và chuyển về map chính...`, 'warning');
                        await this.leaveExplore();
                        this.currentMapKey = this.mainMapKey;
                        this.noLogCount = 0;
                        this.kickedCount = 0;
                        this.log(`Reset noLogCount về 0 sau khi thoát bí cảnh`, 'info');
                        this.log(`Reset kickedCount về 0 sau khi thoát bí cảnh`, 'info');
                        return null;
                    }
                }
                return state;
            } else {
                this.errorCount++;
                this.log(`Không thể vào bí cảnh: Status ${response.status}, Chi tiết: ${JSON.stringify(response.data, null, 2)}, errorCount = ${this.errorCount}`, 'error');
                return null;
            }
        } catch (error) {
            this.errorCount++;
            this.log(`Lỗi khi vào bí cảnh: ${JSON.stringify(error, null, 2)}, errorCount = ${this.errorCount}`, 'error');
            if (error.response && error.response.data && error.response.data.error === "Bạn đang ở một bí cảnh khác") {
                this.log('Tài khoản đang ở bí cảnh khác, đang thử thoát...', 'warning');
                const leaveSuccess = await this.leaveExplore();
                if (leaveSuccess) {
                    this.log('Thử vào lại bí cảnh...', 'info');
                    return await this.enterExplore(mapKey);
                }
            }
            return null;
        }
    }

    async tickExplore(mapKey) {
        if (!this.cookie) return null;
        const url = "https://mongtutien.online/api/explore/tick";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${this.cookie}`,
                "Accept": "*/*"
            };
            const response = await axios.get(url, { headers, responseType: 'json' });
            const data = response.data;
            if (response.status === 200 && data && data.state) {
                const { logs, state } = data;
                const timeLeft = DateTime.fromISO(state.mapState.endsAt).diff(DateTime.now(), ['hours', 'minutes', 'seconds']).toObject();
                this.errorCount = 0; // Reset errorCount khi thành công
                this.noLogCount = 0;
                this.log(`Reset errorCount về 0 sau khi tick bí cảnh thành công`, 'info');
                this.log(`Reset noLogCount về 0 do có log hợp lệ`, 'info');
                this.log(`========== Thông tin nhân vật ==========`, 'custom');
                this.log(`Tên: ${state.name}`.bold.yellow, 'info');
                this.log(`Cấp: ${state.level}`.bold.cyan, 'info');
                this.log(`Vị trí: ${this.getMapName(state.mapState.key)}`.bold.cyan, 'info');
                this.log(`Vàng: ${state.gold.toString().cyan}`.bold.cyan, 'info');
                this.log(`Linh thạch: ${state.spiritStone.toString().cyan}`.bold.cyan, 'info');
                this.log(`Kinh nghiệm: ${state.exp}/${state.nextRealm.exp} (${((state.exp / state.nextRealm.exp) * 100).toFixed(2)}%)`.bold.cyan, 'info');
                this.log(`Thời gian còn lại: ${Math.floor(timeLeft.hours)}h ${Math.floor(timeLeft.minutes)}m ${Math.floor(timeLeft.seconds)}s`.bold.green, 'info');
                if (Array.isArray(logs)) {
                    logs.forEach(log => {
                        this.log(log.text, 'custom');
                        if (log.text.includes("bị đánh") || log.text.includes("bị tấn công") || log.text.includes("bị đánh bại")) {
                            this.errorCount++;
                            this.log(`Bị đánh! errorCount = ${this.errorCount}`, 'error');
                        }
                    });
                } else {
                    this.noLogCount++;
                    this.errorCount++;
                    this.log(`Không tìm thấy log trong phản hồi tick, noLogCount = ${this.noLogCount}, errorCount = ${this.errorCount}`, 'warning');
                    if (this.noLogCount >= 5) {
                        this.log(`Không tìm thấy log ${this.noLogCount} lần liên tiếp, thoát bí cảnh và chuyển về map chính...`, 'warning');
                        await this.leaveExplore();
                        this.currentMapKey = this.mainMapKey;
                        this.noLogCount = 0;
                        this.kickedCount = 0;
                        this.log(`Reset noLogCount về 0 sau khi thoát bí cảnh`, 'info');
                        this.log(`Reset kickedCount về 0 sau khi thoát bí cảnh`, 'info');
                        return null;
                    }
                }
                this.log(`errorCount hiện tại: ${this.errorCount}`, 'info');
                this.log(`kickedCount hiện tại: ${this.kickedCount}`, 'info');
                this.log(`noLogCount hiện tại: ${this.noLogCount}`, 'info');
                return { logs, state, timeLeftSeconds: timeLeft.hours * 3600 + timeLeft.minutes * 60 + timeLeft.seconds };
            } else {
                this.errorCount++;
                this.log(`Không thể lấy sự kiện bí cảnh: Status ${response.status}, Chi tiết: ${JSON.stringify(response.data, null, 2)}, errorCount = ${this.errorCount}`, 'error');
                return null;
            }
        } catch (error) {
            const isRateLimitError = error.response && error.response.status === 429 && error.response.data?.message.includes("Hành động quá nhanh");
            const isKickedError = JSON.stringify(error) === '{}';
            if (isKickedError) {
                this.kickedCount++;
                this.errorCount++;
                this.log(`Nhận diện bị đá ra khỏi bí cảnh, kickedCount = ${this.kickedCount}, errorCount = ${this.errorCount}`, 'error');
                if (this.kickedCount >= 2) {
                    this.log(`Bị đá ${this.kickedCount} lần ở ${this.getMapName(this.currentMapKey)}, chuyển sang ${this.getMapName(this.currentMapKey === this.mainMapKey ? this.fallbackMapKey : this.mainMapKey)}...`, 'warning');
                    this.currentMapKey = this.currentMapKey === this.mainMapKey ? this.fallbackMapKey : this.mainMapKey;
                    this.kickedCount = 0;
                    this.noLogCount = 0;
                    this.log(`Reset kickedCount về 0 sau khi chuyển map`, 'info');
                    this.log(`Reset noLogCount về 0 sau khi chuyển map`, 'info');
                    return null;
                }
            } else {
                this.errorCount++;
                this.log(`Lỗi khi lấy sự kiện bí cảnh: ${JSON.stringify(error, null, 2)}, errorCount = ${this.errorCount}`, 'error');
            }
            if (isRateLimitError) {
                const waitTime = error.response.data.waitTime || 5000;
                this.log(`Đang chờ ${waitTime / 1000} giây do quá nhanh...`, 'warning');
                await this.countdown(waitTime / 1000);
                return await this.tickExplore(mapKey);
            }
            return null;
        }
    }

    async tickCultivation() {
        if (!this.cookie) return null;
        const url = "https://mongtutien.online/api/cultivation/tick";
        try {
            const headers = {
                ...this.baseHeaders,
                "Cookie": `nuxt-session=${this.cookie}`,
                "Accept": "*/*"
            };
            const response = await axios.get(url, { headers, responseType: 'json' });
            const data = response.data;
            if (response.status === 200 && data && data.state) {
                const { logs, state } = data;
                this.errorCount = 0; // Reset errorCount khi thành công
                this.noLogCount = 0;
                this.log(`Reset errorCount về 0 sau khi tu luyện thành công`, 'info');
                this.log(`Reset noLogCount về 0 do có log hợp lệ`, 'info');
                this.log(`========== Thông tin nhân vật ==========`, 'custom');
                this.log(`Tên: ${state.name}`.bold.yellow, 'info');
                this.log(`Cấp: ${state.level}`.bold.cyan, 'info');
                this.log(`Vị trí: ${this.getMapName("cultivate")}`.bold.cyan, 'info');
                this.log(`Vàng: ${state.gold.toString().cyan}`.bold.cyan, 'info');
                this.log(`Linh thạch: ${state.spiritStone.toString().cyan}`.bold.cyan, 'info');
                this.log(`Kinh nghiệm: ${state.exp}/${state.nextRealm.exp} (${((state.exp / state.nextRealm.exp) * 100).toFixed(2)}%)`.bold.cyan, 'info');
                if (Array.isArray(logs)) {
                    logs.forEach(log => this.log(log.text, 'custom'));
                } else {
                    this.noLogCount++;
                    this.errorCount++;
                    this.log(`Không tìm thấy log trong phản hồi tu luyện, noLogCount = ${this.noLogCount}, errorCount = ${this.errorCount}`, 'warning');
                    if (this.noLogCount >= 5) {
                        this.log(`Không tìm thấy log ${this.noLogCount} lần liên tiếp, chuyển về map chính...`, 'warning');
                        this.currentMapKey = this.mainMapKey;
                        this.noLogCount = 0;
                        this.kickedCount = 0;
                        this.log(`Reset noLogCount về 0 sau khi chuyển map`, 'info');
                        this.log(`Reset kickedCount về 0 sau khi chuyển map`, 'info');
                        return null;
                    }
                }
                this.log(`errorCount hiện tại: ${this.errorCount}`, 'info');
                this.log(`kickedCount hiện tại: ${this.kickedCount}`, 'info');
                this.log(`noLogCount hiện tại: ${this.noLogCount}`, 'info');
                return { logs, state };
            } else {
                this.errorCount++;
                this.log(`Không thể lấy sự kiện tu luyện: Status ${response.status}, Chi tiết: ${JSON.stringify(response.data, null, 2)}, errorCount = ${this.errorCount}`, 'error');
                return null;
            }
        } catch (error) {
            this.errorCount++;
            this.log(`Lỗi khi lấy sự kiện tu luyện: ${JSON.stringify(error, null, 2)}, errorCount = ${this.errorCount}`, 'error');
            const isRateLimitError = error.response && error.response.status === 429 && error.response.data?.message.includes("Hành động quá nhanh");
            if (isRateLimitError) {
                const waitTime = error.response.data.waitTime || 5000;
                this.log(`Đang chờ ${waitTime / 1000} giây do quá nhanh...`, 'warning');
                await this.countdown(waitTime / 1000);
                return await this.tickCultivation();
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
            "than-ma": "Thần Ma Chi Địa",
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
            "than-ma": 5000000,
            "cultivate": 0
        };
        return costs[mapKey] || 0;
    }

    getAffordableMap(spiritStone) {
        if (this.mainMapKey === "cultivate") return "cultivate";
        const affordableMaps = Object.entries(this.mapList)
            .filter(([key, value]) => value !== "cultivate" && this.getSpiritStoneCost(value) <= spiritStone)
            .sort((a, b) => this.getSpiritStoneCost(b[1]) - this.getSpiritStoneCost(a[1]));
        if (this.mainMapKey && this.getSpiritStoneCost(this.mainMapKey) <= spiritStone) return this.mainMapKey;
        if (this.fallbackMapKey && this.getSpiritStoneCost(this.fallbackMapKey) <= spiritStone) return this.fallbackMapKey;
        return affordableMaps.length > 0 ? affordableMaps[0][1] : "cultivate";
    }

    displayMenu() {
        console.log('\n'.bold.yellow);
        console.log('=== [MENU CHỌN MAP] ==='.bold.yellow);
        console.log('Vui lòng chọn Map chính (và Map phụ nếu cần):'.bold.yellow);
        console.log('Danh sách Map và giá linh thạch:'.bold.yellow);
        for (let [key, value] of Object.entries(this.mapList)) {
            console.log(`${key}. ${this.getMapName(value)} - ${this.getSpiritStoneCost(value).toLocaleString()} linh thạch`.bold.cyan);
        }
        console.log('\n'.bold.yellow);
        console.log('Nhập số tương ứng với Map chính (1-9):'.bold.yellow);
    }

    async selectMaps() {
        this.displayMenu();
        process.stdin.resume();
        return new Promise(resolve => {
            process.stdin.once('data', (data) => {
                const mainChoice = parseInt(data.toString().trim());
                if (this.mapList[mainChoice]) {
                    this.mainMapKey = this.mapList[mainChoice];
                    this.currentMapKey = this.mainMapKey;
                    console.log('\nMap chính đã chọn: '.bold.green + this.getMapName(this.mainMapKey).bold.green);
                    if (this.mainMapKey === "cultivate") {
                        this.fallbackMapKey = null;
                        console.log('Chọn Tu Luyện Thường, không cần chọn Map phụ.'.bold.green);
                        console.log('Bắt đầu chạy tool...\n'.bold.green);
                        process.stdin.pause();
                        resolve();
                    } else {
                        console.log('Nhập số tương ứng với Map phụ (1-8):'.bold.yellow);
                        process.stdin.once('data', (data2) => {
                            const fallbackChoice = parseInt(data2.toString().trim());
                            if (this.mapList[fallbackChoice] && fallbackChoice !== mainChoice && this.mapList[fallbackChoice] !== "cultivate") {
                                this.fallbackMapKey = this.mapList[fallbackChoice];
                                console.log('\nMap phụ đã chọn: '.bold.green + this.getMapName(this.fallbackMapKey).bold.green);
                                console.log('Bắt đầu chạy tool...\n'.bold.green);
                                process.stdin.pause();
                                resolve();
                            } else {
                                console.log('Lựa chọn Map phụ không hợp lệ, trùng Map chính, hoặc là Tu Luyện Thường, vui lòng thử lại.'.bold.red);
                                this.selectMaps().then(resolve);
                            }
                        });
                    }
                } else {
                    console.log('Lựa chọn Map chính không hợp lệ, vui lòng thử lại.'.bold.red);
                    this.selectMaps().then(resolve);
                }
            });
        });
    }

    async main() {
        await this.selectMaps();

        while (true) {
            if (!this.cookie || this.errorCount >= 5) {
                this.log(`Lỗi vượt quá 5 lần hoặc chưa có cookie, đang thử lấy lại từ API... errorCount = ${this.errorCount}`, 'warning');
                if (await this.getCookie()) {
                    this.log('Lấy cookie thành công, tiếp tục chạy tool...', 'success');
                } else {
                    this.log('Lấy cookie thất bại, thử lại sau 5 giây...', 'error');
                    await this.countdown(5);
                    continue;
                }
            }

            const charInfo = await this.getCharacterInfo();
            if (!charInfo) {
                this.log('Không lấy được thông tin nhân vật, thử lại sau 5 giây...', 'error');
                await this.countdown(5);
                continue;
            }

            if (this.mainMapKey === "cultivate") {
                this.log(`Chạy chế độ Tu Luyện Thường`, 'info');
                while (true) {
                    const cultivationResult = await this.tickCultivation();
                    if (!cultivationResult) {
                        this.log(`Lỗi tu luyện, thử lại sau 5 giây...`, 'warning');
                        await this.countdown(5);
                        continue;
                    }
                    await this.countdown(5);
                }
            }

            if (this.currentMapKey !== "cultivate" && charInfo.spiritStone < this.getSpiritStoneCost(this.currentMapKey)) {
                this.log(`Không đủ linh thạch cho ${this.getMapName(this.currentMapKey)}, chuyển sang map khả dụng...`, 'warning');
                this.currentMapKey = this.getAffordableMap(charInfo.spiritStone);
                this.log(`Chuyển sang ${this.getMapName(this.currentMapKey)} (chi phí: ${this.getSpiritStoneCost(this.currentMapKey).toLocaleString()} linh thạch)`, 'info');
            }

            if (this.currentMapKey === "cultivate") {
                this.log(`Chuyển sang tu luyện thường do không đủ linh thạch`, 'info');
                while (true) {
                    const cultivationResult = await this.tickCultivation();
                    if (!cultivationResult) {
                        this.log(`Lỗi tu luyện, thử lại sau 5 giây...`, 'warning');
                        await this.countdown(5);
                        continue;
                    }
                    const newCharInfo = await this.getCharacterInfo();
                    if (newCharInfo) {
                        if (newCharInfo.spiritStone >= this.getSpiritStoneCost(this.mainMapKey)) {
                            this.log(`Đủ linh thạch cho map chính (${this.getMapName(this.mainMapKey)}), chuyển lại...`, 'info');
                            this.currentMapKey = this.mainMapKey;
                            this.kickedCount = 0;
                            this.noLogCount = 0;
                            this.log(`Reset kickedCount về 0 khi quay lại map chính`, 'info');
                            this.log(`Reset noLogCount về 0 khi quay lại map chính`, 'info');
                            break;
                        } else if (this.fallbackMapKey && newCharInfo.spiritStone >= this.getSpiritStoneCost(this.fallbackMapKey)) {
                            this.log(`Đủ linh thạch cho map phụ (${this.getMapName(this.fallbackMapKey)}), chuyển sang map phụ...`, 'info');
                            this.currentMapKey = this.fallbackMapKey;
                            this.kickedCount = 0;
                            this.noLogCount = 0;
                            this.log(`Reset kickedCount về 0 khi chuyển sang map phụ`, 'info');
                            this.log(`Reset noLogCount về 0 khi chuyển sang map phụ`, 'info');
                            break;
                        }
                    }
                    await this.countdown(5);
                }
                continue;
            }

            if (this.kickedCount >= 2) {
                this.log(`Bị đá ${this.kickedCount} lần ở ${this.getMapName(this.currentMapKey)}, chuyển sang ${this.getMapName(this.currentMapKey === this.mainMapKey ? this.fallbackMapKey : this.mainMapKey)}...`, 'warning');
                this.currentMapKey = this.currentMapKey === this.mainMapKey ? this.fallbackMapKey : this.mainMapKey;
                this.kickedCount = 0;
                this.noLogCount = 0;
                this.log(`Reset kickedCount về 0 sau khi chuyển map`, 'info');
                this.log(`Reset noLogCount về 0 sau khi chuyển map`, 'info');
            }

            let state = await this.enterExplore(this.currentMapKey);
            if (!state || !state.mapState) {
                this.log(`Không vào được bí cảnh ${this.getMapName(this.currentMapKey)}, thử lại sau 5 giây...`, 'warning');
                await this.countdown(5);
                continue;
            }

            while (true) {
                const endsAt = DateTime.fromISO(state.mapState.endsAt);
                const timeLeftSeconds = endsAt.diff(DateTime.now(), ['seconds']).seconds;
                if (timeLeftSeconds <= 60) {
                    this.log(`Bí cảnh ${this.getMapName(this.currentMapKey)} sắp kết thúc (${Math.floor(timeLeftSeconds)}s), chuyển về map chính...`, 'info');
                    this.currentMapKey = this.mainMapKey;
                    this.kickedCount = 0;
                    this.noLogCount = 0;
                    this.log(`Reset kickedCount về 0 sau khi bí cảnh kết thúc`, 'info');
                    this.log(`Reset noLogCount về 0 sau khi bí cảnh kết thúc`, 'info');
                    break;
                }

                const tickResult = await this.tickExplore(this.currentMapKey);
                if (!tickResult) {
                    this.log(`Lỗi tick, thử vào lại bí cảnh sau 5 giây...`, 'warning');
                    await this.countdown(5);
                    state = await this.enterExplore(this.currentMapKey);
                    if (!state || !state.mapState) {
                        this.log(`Không vào lại được bí cảnh, thử lại sau...`, 'warning');
                        await this.countdown(5);
                        break;
                    }
                    continue;
                }

                state = tickResult.state;
                await this.countdown(5);
            }
        }
    }
}

const client = new FarmAnAPIClient();
client.main().catch(err => {
    client.log(`Lỗi chính: ${JSON.stringify(err, null, 2)}, errorCount = ${client.errorCount}`, 'error');
    client.main();
});