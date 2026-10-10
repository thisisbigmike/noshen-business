// Checks that say what's wrong, not just that something is. Used in the browser (as the person types or
// submits) and on the server, so the message is the same either way. Each returns null when the value is fine.

const EMAIL_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
  "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmaill.com": "gmail.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.con": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com", "outlook.con": "outlook.com",
};

export function emailProblem(value: string): string | null {
  const s = value.trim();
  if (!s) return "Enter your email address, so we can send you a code.";
  if (/\s/.test(s)) return "Remove the space. Email addresses don't have spaces in them.";
  const ats = (s.match(/@/g) ?? []).length;
  if (ats === 0) return "Your email needs an @, like chioma@gmail.com.";
  if (ats > 1) return "Your email has more than one @. Keep just one.";
  const [user, domain] = s.split("@");
  if (!user) return "Add the part before the @, like chioma@gmail.com.";
  if (!domain) return `Add the part after the @, like ${user}@gmail.com.`;
  if (!domain.includes(".")) return `Add the ending after "${domain}", like ${user}@${domain}.com.`;
  if (domain.startsWith(".") || domain.endsWith(".") || s.includes("..")) return "There's a dot in the wrong place. Check the part after the @.";
  const ending = domain.split(".").pop() ?? "";
  if (ending.length < 2) return `".${ending}" is too short for an email ending. Check the part after the last dot.`;
  if (/[^a-z0-9.@_+'-]/i.test(s)) return "Your email has a character email addresses can't use. Check for commas or brackets.";
  const fix = EMAIL_TYPOS[domain.toLowerCase()];
  if (fix) return `Did you mean ${user}@${fix}? Check the spelling after the @.`;
  return null;
}

export function nameProblem(value: string): string | null {
  const s = value.trim().replace(/\s+/g, " ");
  if (!s) return "Enter your full name, as it is on your bank account.";
  if (s.split(" ").length < 2) return "Add your surname too. Use both names, as they are on your bank account.";
  if (/\d/.test(s)) return "Names don't have numbers in them. Use the name on your bank account.";
  return null;
}

/** An exact count of digits: NIN and BVN (11), NUBAN account numbers (10), IMEI (15). */
export function digitsProblem(value: string, count: number, what: string): string | null {
  const s = value.replace(/\s/g, "");
  if (!s) return `Enter your ${what}. It has ${count} digits.`;
  if (/\D/.test(s)) return `Use numbers only. Your ${what} has ${count} digits and no letters or symbols.`;
  if (s.length < count) return `Your ${what} has ${count} digits. You've typed ${s.length}, so ${count - s.length} ${count - s.length === 1 ? "is" : "are"} missing.`;
  if (s.length > count) return `Your ${what} has ${count} digits. You've typed ${s.length}, which is ${s.length - count} too many.`;
  return null;
}
