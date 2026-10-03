import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Environment Variables ───────────────────────────────────────────
export const DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? '';
export const CLIENT_ID = process.env.CLIENT_ID ?? '';
export const GUILD_ID = process.env.GUILD_ID ?? '';
export const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID ?? '';

if (!DISCORD_TOKEN) {
  console.error('[ERROR] DISCORD_TOKEN is missing in .env');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('[ERROR] CLIENT_ID is missing in .env');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('[ERROR] GUILD_ID is missing in .env');
  process.exit(1);
}
if (!VOICE_CHANNEL_ID) {
  console.error('[ERROR] VOICE_CHANNEL_ID is missing in .env');
  process.exit(1);
}

// ─── Paths ───────────────────────────────────────────────────────────
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const MUSIC_DIR = path.join(PROJECT_ROOT, 'Music');
export const IMAGES_DIR = path.join(PROJECT_ROOT, 'Images');

// ─── Cooldowns ───────────────────────────────────────────────────────
export const FIRST_CHANGE_COOLDOWN = 5 * 60 * 1000;  // 5 دقائق
export const NEXT_CHANGE_COOLDOWN = 30 * 60 * 1000;  // 30 دقيقة

// ─── Status ──────────────────────────────────────────────────────────
export const STATUS_INTERVAL = 30 * 60 * 1000; // 30 دقيقة
export const WELCOME_DELETE_AFTER = 10 * 60 * 1000; // 10 دقائق
export const WELCOME_UPDATE_INTERVAL = 15 * 1000;   // 15 ثانية — تحديث حيّ

// ─── Panel ───────────────────────────────────────────────────────────
export const PANEL_UPDATE_INTERVAL = 15_000; // 15 ثانية
export const EMBED_COLOR = 0x595959;

// ─── Progress Bar Emojis ─────────────────────────────────────────────
export const BAR_LEFT_FILLED  = '<:white_bar_l:1555550982094463127>';
export const BAR_LEFT_EMPTY   = '<:black_bar_l:1555550983352877056>';
export const BAR_MID_FILLED   = '<:white_bar_mid:1555550979447857213>';
export const BAR_MID_EMPTY    = '<:black_bar_mid:1555550980924252291>';
export const BAR_RIGHT_FILLED = '<:white_bar_r:1555552147955785828>';
export const BAR_RIGHT_EMPTY  = '<:black_bar_r:1555552146517393508>';

// ─── Track Type ──────────────────────────────────────────────────────
export type Track = {
  id: string;
  name: string;
  audioPath: string;
  imagePath?: string;
  duration?: number;
};

// ─── Time Periods (hours, 24h local) ─────────────────────────────────
export const TIME_PERIODS = {
  MORNING: { start: 5, end: 11 },    // 05:00 → 10:59
  NEUTRAL: { start: 11, end: 17 },   // 11:00 → 16:59
  SUNSET:  { start: 17, end: 20 },   // 17:00 → 19:59
  NIGHT:   { start: 20, end: 5 },    // 20:00 → 04:59 (wraps midnight)
} as const;

// ─── Morning Statuses (20) — 🌅 Sun, Light, Fresh Start ─────────────
export const MORNING_STATUSES: string[] = [
  'Morning Breeze ∙ نسيم الصباح 🍃',
  'Sunrise Glow ∙ وهج الشروق 🌅',
  'Fresh Start ∙ بداية جديدة ✨',
  'Morning Coffee ∙ قهوة الصباح ☕',
  'Golden Sunrise ∙ شروق ذهبي 🌅',
  'First Light ∙ أول الضوء 🌤️',
  'Morning Calm ∙ صباح هادئ 🌿',
  'New Day Begins ∙ يبدأ يوم جديد ☀️',
  'Dawn Serenity ∙ سكينة الفجر 🌄',
  'Warm Sunrise ∙ شروق دافئ 🌅',
  'Birds & Coffee ∙ طيور وقهوة 🐦',
  'Bright Morning ∙ صباح مشرق ☀️',
  'Morning Light ∙ ضوء الصباح ✨',
  'Peaceful Dawn ∙ فجر وادع 🤍',
  'Soft Sunrise ∙ شروق ناعم 🌅',
  'Morning Jasmine ∙ ياسمين الصباح 🌸',
  'Tea & Sunrise ∙ شاي وشروق 🍵',
  'Gentle Morning ∙ صباح لطيف 🌤️',
  'Sunrise & Oud ∙ شروق وعود 🌿',
  'Daylight Begins ∙ يبدأ النهار ☀️',
];

// ─── Neutral Statuses (29) — ☀️ Calm, Rain, Damascus ────────────────
export const NEUTRAL_STATUSES: string[] = [
  'Soft Rain ∙ مطر هادئ 🌧️',
  'Rainy Mood ∙ أجواء ماطرة 🌧️',
  'Soft Glow ∙ وهج ناعم ✨',
  'Calm Moments ∙ لحظات هادئة 🌿',
  'Autumn Mood ∙ أجواء الخريف 🍂',
  'Cozy Rain ∙ مطر دافئ 🌧️',
  'Calm Atmosphere ∙ أجواء ساكنة 🌿',
  'Winter Calm ∙ سكينة الشتاء ❄️',
  'Gentle Rain ∙ مطر لطيف 🌧️',
  'Quiet Hours ∙ ساعات هادئة ⏳',
  'Peaceful Mood ∙ مزاج هادئ 🤍',
  'Slow Living ∙ حياة على مهل 🌿',
  'Quiet Mood ∙ مزاج هادئ 🤍',
  'Soft Atmosphere ∙ أجواء ناعمة ✨',
  'Rain & Warmth ∙ مطر ودفء 🌧️',
  'Serene Moments ∙ لحظات وادعة 🌿',
  'Damascus & Music ∙ الشام وموسيقى 🎶',
  'Old Damascus ∙ الشام القديمة 🕌',
  'Courtyard & Music ∙ فناء وموسيقى 🎶',
  'Quiet Damascus ∙ شام هادئة 🤍',
  'Old Courtyard ∙ فناء عتيق 🏡',
  'Quiet Courtyard ∙ فناء هادئ 🌿',
  'Syrian Courtyard ∙ فناء سوري 🏡',
  'Soft Oud ∙ عود هادئ 🎶',
  'Damascus Rain ∙ مطر الشام 🌧️',
  'Ancient Damascus ∙ دمشق العتيقة 🕌',
  'Music & Damascus ∙ موسيقى ودمشق 🎶',
  'Peaceful Sham ∙ سكينة الشام 🤍',
  'Damascus & Oud ∙ دمشق وعود 🎵',
];

// ─── Sunset Statuses (14) — 🌇 Dusk, Twilight, Golden ───────────────
export const SUNSET_STATUSES: string[] = [
  'Slow Evenings ∙ أمسيات على مهل 🌆',
  'Golden Evening ∙ مساء ذهبي 🌅',
  'Dreamy Evening ∙ مساء حالم ✨',
  'Evening Glow ∙ وهج المساء 🌆',
  'Cozy Sunset ∙ غروب دافئ 🌅',
  'Rainy Evening ∙ مساء ماطر 🌧️',
  'Warm Sunset ∙ غروب دافئ 🌅',
  'Cozy Twilight ∙ شفق دافئ 🌆',
  'Peaceful Evening ∙ مساء وادع 🤍',
  'Soft Twilight ∙ شفق ناعم 🌆',
  'Evening Serenity ∙ سكينة المساء 🤍',
  'Damascus Glow ∙ وهج الشام ✨',
  'Damascus Sunset ∙ غروب الشام 🌅',
  'Syrian Evening ∙ مساء سوري 🤍',
];

// ─── Night Statuses (37) — 🌙 Moon, Night, Relax ────────────────────
export const NIGHT_STATUSES: string[] = [
  'Cozy Nights ∙ ليالٍ دافئة 🤍',
  'Quiet Evenings ∙ أمسيات هادئة 🌙',
  'Warm Lights ∙ أضواء دافئة ✨',
  'Midnight Calm ∙ سكينة منتصف الليل 🌙',
  'Peaceful Nights ∙ ليالٍ هادئة 🤍',
  'Silent Evening ∙ مساء ساكن 🌙',
  'Warm Ambience ∙ أجواء دافئة 🕯️',
  'Night Breeze ∙ نسيم الليل 🍃',
  'Slow Nights ∙ ليالٍ هادئة 🌌',
  'Soft Nights ∙ ليالٍ ناعمة 🤍',
  'Late Evening ∙ آخر المساء 🌙',
  'Serene Nights ∙ ليالٍ وادعة 🌌',
  'Warm Night ∙ ليلة دافئة 🕯️',
  'Dreamy Nights ∙ ليالٍ حالمة ✨',
  'Soft Evening ∙ مساء ناعم 🌙',
  'Gentle Nights ∙ ليالٍ لطيفة 🌙',
  'Relaxing Moments ∙ لحظات استرخاء 🕯️',
  'Dreamy Calm ∙ سكينة حالمة 🌌',
  'Night Serenity ∙ سكينة الليل 🌙',
  'Calm & Cozy ∙ هدوء ودفء 🕯️',
  'Warm & Quiet ∙ دفء وهدوء 🕯️',
  'Endless Calm ∙ سكينة لا تنتهي 🌌',
  'Lanterns & Jasmine ∙ فوانيس وياسمين 🏮',
  'Moon & Jasmine ∙ قمر وياسمين 🌙',
  'Damascene Nights ∙ ليالي شامية 🌌',
  'Incense & Oud ∙ بخور وعود 🕯️',
  'Jasmine Nights ∙ ليالي الياسمين 🌸',
  'Lantern Light ∙ ضوء الفانوس 🏮',
  'Evening in Damascus ∙ مساء الشام 🌙',
  'Syrian Nights ∙ ليالٍ سورية 🌌',
  'Oud & Candle ∙ عود وشمعة 🕯️',
  'Moonlit Damascus ∙ الشام تحت القمر 🌙',
  'Damascus Lanterns ∙ فوانيس الشام 🏮',
  'Night in Sham ∙ ليل الشام 🌙',
  'Jasmine & Moon ∙ ياسمين وقمر 🌙',
  'Quiet Nights ∙ ليالٍ هادئة 🌌',
  'Candlelit Damascus ∙ شام على ضوء الشموع 🕯️',
];

// ─── Legacy export (all statuses combined) ───────────────────────────
export const STATUSES: string[] = [
  ...MORNING_STATUSES,
  ...NEUTRAL_STATUSES,
  ...SUNSET_STATUSES,
  ...NIGHT_STATUSES,
];