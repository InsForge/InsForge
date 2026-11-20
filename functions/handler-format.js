/**
 * Handler format normalization (Cloud / self-hosted parity — issue #1906)
 *
 * On Cloud, function code is deployed as a real ES module (see
 * `deno-subhosting.provider.ts`'s `transformUserCode`), so the documented
 * handler format everywhere in the public docs is:
 *
 *   import { createClient } from 'npm:@insforge/sdk';
 *   export default async function(req: Request): Promise<Response> { ... }
 *
 * Locally, `worker-template.js` runs the code inside `new Function(...)` —
 * a plain script scope chosen so the worker never needs network/file import
 * permissions at request time (secrets and the SDK are injected as call
 * arguments instead, see the worker template's security notes). `import`
 * and `export` are syntax errors in that scope, and so are the TypeScript
 * type annotations the documented signature uses (`new Function` runs
 * through V8 directly — nothing transpiles it) — so only the legacy,
 * untyped `module.exports = ...` form used to work there, silently breaking
 * every function written in the documented `export default` format as soon
 * as it left Cloud.
 *
 * This file is plain, Deno/Node-independent JavaScript (no import/export
 * statements of its own) so it can be:
 *   - concatenated ahead of `worker-template.js` by `server.ts` before the
 *     combined source is handed to `new Function`/`Worker`, and
 *   - loaded directly in unit tests via `vm` without any Deno globals.
 * It stays plain JS (matching worker-template.js's own existing precedent,
 * for the same reason — both are read as-is at runtime with no build step)
 * rather than TypeScript compiled ahead of time.
 *
 * Scope: this targets the one documented handler shape (a top-level
 * `export default` function/arrow expression, optionally typed, optionally
 * importing the injected SDK/base64 bindings) — not arbitrary TypeScript or
 * ESM. Anything outside that shape is left untouched, which reproduces
 * today's plain syntax error rather than silently miscompiling it.
 *
 * Regex-based detection alone would misfire on text that merely *looks*
 * like code inside a string, template literal, or comment (e.g. a handler
 * whose body contains the literal text "module.exports =" in a log
 * message). `maskNonCode` blanks out that content — preserving length and
 * newlines — so every pattern below is matched against the masked source to
 * find real positions, while every rewrite still slices/reads the original,
 * unmasked `code` at those positions.
 */

/**
 * Replaces the contents of string literals ('...', "...", `...`) and
 * comments (// and /* *\/) with spaces, preserving length and newlines, so
 * character offsets stay valid against the original source. Not a full
 * tokenizer — doesn't need to be, since callers only use it to find *where*
 * a pattern lexically starts, never to execute the masked text itself.
 */
// Characters after which a `/` is a value already produced (an identifier,
// number, or a closing bracket) rather than the start of a regex literal —
// e.g. `a / b` is division, `(x) / 2` is division. After anything else
// (`(`, `,`, `=`, `:`, `return`, the start of the source, ...) a `/` starts
// a regex literal — e.g. `return /foo/`, `x = /foo/`. This is the same
// heuristic lightweight JS tokenizers use; it isn't a full parser, but a
// statement can't otherwise begin with a bare `/`.
const VALUE_END_CHAR_PATTERN = /[A-Za-z0-9_$)\]]/;

// A word immediately before `/` that ends in a "value-like" character
// doesn't always mean a value was produced — these keywords all precede an
// operand, not end one (`return /foo/`, `typeof /foo/`), so `/` right after
// one of them still starts a regex literal despite ending in a letter.
const REGEX_PERMITTING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

function isRegexLiteralStart(lastSignificantChar, lastWord, lastWordIsProperty) {
  if (lastSignificantChar === '') {
    return true;
  }
  if (VALUE_END_CHAR_PATTERN.test(lastSignificantChar)) {
    // A property named after one of these keywords (`obj.delete`, `obj.in`)
    // is still a value, not the keyword itself — only an unqualified use
    // permits a following regex.
    return !lastWordIsProperty && REGEX_PERMITTING_KEYWORDS.has(lastWord);
  }
  return true;
}

const WORD_CHAR_PATTERN = /[A-Za-z0-9_$]/;

function maskNonCode(code) {
  let result = '';
  let i = 0;
  let lastSignificantChar = '';
  let lastWord = '';
  let lastWordIsProperty = false;
  let currentWord = '';
  let currentWordIsProperty = false;
  while (i < code.length) {
    const char = code[i];
    const twoChars = code.slice(i, i + 2);

    // Commit the word in progress the moment it ends — including right
    // here, before `lastWord` is read below — so `a/b` (no separator
    // between the identifier and the `/`) sees the word that just ended
    // instead of a stale one from further back.
    if (!WORD_CHAR_PATTERN.test(char) && currentWord) {
      lastWord = currentWord;
      lastWordIsProperty = currentWordIsProperty;
      currentWord = '';
    }

    // `twoChars !== '//' && twoChars !== '/*'`: an empty regex literal
    // (`//`) isn't valid JS grammar (a regex body needs at least one
    // character), so `//` is always a comment — never division-then-regex
    // or an empty regex that happens to look like one — and must be
    // recognized before regex detection gets a chance to misread it (or
    // `/*`'s opening slash) as a literal.
    if (
      char === '/' &&
      twoChars !== '//' &&
      twoChars !== '/*' &&
      isRegexLiteralStart(lastSignificantChar, lastWord, lastWordIsProperty)
    ) {
      // A regex literal. Its contents are irrelevant to every pattern below,
      // so it's fully blanked (delimiters included) — unlike a string, whose
      // quote characters are preserved (see below), nothing needs to see a
      // literal `/` here. Scanned first, before the comment checks: a
      // character class inside a regex can itself contain `/` or quote
      // characters (`/['"]/`, `/[//]/`) that would otherwise be misread as
      // starting a string or a `//` line comment.
      let j = i + 1;
      let inClass = false;
      let terminated = false;
      while (j < code.length && code[j] !== '\n') {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === '[') {
          inClass = true;
        } else if (code[j] === ']') {
          inClass = false;
        } else if (code[j] === '/' && !inClass) {
          j += 1;
          terminated = true;
          break;
        }
        j += 1;
      }
      if (terminated) {
        while (j < code.length && /[a-zA-Z]/.test(code[j])) {
          j += 1; // trailing flags (g, i, m, ...)
        }
        result += code.slice(i, j).replace(/[^\n]/g, ' ');
        lastSignificantChar = ')'; // a regex literal is itself a value
        lastWord = ''; // ...not a keyword, so a following `/` means division
        lastWordIsProperty = false;
        i = j;
        continue;
      }
      // No closing `/` before end of line: not actually a regex literal
      // (or malformed code either way) — fall through and treat `/` as an
      // ordinary character rather than misidentifying a division operator
      // as an unterminated regex and masking the rest of the line.
    }

    if (twoChars === '//') {
      let j = i;
      while (j < code.length && code[j] !== '\n') {
        j += 1;
      }
      result += code.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }

    if (twoChars === '/*') {
      let j = i + 2;
      while (j < code.length - 1 && code.slice(j, j + 2) !== '*/') {
        j += 1;
      }
      j = Math.min(j + 2, code.length);
      result += code.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      // Preserve the quote characters themselves — only blank the content
      // between them — so a pattern that checks for a real quote (e.g. the
      // `from '...'` clause of an import) still matches the masked text.
      const quote = char;
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        j += code[j] === '\\' ? 2 : 1;
      }
      const closed = j < code.length;
      const innerEnd = Math.min(j, code.length);
      const inner = code.slice(i + 1, innerEnd).replace(/[^\n]/g, ' ');
      result += quote + inner + (closed ? quote : '');
      i = closed ? j + 1 : innerEnd;
      lastSignificantChar = ')'; // a string literal is itself a value
      lastWord = ''; // ...not a keyword, so a following `/` means division
      lastWordIsProperty = false;
      continue;
    }

    result += char;
    if (WORD_CHAR_PATTERN.test(char)) {
      if (!currentWord) {
        currentWordIsProperty = lastSignificantChar === '.';
      }
      currentWord += char;
    }
    // (the non-word case is already handled at the top of the loop, before
    // `lastWord` is read for this same character)
    if (!/\s/.test(char)) {
      lastSignificantChar = char;
    }
    i += 1;
  }
  return result;
}

// Legacy CommonJS handlers are detected by an actual top-level assignment
// (matched against the masked source — see file header), not a bare
// substring search that a comment or template literal could trigger.
const LEGACY_ASSIGNMENT_PATTERN = /^[ \t]*module\.exports\s*=/m;

// Named bindings the worker wrapper injects as call arguments, keyed by the
// import specifier that provides them on Cloud. An import naming anything
// else from these sources can't be resolved locally and is left alone so it
// still surfaces as a clear syntax/reference error, rather than being
// partially rewritten into something subtly broken.
const INJECTABLE_BINDINGS_BY_SOURCE = [
  { source: 'npm:@insforge/sdk', names: ['createClient'] },
  {
    // Version-qualified URL — match the module, not one exact version string.
    sourcePattern: /^https:\/\/deno\.land\/std[^'"]*\/encoding\/base64\.ts$/,
    names: ['encodeBase64', 'decodeBase64'],
  },
];

const IMPORT_STATEMENT_PATTERN =
  /^[ \t]*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*)\2\s*;?[ \t]*\r?\n?/gm;

/**
 * Rewrites the known-injectable imports in `code`:
 *  - a specifier matching its injected name exactly (`createClient`) is
 *    simply dropped — the wrapper already provides that identifier.
 *  - an aliased specifier (`createClient as makeClient`) is replaced with
 *    `const makeClient = createClient;` so the alias still resolves.
 *  - an import naming anything not in the injected set for that source, or
 *    from any other source, is left completely untouched.
 */
function resolveKnownImports(code) {
  const masked = maskNonCode(code);
  // 'd' adds match.indices to locate each match precisely. The specifier
  // list is read from the *masked* text — a comment inside the braces
  // (`{ createClient /* the sdk client */ }`) would otherwise end up as
  // part of a "specifier" and fail the known-binding check, leaving the
  // whole import untouched even though it's a plain, resolvable one. The
  // source string, in contrast, is read from the original `code`: it's a
  // quoted string, which can't itself contain a code comment.
  const pattern = new RegExp(IMPORT_STATEMENT_PATTERN.source, IMPORT_STATEMENT_PATTERN.flags + 'd');

  let result = '';
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(masked))) {
    const fullMatch = match[0];
    const [specifierStart, specifierEnd] = match.indices[1];
    const [sourceStart, sourceEnd] = match.indices[3];
    const specifierList = masked.slice(specifierStart, specifierEnd);
    const source = code.slice(sourceStart, sourceEnd);
    result += code.slice(lastIndex, match.index);

    const known = INJECTABLE_BINDINGS_BY_SOURCE.find((entry) =>
      entry.source ? entry.source === source : entry.sourcePattern.test(source)
    );

    if (!known) {
      result += code.slice(match.index, match.index + fullMatch.length);
    } else {
      const specifiers = specifierList
        .split(',')
        .map((specifier) => specifier.trim())
        .filter(Boolean);

      const aliasDeclarations = [];
      let unresolvable = false;
      for (const specifier of specifiers) {
        const aliasMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(specifier);
        const importedName = aliasMatch ? aliasMatch[1] : specifier;
        const localName = aliasMatch ? aliasMatch[2] : specifier;

        if (!known.names.includes(importedName)) {
          // Not something the wrapper injects — bail on the whole statement
          // rather than guessing at a partial rewrite.
          unresolvable = true;
          break;
        }
        if (localName !== importedName) {
          aliasDeclarations.push(`const ${localName} = ${importedName};`);
        }
      }

      result += unresolvable
        ? code.slice(match.index, match.index + fullMatch.length)
        : aliasDeclarations.length > 0
          ? aliasDeclarations.join('\n') + '\n'
          : '';
    }

    lastIndex = match.index + fullMatch.length;
  }
  result += code.slice(lastIndex);
  return result;
}

/**
 * Strips TypeScript type annotations from a handler's parameter list.
 *
 * Tracks three states per parameter — `name` (before any `:`), `type`
 * (consuming the annotation), `default` (after the `=` of a default value)
 * — rather than a single depth-only pass, so that:
 *  - a generic type's internal comma (`opts: Record<string, string>`) isn't
 *    mistaken for a parameter separator (bracket depth),
 *  - a function-type arrow inside a type (`cb: () => void`) isn't mistaken
 *    for the start of a default value (only `=` NOT followed by `>` ends
 *    type mode), and
 *  - a `:` inside a default value's own expression (a ternary,
 *    `opts: Options = cond ? a : b`) is never reinterpreted as the start of
 *    another type annotation — once a parameter reaches `default` mode, a
 *    `:` is just a character in that expression.
 *
 * Operates on `originalSource` for the text it keeps/drops, but makes every
 * control-flow decision (bracket depth, which state a `:`/`=`/`,` triggers)
 * against `maskedSource` (see `maskNonCode`) so a colon or brace inside a
 * default value's own string literal can't desynchronize bracket depth or
 * be mistaken for a type delimiter.
 */
function stripParamTypeAnnotations(originalSource, maskedSource) {
  let result = '';
  let depth = 0;
  let mode = 'name'; // 'name' | 'type' | 'default'

  for (let i = 0; i < maskedSource.length; i += 1) {
    const char = maskedSource[i];
    const keep = () => {
      result += originalSource[i];
    };

    if ('([{'.includes(char)) {
      depth += 1;
      if (mode !== 'type') {
        keep();
      }
      continue;
    }
    if (')]}'.includes(char)) {
      depth = Math.max(0, depth - 1);
      if (mode !== 'type') {
        keep();
      }
      continue;
    }
    // `<`/`>` only mean generic nesting while inside a type annotation.
    // Outside one — a default value's own expression — they're relational
    // operators (`opts = x < 10 ? a : b`), and counting them as brackets
    // there would desync depth against an unmatched `<` with no `>`,
    // leaving a *later* parameter's real type annotation unstripped.
    if (mode === 'type' && char === '<') {
      depth += 1;
      continue;
    }
    if (mode === 'type' && char === '>' && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0 && mode === 'name' && char === '?' && /^\s*:/.test(maskedSource.slice(i + 1))) {
      // TypeScript optional-parameter marker immediately before the type
      // annotation (`req?: Request`) — has no plain-JS analogue, drop it.
      continue;
    }
    if (depth === 0 && mode === 'name' && char === ':') {
      mode = 'type';
      continue;
    }
    if (depth === 0 && mode === 'name' && char === '=') {
      // A default value with no type annotation at all (`a = x < y ? z : q`).
      // Without this, `mode` would stay 'name' — the only other path into
      // 'default' requires having seen a ':' first — so a ternary's own
      // ':' further down would be misread as starting a type annotation.
      mode = 'default';
      keep();
      continue;
    }
    if (depth === 0 && mode === 'type' && char === '=' && maskedSource[i + 1] === '>') {
      // Function-type arrow (`() => void`) — part of the type, not a
      // default-value marker. Stays in type mode; both chars are dropped.
      i += 1;
      continue;
    }
    if (depth === 0 && mode === 'type' && char === '=') {
      mode = 'default';
      keep();
      continue;
    }
    if (depth === 0 && (mode === 'type' || mode === 'default') && char === ',') {
      mode = 'name';
      keep();
      continue;
    }
    if (mode !== 'type') {
      keep();
    }
  }

  return result;
}

/**
 * Strips a handler's return-type annotation — the `: T` between the
 * parameter list's `)` and the function body's `{` or an arrow's `=>` — by
 * scanning bracket depth (against the masked source, for the same reason as
 * `stripParamTypeAnnotations`) rather than stopping at the first `{`, so a
 * return type containing its own object-literal type
 * (`Promise<{ status: number }>`) isn't truncated mid-type.
 */
function stripReturnType(originalAfterParams, maskedAfterParams) {
  // `\s`, not `[ \t]`: the colon may be on its own line after the closing
  // paren (an unusual but valid line-break before `: ReturnType`).
  const colonMatch = /^\s*:/.exec(maskedAfterParams);
  if (!colonMatch) {
    return originalAfterParams;
  }

  let i = colonMatch[0].length;
  let depth = 0;
  while (i < maskedAfterParams.length) {
    const char = maskedAfterParams[i];
    if (depth === 0 && (char === '{' || (char === '=' && maskedAfterParams[i + 1] === '>'))) {
      break;
    }
    if ('([{<'.includes(char)) {
      depth += 1;
    } else if (')]}>'.includes(char)) {
      depth = Math.max(0, depth - 1);
    }
    i += 1;
  }

  return originalAfterParams.slice(0, colonMatch[0].length - 1) + originalAfterParams.slice(i);
}

/**
 * Strips type annotations from a handler's signature only — its parameter
 * list and return type — leaving the function body completely untouched.
 * Operates on `code` starting at `fromIndex` (right after the
 * `module.exports = ` this module just wrote) so it never has to reason
 * about the body, which may contain colons of its own (object literals,
 * ternaries, etc.) that are not type annotations.
 *
 * If the text at `fromIndex` isn't a recognizable function/arrow signature,
 * or its parameter list is unbalanced, `code` is returned unchanged rather
 * than guessed at.
 */
function stripHandlerSignatureTypes(code, fromIndex) {
  const rest = code.slice(fromIndex);
  const maskedRest = maskNonCode(rest);

  const headerMatch = /^(\s*)(async\s+)?(function\s*[A-Za-z_$][\w$]*\s*|function\s*)?\(/.exec(
    maskedRest
  );
  if (!headerMatch) {
    return code;
  }

  const parenStart = headerMatch[0].length - 1;
  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < maskedRest.length; i += 1) {
    const char = maskedRest[i];
    if ('([{'.includes(char)) {
      depth += 1;
    } else if (')]}'.includes(char)) {
      depth -= 1;
      if (depth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  if (parenEnd === -1) {
    return code;
  }

  const strippedParams = stripParamTypeAnnotations(
    rest.slice(parenStart + 1, parenEnd),
    maskedRest.slice(parenStart + 1, parenEnd)
  );

  const afterParams = stripReturnType(rest.slice(parenEnd + 1), maskedRest.slice(parenEnd + 1));

  return (
    code.slice(0, fromIndex) + rest.slice(0, parenStart + 1) + strippedParams + ')' + afterParams
  );
}

function normalizeHandlerFormat(code) {
  // Checked first, and only as the deciding factor when there's no
  // `export default` at all: a genuine `export default` handler could
  // still contain a line starting with `module.exports =` somewhere in its
  // *body* (unusual, but not impossible — e.g. mixed CommonJS/ESM idioms),
  // and that must not short-circuit the rewrite this function exists to do.
  const hasExportDefault = /(^|\n)([ \t]*)export\s+default\s+/.test(maskNonCode(code));
  if (!hasExportDefault && LEGACY_ASSIGNMENT_PATTERN.test(maskNonCode(code))) {
    return code;
  }

  let normalized = resolveKnownImports(code);

  const exportDefaultMatch = /(^|\n)([ \t]*)export\s+default\s+/.exec(maskNonCode(normalized));
  if (!exportDefaultMatch) {
    return normalized;
  }

  const assignment = `${exportDefaultMatch[1]}${exportDefaultMatch[2]}module.exports = `;
  const handlerStart = exportDefaultMatch.index + exportDefaultMatch[0].length;
  normalized =
    normalized.slice(0, exportDefaultMatch.index) + assignment + normalized.slice(handlerStart);

  return stripHandlerSignatureTypes(normalized, exportDefaultMatch.index + assignment.length);
}
