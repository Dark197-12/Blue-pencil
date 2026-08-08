/**
 * Working out which pronoun refers to which character.
 *
 * Needed because "said she" is 93 lines of Pride and Prejudice that would
 * otherwise stay unattributed. Knowing a character is female narrows the
 * candidates, and where only one female is in the conversation it settles them.
 *
 * Titles are the reliable signal but they only cover half the cast — 10 of 21
 * here. The rest are bare given names ("Elizabeth", "Jane", "Wickham"), so
 * gender is read from how the narration itself refers to them: find a mention
 * of the name, then look at the next pronoun. Guessing from the name would mean
 * shipping a list of English given names and would be wrong for invented ones,
 * which is most of fantasy and science fiction.
 */

export type Gender = "male" | "female" | null;

const MALE_TITLES = /^(?:mr|sir|lord|colonel|captain|major|general|uncle|father|brother|king|prince|duke|earl)\b/i;
const FEMALE_TITLES = /^(?:mrs|ms|miss|lady|aunt|mother|sister|queen|princess|duchess|countess)\b/i;

const MALE_PRONOUN = /\b(?:he|him|his|himself)\b/i;
const FEMALE_PRONOUN = /\b(?:she|her|hers|herself)\b/i;

export interface GenderEvidence {
  gender: Gender;
  /** How the answer was reached, for explaining it to the author later. */
  source: "title" | "narration" | "unknown";
  maleHits: number;
  femaleHits: number;
}

export interface InferGenderOptions {
  /**
   * How far past a name to look for a pronoun. One clause: far enough to catch
   * "Elizabeth, who had been watching, felt her cheeks colour", short enough
   * that the next sentence's subject does not bleed in.
   */
  window?: number;
  /** Minimum observations before narration is trusted at all. */
  minEvidence?: number;
  /** Share of observations that must agree. */
  minAgreement?: number;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);

const MALE_TITLE_WORDS = "Mr|Sir|Lord|Colonel|Captain|Major|General|Uncle|King|Prince|Duke|Earl";
const FEMALE_TITLE_WORDS = "Mrs|Ms|Miss|Lady|Aunt|Queen|Princess|Duchess|Countess";

/** Counts how often a name appears in the prose behind a gendered title. */
function countTitledMentions(text: string, aliases: ReadonlyArray<string>) {
  let male = 0;
  let female = 0;

  for (const alias of aliases) {
    const name = escapeRegExp(alias);
    male += (text.match(new RegExp(`\\b(?:${MALE_TITLE_WORDS})\\.?\\s+${name}\\b`, "g")) ?? []).length;
    female += (text.match(new RegExp(`\\b(?:${FEMALE_TITLE_WORDS})\\.?\\s+${name}\\b`, "g")) ?? []).length;
  }

  return { male, female };
}

/**
 * Reads gender for each character from the manuscript.
 *
 * `aliases` should include every spelling; a character named only by surname in
 * narration but by given name in speech tags needs both to gather evidence.
 */
export function inferGenders(
  text: string,
  cast: ReadonlyArray<{ name: string; aliases: ReadonlyArray<string> }>,
  options: InferGenderOptions = {},
): Map<string, GenderEvidence> {
  const window = options.window ?? 90;
  const minEvidence = options.minEvidence ?? 3;
  const minAgreement = options.minAgreement ?? 0.7;

  const result = new Map<string, GenderEvidence>();

  for (const character of cast) {
    /** Every other character's spellings, to spot an intervening mention. */
    const otherAliases = cast
      .filter((c) => c.name !== character.name)
      .flatMap((c) => c.aliases)
      .filter((alias) => alias.length > 2)
      .map(escapeRegExp);
    const otherNames =
      otherAliases.length > 0 ? new RegExp(`\\b(?:${otherAliases.join("|")})\\b`) : null;

    // A title settles it outright — "Mrs. Bennet" is not ambiguous, and no
    // amount of nearby pronouns should be able to overturn it.
    const titled = character.aliases.find((a) => MALE_TITLES.test(a) || FEMALE_TITLES.test(a));
    if (titled) {
      result.set(character.name, {
        gender: MALE_TITLES.test(titled) ? "male" : "female",
        source: "title",
        maleHits: 0,
        femaleHits: 0,
      });
      continue;
    }

    /**
     * A speech tag may never use a title where the narration always does:
     * Austen writes `said Darcy` but "Mr. Darcy" hundreds of times in the
     * prose. Looking for a title in front of the name anywhere in the
     * manuscript settles Darcy and Bingley, who are otherwise drowned out by
     * being forever in the company of the Bennet sisters.
     */
    const titleInProse = countTitledMentions(text, character.aliases);
    if (titleInProse.male >= 3 && titleInProse.male > titleInProse.female * 3) {
      result.set(character.name, {
        gender: "male",
        source: "title",
        maleHits: titleInProse.male,
        femaleHits: titleInProse.female,
      });
      continue;
    }
    if (titleInProse.female >= 3 && titleInProse.female > titleInProse.male * 3) {
      result.set(character.name, {
        gender: "female",
        source: "title",
        maleHits: titleInProse.male,
        femaleHits: titleInProse.female,
      });
      continue;
    }

    let maleHits = 0;
    let femaleHits = 0;

    for (const alias of character.aliases) {
      const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, "g");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const from = match.index + match[0].length;
        const after = text.slice(from, from + window);

        // Only the *first* pronoun counts. Later ones in the window are as
        // likely to belong to whoever the sentence turned to next.
        const male = MALE_PRONOUN.exec(after);
        const female = FEMALE_PRONOUN.exec(after);

        const nearest = male && (!female || male.index < female.index) ? male : female;
        if (!nearest) continue;

        /**
         * Discard the observation if somebody else is named in between.
         * "Darcy bowed to Elizabeth, and she coloured" says nothing about
         * Darcy. In a novel where the men are constantly beside the Bennet
         * sisters this is most of the noise: without it Darcy reads 167 male
         * to 136 female and is written off as unknown.
         */
        if (otherNames && otherNames.test(after.slice(0, nearest.index))) continue;

        if (nearest === male) maleHits++;
        else femaleHits++;
      }
    }

    const total = maleHits + femaleHits;
    const leader = Math.max(maleHits, femaleHits);

    if (total >= minEvidence && leader / total >= minAgreement) {
      result.set(character.name, {
        gender: maleHits > femaleHits ? "male" : "female",
        source: "narration",
        maleHits,
        femaleHits,
      });
    } else {
      result.set(character.name, { gender: null, source: "unknown", maleHits, femaleHits });
    }
  }

  return result;
}

/** Which gender a pronoun speech tag implies, if any. */
export function genderOfPronoun(raw: string): Gender {
  const token = raw.trim().toLowerCase();
  if (/^(?:he|him|his|himself)$/.test(token)) return "male";
  if (/^(?:she|her|hers|herself)$/.test(token)) return "female";
  return null;
}
