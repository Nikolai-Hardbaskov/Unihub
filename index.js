/* UniHub — мобильное приложение Университета для SillyTavern
 * Данные хранятся отдельно для каждого чата (chat metadata),
 * настройки — глобально (extension settings).
 */
(function () {
    'use strict';

    const MODULE = 'unihub';
    const OLD_MODULE = 'studyhub'; // перенос данных со старого названия
    const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    const ctx = () => SillyTavern.getContext();

    /* ───────────────────────── журнал ошибок (для телефонов без консоли) ───────────────────────── */
    const LOG = [];
    function logErr(where, ...args) {
        const text = args.map((a) => a instanceof Error ? `${a.message}\n${String(a.stack || '').split('\n').slice(1, 4).join('\n')}`
            : typeof a === 'object' ? (() => { try { return JSON.stringify(a).slice(0, 400); } catch { return String(a); } })() : String(a)).join(' ');
        LOG.unshift({ t: Date.now(), where: String(where).replace('[UniHub]', '').trim(), text });
        if (LOG.length > 60) LOG.length = 60;
        console.warn('[UniHub]', where, ...args);
    }
    window.addEventListener('error', (e) => {
        if (/UniHub|unihub|UniHub|studyhub/.test(`${e.filename} ${e.error?.stack || ''}`)) logErr('Ошибка скрипта', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', (e) => {
        if (/UniHub|unihub|UniHub|studyhub/.test(String(e.reason?.stack || ''))) logErr('Необработанная ошибка', e.reason);
    });

    /* ───────────────────────── настройки ───────────────────────── */

    const DEFAULTS = {
        showFab: true,
        inject: true,
        injectDepth: 2,
        quarterDays: 30,        // длина четверти в реальных днях
        maxStrikes: 10,         // нарушений до отчисления
        lowGpa: 3.0,            // порог низкого среднего балла
        lowGpaDays: 14,         // сколько дней балл может быть низким
        startBalance: 1500,
        stipend: 500,
        stipendMinGpa: 3.5,
        checkInEarlyMin: 10,    // за сколько минут до пары можно отметиться
        deadlineOffsetMin: 5,   // дедлайн — за N минут до следующей пары
        extraTaskHours: 24,
    };

    function cfg() {
        const es = ctx().extensionSettings;
        if (!es[MODULE]) es[MODULE] = es[OLD_MODULE] ? { ...es[OLD_MODULE] } : {};
        for (const [k, v] of Object.entries(DEFAULTS)) if (es[MODULE][k] === undefined) es[MODULE][k] = v;
        return es[MODULE];
    }
    const saveCfg = () => ctx().saveSettingsDebounced?.();

    /* ───────────────────────── утилиты ───────────────────────── */

    const uid = () => Math.random().toString(36).slice(2, 10);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    const money = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₡`;
    const fmtT = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const fmtD = (ts) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const fmtDay = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const pad = (t) => String(t).trim().padStart(5, '0');
    const TIME_RE = /^\d{1,2}:\d{2}$/;
    const dkey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
    const val = (id) => (document.getElementById(id)?.value ?? '').trim();

    function left(ts) {
        const d = ts - Date.now();
        if (d <= 0) return 'срок истёк';
        const m = Math.floor(d / MIN);
        if (m < 60) return `${m} мин`;
        const h = Math.floor(m / 60);
        if (h < 48) return `${h} ч ${m % 60} мин`;
        return `${Math.floor(h / 24)} дн ${h % 24} ч`;
    }
    function hue(str) {
        let h = 0;
        for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        return `hsl(${h % 360} 45% 42%)`;
    }
    const ava = (name, big) => `<span class="sh-ava${big ? ' big' : ''}" style="background:${hue(name)}">${esc(String(name || '?').trim().charAt(0).toUpperCase())}</span>`;
    const badge = (t, cls = '') => t ? `<span class="sh-badge ${cls}">${esc(t)}</span>` : '';
    const empty = (t) => `<div class="sh-empty">${t}</div>`;
    const head = (title, sub = '') => `<div class="sh-head"><button class="sh-icon" data-act="back" aria-label="Назад"><i class="fa-solid fa-chevron-left"></i></button><div><h3>${esc(title)}</h3>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    const toast = (type, msg) => { try { toastr[type](msg, 'UniHub'); } catch { /* нет toastr */ } };

    /* ───────────────────────── справочники ───────────────────────── */

    const DEFAULT_MENU = [
        { title: 'Кровь II группы, охлаждённая', place: 'Бар «Ночная смена»', price: 180, tags: ['кровь'] },
        { title: 'Стейк с кровью XXL', place: 'Столовая №1', price: 220, tags: ['мясо', 'сырое'] },
        { title: 'Боул с лунными травами', place: 'Кафе «Фея»', price: 150, tags: ['веган'] },
        { title: 'Нектар полевых цветов', place: 'Кафе «Фея»', price: 90, tags: ['нектар', 'веган'] },
        { title: 'Эктоплазменный смузи', place: 'Спектр-бар', price: 120, tags: ['эктоплазма'] },
        { title: 'Серный пирог', place: 'Кухня «Преисподняя»', price: 160, tags: ['огнеупорное'] },
        { title: 'Борщ с пампушками', place: 'Столовая №1', price: 130, tags: ['обычное'] },
        { title: 'Сырая морская тарелка', place: 'Русалочья лавка', price: 200, tags: ['рыба', 'сырое'] },
        { title: 'Эмоции в банке: радость', place: 'Эмпат-маркет', price: 250, tags: ['эмоции'] },
        { title: 'Двойной эспрессо', place: 'Кофейня у библиотеки', price: 80, tags: ['обычное', 'веган'] },
    ];
    const DEFAULT_MARKET = [
        { title: '«Анатомия нежити», 3-е изд.', cat: 'Учебники', price: 450, rent: 80, seller: 'Ирвин Кроу', rating: 4.8, verified: true },
        { title: 'Шторы, не пропускающие солнце', cat: 'Мебель', price: 700, rent: 0, seller: 'Мира Ноктюрн', rating: 4.6, verified: true },
        { title: 'Серебростойкие перчатки', cat: 'Оборудование', price: 350, rent: 60, seller: 'Лавка «Полнолуние»', rating: 4.9, verified: true },
        { title: 'Ноутбук с защитой от магических помех', cat: 'Электроника', price: 3200, rent: 400, seller: 'Техно-гоблин Зик', rating: 4.3, verified: false },
        { title: 'Звукоизолированный шкаф для полнолуния', cat: 'Оборудование', price: 1800, rent: 250, seller: 'Грег Ульф', rating: 4.1, verified: true },
        { title: 'Алхимический набор первокурсника', cat: 'Оборудование', price: 950, rent: 150, seller: 'Кафедра алхимии', rating: 5, verified: true },
        { title: 'Кресло-гнездо для крылатых', cat: 'Мебель', price: 1200, rent: 0, seller: 'Селеста Вингс', rating: 4.7, verified: false },
        { title: 'Конспекты по межвидовому праву', cat: 'Учебники', price: 150, rent: 0, seller: 'Оуэн, 4 курс', rating: 4.2, verified: false },
    ];
    const SPECIES = ['Человек', 'Вампир', 'Полувампир', 'Оборотень', 'Полуоборотень', 'Фейри', 'Эльф', 'Демон', 'Полудемон', 'Нефилим', 'Ведьма / колдун', 'Сирена', 'Русалка', 'Призрак', 'Дракон (в облике человека)', 'Кицунэ', 'Гарпия', 'Горгона', 'Суккуб / инкуб', 'Голем'];
    // v: true — способность заметна со стороны
    const ABILITIES = [
        { n: 'Телепатия', v: false }, { n: 'Эмпатия', v: false }, { n: 'Предвидение', v: false }, { n: 'Внушение', v: false },
        { n: 'Регенерация', v: false }, { n: 'Сверхсила', v: false }, { n: 'Сверхскорость', v: false }, { n: 'Невидимость', v: false },
        { n: 'Целительство', v: false }, { n: 'Некромантия', v: false }, { n: 'Чары голоса', v: false }, { n: 'Обострённые чувства', v: false },
        { n: 'Телекинез', v: true }, { n: 'Управление огнём', v: true }, { n: 'Управление водой', v: true }, { n: 'Управление тенями', v: true },
        { n: 'Иллюзии', v: true }, { n: 'Крылья', v: true }, { n: 'Рога / хвост / чешуя', v: true }, { n: 'Светящиеся глаза', v: true },
        { n: 'Видимая аура', v: true }, { n: 'Оборот в зверя', v: true },
    ];
    const NO_ABIL = 'Отсутствуют';
    const MAX_YEAR = 5;
    const MARKET_CATS = ['Учебники', 'Мебель', 'Электроника', 'Оборудование'];
    const CLUBS = ['Клуб ночных астрономов', 'Хор сирен', 'Лига регби оборотней', 'Кружок зельеварения', 'Дебатный клуб «Меж видов»', 'Фотоклуб «Без отражения»'];
    const ROOMS = ['Лаборатория алхимии', 'Звукоизолированная комната (полнолуние)', 'Читальный зал без окон', 'Бассейн с морской водой', 'Огнеупорный тренировочный зал', 'Переговорная'];
    const CHANNELS = { all: 'Все', general: 'Общее', study: 'Учёба', clubs: 'Клубы', dorms: 'Общежития', species: 'Мой вид' };
    const CONSEQ = [
        'Куратор вызывает студента в деканат для объяснений.',
        'Назначена отработка в библиотеке в субботу.',
        'В личное дело внесено письменное предупреждение.',
        'Преподаватель сообщил о нарушении старосте курса.',
    ];
    const FALLBACK_FACULTIES = [
        { name: 'Факультет боевой магии', desc: 'Защитные и атакующие чары, тактика.', source: 'invented' },
        { name: 'Факультет алхимии и зельеварения', desc: 'Трансмутация, эликсиры, яды и противоядия.', source: 'invented' },
        { name: 'Факультет межвидовой медицины', desc: 'Лечение людей, нежити и оборотней.', source: 'invented' },
        { name: 'Факультет некромантии и духов', desc: 'Работа с душами, призраками и порогом смерти.', source: 'invented' },
        { name: 'Факультет межвидового права', desc: 'Законы, договоры и дипломатия между видами.', source: 'invented' },
    ];

    /* ───────────────────────── состояние чата ───────────────────────── */

    function freshState() {
        const c = ctx();
        const now = Date.now();
        return {
            v: 1, auth: false, createdAt: now,
            profile: {
                name: c.name1 || 'Студент', species: '', abilities: '', faculty: '', year: 1, bio: '',
                privacy: { species: true, faculty: true, abilities: false, dating: true },
            },
            faculties: [], schedule: [], enforceFrom: 0, attendance: {}, excuses: {},
            tasks: [], strikes: [], grades: [],
            quarter: { n: 1, start: now }, lowGpaSince: 0, expelled: false, expelReason: '',
            wallet: { balance: cfg().startBalance, history: [], lastStipend: now },
            feed: [], threads: [],
            dating: { mode: 'love', profiles: [], matches: [], fSpecies: '', fAbility: '' },
            menu: DEFAULT_MENU.map((x) => ({ ...x, id: uid() })), orders: [],
            market: DEFAULT_MARKET.map((x) => ({ ...x, id: uid() })), listings: [], inventory: [],
            events: [], clubs: [], bookings: [], tickets: [], dean: [],
            notes: [], pauses: [], pausedAt: 0,
        };
    }

    const migrated = new WeakSet();
    function hasChat() {
        const c = ctx();
        const who = (c.characterId !== undefined && c.characterId !== null) || c.groupId;
        const id = c.chatId || (typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() : null);
        return !!(c.chatMetadata && who && id);
    }
    function S() {
        if (!hasChat()) return null;
        const md = ctx().chatMetadata;
        if (!md[MODULE] && md[OLD_MODULE]) { md[MODULE] = md[OLD_MODULE]; delete md[OLD_MODULE]; }
        if (!md[MODULE]) md[MODULE] = freshState();
        const s = md[MODULE];
        if (!migrated.has(s)) {
            const f = freshState();
            for (const k in f) if (s[k] === undefined) s[k] = f[k];
            migrated.add(s);
        }
        return s;
    }

    let saveTimer = null;
    function save(s) {
        if (s && S() !== s) return;
        updateInjection();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { try { ctx().saveMetadata?.(); } catch (e) { logErr('[UniHub] save', e); } }, 400);
    }

    function notify(s, text, type = 'info') {
        s.notes.unshift({ id: uid(), text, type, t: Date.now(), read: false });
        if (s.notes.length > 120) s.notes.length = 120;
        toast({ warn: 'warning', bad: 'error', important: 'info', info: 'success' }[type] || 'info', text);
    }
    function tx(s, amount, label) {
        s.wallet.balance = Math.round((s.wallet.balance + amount) * 100) / 100;
        s.wallet.history.unshift({ amount, label, t: Date.now() });
        if (s.wallet.history.length > 200) s.wallet.history.length = 200;
    }
    /** Списание с проверкой баланса. Нельзя купить дороже, чем есть на счёте. */
    function pay(s, amount, label) {
        if (s.wallet.balance < amount) {
            toast('error', `Недостаточно средств: нужно ${money(amount)}, на счёте ${money(s.wallet.balance)}.`);
            return false;
        }
        tx(s, -amount, label);
        return true;
    }

    /* ───────────────────────── учёба: расчёты ───────────────────────── */

    const activeStrikes = (s) => s.strikes.filter((k) => !k.fixed && k.q === s.quarter.n);
    const rating = (s) => Math.max(5, Math.round((100 - activeStrikes(s).length * (95 / cfg().maxStrikes)) * 10) / 10);
    const gpa = (s) => (s.grades.length ? s.grades.reduce((a, g) => a + g.grade, 0) / s.grades.length : null);
    const inPause = (s, t) => s.pauses.some(([a, b]) => t >= a && t <= b) || (s.pausedAt && t >= s.pausedAt);

    function inst(cl, day) {
        const [sh, sm] = cl.start.split(':').map(Number);
        const [eh, em] = cl.end.split(':').map(Number);
        const a = new Date(day); a.setHours(sh, sm, 0, 0);
        const b = new Date(day); b.setHours(eh, em, 0, 0);
        return { start: a.getTime(), end: b.getTime() };
    }
    function occurrences(s, from, to) {
        const out = [];
        const d = new Date(from); d.setHours(0, 0, 0, 0);
        while (d.getTime() <= to) {
            const w = (d.getDay() + 6) % 7;
            for (const cl of s.schedule) {
                if (cl.day !== w) continue;
                const o = inst(cl, d);
                if (o.end >= from && o.start <= to) out.push({ cl, ...o, key: `${cl.id}@${dkey(o.start)}` });
            }
            d.setDate(d.getDate() + 1);
        }
        return out.sort((a, b) => a.start - b.start);
    }
    function curNext(s) {
        const now = Date.now();
        const occ = occurrences(s, now - 4 * HOUR, now + 8 * DAY);
        return { cur: occ.find((o) => o.start <= now && o.end > now), next: occ.find((o) => o.start > now) };
    }
    function findOcc(s, key) {
        const [, date] = key.split('@');
        const [y, m, d] = date.split('-').map(Number);
        const day = new Date(y, m - 1, d).getTime();
        return occurrences(s, day, day + DAY - 1).find((o) => o.key === key);
    }

    /* ───────────────────────── ИИ ───────────────────────── */

    const SYS = 'Ты — серверная логика мобильного приложения UniHub внутри ролевой игры. Выполняй задание точно, пиши по-русски, без OOC-комментариев и рассуждений.';

    async function aiRaw(prompt) {
        const c = ctx();
        try {
            if (typeof c.generateRaw === 'function') {
                if (c.generateRaw.length === 0) return await c.generateRaw({ prompt, systemPrompt: SYS });
                return await c.generateRaw(prompt, null, false, false, SYS);
            }
            if (typeof c.generateQuietPrompt === 'function') {
                const q = `${SYS}\n\n${prompt}`;
                if (c.generateQuietPrompt.length === 0) return await c.generateQuietPrompt({ quietPrompt: q });
                return await c.generateQuietPrompt(q, false, true);
            }
        } catch (e) { logErr('[UniHub] AI error', e); }
        return '';
    }
    const stripThink = (t) => String(t || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
    function parseJSON(txt) {
        txt = stripThink(txt).replace(/```(?:json)?/gi, '');
        const cands = [];
        const a = txt.indexOf('['), b = txt.lastIndexOf(']');
        const c = txt.indexOf('{'), d = txt.lastIndexOf('}');
        if (a >= 0 && b > a) cands.push([a, txt.slice(a, b + 1)]);
        if (c >= 0 && d > c) cands.push([c, txt.slice(c, d + 1)]);
        cands.sort((x, y) => x[0] - y[0]);
        for (const [, str] of cands) { try { return JSON.parse(str); } catch { /* следующий */ } }
        return null;
    }
    async function aiJSON(prompt) {
        const raw = await aiRaw(`${prompt}\n\nОтветь ТОЛЬКО валидным JSON, без пояснений и без markdown.`);
        const r = parseJSON(raw);
        if (r === null) logErr('ИИ ответил не в формате JSON', raw ? String(raw).slice(0, 500) : '(пустой ответ — проверьте подключение к API)');
        return r;
    }
    async function aiText(prompt) {
        let t = stripThink(await aiRaw(prompt)).trim();
        t = t.replace(/^["«„]+|["»“]+$/g, '').trim();
        return t.slice(0, 1200);
    }

    function charInfo() {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        let out = `Персонаж истории: ${c.name2 || '—'}.`;
        if (ch) {
            if (ch.description) out += `\nОписание персонажа: ${ch.description.slice(0, 2200)}`;
            if (ch.scenario) out += `\nСценарий: ${ch.scenario.slice(0, 700)}`;
        }
        return out;
    }
    function abilityInfo(p) {
        if (!p.abilities) return 'не указаны';
        if (p.abilities === NO_ABIL) return 'отсутствуют';
        return `${p.abilities} (${p.abilityVisible ? 'заметна окружающим' : 'со стороны не видна'})`;
    }
    /** Как окружающие реагируют на вид и способности пользователя. */
    function reactionGuide(s) {
        const p = s.profile, L = [];
        if (p.species) L.push(`Студенты и преподаватели реагируют на то, что ${p.name} — ${p.species}: в зависимости от своего вида (симпатия, опаска, предрассудки, давнее соперничество видов, любопытство, гастрономический интерес и т.п.)${/^человек$/i.test(p.species) ? '; обычный человек среди сверхъестественных — редкость и повод для удивления' : ''}.`);
        if (p.abilities === NO_ABIL) L.push(`У ${p.name} НЕТ сверхъестественных способностей. Окружающие искренне удивляются этому, переспрашивают, недоумевают, сочувствуют или подшучивают.`);
        else if (p.abilities && p.abilityVisible) L.push(`Способность ${p.name} («${p.abilities}») заметна со стороны: окружающие её видят и реагируют — восхищаются, опасаются, завидуют, задают вопросы.`);
        else if (p.abilities) L.push(`Способность ${p.name} («${p.abilities}») со стороны не видна: окружающие не реагируют на неё, пока она не проявится или ${p.name} сам(а) не расскажет. Если проявилась — реагируют по ситуации.`);
        return L.join(' ');
    }
    function world(s) {
        const p = s.profile;
        return `Мир: университет, где учатся люди, полулюди и сверхъестественные виды.\n${charInfo()}\nСтудент-пользователь: ${p.name}; вид: ${p.species || 'не указан'}; способности: ${abilityInfo(p)}; факультет: ${p.faculty || 'не выбран'}; курс: ${p.year}.\n${reactionGuide(s)}`;
    }
    async function loreText(filterRe) {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        const books = new Set();
        if (ch?.data?.extensions?.world) books.add(ch.data.extensions.world);
        if (c.chatMetadata?.world_info) books.add(c.chatMetadata.world_info);
        const out = [];
        const take = (keys, content) => {
            const t = `${(keys || []).join(', ')}: ${content || ''}`;
            if (!filterRe || filterRe.test(t)) out.push(t);
        };
        for (const name of books) {
            try {
                const data = await c.loadWorldInfo?.(name);
                for (const e of Object.values(data?.entries || {})) take(e.key, e.content);
            } catch (e) { logErr('[UniHub] lorebook', e); }
        }
        for (const e of ch?.data?.character_book?.entries || []) take(e.keys, e.content);
        return out.join('\n').slice(0, 5000);
    }

    // последовательная очередь фоновых запросов к ИИ
    let queue = Promise.resolve();
    function enqueue(s, fn) {
        queue = queue.then(async () => {
            if (S() !== s) return;
            await fn();
            if (S() === s) { save(s); render(); }
        }).catch((e) => logErr('[UniHub]', e));
        return queue;
    }

    /* ───────────────────────── учёба: логика ───────────────────────── */

    async function loadFaculties(s) {
        const lore = await loreText(/факульт|faculty|кафедр|университет|академи|колледж|институт|school|college|department|major/i);
        const r = await aiJSON(`${world(s)}\n\nЛор (лорбук и карточка):\n${lore || '(нет данных)'}\n\nЗадача: определи список факультетов университета. Если факультеты упомянуты в лоре или описании персонажа — используй ИМЕННО их и пометь source "lore". Если информации нет — придумай 5–7 оригинальных факультетов, подходящих этому миру, source "invented".\nФормат: [{"name":"...","desc":"одно предложение","source":"lore"}]`);
        const list = Array.isArray(r) ? r.filter((f) => f && f.name).map((f) => ({ name: String(f.name).slice(0, 80), desc: String(f.desc || '').slice(0, 160), source: f.source === 'lore' ? 'lore' : 'invented' })) : [];
        return list.length ? list : FALLBACK_FACULTIES;
    }

    function fallbackSchedule(fac) {
        const subj = [`Введение в профессию: ${fac}`, 'История сверхъестественных видов', 'Межвидовая этика', 'Практикум способностей', 'Иностранный язык', 'Физическая подготовка', 'Основы безопасности кампуса'];
        const slots = [['09:00', '10:30'], ['10:45', '12:15'], ['13:00', '14:30'], ['14:45', '16:15']];
        const out = [];
        let i = 0;
        for (let d = 0; d < 5; d++) {
            const n = 2 + (d % 2);
            for (let k = 0; k < n; k++) out.push({ day: d, start: slots[k][0], end: slots[k][1], subject: subj[i++ % subj.length], teacher: 'Преподаватель кафедры', room: `Ауд. ${100 + d * 10 + k}` });
        }
        return out;
    }
    async function genSchedule(s, fac) {
        const lore = await loreText(new RegExp(escRe(fac.slice(0, 30)), 'i'));
        const r = await aiJSON(`${world(s)}\n${lore ? `Лор о факультете:\n${lore}\n` : ''}\nСоставь недельное расписание пар для студента ${s.profile.year}-го курса факультета «${fac}». Дни Пн–Сб (day: 0 = понедельник … 5 = суббота), 2–4 пары в день, время между 08:30 и 19:00, пара 60–95 минут, без пересечений. 6–9 разных профильных предметов, подходящих миру; предметы повторяются в течение недели.\nФормат: [{"day":0,"start":"09:00","end":"10:30","subject":"...","teacher":"...","room":"..."}]`);
        const ok = (Array.isArray(r) ? r : []).filter((c) => c && Number.isInteger(+c.day) && +c.day >= 0 && +c.day <= 6
            && TIME_RE.test(String(c.start).trim()) && TIME_RE.test(String(c.end).trim()) && c.subject && pad(c.end) > pad(c.start));
        const list = ok.length >= 4 ? ok : fallbackSchedule(fac);
        return list.map((c) => ({
            id: uid(), day: +c.day, start: pad(c.start), end: pad(c.end),
            subject: String(c.subject).slice(0, 80), teacher: String(c.teacher || '').slice(0, 60), room: String(c.room || '').slice(0, 40),
        }));
    }

    function genTaskDesc(s, t) {
        enqueue(s, async () => {
            const r = await aiJSON(`${world(s)}\n\nПридумай ${t.extra ? 'ДОПОЛНИТЕЛЬНОЕ задание (для исправления нарушений, чуть сложнее обычного)' : 'домашнее задание'} по предмету «${t.subject}». Выполняется письменным ответом на 3–10 предложений: эссе, решение задачи, разбор ситуации, описание ритуала или эксперимента.\nФормат: {"title":"короткое название","desc":"формулировка задания, 2–4 предложения"}`);
            t.title = (r?.title ? `${t.extra ? 'Доп.: ' : ''}${String(r.title).slice(0, 80)}` : t.title);
            t.desc = r?.desc ? String(r.desc).slice(0, 800) : `Письменно ответьте: какие три главные идеи последнего занятия по предмету «${t.subject}» вы усвоили и как примените их на практике?`;
        });
    }

    function issueTask(s, o) {
        const c = cfg();
        const now = Date.now();
        const nx = occurrences(s, o.end + MIN, o.end + 15 * DAY).find((x) => x.cl.subject === o.cl.subject && x.start > o.end);
        let deadline = nx ? nx.start - c.deadlineOffsetMin * MIN : o.end + 3 * DAY;
        deadline = Math.max(deadline, o.end + HOUR, now + HOUR);
        const t = { id: uid(), src: o.key, subject: o.cl.subject, title: `ДЗ: ${o.cl.subject}`, desc: '', issued: now, deadline, done: false, overdue: false, extra: false };
        s.tasks.push(t);
        notify(s, `📚 Новое задание по «${o.cl.subject}». Сдать до ${fmtD(deadline)}.`);
        genTaskDesc(s, t);
    }

    function expel(s, reason) {
        if (s.expelled) return;
        s.expelled = true;
        s.expelReason = reason;
        notify(s, `⛔ Вы отчислены: ${reason}.`, 'bad');
    }

    function addStrike(s, reason, taskId = null) {
        if (s.expelled) return;
        const k = { id: uid(), reason, taskId, t: Date.now(), q: s.quarter.n, fixed: false, consequence: '' };
        s.strikes.push(k);
        const n = activeStrikes(s).length, max = cfg().maxStrikes;
        notify(s, `⚠️ Нарушение ${n}/${max}: ${reason}. Рейтинг: ${rating(s)}%.`, 'warn');
        if (n >= max) { expel(s, `${max} нарушений за четверть, рейтинг упал до 5%`); return; }
        enqueue(s, async () => {
            const txt = await aiText(`${world(s)}\n\nАдминистрация реагирует на нарушение студента ${s.profile.name}: «${reason}». Это ${n}-е нарушение из ${max} в четверти, рейтинг ${rating(s)}%. Опиши одно конкретное последствие в духе этого мира (1–2 предложения): вызов в деканат, отработка, предупреждение куратора, ограничение доступа к общежитию и т.п. Только текст последствия.`);
            k.consequence = txt || pick(CONSEQ);
            notify(s, `🏛️ Последствие: ${k.consequence}`, 'warn');
        });
    }

    function tick() {
        const s = S();
        if (!s || !s.auth) return;
        const c = cfg(), now = Date.now();
        let ch = false;

        for (const o of s.orders) if (!o.notified && now >= o.eta) {
            o.notified = true; ch = true;
            notify(s, o.kind === 'parcel' ? `📦 Посылка для ${o.to} доставлена.` : `🍽️ Заказ «${o.title}» доставлен.`);
        }
        for (const l of s.listings) if (!l.sold && Math.random() < 1 / 240) {
            l.sold = true; ch = true;
            tx(s, Math.round(l.price * 0.95), `Продажа: ${l.title} (комиссия 5%)`);
            notify(s, `💰 Продано: ${l.title}.`);
        }
        for (const p of s.feed) if (p.mine && now - p.t < DAY && Math.random() < 0.1) { p.likes = (p.likes || 0) + 1; ch = true; }
        if (now - s.wallet.lastStipend >= 7 * DAY) {
            s.wallet.lastStipend = now; ch = true;
            const g = gpa(s);
            if (!s.expelled && g !== null && g >= c.stipendMinGpa) { tx(s, c.stipend, 'Стипендия'); notify(s, `🎓 Начислена стипендия ${money(c.stipend)}.`); }
        }

        if (!s.expelled && !s.pausedAt) {
            if (now - s.quarter.start >= c.quarterDays * DAY) {
                s.quarter = { n: s.quarter.n + 1, start: now }; ch = true;
                notify(s, `📅 Началась ${s.quarter.n}-я четверть. Счётчик нарушений обнулён.`, 'important');
            }
            // посещаемость и выдача домашних заданий
            for (const o of occurrences(s, Math.max(s.enforceFrom, now - 14 * DAY), now)) {
                if (s.expelled) break;
                if (o.start < s.enforceFrom || o.end > now || inPause(s, o.start)) continue;
                if (!s.attendance[o.key]) {
                    s.attendance[o.key] = 'absent'; ch = true;
                    addStrike(s, `прогул без уважительной причины — ${o.cl.subject}, ${fmtD(o.start)}`);
                }
                if (!s.tasks.some((t) => t.src === o.key)) { issueTask(s, o); ch = true; }
            }
            // дедлайны
            for (const t of s.tasks) {
                if (s.expelled) break;
                if (t.done || t.overdue || t.expired || now < t.deadline) continue;
                ch = true;
                if (t.extra) { t.expired = true; notify(s, `⌛ Доп. задание «${t.title}» истекло.`); }
                else { t.overdue = true; addStrike(s, `задание не сдано вовремя — ${t.title}`, t.id); }
            }
            // долгое время низкий средний балл
            const g = gpa(s);
            if (!s.expelled && g !== null && s.grades.length >= 3 && g < c.lowGpa) {
                if (!s.lowGpaSince) {
                    s.lowGpaSince = now; ch = true;
                    notify(s, `📉 Средний балл ${g.toFixed(2)} ниже ${c.lowGpa}. Если он останется низким ${c.lowGpaDays} дн., последует отчисление.`, 'warn');
                } else if (now - s.lowGpaSince >= c.lowGpaDays * DAY) {
                    expel(s, `средний балл долгое время ниже ${c.lowGpa}`); ch = true;
                }
            } else if (s.lowGpaSince) {
                s.lowGpaSince = 0; ch = true;
                notify(s, '📈 Средний балл восстановлен, угроза отчисления снята.');
            }
        }
        if (ch) save(s);
    }

    /* ───────────────────────── инъекция в промпт ───────────────────────── */

    function buildInjection() {
        const s = S();
        if (!s || !s.auth || !cfg().inject) return '';
        const p = s.profile, g = gpa(s);
        const L = [`[UniHub — статус студента ${p.name}]`];
        if (s.expelled) L.push(`${p.name} ОТЧИСЛЕН(А) из университета. Причина: ${s.expelReason}.`);
        L.push(`Вид: ${p.species || '—'}; факультет: ${p.faculty}; ${p.year} курс. Рейтинг ${rating(s)}%, нарушений ${activeStrikes(s).length}/${cfg().maxStrikes} в четверти, средний балл ${g === null ? 'нет оценок' : g.toFixed(2)}, баланс ${money(s.wallet.balance)}.`);
        if (!s.expelled) {
            const { cur, next } = curNext(s);
            if (cur) {
                const st = { present: 'присутствует', excused: 'отсутствует по уважительной причине', absent: 'прогуливает' }[s.attendance[cur.key]] || 'ещё не отметился(ась)';
                L.push(`Сейчас идёт пара «${cur.cl.subject}» (${cur.cl.room || 'аудитория не указана'}, до ${fmtT(cur.end)}); ${p.name} ${st}.`);
            }
            if (next) L.push(`Следующая пара: «${next.cl.subject}» ${DAYS[next.cl.day]} в ${next.cl.start}.`);
            const pend = s.tasks.filter((t) => !t.done && !t.expired).sort((a, b) => a.deadline - b.deadline).slice(0, 3);
            if (pend.length) L.push(`Несданные задания: ${pend.map((t) => `«${t.title}» (${t.overdue ? 'ПРОСРОЧЕНО' : `срок ${fmtD(t.deadline)}`})`).join('; ')}.`);
        }
        const recent = s.notes.filter((n) => (n.type === 'warn' || n.type === 'bad' || n.type === 'important') && Date.now() - n.t < DAY).slice(0, 3);
        if (recent.length) L.push(`Недавние события: ${recent.map((n) => n.text).join(' | ')}`);
        const rg = reactionGuide(s);
        if (rg) L.push(`Способности: ${abilityInfo(p)}. ${rg}`);
        L.push('Учитывай это в повествовании (реакции преподавателей, куратора, окружающих, последствия), не пересказывай статус дословно.');
        return L.join('\n');
    }
    function updateInjection() {
        const c = ctx();
        if (typeof c.setExtensionPrompt !== 'function') return;
        try { c.setExtensionPrompt(OLD_MODULE, '', 1, 0); c.setExtensionPrompt(MODULE, buildInjection(), 1, Number(cfg().injectDepth) || 2, false, 0); }
        catch (e) { logErr('[UniHub] inject', e); }
    }

    /* ───────────────────────── UI: состояние экрана ───────────────────────── */

    const ui = { open: false, tab: 'feed', view: null, param: null, studyTab: 'schedule', marketTab: 'buy', channel: 'all', diet: 'all', mcat: 'all', schedDay: null, busy: '' };
    let lastKey = '';

    async function withBusy(label, fn) {
        if (ui.busy) { toast('info', 'Подождите, предыдущий запрос ещё выполняется.'); return; }
        ui.busy = label; render();
        try { return await fn(); } finally { ui.busy = ''; render(); }
    }

    /* ───────────────────────── UI: разметка ───────────────────────── */

    function statusBar() {
        const s = S();
        const unread = s ? s.notes.filter((n) => !n.read).length : 0;
        return `<span class="sh-clock">${fmtT(Date.now())}</span>
        <span class="sh-brand">UniHub</span>
        <span class="sh-sb-right">
          ${s && s.auth ? `<span class="sh-pill" title="Рейтинг">${rating(s)}%</span><span class="sh-pill" title="Баланс">${money(s.wallet.balance)}</span>` : ''}
          <button class="sh-icon" data-act="go" data-view="notes" aria-label="Уведомления"><i class="fa-solid fa-bell"></i>${unread ? `<b class="sh-dot">${unread}</b>` : ''}</button>
          <button class="sh-icon" data-act="close" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        </span>`;
    }

    const NAV = [['feed', 'fa-house', 'Лента'], ['chats', 'fa-comments', 'Чаты'], ['dating', 'fa-heart', 'Знакомства'], ['study', 'fa-graduation-cap', 'Кабинет'], ['more', 'fa-grip', 'Сервисы']];
    function navHTML() {
        const s = S();
        if (!s || !s.auth) return '';
        const unreadChats = s.threads.reduce((a, t) => a + (t.unread || 0), 0);
        const overdue = s.tasks.filter((t) => t.overdue && !t.done).length;
        return NAV.map(([k, ic, l]) => {
            const n = k === 'chats' ? unreadChats : k === 'study' ? overdue : 0;
            return `<button class="${!ui.view && ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><i class="fa-solid ${ic}"></i><span>${l}</span>${n ? `<b class="sh-dot">${n}</b>` : ''}</button>`;
        }).join('');
    }

    function screenHTML() {
        if (ui.view === 'log') return logView();
        const s = S();
        if (!s) return empty('<i class="fa-solid fa-mobile-screen"></i><br>Откройте чат с персонажем, чтобы войти в UniHub.')
            + '<button class="sh-btn ghost wide" data-act="go" data-view="log"><i class="fa-solid fa-bug"></i> Журнал ошибок</button>';
        if (!s.auth) return authView(s);
        if (ui.view && VIEWS[ui.view]) return VIEWS[ui.view](s, ui.param);
        return (TABS[ui.tab] || TABS.feed)(s);
    }

    /* — вход — */
    function authView(s) {
        const p = s.profile;
        const known = s.faculties.some((f) => f.name === p.faculty);
        return `<div class="sh-auth">
          <div class="sh-crest"><i class="fa-solid fa-graduation-cap"></i><h2>UniHub</h2><p>Вход через университетскую учётную запись</p></div>
          <label>Имя студента<input id="sh-a-name" value="${esc(p.name)}"></label>
          ${identityFields('sh-a', p)}
          <h4>Факультет</h4>
          ${s.faculties.length
        ? `<div class="sh-fac-list">${s.faculties.map((f, i) => `<button class="sh-fac ${p.faculty === f.name ? 'on' : ''}" data-act="pickFac" data-i="${i}"><b>${esc(f.name)}</b>${f.desc ? `<small>${esc(f.desc)}</small>` : ''}${f.source === 'lore' ? '<em>из лора</em>' : ''}</button>`).join('')}</div>`
        : '<p class="sh-muted">Факультеты берутся из лорбука или карточки персонажа. Если там их нет, ИИ предложит свои.</p>'}
          <button class="sh-btn ghost" data-act="loadFac"><i class="fa-solid fa-magnifying-glass"></i> ${s.faculties.length ? 'Обновить список факультетов' : 'Найти факультеты'}</button>
          <label>Или впишите свой<input id="sh-a-fac" placeholder="Название факультета" value="${esc(known ? '' : p.faculty)}"></label>
          <button class="sh-btn" data-act="login"><i class="fa-solid fa-right-to-bracket"></i> Войти и составить расписание</button>
        </div>`;
    }
    function identityFields(pre, p) {
        const spKnown = SPECIES.includes(p.species);
        const abKnown = p.abilities === NO_ABIL || ABILITIES.some((a) => a.n === p.abilities);
        const spOther = !!p.species && !spKnown;
        const abOther = !!p.abilities && !abKnown;
        const hidden = (b) => (b ? '' : ' style="display:none"');
        return `
          <label>Вид<select id="${pre}-species" data-change="idSel" data-other="${pre}-species-o">
            <option value="">— выберите —</option>
            ${SPECIES.map((x) => `<option ${x === p.species ? 'selected' : ''}>${esc(x)}</option>`).join('')}
            <option value="__other" ${spOther ? 'selected' : ''}>Другой вид…</option>
          </select></label>
          <div id="${pre}-species-o" class="sh-other"${hidden(spOther)}><input id="${pre}-species-t" placeholder="Название вида" value="${esc(spOther ? p.species : '')}"></div>
          <label>Способности<select id="${pre}-abil" data-change="idSel" data-other="${pre}-abil-o">
            <option value="">— выберите —</option>
            <option value="${NO_ABIL}" ${p.abilities === NO_ABIL ? 'selected' : ''}>Отсутствуют</option>
            <optgroup label="Не видны со стороны">${ABILITIES.filter((a) => !a.v).map((a) => `<option ${a.n === p.abilities ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</optgroup>
            <optgroup label="Заметны окружающим">${ABILITIES.filter((a) => a.v).map((a) => `<option ${a.n === p.abilities ? 'selected' : ''}>${esc(a.n)}</option>`).join('')}</optgroup>
            <option value="__other" ${abOther ? 'selected' : ''}>Другая способность…</option>
          </select></label>
          <div id="${pre}-abil-o" class="sh-other"${hidden(abOther)}><input id="${pre}-abil-t" placeholder="Опишите способность" value="${esc(abOther ? p.abilities : '')}">
            <label class="sh-toggle"><input type="checkbox" id="${pre}-abil-v" ${abOther && p.abilityVisible ? 'checked' : ''}><span>Способность видна окружающим</span></label></div>
          <label>Курс<select id="${pre}-year">${Array.from({ length: MAX_YEAR }, (_, i) => `<option value="${i + 1}" ${+p.year === i + 1 ? 'selected' : ''}>${i + 1} курс</option>`).join('')}</select></label>`;
    }
    function readIdentity(pre, p) {
        const sp = val(`${pre}-species`);
        p.species = sp === '__other' ? val(`${pre}-species-t`) : sp;
        const ab = val(`${pre}-abil`);
        if (ab === '__other') { p.abilities = val(`${pre}-abil-t`); p.abilityVisible = !!document.getElementById(`${pre}-abil-v`)?.checked; }
        else { p.abilities = ab; p.abilityVisible = !!ABILITIES.find((a) => a.n === ab)?.v; }
        p.year = clamp(parseInt(val(`${pre}-year`), 10) || 1, 1, MAX_YEAR);
    }
    function readAuth(s) {
        const p = s.profile;
        p.name = val('sh-a-name') || p.name;
        readIdentity('sh-a', p);
    }

    /* — лента — */
    const KIND_ICON = { photo: 'fa-image', video: 'fa-video', reel: 'fa-film', story: 'fa-circle-play' };
    function postHTML(p) {
        return `<article class="sh-card sh-post">
          <div class="sh-post-h">${ava(p.author)}<div><b>${esc(p.author)}</b>${p.verified !== false ? ' <i class="fa-solid fa-circle-check sh-verified" title="Верифицирован"></i>' : ''}
          <small>${p.species ? badge(p.species) : ''} ${esc(CHANNELS[p.channel] || '')}, ${fmtD(p.t)}</small></div></div>
          <div class="sh-post-t">${esc(p.text)}</div>
          ${p.media ? `<div class="sh-media"><i class="fa-solid ${KIND_ICON[p.kind] || 'fa-image'}"></i><span>${esc(p.media)}</span></div>` : ''}
          <div class="sh-post-a">
            <button data-act="like" data-id="${p.id}" class="${p.liked ? 'on' : ''}"><i class="fa-${p.liked ? 'solid' : 'regular'} fa-heart"></i> ${p.likes || 0}</button>
            ${p.mine ? '' : `<button data-act="dm" data-name="${esc(p.author)}" data-species="${esc(p.species || '')}"><i class="fa-regular fa-paper-plane"></i> Написать</button>`}
          </div></article>`;
    }
    function feedTab(s) {
        const my = (s.profile.species || '').toLowerCase();
        const posts = s.feed.filter((p) => {
            if (ui.channel === 'all') return true;
            if (ui.channel === 'species') {
                const sp = (p.species || '').toLowerCase();
                return p.channel === 'species' && (!my || (sp && (sp.includes(my) || my.includes(sp))));
            }
            return p.channel === ui.channel;
        });
        const authors = [...new Map(s.feed.filter((p) => !p.mine).map((p) => [p.author, p])).values()].slice(0, 12);
        return `
        ${authors.length ? `<div class="sh-stories">${authors.map((p) => `<button class="sh-story" data-act="dm" data-name="${esc(p.author)}" data-species="${esc(p.species || '')}">${ava(p.author, true)}<small>${esc(p.author.split(' ')[0])}</small></button>`).join('')}</div>` : ''}
        <div class="sh-chips">${Object.entries(CHANNELS).map(([k, v]) => `<button class="sh-chip ${ui.channel === k ? 'on' : ''}" data-act="channel" data-ch="${k}">${esc(k === 'species' && s.profile.species ? s.profile.species : v)}</button>`).join('')}</div>
        <div class="sh-card sh-compose">
          <textarea id="sh-post" rows="2" placeholder="Что нового, ${esc(s.profile.name)}?"></textarea>
          <div class="sh-row"><select id="sh-post-ch">${Object.entries(CHANNELS).filter(([k]) => k !== 'all').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          <button class="sh-btn sm" data-act="post">Опубликовать</button></div>
        </div>
        <button class="sh-btn ghost wide" data-act="genFeed"><i class="fa-solid fa-rotate"></i> Обновить ленту</button>
        ${posts.length ? posts.map(postHTML).join('') : empty('В этом канале пока тихо. Обновите ленту или напишите первый пост.')}`;
    }

    /* — чаты — */
    function chatsTab(s) {
        const list = [...s.threads].sort((a, b) => b.t - a.t);
        return `<h3 class="sh-h">Сообщения <small><i class="fa-solid fa-lock"></i> сквозное шифрование</small></h3>
        <div class="sh-row sh-card"><input id="sh-newchat" placeholder="Имя студента или преподавателя"><button class="sh-btn sm" data-act="newChat">Написать</button></div>
        ${list.length ? list.map((t) => {
        const last = t.msgs[t.msgs.length - 1];
        return `<button class="sh-li" data-act="go" data-view="thread" data-param="${t.id}">${ava(t.name)}<div><b>${esc(t.name)}</b> ${t.kind === 'group' ? badge('группа') : t.species ? badge(t.species) : ''}<small>${last ? esc((last.me ? 'Вы: ' : '') + last.text).slice(0, 70) : 'Нет сообщений'}</small></div>${t.unread ? `<b class="sh-dot">${t.unread}</b>` : ''}</button>`;
    }).join('') : empty('Диалогов пока нет. Напишите кому-нибудь из ленты или найдите пару в знакомствах.')}`;
    }
    function threadView(s, id) {
        const th = s.threads.find((t) => t.id === id);
        if (!th) return head('Диалог') + empty('Диалог не найден.');
        th.unread = 0;
        return `${head(th.name, `${th.species ? esc(th.species) + ', ' : ''}<i class="fa-solid fa-lock"></i> зашифровано`)}
        <div class="sh-msgs">${th.msgs.map((m) => m.sys
        ? `<div class="sh-sys">${esc(m.text)}</div>`
        : `<div class="sh-msg ${m.me ? 'me' : ''}">${m.from ? `<b>${esc(m.from)}</b>` : ''}${esc(m.text)}<time>${fmtT(m.t)}</time></div>`).join('')}
        ${th.typing ? `<div class="sh-msg typing">${esc(th.name)} печатает…</div>` : ''}</div>
        <div class="sh-composer"><textarea id="sh-msg" rows="1" placeholder="Сообщение"></textarea><button class="sh-btn sm" data-act="send" data-id="${th.id}" aria-label="Отправить"><i class="fa-solid fa-paper-plane"></i></button></div>`;
    }

    /* — знакомства — */
    function datingTab(s) {
        const d = s.dating;
        if (!s.profile.privacy.dating) return `<h3 class="sh-h">Знакомства</h3>${empty('Ваш профиль скрыт из знакомств. Включить можно в профиле, в разделе «Конфиденциальность».')}`;
        return `<h3 class="sh-h">Знакомства <small>только для студентов, профили верифицированы</small></h3>
        <div class="sh-seg"><button class="${d.mode === 'love' ? 'on' : ''}" data-act="dMode" data-mode="love">Свидания</button><button class="${d.mode === 'friends' ? 'on' : ''}" data-act="dMode" data-mode="friends">Друзья</button></div>
        <div class="sh-card sh-form">
          <label>Вид<input id="sh-d-species" placeholder="любой" value="${esc(d.fSpecies)}"></label>
          <label>Способности<input id="sh-d-abil" placeholder="любые" value="${esc(d.fAbility)}"></label>
          <button class="sh-btn" data-act="genDating"><i class="fa-solid fa-wand-magic-sparkles"></i> Подобрать анкеты</button>
        </div>
        ${d.matches.length ? `<h4>Взаимные симпатии</h4><div class="sh-stories">${d.matches.map((m) => `<button class="sh-story" data-act="dm" data-name="${esc(m.name)}" data-species="${esc(m.species)}" data-bio="${esc(m.bio)}">${ava(m.name, true)}<small>${esc(m.name.split(' ')[0])}</small></button>`).join('')}</div>` : ''}
        ${d.profiles.length ? d.profiles.map((p) => `<article class="sh-card sh-profile">
          <div class="sh-post-h">${ava(p.name, true)}<div><b>${esc(p.name)}, ${esc(p.age)}</b>${p.verified ? ' <i class="fa-solid fa-circle-check sh-verified" title="Верифицирован"></i>' : ''}<small>${badge(p.species)} ${esc(p.faculty || '')}</small></div></div>
          ${p.abilities ? `<p><i class="fa-solid fa-bolt"></i> ${esc(p.abilities)}</p>` : ''}
          <p>${esc(p.bio)}</p>
          <div class="sh-compat"><span style="width:${clamp(+p.compat || 0, 0, 100)}%"></span></div>
          <small class="sh-muted">Совместимость видов ${clamp(+p.compat || 0, 0, 100)}%. ${esc(p.compatNote || '')}</small>
          <div class="sh-row"><button class="sh-btn ghost" data-act="dSkip" data-id="${p.id}"><i class="fa-solid fa-xmark"></i> Пропустить</button><button class="sh-btn" data-act="dLike" data-id="${p.id}"><i class="fa-solid fa-heart"></i> Нравится</button></div>
          <button class="sh-link" data-act="dReport" data-id="${p.id}"><i class="fa-solid fa-flag"></i> Пожаловаться и скрыть</button>
        </article>`).join('') : empty('Задайте фильтры и нажмите «Подобрать анкеты».')}`;
    }

    /* — личный кабинет (учёба) — */
    const STUDY_TABS = [['schedule', 'Расписание'], ['tasks', 'Задания'], ['grades', 'Оценки'], ['rating', 'Рейтинг'], ['help', 'Помощь']];
    function studyTab(s) {
        const top = `<div class="sh-idcard">
          ${ava(s.profile.name, true)}
          <div><b>${esc(s.profile.name)}</b><small>${esc(s.profile.faculty)}, ${s.profile.year} курс</small>${badge(s.profile.species || 'вид не указан')}</div>
          <div class="sh-seal ${rating(s) < 40 ? 'bad' : rating(s) < 70 ? 'warn' : ''}"><b>${rating(s)}%</b><small>рейтинг</small></div>
        </div>
        ${s.pausedAt ? '<div class="sh-note warn"><i class="fa-solid fa-pause"></i> Время учёбы на паузе. Пары и дедлайны не идут.</div>' : ''}
        <div class="sh-chips">${STUDY_TABS.map(([k, l]) => `<button class="sh-chip ${ui.studyTab === k ? 'on' : ''}" data-act="studyTab" data-st="${k}">${l}</button>`).join('')}</div>`;
        if (s.expelled) {
            return `${top}<div class="sh-card sh-expelled"><i class="fa-solid fa-door-open"></i><h3>Вы отчислены</h3><p>${esc(s.expelReason)}.</p><p class="sh-muted">Учебные разделы закрыты. Можно подать документы заново: расписание, оценки и нарушения будут сброшены, кошелёк и соцсеть останутся.</p><button class="sh-btn" data-act="reenroll">Поступить заново</button></div>`;
        }
        return top + ({ schedule: scheduleView, tasks: tasksView, grades: gradesView, rating: ratingView, help: helpView }[ui.studyTab] || scheduleView)(s);
    }

    function scheduleView(s) {
        const now = Date.now();
        const today = (new Date().getDay() + 6) % 7;
        const day = ui.schedDay ?? today;
        const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - today);
        const date = new Date(monday); date.setDate(monday.getDate() + day);
        const occ = occurrences(s, date.getTime(), date.getTime() + DAY - 1);
        const early = cfg().checkInEarlyMin * MIN;
        return `<div class="sh-days">${DAYS.map((d, i) => `<button class="${i === day ? 'on' : ''} ${i === today ? 'today' : ''}" data-act="schedDay" data-d="${i}">${d}</button>`).join('')}</div>
        <p class="sh-muted">${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        ${occ.length ? occ.map((o) => {
        const st = s.attendance[o.key];
        const live = now >= o.start && now < o.end;
        const before = o.start < s.enforceFrom;
        let status = '';
        if (st === 'present') status = badge('присутствовал(а)', 'ok');
        else if (st === 'excused') status = badge('уважительная причина', 'mid');
        else if (st === 'absent') status = badge('прогул', 'bad');
        else if (before) status = badge('до зачисления', 'mid');
        else if (live) status = badge('идёт сейчас', 'live');
        else if (o.end < now) status = badge('ожидает проверки', 'mid');
        const canCheck = !st && !before && now >= o.start - early && now < o.end && !s.pausedAt;
        const canExcuse = !st && !before && now < o.end && !s.excuses[o.key] && !s.pausedAt;
        return `<div class="sh-card sh-class ${live ? 'live' : ''}">
            <div class="sh-class-t"><b>${o.cl.start}</b><small>${o.cl.end}</small></div>
            <div><b>${esc(o.cl.subject)}</b><small>${esc(o.cl.teacher)}${o.cl.room ? `, ${esc(o.cl.room)}` : ''}</small>${status}
            ${s.excuses[o.key] ? `<small class="sh-muted">Деканат: ${esc(s.excuses[o.key].reply)}</small>` : ''}
            <div class="sh-row">${canCheck ? `<button class="sh-btn sm" data-act="checkin" data-key="${o.key}">Отметиться</button>` : ''}${canExcuse ? `<button class="sh-btn sm ghost" data-act="go" data-view="excuse" data-param="${o.key}">Уважительная причина</button>` : ''}</div></div>
          </div>`;
    }).join('') : empty('В этот день пар нет.')}
        <p class="sh-muted">Отметиться можно за ${cfg().checkInEarlyMin} мин до начала и до конца пары. Неотмеченная пара без уважительной причины считается прогулом.</p>
        <button class="sh-link" data-act="regenSchedule"><i class="fa-solid fa-rotate"></i> Составить расписание заново</button>`;
    }
    function excuseView(s, key) {
        const o = findOcc(s, key);
        if (!o) return head('Уважительная причина') + empty('Пара не найдена.');
        return `${head('Уважительная причина', `${esc(o.cl.subject)}, ${fmtD(o.start)}`)}
        <div class="sh-card sh-form"><p class="sh-muted">Запрос рассматривает деканат, подать его можно один раз. Болезнь, форс-мажор, официальные мероприятия и особенности вида обычно признаются уважительными, «проспал» — нет.</p>
        <textarea id="sh-excuse" rows="4" placeholder="Опишите причину отсутствия"></textarea>
        <button class="sh-btn" data-act="excuse" data-key="${key}">Отправить в деканат</button></div>`;
    }

    function taskRow(t) {
        const cls = t.done ? 'ok' : t.overdue ? 'bad' : t.expired ? 'mid' : t.deadline - Date.now() < 3 * HOUR ? 'warn' : '';
        const info = t.done ? `оценка ${t.grade}` : t.expired ? 'истекло' : t.overdue ? 'просрочено, сдайте для исправления' : `осталось ${left(t.deadline)}`;
        return `<button class="sh-li sh-task ${cls}" data-act="go" data-view="task" data-param="${t.id}"><i class="fa-solid ${t.extra ? 'fa-star' : 'fa-book'}"></i><div><b>${esc(t.title)}</b><small>${esc(t.subject)}, ${info}</small></div></button>`;
    }
    function tasksView(s) {
        const pend = s.tasks.filter((t) => !t.done && !t.expired).sort((a, b) => a.deadline - b.deadline);
        const done = s.tasks.filter((t) => t.done || t.expired).sort((a, b) => (b.doneAt || b.deadline) - (a.doneAt || a.deadline)).slice(0, 20);
        const hasExtra = pend.some((t) => t.extra);
        return `<div class="sh-note"><i class="fa-solid fa-circle-info"></i> Задание выдаётся после каждой пары. Срок — за ${cfg().deadlineOffsetMin} мин до следующей пары по предмету. Несданное вовремя задание — это нарушение.</div>
        <h4>К сдаче</h4>${pend.length ? pend.map(taskRow).join('') : empty('Все задания сданы.')}
        <button class="sh-btn ghost wide" data-act="extra" ${hasExtra ? 'disabled' : ''}><i class="fa-solid fa-star"></i> ${hasExtra ? 'Доп. задание уже взято' : 'Взять дополнительное задание'}</button>
        <p class="sh-muted">Чтобы снять нарушение: сдайте просроченное задание, затем выполните дополнительное на оценку 3 и выше.</p>
        ${done.length ? `<h4>Архив</h4>${done.map(taskRow).join('')}` : ''}`;
    }
    function taskView(s, id) {
        const t = s.tasks.find((x) => x.id === id);
        if (!t) return head('Задание') + empty('Задание не найдено.');
        return `${head(t.title, esc(t.subject))}
        <div class="sh-card"><p>${t.desc ? esc(t.desc) : '<i class="fa-solid fa-spinner fa-spin"></i> Преподаватель формулирует задание…'}</p>
        ${!t.desc ? `<button class="sh-link" data-act="retryTask" data-id="${t.id}">Запросить формулировку ещё раз</button>` : ''}
        <small class="sh-muted">Выдано ${fmtD(t.issued)}. Срок сдачи: ${fmtD(t.deadline)}${!t.done && !t.expired ? ` (${left(t.deadline)})` : ''}.</small></div>
        ${t.done ? `<div class="sh-card"><h4>Ваш ответ</h4><p>${esc(t.answer)}</p><div class="sh-grade g${t.grade}">${t.grade}</div><p>${esc(t.comment)}</p></div>`
        : t.expired ? empty('Срок доп. задания истёк.')
            : `<div class="sh-card sh-form"><textarea id="sh-ans" rows="7" placeholder="Ваш ответ, 3–10 предложений"></textarea>
          ${t.overdue ? '<small class="sh-muted">Срок прошёл: оценка будет не выше 3, но сдача откроет возможность снять нарушение.</small>' : ''}
          <button class="sh-btn" data-act="submit" data-id="${t.id}" ${t.desc ? '' : 'disabled'}>Сдать на проверку</button></div>`}`;
    }
    function gradesView(s) {
        const g = gpa(s);
        const bySubj = {};
        for (const x of s.grades) (bySubj[x.subject] ||= []).push(x.grade);
        return `<div class="sh-card sh-gpa"><b>${g === null ? '—' : g.toFixed(2)}</b><small>средний балл${s.lowGpaSince ? `, ниже порога с ${fmtDay(s.lowGpaSince)}: отчисление через ${left(s.lowGpaSince + cfg().lowGpaDays * DAY)}` : ''}</small></div>
        <div class="sh-card sh-form"><h4>Калькулятор среднего балла</h4><label>Если получу оценки<input id="sh-calc" placeholder="например: 5 4 5"></label><button class="sh-btn sm" data-act="calc">Рассчитать</button><div id="sh-calc-out" class="sh-muted"></div></div>
        ${Object.keys(bySubj).length ? Object.entries(bySubj).map(([sub, arr]) => `<div class="sh-li static"><div><b>${esc(sub)}</b><small>${arr.join(', ')}</small></div><span class="sh-grade sm g${Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)}">${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)}</span></div>`).join('') : empty('Оценок пока нет. Сдавайте задания, чтобы они появились.')}`;
    }
    function ratingView(s) {
        const c = cfg(), act = activeStrikes(s), r = rating(s);
        const qs = s.strikes.filter((k) => k.q === s.quarter.n).reverse();
        return `<div class="sh-card"><div class="sh-bar"><span style="width:${r}%" class="${r < 40 ? 'bad' : r < 70 ? 'warn' : ''}"></span></div>
          <p><b>${r}%</b> — нарушений ${act.length} из ${c.maxStrikes}. При ${c.maxStrikes} рейтинг падает до 5% и следует отчисление.</p>
          <small class="sh-muted">${s.quarter.n}-я четверть: с ${fmtDay(s.quarter.start)} по ${fmtDay(s.quarter.start + c.quarterDays * DAY)}. В новой четверти счётчик обнуляется.</small></div>
        <h4>Нарушения этой четверти</h4>
        ${qs.length ? qs.map((k) => `<div class="sh-card sh-strike ${k.fixed ? 'fixed' : ''}"><b>${k.fixed ? '<i class="fa-solid fa-check"></i> Исправлено' : '<i class="fa-solid fa-triangle-exclamation"></i> Действует'}</b><p>${esc(k.reason)}</p>${k.consequence ? `<small>Последствие: ${esc(k.consequence)}</small>` : ''}<small class="sh-muted">${fmtD(k.t)}</small></div>`).join('') : empty('Нарушений нет.')}`;
    }
    function helpView(s) {
        const subjects = [...new Set(s.schedule.map((c) => c.subject))];
        return `<div class="sh-card sh-form"><h4>Репетитор</h4><label>Предмет<select id="sh-tutor">${subjects.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label><button class="sh-btn" data-act="tutor">Найти репетитора</button></div>
        <div class="sh-card sh-form"><h4>Учебные группы</h4><button class="sh-btn ghost" data-act="groups">Подобрать группы</button>
        ${(s.groupOffers || []).map((g, i) => `<div class="sh-li static"><div><b>${esc(g.name)}</b><small>${esc(g.subject)}, ${esc(g.when)}</small></div><button class="sh-btn sm" data-act="joinGroup" data-i="${i}">Вступить</button></div>`).join('')}</div>`;
    }

    /* — сервисы — */
    function moreTab(s) {
        const tiles = [['delivery', 'fa-burger', 'Доставка'], ['market', 'fa-store', 'Маркетплейс'], ['wallet', 'fa-wallet', 'Кошелёк'], ['campus', 'fa-building-columns', 'Кампус'], ['profile', 'fa-id-badge', 'Профиль'], ['settings', 'fa-sliders', 'Настройки']];
        return `<h3 class="sh-h">Сервисы</h3><div class="sh-tiles">${tiles.map(([v, ic, l]) => `<button data-act="go" data-view="${v}"><i class="fa-solid ${ic}"></i><span>${l}</span></button>`).join('')}</div>
        <button class="sh-btn danger wide" data-act="sos"><i class="fa-solid fa-shield-halved"></i> Экстренный вызов охраны кампуса</button>`;
    }

    function orderStatus(o) {
        const p = (Date.now() - o.t) / (o.eta - o.t);
        if (p >= 1) return ['Доставлено', 100];
        if (p < 0.3) return [o.kind === 'parcel' ? 'Курьер забирает' : 'Готовится', Math.round(p * 100)];
        return ['Курьер в пути', Math.round(p * 100)];
    }
    function deliveryView(s) {
        const tags = [...new Set(s.menu.flatMap((m) => m.tags || []))];
        const items = s.menu.filter((m) => ui.diet === 'all' || (m.tags || []).includes(ui.diet));
        return `${head('Доставка по кампусу')}
        <div class="sh-chips"><button class="sh-chip ${ui.diet === 'all' ? 'on' : ''}" data-act="diet" data-diet="all">Всё</button>${tags.map((t) => `<button class="sh-chip ${ui.diet === t ? 'on' : ''}" data-act="diet" data-diet="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        ${items.map((m) => `<div class="sh-li static"><div><b>${esc(m.title)}</b><small>${esc(m.place)}. ${(m.tags || []).map((t) => esc(t)).join(', ')}</small></div><button class="sh-btn sm" data-act="order" data-id="${m.id}">${money(m.price)}</button></div>`).join('')}
        <button class="sh-btn ghost wide" data-act="genMenu"><i class="fa-solid fa-rotate"></i> Обновить меню</button>
        <div class="sh-card sh-form"><h4>Посылка другому студенту</h4><label>Кому<input id="sh-p-to"></label><label>Что внутри<input id="sh-p-what"></label><button class="sh-btn sm" data-act="parcel">Отправить за ${money(60)}</button></div>
        <h4>Отслеживание</h4>
        ${s.orders.length ? s.orders.slice(0, 15).map((o) => { const [st, p] = orderStatus(o); return `<div class="sh-card"><b>${o.kind === 'parcel' ? `📦 Для ${esc(o.to)}: ${esc(o.title)}` : `🍽️ ${esc(o.title)}`}</b><small class="sh-muted">${st}, прибытие ~${fmtT(o.eta)}</small><div class="sh-bar"><span style="width:${p}%"></span></div></div>`; }).join('') : empty('Заказов пока нет.')}`;
    }

    function marketView(s) {
        const mt = ui.marketTab;
        const seg = `<div class="sh-seg"><button class="${mt === 'buy' ? 'on' : ''}" data-act="mTab" data-t="buy">Купить</button><button class="${mt === 'sell' ? 'on' : ''}" data-act="mTab" data-t="sell">Продать</button><button class="${mt === 'mine' ? 'on' : ''}" data-act="mTab" data-t="mine">Мои вещи</button></div>`;
        let body = '';
        if (mt === 'buy') {
            const items = s.market.filter((m) => ui.mcat === 'all' || m.cat === ui.mcat);
            body = `<div class="sh-chips"><button class="sh-chip ${ui.mcat === 'all' ? 'on' : ''}" data-act="mcat" data-c="all">Всё</button>${MARKET_CATS.map((c) => `<button class="sh-chip ${ui.mcat === c ? 'on' : ''}" data-act="mcat" data-c="${c}">${c}</button>`).join('')}</div>
            ${items.map((m) => `<div class="sh-card sh-item"><b>${esc(m.title)}</b><small>${esc(m.cat)}. Продавец: ${esc(m.seller)} ★ ${(+m.rating || 0).toFixed(1)} ${m.verified ? '<i class="fa-solid fa-circle-check sh-verified" title="Верифицирован"></i>' : ''}</small>
              <div class="sh-row"><button class="sh-btn sm" data-act="buy" data-id="${m.id}">Купить за ${money(m.price)}</button>${m.rent ? `<button class="sh-btn sm ghost" data-act="rent" data-id="${m.id}">Аренда ${money(m.rent)}/нед</button>` : ''}</div></div>`).join('') || empty('В этой категории ничего нет.')}
            <button class="sh-btn ghost wide" data-act="genMarket"><i class="fa-solid fa-rotate"></i> Новые объявления</button>`;
        } else if (mt === 'sell') {
            body = `<div class="sh-card sh-form"><label>Что продаёте<input id="sh-s-title"></label><label>Категория<select id="sh-s-cat">${MARKET_CATS.map((c) => `<option>${c}</option>`).join('')}</select></label><label>Цена, ₡<input id="sh-s-price" type="number" min="1"></label><button class="sh-btn" data-act="sell">Разместить объявление</button><small class="sh-muted">Комиссия площадки — 5%. Деньги придут, когда найдётся покупатель.</small></div>
            ${s.listings.map((l) => `<div class="sh-li static"><div><b>${esc(l.title)}</b><small>${esc(l.cat)}, ${money(l.price)}</small></div>${badge(l.sold ? 'продано' : 'ждёт покупателя', l.sold ? 'ok' : 'mid')}</div>`).join('')}`;
        } else {
            body = s.inventory.length ? s.inventory.map((i) => `<div class="sh-li static"><div><b>${esc(i.title)}</b><small>${i.rentUntil ? `аренда до ${fmtDay(i.rentUntil)}` : `куплено ${fmtDay(i.t)}`}</small></div></div>`).join('') : empty('Покупок пока нет.');
        }
        return `${head('Маркетплейс', `на счёте ${money(s.wallet.balance)}`)}${seg}${body}`;
    }

    function walletView(s) {
        return `${head('Кошелёк')}
        <div class="sh-card sh-balance"><small>Баланс</small><b>${money(s.wallet.balance)}</b><small class="sh-muted">Стипендия ${money(cfg().stipend)} раз в неделю при среднем балле от ${cfg().stipendMinGpa}.</small></div>
        <div class="sh-card sh-form"><h4>Перевод</h4><label>Получатель<input id="sh-w-to" list="sh-w-list"></label><datalist id="sh-w-list">${s.threads.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
        <label>Сумма, ₡<input id="sh-w-sum" type="number" min="1"></label><label>Комментарий<input id="sh-w-note"></label><button class="sh-btn" data-act="transfer">Перевести</button></div>
        <h4>История</h4>
        ${s.wallet.history.length ? s.wallet.history.slice(0, 40).map((h) => `<div class="sh-li static"><div><b>${esc(h.label)}</b><small>${fmtD(h.t)}</small></div><span class="sh-amt ${h.amount >= 0 ? 'in' : 'out'}">${h.amount >= 0 ? '+' : '−'}${money(Math.abs(h.amount))}</span></div>`).join('') : empty('Операций пока нет.')}`;
    }

    function ticketStatus(t) {
        const age = Date.now() - t.t;
        return age < HOUR ? 'Принято' : age < 6 * HOUR ? 'В работе' : 'Решено';
    }
    function campusView(s) {
        const now = Date.now();
        return `${head('Кампус')}
        <div class="sh-card"><h4>Мероприятия</h4>${s.events.length ? s.events.map((e) => `<div class="sh-li static"><div><b>${esc(e.title)}</b><small>${esc(e.when)}, ${esc(e.place)}. ${esc(e.desc)}</small></div><button class="sh-btn sm ${e.going ? '' : 'ghost'}" data-act="rsvp" data-id="${e.id}">${e.going ? 'Иду' : 'Пойду'}</button></div>`).join('') : '<p class="sh-muted">Список пуст.</p>'}
          <button class="sh-btn ghost sm" data-act="genEvents"><i class="fa-solid fa-rotate"></i> Найти мероприятия</button></div>
        <div class="sh-card"><h4>Клубы</h4>${CLUBS.map((c) => `<div class="sh-li static"><div><b>${esc(c)}</b></div><button class="sh-btn sm ${s.clubs.includes(c) ? '' : 'ghost'}" data-act="club" data-c="${esc(c)}">${s.clubs.includes(c) ? 'Участник' : 'Вступить'}</button></div>`).join('')}</div>
        <div class="sh-card sh-form"><h4>Бронирование помещений</h4><label>Помещение<select id="sh-b-room">${ROOMS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label><label>Когда<input id="sh-b-when" type="datetime-local"></label><button class="sh-btn sm" data-act="book">Забронировать</button>
          ${s.bookings.filter((b) => b.at > now - DAY).map((b) => `<small class="sh-muted"><i class="fa-solid fa-check"></i> ${esc(b.room)}, ${fmtD(b.at)}</small>`).join('')}</div>
        <div class="sh-card sh-form"><h4>Заявки и жалобы</h4><label>Тип<select id="sh-t-type"><option>Техническое обслуживание</option><option>Жалоба</option><option>Административный вопрос</option></select></label><textarea id="sh-t-text" rows="3" placeholder="Опишите проблему"></textarea><button class="sh-btn sm" data-act="ticket">Отправить заявку</button>
          ${s.tickets.slice(0, 8).map((t) => `<div class="sh-li static"><div><b>${esc(t.type)}</b><small>${esc(t.text).slice(0, 80)}</small></div>${badge(ticketStatus(t), ticketStatus(t) === 'Решено' ? 'ok' : 'mid')}</div>`).join('')}</div>
        <div class="sh-card sh-form"><h4>Запрос в деканат</h4><textarea id="sh-dean" rows="3" placeholder="Справка, перевод, академический отпуск…"></textarea><button class="sh-btn sm" data-act="dean">Отправить</button>
          ${s.dean.slice(0, 5).map((d) => `<div class="sh-qa"><b>Вы:</b> ${esc(d.q)}<br><b>Деканат:</b> ${esc(d.a)}</div>`).join('')}</div>
        <button class="sh-btn danger wide" data-act="sos"><i class="fa-solid fa-shield-halved"></i> Экстренный вызов охраны кампуса</button>`;
    }

    function profileView(s) {
        const p = s.profile, pr = p.privacy;
        const tog = (k, l) => `<label class="sh-toggle"><input type="checkbox" data-change="privacy" data-k="${k}" ${pr[k] ? 'checked' : ''}><span>${l}</span></label>`;
        return `${head('Профиль')}
        <div class="sh-idcard">${ava(p.name, true)}<div><b>${esc(p.name)}</b><small>${pr.faculty ? esc(p.faculty) : 'факультет скрыт'}, ${p.year} курс</small>${pr.abilities && p.abilities ? badge(p.abilities === NO_ABIL ? 'без способностей' : p.abilities) : ''}${pr.species ? badge(p.species || 'вид не указан') : badge('вид скрыт')}</div></div>
        <div class="sh-card sh-form">
          <label>Имя<input id="sh-pf-name" value="${esc(p.name)}"></label>
          ${identityFields('sh-pf', p)}
          <label>О себе<textarea id="sh-pf-bio" rows="3">${esc(p.bio)}</textarea></label>
          <button class="sh-btn" data-act="saveProfile">Сохранить профиль</button>
        </div>
        <div class="sh-card"><h4>Конфиденциальность</h4>${tog('species', 'Показывать вид')}${tog('faculty', 'Показывать факультет')}${tog('abilities', 'Показывать способности')}${tog('dating', 'Участвовать в знакомствах')}</div>
        <button class="sh-link" data-act="changeFaculty"><i class="fa-solid fa-right-left"></i> Перевестись на другой факультет</button>`;
    }

    function settingsView(s) {
        const c = cfg();
        const num = (k, l, step = 1) => `<label>${l}<input type="number" step="${step}" data-change="cfg" data-k="${k}" value="${esc(c[k])}"></label>`;
        return `${head('Настройки')}
        <div class="sh-card"><h4>Время учёбы</h4><p class="sh-muted">Пары и дедлайны идут по реальному времени. На паузе нарушения не начисляются, а сроки заданий сдвигаются на время паузы.</p>
          <button class="sh-btn ${s.pausedAt ? '' : 'ghost'}" data-act="pause">${s.pausedAt ? `<i class="fa-solid fa-play"></i> Продолжить (на паузе с ${fmtD(s.pausedAt)})` : '<i class="fa-solid fa-pause"></i> Поставить на паузу'}</button></div>
        <div class="sh-card sh-form"><h4>Связь с чатом</h4>
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="inject" ${c.inject ? 'checked' : ''}><span>Передавать статус студента ИИ</span></label>
          ${num('injectDepth', 'Глубина вставки в чат')}
          <label class="sh-toggle"><input type="checkbox" data-change="cfgBool" data-k="showFab" ${c.showFab ? 'checked' : ''}><span>Плавающая кнопка телефона</span></label></div>
        <div class="sh-card sh-form"><h4>Правила университета</h4>
          ${num('quarterDays', 'Длина четверти, дней')}${num('maxStrikes', 'Нарушений до отчисления')}${num('lowGpa', 'Порог низкого балла', 0.1)}${num('lowGpaDays', 'Дней с низким баллом до отчисления')}
          ${num('checkInEarlyMin', 'Отметка до начала пары, мин')}${num('deadlineOffsetMin', 'Дедлайн до следующей пары, мин')}${num('extraTaskHours', 'Срок доп. задания, ч')}
          ${num('stipend', 'Стипендия, ₡')}${num('stipendMinGpa', 'Мин. балл для стипендии', 0.1)}${num('startBalance', 'Стартовый баланс (новые чаты), ₡')}</div>
        <button class="sh-btn ghost wide" data-act="go" data-view="log"><i class="fa-solid fa-bug"></i> Журнал ошибок (${LOG.length})</button>
        <div class="sh-card sh-form"><h4>Мастер игры</h4><label>Установить баланс, ₡<input id="sh-gm-bal" type="number" value="${esc(s.wallet.balance)}"></label><button class="sh-btn sm ghost" data-act="gmBalance">Применить</button>
          <button class="sh-btn sm danger" data-act="resetChat">Сбросить данные UniHub в этом чате</button></div>`;
    }

    function logText() {
        const c = ctx();
        const head = `UniHub 1.2.1 | ${navigator.userAgent} | API: ${c.mainApi || c.main_api || '?'} | generateRaw: ${typeof c.generateRaw} | loadWorldInfo: ${typeof c.loadWorldInfo} | setExtensionPrompt: ${typeof c.setExtensionPrompt}`;
        return [head, ...LOG.map((l) => `[${fmtD(l.t)}] ${l.where}: ${l.text}`)].join('\n\n');
    }
    function logView() {
        return `${head('Журнал ошибок', `записей: ${LOG.length}`)}
        <div class="sh-card"><p class="sh-muted">Если что-то не работает: нажмите «Скопировать» и пришлите текст. Если кнопка не сработает — зажмите текст пальцем, «Выделить всё» и «Копировать».</p>
        <textarea id="sh-log" rows="14" readonly>${esc(logText())}</textarea>
        <div class="sh-row"><button class="sh-btn sm" data-act="copyLog"><i class="fa-solid fa-copy"></i> Скопировать</button><button class="sh-btn sm ghost" data-act="clearLog">Очистить</button></div></div>`;
    }

    function notesView(s) {
        const html = `${head('Уведомления')}${s.notes.length ? s.notes.map((n) => `<div class="sh-note ${n.type} ${n.read ? 'read' : ''}"><span>${esc(n.text)}</span><small>${fmtD(n.t)}</small></div>`).join('') : empty('Уведомлений нет.')}`;
        let changed = false;
        for (const n of s.notes) if (!n.read) { n.read = true; changed = true; }
        if (changed) setTimeout(() => { save(s); render(); }, 0);
        return html;
    }

    const TABS = { feed: feedTab, chats: chatsTab, dating: datingTab, study: studyTab, more: moreTab };
    const VIEWS = {
        thread: threadView, excuse: excuseView, task: taskView, delivery: deliveryView, market: marketView,
        wallet: walletView, campus: campusView, profile: profileView, settings: settingsView, notes: notesView,
    };

    /* ───────────────────────── рендер ───────────────────────── */

    function updateFab() {
        const fab = document.getElementById('sh-fab');
        if (!fab) return;
        fab.style.display = cfg().showFab ? '' : 'none';
        const s = S();
        const n = s ? s.notes.filter((x) => !x.read).length + s.threads.reduce((a, t) => a + (t.unread || 0), 0) : 0;
        const b = fab.querySelector('.sh-fab-badge');
        b.textContent = n ? String(Math.min(n, 99)) : '';
        b.style.display = n ? '' : 'none';
    }

    function render() {
        updateFab();
        const ph = document.getElementById('sh-phone');
        if (!ph || !ui.open) return;
        const scr = ph.querySelector('.sh-screen');
        const key = [ui.tab, ui.view, ui.param, ui.studyTab, ui.marketTab].join('|');
        const saved = {};
        scr.querySelectorAll('input[id], textarea[id], select[id]').forEach((el) => { saved[el.id] = el.value; });
        const focusId = document.activeElement && scr.contains(document.activeElement) ? document.activeElement.id : null;
        const top = scr.scrollTop;

        ph.querySelector('.sh-status').innerHTML = statusBar();
        scr.innerHTML = screenHTML();
        ph.querySelector('.sh-nav').innerHTML = navHTML();
        ph.querySelector('.sh-overlay').innerHTML = ui.busy ? `<div class="sh-busy"><i class="fa-solid fa-spinner fa-spin"></i><span>${esc(ui.busy)}</span></div>` : '';

        if (key === lastKey) {
            for (const [id, v] of Object.entries(saved)) { const el = document.getElementById(id); if (el && scr.contains(el)) el.value = v; }
            scr.scrollTop = top;
            if (focusId) document.getElementById(focusId)?.focus();
        } else scr.scrollTop = 0;
        if (ui.view === 'thread') scr.scrollTop = scr.scrollHeight;
        lastKey = key;
    }
    function isTyping() {
        const a = document.activeElement;
        const ph = document.getElementById('sh-phone');
        return !!(ph && a && ph.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName));
    }

    /* ───────────────────────── действия ───────────────────────── */

    function openThread(s, name, species = '', bio = '', kind = 'dm') {
        name = String(name).trim();
        let th = s.threads.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (!th) { th = { id: uid(), name, species, bio, kind, msgs: [], t: Date.now(), unread: 0 }; s.threads.unshift(th); }
        ui.view = 'thread'; ui.param = th.id;
        save(s);
        return th;
    }

    async function reply(s, th) {
        th.typing = true; render();
        const hist = th.msgs.filter((m) => !m.sys).slice(-14).map((m) => `${m.me ? s.profile.name : (m.from || th.name)}: ${m.text}`).join('\n');
        const who = th.kind === 'group'
            ? `участников учебной группы «${th.name}» (${th.bio}). Пиши от лица одного из участников в формате "Имя: текст".`
            : th.kind === 'char'
                ? `${th.name} — персонажа текущей истории. Сохраняй его характер и манеру речи из описания.`
                : `${th.name}${th.species ? ` (вид: ${th.species})` : ''}${th.bio ? `. О себе: ${th.bio}` : ''}`;
        let r = await aiText(`${world(s)}\n\nЭто переписка в защищённом мессенджере UniHub. Ты отвечаешь за ${who}\n\nИстория переписки:\n${hist}\n\nНапиши следующее сообщение собеседника: 1–3 предложения, живо, в стиле мессенджера, по-русски. Реагируй на вид и способности ${s.profile.name} по правилам выше — особенно в начале знакомства, но не в каждом сообщении.`);
        th.typing = false;
        if (S() !== s) return;
        if (r) {
            let from;
            if (th.kind === 'group') { const m = r.match(/^([^:\n]{2,30}):\s*/); if (m) { from = m[1]; r = r.slice(m[0].length); } }
            else r = r.replace(new RegExp(`^${escRe(th.name)}\\s*:\\s*`, 'i'), '');
            th.msgs.push({ me: false, from, text: r, t: Date.now() });
            th.t = Date.now();
            if (!(ui.open && ui.view === 'thread' && ui.param === th.id)) { th.unread = (th.unread || 0) + 1; toast('info', `${th.name}: ${r.slice(0, 80)}`); }
        } else th.msgs.push({ sys: true, text: 'Сообщение не доставлено: ИИ не ответил. Попробуйте ещё раз.', t: Date.now() });
        save(s); render();
    }

    function fillChatInput(text) {
        const ta = document.getElementById('send_textarea');
        if (!ta) return;
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
    }

    const ACT = {
        close: () => toggle(false),
        tab: (d) => { ui.tab = d.tab; ui.view = null; ui.param = null; render(); },
        go: (d) => { ui.view = d.view || null; ui.param = d.param || null; render(); },
        back: () => { ui.view = null; ui.param = null; render(); },
        copyLog: async () => {
            const ta = document.getElementById('sh-log');
            try { await navigator.clipboard.writeText(logText()); toast('success', 'Журнал скопирован.'); }
            catch { if (ta) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('success', 'Журнал скопирован.'); } catch { toast('info', 'Зажмите текст пальцем и скопируйте вручную.'); } } }
        },
        clearLog: () => { LOG.length = 0; render(); },

        /* вход */
        loadFac: (d, el, s) => { readAuth(s); return withBusy('Ищу факультеты в лоре…', async () => { s.faculties = await loadFaculties(s); save(s); }); },
        pickFac: (d, el, s) => { readAuth(s); s.profile.faculty = s.faculties[+d.i]?.name || ''; const f = document.getElementById('sh-a-fac'); if (f) f.value = ''; save(s); render(); },
        login: (d, el, s) => {
            readAuth(s);
            const fac = val('sh-a-fac') || s.profile.faculty;
            if (!s.profile.name) return toast('warning', 'Укажите имя студента.');
            if (!s.profile.species) return toast('warning', 'Выберите вид.');
            if (!s.profile.abilities) return toast('warning', 'Выберите способность или «Отсутствуют».');
            if (!fac) return toast('warning', 'Выберите факультет или впишите свой.');
            s.profile.faculty = fac;
            return withBusy('Составляю расписание…', async () => {
                s.schedule = await genSchedule(s, fac);
                s.auth = true; s.enforceFrom = Date.now(); s.quarter = { n: 1, start: Date.now() };
                s.expelled = false; s.expelReason = '';
                const c = ctx();
                if (c.name2 && !c.groupId && !s.threads.some((t) => t.kind === 'char')) s.threads.push({ id: uid(), name: c.name2, species: '', bio: '', kind: 'char', msgs: [], t: Date.now(), unread: 0 });
                notify(s, `🎓 Добро пожаловать, ${s.profile.name}! Расписание факультета «${fac}» готово.`, 'important');
                ui.tab = 'study'; ui.studyTab = 'schedule'; ui.view = null;
                save(s);
            });
        },

        /* лента */
        channel: (d) => { ui.channel = d.ch; render(); },
        post: (d, el, s) => {
            const text = val('sh-post');
            if (!text) return toast('warning', 'Напишите текст поста.');
            s.feed.unshift({ id: uid(), author: s.profile.name, species: s.profile.privacy.species ? s.profile.species : '', channel: val('sh-post-ch') || 'general', text, likes: 0, mine: true, t: Date.now() });
            document.getElementById('sh-post').value = '';
            save(s); render();
        },
        like: (d, el, s) => { const p = s.feed.find((x) => x.id === d.id); if (!p) return; p.liked = !p.liked; p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1)); save(s); render(); },
        genFeed: (d, el, s) => withBusy('Загружаю ленту…', async () => {
            const r = await aiJSON(`${world(s)}\n\nСгенерируй 6 свежих публикаций в ленту UniHub от разных студентов разных видов. Можно упоминать ${ctx().name2} и события мира. Каналы: general, study, clubs, dorms, species (пост внутри сообщества своего вида).${s.profile.species ? ` Минимум 1 пост от вида «${s.profile.species}» в канал species.` : ''} 1–2 поста могут обсуждать ${s.profile.name}: реакцию на вид и способности по правилам выше.\nФормат: [{"author":"Имя Фамилия","species":"вид","channel":"general","text":"до 300 символов, живой стиль соцсети","media":"краткое описание фото/видео или пустая строка","kind":"photo|video|reel|story","likes":12,"verified":true}]`);
            if (!Array.isArray(r) || !r.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            const now = Date.now();
            const posts = r.filter((p) => p && p.author && p.text).map((p, i) => ({ id: uid(), author: String(p.author).slice(0, 50), species: String(p.species || '').slice(0, 40), channel: CHANNELS[p.channel] && p.channel !== 'all' ? p.channel : 'general', text: String(p.text).slice(0, 600), media: String(p.media || '').slice(0, 200), kind: p.kind, likes: Math.max(0, parseInt(p.likes, 10) || 0), verified: p.verified !== false, t: now - i * 7 * MIN }));
            s.feed = [...posts, ...s.feed].slice(0, 80);
            save(s);
        }),
        dm: (d, el, s) => { openThread(s, d.name, d.species || '', d.bio || ''); render(); },

        /* чаты */
        newChat: (d, el, s) => { const n = val('sh-newchat'); if (!n) return toast('warning', 'Введите имя.'); openThread(s, n); render(); },
        send: (d, el, s) => {
            const th = s.threads.find((t) => t.id === d.id);
            const text = val('sh-msg');
            if (!th || !text || th.typing) return;
            th.msgs.push({ me: true, text, t: Date.now() }); th.t = Date.now();
            document.getElementById('sh-msg').value = '';
            save(s);
            return reply(s, th);
        },

        /* знакомства */
        dMode: (d, el, s) => { s.dating.mode = d.mode; s.dating.profiles = []; save(s); render(); },
        genDating: (d, el, s) => {
            const dt = s.dating;
            dt.fSpecies = val('sh-d-species'); dt.fAbility = val('sh-d-abil');
            return withBusy('Подбираю анкеты…', async () => {
                const r = await aiJSON(`${world(s)}\n\nСгенерируй 5 анкет студентов этого университета для ${dt.mode === 'friends' ? 'поиска друзей' : 'романтических знакомств'} в UniHub. Вид пользователя: ${s.profile.species || 'не указан'}. Фильтры: вид — ${dt.fSpecies || 'любой'}; способности — ${dt.fAbility || 'любые'}. Оцени межвидовую совместимость с пользователем (compat 0–100) и коротко объясни.\nФормат: [{"name":"Имя","age":20,"species":"","faculty":"","abilities":"","bio":"до 200 символов","compat":75,"compatNote":"одно предложение","verified":true}]`);
                if (!Array.isArray(r) || !r.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
                dt.profiles = r.filter((p) => p && p.name).map((p) => ({ id: uid(), name: String(p.name).slice(0, 40), age: parseInt(p.age, 10) || 19, species: String(p.species || '').slice(0, 40), faculty: String(p.faculty || '').slice(0, 60), abilities: String(p.abilities || '').slice(0, 120), bio: String(p.bio || '').slice(0, 300), compat: clamp(parseInt(p.compat, 10) || 50, 0, 100), compatNote: String(p.compatNote || '').slice(0, 160), verified: p.verified !== false }));
                save(s);
            });
        },
        dSkip: (d, el, s) => { s.dating.profiles = s.dating.profiles.filter((p) => p.id !== d.id); save(s); render(); },
        dLike: (d, el, s) => {
            const p = s.dating.profiles.find((x) => x.id === d.id);
            if (!p) return;
            s.dating.profiles = s.dating.profiles.filter((x) => x.id !== d.id);
            if (Math.random() < 0.15 + (p.compat / 100) * 0.7) {
                s.dating.matches.unshift({ name: p.name, species: p.species, bio: `${p.bio} Способности: ${p.abilities}` });
                const th = openThread(s, p.name, p.species, `${p.bio} Способности: ${p.abilities}. Познакомились через знакомства UniHub (${s.dating.mode === 'friends' ? 'дружба' : 'свидания'}).`);
                th.msgs.push({ sys: true, text: s.dating.mode === 'friends' ? 'Вы хотите дружить. Напишите первым!' : 'Взаимная симпатия! Напишите первым.', t: Date.now() });
                notify(s, `💘 Взаимная симпатия с ${p.name}!`, 'important');
            } else toast('info', `${p.name} пока не ответил(а) взаимностью.`);
            save(s); render();
        },
        dReport: (d, el, s) => {
            const p = s.dating.profiles.find((x) => x.id === d.id);
            if (!p) return;
            s.dating.profiles = s.dating.profiles.filter((x) => x.id !== d.id);
            s.tickets.unshift({ id: uid(), type: 'Жалоба', text: `Анкета в знакомствах: ${p.name}`, t: Date.now() });
            toast('success', 'Жалоба отправлена, анкета скрыта.');
            save(s); render();
        },

        /* учёба */
        studyTab: (d) => { ui.studyTab = d.st; render(); },
        schedDay: (d) => { ui.schedDay = +d.d; render(); },
        regenSchedule: (d, el, s) => {
            if (!confirm('Составить расписание заново? Посещаемость прошлых пар сохранится.')) return;
            return withBusy('Составляю расписание…', async () => { s.schedule = await genSchedule(s, s.profile.faculty); s.enforceFrom = Date.now(); save(s); });
        },
        checkin: (d, el, s) => {
            const o = findOcc(s, d.key); const now = Date.now();
            if (!o || s.attendance[d.key]) return;
            if (now < o.start - cfg().checkInEarlyMin * MIN || now >= o.end) return toast('warning', 'Отметка сейчас недоступна.');
            s.attendance[d.key] = 'present';
            notify(s, `✅ Вы отметились на паре «${o.cl.subject}».`);
            save(s); render();
        },
        excuse: (d, el, s) => {
            const o = findOcc(s, d.key); const reason = val('sh-excuse');
            if (!o || s.attendance[d.key] || s.excuses[d.key]) return;
            if (Date.now() >= o.end) return toast('warning', 'Пара уже закончилась, запрос не принят.');
            if (reason.length < 10) return toast('warning', 'Опишите причину подробнее.');
            return withBusy('Деканат рассматривает запрос…', async () => {
                const r = await aiJSON(`${world(s)}\n\nСтудент ${s.profile.name} просит признать отсутствие на паре «${o.cl.subject}» (${fmtD(o.start)}) уважительным. Причина: «${reason}». Ты — деканат. Уважительные причины: болезнь, форс-мажор, официальные мероприятия университета, особенности вида (полнолуние для оборотня, солнце для вампира и т.п.). Неуважительные: лень, проспал, свидание, «не хотелось».\nФормат: {"valid":true,"reply":"ответ деканата, 1 предложение"}`);
                const valid = r?.valid === true || r?.valid === 'true';
                s.excuses[d.key] = { reason, valid, reply: String(r?.reply || (valid ? 'Причина признана уважительной.' : 'Причина не признана уважительной.')).slice(0, 300) };
                if (valid) { s.attendance[d.key] = 'excused'; notify(s, `📝 Отсутствие на «${o.cl.subject}» признано уважительным.`); }
                else notify(s, `📝 Деканат отклонил причину для «${o.cl.subject}». Придите на пару, иначе будет прогул.`, 'warn');
                ui.view = null; ui.tab = 'study';
                save(s);
            });
        },
        extra: (d, el, s) => {
            if (s.tasks.some((t) => t.extra && !t.done && !t.expired)) return toast('warning', 'Сначала выполните уже взятое доп. задание.');
            const subjects = [...new Set(s.schedule.map((c) => c.subject))];
            const t = { id: uid(), src: `extra-${uid()}`, subject: pick(subjects.length ? subjects : ['Общий курс']), title: 'Доп. задание', desc: '', issued: Date.now(), deadline: Date.now() + cfg().extraTaskHours * HOUR, done: false, overdue: false, extra: true };
            s.tasks.push(t);
            genTaskDesc(s, t);
            ui.view = 'task'; ui.param = t.id;
            save(s); render();
        },
        retryTask: (d, el, s) => { const t = s.tasks.find((x) => x.id === d.id); if (t) genTaskDesc(s, t); },
        submit: (d, el, s) => {
            const t = s.tasks.find((x) => x.id === d.id);
            const ans = val('sh-ans');
            if (!t || t.done || t.expired) return;
            if (ans.length < 20) return toast('warning', 'Ответ слишком короткий.');
            return withBusy('Преподаватель проверяет работу…', async () => {
                const r = await aiJSON(`${world(s)}\n\nТы — преподаватель предмета «${t.subject}». Оцени ответ студента по пятибалльной шкале (2 — неудовлетворительно, 3, 4, 5 — отлично). Строго, но справедливо: отписки и ответы не по теме — 2.\nЗадание: ${t.desc}\nОтвет студента: ${ans}\nФормат: {"grade":4,"comment":"1–2 предложения"}`);
                let grade = Math.round(Number(r?.grade));
                if (!(grade >= 2 && grade <= 5)) grade = ans.length > 300 ? 4 : 3;
                const late = Date.now() > t.deadline && !t.extra;
                if (late) grade = Math.min(grade, 3);
                Object.assign(t, { done: true, doneAt: Date.now(), answer: ans, grade, comment: `${String(r?.comment || '').slice(0, 400)}${late ? ' Сдано после срока, оценка не выше 3.' : ''}` });
                s.grades.push({ id: uid(), subject: t.subject, grade, t: Date.now(), q: s.quarter.n, task: t.title });
                notify(s, `✅ «${t.title}»: оценка ${grade}.`);
                if (t.extra) {
                    const fixable = activeStrikes(s).find((k) => !k.taskId || s.tasks.find((x) => x.id === k.taskId)?.done);
                    if (grade < 3) notify(s, 'Доп. задание выполнено на 2 — нарушение не снято.', 'warn');
                    else if (fixable) { fixable.fixed = true; fixable.fixedAt = Date.now(); notify(s, `🩹 Нарушение снято: ${fixable.reason}. Рейтинг: ${rating(s)}%.`, 'important'); }
                    else if (activeStrikes(s).length) notify(s, 'Чтобы снять нарушение за несданное задание, сначала сдайте само просроченное задание.', 'warn');
                }
                save(s);
            });
        },
        calc: (d, el, s) => {
            const extra = val('sh-calc').split(/[\s,;]+/).map(Number).filter((n) => n >= 2 && n <= 5);
            const all = [...s.grades.map((g) => g.grade), ...extra];
            const out = document.getElementById('sh-calc-out');
            if (out) out.textContent = all.length ? `Средний балл станет ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(2)}.` : 'Введите оценки от 2 до 5.';
        },
        tutor: (d, el, s) => {
            const subj = val('sh-tutor');
            if (!subj) return toast('warning', 'Сначала нужно расписание с предметами.');
            return withBusy('Ищу репетитора…', async () => {
                const r = await aiJSON(`${world(s)}\n\nПридумай репетитора по предмету «${subj}» — старшекурсника или аспиранта этого университета.\nФормат: {"name":"","species":"","bio":"1–2 предложения, включая цену занятия в ₡"}`);
                const th = openThread(s, r?.name || `Репетитор (${subj})`, r?.species || '', `Репетитор по предмету «${subj}». ${r?.bio || ''}`);
                th.msgs.push({ sys: true, text: `Запрос на помощь по «${subj}» отправлен.`, t: Date.now() });
                save(s);
            });
        },
        groups: (d, el, s) => withBusy('Подбираю учебные группы…', async () => {
            const subjects = [...new Set(s.schedule.map((c) => c.subject))].join(', ');
            const r = await aiJSON(`${world(s)}\n\nПредложи 3 учебные группы для студента по его предметам: ${subjects}.\nФормат: [{"name":"","subject":"","when":"когда собираются"}]`);
            s.groupOffers = Array.isArray(r) ? r.filter((g) => g && g.name).slice(0, 5).map((g) => ({ name: String(g.name).slice(0, 60), subject: String(g.subject || '').slice(0, 60), when: String(g.when || '').slice(0, 60) })) : [];
            if (!s.groupOffers.length) toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            save(s);
        }),
        joinGroup: (d, el, s) => {
            const g = (s.groupOffers || [])[+d.i];
            if (!g) return;
            const th = openThread(s, g.name, '', `${g.subject}; встречи: ${g.when}`, 'group');
            th.msgs.push({ sys: true, text: `Вы вступили в группу «${g.name}».`, t: Date.now() });
            save(s); render();
        },
        reenroll: (d, el, s) => {
            if (!confirm('Подать документы заново? Расписание, оценки, задания и нарушения будут сброшены.')) return;
            Object.assign(s, { auth: false, schedule: [], attendance: {}, excuses: {}, tasks: [], strikes: [], grades: [], expelled: false, expelReason: '', lowGpaSince: 0, quarter: { n: 1, start: Date.now() } });
            save(s); render();
        },
        changeFaculty: (d, el, s) => {
            if (!confirm('Перевестись на другой факультет? Будет составлено новое расписание, текущие задания будут отменены.')) return;
            s.auth = false; s.schedule = []; s.tasks = s.tasks.filter((t) => t.done);
            ui.view = null;
            save(s); render();
        },

        /* сервисы */
        diet: (d) => { ui.diet = d.diet; render(); },
        order: (d, el, s) => {
            const m = s.menu.find((x) => x.id === d.id);
            if (!m || !pay(s, m.price, `Доставка: ${m.title}`)) return render();
            const now = Date.now();
            s.orders.unshift({ id: uid(), kind: 'food', title: m.title, price: m.price, t: now, eta: now + (20 + Math.floor(Math.random() * 25)) * MIN });
            toast('success', `Заказ «${m.title}» оформлен.`);
            save(s); render();
        },
        parcel: (d, el, s) => {
            const to = val('sh-p-to'), what = val('sh-p-what');
            if (!to || !what) return toast('warning', 'Укажите получателя и содержимое.');
            if (!pay(s, 60, `Посылка для ${to}`)) return render();
            const now = Date.now();
            s.orders.unshift({ id: uid(), kind: 'parcel', to, title: what, price: 60, t: now, eta: now + (40 + Math.floor(Math.random() * 50)) * MIN });
            toast('success', 'Посылка отправлена.');
            save(s); render();
        },
        genMenu: (d, el, s) => withBusy('Обновляю меню…', async () => {
            const r = await aiJSON(`${world(s)}\n\nСоставь 10 позиций меню доставки по кампусу для разных видов (кровь, сырое мясо, веган, нектар, эктоплазма, эмоции, огнеупорная еда, обычная еда и т.п.). Кафе и точки должны звучать как места этого университета.\nФормат: [{"title":"","place":"","price":150,"tags":["веган"]}] — теги короткие, строчными буквами.`);
            const list = Array.isArray(r) ? r.filter((m) => m && m.title && +m.price > 0) : [];
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.menu = list.map((m) => ({ id: uid(), title: String(m.title).slice(0, 80), place: String(m.place || '').slice(0, 60), price: Math.round(+m.price), tags: (Array.isArray(m.tags) ? m.tags : []).map((t) => String(t).toLowerCase().slice(0, 20)).slice(0, 4) }));
            ui.diet = 'all';
            save(s);
        }),

        mTab: (d) => { ui.marketTab = d.t; render(); },
        mcat: (d) => { ui.mcat = d.c; render(); },
        buy: (d, el, s) => {
            const m = s.market.find((x) => x.id === d.id);
            if (!m || !pay(s, m.price, `Покупка: ${m.title}`)) return render();
            s.market = s.market.filter((x) => x.id !== m.id);
            s.inventory.unshift({ title: m.title, t: Date.now() });
            toast('success', `Куплено: ${m.title}.`);
            save(s); render();
        },
        rent: (d, el, s) => {
            const m = s.market.find((x) => x.id === d.id);
            if (!m || !m.rent || !pay(s, m.rent, `Аренда на неделю: ${m.title}`)) return render();
            s.market = s.market.filter((x) => x.id !== m.id);
            s.inventory.unshift({ title: m.title, t: Date.now(), rentUntil: Date.now() + 7 * DAY });
            toast('success', `Арендовано на неделю: ${m.title}.`);
            save(s); render();
        },
        sell: (d, el, s) => {
            const title = val('sh-s-title'), price = Math.round(+val('sh-s-price'));
            if (!title || !(price > 0)) return toast('warning', 'Укажите название и цену.');
            s.listings.unshift({ id: uid(), title, cat: val('sh-s-cat'), price, t: Date.now(), sold: false });
            toast('success', 'Объявление опубликовано.');
            save(s); render();
        },
        genMarket: (d, el, s) => withBusy('Загружаю объявления…', async () => {
            const r = await aiJSON(`${world(s)}\n\nСгенерируй 8 объявлений маркетплейса студентов: учебники, мебель, электроника и специализированное оборудование для разных видов.\nФормат: [{"title":"","cat":"Учебники|Мебель|Электроника|Оборудование","price":500,"rent":0,"seller":"имя","rating":4.5,"verified":true}] — rent: цена аренды в неделю или 0.`);
            const list = Array.isArray(r) ? r.filter((m) => m && m.title && +m.price > 0) : [];
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.market = list.map((m) => ({ id: uid(), title: String(m.title).slice(0, 80), cat: MARKET_CATS.includes(m.cat) ? m.cat : 'Оборудование', price: Math.round(+m.price), rent: Math.max(0, Math.round(+m.rent || 0)), seller: String(m.seller || 'Студент').slice(0, 40), rating: clamp(+m.rating || 4, 1, 5), verified: m.verified !== false }));
            save(s);
        }),

        transfer: (d, el, s) => {
            const to = val('sh-w-to'), sum = Math.round(+val('sh-w-sum')), note = val('sh-w-note');
            if (!to || !(sum > 0)) return toast('warning', 'Укажите получателя и сумму.');
            if (!pay(s, sum, `Перевод: ${to}${note ? ` (${note})` : ''}`)) return render();
            const th = s.threads.find((t) => t.name.toLowerCase() === to.toLowerCase());
            if (th) th.msgs.push({ sys: true, text: `Вы перевели ${money(sum)}${note ? `: ${note}` : ''}.`, t: Date.now() });
            ['sh-w-to', 'sh-w-sum', 'sh-w-note'].forEach((id) => { const e = document.getElementById(id); if (e) e.value = ''; });
            toast('success', `Переведено ${money(sum)} для ${to}.`);
            save(s); render();
        },

        genEvents: (d, el, s) => withBusy('Ищу мероприятия…', async () => {
            const r = await aiJSON(`${world(s)}\n\nПридумай 4 ближайших мероприятия кампуса (вечеринки, лекции, турниры, ритуалы, ярмарки).\nФормат: [{"title":"","when":"например: пятница, 19:00","place":"","desc":"одно предложение"}]`);
            const list = Array.isArray(r) ? r.filter((e) => e && e.title) : [];
            if (!list.length) return toast('error', 'ИИ вернул ответ не в том формате. Попробуйте ещё раз.');
            s.events = list.map((e) => ({ id: uid(), title: String(e.title).slice(0, 80), when: String(e.when || '').slice(0, 50), place: String(e.place || '').slice(0, 60), desc: String(e.desc || '').slice(0, 200), going: false }));
            save(s);
        }),
        rsvp: (d, el, s) => { const e = s.events.find((x) => x.id === d.id); if (e) { e.going = !e.going; save(s); render(); } },
        club: (d, el, s) => { s.clubs = s.clubs.includes(d.c) ? s.clubs.filter((c) => c !== d.c) : [...s.clubs, d.c]; save(s); render(); },
        book: (d, el, s) => {
            const at = new Date(val('sh-b-when')).getTime();
            if (!at || at < Date.now()) return toast('warning', 'Выберите время в будущем.');
            const room = val('sh-b-room');
            if (s.bookings.some((b) => b.room === room && Math.abs(b.at - at) < HOUR)) return toast('warning', 'Это помещение на это время уже занято.');
            s.bookings.unshift({ id: uid(), room, at });
            toast('success', `Забронировано: ${room}, ${fmtD(at)}.`);
            save(s); render();
        },
        ticket: (d, el, s) => {
            const text = val('sh-t-text');
            if (!text) return toast('warning', 'Опишите проблему.');
            s.tickets.unshift({ id: uid(), type: val('sh-t-type'), text, t: Date.now() });
            document.getElementById('sh-t-text').value = '';
            toast('success', 'Заявка отправлена.');
            save(s); render();
        },
        dean: (d, el, s) => {
            const q = val('sh-dean');
            if (!q) return toast('warning', 'Напишите запрос.');
            return withBusy('Деканат отвечает…', async () => {
                const a = await aiText(`${world(s)}\n\nСтудент ${s.profile.name} (рейтинг ${rating(s)}%, нарушений ${activeStrikes(s).length}) пишет в деканат через UniHub: «${q}». Ответь от лица деканата: 1–3 предложения, официально, в духе этого мира.`);
                s.dean.unshift({ q, a: a || 'Запрос принят, ответ будет направлен позже.', t: Date.now() });
                const e = document.getElementById('sh-dean'); if (e) e.value = '';
                save(s);
            });
        },
        sos: (d, el, s) => {
            notify(s, '🚨 Сигнал отправлен в службу безопасности кампуса.', 'bad');
            fillChatInput(`*${s.profile.name} нажимает в UniHub кнопку экстренного вызова. Служба безопасности кампуса получает сигнал с геолокацией.*`);
            toast('info', 'Текст вызова вставлен в поле ввода чата — отправьте его, чтобы история отреагировала.');
            save(s); render();
        },

        saveProfile: (d, el, s) => {
            const p = s.profile;
            p.name = val('sh-pf-name') || p.name; readIdentity('sh-pf', p); p.bio = val('sh-pf-bio');
            toast('success', 'Профиль сохранён.');
            save(s); render();
        },
        pause: (d, el, s) => {
            const now = Date.now();
            if (s.pausedAt) {
                const delta = now - s.pausedAt;
                for (const t of s.tasks) if (!t.done && !t.expired && !t.overdue) t.deadline += delta;
                if (s.lowGpaSince) s.lowGpaSince += delta;
                s.quarter.start += delta;
                s.pauses.push([s.pausedAt, now]);
                s.pausedAt = 0;
                toast('success', 'Время учёбы снова идёт.');
            } else { s.pausedAt = now; toast('info', 'Учёба на паузе.'); }
            save(s); render();
        },
        gmBalance: (d, el, s) => {
            const v = Math.round(+val('sh-gm-bal'));
            if (!Number.isFinite(v)) return;
            tx(s, v - s.wallet.balance, 'Корректировка мастером игры');
            save(s); render();
        },
        resetChat: () => {
            if (!confirm('Удалить все данные UniHub в этом чате? Это необратимо.')) return;
            delete ctx().chatMetadata[MODULE]; delete ctx().chatMetadata[OLD_MODULE];
            ui.view = null; ui.tab = 'feed';
            save(); render();
        },
    };

    function onClick(e) {
        const el = e.target.closest('[data-act]');
        if (!el || el.disabled) return;
        e.preventDefault();
        const fn = ACT[el.dataset.act];
        if (!fn) return;
        const s = S();
        Promise.resolve(fn(el.dataset, el, s)).catch((err) => { logErr('Действие ' + el.dataset.act, err); toast('error', String(err?.message || err)); });
    }
    function onChange(e) {
        const el = e.target;
        const s = S();
        const k = el.dataset?.k;
        if (el.dataset.change === 'idSel') {
            const box = document.getElementById(el.dataset.other);
            if (box) box.style.display = el.value === '__other' ? '' : 'none';
            return;
        }
        if (el.dataset.change === 'privacy' && s) { s.profile.privacy[k] = el.checked; save(s); render(); }
        else if (el.dataset.change === 'cfg') { const n = Number(el.value); if (Number.isFinite(n)) { cfg()[k] = n; saveCfg(); updateInjection(); } }
        else if (el.dataset.change === 'cfgBool') { cfg()[k] = el.checked; saveCfg(); updateInjection(); updateFab(); }
    }
    function onKey(e) {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'sh-msg') {
            e.preventDefault();
            document.querySelector('#sh-phone [data-act="send"]')?.click();
        }
    }

    /* ───────────────────────── монтирование ───────────────────────── */

    // системная кнопка «Назад» на Android: сначала возвращает из подэкрана, затем закрывает приложение
    let skipPop = false;
    function toggle(force) {
        const want = typeof force === 'boolean' ? force : !ui.open;
        if (want === ui.open) { if (want) render(); return; }
        ui.open = want;
        document.getElementById('sh-phone')?.classList.toggle('open', ui.open);
        document.getElementById('sh-fab')?.classList.toggle('hidden', ui.open);
        if (ui.open) {
            lastKey = ''; render();
            try { history.pushState({ unihub: true }, ''); } catch { /* нет history */ }
        } else if (history.state?.unihub) {
            skipPop = true;
            history.back();
        }
    }
    window.addEventListener('popstate', () => {
        if (skipPop) { skipPop = false; return; }
        if (!ui.open) return;
        if (ui.view) {
            ui.view = null; ui.param = null; render();
            try { history.pushState({ unihub: true }, ''); } catch { /* нет history */ }
        } else {
            ui.open = false;
            document.getElementById('sh-phone')?.classList.remove('open');
            document.getElementById('sh-fab')?.classList.remove('hidden');
        }
    });

    function mount() {
        if (document.getElementById('sh-phone')) return;
        const fab = document.createElement('button');
        fab.id = 'sh-fab';
        fab.title = 'UniHub';
        fab.innerHTML = '<i class="fa-solid fa-mobile-screen-button"></i><b class="sh-fab-badge"></b>';
        fab.addEventListener('click', () => toggle());
        document.body.appendChild(fab);

        const ph = document.createElement('div');
        ph.id = 'sh-phone';
        ph.innerHTML = '<div class="sh-status"></div><div class="sh-screen"></div><nav class="sh-nav"></nav><div class="sh-overlay"></div>';
        ph.addEventListener('click', onClick);
        ph.addEventListener('change', onChange);
        ph.addEventListener('keydown', onKey);
        document.body.appendChild(ph);

        const menu = document.getElementById('extensionsMenu');
        if (menu) {
            const it = document.createElement('div');
            it.className = 'list-group-item flex-container flexGap5 interactable';
            it.tabIndex = 0;
            it.innerHTML = '<div class="fa-solid fa-graduation-cap extensionsMenuExtensionButton"></div>UniHub';
            it.addEventListener('click', () => toggle(true));
            menu.appendChild(it);
        }

        const box = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (box) {
            box.insertAdjacentHTML('beforeend', `<div class="unihub-settings"><div class="inline-drawer">
              <div class="inline-drawer-toggle inline-drawer-header"><b>UniHub</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
              <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="sh-cfg-fab"> <span>Плавающая кнопка телефона</span></label>
                <label class="checkbox_label"><input type="checkbox" id="sh-cfg-inject"> <span>Передавать статус студента ИИ</span></label>
                <div class="menu_button" id="sh-cfg-open"><i class="fa-solid fa-mobile-screen-button"></i> Открыть UniHub</div>
                <div class="menu_button" id="sh-cfg-log"><i class="fa-solid fa-bug"></i> Журнал ошибок</div>
              </div></div></div>`);
            const f = document.getElementById('sh-cfg-fab'), i = document.getElementById('sh-cfg-inject');
            f.checked = !!cfg().showFab; i.checked = !!cfg().inject;
            f.addEventListener('change', () => { cfg().showFab = f.checked; saveCfg(); updateFab(); });
            i.addEventListener('change', () => { cfg().inject = i.checked; saveCfg(); updateInjection(); });
            document.getElementById('sh-cfg-open').addEventListener('click', () => toggle(true));
            document.getElementById('sh-cfg-log').addEventListener('click', () => { ui.view = 'log'; toggle(true); });
        }
    }

    function onChatChanged() {
        ui.view = null; ui.param = null; lastKey = '';
        tick();
        updateInjection();
        render();
    }

    function init() {
        cfg();
        mount();
        const { eventSource, event_types } = ctx();
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        setInterval(() => {
            try { tick(); } catch (e) { logErr('Таймер', e); }
            updateInjection();
            if (!ui.open) return updateFab();
            if (isTyping()) {
                const st = document.querySelector('#sh-phone .sh-status');
                if (st) st.innerHTML = statusBar();
                updateFab();
            } else render();
        }, 30000);
        onChatChanged();
        console.log('[UniHub] загружено');
    }

    globalThis.UniHub = { open: () => toggle(true), close: () => toggle(false), state: S, tick, _act: ACT, _inj: buildInjection };
    jQuery(() => {
        try { init(); }
        catch (e) {
            logErr('Запуск', e);
            try { toastr.error(`UniHub не запустился: ${e.message}`, 'UniHub', { timeOut: 0, extendedTimeOut: 0 }); } catch { /* нет toastr */ }
        }
    });
})();
