import { table, integer, real, text, boolean, json, sql, unique } from "sdk/db";
// کاربران تلگرام که با ربات تعامل داشتن
export const users = table("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tgId: integer("tg_id").unique().notNull(),
  name: text("name"),
  username: text("username"),
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// شخصیت‌های D&D 2024
export const characters = table("characters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerTgId: integer("owner_tg_id").notNull(),
  name: text("name"),
  species: text("species"),
  charClass: text("class"),
  background: text("background"),
  level: integer("level").default(1),
  xp: integer("xp").default(0), // XP کسب‌شدهٔ این شخصیت؛ هر نفر نوار جدا دارد
  abilities: json("abilities"), // { STR, DEX, CON, INT, WIS, CHA }
  hp: integer("hp"),
  maxHp: integer("max_hp"),
  ac: integer("ac"),
  deathSaveSuccesses: integer("death_save_successes").default(0),
  deathSaveFailures: integer("death_save_failures").default(0),
  stable: integer("stable").default(0),
  dead: integer("dead").default(0),
  hitDiceSpent: integer("hit_dice_spent").default(0),
  proficiencyBonus: integer("proficiency_bonus").default(2),
  skillProficiencies: json("skill_proficiencies"), // ["Athletics", "Stealth", ...]
  spellsKnown: json("spells_known"), // ["Fireball", "Mage Hand", ...] — فقط برای کلاس‌های جادویی
  feat: text("feat"),
  equipment: json("equipment"), // آرایه‌ی ساده؛ در فاز بعد به جدول items منتقل میشه
  toolTags: json("tool_tags"), // فهرست بسته‌ی ابزار: ["thieves_tools", "rope", ...]؛ null = بدون ابزار
  gold: integer("gold").default(0),
  status: text("status").default("draft"), // draft | ready
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// state مکالمه‌ی شخصیت‌سازی در چت خصوصی (هر کاربر فقط یک ساخت فعال هم‌زمان)
export const charCreationSessions = table("char_creation_sessions", {
  tgId: integer("tg_id").primaryKey(),
  draftCharacterId: integer("draft_character_id").notNull(),
  originChatId: integer("origin_chat_id"), // گروهی که بازیکن ازش دعوت شده (برای وصل‌شدن دوباره بعد از ساخت)
  step: text("step").default("name"), // name|species|class|background|bg_bonus|abilities|skills|review
  tempData: json("temp_data").default({}),
  updated: integer("updated_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// وضعیت کلی بازی برای هر گروه (چون فعلاً تک‌گروهی هستیم، فقط یک ردیف فعال داریم؛
// ساختار طوریه که بعداً چندگروهی‌شدن فقط نیاز به فیلتر بیشتر داره)
export const gameSessions = table("game_sessions", {
  chatId: integer("chat_id").primaryKey(),
  status: text("status").default("idle"), // idle | waiting_ready | in_narrative | in_combat
  expectedPlayers: integer("expected_players"),
  pendingSuggestions: json("pending_suggestions"), // [{text}, {text}, {text}] — برای دکمه‌های پیشنهاد ادامه‌ی داستان
  lobbyMessageId: integer("lobby_message_id"),
  pausedFrom: text("paused_from"),
  currentRound: integer("current_round").default(1),
  roundMessageId: integer("round_message_id"),
  sceneMessageId: integer("scene_message_id"),
  currentLocationId: integer("current_location_id"),
  resolvingSince: integer("resolving_since"), // ثانیهٔ یونیکسِ گرفتن قفل resolving؛ برای تشخیص قفل گیرکرده
  updated: integer("updated_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// اعلام آمادگی هر بازیکن در هر گروه، و شخصیتی که برای این بازی انتخاب کرده
export const partyMembers = table(
  "party_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    tgId: integer("tg_id").notNull(),
    characterId: integer("character_id"),
    promptMessageId: integer("prompt_message_id"),
    isReady: boolean("is_ready").default(false),
  },
  (t) => ({
    uqMember: unique("uq_party_chat_user").on(t.chatId, t.tgId),
  }),
);

// دنیای ساخته‌شده‌ی هر گروه — بعد از قفل‌شدن (locked=true) دیگه AI حق تغییرش رو نداره
export const worldLore = table("world_lore", {
  chatId: integer("chat_id").primaryKey(),
  loreText: text("lore_text"), // خلاصه‌ی تاریخچه/فراکسیون‌ها/مکان‌ها
  locked: boolean("locked").default(false),
  updated: integer("updated_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// ساعت بازی — فقط با اکشن کدمحور (سفر/استراحت) آپدیت میشه، نه با حدس AI
export const worldClock = table("world_clock", {
  chatId: integer("chat_id").primaryKey(),
  currentDay: integer("current_day").default(1),
  timeOfDay: text("time_of_day").default("morning"), // morning|afternoon|evening|night
  elapsedHours: real("elapsed_hours"), // ساعت‌های گذشته از ۰۰:۰۰ روز ۱ (اعشاری)؛ روز و بازه از این حساب میشن
  lastLongRestHours: real("last_long_rest_hours"), // ساعتِ شروع آخرین استراحت طولانی (قانون ۲۴ ساعت)
});

export const npcs = table("npcs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  name: text("name"),
  level: integer("level").default(1),
  socialStatus: text("social_status"),
  role: text("role"),
  publicFacts: text("public_facts"), // چیزی که همه‌ی دنیا می‌دونن
});

// حافظه‌ی خصوصی هر NPC نسبت به هر شخصیت — این جدول تضمین می‌کنه اطلاعات درز نکنه
export const npcCharacterMemory = table(
  "npc_character_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    npcId: integer("npc_id").notNull(),
    characterId: integer("character_id").notNull(),
    knownAlias: text("known_alias"), // اسمی که این NPC از این کاراکتر می‌دونه
    history: text("history"), // معاملات/رفتارها/رابطه
  },
  (t) => ({
    uqPair: unique("uq_npc_character").on(t.npcId, t.characterId),
  }),
);

// ثبت این‌که یک NPC یک واقعیت خاص رو *چطور* فهمیده — بدون این رکورد، NPC حق دونستنش رو نداره
export const npcKnowledgeLog = table("npc_knowledge_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  npcId: integer("npc_id").notNull(),
  characterId: integer("character_id"),
  fact: text("fact"),
  learnedFrom: text("learned_from"), // event | character | witnessed
  gameTimestamp: text("game_timestamp"),
});

export const quests = table("quests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  type: text("type"), // main | side
  title: text("title"),
  fullPlot: text("full_plot"),
  status: text("status").default("hidden"), // hidden | active | completed
  finalizedAt: integer("finalized_at", { mode: "timestamp" }),
});

export const antagonists = table("antagonists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  name: text("name"),
  motive: text("motive"),
  escalationPlan: text("escalation_plan"),
  linkedQuestId: integer("linked_quest_id"),
});

// پرامپت‌های سیستم AI — قابل ویرایش بدون دیپلوی مجدد
export const prompts = table("prompts", {
  key: text("key").primaryKey(), // narrator | worldbuilder | npc_voice
  content: text("content"),
  updated: integer("updated_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// تاریخچه‌ی خام صحنه‌ها، از آخرین checkpoint (long rest) به بعد
export const sessionLog = table("session_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  role: text("role"), // player | narrator
  speakerTgId: integer("speaker_tg_id"),
  content: text("content"),
  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// پاسخ هر بازیکن در هر «دور» (صحنه). تا جواب همه نیاد، صحنه‌ی بعد ساخته نمی‌شه.
export const sceneActions = table(
  "scene_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    round: integer("round").notNull(),
    tgId: integer("tg_id").notNull(),
    kind: text("kind").notNull(), // suggestion | skip | free
    content: text("content"),
    messageId: integer("message_id"), // پیام تلگرام این اقدام (برای تشخیص ویرایش معتبر)؛ برای دکمه null
    updated: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => ({
    uqAction: unique("uq_action_round_user").on(t.chatId, t.round, t.tgId),
  }),
);

// مکان‌های دنیا؛ AI اسم و تم رو می‌نویسه ولی سطح و قواعد از فهرست‌های بسته میان
export const locations = table("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  name: text("name").notNull(),
  tier: integer("tier").notNull().default(1), // سطح خطر ۱ تا ۴
  theme: text("theme"),
  rules: json("rules"), // برچسب‌ها مثل ["darkness"] از فهرست بسته‌ی RULE_TAGS
  hostility: text("hostility").notNull().default("none"), // none | low | moderate | high (DM-Only)
  environments: json("environments"), // حداکثر ۴ مقدار از فهرست بسته‌ی ENVIRONMENTS
  population: json("population"), // Population Snapshot؛ null = مکان قدیمی بدون تخمین
  residue: json("residue"), // حداکثر ۳ خط ته‌مانده‌ی NPCهای حذف‌شده
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// فاصله‌ی دو مکان به ساعت؛ برای هر جفت فقط یک ردیف (locationAId < locationBId)
export const locationLinks = table(
  "location_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    locationAId: integer("location_a_id").notNull(),
    locationBId: integer("location_b_id").notNull(),
    distanceHours: integer("distance_hours").notNull(),
  },
  (t) => ({
    uqLink: unique("uq_location_pair").on(
      t.chatId,
      t.locationAId,
      t.locationBId,
    ),
  }),
);

// NPCهایی که در تقابل رودررو ساخته می‌شن؛ فعلاً فقط برای ثبت و بررسیه، هنوز دوباره‌استفاده نمی‌شه
export const creatures = table("creatures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  locationId: integer("location_id"),
  role: text("role"),
  tier: integer("tier").default(1),
  abilities: json("abilities"),
  proficiencyBonus: integer("proficiency_bonus").default(2),
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});
// ردگیری دورها (Observability): یک ردیف در هر دور؛ تلاش‌های دوباره‌ی همان دور داخل attempts می‌رن
// هر attempt: { traceId, startedAt, endedAt, outcome, spans: [...] }؛ فقط ۵۰ دور آخر نگه داشته میشه
export const traceRing = table(
  "trace_ring",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    round: integer("round").notNull(),
    outcome: text("outcome"), // نتیجه‌ی آخرین تلاش: ok | error | lock_lost | combat | ...
    attempts: json("attempts"),
    updated: integer("updated_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => ({
    uqTraceRing: unique("uq_trace_ring").on(t.chatId, t.round),
  }),
);
export const errorLogs = table("error_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source"), // ai | telegram
  errorMessage: text("error_message"),
  context: text("context"),
  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// نگهداری کلید API ها (تا وقتی راه امن‌تری در BotFather پیدا کنیم)
export const settings = table("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// وضعیت نبرد فعال هر گروه
export const combatState = table("combat_state", {
  chatId: integer("chat_id").primaryKey(),
  round: integer("round").default(1),
  turnOrder: json("turn_order"), // [{type:'player'|'enemy', id, tgId?, name, initiative}]
  currentTurnIndex: integer("current_turn_index").default(0),
  enemies: json("enemies"), // [{id, name, hp, maxHp, ac, dexMod, actions}]
  turnMessageId: integer("turn_message_id"), // پیام نوبت فعلی (با دکمه‌ها)
  log: json("log"), // خلاصه‌ی رویدادهای مهم نبرد، برای روایت بعد از نبرد
});
// وب‌هوک‌های پردازش‌شده — برای رد کردن update_id تکراری (حلقوی، ۱۰۰۰ ردیف آخر)
export const processedUpdates = table("processed_updates", {
  updateId: integer("update_id").primaryKey(),
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// Plan هر دور: تاس‌ها، تصمیم Resolver و پیش‌نویس‌ها؛ بعد از COMMIT متن صحنه هم اینجا می‌مونه (برای ارسال دوباره)
export const eventPlans = table(
  "event_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    round: integer("round").notNull(),
    plan: json("plan"), // decision + تاس‌ها + پیش‌نویس مکان + حساب HP/ساعت
    actionsFingerprint: text("actions_fingerprint"), // اگه اقدام‌ها عوض شده باشن، Plan قدیمی کنار می‌ره
    status: text("status").notNull().default("planned"), // planned | committed
    narration: text("narration"),
    suggestions: json("suggestions"),
    sceneText: text("scene_text"), // متن کامل صحنه‌ی ارسال‌شونده (روایت + خط‌های تاس)
    sceneSent: integer("scene_sent").notNull().default(0), // ۱ = صحنه به گروه رسیده
    created: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => ({
    uqPlanRound: unique("uq_event_plan_round").on(t.chatId, t.round),
  }),
);

// Eventهای اعمال‌شده؛ کلید اصلی eventId جلوی اعمال دوبارهٔ هر Event را می‌گیره
export const appliedEvents = table("applied_events", {
  eventId: text("event_id").primaryKey(), // chatId:round:type:index
  chatId: integer("chat_id").notNull(),
  round: integer("round").notNull(),
  type: text("type").notNull(),
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// دفتر XP: هر XP کسب‌شده با منبع و دلیل (combat | skill_check | ...)؛ بازی‌ها پاکش نمی‌کنن
export const xpLog = table("xp_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id").notNull(),
  round: integer("round").notNull(),
  characterId: integer("character_id").notNull(),
  amount: integer("amount").notNull(),
  source: text("source").notNull(),
  reason: text("reason").notNull(),
  eventId: text("event_id").notNull(),
  created: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`,
  ),
});

// حافظه‌ی دور (Round Memory): یک ردیف خلاصه در هر دور، کدمحور و بدون AI؛ داخل همان COMMIT نوشته میشه
// هر عضو آرایه‌ها: { v: "group"|"private"|"hidden", t: "متن", owner?: tgId }؛ فقط ۱۰ دور آخر نگه داشته میشه
export const roundMemory = table(
  "round_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    round: integer("round").notNull(),
    worldHours: real("world_hours"), // ساعت دقیق جهان بعد از این دور (اعشاری؛ روز و بخش‌روز موقع خوندن حساب میشن)
    location: text("location"), // اسم مکانِ آخرِ این دور
    actions: json("actions"),
    outcomes: json("outcomes"),
    changes: json("changes"),
    knowledgeDelivered: json("knowledge_delivered"), // تا V12 (NPC) خالیه
    newEntities: json("new_entities"),
    created: integer("created_at", { mode: "timestamp" }).default(
      sql`(unixepoch())`,
    ),
  },
  (t) => ({
    uqRoundMemory: unique("uq_round_memory").on(t.chatId, t.round),
  }),
);
