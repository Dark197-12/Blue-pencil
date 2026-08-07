const ROMAN_VALUES: ReadonlyArray<readonly [string, number]> = [
  ["M", 1000],
  ["CM", 900],
  ["D", 500],
  ["CD", 400],
  ["C", 100],
  ["XC", 90],
  ["L", 50],
  ["XL", 40],
  ["X", 10],
  ["IX", 9],
  ["V", 5],
  ["IV", 4],
  ["I", 1],
];

/** Strict enough to reject "MIX" or "IC" while accepting I–MMMCMXCIX. */
const WELL_FORMED = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

export function romanToInt(input: string): number | null {
  const roman = input.trim().toUpperCase();
  if (!roman || !WELL_FORMED.test(roman)) return null;

  let total = 0;
  let index = 0;
  for (const [symbol, value] of ROMAN_VALUES) {
    while (roman.startsWith(symbol, index)) {
      total += value;
      index += symbol.length;
    }
  }
  return index === roman.length && total > 0 ? total : null;
}

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "Twenty-Three" → 23. Novels spell chapter numbers out often enough to matter. */
export function wordsToInt(input: string): number | null {
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, "-").replace(/-and-/g, "-");
  if (!cleaned) return null;

  const parts = cleaned.split("-").filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;

  const [first, second] = parts as [string, string | undefined];

  if (parts.length === 1) {
    return ONES[first] ?? TENS[first] ?? null;
  }

  const tens = TENS[first];
  const ones = second ? ONES[second] : undefined;
  if (tens === undefined || ones === undefined || ones >= 10) return null;
  return tens + ones;
}

/** Parses a chapter ordinal written as digits, roman numerals, or words. */
export function parseOrdinal(raw: string): number | null {
  const token = raw.trim();
  if (!token) return null;

  if (/^\d{1,4}$/.test(token)) {
    const value = Number(token);
    return value > 0 ? value : null;
  }

  return romanToInt(token) ?? wordsToInt(token);
}
