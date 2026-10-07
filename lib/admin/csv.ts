/**
 * CSV parsing for the member uploader (RFC 4180, minus the ceremony).
 *
 * Hand-rolled rather than pulled from a package because the shape is fixed —
 * `name,email,...` with quoted commas — and a dependency for eighty lines is
 * worse than the eighty lines. Handles what a spreadsheet actually exports:
 * quoted fields, escaped quotes, CRLF line endings, a BOM.
 */

export interface CsvMember {
  name: string;
  email: string;
  bio?: string;
  age?: number;
  picture?: string;
}

export interface CsvParseResult {
  members: CsvMember[];
  /** rows that could not be used, with the reason each was rejected */
  errors: Array<{ line: number; reason: string }>;
  headers: string[];
}

/** Split one CSV line into fields, honouring double quotes and `""` escapes. */
function splitLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

const HEADER_ALIASES: Record<string, keyof CsvMember> = {
  name: "name",
  full_name: "name",
  fullname: "name",
  email: "email",
  mail: "email",
  e_mail: "email",
  email_address: "email",
  bio: "bio",
  biography: "bio",
  about: "bio",
  age: "age",
  picture: "picture",
  photo: "picture",
  avatar: "picture",
  image: "picture",
};

export function parseMembersCsv(input: string): CsvParseResult {
  const text = input.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const errors: CsvParseResult["errors"] = [];
  if (lines.length === 0) return { members: [], errors: [{ line: 0, reason: "the file is empty" }], headers: [] };

  // "Full Name", "full-name" and "full_name" are the same column to a spreadsheet.
  const headers = splitLine(lines[0]!).map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const mapped = headers.map((h) => HEADER_ALIASES[h] ?? null);
  if (!mapped.includes("email")) {
    return { members: [], errors: [{ line: 1, reason: "no email column found — add one (the header must be `email`)" }], headers };
  }

  const members: CsvMember[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const fields = splitLine(lines[i]!).map((f) => f.trim());
    const row: Record<string, string> = {};
    mapped.forEach((key, index) => {
      if (key) row[key] = fields[index] ?? "";
    });

    const email = row.email ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ line: i + 1, reason: `not a usable email: "${email.slice(0, 60) || "(empty)"}"` });
      continue;
    }
    if (!row.name) {
      errors.push({ line: i + 1, reason: "missing name" });
      continue;
    }
    const age = row.age ? Number.parseInt(row.age, 10) : undefined;
    if (row.age && (age === undefined || Number.isNaN(age) || age < 13 || age > 120)) {
      errors.push({ line: i + 1, reason: `age "${row.age}" is not a number between 13 and 120` });
      continue;
    }
    members.push({
      name: row.name,
      email: email.toLowerCase(),
      bio: row.bio || undefined,
      age,
      picture: row.picture || undefined,
    });
  }
  return { members, errors, headers };
}
