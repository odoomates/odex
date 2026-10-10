import { test, eq, finish } from "./harness.js";

const { parseCommand, parseValue, pyRepr, formatCommand, ParseError } = globalThis.OdexParse;

function throws(fn, pattern) {
    try {
        fn();
    } catch (e) {
        if (!(e instanceof ParseError)) throw new Error(`expected ParseError, got ${e}`);
        if (pattern && !pattern.test(e.message)) throw new Error(`message "${e.message}" doesn't match ${pattern}`);
        return e;
    }
    throw new Error("expected an error");
}

const pick = (c) => ({ model: c.model, method: c.method, ids: c.ids, context: c.context, args: c.args, kwargs: c.kwargs });

test("python literals", () => {
    eq(parseValue("[1, -2, 3.5, 1e3, 0x1f, 1_000]"), [1, -2, 3.5, 1000, 31, 1000]);
    eq(parseValue("(True, False, None, true, null)"), [true, false, null, true, null]);
    eq(parseValue(`{'a': "b", 1: [()], 'c': (1,),}`), { 1: [[]], a: "b", c: [1] });
    eq(parseValue("('x')"), "x", "parenthesised value is not a tuple");
    eq(parseValue(String.raw`'it\'s' "a\nb" 'é'`), "it's" + "a\nb" + "é", "escapes + implicit concatenation");
    eq(parseValue("'''multi\nline'''"), "multi\nline");
    eq(parseValue("dict(a=1, b=[2])"), { a: 1, b: [2] });
    eq(parseValue("[1, 2]  # comment"), [1, 2]);
});

test("dotted model with call", () => {
    eq(pick(parseCommand("res.partner.search_read([('is_company', '=', True)], ['name'], limit=5)")), {
        model: "res.partner", method: "search_read", ids: null, context: {},
        args: [[["is_company", "=", true]], ["name"]], kwargs: { limit: 5 },
    });
});

test("env[...] syntax, self.env too", () => {
    eq(parseCommand("env['sale.order.line'].search_count([])").model, "sale.order.line");
    eq(parseCommand('self.env["res.users"].search([])').model, "res.users");
});

test("browse + with_context + method", () => {
    eq(pick(parseCommand("res.partner.browse([1, 2]).with_context(lang='fr_FR', active_test=False).read(['name'])")), {
        model: "res.partner", method: "read", ids: [1, 2], context: { lang: "fr_FR", active_test: false },
        args: [["name"]], kwargs: {},
    });
    eq(parseCommand("res.partner.browse(7).unlink()").ids, [7]);
    eq(parseCommand("res.partner.with_context({'a': 1}).search([])").context, { a: 1 });
    eq(parseCommand("res.partner.with_company(3).search([])").context, { allowed_company_ids: [3] });
});

test("method without parentheses", () => {
    eq(pick(parseCommand("res.partner.search_count")), {
        model: "res.partner", method: "search_count", ids: null, context: {}, args: [], kwargs: {},
    });
    eq(parseCommand("sale.order.line.fields_get").model, "sale.order.line");
});

test("multi-line expression", () => {
    const c = parseCommand(`res.partner.search_read(
        [('name', 'ilike', 'a')],   # domain
        ['name'],
        limit=3,
    )`);
    eq([c.method, c.args, c.kwargs], ["search_read", [[["name", "ilike", "a"]], ["name"]], { limit: 3 }]);
});

test("variables: uid and _ (previous result)", () => {
    const vars = { uid: 2, _: [{ id: 4, name: "x" }, { id: 9, name: "y" }] };
    eq(parseCommand("res.users.browse(uid).read(['name'])", vars).ids, [2]);
    eq(parseCommand("res.partner.browse(_).read(['name'])", vars).ids, [4, 9]);
    eq(parseCommand("res.partner.browse([[5, 'Name']]).read([])").ids, [5], "many2one pairs");
    throws(() => parseCommand("res.partner.browse(foo).read()"), /Unknown name "foo"/);
});

test("Command helpers", () => {
    eq(parseValue("[Command.create({'name': 'a'}), Command.link(3), Command.set([1, 2]), Command.clear()]"),
        [[0, 0, { name: "a" }], [4, 3, 0], [6, 0, [1, 2]], [5, 0, 0]]);
});

test("errors", () => {
    throws(() => parseCommand(""), /Nothing to run/);
    throws(() => parseCommand("res.partner"), /method/);
    throws(() => parseCommand("res.partner.search([)"), /Expected a value/);
    throws(() => parseCommand("res.partner.search([]).read(['name'])"), /Only one ORM call/);
    throws(() => parseCommand("res.partner.sudo().search([])"), /RPC/);
    throws(() => parseCommand("res.partner._read([])"), /private/);
    throws(() => parseCommand("res.partner.search(limit=1, [])"), /Positional argument follows keyword/);
    throws(() => parseCommand("res.partner.search('abc)"), /Unterminated string/);
    const e = throws(() => parseCommand("res.partner.search([]) extra"), /Unexpected/);
    eq(e.pos, 23, "error position");
});

test("pyRepr and formatCommand", () => {
    eq(pyRepr({ a: [1, true, null], b: "it's" }), `{'a': [1, True, None], 'b': "it's"}`);
    eq(formatCommand(parseCommand("res.partner.browse(1).with_context(lang='fr_FR').write({'name': 'X'})")),
        "res.partner.browse(1).with_context({'lang': 'fr_FR'}).write({'name': 'X'})");
    eq(formatCommand(parseCommand("x.y.search([], limit=2)")), "x.y.search([], limit=2)");
});

test("round trip: formatCommand output parses to the same command", () => {
    const src = "res.partner.browse([1, 2]).with_context(tz='UTC').read(['name', 'email'], load=None)";
    const a = parseCommand(src);
    eq(pick(parseCommand(formatCommand(a))), pick(a));
});

finish();
