const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../index.js', 'utf8');
const MIN = 60000;
const BASE = new Date(2026, 0, 5, 10).getTime();
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function app(options = {}) {
    const timers = new Map(), events = new Map(), calls = [], sceneCalls = [], prompts = [], elements = {};
    let wallNow = Date.now(), random = () => Math.random();
    const fakeMath = Object.create(Math); fakeMath.random = () => random();
    class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [wallNow])); } static now() { return wallNow; } }
    let sceneAnswer = () => ({ state: 'apart', evidence: context.chat.filter(m => !m.is_system).slice(-1)[0]?.mes || '' });
    let nextTimer = 1, answer = async prompt => prompt.includes('Часы истории перед')
        ? { minutes: 10 } : { known: true, rel: 60, status: 'друзья', pair: false };
    const context = {
        characterId: 0, chatId: 'a', chatMetadata: {}, extensionSettings: {},
        name1: 'Студент', name2: 'Алекс', characters: [{ description: 'Студент Алекс' }],
        chat: [{ name: 'Алекс', mes: 'Привет!', send_date: 'first' }],
        eventSource: { on: (name, handler) => events.set(name, handler) },
        setExtensionPrompt: (id, prompt) => { if (id === 'unihub') prompts.push(prompt); },
        generateRaw: async ({ prompt }) => { if (prompt.startsWith('UniHubSceneContact:')) { sceneCalls.push(prompt); return JSON.stringify(await sceneAnswer(prompt)); } calls.push(prompt); return JSON.stringify(await answer(prompt)); },
    };
    const box = {
        SillyTavern: { getContext: () => context }, Date: FakeDate, Math: fakeMath,
        window: { addEventListener() {}, localStorage: options.storage }, document: { getElementById: id => elements[id] || null, querySelector: () => null }, navigator: {}, console, confirm: () => true,
        jQuery() {},
        setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id),
    };
    const exposed = `
    const realRender = render, realTick = tick, realNotify = notify;
    render = () => {}; tick = () => {}; notify = () => {};
    globalThis.testApi = { cfg, S, save, syncRel, needsRelSync, storySyncKey, storySyncState,
        scheduleStorySync, flushStorySync, onStoryReply, buildInjection, bindStoryEvents,
        setClock, aiRaw, onChatChanged, readHorae, parseStoryTime, syncHoraeClock, pollHoraeClock,
        readChatClock, guessedStoryClock, hasStoryProgress, refreshQuests, makeQuest, questEvent, fireHook, stripMention, commentHTML, aiComments, ACT, ui, questHTML, questScopeReady, drainQueue: () => queue,
        queueMessengerReply, tickMessenger, presenceFor, applyPresence, planInitiative, presenceDot, chatsTab, threadView, messengerState, startDM, sceneContactKey, sceneContactState, checkSceneContact, reply, startMeeting, personKey, personName, samePerson, normaliseIdentities, lorePerson, openThread, feedTab, personView, scheduleDM, looksLikeChar, voiceContext, rememberVoices, extractLorePeople, updateRel, cancelUser,
        realRender, realTick, realNotify, screenHTML, cleanReply, loreText, loreFor, enqueue, genSchedule, occurrences, stampGame, taskView, rating, validSetting, onChange, priceOf, placeFoodOrder, pay, tx, genTaskDesc, updateInjection, postHTML, personVerified,
        setWorldInfo: value => { worldInfoModulePromise = Promise.resolve(value); },
        setGenerating: value => { storyGenerating = value; }, getGenerating: () => storyGenerating };
    `;
    vm.runInNewContext(source.replace('    globalThis.UniHub =', exposed + '\n    globalThis.UniHub ='), box);
    const api = box.testApi;
    const s = api.S(); s.auth = true; s.clock = { mode: 'game', t: BASE };
    s.campusLoreAt = s.genClubsAt = s.lorePeopleAt = 1;
    const th = { id: 'char', kind: 'char', name: 'Алекс', bio: '', msgs: [], rel: 0 };
    s.threads.push(th);
    api.cfg().syncHorae = false;
    api.storySyncState(s);
    const names = ['CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_RECEIVED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_DELETED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SENT', 'USER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'CHARACTER_EDITED'];
    api.bindStoryEvents(context.eventSource, Object.fromEntries(names.map(n => [n, n])));
    return { context, api, s, th, calls, sceneCalls, prompts, timers, elements, window: box.window, document: box.document,
        answer: fn => { answer = fn; }, sceneAnswer: fn => { sceneAnswer = fn; }, setRandom: value => { random = typeof value === 'function' ? value : () => value; }, setWall: value => { wallNow = value; }, wall: () => wallNow, emit: (name, ...args) => events.get(name)?.(...args),
        flush: () => api.flushStorySync(api.S()),
        add: (mes, is_user = false) => { context.chat.push({ name: is_user ? 'Студент' : 'Алекс', mes, is_user, send_date: 'm' + context.chat.length }); return context.chat.length - 1; },
    };
}
test('comments always get full character speech examples and conditional style, irrespective of random participation', async () => {
    const a=app(); a.setRandom(0.99); const example='A'.repeat(7000)+' SHORT-FORMAL-SPEECH';
    a.context.characters[0]={data:{description:'Reserved.',personality:'Restrained. No slang.',scenario:'Works.',mes_example:'<START>'+example}};
    a.answer(prompt=>{
        assert.ok(prompt.includes(example)); assert.equal(prompt.split('SHORT-FORMAL-SPEECH').length-1,1);
        assert.match(prompt,/Эмодзи и сленг используй ТОЛЬКО/); assert.match(prompt,/без эмодзи и сленга, нейтральная речь/);
        assert.match(prompt,/Алекс \(персонаж основной истории\) МОЖЕТ оставить комментарий/);
        assert.doesNotMatch(prompt,/коротко, эмоционально, с эмодзи и сленгом/);
        return [];
    });
    await a.api.aiComments(a.s,{author:'Катя',text:'Пост',comments:[]},'Ответь'); assert.equal(a.calls.length,1);
});
test('feed posts include primary speech examples and individually sourced NPC manner', async () => {
    const a=app(); a.context.characters[0].mes_example='{{char}}: Принято. До встречи.';
    a.s.lorePeople=[{name:'Катя',role:'student',bio:'Сдержанная',temperament:'Ценит точность',speech:'Официально, без эмодзи'}];
    a.answer(prompt=>{
        assert.match(prompt,/Алекс: Принято\. До встречи\./); assert.match(prompt,/Ценит точность/); assert.match(prompt,/Официально, без эмодзи/);
        assert.match(prompt,/Не более 1 поста/); assert.doesNotMatch(prompt,/Ровно 1 пост/);
        return {posts:[{author:'Катя',text:'Встреча состоится завтра.',voice:{traits:'Чужой характер',speech:'Мемы'}}]};
    });
    await a.api.ACT.genFeed({},null,a.s); assert.equal(a.s.feed[0].author,'Катя'); assert.equal(a.s.peopleVoices.length,0);
});
test('targeted NPC outside the first lore slots gets complete matching raw lore including its tail', async () => {
    const a=app(), lore='NPC details. '.repeat(1000)+' Ольга говорит официально и никогда не использует эмодзи.';
    a.context.characters[0].data={extensions:{world:'People'}};
    a.context.loadWorldInfo=async()=>({entries:{npc:{key:['Ольга'],content:lore}}});
    a.s.lorePeople=Array.from({length:15},(_,i)=>({name:'NPC '+i,role:'student',bio:'Other'}));
    a.s.lorePeople.push({name:'Ольга',role:'student',bio:'Сдержанная',speech:'Не использует сленг'});
    a.answer(prompt=>{assert.ok(prompt.includes(lore)); assert.match(prompt,/Речь: Не использует сленг/); return [{author:'Ольга',text:'Принято.'}];});
    await a.api.aiComments(a.s,{author:'Ольга',text:'Пост',comments:[]},'Ответь'); assert.equal(a.calls.length,1);
});
test('invented NPC has one saved voice across feed, replies, private chat and reload', async () => {
    const a=messengerApp();
    a.answer(()=>({posts:[{author:'Новый NPC',text:'Принято.',voice:{traits:'Сдержанный, ценит точность',speech:'Кратко и официально, без эмодзи и сленга'}}]}));
    await a.api.ACT.genFeed({},null,a.s); assert.equal(a.s.peopleVoices.length,1);
    a.answer(prompt=>{assert.match(prompt,/Сохранённая речь: Кратко и официально, без эмодзи и сленга/); return {posts:[{author:'Новый NPC',text:'Хорошо.',voice:{traits:'Другой характер',speech:'Сленг'}}]};});
    await a.api.ACT.genFeed({},null,a.s); assert.equal(a.s.peopleVoices[0].speech,'Кратко и официально, без эмодзи и сленга');
    a.answer(prompt=>{
        assert.match(prompt,/Сохранённый характер придуманного NPC: Сдержанный, ценит точность/);
        assert.match(prompt,/Сохранённая речь: Кратко и официально, без эмодзи и сленга/);
        return [{author:'Новый NPC',text:'Понял.',voice:{traits:'Очень весёлый',speech:'Сленг и смайлы'}}];
    });
    await a.api.aiComments(a.s,a.s.feed[0],'Ответь'); assert.equal(a.s.peopleVoices[0].traits,'Сдержанный, ценит точность');
    a.context.chatMetadata.unihub=JSON.parse(JSON.stringify(a.s)); const restored=a.api.S();
    const th=a.api.openThread(restored,'Новый NPC');
    a.answer(prompt=>{assert.match(prompt,/Кратко и официально, без эмодзи и сленга/); return {reply:'Хорошо.',delta:0};});
    const r=await a.api.reply(restored,th); assert.equal(r.sent,true); assert.equal(restored.peopleVoices.length,1);
});
test('model-supplied invented voice cannot overwrite primary, user or lore personalities', () => {
    const a=app(); a.s.lorePeople=[{name:'Marvin Branagh',role:'student',speech:'Официально'}]; a.api.S();
    a.api.rememberVoices(a.s,['Алекс','Студент','Марвин Бранаг'].map(author=>({author,voice:{traits:'Другой',speech:'Мемы'}})));
    assert.equal(a.s.peopleVoices.length,0); assert.equal(a.s.lorePeople[0].speech,'Официально');
});
test('localized aliases share saved NPC voice and canon is prioritized when lore is added', async () => {
    const a=app(); a.api.rememberVoices(a.s,[{author:'Claire Redfield',voice:{traits:'Старая версия',speech:'Шутит'}}]);
    a.s.feed=[{author:'Клэр Редфилд',text:'Принято.',comments:[]}]; a.api.S();
    assert.equal(a.s.peopleVoices[0].name,'Клэр Редфилд');
    a.api.rememberVoices(a.s,[{author:'Claire Redfield',voice:{traits:'Другая',speech:'Сленг'}}]); assert.equal(a.s.peopleVoices.length,1);
    a.s.lorePeople=[{name:'Claire Redfield',role:'student',bio:'Из лора',speech:'Речь по канону'}]; a.api.S();
    const text=await a.api.voiceContext(a.s,['Клэр Редфилд']); assert.match(text,/Речь по канону/); assert.doesNotMatch(text,/Сохранённый характер придуманного NPC: Старая версия/);
});
test('direct public reply may be declined instead of forcing a character to answer', async () => {
    const a=app(); a.setRandom(0.9); const p={id:'p',author:'Алекс',text:'Пост',comments:[]}; a.s.feed.push(p);
    a.elements['sh-cmt']={value:'Комментарий'};
    a.answer(prompt=>{assert.match(prompt,/Алекс может ответить Студент/); assert.match(prompt,/допустим пустой список/); assert.doesNotMatch(prompt,/обязательно отвечает/); return {comments:[],score:null,followup:null};});
    await a.api.ACT.comment({id:'p'},null,a.s); assert.equal(p.comments.length,1); assert.equal(p.comments[0].mine,true); assert.equal(p.loadingComments,false);
});
test('quest posts and public conflict do not impose default slang or aggressive personality', async () => {
    const a=app(); a.s.lorePeople=[{name:'Катя',role:'student',speech:'Сдержанно, без грубости'}];
    const q=a.api.makeQuest({k:'post',title:'Пост',desc:'Напиши пост',trigger:'post',hook:{type:'post',from:'Катя',intent:'Ответить'}},a.s);
    a.answer(prompt=>{assert.match(prompt,/Сдержанно, без грубости/); assert.match(prompt,/Эмодзи и сленг используй ТОЛЬКО/); return 'Принято.';});
    a.api.fireHook(a.s,q,'Пост'); await a.api.drainQueue(); assert.equal(a.s.feed[0].author,'Катя');
    const th={id:'npc',kind:'dm',name:'Катя',msgs:[],rel:-55}; a.s.threads.push(th);
    a.answer(prompt=>{assert.match(prompt,/Не навязывай язвительность, агрессию/); assert.match(prompt,/Сдержанно, без грубости/); return {text:'',media:''};});
    a.api.updateRel(a.s,th,-6,false,8,'Ссора'); await a.api.drainQueue(); assert.equal(a.s.feed.length,1);
});
test('NPC extraction records source personality and speech for later generation', async () => {
    const a=app();
    a.answer(prompt=>{assert.match(prompt,/temperament и speech выпиши только из данных/); return [{name:'Катя',role:'student',bio:'Студентка',temperament:'Уважает личные границы',speech:'Говорит кратко, без сленга'}];});
    await a.api.extractLorePeople(a.s); assert.equal(a.s.lorePeople[0].speech,'Говорит кратко, без сленга');
    const text=await a.api.voiceContext(a.s,['Катя']); assert.match(text,/Уважает личные границы/); assert.match(text,/Говорит кратко, без сленга/);
});
test('late generation cannot store an NPC voice in another chat', async () => {
    const a=app(),d=defer(); a.answer(()=>d.promise); const pending=a.api.aiComments(a.s,{author:'Катя',text:'Пост',comments:[]},'Ответь');
    for(let i=0;i<30&&!a.calls.length;i++) await Promise.resolve(); assert.equal(a.calls.length,1);
    a.context.chatMetadata={}; a.context.chatId='other'; const other=a.api.S();
    d.resolve([{author:'New',text:'Hi',voice:{traits:'Новый характер',speech:'Речь'}}]);
    const r=await pending; assert.equal(r.length,0); assert.equal(a.s.peopleVoices,undefined); assert.equal(other.peopleVoices,undefined);
});
test('unchecked main relationships cannot label a card-established couple as mere acquaintances in social prompts', async () => {
    const a=app(); a.context.characters[0].description='{{user}} is his girlfriend.';
    a.answer(prompt=>{
        assert.match(prompt,/Студент is his girlfriend/); assert.match(prompt,/Статус ещё не проверен: исходные отношения бери из карточки/);
        assert.doesNotMatch(prompt,/Отношения с Студент: знакомые/); return [];
    });
    await a.api.aiComments(a.s,{author:'Катя',text:'Пост',comments:[]},'Ответь');
});
test('messenger receives complete description, personality, scenario and speech examples once', async () => {
    for(const nested of [false,true]) {
        const a=messengerApp();
        const card={description:'HEAD-D '+ 'D'.repeat(12000)+' {{user}} TAIL-D',personality:'HEAD-P '+ 'P'.repeat(4500)+' {{char}} TAIL-P',
            scenario:'HEAD-S '+ 'S'.repeat(3800)+' TAIL-S',mes_example:'<START>HEAD-E '+ 'E'.repeat(6000)+' {{user}} TAIL-E'};
        a.context.characters[0]=nested ? {data:card} : card;
        a.answer(prompt=>{
            for(const value of Object.values(card)) {
                const text=value.replaceAll('{{user}}','Студент').replaceAll('{{char}}','Алекс').replaceAll('<START>','');
                assert.ok(prompt.includes(text));
            }
            for(const tail of ['TAIL-D','TAIL-P','TAIL-S','TAIL-E']) assert.equal(prompt.split(tail).length-1,1,tail);
            return {reply:'Привет!',delta:0};
        });
        const r=await a.api.reply(a.s,a.th); assert.equal(r.sent,true); assert.equal(a.calls.length,1);
    }
});
test('general generation receives complete character fields from both card formats', async () => {
    for(const nested of [false,true]) {
        const a=app();
        const card={description:'D'.repeat(9000)+' DESCRIPTION-END',personality:'P'.repeat(2800)+' PERSONALITY-END',scenario:'S'.repeat(3100)+' SCENARIO-END'};
        a.context.characters[0]=nested ? {data:card} : card;
        a.answer(prompt=>{
            for(const value of Object.values(card)) assert.ok(prompt.includes(value));
            return [{author:'Катя',text:'Комментарий'}];
        });
        const list=await a.api.aiComments(a.s,{author:'Маша',text:'Пост',comments:[]},'Ответь');
        assert.equal(list.length,1); assert.equal(a.calls.length,1);
    }
});
test('relationship block at the end of a long card establishes the couple without phone messages', async () => {
    const a=app(); a.context.name1='Arisha'; a.s.profile.name='Ариша';
    a.context.characters[0]={data:{description:'APPEARANCE: '+ 'Detail. '.repeat(1100)+"RELATIONSHIPS: {{user}} is his girlfriend; they've been dating for quite some time and are in a serious relationship.",personality:'Kind.',scenario:'On duty.'}};
    const evidence="Arisha is his girlfriend; they've been dating for quite some time and are in a serious relationship.";
    a.answer(prompt=>{
        assert.ok(prompt.includes(evidence)); assert.match(prompt,/personality: Kind\./); assert.match(prompt,/scenario: On duty\./);
        assert.match(prompt,/Arisha и профиль UniHub Ариша — один человек/);
        return {card_known:true,card_pair:true,card_evidence:evidence,known:false,rel:0,status:'не знакомы',pair:false,note:'Нет сообщений'};
    });
    await a.api.syncRel(a.s,a.th);
    assert.equal(a.th.pair,true); assert.equal(a.th.known,true); assert.equal(a.th.status,'пара'); assert.equal(a.s.profile.relWithChar,true);
    assert.equal(a.th.msgs.length,0); assert.match(a.th.relNote,/girlfriend/);
});
test('no romance in a short chat cannot clear an existing or manually marked couple', async () => {
    for(const mode of ['existing','manual']) {
        const a=app(); a.th.known=true; a.th.rel=75; a.th.status='пара'; a.th.relNote='Давно вместе';
        if(mode==='existing') a.th.pair=true; else a.s.profile.relWithChar=true;
        a.answer(()=>({known:false,rel:0,status:'не знакомы',pair:false,note:'Не флиртовали в последних сообщениях'}));
        await a.api.syncRel(a.s,a.th);
        assert.equal(a.th.pair,true); assert.equal(a.th.known,true); assert.equal(a.th.status,'пара'); assert.equal(a.th.rel,75); assert.equal(a.s.profile.relWithChar,true);
        assert.equal(a.th.relNote,'Давно вместе');
    }
});
test('missing or unknown pair fields do not mean breakup', async () => {
    for(const extra of [{},{pair:null},{pair:false},{pair:'false'}]) {
        const a=app(); a.th.pair=true; a.s.profile.relWithChar=true; a.answer(()=>({rel:60,status:'друзья',...extra}));
        await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,true); assert.equal(a.s.profile.relWithChar,true); assert.equal(a.th.status,'пара');
    }
});
test('grounded breakup in the story overrides a couple from the card and survives short context', async () => {
    const a=app(), card='Студент — его девушка, они давно в отношениях.', ending='Алекс и Студент расстались и решили больше не быть парой.';
    a.context.characters[0].description=card; a.th.pair=true; a.s.profile.relWithChar=true;
    a.add(ending); a.answer(()=>({card_known:true,card_pair:true,card_evidence:card,known:true,rel:20,status:'знакомые',pair:false,pair_evidence:{source:'story',text:ending}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,false); assert.equal(a.s.profile.relWithChar,false);
    for(let i=0;i<31;i++) a.add('Рабочий день '+i);
    a.context.characters[0].personality='Another card detail';
    a.answer(()=>({card_known:true,card_pair:true,card_evidence:card,known:true,rel:20,status:'знакомые',pair:true,pair_evidence:{source:'card',text:card}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,false); assert.equal(a.s.profile.relWithChar,false); assert.equal(a.th.known,true);
});
test('removing a breakup by swipe restores the unchanged card relationship', async () => {
    const a=app(), card='{{user}} is his girlfriend.', quote='Студент is his girlfriend.', ending='Мы расстались.';
    a.context.characters[0].description=card; const id=a.add(ending);
    a.answer(()=>({card_known:true,card_pair:true,card_evidence:quote,known:true,pair:false,pair_evidence:{source:'story',text:ending}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,false);
    a.context.chat[id].mes='Мы пошли домой.'; a.context.chat[id].swipe_id=1;
    a.answer(()=>({known:true,pair:null,status:'знакомые'}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,true); assert.equal(a.s.profile.relWithChar,true);
});
test('invented breakup quotes, busy scenes, denied breakups and hypothetical events cannot clear a couple', async () => {
    for(const text of ['Я занят на работе.','Я не смогу встретиться в четверг.','Мы не расстались.','We did not break up.','If we break up, I will be sad.','We might break up.','Мы расстались.']) {
        const a=app(); a.th.pair=true; a.s.profile.relWithChar=true;
        if(text!=='Мы расстались.') a.add(text);
        a.answer(()=>({known:true,pair:false,rel:30,status:'знакомые',pair_evidence:{source:'story',text}}));
        await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,true,text); assert.equal(a.s.profile.relWithChar,true,text);
    }
});
test('a grounded breakup in the private chat is accepted but ordinary arguments keep pair status', async () => {
    const a=app(); a.th.pair=true; a.s.profile.relWithChar=true; a.th.msgs=[{me:false,text:'Мы поссорились, я злюсь на тебя.',t:1}];
    a.answer(()=>({known:true,pair:false,rel:-30,status:'в ссоре',note:'Ссора',pair_evidence:{source:'dm',text:a.th.msgs[0].text}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,true); assert.equal(a.th.rel,-30);
    a.th.msgs.push({me:false,text:'Мы больше не встречаемся.',t:2});
    a.answer(()=>({known:true,pair:false,rel:-30,status:'неприязнь',pair_evidence:{source:'dm',text:'Мы больше не встречаемся.'}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,false); assert.equal(a.s.profile.relWithChar,false);
});
test('a reconciliation event can restore a previously broken couple', async () => {
    const a=app(); const ending='We broke up.', reunion='We are dating again.'; a.add(ending);
    a.answer(()=>({known:true,pair:false,pair_evidence:{source:'story',text:ending}})); await a.api.syncRel(a.s,a.th);
    a.add(reunion); a.answer(()=>({known:true,pair:true,status:'пара',pair_evidence:{source:'story',text:reunion}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,true); assert.equal(a.s.profile.relWithChar,true);
});
test('editing only the tail of the card invalidates relationship synchronization', async () => {
    const a=app(); a.context.characters[0].description='Detail. '.repeat(1000)+'No relationship.';
    a.answer(()=>({known:false,pair:null})); await a.api.syncRel(a.s,a.th); assert.equal(a.api.needsRelSync(a.s,a.th),false);
    a.context.characters[0].description='Detail. '.repeat(1000)+'{{user}} is his girlfriend.';
    assert.equal(a.api.needsRelSync(a.s,a.th),true);
    a.answer(()=>({card_known:true,card_pair:true,card_evidence:'Студент is his girlfriend.',known:true,pair:true,pair_evidence:{source:'card',text:'Студент is his girlfriend.'}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,true);
});
test('speech examples and invented card quotes cannot establish a couple', async () => {
    const a=app(); a.context.characters[0]={description:'Friendly student.',mes_example:'{{user}} is his girlfriend.'};
    a.answer(()=>({card_known:true,card_pair:true,card_evidence:'Студент is his girlfriend.',pair:true,pair_evidence:{source:'card',text:'Студент is his girlfriend.'}}));
    await a.api.syncRel(a.s,a.th); assert.equal(a.th.pair,false); assert.equal(a.s.profile.relWithChar,false);
    for(const card of ['{{user}} is not his girlfriend; they are not dating.','{{user}} is not his girlfriend.','He hopes {{user}} will be his girlfriend.']) {
        const b=app(); b.context.characters[0].description=card; const quote=card.replace('{{user}}','Студент');
        b.answer(()=>({card_pair:true,card_evidence:quote,pair:true,pair_evidence:{source:'card',text:quote}}));
        await b.api.syncRel(b.s,b.th); assert.equal(b.th.pair,false,card);
    }
});
test('new card relationship result is discarded after a card edit during the request', async () => {
    const a=app(), d=defer(); a.context.characters[0].description='{{user}} is his girlfriend.'; a.answer(()=>d.promise);
    const running=a.api.syncRel(a.s,a.th); a.context.characters[0].description='Strangers.';
    d.resolve({card_known:true,card_pair:true,card_evidence:'Студент is his girlfriend.',known:true,pair:true,pair_evidence:{source:'card',text:'Студент is his girlfriend.'}});
    await running; assert.equal(a.th.pair,undefined); assert.equal(a.s.profile.relWithChar,false);
});
test('closed phone: relationships follow new messages, same-length edits, swipes, deletion', async () => {
    const a = app(); a.api.cfg().syncAI = false;
    let rel = 20; a.answer(async () => ({ known: true, rel, status: 'приятели' }));
    a.api.scheduleStorySync(); await a.flush(); assert.equal(a.th.rel, 20);
    let id = a.add('Мы друзья.'); await a.emit('MESSAGE_RECEIVED', id); await a.flush();
    rel = 70; a.context.chat[id].mes = 'Мы встречаемся.';
    await a.emit('MESSAGE_EDITED', id); await a.flush(); assert.equal(a.th.rel, 70);
    rel = -30; a.context.chat[id].swipe_id = 1; a.context.chat[id].mes = 'Мы поссорились.';
    await a.emit('MESSAGE_SWIPED', id); await a.flush(); assert.equal(a.th.rel, -30);
    a.context.chat.splice(id, 1); rel = 10;
    await a.emit('MESSAGE_DELETED'); await a.flush(); assert.equal(a.th.rel, 10);
    const n = a.calls.length; a.api.scheduleStorySync(); await a.flush(); assert.equal(a.calls.length, n);
});
test('duplicate reply events count delivery once and edited clock uses original base', async () => {
    const a = app(); let minutes = 10;
    a.answer(async p => p.includes('Часы истории перед') ? { minutes } : { rel: 30 });
    a.s.orders.push({ kind: 'food', stage: 'preparing', injected: true, title: 'Еда' });
    const id = a.add('Через десять минут.');
    a.emit('MESSAGE_RECEIVED', id); a.emit('MESSAGE_RECEIVED', id); a.emit('CHARACTER_MESSAGE_RENDERED', id);
    await a.flush(); assert.equal(a.s.replyCount, 1); assert.equal(a.s.orders[0].stage, 'delivered');
    assert.equal(a.s.clock.t, BASE + 10 * MIN);
    a.emit('GENERATION_ENDED'); await a.flush(); assert.equal(a.s.clock.t, BASE + 10 * MIN);
    minutes = 20; a.context.chat[id].mes = 'Через двадцать минут.';
    a.emit('MESSAGE_EDITED', id); await a.flush(); assert.equal(a.s.clock.t, BASE + 20 * MIN);
    minutes = 5; a.context.chat[id].mes = 'Через пять минут.';
    a.emit('MESSAGE_SWIPED', id); await a.flush(); assert.equal(a.s.clock.t, BASE + 20 * MIN);
});
test('new reply arriving during time sync gets processed and stale result is discarded', async () => {
    const a = app(), d = defer(); let clockCalls = 0;
    a.answer(async p => p.includes('Часы истории перед') ? (++clockCalls === 1 ? d.promise : { minutes: 7 }) : { rel: 40 });
    a.emit('MESSAGE_RECEIVED', a.add('Старый ответ.')); const running = a.flush();
    a.emit('MESSAGE_RECEIVED', a.add('Новый ответ.')); d.resolve({ minutes: 100 }); await running;
    assert.equal(a.s.clock.t, BASE + 7 * MIN); assert.equal(clockCalls, 2); assert.equal(a.s.replyCount, 2);
});
test('switching chats cannot apply an old relationship or time result', async () => {
    const a = app(), d = defer(); a.answer(async () => d.promise);
    a.emit('MESSAGE_RECEIVED', a.add('Потом прошёл час.')); const running = a.flush();
    a.context.chatMetadata = {}; a.context.chatId = 'b'; a.context.chat = [{ name: 'Алекс', mes: 'Другой чат' }];
    const b = a.api.S(); b.auth = true; b.clock.t = BASE; d.resolve({ minutes: 90, rel: 90 }); await running;
    assert.equal(a.s.clock.t, BASE); assert.equal(b.clock.t, BASE); assert.equal(a.th.rel, 0);
});
test('manual clock changes and real-time mode survive pending AI result', async () => {
    for (const real of [false, true]) {
        const a = app(), d = defer(); a.answer(async p => p.includes('Часы истории перед') ? d.promise : { rel: 0 });
        a.emit('MESSAGE_RECEIVED', a.add('Ещё одна реплика.')); const running = a.flush();
        if (real) a.s.clock.mode = 'real'; else a.api.setClock(a.s, BASE + 60 * MIN, 'вручную');
        d.resolve({ minutes: 120 }); await running;
        assert.equal(a.s.clock.t, real ? BASE : BASE + 60 * MIN);
        assert.equal(a.s.clock.mode, real ? 'real' : 'game');
    }
});
test('disabled time AI and zero-minute step make no time AI calls', async () => {
    const a = app(); a.api.cfg().syncAI = false; a.api.cfg().stepMin = 0;
    a.emit('MESSAGE_RECEIVED', a.add('Время не меняется.')); await a.flush();
    assert.equal(a.s.clock.t, BASE); assert.equal(a.calls.some(p => p.includes('Часы истории перед')), false);
});
test('quiet UniHub generation does not start a story-generation recursion', async () => {
    const a = app(); delete a.context.generateRaw;
    a.context.generateQuietPrompt = async function (quietPrompt) {
        await a.emit('GENERATION_STARTED', 'quiet', {}, false); await a.emit('GENERATION_ENDED');
        return '{"rel":45,"status":"друзья"}';
    };
    a.api.scheduleStorySync(); await a.flush(); assert.equal(a.th.rel, 45); assert.equal(a.api.getGenerating(), false);
    await a.emit('GENERATION_STARTED', 'quiet', {}, false); assert.equal(a.api.getGenerating(), false);
});
test('main generation waits for in-flight sync then gets refreshed prompt', async () => {
    const a = app(), d = defer(); a.answer(async () => d.promise);
    a.add('Продолжим выбранную историю.', true);
    a.api.scheduleStorySync(); const running = a.flush();
    let started = false;
    const starting = a.emit('GENERATION_STARTED', 'normal', {}, false).then(() => { started = true; });
    await Promise.resolve(); assert.equal(started, false);
    d.resolve({ known: true, rel: 70, status: 'друзья' }); await running; await starting;
    assert.equal(a.api.getGenerating(), true); assert.match(a.prompts.at(-1), /друзья/);
    a.emit('GENERATION_ENDED'); await a.flush(); assert.equal(a.api.getGenerating(), false);
});
test('chat loading does not advance an existing answer again', async () => {
    const a = app(); a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, BASE);
    a.emit('CHAT_LOADED'); await a.flush(); assert.equal(a.s.clock.t, BASE);
});
test('old DM excerpts persist with bounded length and narrator-only privacy rules', () => {
    const a = app(), old = Date.now() - 5 * 86400000;
    a.th.msgs = [{ text: 'Старый разговор', me: true, t: old }];
    a.s.threads.push({ kind: 'dm', name: 'Ирина', t: old, msgs: [{ text: 'Секрет Ирины', t: old, me: false }] });
    const prompt = a.api.buildInjection(); assert.match(prompt, /Старый разговор/); assert.match(prompt, /Секрет Ирины/);
    assert.match(prompt, /Только для рассказчика/); assert.match(prompt, /не знает их содержания/);
    a.api.cfg().shareDMs = false; const noDM = a.api.buildInjection();
    assert.doesNotMatch(noDM, /Старый разговор|Секрет Ирины/);
    a.api.cfg().inject = false; assert.equal(a.api.buildInjection(), '');
});
test('swipe timestamps change without counting elapsed time from a new base', async () => {
    const a = app(); a.api.cfg().syncAI = false;
    const id = a.add('Первый вариант'); a.emit('MESSAGE_RECEIVED', id); await a.flush();
    a.context.chat[id].send_date = 'changed-swipe-date'; a.context.chat[id].swipe_id = 1;
    a.context.chat[id].mes = 'Другой вариант'; a.emit('MESSAGE_SWIPED', id); await a.flush();
    assert.equal(a.s.clock.t, BASE + 10 * MIN);
});
test('deletion does not advance the prior historical answer', async () => {
    const a = app(); a.api.cfg().syncAI = false;
    const id = a.add('Последний ответ'); a.emit('MESSAGE_RECEIVED', id); await a.flush();
    a.context.chat.pop(); a.emit('MESSAGE_DELETED'); await a.flush();
    a.emit('GENERATION_ENDED'); await a.flush(); assert.equal(a.s.clock.t, BASE + 10 * MIN);
});
test('regeneration replacing the message keeps its original time base and reply count', async () => {
    const a = app(); a.api.cfg().syncAI = false;
    let id = a.add('Первый ответ'); a.emit('MESSAGE_RECEIVED', id); await a.flush();
    await a.emit('GENERATION_STARTED', 'regenerate', {}, false);
    a.context.chat.pop(); a.emit('MESSAGE_DELETED');
    id = a.add('Перегенерированный ответ'); a.context.chat[id].send_date = 'new-generated-date';
    a.emit('MESSAGE_RECEIVED', id); a.emit('GENERATION_ENDED'); await a.flush();
    assert.equal(a.s.clock.t, BASE + 10 * MIN); assert.equal(a.s.replyCount, 1);
});
test('Horae separate date/time fields preserve the story date', () => {
    const a = app(); a.context.chat[0].horae_meta = {
        timestamp: { story_date: '2025-09-01', story_time: '14:30', absolute: '2026-10-02T08:54:00Z' }
    };
    assert.equal(a.api.readHorae(), new Date(2025, 8, 1, 14, 30).getTime());
});
test('Horae API aligns an older story date on opening a chat', async () => {
    const a = app(); a.api.cfg().syncHorae = true;
    a.window.Horae = { isEnabled: () => true, getLatestState: () => ({ timestamp: { story_date: '2025-09-01', story_time: '14:30' } }) };
    a.emit('CHAT_CHANGED'); await a.flush();
    assert.equal(a.s.clock.t, new Date(2025, 8, 1, 14, 30).getTime());
});
test('date-only metadata cannot be misread as a dotted clock time', () => {
    const a = app(); a.context.chat[0].horae_meta = { timestamp: { story_date: '01.09.2025', absolute: '2026-10-02T08:54:00Z' } };
    assert.equal(a.api.readHorae(), null);
});
test('background raw UniHub request cannot swallow main generation end', async () => {
    const a = app(), d = defer(); await a.emit('GENERATION_STARTED', 'normal', {}, false);
    a.answer(async () => d.promise); const background = a.api.aiRaw('Фоновый запрос');
    a.emit('GENERATION_ENDED'); assert.equal(a.api.getGenerating(), false);
    d.resolve({ rel: 0 }); await background;
});
test('Horae changes after the chat event and manual edits are detected without new text', () => {
    const a = app(); a.api.cfg().syncHorae = true;
    let time = '14:30';
    a.window.Horae = { getLatestState: () => ({ timestamp: { story_date: '2025-09-01', story_time: time } }) };
    a.api.pollHoraeClock(); assert.equal(a.s.clock.t, new Date(2025, 8, 1, 14, 30).getTime());
    time = '16:15'; a.api.pollHoraeClock(); assert.equal(a.s.clock.t, new Date(2025, 8, 1, 16, 15).getTime());
    time = '09:10'; a.api.pollHoraeClock(); assert.equal(a.s.clock.t, new Date(2025, 8, 1, 9, 10).getTime());
    assert.equal(a.calls.length, 0);
});
test('Horae carries an older date anchor across messages without mistaking absolute for story time', () => {
    const a = app();
    a.context.chat[0].horae_meta = { timestamp: { story_date: '2025-09-01', story_time: '10:00' } };
    for (let i = 0; i < 5; i++) a.add('Продолжаем.');
    a.context.chat.at(-1).horae_meta = { timestamp: { story_time: '23:45', absolute: '2026-10-02T08:00:00Z' } };
    assert.equal(a.api.readHorae(), new Date(2025, 8, 1, 23, 45).getTime());
});
test('Horae settings, real mode, and manual time overrides remain effective', () => {
    const a = app(); let enabled = true;
    a.window.Horae = { isEnabled: () => enabled, getLatestState: () => ({ timestamp: { story_date: '2025-09-01', story_time: '14:30' } }) };
    a.api.pollHoraeClock(); assert.equal(a.s.clock.t, BASE); // UniHub syncHorae is off.
    a.api.cfg().syncHorae = true; a.s.clock.mode = 'real'; a.api.pollHoraeClock(); assert.equal(a.s.clock.t, BASE);
    a.s.clock.mode = 'game'; enabled = false; a.api.pollHoraeClock(); assert.equal(a.s.clock.t, BASE);
    enabled = true; a.api.pollHoraeClock();
    const manual = a.s.clock.t + 60 * MIN; a.api.setClock(a.s, manual, 'вручную');
    a.api.pollHoraeClock(); assert.equal(a.s.clock.t, manual);
});
test('Horae raw tags and legacy metadata pair dates with times', () => {
    const a = app(); a.context.chat[0].mes = 'История<horae>time:01.09.2025 14:30\nlocation:кампус</horae>';
    assert.equal(a.api.readHorae(), new Date(2025, 8, 1, 14, 30).getTime());
    a.context.chat[0].mes = 'История'; a.context.chatMetadata.horae = { date: '2025/09/02', time: '00:15' };
    assert.equal(a.api.readHorae(), new Date(2025, 8, 2, 0, 15).getTime());
});
test('main chat explicit date and earlier clock time align exactly without an invented day', async () => {
    const a = app();
    a.answer(async p => p.includes('Часы истории перед') ? { date: '2025-09-01', time: '09:00', minutes: 0 } : { rel: 0 });
    a.emit('MESSAGE_RECEIVED', a.add('Сейчас 1 сентября 2025 года, 09:00.')); await a.flush();
    assert.equal(a.s.clock.t, new Date(2025, 8, 1, 9).getTime());
    a.answer(async p => p.includes('Часы истории перед') ? { time: '08:30', minutes: 0 } : { rel: 0 });
    a.emit('MESSAGE_RECEIVED', a.add('Уточнение: сейчас 08:30.')); await a.flush();
    assert.equal(a.s.clock.t, new Date(2025, 8, 1, 8, 30).getTime());
});
test('Horae Russian calendar dates and invalid date input are handled consistently', () => {
    const a = app();
    a.context.chat[0].horae_meta = { timestamp: { story_date: '1 сентября 2025 года', story_time: '09:30' } };
    assert.equal(a.api.readHorae(), new Date(2025, 8, 1, 9, 30).getTime());
    assert.equal(a.api.parseStoryTime('2025-02-30 09:30', BASE), null);
    assert.equal(a.api.parseStoryTime('2025-09-01 25:00', BASE), null);
});
test('Horae polling resumes when available and cannot touch another chat or an active story generation', async () => {
    const a = app(); a.api.cfg().syncHorae = true; a.api.pollHoraeClock(); assert.equal(a.s.clock.t, BASE);
    a.window.Horae = { getLatestState: () => ({ timestamp: { story_date: '2025-09-01', story_time: '09:00' } }) };
    await a.emit('GENERATION_STARTED', 'normal', {}, false);
    const before = a.s.clock.t;
    a.window.Horae.getLatestState = () => ({ timestamp: { story_date: '2025-09-01', story_time: '10:00' } });
    a.api.pollHoraeClock(); assert.equal(a.s.clock.t, before);
    a.emit('GENERATION_ENDED'); a.api.pollHoraeClock(); assert.equal(a.s.clock.t, new Date(2025, 8, 1, 10).getTime());
    a.context.chatMetadata = {}; a.context.chatId = 'b'; const b = a.api.S(); b.auth = true; b.clock.t = BASE;
    assert.equal(a.api.syncHoraeClock(a.s), null); assert.equal(b.clock.t, BASE);
});
test('without Horae, explicit scene time is read without asking the model', async () => {
    const a = app(); a.api.cfg().syncHorae = true; a.api.cfg().syncAI = false;
    a.emit('MESSAGE_RECEIVED', a.add('Сейчас 1 сентября 2025 года, 18:20. Мы в библиотеке.')); await a.flush();
    assert.equal(a.s.clock.t, new Date(2025, 8, 1, 18, 20).getTime());
    assert.equal(a.s.clock.source, 'время из чата');
    assert.equal(a.calls.some(p => p.includes('Часы истории перед')), false);
});
test('Horae stays ahead of a contradictory timestamp in the chat', async () => {
    const a = app(); a.api.cfg().syncHorae = true;
    a.window.Horae = { getLatestState: () => ({ timestamp: { story_date: '2025-09-01', story_time: '14:30' } }) };
    a.emit('MESSAGE_RECEIVED', a.add('Сейчас 2025-09-01 18:20.')); await a.flush();
    assert.equal(a.s.clock.t, new Date(2025, 8, 1, 14, 30).getTime());
    assert.equal(a.s.clock.source, 'Horae');
});
test('time AI sees user context and chooses a plausible time for a scene without exact clocks', async () => {
    const a = app(); a.add('На город опускается вечер.', true);
    a.answer(async p => p.includes('Часы истории перед') ? { time: '18:30', inferred: true } : { rel: 0 });
    a.emit('MESSAGE_RECEIVED', a.add('Они сидят у окна и смотрят на закат.')); await a.flush();
    assert.equal(a.s.clock.t, new Date(2026, 0, 5, 18, 30).getTime());
    assert.equal(a.s.clock.source, 'ИИ: выбранное время');
    assert.ok(a.calls.find(p => p.includes('Часы истории перед')).includes('На город опускается вечер.'));
});
test('invalid time JSON falls back to a chosen step instead of freezing the clock', async () => {
    const a = app(); a.answer(async () => ({ irrelevant: true }));
    a.emit('MESSAGE_RECEIVED', a.add('Они разговаривают.')); await a.flush();
    assert.equal(a.s.clock.t, BASE + 10 * MIN); assert.equal(a.s.clock.source, 'UniHub: выбранное время');
});
test('without a model, textual relative time beats the fallback step', async () => {
    const a = app(); a.api.cfg().syncAI = false;
    a.emit('MESSAGE_RECEIVED', a.add('Спустя полчаса они вышли из библиотеки.')); await a.flush();
    assert.equal(a.s.clock.t, BASE + 30 * MIN);
});
test('a new story without any time hints starts at 09:00 only once', async () => {
    const a = app(); a.s.clock.source = 'старт'; a.api.cfg().syncAI = false;
    a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 9).getTime());
    assert.equal(a.s.clock.storyInitialized, true);
    a.emit('CHAT_LOADED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 9).getTime());
});
test('first entry reads an existing story timestamp rather than adding a step to it', async () => {
    const a = app(); a.s.clock.source = 'старт'; a.api.cfg().syncAI = false;
    a.context.chat[0].mes = 'На часах 15:40.';
    a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 15, 40).getTime());
    a.emit('CHAT_LOADED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 15, 40).getTime());
});
test('a user-only new story can receive a model-chosen initial time', async () => {
    const a = app(); a.context.chat = [{ name: 'Студент', is_user: true, mes: 'Мы пришли в столовую на обед.' }];
    a.s.clock.source = 'старт'; a.answer(async () => ({ time: '13:00', inferred: true }));
    a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 13).getTime());
});
test('an empty story receives an initial clock without requiring a model request', async () => {
    const a = app(); a.context.chat = []; a.s.clock.source = 'старт'; a.s.threads = [];
    a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 9).getTime());
    assert.equal(a.calls.length, 0);
});
test('planned meeting timestamps are not interpreted as present story time', async () => {
    const a = app(); a.api.cfg().syncAI = false;
    a.emit('MESSAGE_RECEIVED', a.add('Сейчас мы договоримся: завтра встретимся в 18:30.')); await a.flush();
    assert.equal(a.s.clock.t, BASE + 10 * MIN);
});
test('March and May dates keep their distinct calendar months', () => {
    const a = app();
    assert.equal(a.api.parseStoryTime('1 марта 2025 14:30', BASE), new Date(2025, 2, 1, 14, 30).getTime());
    assert.equal(a.api.parseStoryTime('1 мая 2025 14:30', BASE), new Date(2025, 4, 1, 14, 30).getTime());
});
test('initialization cannot add elapsed minutes to an already existing response', async () => {
    const a = app(); a.s.clock.source = 'старт';
    a.answer(async p => p.includes('Часы истории перед') ? { minutes: 10 } : { rel: 0 });
    a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 9).getTime());
});
test('offline initial time follows the latest day-part clue in user and character context', async () => {
    const a = app(); a.s.clock.source = 'старт'; a.api.cfg().syncAI = false;
    a.context.chat = [{ is_user: true, mes: 'Было утро, но теперь сейчас вечер.' }, { is_user: false, mes: 'Они смотрят в окно.' }];
    a.emit('CHAT_CHANGED'); await a.flush(); assert.equal(a.s.clock.t, new Date(2026, 0, 5, 18).getTime());
});
test('model unavailability still leaves working fallback clocks', async () => {
    const a = app(); delete a.context.generateRaw;
    a.s.threads = []; // No other model requests in this scenario.
    a.emit('MESSAGE_RECEIVED', a.add('Они разговаривают.')); await a.flush();
    assert.equal(a.s.clock.t, BASE + 10 * MIN);
});
test('an empty chat cannot receive a predefined UniHub opening plot', () => {
    const a = app(); a.context.chat = [];
    a.s.social.quests = [{ k: 'rp', t: 'Подвал', desc: 'Найди книгу в подвале', setup: 'Алекс зовёт студента в подвал', done: false }];
    a.s.notes = [{ type: 'important', text: 'Алекс уже встретил студента в подвале', t: Date.now() }];
    const prompt = a.api.buildInjection();
    assert.doesNotMatch(prompt, /подвал|Задания дня|Предстоящие события|Недавние события/);
    assert.match(prompt, /Студент/);
});
test('rerolling the only assistant opening does not inject its derived relationship and clock', async () => {
    const a = app(); a.context.characters[0].first_mes = '';
    a.context.chat[0].mes = 'Алекс спас студента из подвала.';
    a.th.status = 'друзья'; a.th.relNote = 'спас студента из подвала';
    a.s.clock.source = 'ИИ по чату';
    await a.emit('GENERATION_STARTED', 'swipe', {}, false);
    assert.doesNotMatch(a.prompts.at(-1), /подвал|Отношения|Время истории \(часы UniHub\)/);
});
test('daily plot quests wait for the user to accept an opening by replying to it', async () => {
    const a = app(); a.context.chat = [];
    assert.equal(a.api.refreshQuests(a.s), false); assert.equal(a.calls.length, 0);
    a.add('Напиши вступление.', true); assert.equal(a.api.refreshQuests(a.s), false);
    a.add('Алекс сидит в библиотеке.'); assert.equal(a.api.refreshQuests(a.s), false);
    a.context.chat.at(-1).mes = 'Другой вариант: Алекс гуляет в парке.';
    assert.equal(a.api.refreshQuests(a.s), false); assert.equal(a.calls.length, 0);
    a.add('Я подхожу к Алексу.', true);
    a.answer(async () => [{ k: 'rp', title: 'Парк', desc: 'Помоги в парке', n: 1 }, { k: 'like', title: 'Лайки', n: 2 }, { k: 'post', title: 'Пост', n: 1 }]);
    assert.equal(a.api.refreshQuests(a.s), true); await a.api.drainQueue();
    assert.equal(a.s.social.quests.length, 3); assert.equal(a.s.social.quests[0].t, 'Парк');
    assert.match(a.calls[0], /гуляет в парке/); assert.doesNotMatch(a.calls[0], /сидит в библиотеке/);
    assert.match(a.api.buildInjection(), /Задания дня|Время истории \(часы UniHub\)/);
});
test('regenerate and deletion events keep the opening prompt free of old plot hooks', async () => {
    const a = app(); a.s.social.quests = [{ k: 'rp', t: 'Подвал', desc: 'Старый сюжет в подвале', done: false }];
    await a.emit('GENERATION_STARTED', 'regenerate', {}, false); assert.doesNotMatch(a.prompts.at(-1), /подвал/);
    a.context.chat.pop(); a.emit('MESSAGE_DELETED'); assert.doesNotMatch(a.prompts.at(-1), /подвал/);
    const id = a.add('Новый вариант в парке.'); a.emit('MESSAGE_RECEIVED', id); a.emit('GENERATION_ENDED');
    assert.doesNotMatch(a.prompts.at(-1), /подвал|Задания дня/);
    assert.equal(a.api.hasStoryProgress(), false);
});
test('empty placeholders and opening requests do not count as an accepted story', () => {
    const a = app(); a.context.chat = [{ is_system: true, mes: 'Пустое вступление' }, { is_user: false, mes: ' ' }, { is_user: true, mes: 'Начни историю.' }];
    assert.equal(a.api.hasStoryProgress(), false);
    a.add('Настоящее вступление.'); assert.equal(a.api.hasStoryProgress(), false);
    a.add('Мой ответ персонажу.', true); assert.equal(a.api.hasStoryProgress(), true);
});
test('manual phone actions still reach the model while the opening is being selected', () => {
    const a = app(); a.context.chat = [];
    a.th.msgs.push({ me: true, text: 'Я заказал кофе.', t: Date.now() });
    a.s.orders.push({ kind: 'food', title: 'Кофе', dueReply: 1, stage: 'cooking' });
    const prompt = a.api.buildInjection(); assert.match(prompt, /Я заказал кофе/); assert.match(prompt, /ДОСТАВКА/);
    assert.doesNotMatch(prompt, /Задания дня|Время истории \(часы UniHub\)/);
});
test('quests derived from a changed story cannot be committed after the AI request finishes', async () => {
    const a = app(), d = defer(); a.add('Я отвечаю на вступление.', true);
    a.answer(async () => d.promise); assert.equal(a.api.refreshQuests(a.s), true);
    await Promise.resolve(); await Promise.resolve();
    a.context.chat = []; d.resolve([{ k: 'rp', title: 'Устаревшее', desc: 'Старый сюжет', n: 1 }]);
    await a.api.drainQueue(); assert.equal(a.s.social.quests.length, 0); assert.equal(a.s.social.questDay, '');
});
function feedQuests(a, k = 'comment') {
    a.s.feed.push({ id: 'sale', author: 'Рита Филлипс', story: 'Распродажа у Кендо', text: 'Скидки у Кендо', comments: [] },
        { id: 'bikes', author: 'Клэр Редфилд', story: 'Мотопробег к озеру', text: 'Кто со мной?', comments: [] });
    const q = a.api.makeQuest({ k, title: 'Огненные скидки', desc: 'В теме Кендо', targetPostId: 'sale', n: 2,
        trigger: k, hook: { type: 'dm', from: 'Роберт Кендо', intent: 'Предложит скидку' } }, a.s);
    a.s.social.quests = [q]; return q;
}
test('Kendo comment quest and its DM hook ignore the motorcycle thread', () => {
    const a = app(), q = feedQuests(a);
    for (let i = 0; i < 2; i++) a.api.questEvent(a.s, 'comment', 1, '', 'Я!', { postId: 'bikes' });
    assert.equal(q.p, 0); assert.equal(q.done, false); assert.equal(q.hookAt, undefined);
    a.api.questEvent(a.s, 'comment', 1, '', 'Вопрос о скидке', { postId: 'sale' });
    assert.equal(q.p, 1); assert.ok(q.hookAt); assert.equal(q.hookPostId, 'sale');
    a.api.questEvent(a.s, 'comment', 1, '', 'Спасибо', { postId: 'sale' });
    assert.equal(q.p, 2); assert.equal(q.done, true);
});
test('reply action uses captured post and records comment before waiting for AI', async () => {
    const a = app(), q = feedQuests(a), d = defer();
    a.elements['sh-cmt'] = { value: 'Я! 🖐' }; a.api.ui.replyTo = 'Клэр Редфилд'; a.answer(() => d.promise);
    const run = a.api.ACT.comment({ id: 'bikes' }, null, a.s);
    assert.equal(a.s.feed[1].comments.length, 1); assert.equal(q.p, 0); assert.equal(q.hookAt, undefined);
    a.api.ui.param = 'sale'; d.resolve({ comments: [], followup: null }); await run;
    assert.equal(q.p, 0); assert.equal(q.hookAt, undefined);
    const generic = a.api.makeQuest({ k: 'comment', n: 2 }, a.s); a.s.social.quests.push(generic);
    a.elements['sh-cmt'].value = 'Другой ответ'; const wait = defer(); a.answer(() => wait.promise);
    const pending = a.api.ACT.comment({ id: 'bikes' }, null, a.s);
    assert.equal(generic.p, 1); wait.resolve({ comments: [] }); await pending;
    assert.equal(generic.p, 1);
});
test('reply and like quests require their own action in the selected post', () => {
    for (const k of ['reply', 'like']) {
        const a = app(), q = feedQuests(a, k);
        a.api.questEvent(a.s, 'comment', 1, '', 'Ответ', { postId: 'sale' }); assert.equal(q.p, 0);
        a.api.questEvent(a.s, k, 1, '', 'Ответ', { postId: 'bikes' }); assert.equal(q.p, 0);
        a.api.questEvent(a.s, k, 1, '', 'Ответ', { postId: 'sale' }); assert.equal(q.p, 1);
        if (k === 'like') { assert.equal(q.n, 1); assert.equal(q.done, true); }
    }
});
test('quest generation validates post IDs and makes unscoped descriptions truthful', () => {
    const a = app(); feedQuests(a);
    assert.equal(a.api.makeQuest({ k: 'comment', targetPostId: 'invented' }, a.s), null);
    const q = a.api.makeQuest({ k: 'comment', n: 2, title: 'Кендо', desc: 'О распродаже Кендо', trigger: 'dm', hook: { type: 'dm', from: 'Кендо' } }, a.s);
    assert.equal(q.targetPostId, ''); assert.equal(q.hook, null); assert.equal(q.trigger, 'comment');
    assert.equal(q.t, 'Разговор в ленте'); assert.equal(q.desc, 'Оставь 2 комментария в ленте UniHub.');
    a.s.social.quests = [q]; a.api.questEvent(a.s, 'comment'); assert.equal(q.p, 0);
    a.api.questEvent(a.s, 'comment', 1, '', '', { postId: 'bikes' }); assert.equal(q.p, 1);
});
test('legacy targeted counters and delayed hooks fail closed without taking back rewards', async () => {
    const a = app(); feedQuests(a);
    const q = { id: 'old', k: 'comment', t: 'Кендо', desc: 'Комментируй распродажу', n: 2, p: 0, r: { authority: 1, money: 0 }, trigger: 'comment', hook: { type: 'dm', from: 'Кендо' }, hookAt: 1 };
    a.s.social.quests = [q]; a.api.questEvent(a.s, 'comment', 1, '', 'Мотоциклы', { postId: 'bikes' }); assert.equal(q.p, 0);
    assert.match(a.api.questHTML(q), /Старое задание/);
    a.api.fireHook(a.s, q, 'Мотоциклы'); await a.api.drainQueue(); assert.equal(a.calls.length, 0); assert.equal(q.hook, null);
    q.done = true; q.p = 2; a.api.questEvent(a.s, 'comment', 1, '', '', { postId: 'sale' }); assert.equal(q.done, true); assert.equal(q.p, 2);
});
test('valid delayed DM hook retains selected post evidence', async () => {
    const a = app(); a.setRandom(0.2); const q = feedQuests(a); a.answer(() => ({ reply: 'Что присматриваешь?' }));
    a.api.questEvent(a.s, 'comment', 1, '', 'Пост Риты о распродаже: «Есть фонарь?»', { postId: 'sale' });
    a.api.fireHook(a.s, q, q.hookDetail); await a.api.drainQueue(); await a.api.drainQueue();
    assert.equal(a.calls.length, 1); assert.match(a.calls[0], /Есть фонарь/);
    assert.equal(a.s.threads.find(t => t.name === 'Роберт Кендо').msgs.length, 1);
});
test('saved replies render one mention for full name, short name and collapsed handle', () => {
    const a = app();
    for (const text of ['@Тони пока ты первый!', '@Тони Редвуд @Тони пока ты первый!', '@ТониРедвуд, пока ты первый!', 'Тони, пока ты первый!']) {
        const html = a.api.commentHTML({ id: 'c', author: 'Клэр', replyTo: 'Тони Редвуд', text, t: BASE }, { id: 'bikes' });
        assert.equal((html.match(/@/g) || []).length, 1); assert.match(html, /пока ты первый!/);
    }
    assert.equal(a.api.stripMention('Шерил, ну ты зануда', 'Шерил Грант'), 'ну ты зануда');
    assert.equal(a.api.stripMention('@Тонио другое имя', 'Тони Редвуд'), '@Тонио другое имя');
    assert.equal(a.api.stripMention('Спасибо @Рик', 'Тони Редвуд'), 'Спасибо @Рик');
    assert.equal(a.api.stripMention('@Шерил Грант', 'Шерил Грант'), '');
});
test('new AI replies remove duplicate mentions while preserving other mentions', async () => {
    const a = app(); a.answer(() => [{ author: 'Клэр', replyTo: 'Тони Редвуд', text: '@Тони пока ты первый! Позови @Рика' }]);
    const list = await a.api.aiComments(a.s, { author: 'Клэр', text: 'Мотоциклы', comments: [] }, 'Ответь');
    assert.equal(list[0].text, 'пока ты первый! Позови @Рика');
    assert.match(a.calls[0], /Адресата ответа указывай только в replyTo/);
});
function messengerApp(random = 0.2) {
    const a = app(); a.setRandom(random); a.api.cfg().proactiveDMs = false;
    a.answer(() => ({ reply: 'Привет! Как дела?', delta: 0, meet: null }));
    const p = a.api.presenceFor(a.s, a.th.name); p.online = true; p.until = a.wall() + 8 * MIN;
    return a;
}
test('localized full names share identity, including the screenshot cast', () => {
    const a = app();
    for (const [en, ru] of [['Marvin Branagh','Марвин Бранаг'],['Marvin Branagh','Марвин Брана'],['Claire Redfield','Клэр Редфилд'],['Michael Keller','Майкл Келлер'],['Leon Kennedy','Леон Кеннеди']]) {
        assert.equal(a.api.personKey(en), a.api.personKey(ru));
    }
    assert.notEqual(a.api.personKey('Claire Redfield'), a.api.personKey('Claire Smith'));
    assert.notEqual(a.api.personKey('田中'), a.api.personKey('山田'));
});
test('saved English and Russian cast has one avatar per person, without changing post text', () => {
    const a = app();
    a.s.lorePeople = [
        {name:'Marvin Branagh',role:'student',bio:'Police'}, {name:'Марвин Бранаг',role:'student',species:'человек'},
        {name:'Claire Redfield',role:'student'}, {name:'Клэр Редфилд',role:'student'},
        {name:'Michael Keller',role:'student'}, {name:'Майкл Келлер',role:'student'},
    ];
    a.s.feed = a.s.lorePeople.map((p,i)=>({id:'p'+i,author:p.name,text:'Original '+i,t:BASE,comments:[]}));
    a.s.feed[0].comments.push({author:'Claire',replyTo:'Marvin',text:'@Marvin Great!',t:BASE});
    a.s.social.following = ['Marvin Branagh','Марвин Бранаг'];
    a.s.stories = [{cast:['Claire','Клэр Редфилд']}];
    a.api.S();
    assert.equal(a.s.lorePeople.length,3);
    assert.deepEqual(Array.from(a.s.feed,p=>p.text), ['Original 0','Original 1','Original 2','Original 3','Original 4','Original 5']);
    assert.equal(a.s.feed[0].author,'Марвин Бранаг');
    assert.equal(a.s.feed[0].comments[0].author,'Клэр Редфилд');
    assert.equal(a.s.feed[0].comments[0].replyTo,'Марвин Бранаг');
    assert.equal(a.s.feed[0].comments[0].text,'@Marvin Great!');
    assert.equal(a.s.social.following.length,1); assert.equal(a.s.stories[0].cast.length,1);
    const html = a.api.feedTab(a.s);
    assert.equal((html.match(/class="sh-story"/g)||[]).length,3);
    assert.equal(a.s.lorePeople[0].bio,'Police'); assert.equal(a.s.lorePeople[0].species,'человек');
});
test('short names resolve only when the full name is unambiguous and keep the surname', () => {
    const a = app(); a.s.lorePeople=[{name:'Claire Redfield'},{name:'Claire Smith'}];
    a.s.feed=[{author:'Клэр',comments:[]}]; a.api.S();
    assert.equal(a.api.personName(a.s,'Claire'),'Клэр'); assert.equal(a.api.lorePerson(a.s,'Claire'),null);
    assert.equal(a.s.lorePeople.length,2); assert.equal(a.api.samePerson(a.s,'Claire Redfield','Claire Smith'),false);
    const b=app(); b.s.lorePeople=[{name:'Claire Redfield'}]; b.s.feed=[{author:'Клэр',comments:[]}]; b.api.S();
    assert.equal(b.s.feed[0].author,'Claire Redfield');
    assert.equal(b.api.personName(b.s,'Клэр'),'Claire Redfield');
    b.s.profile.name='Claire'; b.api.S(); assert.equal(b.api.personName(b.s,'Claire'),'Claire');
});
test('localized duplicate private chats merge histories and references, preserving other chat kinds', () => {
    const a=app();
    const en={id:'en',kind:'dm',name:'Marvin Branagh',msgs:[{id:'m1',text:'Hello',t:1},{id:'m2',text:'Again',t:3}],t:3,unread:2,bio:'police',pendingReply:{at:500,initiate:'hi'}};
    const ru={id:'ru',kind:'dm',name:'Марвин Бранаг',msgs:[{id:'m1',text:'Hello',t:1},{id:'m2',text:'Different',t:4},{text:'Again',t:5}],t:5,unread:1,pendingReply:{at:600,userKey:'old'},sceneContact:{state:'apart'},relSyncKey:'stale'};
    const group={id:'g',kind:'group',name:'Marvin Branagh',msgs:[]}, official={id:'o',kind:'official',name:'Marvin Branagh',msgs:[]};
    a.s.threads.push(en,ru,group,official); a.s.meetings=[{with:en.name,threadId:'en'}]; a.s.notes=[{go:{view:'thread',param:'en'}}]; a.s.strikes=[{letter:'en'}];
    a.api.ui.view='thread'; a.api.ui.param='en'; a.api.S();
    assert.equal(a.s.threads.includes(en),false); assert.equal(a.s.threads.includes(group),true); assert.equal(a.s.threads.includes(official),true);
    assert.deepEqual(Array.from(ru.msgs,m=>m.text),['Hello','Again','Different','Again']);
    assert.equal(ru.unread,3); assert.equal(ru.bio,'police'); assert.equal(ru.pendingReply.at,600);
    assert.equal(ru.sceneContact,undefined); assert.equal(ru.relSyncKey,undefined);
    assert.equal(a.s.meetings[0].threadId,'ru'); assert.equal(a.s.notes[0].go.param,'ru'); assert.equal(a.s.strikes[0].letter,'ru'); assert.equal(a.api.ui.param,'ru');
    assert.equal(a.api.openThread(a.s,'Marvin Branagh'),ru);
    assert.equal(a.api.openThread(a.s,'Marvin Branagh','','','group'),group);
});
test('active duplicate chats wait until generation ends before merging', () => {
    for(const flag of ['typing','relSyncing']) {
        const a=app(), en={id:'en',kind:'dm',name:'Claire Redfield',msgs:[],[flag]:true}, ru={id:'ru',kind:'dm',name:'Клэр Редфилд',msgs:[]};
        a.s.threads.push(en,ru); a.api.S(); assert.equal(a.s.threads.length,3);
        en[flag]=false; a.api.S(); assert.equal(a.s.threads.length,2);
    }
});
test('language variants share online state and preserve current physical proximity proof', () => {
    const a=app(), key=a.api.storySyncKey();
    a.s.lorePeople=[{name:'Claire Redfield'},{name:'Клэр Редфилд'}];
    a.s.messenger={presence:{
        'p:claire redfield':{online:false,until:a.wall()+MIN,nearby:true,nearbySourceKey:key},
        'p:клэр редфилд':{online:true,until:a.wall()+MIN,sourceKey:key,nearby:false}
    }};
    a.api.S();
    const p=a.api.presenceFor(a.s,'Claire Redfield');
    assert.equal(p,a.api.presenceFor(a.s,'Клэр Редфилд')); assert.equal(p.nearby,true); assert.equal(p.nearbySourceKey,key);
    assert.equal(Object.keys(a.s.messenger.presence).length,1);
});
test('dating, meetings and subscriptions reuse the same localized person', () => {
    const a=app(); a.s.dating.profiles=[{name:'Claire Redfield'},{name:'Клэр Редфилд'}];
    a.s.dating.matches=[{name:'Claire Redfield'},{name:'Клэр Редфилд'}];
    a.s.meetings=[{with:'Claire Redfield'}]; a.s.pendingDMs=[{from:'Claire'}]; a.s.jealousy=[{with:'Claire Redfield'}]; a.api.S();
    assert.equal(a.s.dating.profiles.length,1); assert.equal(a.s.dating.matches.length,1);
    assert.equal(a.s.meetings[0].with,'Клэр Редфилд'); assert.equal(a.s.pendingDMs[0].from,'Клэр Редфилд'); assert.equal(a.s.jealousy[0].with,'Клэр Редфилд');
    a.api.ACT.follow({name:'Claire Redfield'},null,a.s); assert.equal(a.s.social.following.length,1);
    a.api.ACT.follow({name:'Клэр Редфилд'},null,a.s); assert.equal(a.s.social.following.length,0);
});
test('stored aliases survive reloads, remain idempotent and do not leak to another chat', () => {
    const a=app(); a.s.lorePeople=[{name:'Marvin Branagh'},{name:'Марвин Бранаг'}]; a.api.S();
    const first=JSON.stringify(a.s); a.api.S(); assert.equal(JSON.stringify(a.s),first);
    a.context.chatMetadata.unihub=JSON.parse(first); const restored=a.api.S();
    assert.equal(a.api.personName(restored,'Marvin Branagh'),'Марвин Бранаг');
    a.context.chatMetadata={}; a.context.chatId='other'; const other=a.api.S();
    assert.equal(a.api.personName(other,'Marvin Branagh'),'Marvin Branagh');
});
test('localized NPC followups are deduplicated and names in the main card do not make them char', () => {
    const a=app(); a.context.characters[0].description='Алекс дружит с Claire Redfield и Marvin Branagh';
    a.s.lorePeople=[{name:'Claire Redfield'},{name:'Клэр Редфилд'}]; a.api.S();
    a.api.scheduleDM(a.s,{from:'Claire Redfield',is_char:true},'','first');
    a.api.scheduleDM(a.s,{from:'Клэр Редфилд'},'','second');
    assert.equal(a.s.pendingDMs.length,1); assert.equal(a.s.pendingDMs[0].from,'Клэр Редфилд'); assert.equal(a.s.pendingDMs[0].isChar,false);
    assert.equal(a.api.looksLikeChar('Claire Redfield'),false); assert.equal(a.api.looksLikeChar('Алекс'),true);
});
test('new generated replies reuse canonical authors and saved bilingual mentions render once', async () => {
    const a=app(); a.s.lorePeople=[{name:'Claire Redfield'},{name:'Клэр Редфилд'}]; a.api.S();
    a.answer(()=>[{author:'Claire Redfield',replyTo:'Claire',text:'@Claire Redfield Привет!'}]);
    const list=await a.api.aiComments(a.s,{author:'Клэр Редфилд',text:'Hi',comments:[]},'Reply');
    assert.equal(list[0].author,'Клэр Редфилд'); assert.equal(list[0].replyTo,'Клэр Редфилд');
    const c={id:'c',author:'Алекс',replyTo:'Клэр Редфилд',text:'@Claire Redfield Привет!',t:BASE};
    const html=a.api.commentHTML(c,{id:'p'}); assert.equal((html.match(/@/g)||[]).length,1); assert.match(html,/Привет!/); assert.equal(c.text,'@Claire Redfield Привет!');
});
function writeDM(a, text = 'Привет!') {
    a.elements['sh-msg'] = { value: text };
    return a.api.ACT.send({ id: a.th.id }, null, a.s);
}
test('closed messenger delivers online reply once with unread notification and unchanged story clock', async () => {
    const a = messengerApp(); assert.equal(a.api.ui.open, false); const t = a.s.clock.t;
    writeDM(a); a.api.tickMessenger(); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.th.msgs.filter(m => !m.me && !m.sys).length, 1); assert.equal(a.th.unread, 1);
    assert.equal(a.calls.length, 1); assert.equal(a.th.pendingReply, undefined); assert.equal(a.s.clock.t, t); assert.equal(a.th.typing, false);
});
test('online contact can delay reply for a few minutes without showing false typing', async () => {
    const a = messengerApp(0.8), job = writeDM(a);
    assert.ok(job.at > a.wall()); assert.ok(job.at <= a.wall() + 3 * MIN); assert.equal(a.th.typing, undefined);
    await a.api.drainQueue(); assert.equal(a.calls.length, 0);
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1);
});
test('offline person briefly checks messenger and answers after several minutes', async () => {
    const a = messengerApp(), p = a.api.presenceFor(a.s, a.th.name); p.online = false; p.until = a.wall() + 10 * MIN;
    const job = writeDM(a); assert.equal(job.checkIn, true); assert.equal(a.calls.length, 0);
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.calls.length, 1); assert.equal(p.online, true); assert.equal(a.th.unread, 1);
});
test('busy contact waits for freedom according to the scene', async () => {
    const a = messengerApp(); a.api.applyPresence(a.s, a.th, { busy: true, minutes: 30, reason: 'на работе' });
    const job = writeDM(a); assert.equal(job.waitForFree, true);
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 0);
    a.api.applyPresence(a.s, a.th, { busy: false, nearby: false });
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1);
});
test('busy contact can check in briefly without pretending the job is over', async () => {
    const a = messengerApp(0.8); a.api.applyPresence(a.s, a.th, { busy: true, minutes: 60, reason: 'на работе' });
    const job = writeDM(a); assert.equal(job.waitForFree, false); assert.equal(job.checkIn, true);
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.calls.length, 1); assert.match(a.calls[0], /ненадолго заглянул/);
    assert.equal(a.api.presenceFor(a.s, a.th.name).busy, true);
    a.setWall(a.wall() + 3 * MIN); a.api.tickMessenger(); assert.equal(a.api.presenceFor(a.s, a.th.name).online, false);
});
test('sleeping contact remains offline until story time or scene says they woke up', async () => {
    const a = messengerApp(0.8); a.api.applyPresence(a.s, a.th, { busy: true, sleeping: true, minutes: 60 });
    const job = writeDM(a); a.setWall(job.at + 30 * MIN); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 0);
    assert.equal(a.api.presenceFor(a.s, a.th.name).online, false);
    a.s.clock.t += 60 * MIN; a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1);
});
test('multiple messages while waiting produce one reply using all latest text', async () => {
    const a = messengerApp(0.8); const first = writeDM(a, 'Привет!'), second = writeDM(a, 'Ещё один вопрос');
    assert.equal(second.at, first.at); a.setWall(second.at); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.calls.length, 1); assert.match(a.calls[0], /Привет!/); assert.match(a.calls[0], /Ещё один вопрос/);
    assert.equal(a.th.msgs.filter(m => !m.me && !m.sys).length, 1);
});
test('saved delayed reply survives a reload including a stale typing flag', async () => {
    const a = messengerApp(0.8), job = writeDM(a); a.th.typing = true;
    const saved = JSON.parse(JSON.stringify(a.s));
    const b = messengerApp(); b.context.chatMetadata.unihub = saved; b.setWall(job.at);
    const s = b.api.S(), th = s.threads.find(t => t.id === 'char'); b.api.tickMessenger(s); await b.api.drainQueue();
    assert.equal(b.calls.length, 1); assert.equal(th.pendingReply, undefined); assert.equal(th.typing, false); assert.equal(th.msgs.length, 2);
});
test('in-flight background reply is discarded when the current scene changes and retries fresh', async () => {
    const a = messengerApp(), d = defer(); a.answer(() => d.promise); writeDM(a);
    const running = a.api.drainQueue(); for (let i = 0; i < 20 && !a.calls.length; i++) await Promise.resolve();
    assert.equal(a.calls.length, 1); a.add('Персонаж ушёл на работу.'); d.resolve({ reply: 'Устаревший ответ' }); await running;
    assert.equal(a.th.msgs.length, 1); assert.ok(a.th.pendingReply); assert.equal(a.th.typing, false);
    a.answer(() => ({ reply: 'Свежий ответ' })); a.setWall(a.th.pendingReply.at); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.th.msgs[1].text, 'Свежий ответ');
});
test('queued background reply cannot arrive in another chat and resumes on returning', async () => {
    const a = messengerApp(); writeDM(a); const metadata = a.context.chatMetadata;
    a.context.chatMetadata = {}; a.context.chatId = 'b'; const b = a.api.S(); b.auth = true;
    await a.api.drainQueue(); assert.equal(a.calls.length, 0); assert.equal(b.threads.length, 0);
    a.context.chatMetadata = metadata; a.context.chatId = 'a'; a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.calls.length, 1); assert.equal(a.th.msgs.length, 2);
});
test('main story generation defers the messenger without dropping the scheduled reply', async () => {
    const a = messengerApp(); a.api.setGenerating(true); writeDM(a); await a.api.drainQueue(); assert.equal(a.calls.length, 0);
    a.api.setGenerating(false); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1);
});
test('acquaintance writes first with phone closed and never repeats an unanswered initiative', async () => {
    const a = messengerApp(); a.api.cfg().proactiveDMs = true; a.add('Я ответила на вступление.', true);
    a.th.known = true; a.th.relSyncKey = 'synced'; const ms = a.api.messengerState(a.s); ms.nextInitiativeAt = a.wall();
    a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1); assert.equal(a.th.msgs[0].me, false); assert.equal(a.th.msgs[0].initiative, true);
    assert.equal(a.th.unread, 1); a.th.unread = 0; a.setWall(a.wall() + 40 * MIN); a.add('Новая сцена'); ms.nextInitiativeAt = a.wall();
    a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1);
});
test('disabled initiatives, empty openings, busy and co-present people produce no spontaneous messages', async () => {
    for (const state of ['disabled', 'opening', 'busy', 'nearby']) {
        const a = messengerApp(); a.api.cfg().proactiveDMs = state !== 'disabled'; if (state !== 'opening') a.add('Я ответила.', true);
        a.th.known = true; a.th.relSyncKey = 'synced'; a.api.applyPresence(a.s, a.th, { busy: state === 'busy', nearby: state === 'nearby', minutes: 60 });
        a.api.messengerState(a.s).nextInitiativeAt = a.wall(); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 0, state);
    }
});
test('initiative can be declined without fabricated message, romance or meeting', async () => {
    const a = messengerApp(); a.api.cfg().proactiveDMs = true; a.add('Ответ.', true); a.th.known = true; a.th.relSyncKey = 'synced';
    a.answer(() => ({ reply: '', delta: 6, flirt: true, meet: { date: '2026-10-03', time: '19:00' } }));
    a.api.messengerState(a.s).nextInitiativeAt = a.wall(); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.th.msgs.length, 0); assert.equal(a.th.rel, 0); assert.equal(a.th.pendingMeet, undefined); assert.equal(a.th.pendingReply, undefined);
});
test('availability inferred with relationships is applied and stale conclusions are rejected', async () => {
    const a = messengerApp(); a.answer(() => ({ known: true, rel: 20, presence: { busy: true, sleeping: false, nearby: false, minutes: 40, reason: 'за рулём' } }));
    await a.api.syncRel(a.s, a.th); const p = a.api.presenceFor(a.s, a.th.name); assert.equal(p.busy, true); assert.equal(p.online, false); assert.equal(p.reason, 'за рулём');
    const d = defer(); a.answer(() => d.promise); const run = a.api.syncRel(a.s, a.th); await Promise.resolve(); a.add('Изменённая сцена');
    d.resolve({ rel: 70, presence: { busy: false } }); await run; assert.equal(p.busy, true);
});
test('status dots match availability and group chats have no invented personal status', () => {
    const a = messengerApp(); assert.match(a.api.presenceDot(a.s, a.th.name), /sh-presence online/);
    a.api.applyPresence(a.s, a.th, { busy: true, reason: 'учится', minutes: 30 });
    assert.match(a.api.presenceDot(a.s, a.th.name), /sh-presence offline/); assert.match(a.api.presenceDot(a.s, a.th.name), /учится/);
    assert.equal(a.api.presenceDot(a.s, 'Группа', 'group'), ''); assert.match(a.api.chatsTab(a.s), /sh-presence offline/);
    assert.match(a.api.threadView(a.s, a.th.id), /sh-presence offline/);
});
test('turning off initiatives cancels a delayed first message', async () => {
    const a = messengerApp(0.8); a.api.cfg().proactiveDMs = true; a.add('Ответ.', true); a.th.known = true; a.th.relSyncKey = 'synced';
    a.api.messengerState(a.s).nextInitiativeAt = a.wall(); a.api.tickMessenger(); const job = a.th.pendingReply; assert.ok(job.proactive);
    a.api.cfg().proactiveDMs = false; a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 0); assert.equal(a.th.pendingReply, undefined);
});
test('changing scene can allow a fresh initiative after a read ordinary reply', async () => {
    const a = messengerApp(); writeDM(a); await a.api.drainQueue(); a.th.unread = 0;
    a.api.cfg().proactiveDMs = true; a.th.known = true; a.th.relSyncKey = 'synced'; a.add('Ответ на вступление.', true); a.setWall(a.wall() + 30 * MIN); a.add('Позже персонаж вернулся домой.');
    const p = a.api.presenceFor(a.s, a.th.name); p.online = true; p.until = a.wall() + 8 * MIN;
    a.api.messengerState(a.s).nextInitiativeAt = a.wall(); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.calls.length, 2); assert.equal(a.th.msgs[2].initiative, true);
});
test('matching and a real comment create familiar contacts for spontaneous messages', () => {
    const a = messengerApp(); a.api.cfg().proactiveDMs = true; a.add('Ответ.', true);
    a.s.dating.matches.push({ name: 'Маша', bio: 'Дружба', species: '' });
    a.s.feed.push({ id: 'bike', author: 'Клэр', text: 'Мотопробег', comments: [{ mine: true, text: 'Я!' }] });
    a.api.tickMessenger(); assert.ok(a.s.threads.some(t => t.name === 'Маша' && t.known));
    assert.ok(a.s.threads.find(t => t.name === 'Клэр').contactContext.includes('Я!'));
    a.api.tickMessenger(); assert.equal(a.s.threads.filter(t => t.name === 'Клэр').length, 1);
});
function leonDate(kind = 'char') {
    const a = messengerApp(); a.context.name2 = 'Леон Кеннеди'; a.th.name = 'Леон Кеннеди'; a.th.kind = kind;
    a.context.chat = [{ name: 'Леон Кеннеди', mes: 'Леон сидел напротив Ариши за столиком. Их свидание продолжалось, он держал её за руку.' }, { name: 'Ариша', is_user: true, mes: 'Я улыбнулась ему.' }];
    a.s.profile.name = 'Ариша'; a.th.unread = 0; a.th.known = true; a.th.relSyncKey = 'synced';
    const p = a.api.presenceFor(a.s, a.th.name); p.online = true; p.until = a.wall() + 8 * MIN;
    a.sceneAnswer(() => ({ state: 'together', evidence: 'он держал её за руку' }));
    return a;
}
test('English duplicate cannot bypass Leon shared-scene protection after merging', async () => {
    const a=leonDate(); const duplicate={id:'en',kind:'dm',name:'Leon Kennedy',msgs:[],t:a.wall()+1}; a.s.threads.push(duplicate); a.api.S();
    assert.equal(a.s.threads.length,1); assert.equal(a.api.openThread(a.s,'Leon Kennedy'),a.th);
    a.api.startDM(a.s,{from:'Leon Kennedy',context:'comment',intent:'Ask about Thursday'});
    await a.api.drainQueue(); assert.equal(a.calls.length,0); assert.equal(a.th.msgs.length,0);
});
test('Leon cannot initiate a Thursday invitation during their date, despite missing presence metadata', async () => {
    const a = leonDate(); a.api.cfg().proactiveDMs = true; a.api.messengerState(a.s).nextInitiativeAt = a.wall();
    a.answer(() => ({ reply: 'Будешь свободна в четверг?' }));
    a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(a.sceneCalls.length, 1); assert.match(a.sceneCalls[0], /Я улыбнулась ему/); assert.match(a.sceneCalls[0], /Их свидание продолжалось/);
    assert.equal(a.calls.length, 0); assert.equal(a.th.msgs.length, 0); assert.equal(a.th.pendingReply, undefined); assert.equal(a.th.unread, 0);
});
test('NPC comment follow-up and quest hook cannot bypass a shared scene', async () => {
    for (const source of ['comment', 'hook']) {
        const a = leonDate('dm');
        if (source === 'comment') a.api.startDM(a.s, { from: a.th.name, context: 'Обсуждали мотоциклы', intent: 'Написать первым' });
        else { const q = a.api.makeQuest({ k: 'post', title: 'Разговор', desc: 'Опубликуй пост', trigger: 'post', hook: { type: 'dm', from: a.th.name, intent: 'Пригласить' } }, a.s); a.api.fireHook(a.s, q, 'Пост'); }
        await a.api.drainQueue(); await a.api.drainQueue(); assert.equal(a.calls.length, 0, source); assert.equal(a.th.msgs.length, 0); assert.equal(a.th.pendingReply, undefined);
    }
});
test('a pending invitation scheduled before the date is canceled when it becomes due', async () => {
    const a = messengerApp(0.8); a.add('Алекс ждёт в другом месте.');
    const job = a.api.queueMessengerReply(a.s, a.th, { initiate: 'Пригласи в четверг' });
    a.add('Алекс теперь сидит со Студентом за одним столом.'); a.sceneAnswer(() => ({ state: 'together', evidence: 'сидит со Студентом за одним столом' }));
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 0); assert.equal(a.th.pendingReply, undefined);
});
test('a direct user message receives no private reply while the interlocutor is beside them', async () => {
    const a = leonDate(); const job = writeDM(a, 'Привет, Леон'); await a.api.drainQueue();
    assert.equal(a.calls.length, 0); assert.equal(job.sceneWait, 'together'); assert.equal(a.th.msgs.length, 1);
    assert.match(a.api.threadView(a.s, a.th.id), /Собеседник рядом/);
    a.add('Леон ушёл домой, Ариша осталась в кафе.'); a.sceneAnswer(() => ({ state: 'apart', evidence: 'Леон ушёл домой' }));
    a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1); assert.equal(a.th.msgs.length, 2);
});
test('missing, ambiguous and invented scene evidence fails closed with a bounded retry', async () => {
    for (const result of [{}, { state: 'unknown' }, { state: 'apart' }, { state: 'apart', evidence: 'Леон ушёл домой' }]) {
        const a = leonDate(); a.sceneAnswer(() => result); const job = writeDM(a); await a.api.drainQueue();
        assert.equal(a.calls.length, 0); assert.equal(job.sceneWait, 'unknown');
        a.setWall(job.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.sceneCalls.length, 1);
    }
});
test('a delayed scene analysis cannot certify a different or rerolled scene', async () => {
    const a = messengerApp(), d = defer(); a.sceneAnswer(() => d.promise); writeDM(a); const run = a.api.drainQueue();
    for (let i = 0; i < 20 && !a.sceneCalls.length; i++) await Promise.resolve();
    a.context.chat[0].mes = 'Алекс рядом со Студентом.'; d.resolve({ state: 'apart', evidence: 'Привет!' }); await run;
    assert.equal(a.calls.length, 0); assert.equal(a.th.sceneContact, undefined);
    a.sceneAnswer(() => ({ state: 'together', evidence: 'Алекс рядом со Студентом' })); a.setWall(a.th.pendingReply.at); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 0);
});
test('reply finishing after shared-scene evidence arrives is not appended and creates no relationship effects', async () => {
    const a = messengerApp(), d = defer(); a.answer(() => d.promise); writeDM(a); const run = a.api.drainQueue();
    for (let i = 0; i < 30 && !a.calls.length; i++) await Promise.resolve(); assert.equal(a.calls.length, 1);
    a.api.applyPresence(a.s, a.th, { busy: false, nearby: true }); d.resolve({ reply: 'Будешь свободна в четверг?', delta: 6, flirt: true }); await run;
    assert.equal(a.th.msgs.length, 1); assert.equal(a.th.rel, 0); assert.equal(a.th.unread, undefined); assert.ok(a.th.pendingReply);
});
test('missing nearby field cannot erase a confirmed shared scene', async () => {
    const a = messengerApp(); a.api.applyPresence(a.s, a.th, { busy: false, nearby: true }); a.api.applyPresence(a.s, a.th, { busy: false });
    assert.equal(a.api.sceneContactState(a.s, a.th), 'together'); writeDM(a); await a.api.drainQueue(); assert.equal(a.calls.length, 0); assert.equal(a.sceneCalls.length, 0);
});
test('positive presence expires with scene edits, not with a real-time countdown', async () => {
    const a = leonDate(); assert.equal(await a.api.checkSceneContact(a.s, a.th), 'together'); a.setWall(a.wall() + 10 * 60 * MIN);
    assert.equal(a.api.sceneContactState(a.s, a.th), 'together'); a.add('Леон ушёл домой.');
    assert.equal(a.api.sceneContactState(a.s, a.th), 'unknown'); a.sceneAnswer(() => ({ state: 'apart', evidence: 'Леон ушёл домой' }));
    assert.equal(await a.api.checkSceneContact(a.s, a.th), 'apart');
});
test('jealousy messages use the same queue and are suppressed when the character is physically present', async () => {
    const a = leonDate(); a.s.profile.relWithChar = true;
    a.api.startMeeting(a.s, { with: 'Клэр', threadId: 'other', kind: 'date', place: 'cafe', at: a.s.clock.t });
    await a.api.drainQueue(); assert.equal(a.calls.length, 0); assert.equal(a.th.msgs.length, 0);
});
function meetingForm(a) {
    for (const [id, value] of Object.entries({ 'sh-m-kind': 'date', 'sh-m-place': 'cafe', 'sh-m-note': '', 'sh-m-time': '18:00', 'sh-m-day': '1' })) a.elements[id] = { value };
}
test('invitation response cannot bypass the shared-scene guard or grant a meeting', async () => {
    const a = leonDate(); meetingForm(a); await a.api.ACT.proposeMeet({ id: a.th.id }, null, a.s);
    assert.equal(a.calls.length, 0); assert.equal(a.s.meetings.length, 0); assert.equal(a.th.msgs.length, 0);
});
test('an invitation finishing after arrival cannot append a reply or change relationships', async () => {
    const a = messengerApp(), d = defer(); meetingForm(a); a.answer(() => d.promise);
    const run = a.api.ACT.proposeMeet({ id: a.th.id }, null, a.s);
    for (let i = 0; i < 30 && !a.calls.length; i++) await Promise.resolve(); assert.equal(a.calls.length, 1);
    a.api.applyPresence(a.s, a.th, { busy: false, nearby: true }); d.resolve({ accept: true, reply: 'Давай в четверг' }); await run; await a.api.drainQueue();
    assert.equal(a.th.msgs.length, 1); assert.equal(a.s.meetings.length, 0); assert.equal(a.th.rel, 0); assert.equal(a.th.pendingReply.sceneWait, 'together');
});

function memoryStorage() {
    const data = new Map();
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}
async function started(a) { for (let i = 0; i < 60 && !a.calls.length; i++) await Promise.resolve(); assert.equal(a.calls.length, 1); }
test('switching chat before debounce preserves old state without saving it into the new chat', async () => {
    const storage = memoryStorage(), a = app({ storage }), saved = [];
    a.context.saveMetadata = () => saved.push(a.context.chatId);
    a.s.wallet.balance = 1234; a.api.save(a.s);
    const timer = [...a.timers.values()].find(t => t.ms === 400);
    a.context.chatId = 'b'; a.context.chatMetadata = {}; const b = a.api.S(); await timer.fn();
    assert.deepEqual(saved, []); assert.notEqual(b.wallet.balance, 1234);
    a.context.chatId = 'a'; a.context.chatMetadata = {}; const restored = a.api.S();
    assert.equal(restored.wallet.balance, 1234); a.api.onChatChanged();
    await [...a.timers.values()].filter(t => t.ms === 400).at(-1).fn();
    assert.deepEqual(saved, ['a']); assert.equal(storage.data.size, 1);
});
test('pending save survives a page reload and account storage takes priority', () => {
    const storage = memoryStorage(), local = memoryStorage(), a = app({ storage: local }); a.context.accountStorage = storage;
    a.s.wallet.balance = 777; a.api.save(a.s); assert.equal(local.data.size, 0);
    const b = app({ storage }); assert.equal(b.s.wallet.balance, 777);
});
test('reset removes pending backup instead of resurrecting previous data', () => {
    const storage = memoryStorage(), a = app({ storage }); a.s.wallet.balance = 777; a.api.save(a.s);
    a.api.ACT.resetChat(); const s = a.api.S(); assert.notEqual(s.wallet.balance, 777); assert.equal(s.auth, false);
    const b = app({ storage }); assert.notEqual(b.s.wallet.balance, 777);
});
test('save failure keeps durable backup available for retry', async () => {
    const storage = memoryStorage(), a = app({ storage }); a.context.saveMetadata = async () => { throw new Error('network'); };
    a.s.wallet.balance = 321; a.api.save(a.s); await [...a.timers.values()].find(t => t.ms === 400).fn();
    assert.equal(storage.data.size, 1); assert.equal(app({ storage }).s.wallet.balance, 321);
});
test('late tutor result neither changes discarded data nor clears a new operation', async () => {
    const a = app(), old = defer(), current = defer(); a.elements['sh-tutor'] = { value: 'История' }; a.answer(() => old.promise);
    const first = a.api.ACT.tutor({}, null, a.s); await started(a);
    a.context.chatId = 'b'; a.context.chatMetadata = {}; a.api.onChatChanged(); const b = a.api.S(); b.auth = true;
    a.answer(() => current.promise); const second = a.api.ACT.groups({}, null, b);
    old.resolve({ name: 'Запоздалый репетитор' }); await first;
    assert.equal(a.s.threads.length, 1); assert.equal(b.threads.length, 0); assert.equal(a.api.ui.view, null); assert.ok(a.api.ui.busy);
    current.resolve([]); await second; assert.equal(a.api.ui.busy, '');
});
test('old hung queue and generation counter do not block a new chat', async () => {
    const a = app(), d = defer(); a.answer(() => d.promise); a.api.enqueue(a.s, () => a.api.aiRaw('old')); await started(a);
    a.context.chatId = 'b'; a.context.chatMetadata = {}; const b = a.api.S(); b.auth = true;
    let ran = false; a.answer(() => 'new'); a.api.enqueue(b, async () => { ran = await a.api.aiRaw('new'); });
    await a.api.drainQueue(); assert.equal(ran, '"new"'); d.resolve('old');
});
test('hung AI request times out and releases its queue for subsequent work', async () => {
    const a = app(), d = defer(); let ran = false; a.answer(() => d.promise);
    a.api.enqueue(a.s, () => a.api.aiRaw('hung')); await started(a);
    a.api.enqueue(a.s, () => { ran = true; }); [...a.timers.values()].find(t => t.ms === 180000).fn();
    await a.api.drainQueue(); assert.equal(ran, true); d.resolve('late');
});
test('late homework formulation does not mutate a discarded chat', async () => {
    const a = app(), d = defer(), t = { id: 't', title: 'Original', subject: 'История', desc: '' };
    a.s.tasks.push(t); a.answer(() => d.promise); a.api.genTaskDesc(a.s, t); await started(a);
    a.context.chatId = 'b'; a.context.chatMetadata = {}; a.api.S(); d.resolve({ title: 'Late', desc: 'Late' });
    await a.api.drainQueue(); assert.equal(t.title, 'Original'); assert.equal(t.desc, '');
});
test('initial clock synchronization aligns enrollment, quarter and stipend to story date', async () => {
    const a = app(); a.setWall(new Date(2026, 9, 3, 9).getTime()); a.s.auth = false; a.s.world = 'mundane';
    a.s.clock = { mode: 'game', t: a.wall(), source: 'старт' }; a.s.wallet.lastStipend = a.wall();
    a.context.chat = [{ name: 'Алекс', mes: 'Время: 5 января 2026 10:00', send_date: 'first' }];
    for (const [id, value] of Object.entries({ 'sh-a-name': 'Студент', 'sh-a-gender': 'f', 'sh-a-year': '1', 'sh-a-fac': 'История' })) a.elements[id] = { value };
    a.answer(() => []); await a.api.ACT.login({}, null, a.s); await a.api.drainQueue(); await a.flush();
    assert.equal(a.s.clock.t, BASE); assert.equal(a.s.enforceFrom, BASE); assert.equal(a.s.quarter.start, BASE); assert.equal(a.s.wallet.lastStipend, BASE);
});
test('legacy unsynchronized academic dates are repaired but manual or active histories are preserved', () => {
    for (const preserve of ['', 'manual', 'grades']) {
        const a = app(); a.s.clock.storyInitialized = true; a.s.enforceFrom = BASE + 100 * 1440 * MIN; a.s.quarter.start = a.s.enforceFrom; a.s.wallet.lastStipend = a.s.enforceFrom;
        if (preserve === 'manual') a.s.clock.source = 'вручную'; if (preserve === 'grades') a.s.grades.push({ grade: 5 });
        a.api.S(); assert.equal(a.s.enforceFrom === BASE, !preserve);
    }
});
test('future meeting plans do not advance fallback story time', () => {
    const a = app();
    for (const text of ['Увидимся через три часа.', 'Я вернусь через час.', 'Если через два часа наступит вечер, поедем.']) assert.equal(a.api.guessedStoryClock(text, BASE) - BASE, a.api.cfg().stepMin * MIN);
    assert.equal(a.api.guessedStoryClock('Спустя час он закончил работу.', BASE) - BASE, 60 * MIN);
});
test('fallback time does not count a previous assistant jump twice', async () => {
    const a = app(); a.api.cfg().syncAI = false; a.s.clock.storyInitialized = true;
    a.add('Я слушаю.', true); a.add('Спустя час он закончил работу.'); a.api.scheduleStorySync(true); await a.flush(); const first = a.s.clock.t;
    assert.equal(first - BASE, 60 * MIN); a.add('Он убрал инструменты.'); a.api.scheduleStorySync(true); await a.flush();
    assert.equal(a.s.clock.t - first, a.api.cfg().stepMin * MIN);
});
test('lore includes all enabled connected books and preserves the extraction tail', async () => {
    const a = app(), loaded = []; a.context.characters[0].avatar = 'Alex.png';
    a.context.characters[0].data = { extensions: { world: 'Primary' }, character_book: { entries: [{ keys: ['Катя'], content: 'EMBEDDED' }, { enabled: false, content: 'DISABLED-EMBEDDED' }] } };
    a.context.chatMetadata.world_info = 'Chat'; a.context.powerUserSettings = { persona_description_lorebook: 'Persona' };
    a.api.setWorldInfo({ selected_world_info: ['Global', 'Primary'], world_info: { charLore: [{ name: 'Alex', extraBooks: ['Extra'] }] } });
    a.context.loadWorldInfo = async name => { loaded.push(name); return { entries: { disabled: { disable: true, content: 'DISABLED' }, active: { key: ['Катя'], content: name + ' '.repeat(5100) + 'IMPORTANT-TAIL' } } }; };
    const text = await a.api.loreText(null); assert.deepEqual(loaded.sort(), ['Chat', 'Extra', 'Global', 'Persona', 'Primary']);
    assert.ok(text.includes('IMPORTANT-TAIL')); assert.ok(text.includes('EMBEDDED')); assert.ok(!text.includes('DISABLED'));
    const voice = await a.api.loreFor('Катя', null); assert.ok(voice.includes('Extra')); assert.ok(voice.includes('IMPORTANT-TAIL'));
});
test('explicit bilingual aliases with different phonetic keys unify feed and threads after reload', async () => {
    const a = app(); a.answer(() => [{ name: 'Эшли Грэм', aliases: ['Ashley Graham'], role: 'student', bio: 'Студентка' }]); await a.api.extractLorePeople(a.s);
    a.s.feed = [{ author: 'Ashley Graham', comments: [] }]; a.s.threads.push({ id: 'en', kind: 'dm', name: 'Ashley Graham', msgs: [] }, { id: 'ru', kind: 'dm', name: 'Эшли Грэм', msgs: [] });
    a.api.S(); assert.equal(a.api.samePerson(a.s, 'Ashley Graham', 'Эшли Грэм'), true); assert.equal(a.s.feed[0].author, 'Эшли Грэм'); assert.equal(a.s.threads.length, 2);
    a.context.chatMetadata.unihub = JSON.parse(JSON.stringify(a.s)); const restored = a.api.S(); assert.equal(a.api.personName(restored, 'Ashley Graham'), 'Эшли Грэм');
});
test('an ambiguous alias cannot merge different people', () => {
    const a = app(); a.s.lorePeople = [{ name: 'Ashley Graham', aliases: ['Общее имя'] }, { name: 'Другой человек', aliases: ['Общее имя'] }]; a.s.feed.push({ author: 'Общее имя', comments: [] });
    a.api.S(); assert.equal(a.api.samePerson(a.s, 'Ashley Graham', 'Другой человек'), false); assert.equal(a.s.feed[0].author, 'Общее имя');
});
test('a quoted breakup of other people cannot end the user relationship', async () => {
    for (const source of ['story', 'dm', 'card']) {
        const a = app(), text = 'Катя и Петя расстались.'; a.s.profile.relWithChar = true; a.th.pair = true;
        if (source === 'story') a.add(text + ' Мы с Алексом по-прежнему вместе.');
        if (source === 'dm') a.th.msgs.push({ text, me: false }); if (source === 'card') a.context.characters[0].description = text;
        a.answer(() => ({ known: true, pair: false, pair_evidence: { source, text } })); await a.api.syncRel(a.s, a.th);
        assert.equal(a.th.pair, true, source); assert.equal(a.s.profile.relWithChar, true, source);
    }
});
test('third-party reported first-person breakup cannot clear an existing couple', async () => {
    const a = app(); a.th.pair = true; a.add('Катя сказала: «Мы расстались.»');
    a.answer(() => ({ pair: false, pair_evidence: { source: 'story', text: 'Мы расстались.' } })); await a.api.syncRel(a.s, a.th); assert.equal(a.th.pair, true);
});
test('failed or malformed grading preserves answer and allows a genuine later grade', async () => {
    const a = app(), t = { id: 't', title: 'Работа', subject: 'История', desc: 'Задание', deadline: BASE + MIN };
    a.s.tasks.push(t); a.elements['sh-ans'] = { value: 'Ответ студента, который должен проверить преподаватель.' };
    for (const result of [null, {}, { grade: 4.5 }, { grade: '' }, { grade: 7 }]) {
        a.answer(() => result); await a.api.ACT.submit({ id: 't' }, null, a.s); assert.ok(!t.done); assert.equal(a.s.grades.length, 0); assert.equal(t.answer, a.elements['sh-ans'].value);
    }
    assert.ok(a.api.taskView(a.s, 't').includes(t.answer)); a.answer(() => ({ grade: 5, comment: 'Верно' })); await a.api.ACT.submit({ id: 't' }, null, a.s);
    assert.equal(t.done, true); assert.equal(t.grade, 5); assert.equal(a.s.grades.length, 1);
});
test('failed dean decision does not consume an excuse attempt', async () => {
    const a = app(); a.s.schedule = [{ id: 'cl', day: 0, start: '10:00', end: '11:30', subject: 'История' }];
    const key = a.api.occurrences(a.s, BASE, BASE + 1440 * MIN)[0].key; a.elements['sh-excuse'] = { value: 'Я заболела, у меня высокая температура.' };
    a.answer(() => null); await a.api.ACT.excuse({ key }, null, a.s); assert.equal(a.s.excuses[key], undefined);
    a.answer(() => ({ valid: true, reply: 'Принято.' })); await a.api.ACT.excuse({ key }, null, a.s); assert.equal(a.s.attendance[key], 'excused');
});
test('repeated like and follow toggles count each target only once per quest', () => {
    const a = app(); a.s.feed.push({ id: 'p', author: 'Катя', likes: 0, comments: [] });
    const like = a.api.makeQuest({ k: 'like', n: 3, title: 'Лайки' }, a.s), follow = a.api.makeQuest({ k: 'follow', n: 3, title: 'Подписки' }, a.s); a.s.social.quests = [like, follow];
    for (let i = 0; i < 5; i++) { a.api.ACT.like({ id: 'p' }, null, a.s); a.api.ACT.follow({ name: 'Катя' }, null, a.s); }
    assert.equal(like.p, 1); assert.equal(follow.p, 1); assert.ok(!like.done && !follow.done);
    a.s.feed.push({ id: 'p2', comments: [] }, { id: 'p3', comments: [] });
    a.api.questEvent(a.s, 'like', 1, '', '', { postId: 'p2' }); a.api.questEvent(a.s, 'like', 1, '', '', { postId: 'p3' }); assert.equal(like.done, true);
});
test('grocery waits for story delivery while parcels retain their separate timer', () => {
    const a = app(); a.s.enforceFrom = a.s.quarter.start = BASE; a.s.orders = [
        { id: 'g', kind: 'grocery', title: 'Молоко', eta: BASE, stage: 'cooking', dueReply: 2 }, { id: 'p', kind: 'parcel', title: 'Книга', to: 'Катя', eta: BASE },
    ]; a.api.realTick(); assert.equal(a.s.orders[0].notified, undefined); assert.equal(a.s.orders[0].stage, 'cooking'); assert.equal(a.s.orders[1].notified, true);
    a.s.orders[0].injected = true; a.api.onStoryReply(a.add('Курьер приехал.')); assert.equal(a.s.orders[0].stage, 'delivered');
});
test('generated schedules reject invalid times, reversed intervals and overlaps', async () => {
    const a = app(); a.answer(() => [
        { day: 0, start: '25:00', end: '26:30', subject: 'Invalid' }, { day: 0, start: '11:30', end: '10:30', subject: 'Reverse' },
        { day: 0, start: '08:00', end: '09:30', subject: 'Too early' }, { day: 6, start: '10:00', end: '11:30', subject: 'Sunday' },
        { day: 0, start: '10:00', end: '11:30', subject: 'Valid' }, { day: 0, start: '11:00', end: '12:30', subject: 'Overlap' },
        ...[1, 2, 3].map(day => ({ day, start: '10:00', end: '11:30', subject: 'Valid' })),
    ]); const list = await a.api.genSchedule(a.s, 'История'); assert.equal(list.length, 4); assert.ok(list.every(c => c.subject === 'Valid'));
    a.answer(() => Array.from({ length: 4 }, () => ({ day: 0, start: '25:00', end: '26:30', subject: 'Invalid' })));
    const fallback = await a.api.genSchedule(a.s, 'История'); assert.ok(fallback.length >= 4); assert.ok(fallback.every(c => c.start !== '25:00'));
});
test('ordinary HTML formatting preserves message text while service and reasoning blocks disappear', () => {
    const a = app(); const result = a.api.cleanReply('<think>Reason</think><div>Привет.<br>Буду ждать.</div><horae>SECRET</horae><script>bad()</script>');
    assert.equal(result, 'Привет.\nБуду ждать.'); assert.equal(a.api.cleanReply('<details><summary>Заголовок</summary>Текст</details>'), 'Заголовок\nТекст');
});
test('invalid numeric settings cannot produce NaN rating and injection depth zero is preserved', () => {
    const a = app(); const limit = a.api.cfg().maxStrikes;
    for (const value of ['0', '-1', 'Infinity', 'abc', '']) { const target = { dataset: { change: 'cfg', k: 'maxStrikes' }, value }; a.api.onChange({ target }); assert.equal(a.api.cfg().maxStrikes, limit); }
    a.context.extensionSettings.unihub.maxStrikes = 0; assert.ok(Number.isFinite(a.api.rating(a.s)));
    assert.equal(a.api.validSetting('quarterDays', 0), null); assert.equal(a.api.validSetting('lowGpa', 5.1), null); assert.equal(a.api.validSetting('injectDepth', 0), 0);
});
test('generated fractional prices cannot become free and invalid amounts cannot corrupt balance', async () => {
    const a = app(); a.answer(() => [{ title: 'Кофе', price: 0.4 }, { title: 'Invalid', price: 'Infinity' }, { title: 'Negative', price: -4 }]);
    await a.api.ACT.genMenu({}, null, a.s); assert.equal(a.s.menu.length, 1); assert.equal(a.s.menu[0].price, 1);
    const before = a.s.wallet.balance; a.api.ACT.order({ id: a.s.menu[0].id }, null, a.s); assert.equal(a.s.wallet.balance, before - 1);
    for (const n of [NaN, Infinity, -1, 0]) assert.equal(a.api.pay(a.s, n, 'Invalid'), false);
    assert.equal(a.api.tx(a.s, Infinity, 'Invalid'), false); assert.equal(a.s.wallet.balance, before - 1);
    assert.equal(a.api.placeFoodOrder(a.s, [{ item: { price: 20 }, qty: Infinity }]), false);
});
test('an invitation waits through sleep and then uses NPC biography and speech', async () => {
    const a = messengerApp(), th = { id: 'npc', name: 'Катя', kind: 'dm', bio: 'UNIQUE-NPC-BIO', msgs: [], rel: 50 };
    a.s.threads.push(th); a.s.lorePeople = [{ name: 'Катя', role: 'student', speech: 'UNIQUE-NPC-SPEECH' }];
    a.api.applyPresence(a.s, th, { busy: true, sleeping: true, reason: 'спит', minutes: 480 }); meetingForm(a);
    a.answer(prompt => { assert.ok(prompt.includes('UNIQUE-NPC-SPEECH')); assert.ok(prompt.includes('UNIQUE-NPC-BIO')); assert.ok(prompt.includes('Ответ на приглашение')); return { reply: 'Хорошо, встретимся.', accept: true, delta: 1 }; });
    await a.api.ACT.proposeMeet({ id: th.id }, null, a.s); await a.api.drainQueue();
    assert.equal(th.msgs.length, 1); assert.equal(a.calls.length, 0); assert.ok(th.pendingReply.waitForFree); assert.equal(a.s.meetings.length, 0);
    a.api.applyPresence(a.s, th, { busy: false, sleeping: false }); a.setWall(th.pendingReply.at + MIN); a.api.tickMessenger(); await a.api.drainQueue();
    assert.equal(th.msgs.filter(m => !m.me && !m.sys).length, 1); assert.equal(a.s.meetings.length, 1);
});
test('busy invitation can check in briefly but uses the shared availability prompt', async () => {
    const a = messengerApp(0.8); meetingForm(a); a.api.applyPresence(a.s, a.th, { busy: true, reason: 'работает', minutes: 60 });
    a.answer(prompt => { assert.ok(prompt.includes('ненадолго заглянул в мессенджер')); return { reply: 'Отвечу после работы.', accept: false, delta: 0 }; });
    await a.api.ACT.proposeMeet({ id: a.th.id }, null, a.s); assert.equal(a.calls.length, 0); const at = a.th.pendingReply.at;
    a.setWall(at + MIN); a.api.tickMessenger(); await a.api.drainQueue(); assert.equal(a.calls.length, 1); assert.equal(a.api.presenceFor(a.s, a.th.name).busy, true); assert.equal(a.s.meetings.length, 0);
});
test('invitation timestamps are shifted to story time once even when device date differs', async () => {
    const a = messengerApp(); a.setWall(new Date(2026, 9, 3, 15).getTime()); meetingForm(a);
    a.answer(() => ({ reply: 'Хорошо.', accept: true, delta: 1 })); await a.api.ACT.proposeMeet({ id: a.th.id }, null, a.s); await a.api.drainQueue();
    assert.equal(a.th.msgs.filter(m => !m.me && !m.sys).length, 1);
    for (const m of a.th.msgs) { assert.equal(m.t, a.wall()); assert.equal(m.gt, BASE); }
});
test('a delayed invitation cannot create a meeting in the past', async () => {
    const a = messengerApp(), d = defer(); meetingForm(a); a.answer(() => d.promise);
    await a.api.ACT.proposeMeet({ id: a.th.id }, null, a.s); await started(a);
    a.s.clock.t += 3 * 1440 * MIN; d.resolve({ reply: 'Давай.', accept: true }); await a.api.drainQueue(); assert.equal(a.s.meetings.length, 0);
});
test('invalid invitation time is rejected before sending any message', async () => {
    const a = messengerApp(); meetingForm(a); a.elements['sh-m-time'].value = '25:00'; await a.api.ACT.proposeMeet({ id: a.th.id }, null, a.s);
    assert.equal(a.th.msgs.length, 0); assert.equal(a.s.meetings.length, 0); assert.equal(a.calls.length, 0);
});
test('checkbox, custom ability selector and caret survive a background form render', () => {
    const a = app(); a.s.profile.abilities = 'Собственная сила'; a.s.profile.abilityVisible = false;
    let cb, sel, text; const custom = { id: 'sh-pf-abil-o', style: {} };
    function inputs() {
        cb = { id: 'sh-pf-abil-v', type: 'checkbox', value: 'on', checked: false };
        sel = { id: 'sh-pf-abil', value: '', dataset: { change: 'idSel', other: custom.id } };
        text = { id: 'sh-pf-abil-c', type: 'text', value: '', selectionStart: 0, selectionEnd: 0, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }, focus() {} };
        for (const el of [cb, sel, text, custom]) a.elements[el.id] = el; custom.style.display = 'none';
    }
    inputs(); const scr = { querySelectorAll: selector => selector.includes('data-change') ? [sel] : [cb, sel, text], contains: el => [cb, sel, text, custom].includes(el), scrollTop: 12, scrollHeight: 100 };
    Object.defineProperty(scr, 'innerHTML', { set() { inputs(); } }); a.elements['unihub-phone'] = { querySelector: selector => selector === '.sh-screen' ? scr : { innerHTML: '' } };
    a.api.ui.open = true; a.api.ui.view = 'profile'; a.api.realRender(); cb.checked = true; sel.value = '__other'; text.value = 'Своя способность'; text.selectionStart = text.selectionEnd = 4;
    a.api.realRender(); assert.equal(cb.checked, true); assert.equal(sel.value, '__other'); assert.equal(custom.style.display, ''); assert.equal(text.value, 'Своя способность'); assert.equal(text.selectionStart, 4);
});
test('silent native save failure still leaves the newest local revision recoverable', async () => {
    const storage = memoryStorage(), a = app({ storage }); a.context.saveMetadata = async () => undefined;
    a.s.wallet.balance = 789; a.api.save(a.s); await [...a.timers.values()].find(t => t.ms === 400).fn(); assert.equal(app({ storage }).s.wallet.balance, 789);
    const b = app({ storage }); b.context.chatMetadata.unihub = { ...b.s, wallet: { ...b.s.wallet, balance: 900 }, saveRevision: b.s.saveRevision + 1 };
    assert.equal(b.api.S().wallet.balance, 900);
});
test('legacy invalid timetable does not roll attendance into the next day', () => {
    const a = app(); a.s.schedule = [{ id: 'cl', day: 0, start: '25:00', end: '26:30', subject: 'История' }];
    assert.equal(a.api.occurrences(a.s, BASE, BASE + 3 * 1440 * MIN).length, 0);
});
test('zero injection depth reaches SillyTavern as zero', () => {
    const a = app(); let depth; a.api.cfg().injectDepth = 0; a.context.setExtensionPrompt = (name, text, position, value) => { if (name === 'unihub') depth = value; };
    a.api.updateInjection(); assert.equal(depth, 0);
});
test('all extension screens render with populated state after the fixes', () => {
    const a = app(); a.s.world = 'mundane';
    a.s.feed.push({ id: 'p', author: 'Катя', text: 'Пост', comments: [{ id: 'c', author: 'Катя', text: 'Комментарий', t: a.wall() }] });
    a.s.tasks.push({ id: 't', title: 'ДЗ', subject: 'История', desc: 'Опишите события', issued: BASE, deadline: BASE + MIN });
    const cases = [...['feed', 'chats', 'dating', 'study', 'more'].map(tab => ({ tab, view: null })),
        ...['post', 'person', 'me', 'thread', 'meet', 'task', 'excuse', 'meetings', 'clock', 'delivery', 'market', 'wallet', 'campus', 'profile', 'settings', 'log'].map(view => ({ view, param: ({ post: 'p', person: 'Катя', thread: 'char', meet: 'char', task: 't' })[view] || null }))];
    for (const state of cases) { Object.assign(a.api.ui, state); assert.equal(typeof a.api.screenHTML(), 'string'); }
    for (const studyTab of ['schedule', 'tasks', 'grades', 'rating', 'help']) { Object.assign(a.api.ui, { tab: 'study', view: null, studyTab }); assert.equal(typeof a.api.screenHTML(), 'string'); }
});

test('legacy mixed badges use one author profile across feed, post and profile views', () => {
    const a = app(); a.s.feed = [
        { id: 'one', author: 'Leon Kennedy', verified: true, text: 'One', comments: [] },
        { id: 'two', author: 'Леон Кеннеди', verified: false, text: 'Two', comments: [] },
    ]; a.api.S();
    assert.equal(a.s.peopleVerification.length, 1);
    for (const p of a.s.feed) { assert.equal(p.verified, true); assert.match(a.api.postHTML(p, a.s), /sh-verified/); assert.match(a.api.postHTML(p, a.s, true), /sh-verified/); }
    assert.equal((a.api.personView(a.s, 'Leon Kennedy').match(/sh-verified/g) || []).length, 3);
});
test('new model output cannot change established author verification', async () => {
    for (const verified of [true, false]) {
        const a = app(); a.s.feed = [{ id: 'old', author: 'Катя', verified, text: 'Old', comments: [] }]; a.api.S();
        a.answer(() => ({ posts: [{ author: 'Катя', verified: !verified, text: 'New' }] }));
        await a.api.ACT.genFeed({}, null, a.s);
        assert.equal(a.s.feed.length, 2); assert.ok(a.s.feed.every(p => p.verified === verified));
        for (const p of a.s.feed) assert.equal(a.api.postHTML(p, a.s).includes('sh-verified'), verified);
    }
});
test('author verification survives reload and removal of old feed posts', async () => {
    const a = app(); a.s.feed = [{ author: 'Катя', verified: false, text: 'Old', comments: [] }]; a.api.S();
    a.s.feed = []; a.context.chatMetadata.unihub = JSON.parse(JSON.stringify(a.s)); const s = a.api.S();
    s.feed.push({ author: 'Катя', verified: true, text: 'New', comments: [] }); a.api.S(); assert.equal(s.feed[0].verified, false);
    a.context.chatId = 'other'; a.context.chatMetadata = {}; const other = a.api.S(); other.feed.push({ author: 'Катя', verified: true, comments: [] }); a.api.S();
    assert.equal(other.feed[0].verified, true);
});
test('different students retain distinct verification and own posts still follow user level', () => {
    const a = app(); a.s.feed = [
        { author: 'Claire Redfield', verified: false, text: 'One', comments: [] },
        { author: 'Claire Smith', verified: true, text: 'Two', comments: [] },
        { author: a.s.profile.name, mine: true, verified: true, text: 'Mine', comments: [] },
    ]; a.api.S();
    assert.equal(a.s.peopleVerification.length, 2); assert.equal(a.s.feed[0].verified, false); assert.equal(a.s.feed[1].verified, true);
    assert.doesNotMatch(a.api.postHTML(a.s.feed[2], a.s), /sh-verified/);
});
