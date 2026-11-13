// Checks that every English UI string on the patient side has a Hindi translation.
//
//   node scripts/check-i18n.mjs          fail on gaps in the patient portal (CI)
//   node scripts/check-i18n.mjs --all    also list gaps in the staff portals
//   node scripts/check-i18n.mjs --verbose  also list t(variable) calls
//
// It reads every t("...") literal in the scanned files, compares them with the
// keys of src/lib/i18n.hi.ts, and checks that each Hindi value keeps the same
// {placeholders}. Calls like t(someVariable) cannot be checked statically, so
// they are listed for review: mark the strings they show with msg("...")
// where they are defined, and this script checks those too.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");

// Everything a patient can see: their portal, login, legal pages, and the
// shared components and helpers those screens render.
const PATIENT_SCOPE = ["features/patient", "features/auth", "features/legal", "features/display", "components", "lib", "app", "App.tsx"];
const STAFF_SCOPE = ["features/doctor", "features/associate", "features/admin"];

function files(rel) {
  const path = join(src, rel);
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(rel, name)));
}

// t("...") where a string is shown, and msg("...") where one is stored in a constant.
const CALL = /\b(?:t|msg)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;
const DYNAMIC = /\bt\(\s*(?!["'`)])([A-Za-z_][\w.?[\]]*)/g;

function scan(scope) {
  const strings = new Map(); // text -> first location
  const dynamic = [];
  for (const file of scope.flatMap(files).filter((f) => /\.(tsx?|mjs)$/.test(f) && !f.endsWith("i18n.hi.ts"))) {
    const code = readFileSync(file, "utf8");
    const rel = relative(root, file);
    for (const m of code.matchAll(CALL)) {
      if (m[1] === "`" && m[2].includes("${")) continue;
      const text = m[2].replace(/\\(["'`\\])/g, "$1");
      const line = code.slice(0, m.index).split("\n").length;
      if (!strings.has(text)) strings.set(text, `${rel}:${line}`);
    }
    for (const m of code.matchAll(DYNAMIC)) {
      dynamic.push(`${rel}:${code.slice(0, m.index).split("\n").length}  t(${m[1]})`);
    }
  }
  return { strings, dynamic };
}

// Load the Hindi dictionary without a TypeScript toolchain: it is a plain object literal.
const hiSource = readFileSync(join(src, "lib/i18n.hi.ts"), "utf8");
const body = hiSource.slice(hiSource.indexOf("{", hiSource.indexOf("HI")) );
const HI = Function(`"use strict"; return (${body.replace(/;\s*$/, "")});`)();

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

function report(label, scope) {
  const { strings, dynamic } = scan(scope);
  const missing = [...strings].filter(([text]) => !(text in HI));
  const mismatched = [...strings].filter(([text]) => text in HI && placeholders(text) !== placeholders(HI[text]));
  console.log(`${label}: ${strings.size} strings, ${missing.length} missing in Hindi, ${mismatched.length} with mismatched {placeholders}`);
  for (const [text, at] of missing) console.log(`  missing  ${at}  ${JSON.stringify(text)}`);
  for (const [text, at] of mismatched) console.log(`  {vars}   ${at}  ${JSON.stringify(text)} -> ${JSON.stringify(HI[text])}`);
  if (dynamic.length && process.argv.includes("--verbose")) {
    console.log(`  ${dynamic.length} dynamic t(...) calls to review by hand:`);
    for (const d of dynamic) console.log(`    ${d}`);
  }
  return missing.length + mismatched.length;
}

const problems = report("Patient portal", PATIENT_SCOPE);
if (process.argv.includes("--all")) report("Staff portals (not enforced)", STAFF_SCOPE);
process.exit(problems > 0 ? 1 : 0);
