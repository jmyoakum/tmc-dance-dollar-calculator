// Charlotte payout math tests. Run: node tests/charlotte-math.test.js
// No dependencies. Loads the math module straight out of each page's <script id="dd-core">.
var fs = require("fs"), path = require("path"), assert = require("assert");
var ROOT = path.join(__dirname, "..");
function coreOf(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").match(/<script id="dd-core">([\s\S]*?)<\/script>/)[1];
}
function load(file) { return new Function("module", coreOf(file) + "; return DD;")({}); }
var H = load("index.html"), C = load("charlotte/index.html");

var passed = 0;
function eq(actual, expected, name) { assert.deepStrictEqual(actual, expected, name); passed++; }

// 1. Same algorithm: with comments stripped, Charlotte's math differs from Houston's only in the price constants.
function code(src) { return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim(); }
eq(code(coreOf("charlotte/index.html")),
   code(coreOf("index.html")).replace("SMALL_CHARGE = 24, SMALL_REDEEM = 18, SMALL_PER_LARGE = 21",
                                      "SMALL_CHARGE = 25, SMALL_REDEEM = 20, SMALL_PER_LARGE = 25"),
   "Charlotte algorithm identical to Houston apart from prices");

// 2. Independent reference written from the confirmed rules R1-R8 (not copied from the page).
function reference(charge, redeem, perLarge) {
  function units(cents) {                                   // R1 redeemable target, R2 round up, R3 min one, R4 bump
    if (!(cents > 0)) return 0;
    var u = Math.max(1, Math.ceil(cents / (redeem * 100) - 1e-9));
    return u % perLarge === perLarge - 1 ? u + 1 : u;
  }
  function bills(u) { return { units: u, large: Math.floor(u / perLarge), small: u % perLarge, charge: u * charge, redeemable: u * redeem }; } // R5, R8
  return {
    ent: function (d, n) { var e = bills(units(Math.round(d * 100) / n)); return { each: e, total: [e.large * n, e.small * n, e.charge * n, e.redeemable * n] }; }, // R6
    srv: function (d, n) {                                  // R7 pool, spread, first servers get the extra
      var u = units(Math.round(d * 100)), out = [];
      for (var i = 0; i < n; i++) out.push(bills(Math.floor(u / n) + (i < u % n ? 1 : 0)));
      return out;
    }
  };
}
function check(DD, ref, label) {
  for (var c = 0; c <= 300000; c += (c < 3000 ? 1 : 97)) {   // every cent to $30, then a wide sweep to $3,000
    var d = c / 100;
    for (var n = 1; n <= 6; n++) {
      var g = DD.group(d, n), r = ref.ent(d, n);
      eq(g.each, r.each, label + " ent each $" + d + "/" + n);
      eq([g.all.large, g.all.small, g.all.charge, g.all.redeemable], r.total, label + " ent all $" + d + "/" + n);
      eq(DD.serverPool(d, n).people, ref.srv(d, n), label + " srv $" + d + "/" + n);
    }
  }
}
check(H, reference(24, 18, 21), "Houston");   // proves the reference captures Houston's rules
check(C, reference(25, 20, 25), "Charlotte"); // and Charlotte applies the same rules at Charlotte prices

// 3. Explicit cases.
function one(d) { var b = C.bundleFor(Math.round(d * 100)); return [b.large, b.small, b.units, b.redeemable, b.charge]; }
[ // amount -> [Large, Small, DD issued, redeemable, charge]
  [0, [0, 0, 0, 0, 0]], [0.01, [0, 1, 1, 20, 25]], [10, [0, 1, 1, 20, 25]], [20, [0, 1, 1, 20, 25]],
  [20.01, [0, 2, 2, 40, 50]], [30, [0, 2, 2, 40, 50]], [100, [0, 5, 5, 100, 125]], [460, [0, 23, 23, 460, 575]],
  [460.01, [1, 0, 25, 500, 625]], [480, [1, 0, 25, 500, 625]], [500, [1, 0, 25, 500, 625]],
  [500.01, [1, 1, 26, 520, 650]], [960, [1, 23, 48, 960, 1200]], [960.01, [2, 0, 50, 1000, 1250]],
  [980, [2, 0, 50, 1000, 1250]], [1000, [2, 0, 50, 1000, 1250]], [1180, [2, 9, 59, 1180, 1475]]
].forEach(function (t) { eq(one(t[0]), t[1], "single $" + t[0]); });

var s = C.group(500, 2);                                    // $500 split across two entertainers
eq([s.each.large, s.each.small, s.each.units, s.each.redeemable, s.each.charge], [0, 13, 13, 260, 325], "$500/2 each");
eq([s.all.large, s.all.small, s.all.redeemable, s.all.charge], [0, 26, 520, 650], "$500/2 all");
s = C.group(1000, 3);
eq([s.each.small, s.all.small, s.all.redeemable, s.all.charge], [17, 51, 1020, 1275], "$1000/3 not consolidated");
s = C.group(1000, 2);
eq([s.each.large, s.each.small, s.all.charge], [1, 0, 1250], "$1000/2 one Large each");

function pool(d, n) { return C.serverPool(d, n).people.map(function (p) { return [p.large, p.small]; }); }
eq(pool(20, 3), [[0, 1], [0, 0], [0, 0]], "server $20/3 (two servers get zero)");
eq(pool(100, 3), [[0, 2], [0, 2], [0, 1]], "server $100/3");
eq(pool(980, 2), [[1, 0], [1, 0]], "server $980/2 (pool bumped to 50)");
eq(pool(1000, 3), [[0, 17], [0, 17], [0, 16]], "server $1000/3");

var m = C.calculate(500, 2, 100, 3).total;                  // mixed entertainers + servers
eq([m.large, m.small, m.charge, m.redeemable], [0, 31, 775, 620], "mixed $500/2 + server $100/3");
m = C.calculate(480, 1, 980, 2).total;
eq([m.large, m.small, m.charge, m.redeemable], [3, 0, 1875, 1500], "mixed $480 + server $980/2");

// 4. Pricing scenarios (quantity form); markup = charge - redeemable is checked, never displayed.
[[1, 0, 625, 500, 125], [0, 1, 25, 20, 5], [2, 0, 1250, 1000, 250], [0, 5, 125, 100, 25], [3, 4, 1975, 1580, 395], [0, 0, 0, 0, 0]]
  .forEach(function (t) {
    var a = C.alloc(t[0] * 25 + t[1]);
    eq([a.large, a.small, a.charge, a.redeemable, a.charge - a.redeemable], [t[0], t[1], t[2], t[3], t[4]], "pricing " + t[0] + "L+" + t[1] + "S");
  });

// 5. Copy-to-clipboard heading: Charlotte names its location; Houston keeps its original format.
function count(file, text) { return fs.readFileSync(path.join(ROOT, file), "utf8").split(text).length - 1; }
eq(count("charlotte/index.html", 'var out = ["DANCE DOLLAR BREAKDOWN \u2014 CHARLOTTE", ""];'), 1, "Charlotte copy heading");
eq(count("index.html", 'var out = ["DANCE DOLLAR BREAKDOWN", ""];'), 1, "Houston copy heading unchanged");

console.log("charlotte-math: " + passed + " assertions passed");
