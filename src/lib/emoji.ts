/**
 * Emoji shortcodes, Discord/GitHub style. `:santa:` DISPLAYS as 🎅 — but the literal `:santa:` is
 * what gets sent to the game and what's stored, so clients that don't translate still see the code
 * and capable ones show the emoji (the same idea as Haven's @me tokens: raw on the wire, resolved
 * for the eye). expandEmoji() runs only at display time (OutputPane's renderSpan, which also feeds
 * the 👁 preview). Only KNOWN names convert — an unknown :word: is left exactly as typed, so game
 * text with colons (12:30, http://…, exits:) is never touched. The table also backs the picker grid.
 *
 * Pure (no DOM/Electron) so scripts/test-emoji.mjs can run it under Node.
 */

/** A picker-grid entry: the emoji, its primary :name:, then any extra aliases that also expand. */
export interface EmojiEntry {
  char: string;
  name: string;
  aliases: string[];
}

// [char, primary name, ...aliases]. Order is the picker's reading order (faces, hearts, hands,
// people, animals, nature, food, activity, travel, objects, symbols, seasonal).
const RAW: ReadonlyArray<readonly string[]> = [
  // ---- smileys & emotion ----
  ['😀', 'grinning'], ['😃', 'smiley'], ['😄', 'smile'], ['😁', 'grin'], ['😆', 'laughing', 'satisfied'],
  ['😅', 'sweat_smile'], ['🤣', 'rofl'], ['😂', 'joy'], ['🙂', 'slightly_smiling_face'], ['🙃', 'upside_down_face'],
  ['😉', 'wink'], ['😊', 'blush'], ['😇', 'innocent'], ['🥰', 'smiling_face_with_three_hearts'], ['😍', 'heart_eyes'],
  ['🤩', 'star_struck'], ['😘', 'kissing_heart'], ['😗', 'kissing'], ['😚', 'kissing_closed_eyes'], ['😋', 'yum'],
  ['😛', 'stuck_out_tongue'], ['😜', 'stuck_out_tongue_winking_eye'], ['🤪', 'zany_face'], ['😝', 'stuck_out_tongue_closed_eyes'],
  ['🤑', 'money_mouth_face'], ['🤗', 'hugs'], ['🤭', 'hand_over_mouth'], ['🤫', 'shushing_face'], ['🤔', 'thinking'],
  ['🤐', 'zipper_mouth_face'], ['🤨', 'raised_eyebrow'], ['😐', 'neutral_face'], ['😑', 'expressionless'], ['😶', 'no_mouth'],
  ['😏', 'smirk'], ['😒', 'unamused'], ['🙄', 'roll_eyes'], ['😬', 'grimacing'], ['🤥', 'lying_face'],
  ['😌', 'relieved'], ['😔', 'pensive'], ['😪', 'sleepy'], ['🤤', 'drooling_face'], ['😴', 'sleeping'],
  ['😷', 'mask'], ['🤒', 'face_with_thermometer'], ['🤕', 'face_with_head_bandage'], ['🤢', 'nauseated_face'], ['🤮', 'vomiting'],
  ['🤧', 'sneezing_face'], ['🥵', 'hot_face'], ['🥶', 'cold_face'], ['🥴', 'woozy_face'], ['😵', 'dizzy_face'],
  ['🤯', 'exploding_head'], ['🤠', 'cowboy_hat_face'], ['🥳', 'partying_face'], ['😎', 'sunglasses'], ['🤓', 'nerd_face'],
  ['🧐', 'monocle_face'], ['😕', 'confused'], ['😟', 'worried'], ['🙁', 'slightly_frowning_face'], ['☹️', 'frowning_face'],
  ['😮', 'open_mouth'], ['😯', 'hushed'], ['😲', 'astonished'], ['😳', 'flushed'], ['🥺', 'pleading_face'],
  ['😦', 'frowning'], ['😧', 'anguished'], ['😨', 'fearful'], ['😰', 'cold_sweat'], ['😥', 'disappointed_relieved'],
  ['😢', 'cry'], ['😭', 'sob'], ['😱', 'scream'], ['😖', 'confounded'], ['😣', 'persevere'],
  ['😞', 'disappointed'], ['😓', 'sweat'], ['😩', 'weary'], ['😫', 'tired_face'], ['🥱', 'yawning_face'],
  ['😤', 'triumph'], ['😡', 'rage', 'pout'], ['😠', 'angry'], ['🤬', 'cursing_face'], ['😈', 'smiling_imp'],
  ['👿', 'imp'], ['💀', 'skull'], ['☠️', 'skull_and_crossbones'], ['💩', 'poop', 'hankey', 'shit'], ['🤡', 'clown_face'],
  ['👹', 'japanese_ogre'], ['👺', 'japanese_goblin'], ['👻', 'ghost'], ['👽', 'alien'], ['🤖', 'robot'],
  ['😺', 'smiley_cat'], ['😸', 'smile_cat'], ['😻', 'heart_eyes_cat'], ['😹', 'joy_cat'], ['😽', 'kissing_cat'],
  // ---- hearts ----
  ['❤️', 'heart'], ['🧡', 'orange_heart'], ['💛', 'yellow_heart'], ['💚', 'green_heart'], ['💙', 'blue_heart'],
  ['💜', 'purple_heart'], ['🖤', 'black_heart'], ['🤍', 'white_heart'], ['🤎', 'brown_heart'], ['💔', 'broken_heart'],
  ['❣️', 'heavy_heart_exclamation'], ['💕', 'two_hearts'], ['💞', 'revolving_hearts'], ['💓', 'heartbeat'], ['💗', 'heartpulse'],
  ['💖', 'sparkling_heart'], ['💘', 'cupid'], ['💝', 'gift_heart'], ['💟', 'heart_decoration'], ['💌', 'love_letter'],
  // ---- hands & gestures ----
  ['👋', 'wave'], ['🤚', 'raised_back_of_hand'], ['✋', 'raised_hand'], ['🖖', 'vulcan_salute'], ['👌', 'ok_hand'],
  ['🤌', 'pinched_fingers'], ['🤏', 'pinching_hand'], ['✌️', 'v', 'peace'], ['🤞', 'crossed_fingers'], ['🤟', 'love_you_gesture'],
  ['🤘', 'metal'], ['🤙', 'call_me_hand'], ['👈', 'point_left'], ['👉', 'point_right'], ['👆', 'point_up_2'],
  ['🖕', 'middle_finger', 'fu'], ['👇', 'point_down'], ['☝️', 'point_up'], ['👍', '+1', 'thumbsup'], ['👎', '-1', 'thumbsdown'],
  ['✊', 'fist_raised', 'fist'], ['👊', 'facepunch', 'punch'], ['🤛', 'fist_left'], ['🤜', 'fist_right'], ['👏', 'clap'],
  ['🙌', 'raised_hands'], ['👐', 'open_hands'], ['🤲', 'palms_up_together'], ['🤝', 'handshake'], ['🙏', 'pray'],
  ['✍️', 'writing_hand'], ['💅', 'nail_care'], ['🤳', 'selfie'], ['💪', 'muscle'], ['👀', 'eyes'],
  ['👁️', 'eye'], ['🧠', 'brain'], ['👅', 'tongue'], ['👄', 'lips'], ['🦷', 'tooth'],
  // ---- people & gestures ----
  ['🙇', 'bow'], ['🤦', 'facepalm'], ['🤷', 'shrug'], ['🙅', 'no_good'], ['🙆', 'ok_person'],
  ['🙋', 'raising_hand'], ['🙎', 'person_pouting'], ['🙍', 'person_frowning'], ['💁', 'tipping_hand'], ['🕺', 'man_dancing'],
  ['💃', 'dancer'], ['👶', 'baby'], ['🧒', 'child'], ['👑', 'crown'], ['🎓', 'mortar_board'],
  // ---- animals & nature ----
  ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit'],
  ['🦊', 'fox_face'], ['🐻', 'bear'], ['🐼', 'panda_face'], ['🐨', 'koala'], ['🐯', 'tiger'],
  ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey_face'],
  ['🙈', 'see_no_evil'], ['🙉', 'hear_no_evil'], ['🙊', 'speak_no_evil'], ['🐔', 'chicken'], ['🐧', 'penguin'],
  ['🐦', 'bird'], ['🐤', 'baby_chick'], ['🦆', 'duck'], ['🦅', 'eagle'], ['🦉', 'owl'],
  ['🦇', 'bat'], ['🐺', 'wolf'], ['🐗', 'boar'], ['🐴', 'horse'], ['🦄', 'unicorn'],
  ['🐝', 'bee'], ['🐛', 'bug'], ['🦋', 'butterfly'], ['🐌', 'snail'], ['🐞', 'beetle'],
  ['🐜', 'ant'], ['🕷️', 'spider'], ['🦂', 'scorpion'], ['🐢', 'turtle'], ['🐍', 'snake'],
  ['🦎', 'lizard'], ['🐙', 'octopus'], ['🦑', 'squid'], ['🦐', 'shrimp'], ['🦞', 'lobster'],
  ['🐟', 'fish'], ['🐠', 'tropical_fish'], ['🐬', 'dolphin'], ['🐳', 'whale'], ['🦈', 'shark'],
  ['🐊', 'crocodile'], ['🐘', 'elephant'], ['🦏', 'rhinoceros'], ['🦍', 'gorilla'], ['🦒', 'giraffe'],
  ['🦘', 'kangaroo'], ['🐈', 'cat2'], ['🐕', 'dog2'], ['🐓', 'rooster'], ['🕊️', 'dove'],
  ['🦌', 'deer'], ['🐾', 'paw_prints'], ['🌵', 'cactus'], ['🌲', 'evergreen_tree'], ['🌳', 'deciduous_tree'],
  ['🌴', 'palm_tree'], ['🌱', 'seedling'], ['🌿', 'herb'], ['🍀', 'four_leaf_clover'], ['🍁', 'maple_leaf'],
  ['🍂', 'fallen_leaf'], ['🍃', 'leaves'], ['🍄', 'mushroom'], ['🌷', 'tulip'], ['🌸', 'cherry_blossom'],
  ['🌹', 'rose'], ['🥀', 'wilted_flower'], ['🌺', 'hibiscus'], ['🌻', 'sunflower'], ['🌼', 'blossom'],
  ['💐', 'bouquet'], ['🌈', 'rainbow'], ['⭐', 'star'], ['🌟', 'star2'], ['✨', 'sparkles'],
  ['💫', 'dizzy'], ['⚡', 'zap'], ['🔥', 'fire'], ['💥', 'boom', 'collision'], ['❄️', 'snowflake'],
  ['☀️', 'sunny'], ['☁️', 'cloud'], ['⛅', 'partly_sunny'], ['☔', 'umbrella'], ['💧', 'droplet'],
  ['🌊', 'ocean'], ['🌙', 'crescent_moon', 'moon'], ['🌝', 'full_moon_with_face'], ['🌞', 'sun_with_face'], ['🌎', 'earth_americas'],
  // ---- food & drink ----
  ['🍎', 'apple'], ['🍏', 'green_apple'], ['🍊', 'orange'], ['🍋', 'lemon'], ['🍌', 'banana'],
  ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🍒', 'cherries'], ['🍑', 'peach'],
  ['🍍', 'pineapple'], ['🥥', 'coconut'], ['🥝', 'kiwi_fruit'], ['🍅', 'tomato'], ['🥑', 'avocado'],
  ['🍆', 'eggplant'], ['🥕', 'carrot'], ['🌽', 'corn'], ['🌶️', 'hot_pepper'], ['🥒', 'cucumber'],
  ['🍞', 'bread'], ['🧀', 'cheese'], ['🥚', 'egg'], ['🍳', 'fried_egg'], ['🥞', 'pancakes'],
  ['🥓', 'bacon'], ['🍔', 'hamburger'], ['🍟', 'fries'], ['🍕', 'pizza'], ['🌭', 'hotdog'],
  ['🌮', 'taco'], ['🌯', 'burrito'], ['🍿', 'popcorn'], ['🍩', 'doughnut'], ['🍪', 'cookie'],
  ['🍰', 'cake'], ['🎂', 'birthday'], ['🧁', 'cupcake'], ['🍫', 'chocolate_bar'], ['🍬', 'candy'],
  ['🍭', 'lollipop'], ['🍦', 'icecream'], ['🍨', 'ice_cream'], ['☕', 'coffee'], ['🍵', 'tea'],
  ['🍾', 'champagne'], ['🍷', 'wine_glass'], ['🍸', 'cocktail'], ['🍹', 'tropical_drink'], ['🍺', 'beer'],
  ['🍻', 'beers'], ['🥂', 'clinking_glasses'], ['🥃', 'tumbler_glass'], ['🥤', 'cup_with_straw'],
  // ---- activity & objects ----
  ['⚽', 'soccer'], ['🏀', 'basketball'], ['🏈', 'football'], ['⚾', 'baseball'], ['🎾', 'tennis'],
  ['🎱', '8ball'], ['🎯', 'dart'], ['🎲', 'game_die'], ['🧩', 'jigsaw'], ['🎮', 'video_game'],
  ['🎭', 'performing_arts'], ['🎨', 'art'], ['🎬', 'clapper'], ['🎤', 'microphone'], ['🎧', 'headphones'],
  ['🎵', 'musical_note'], ['🎶', 'notes'], ['🎸', 'guitar'], ['🎹', 'musical_keyboard'], ['🥁', 'drum'],
  ['🎁', 'gift', 'present'], ['🎈', 'balloon'], ['🎉', 'tada'], ['🎊', 'confetti_ball'], ['🎆', 'fireworks'],
  ['🎀', 'ribbon'], ['💎', 'gem'], ['💍', 'ring'], ['💄', 'lipstick'], ['🎩', 'tophat'],
  ['🔮', 'crystal_ball'], ['📱', 'iphone'], ['💻', 'computer'], ['📷', 'camera'], ['📺', 'tv'],
  ['💡', 'bulb'], ['🔦', 'flashlight'], ['🕯️', 'candle'], ['📖', 'book'], ['📚', 'books'],
  ['✏️', 'pencil2'], ['📝', 'memo'], ['✂️', 'scissors'], ['🔑', 'key'], ['🔒', 'lock'],
  ['🔓', 'unlock'], ['🔨', 'hammer'], ['🔧', 'wrench'], ['⚙️', 'gear'], ['🔫', 'gun'],
  ['💣', 'bomb'], ['🔪', 'knife'], ['🗡️', 'dagger'], ['🛡️', 'shield'], ['💉', 'syringe'],
  ['💊', 'pill'], ['💰', 'moneybag'], ['💵', 'dollar'], ['💳', 'credit_card'], ['📦', 'package'],
  ['✉️', 'envelope'], ['📧', 'email'], ['🔔', 'bell'], ['📢', 'loudspeaker'], ['📣', 'mega'],
  ['⌛', 'hourglass'], ['⌚', 'watch'], ['⏰', 'alarm_clock'],
  // ---- travel ----
  ['🚀', 'rocket'], ['✈️', 'airplane'], ['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'],
  ['🚑', 'ambulance'], ['🚒', 'fire_engine'], ['🚲', 'bike'], ['🏍️', 'motorcycle'], ['🚆', 'train'],
  ['🚢', 'ship'], ['⚓', 'anchor'],
  // ---- symbols ----
  ['💯', '100'], ['✔️', 'heavy_check_mark'], ['✅', 'white_check_mark'], ['❌', 'x'], ['❎', 'negative_squared_cross_mark'],
  ['➕', 'heavy_plus_sign'], ['➖', 'heavy_minus_sign'], ['❓', 'question'], ['❗', 'exclamation'], ['‼️', 'bangbang'],
  ['⁉️', 'interrobang'], ['⚠️', 'warning'], ['⛔', 'no_entry'], ['🚫', 'no_entry_sign'], ['💲', 'heavy_dollar_sign'],
  ['💤', 'zzz'], ['💢', 'anger'], ['💬', 'speech_balloon'], ['💭', 'thought_balloon'], ['🕳️', 'hole'],
  ['♟️', 'chess_pawn'], ['🔤', 'abc'],
  // ---- seasonal ----
  ['🎅', 'santa'], ['🤶', 'mrs_claus'], ['🎄', 'christmas_tree'], ['☃️', 'snowman_with_snow'], ['⛄', 'snowman'],
  ['🎃', 'jack_o_lantern'], ['🧨', 'firecracker'], ['🧧', 'red_envelope'],
];

export const EMOJI_LIST: EmojiEntry[] = RAW.map(([char, name, ...aliases]) => ({ char, name, aliases: [...aliases] }));

/** Every name and alias → emoji, for expansion. */
export const EMOJI: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const { char, name, aliases } of EMOJI_LIST) {
    m[name] = char;
    for (const a of aliases) m[a] = char;
  }
  return m;
})();

/** emoji char → primary :name: (for the picker's titles / the frequently-used row). */
const NAME_BY_CHAR: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const { char, name } of EMOJI_LIST) if (!(char in m)) m[char] = name;
  return m;
})();

export function nameForChar(char: string): string | undefined {
  return NAME_BY_CHAR[char];
}

// A :shortcode: — letters, digits, _ + - between two *adjacent* colons. Both colons required with
// no space inside, so emoticons (:) :D :P — no closing colon) and ordinary Haven poses (":waves at
// her" — a single leading colon, words space-separated) never match; only a tight :name: does.
const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

/**
 * Replace every known `:name:` with its emoji, anywhere in the line. Unknown shortcodes are left
 * exactly as typed, as is anything with only one colon, so game text (12:30, http://…, "exits:")
 * and normal `:pose` emotes are untouched. A pose whose body carries a shortcode still expands it
 * while keeping its own leading colon (":picks up the :gift:" → ":picks up the 🎁", since ":picks"
 * has no closing colon to match); a bare ":santa:" does become 🎅.
 */
export function expandEmoji(text: string): string {
  if (!text || text.indexOf(':') === -1) return text;
  return text.replace(SHORTCODE_RE, (m, name: string) => EMOJI[name.toLowerCase()] ?? m);
}

/** Picker search: entries whose primary name or any alias contains the query (colons ignored). */
export function searchEmoji(query: string): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, '');
  if (!q) return EMOJI_LIST;
  return EMOJI_LIST.filter((e) => e.name.includes(q) || e.aliases.some((a) => a.includes(q)));
}
