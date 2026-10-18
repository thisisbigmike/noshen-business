// Checks that say what's wrong, not just that something is. Used in the browser (as the person types or
// submits) and on the server, so the message is the same either way. Each returns null when the value is fine.
// `t` gives the message in the reader's language (English by default).
import { en, type T } from "./i18n";

const EMAIL_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmaill.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com",
};

export function emailProblem(value: string, t: T = en): string | null {
  const s = value.trim();
  if (!s) return t("Enter your email address, so we can send you a code.");
  if (/\s/.test(s)) return t("Remove the space. Email addresses don't have spaces in them.");
  const ats = (s.match(/@/g) ?? []).length;
  if (ats === 0) return t("Your email needs an @, like chioma@gmail.com.");
  if (ats > 1) return t("Your email has more than one @. Keep just one.");
  const [user, domain] = s.split("@");
  if (!user) return t("Add the part before the @, like chioma@gmail.com.");
  if (!domain) return t("Add the part after the @, like {example}.", { example: `${user}@gmail.com` });
  if (!domain.includes(".")) return t("Add the ending after “{domain}”, like {example}.", { domain, example: `${user}@${domain}.com` });
  if (domain.startsWith(".") || domain.endsWith(".") || s.includes("..")) return t("There's a dot in the wrong place. Check the part after the @.");
  const ending = domain.split(".").pop() ?? "";
  if (ending.length < 2) return t("“.{ending}” is too short for an email ending. Check the part after the last dot.", { ending });
  if (/[^a-z0-9.@_+'-]/i.test(s)) return t("Your email has a character email addresses can't use. Check for commas or brackets.");
  const fix = EMAIL_TYPOS[domain.toLowerCase()];
  if (fix) return t("Did you mean {email}? Check the spelling after the @.", { email: `${user}@${fix}` });
  return null;
}

export function nameProblem(value: string, t: T = en): string | null {
  const s = value.trim().replace(/\s+/g, " ");
  if (!s) return t("Enter your full name, as it is on your bank account.");
  if (s.split(" ").length < 2) return t("Add your surname too. Use both names, as they are on your bank account.");
  if (/\d/.test(s)) return t("Names don't have numbers in them. Use the name on your bank account.");
  return null;
}

/** An exact count of digits: NIN and BVN (11), NUBAN account numbers (10), IMEI (15). `what` is shown as given. */
export function digitsProblem(value: string, count: number, what: string, t: T = en): string | null {
  const s = value.replace(/\s/g, "");
  if (!s) return t("Enter your {what}. It has {count} digits.", { what, count });
  if (/\D/.test(s)) return t("Use numbers only. Your {what} has {count} digits and no letters or symbols.", { what, count });
  if (s.length < count) return count - s.length === 1
    ? t("Your {what} has {count} digits. You've typed {n}, so 1 is missing.", { what, count, n: s.length })
    : t("Your {what} has {count} digits. You've typed {n}, so {missing} are missing.", { what, count, n: s.length, missing: count - s.length });
  if (s.length > count) return t("Your {what} has {count} digits. You've typed {n}, which is {extra} too many.", { what, count, n: s.length, extra: s.length - count });
  return null;
}
