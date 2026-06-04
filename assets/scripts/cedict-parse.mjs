/* cedict-parse.mjs — parse the raw CC-CEDICT `cedict_ts.u8` source into the
   compact in-memory shape that build-dict.mjs consumes:

     { all: RawEntry[], classifierLookup: [simplified, traditional, pinyin][] }
     RawEntry = [traditional, simplified, pinyin, meanings(string|string[]),
                 variantIndices[], classifierIndices[]]

   The line/meaning/variant/classifier parsing below is adapted (verbatim where
   practical, including the regexes) from the `cc-cedict` package's build step:
     https://github.com/edvardsr/cc-cedict — MIT License, © edvardsr.
   We vendor it so the dictionary is built from a pinned, committed copy of
   `cedict_ts.u8` (see assets/cedict/) with no install-time network download,
   making the generated index fully reproducible. The regexes use \u escapes
   (not literal characters) so they match cc-cedict's behaviour byte-for-byte. */

const REGEX = {
  line: /\/(.*)/s,
  variant_of:
    /(variant of (([\p{Unified_Ideograph}〆〇][︀-️\u{e0100}-\u{e01ef}]?){1,})?(\|([\p{Unified_Ideograph}〆〇][︀-️\u{e0100}-\u{e01ef}]?){1,})?(\[([^\]]*))?)/gmu,
  classifiers:
    /(CL:((([\p{Unified_Ideograph}〆〇][︀-️\u{e0100}-\u{e01ef}]?){1,})?(\|([\p{Unified_Ideograph}〆〇][︀-️\u{e0100}-\u{e01ef}]?){1,})?(\[([^\]]*)\]),?)+)/gmu,
  pinyin: /([A-Za-z:]+[0-9])/g,
}

// Parse a "simplified|traditional[pin1 yin1]" fragment (used for classifiers).
function parseVariant(input) {
  if (!input || !input.length) return
  const [chars, pinyinPart] = input.split('[')
  const [simplified, traditional] = chars.split('|')
  const pinyin = pinyinPart?.match(REGEX.pinyin)?.join(' ') || null
  return [simplified, traditional || simplified, pinyin]
}

// Split the "/def/def/.../" tail into meanings, pulling out CL: classifiers and
// "variant of …" notes exactly like cc-cedict does (a meaning that is ONLY a
// classifier or variant note is dropped from the visible meaning list).
function parseMeanings(input) {
  const result = { meanings: [], variant_of: [], classifiers: [] }
  const variantMap = {}
  const classifierMap = {}
  for (const meaning of input.replace('\r', '').split('/')) {
    const trimmed = meaning.trim()
    if (!trimmed) continue
    const variantMatches = trimmed.match(REGEX.variant_of)
    let skipMeaning = false
    if (variantMatches) {
      if (variantMatches[0] === trimmed) skipMeaning = true
      const variant = variantMatches[0].substring(11)
      const parsed = parseVariant(variant)
      if (parsed) {
        const key = parsed.join('')
        if (!variantMap[key]) {
          variantMap[key] = true
          result.variant_of.push(parsed)
        }
      }
    }
    const classifierMatches = trimmed.match(REGEX.classifiers)
    if (classifierMatches) {
      if (classifierMatches[0] === trimmed) skipMeaning = true
      const classifiers = classifierMatches[0].substring(3).split(',')
      for (const classifier of classifiers) {
        const parsed = parseVariant(classifier)
        if (!parsed) continue
        const key = parsed.join('')
        if (!classifierMap[key]) {
          classifierMap[key] = true
          result.classifiers.push(parsed)
        }
      }
    }
    if (!skipMeaning) result.meanings.push(trimmed)
  }
  return result
}

// Parse a single CC-CEDICT line: "傳統 传统 [chuan2 tong3] /tradition/.../".
function parseLine(line) {
  line = line.trim()
  if (!line || line.startsWith('#')) return null
  const splitLine = line.split(REGEX.line)
  if (!splitLine || splitLine.length < 2) return null
  const parsed = parseMeanings(splitLine[1])
  const [chars, pinyinPart] = splitLine[0].split('[')
  if (!chars || !pinyinPart) return null
  const [traditional, simplified] = chars.trim().split(' ')
  const pinyin = pinyinPart.split(']')[0]
  if (!traditional || !simplified || !pinyin) return null
  return [traditional, simplified, pinyin, parsed.meanings, parsed.variant_of, parsed.classifiers]
}

/** Parse the full cedict_ts.u8 text into { all, classifierLookup }. */
export function parseCedict(text) {
  const all = []
  const classifierLookup = []
  const classifierLookupMap = new Map()
  const addClassifier = (tuple) => {
    const key = `${tuple[0]}_${tuple[1]}_${tuple[2]}`
    let idx = classifierLookupMap.get(key)
    if (idx === undefined) {
      idx = classifierLookup.length
      classifierLookup.push([tuple[0], tuple[1], tuple[2] || ''])
      classifierLookupMap.set(key, idx)
    }
    return idx
  }
  for (const line of text.split('\n')) {
    const parsed = parseLine(line)
    if (!parsed || !parsed[0] || !parsed[1] || !parsed[2]) continue
    const classifierIndices = parsed[5].map(addClassifier)
    // cc-cedict stores a single meaning as a string, multiple as an array
    const meanings = parsed[3].length === 1 ? parsed[3][0] : parsed[3]
    // [trad, simp, pinyin, meanings, variantIndices, classifierIndices].
    // Variants (index 4) are unused downstream, so we leave them empty.
    all.push([parsed[0], parsed[1], parsed[2], meanings, [], classifierIndices])
  }
  return { all, classifierLookup }
}
