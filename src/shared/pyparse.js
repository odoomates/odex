/* odeX expression parser.
 *
 * Turns a Python-flavoured ORM expression into the parameters of an Odoo
 * `call_kw` request:
 *
 *   res.partner.search_read([('is_company', '=', True)], ['name'], limit=5)
 *   env['res.partner'].browse([1, 2]).with_context(lang='fr_FR').read(['name'])
 *
 * -> { model, method, ids, context, args, kwargs }
 *
 * Values are Python literals (str, int, float, True/False/None, list, tuple,
 * dict). JSON literals (true/false/null) are accepted too. Identifiers are
 * looked up in `vars` (e.g. `uid`, `_` for the previous result).
 */
(function (root) {
  "use strict";

  // Methods that only change the recordset/environment; they never hit the server on their own.
  const MODIFIERS = new Set(["browse", "with_context", "with_user", "with_company", "sudo"]);

  class ParseError extends Error {
    constructor(message, pos) {
      super(message);
      this.name = "ParseError";
      this.pos = pos;
    }
  }

  const PUNCT = "()[]{},:.=";
  const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", 0: "\0", "\\": "\\", "'": "'", '"': '"', "\n": "" };

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
      const start = i;
      if (/[A-Za-z_]/.test(c)) {
        while (i < src.length && /\w/.test(src[i])) i++;
        tokens.push({ t: "ident", v: src.slice(start, i), pos: start });
      } else if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] || ""))) {
        const m = /^(?:0[xX][\da-fA-F_]+|(?:\d[\d_]*)?(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\.?)/.exec(src.slice(i));
        let text = m[0];
        // "1." followed by an identifier is a method call on an int, not a float: browse(1).read is not
        // affected (")" precedes the dot) but keep "1.read" sane anyway.
        if (text.endsWith(".") && /[A-Za-z_]/.test(src[i + text.length] || "")) text = text.slice(0, -1);
        i += text.length;
        const clean = text.replace(/_/g, "");
        const v = /^0[xX]/.test(clean) ? parseInt(clean, 16) : Number(clean);
        if (Number.isNaN(v)) throw new ParseError(`Invalid number "${text}"`, start);
        tokens.push({ t: "num", v, pos: start });
      } else if (c === "'" || c === '"') {
        const triple = src.startsWith(c.repeat(3), i);
        const quote = triple ? c.repeat(3) : c;
        i += quote.length;
        let out = "";
        for (;;) {
          if (i >= src.length) throw new ParseError("Unterminated string", start);
          if (src.startsWith(quote, i)) { i += quote.length; break; }
          const ch = src[i];
          if (ch === "\n" && !triple) throw new ParseError("Unterminated string", start);
          if (ch === "\\") {
            const n = src[i + 1];
            if (n === "u" && /^[\da-fA-F]{4}$/.test(src.substr(i + 2, 4))) {
              out += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16));
              i += 6;
            } else if (n in ESCAPES) {
              out += ESCAPES[n];
              i += 2;
            } else {
              out += ch;
              i += 1;
            }
            continue;
          }
          out += ch;
          i++;
        }
        // Python concatenates adjacent string literals.
        const prev = tokens[tokens.length - 1];
        if (prev && prev.t === "str" && prev.end === start - countSpaceBack(src, start)) prev.v += out;
        else tokens.push({ t: "str", v: out, pos: start, end: i });
        tokens[tokens.length - 1].end = i;
      } else if (c === "-" || c === "+") {
        tokens.push({ t: "op", v: c, pos: start });
        i++;
      } else if (PUNCT.includes(c)) {
        tokens.push({ t: c, v: c, pos: start });
        i++;
      } else {
        throw new ParseError(`Unexpected character "${c}"`, start);
      }
    }
    tokens.push({ t: "eof", v: "", pos: src.length });
    return tokens;
  }

  function countSpaceBack(src, pos) {
    let n = 0;
    while (pos - n - 1 >= 0 && /\s/.test(src[pos - n - 1])) n++;
    return n;
  }

  class Parser {
    constructor(src, vars) {
      this.src = src;
      this.tokens = tokenize(src);
      this.i = 0;
      this.vars = vars || {};
    }

    peek(o = 0) { return this.tokens[this.i + o]; }
    next() { return this.tokens[this.i++]; }
    is(t, v) {
      const tok = this.peek();
      return tok.t === t && (v === undefined || tok.v === v);
    }
    accept(t, v) {
      if (this.is(t, v)) return this.next();
      return null;
    }
    expect(t, what) {
      const tok = this.peek();
      if (tok.t !== t) throw new ParseError(`Expected ${what || `"${t}"`} but found ${describe(tok)}`, tok.pos);
      return this.next();
    }

    // ---- command -------------------------------------------------------------
    command() {
      const model = this.model();
      const cmd = { model, method: null, ids: null, context: {}, args: [], kwargs: {}, chain: [] };
      while (this.accept(".")) {
        const nameTok = this.expect("ident", "a method name");
        const name = nameTok.v;
        const call = this.is("(") ? this.callArgs() : { args: [], kwargs: {} };
        cmd.chain.push(name);
        if (MODIFIERS.has(name)) {
          if (cmd.method) throw new ParseError(`"${name}" must come before "${cmd.method}"`, nameTok.pos);
          this.applyModifier(cmd, name, call, nameTok.pos);
        } else {
          if (cmd.method) {
            throw new ParseError(
              `Only one ORM call per run: "${cmd.method}" is already the method, chaining "${name}" isn't supported`,
              nameTok.pos,
            );
          }
          if (name.startsWith("_")) throw new ParseError(`"${name}" is private and can't be called over RPC`, nameTok.pos);
          cmd.method = name;
          cmd.args = call.args;
          cmd.kwargs = call.kwargs;
        }
      }
      const tok = this.peek();
      if (tok.t !== "eof") throw new ParseError(`Unexpected ${describe(tok)}`, tok.pos);
      if (!cmd.method) throw new ParseError(`No method to call on "${model}" (try ${model}.search_read([], ['display_name'], limit=10))`, this.src.length);
      return cmd;
    }

    model() {
      // env['res.partner'] / self.env["res.partner"] / env.ref? (not supported)
      const save = this.i;
      if (this.is("ident", "self") && this.peek(1).t === "." && this.peek(2).t === "ident" && this.peek(2).v === "env") {
        this.i += 2;
      }
      if (this.is("ident", "env") && this.peek(1).t === "[") {
        this.next();
        this.next();
        const name = this.expect("str", "a model name string").v;
        this.expect("]");
        if (!name) throw new ParseError("Empty model name", this.peek().pos);
        return name;
      }
      this.i = save;
      // Dotted model name: every identifier up to (not including) the first one that is a call or a modifier.
      const first = this.expect("ident", "a model name (e.g. res.partner)");
      const parts = [first.v];
      while (this.is(".") && this.peek(1).t === "ident") {
        const after = this.peek(2);
        const name = this.peek(1).v;
        if (after.t === "(" || MODIFIERS.has(name)) break;
        // `res.partner.search_count` without parentheses: the last identifier is the method.
        if (after.t === "eof" && (parts.length >= 2 || looksLikeMethod(name))) break;
        this.next();
        parts.push(this.next().v);
      }
      if (parts.length === 1 && !this.is(".")) {
        throw new ParseError(`Expected a method call, e.g. ${first.v}.search_read([])`, this.peek().pos);
      }
      return parts.join(".");
    }

    applyModifier(cmd, name, call, pos) {
      if (name === "browse") {
        if (call.args.length !== 1 || Object.keys(call.kwargs).length) {
          throw new ParseError("browse() takes one argument: an id or a list of ids", pos);
        }
        cmd.ids = toIds(call.args[0], pos);
      } else if (name === "with_context") {
        if (call.args.length > 1) throw new ParseError("with_context() takes at most one positional dict", pos);
        const base = call.args.length ? call.args[0] : {};
        if (!isPlainObject(base)) throw new ParseError("with_context() expects a dict", pos);
        Object.assign(cmd.context, base, call.kwargs);
      } else if (name === "with_company") {
        const [company] = call.args;
        const id = Array.isArray(company) ? company[0] : company;
        if (!Number.isInteger(id)) throw new ParseError("with_company() expects a company id", pos);
        cmd.context.allowed_company_ids = [id, ...(cmd.context.allowed_company_ids || []).filter((c) => c !== id)];
      } else {
        throw new ParseError(`${name}() can't be done over RPC: calls run as the logged-in user`, pos);
      }
    }

    callArgs() {
      this.expect("(");
      const args = [];
      const kwargs = {};
      while (!this.is(")")) {
        if (this.is("ident") && this.peek(1).t === "=") {
          const key = this.next().v;
          this.next();
          if (key in kwargs) throw new ParseError(`Keyword argument "${key}" repeated`, this.peek().pos);
          kwargs[key] = this.value();
        } else {
          if (Object.keys(kwargs).length) throw new ParseError("Positional argument follows keyword argument", this.peek().pos);
          args.push(this.value());
        }
        if (!this.accept(",")) break;
      }
      this.expect(")", '")"');
      return { args, kwargs };
    }

    // ---- values --------------------------------------------------------------
    value() {
      const tok = this.next();
      switch (tok.t) {
        case "str": return tok.v;
        case "num": return tok.v;
        case "op": {
          const v = this.value();
          if (typeof v !== "number") throw new ParseError(`"${tok.v}" must be followed by a number`, tok.pos);
          return tok.v === "-" ? -v : v;
        }
        case "[": return this.seq("]");
        case "(": {
          // tuple or parenthesised value
          if (this.accept(")")) return [];
          const first = this.value();
          if (this.accept(")")) return first;
          this.expect(",", '"," or ")"');
          if (this.accept(")")) return [first];
          return [first, ...this.seq(")")];
        }
        case "{": return this.dict();
        case "ident": return this.name(tok);
        default:
          throw new ParseError(`Expected a value but found ${describe(tok)}`, tok.pos);
      }
    }

    seq(close) {
      const out = [];
      while (!this.is(close)) {
        out.push(this.value());
        if (!this.accept(",")) break;
      }
      this.expect(close, `"${close}"`);
      return out;
    }

    dict() {
      const out = {};
      while (!this.is("}")) {
        const keyTok = this.peek();
        const key = this.value();
        if (key !== null && typeof key === "object") throw new ParseError("Dict keys must be strings or numbers", keyTok.pos);
        this.expect(":", '":"');
        out[String(key)] = this.value();
        if (!this.accept(",")) break;
      }
      this.expect("}", '"}"');
      return out;
    }

    name(tok) {
      switch (tok.v) {
        case "True": case "true": return true;
        case "False": case "false": return false;
        case "None": case "null": return null;
        case "dict": {
          // dict(a=1, b=2)
          if (!this.is("(")) break;
          const call = this.callArgs();
          if (call.args.length > 1) throw new ParseError("dict() takes keyword arguments", tok.pos);
          return Object.assign({}, call.args[0] || {}, call.kwargs);
        }
        case "Command": return this.command_(tok);
        default:
          if (Object.prototype.hasOwnProperty.call(this.vars, tok.v)) return clone(this.vars[tok.v]);
      }
      throw new ParseError(`Unknown name "${tok.v}"${hintFor(tok.v, this.vars)}`, tok.pos);
    }

    // Command.create({...}) / Command.set([ids]) ... -> x2many command triplets
    command_(tok) {
      this.expect(".");
      const nameTok = this.expect("ident", "a Command name");
      const call = this.callArgs();
      const a = call.args;
      switch (nameTok.v) {
        case "create": return [0, 0, a[0] || {}];
        case "update": return [1, a[0], a[1] || {}];
        case "delete": return [2, a[0], 0];
        case "unlink": return [3, a[0], 0];
        case "link": return [4, a[0], 0];
        case "clear": return [5, 0, 0];
        case "set": return [6, 0, a[0] || []];
        default: throw new ParseError(`Unknown Command.${nameTok.v}`, nameTok.pos);
      }
    }
  }

  function looksLikeMethod(name) {
    return /^(search|read|write|create|unlink|copy|name_|fields_|default_|action_|button_|get_|check_|has_|web_|exists|browse)/.test(name);
  }

  function hintFor(name, vars) {
    const names = Object.keys(vars);
    return names.length ? ` (available: True, False, None, ${names.join(", ")})` : " (use True, False or None)";
  }

  function describe(tok) {
    if (tok.t === "eof") return "end of input";
    if (tok.t === "str") return `string ${JSON.stringify(tok.v)}`;
    return `"${tok.v}"`;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function clone(v) {
    return v === undefined ? null : JSON.parse(JSON.stringify(v));
  }

  function toIds(value, pos) {
    const list = Array.isArray(value) ? value : [value];
    const ids = list.map((v) => {
      // Accept many2one pairs [id, name] and records {id: ...} from previous results.
      if (Array.isArray(v) && Number.isInteger(v[0])) return v[0];
      if (isPlainObject(v) && Number.isInteger(v.id)) return v.id;
      return v;
    });
    if (!ids.every((v) => Number.isInteger(v))) throw new ParseError("browse() expects integer ids", pos);
    return ids;
  }

  function parseCommand(src, vars) {
    if (!src || !src.trim()) throw new ParseError("Nothing to run", 0);
    return new Parser(src, vars).command();
  }

  function parseValue(src, vars) {
    const p = new Parser(src, vars);
    const v = p.value();
    if (!p.is("eof")) throw new ParseError(`Unexpected ${describe(p.peek())}`, p.peek().pos);
    return v;
  }

  // ---- Python repr of a JSON value --------------------------------------------
  function pyRepr(value, indent = 0, step = 4) {
    const pad = " ".repeat(indent + step);
    const end = " ".repeat(indent);
    if (value === null || value === undefined) return "None";
    if (value === true) return "True";
    if (value === false) return "False";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return pyStr(value);
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      const items = value.map((v) => pyRepr(v, indent + step, step));
      const flat = `[${items.join(", ")}]`;
      if (flat.length <= 80 && !flat.includes("\n")) return flat;
      return `[\n${items.map((s) => pad + s).join(",\n")},\n${end}]`;
    }
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    const items = keys.map((k) => `${pyStr(k)}: ${pyRepr(value[k], indent + step, step)}`);
    const flat = `{${items.join(", ")}}`;
    if (flat.length <= 80 && !flat.includes("\n")) return flat;
    return `{\n${items.map((s) => pad + s).join(",\n")},\n${end}}`;
  }

  function pyStr(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = q;
    for (const ch of s) {
      if (ch === "\\") out += "\\\\";
      else if (ch === q) out += "\\" + q;
      else if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\r") out += "\\r";
      else out += ch;
    }
    return out + q;
  }

  // Render a parsed command back as canonical text (used for history labels and confirmations).
  function formatCommand(cmd) {
    let s = cmd.model;
    if (cmd.ids) s += `.browse(${pyRepr(cmd.ids.length === 1 ? cmd.ids[0] : cmd.ids)})`;
    if (Object.keys(cmd.context).length) s += `.with_context(${pyRepr(cmd.context)})`;
    const parts = cmd.args.map((a) => pyRepr(a));
    for (const [k, v] of Object.entries(cmd.kwargs)) parts.push(`${k}=${pyRepr(v)}`);
    return `${s}.${cmd.method}(${parts.join(", ")})`;
  }

  root.OdexParse = { parseCommand, parseValue, pyRepr, formatCommand, tokenize, ParseError, MODIFIERS };
})(typeof globalThis !== "undefined" ? globalThis : this);
