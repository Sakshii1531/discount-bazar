/**
 * Customer product search filter.
 *
 * Every word must match the product's name, brand or tags, or, when the
 * caller asks for it, its header / category / subcategory name ("spices"
 * finds everything in Spices). Doubled
 * letters are optional ("chili" = "chilli"), and common Hindi grocery names
 * are searched alongside their English ones ("lal mirch" also finds "Red
 * Chilli Powder", and "turmeric" also finds "Haldi").
 */
import Category from "../models/category.js";
import { buildLenientWordRegex } from "../utils/regex.js";

// Each group lists names for the same item; the first is the English one.
const SYNONYM_GROUPS = [
  ["red chilli", "lal mirch"],
  ["black pepper", "kali mirch"],
  ["green chilli", "hari mirch"],
  ["chilli", "mirch"],
  ["turmeric", "haldi"],
  ["ginger", "adrak"],
  ["cumin", "jeera", "zeera"],
  ["coriander", "dhaniya", "dhania"],
  ["garlic", "lahsun", "lehsun"],
  ["onion", "pyaz", "kanda"],
  ["potato", "aloo", "alu"],
  ["tomato", "tamatar"],
  ["salt", "namak"],
  ["sugar", "cheeni", "chini"],
  ["rice", "chawal"],
  ["wheat flour", "atta"],
  ["gram flour", "besan"],
  ["semolina", "sooji", "suji", "rava"],
  ["refined flour", "maida"],
  ["cardamom", "elaichi", "ilaichi"],
  ["clove", "laung"],
  ["cinnamon", "dalchini"],
  ["fenugreek", "methi"],
  ["mustard", "sarson"],
  ["asafoetida", "hing"],
  ["carom", "ajwain"],
  ["fennel", "saunf"],
  ["curd", "dahi"],
  ["milk", "doodh"],
  ["tea", "chai"],
  ["jaggery", "gur", "gud"],
  ["tamarind", "imli"],
  ["saffron", "kesar"],
  ["soap", "sabun"],
];

// Keys ignore case and doubled letters, so "chili", "Chilli" and "CHILLI" agree.
const normalizeWord = (word) => String(word).toLowerCase().replace(/(\p{L})\1+/gu, "$1");
const phraseKey = (words) => words.map(normalizeWord).join(" ");

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const name of group) {
    SYNONYMS.set(phraseKey(name.split(" ")), group.filter((other) => other !== name));
  }
}
const MAX_PHRASE_WORDS = Math.max(...SYNONYM_GROUPS.flat().map((name) => name.split(" ").length));

/**
 * The search as typed plus one translated variant where every known name is
 * swapped for its first synonym. Swapped-in words are flagged so they only
 * match at the start of a word ("dahi" must not match inside other words).
 */
export function expandSearchTerm(term) {
  const words = String(term || "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return [];

  const translated = [];
  let changed = false;
  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (let size = Math.min(MAX_PHRASE_WORDS, words.length - i); size > 0; size -= 1) {
      const alternatives = SYNONYMS.get(phraseKey(words.slice(i, i + size)));
      if (alternatives?.length) {
        for (const word of alternatives[0].split(" ")) translated.push({ word, wholeWord: true });
        i += size;
        matched = changed = true;
        break;
      }
    }
    if (!matched) {
      translated.push({ word: words[i], wholeWord: false });
      i += 1;
    }
  }

  const original = words.map((word) => ({ word, wholeWord: false }));
  return changed ? [original, translated] : [original];
}

function wordRegex({ word, wholeWord }) {
  const lenient = buildLenientWordRegex(word);
  return wholeWord ? { ...lenient, $regex: `(^|[^a-z0-9])${lenient.$regex}` } : lenient;
}

/** Category ids (any level) whose name matches each distinct word. */
async function categoryIdsByWord(variants) {
  const unique = new Map();
  for (const variant of variants) {
    for (const entry of variant) unique.set(`${entry.wholeWord}:${normalizeWord(entry.word)}`, entry);
  }
  const ids = new Map();
  await Promise.all(
    [...unique].map(async ([key, entry]) => {
      const categories = await Category.find({ name: wordRegex(entry) }).select("_id").limit(200).lean();
      ids.set(key, categories.map((c) => c._id));
    }),
  );
  return (entry) => ids.get(`${entry.wholeWord}:${normalizeWord(entry.word)}`) || [];
}

/**
 * Mongo filter for a customer search term, or null when the term is blank.
 * With `matchCategories`, a word may also match the product's header,
 * category or subcategory name.
 */
export async function buildProductSearchFilter(term, { matchCategories = false } = {}) {
  const variants = expandSearchTerm(term);
  if (!variants.length) return null;
  const categoryIdsFor = matchCategories ? await categoryIdsByWord(variants) : () => [];

  const clauses = variants.map((variant) => ({
    $and: variant.map((entry) => {
      const regex = wordRegex(entry);
      const categoryIds = categoryIdsFor(entry);
      return {
        $or: [
          { name: regex },
          { brand: regex },
          { tags: regex },
          ...(categoryIds.length
            ? [
                { headerId: { $in: categoryIds } },
                { categoryId: { $in: categoryIds } },
                { subcategoryId: { $in: categoryIds } },
              ]
            : []),
        ],
      };
    }),
  }));
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}
