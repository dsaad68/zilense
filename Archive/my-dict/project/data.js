/* data.js — curated mini-dictionary + sample article for the prototype.
   Global: window.DICT = { CHARS, WORDS, ARTICLE, WORD_TOKENS, lookup() } */
(function () {
  // ---- Single characters -------------------------------------------------
  const CHARS = {
    "你": { pinyin: "nǐ", pos: "pronoun", defs: ["you (singular)"], hsk: 1, freq: "very common", radical: { char: "亻", meaning: "person" }, components: ["亻", "尔"], strokes: 7,
      examples: [{ zh: "你是学生吗？", py: "Nǐ shì xuéshēng ma?", en: "Are you a student?" }] },
    "好": { pinyin: "hǎo", pos: "adjective", defs: ["good", "well", "fine"], hsk: 1, freq: "very common", radical: { char: "女", meaning: "woman" }, components: ["女", "子"], strokes: 6,
      examples: [{ zh: "今天天气很好。", py: "Jīntiān tiānqì hěn hǎo.", en: "The weather is nice today." }] },
    "我": { pinyin: "wǒ", pos: "pronoun", defs: ["I", "me"], hsk: 1, freq: "very common", radical: { char: "戈", meaning: "halberd" }, components: ["手", "戈"], strokes: 7,
      examples: [{ zh: "我喜欢中文。", py: "Wǒ xǐhuān zhōngwén.", en: "I like Chinese." }] },
    "是": { pinyin: "shì", pos: "verb", defs: ["to be", "is / are / am", "yes"], hsk: 1, freq: "very common", radical: { char: "日", meaning: "sun" }, components: ["日", "正"], strokes: 9,
      examples: [{ zh: "他是老师。", py: "Tā shì lǎoshī.", en: "He is a teacher." }] },
    "一": { pinyin: "yī", pos: "numeral", defs: ["one", "a / an", "single"], hsk: 1, freq: "very common", radical: { char: "一", meaning: "one" }, components: ["一"], strokes: 1,
      examples: [{ zh: "一个人。", py: "Yí ge rén.", en: "One person." }] },
    "个": { pinyin: "gè", pos: "measure word", defs: ["general measure word", "piece / item"], hsk: 1, freq: "very common", radical: { char: "人", meaning: "person" }, components: ["人", "丨"], strokes: 3,
      examples: [{ zh: "三个朋友。", py: "Sān ge péngyǒu.", en: "Three friends." }] },
    "在": { pinyin: "zài", pos: "preposition / verb", defs: ["at, in, on", "to be located at", "(in the middle of) doing"], hsk: 1, freq: "very common", radical: { char: "土", meaning: "earth" }, components: ["才", "土"], strokes: 6,
      examples: [{ zh: "我在中国。", py: "Wǒ zài Zhōngguó.", en: "I am in China." }] },
    "很": { pinyin: "hěn", pos: "adverb", defs: ["very", "quite", "(links adjective to subject)"], hsk: 1, freq: "very common", radical: { char: "彳", meaning: "step" }, components: ["彳", "艮"], strokes: 9,
      examples: [{ zh: "她很高兴。", py: "Tā hěn gāoxìng.", en: "She is very happy." }] },
    "它": { pinyin: "tā", pos: "pronoun", defs: ["it (for things & animals)"], hsk: 1, freq: "common", radical: { char: "宀", meaning: "roof" }, components: ["宀", "匕"], strokes: 5,
      examples: [{ zh: "它很有意思。", py: "Tā hěn yǒuyìsi.", en: "It is very interesting." }] },
    "的": { pinyin: "de", pos: "particle", defs: ["(possessive / modifying particle)", "'s"], hsk: 1, freq: "very common", radical: { char: "白", meaning: "white" }, components: ["白", "勺"], strokes: 8,
      examples: [{ zh: "我的书。", py: "Wǒ de shū.", en: "My book." }] },
    "喝": { pinyin: "hē", pos: "verb", defs: ["to drink"], hsk: 1, freq: "very common", radical: { char: "口", meaning: "mouth" }, components: ["口", "曷"], strokes: 12,
      examples: [{ zh: "我喝茶。", py: "Wǒ hē chá.", en: "I drink tea." }] },
    "茶": { pinyin: "chá", pos: "noun", defs: ["tea"], hsk: 1, freq: "very common", radical: { char: "艹", meaning: "grass / plant" }, components: ["艹", "人", "木"], strokes: 9,
      examples: [{ zh: "中国茶很有名。", py: "Zhōngguó chá hěn yǒumíng.", en: "Chinese tea is famous." }] },
    "也": { pinyin: "yě", pos: "adverb", defs: ["also", "too", "as well"], hsk: 1, freq: "very common", radical: { char: "乙", meaning: "second" }, components: ["乙"], strokes: 3,
      examples: [{ zh: "我也喜欢。", py: "Wǒ yě xǐhuān.", en: "I like it too." }] },
    "吃": { pinyin: "chī", pos: "verb", defs: ["to eat"], hsk: 1, freq: "very common", radical: { char: "口", meaning: "mouth" }, components: ["口", "乞"], strokes: 6,
      examples: [{ zh: "你吃饭了吗？", py: "Nǐ chīfàn le ma?", en: "Have you eaten?" }] },
    "饭": { pinyin: "fàn", pos: "noun", defs: ["cooked rice", "meal", "food"], hsk: 1, freq: "very common", radical: { char: "饣", meaning: "food" }, components: ["饣", "反"], strokes: 7,
      examples: [{ zh: "吃饭了！", py: "Chīfàn le!", en: "Time to eat!" }] },
    // breakdown-only characters
    "学": { pinyin: "xué", pos: "verb / noun", defs: ["to study, to learn", "school / -ology"], hsk: 1, freq: "very common", radical: { char: "子", meaning: "child" }, components: ["⺍", "冖", "子"], strokes: 8,
      examples: [{ zh: "我学中文。", py: "Wǒ xué zhōngwén.", en: "I study Chinese." }] },
    "习": { pinyin: "xí", pos: "verb", defs: ["to practice", "to review", "habit"], hsk: 1, freq: "common", radical: { char: "乙", meaning: "second" }, components: ["乙", "冫"], strokes: 3,
      examples: [{ zh: "复习功课。", py: "Fùxí gōngkè.", en: "Review lessons." }] },
    "中": { pinyin: "zhōng", pos: "noun / adjective", defs: ["middle, center", "China (abbr.)", "within"], hsk: 1, freq: "very common", radical: { char: "丨", meaning: "line" }, components: ["口", "丨"], strokes: 4,
      examples: [{ zh: "中间。", py: "Zhōngjiān.", en: "The middle." }] },
    "文": { pinyin: "wén", pos: "noun", defs: ["language, script", "writing, culture"], hsk: 1, freq: "very common", radical: { char: "文", meaning: "script" }, components: ["文"], strokes: 4,
      examples: [{ zh: "中文。", py: "Zhōngwén.", en: "Chinese language." }] },
    "国": { pinyin: "guó", pos: "noun", defs: ["country", "nation", "state"], hsk: 1, freq: "very common", radical: { char: "囗", meaning: "enclosure" }, components: ["囗", "玉"], strokes: 8,
      examples: [{ zh: "外国。", py: "Wàiguó.", en: "Foreign country." }] },
    "喜": { pinyin: "xǐ", pos: "verb / noun", defs: ["to like, to be fond of", "happiness, joy"], hsk: 2, freq: "common", radical: { char: "口", meaning: "mouth" }, components: ["士", "口"], strokes: 12,
      examples: [{ zh: "恭喜！", py: "Gōngxǐ!", en: "Congratulations!" }] },
    "欢": { pinyin: "huān", pos: "adjective", defs: ["joyful, merry", "vigorous"], hsk: 2, freq: "common", radical: { char: "欠", meaning: "lack / yawn" }, components: ["又", "欠"], strokes: 6,
      examples: [{ zh: "欢迎！", py: "Huānyíng!", en: "Welcome!" }] },
    "因": { pinyin: "yīn", pos: "noun / conjunction", defs: ["cause, reason", "because of"], hsk: 2, freq: "common", radical: { char: "囗", meaning: "enclosure" }, components: ["囗", "大"], strokes: 6,
      examples: [{ zh: "原因。", py: "Yuányīn.", en: "The reason." }] },
    "为": { pinyin: "wèi", pos: "preposition / verb", defs: ["for, because of", "to act as (wéi)"], hsk: 2, freq: "very common", radical: { char: "丶", meaning: "dot" }, components: ["丶", "力"], strokes: 4,
      examples: [{ zh: "为你。", py: "Wèi nǐ.", en: "For you." }] },
    "有": { pinyin: "yǒu", pos: "verb", defs: ["to have", "there is / are", "to exist"], hsk: 1, freq: "very common", radical: { char: "月", meaning: "moon / flesh" }, components: ["𠂇", "月"], strokes: 6,
      examples: [{ zh: "我有书。", py: "Wǒ yǒu shū.", en: "I have a book." }] },
    "意": { pinyin: "yì", pos: "noun", defs: ["meaning, idea", "intention, wish"], hsk: 2, freq: "common", radical: { char: "心", meaning: "heart" }, components: ["音", "心"], strokes: 13,
      examples: [{ zh: "意思。", py: "Yìsi.", en: "Meaning." }] },
    "思": { pinyin: "sī", pos: "verb / noun", defs: ["to think", "thought, idea"], hsk: 2, freq: "common", radical: { char: "心", meaning: "heart" }, components: ["田", "心"], strokes: 9,
      examples: [{ zh: "思考。", py: "Sīkǎo.", en: "To ponder." }] },
    "老": { pinyin: "lǎo", pos: "adjective / prefix", defs: ["old", "venerable", "(respectful prefix)"], hsk: 1, freq: "very common", radical: { char: "老", meaning: "old" }, components: ["耂", "匕"], strokes: 6,
      examples: [{ zh: "老人。", py: "Lǎorén.", en: "Elderly person." }] },
    "师": { pinyin: "shī", pos: "noun", defs: ["teacher", "master", "expert"], hsk: 1, freq: "common", radical: { char: "巾", meaning: "cloth" }, components: ["丨", "帀"], strokes: 6,
      examples: [{ zh: "师傅。", py: "Shīfu.", en: "Master / skilled worker." }] },
    "们": { pinyin: "men", pos: "particle / suffix", defs: ["(plural marker for people)"], hsk: 1, freq: "very common", radical: { char: "亻", meaning: "person" }, components: ["亻", "门"], strokes: 5,
      examples: [{ zh: "他们。", py: "Tāmen.", en: "They / them." }] },
    "朋": { pinyin: "péng", pos: "noun", defs: ["friend", "companion"], hsk: 1, freq: "common", radical: { char: "月", meaning: "moon" }, components: ["月", "月"], strokes: 8,
      examples: [{ zh: "朋友。", py: "Péngyǒu.", en: "Friend." }] },
    "友": { pinyin: "yǒu", pos: "noun", defs: ["friend", "friendly"], hsk: 1, freq: "common", radical: { char: "又", meaning: "again / hand" }, components: ["𠂇", "又"], strokes: 4,
      examples: [{ zh: "友好。", py: "Yǒuhǎo.", en: "Friendly." }] },
    "谢": { pinyin: "xiè", pos: "verb", defs: ["to thank", "to wither (of flowers)"], hsk: 1, freq: "common", radical: { char: "讠", meaning: "speech" }, components: ["讠", "射"], strokes: 12,
      examples: [{ zh: "多谢！", py: "Duōxiè!", en: "Many thanks!" }] },
    "生": { pinyin: "shēng", pos: "verb / noun", defs: ["to be born, to grow", "life", "student (suffix)"], hsk: 1, freq: "very common", radical: { char: "生", meaning: "life" }, components: ["生"], strokes: 5,
      examples: [{ zh: "学生。", py: "Xuéshēng.", en: "Student." }] },
  };

  // ---- Multi-character words --------------------------------------------
  const WORDS = {
    "你好": { pinyin: "nǐ hǎo", pos: "interjection", defs: ["hello", "hi", "how do you do"], hsk: 1, freq: "very common", chars: ["你", "好"],
      examples: [{ zh: "你好，我叫小明。", py: "Nǐ hǎo, wǒ jiào Xiǎomíng.", en: "Hi, my name is Xiaoming." }] },
    "学习": { pinyin: "xué xí", pos: "verb / noun", defs: ["to study", "to learn", "learning"], hsk: 1, freq: "very common", chars: ["学", "习"],
      examples: [{ zh: "我每天学习中文。", py: "Wǒ měitiān xuéxí zhōngwén.", en: "I study Chinese every day." }] },
    "中文": { pinyin: "zhōng wén", pos: "noun", defs: ["Chinese (language)", "the Chinese written language"], hsk: 1, freq: "very common", chars: ["中", "文"],
      examples: [{ zh: "中文很有意思。", py: "Zhōngwén hěn yǒuyìsi.", en: "Chinese is very interesting." }] },
    "中国": { pinyin: "zhōng guó", pos: "proper noun", defs: ["China"], hsk: 1, freq: "very common", chars: ["中", "国"],
      examples: [{ zh: "我住在中国。", py: "Wǒ zhù zài Zhōngguó.", en: "I live in China." }] },
    "喜欢": { pinyin: "xǐ huān", pos: "verb", defs: ["to like", "to be fond of", "to enjoy"], hsk: 1, freq: "very common", chars: ["喜", "欢"],
      examples: [{ zh: "我喜欢喝茶。", py: "Wǒ xǐhuān hē chá.", en: "I like drinking tea." }] },
    "因为": { pinyin: "yīn wèi", pos: "conjunction", defs: ["because", "owing to", "since"], hsk: 2, freq: "very common", chars: ["因", "为"],
      examples: [{ zh: "因为下雨，我没去。", py: "Yīnwèi xiàyǔ, wǒ méi qù.", en: "I didn't go because it rained." }] },
    "有意思": { pinyin: "yǒu yì si", pos: "phrase / adjective", defs: ["interesting", "meaningful", "fun"], hsk: 2, freq: "common", chars: ["有", "意", "思"],
      examples: [{ zh: "这本书很有意思。", py: "Zhè běn shū hěn yǒuyìsi.", en: "This book is very interesting." }] },
    "意思": { pinyin: "yì si", pos: "noun", defs: ["meaning", "idea", "intention"], hsk: 2, freq: "very common", chars: ["意", "思"],
      examples: [{ zh: "这是什么意思？", py: "Zhè shì shénme yìsi?", en: "What does this mean?" }] },
    "老师": { pinyin: "lǎo shī", pos: "noun", defs: ["teacher", "instructor"], hsk: 1, freq: "very common", chars: ["老", "师"],
      examples: [{ zh: "我的老师很好。", py: "Wǒ de lǎoshī hěn hǎo.", en: "My teacher is great." }] },
    "我们": { pinyin: "wǒ men", pos: "pronoun", defs: ["we", "us"], hsk: 1, freq: "very common", chars: ["我", "们"],
      examples: [{ zh: "我们是朋友。", py: "Wǒmen shì péngyǒu.", en: "We are friends." }] },
    "朋友": { pinyin: "péng yǒu", pos: "noun", defs: ["friend"], hsk: 1, freq: "very common", chars: ["朋", "友"],
      examples: [{ zh: "他是我的好朋友。", py: "Tā shì wǒ de hǎo péngyǒu.", en: "He is my good friend." }] },
    "谢谢": { pinyin: "xiè xie", pos: "interjection", defs: ["thank you", "thanks"], hsk: 1, freq: "very common", chars: ["谢", "谢"],
      examples: [{ zh: "谢谢你的帮助。", py: "Xièxie nǐ de bāngzhù.", en: "Thank you for your help." }] },
    "学生": { pinyin: "xué shēng", pos: "noun", defs: ["student", "pupil"], hsk: 1, freq: "very common", chars: ["学", "生"],
      examples: [{ zh: "他是一个学生。", py: "Tā shì yí ge xuéshēng.", en: "He is a student." }] },
  };

  const ARTICLE =
    "你好！我是一个学生。我在中国学习中文。我很喜欢中文，因为它很有意思。我的老师很好，我们是朋友。我喜欢喝茶，也喜欢吃饭。谢谢你！";

  // words to greedily segment (longest first)
  const WORD_TOKENS = Object.keys(WORDS).sort((a, b) => b.length - a.length);

  // ---- gloss for radical / component pieces ------------------------------
  const COMP = {
    "亻": "person", "尔": "you (archaic)", "女": "woman", "子": "child",
    "手": "hand", "戈": "halberd", "日": "sun", "正": "upright", "一": "one",
    "人": "person", "丨": "vertical line", "才": "talent", "土": "earth",
    "彳": "step", "艮": "stubborn", "宀": "roof", "匕": "spoon", "白": "white",
    "勺": "ladle", "口": "mouth", "曷": "(phonetic)", "艹": "grass / plant",
    "木": "tree", "乙": "second / hook", "乞": "to beg", "饣": "food",
    "反": "reverse", "⺍": "small", "冖": "cover", "冫": "ice", "文": "script",
    "囗": "enclosure", "玉": "jade", "士": "scholar", "又": "hand / again",
    "欠": "to owe / yawn", "大": "big", "丶": "dot", "力": "strength",
    "𠂇": "hand", "月": "moon / flesh", "音": "sound", "心": "heart",
    "田": "field", "耂": "old", "帀": "to encircle", "门": "door",
    "讠": "speech", "射": "to shoot", "生": "life",
  };
  function compMeaning(c) { return COMP[c] || ""; }

  function lookup(q) {
    if (WORDS[q]) return Object.assign({ q, type: "word" }, WORDS[q]);
    if (CHARS[q]) return Object.assign({ q, type: "char" }, CHARS[q]);
    return null;
  }

  // For the English search index
  const ALL_ENTRIES = []
    .concat(Object.keys(WORDS).map((q) => lookup(q)))
    .concat(Object.keys(CHARS).map((q) => lookup(q)));

  window.DICT = { CHARS, WORDS, ARTICLE, WORD_TOKENS, lookup, ALL_ENTRIES, compMeaning };
})();
