// Pattern parser: turns human crochet pattern text into rows of operations.
//
// Output shape:
//   { rows: [{ label, line, src, items, declared }], terms, errors, notes }
// Each item is one of:
//   { k: 'st', type, take, same? }   one stitch; take = parent stitches used (0..3)
//   { k: 'ch', n }                   chains
//   { k: 'sk', n }                   skip parent stitches
//   { k: 'mr' }                      magic ring
//   { k: 'color', value }            change yarn color
//   { k: 'turn' } | { k: 'fo' }      markers
//   { k: 'group', items, times }     repeat a sequence a fixed number of times
//   { k: 'fill', items }             repeat a sequence until the row runs out of stitches

const NAMES_US = {
  'sc': 'sc', 'single crochet': 'sc',
  'hdc': 'hdc', 'half double crochet': 'hdc', 'half double': 'hdc',
  'dc': 'dc', 'double crochet': 'dc',
  'tr': 'tr', 'trc': 'tr', 'treble crochet': 'tr', 'treble': 'tr',
  'sl st': 'slst', 'slst': 'slst', 'ss': 'slst', 'slip stitch': 'slst',
};

const NAMES_UK = {
  'dc': 'sc', 'double crochet': 'sc',
  'htr': 'hdc', 'half treble crochet': 'hdc', 'half treble': 'hdc',
  'tr': 'dc', 'treble crochet': 'dc', 'treble': 'dc',
  'dtr': 'tr', 'double treble crochet': 'tr', 'double treble': 'tr',
  'sl st': 'slst', 'slst': 'slst', 'ss': 'slst', 'slip stitch': 'slst',
};

const ROW_WORD = '(?:rounds?|rnds?|rows?|r)';
const LABEL_RE = new RegExp(
  `^\\s*${ROW_WORD}\\s*\\.?\\s*(\\d+)(?:\\s*(?:-|–|—|to)\\s*(?:${ROW_WORD})?\\s*\\.?\\s*(\\d+))?\\s*[:.)\\-–—]?\\s*`, 'i');
const NUM_LABEL_RE = /^\s*(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?\s*:\s*/;
const FOUNDATION_RE = /^\s*(?:foundation|fdn|start|base)\s*(?:chain|row)?\s*:\s*/i;
const COUNT_RE = /(?:[([]\s*(\d+)\s*(?:sts?|stitches)?\s*[)\]]|[-–—=]\s*(\d+)\s*(?:sts?|stitches)?)\s*\.?\s*$/i;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function stitchAlternation(names) {
  return Object.keys(names).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
}

// Split a string at top-level commas or semicolons (ignores separators inside brackets).
export function splitTopLevel(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ',' || ch === ';') && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(t => t.trim()).filter(t => t.length);
}

function normalize(s) {
  return s.toLowerCase()
    .replace(/×/g, 'x')
    .replace(/\bstitch(es)?\b/g, 'st')
    .replace(/\bsts\b/g, 'st')
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}

// "*sc, inc* x6" -> "(sc, inc) x6". Only converts asterisk pairs that wrap words.
function starGroupsToParens(s) {
  return s.replace(/\*\s*([a-z][^*]*?)\s*\*/gi, '($1)');
}

function parseTimes(rest) {
  rest = rest.trim();
  if (rest === '') return { times: 1 };
  let m;
  if ((m = rest.match(/^(?:x|\*)\s*(\d+)(?:\s*times)?$/))) return { times: +m[1] };
  if ((m = rest.match(/^(\d+)\s*(?:x|times)$/))) return { times: +m[1] };
  if ((m = rest.match(/^(?:repeat\s+)?(\d+)\s*times$/))) return { times: +m[1] };
  if (/^(?:repeat\s+)?(?:around|across|to end|to the end|in each st around|all around)$/.test(rest)) return { fill: true };
  return null;
}

export class ItemParser {
  constructor(terms = 'us') {
    this.names = terms === 'uk' ? NAMES_UK : NAMES_US;
    const st = stitchAlternation(this.names);
    this.ST = st;
    this.re = {
      plain: new RegExp(`^(?:(\\d+)\\s*(?:x\\s*)?)?(${st})(?:\\s*(?:x|\\*)?\\s*(\\d+)(?:\\s*times)?)?$`),
      inNextN: new RegExp(`^(${st}) in (?:each of )?(?:the )?next (\\d+)(?: st| ch)?$`),
      inNext1: new RegExp(`^(${st}) in (?:the )?(?:next|following)(?: st| ch)?$`),
      inSame: new RegExp(`^(${st}) in (?:the )?same (?:st|place|ch)$`),
      cluster: new RegExp(`^(\\d+) ?(${st}) in (?:the )?(?:next|same|one|1|first|last|following)?(?: st| ch)?$`),
      inc: new RegExp(`^(?:(\\d+)\\s*(?:x\\s*)?)?(?:(${st})\\s*)?(?:inc|increase)(?:\\s*(?:x|\\*)?\\s*(\\d+)(?:\\s*times)?)?$`),
      dec: new RegExp(`^(?:(\\d+)\\s*(?:x\\s*)?)?(?:(${st})\\s*)?(invdec|inv dec|invisible dec|dec|decrease)(?:\\s*(?:x|\\*)?\\s*(\\d+)(?:\\s*times)?)?$`),
      tog: new RegExp(`^(?:(\\d+)\\s*(?:x\\s*)?)?(${st})\\s*(\\d)\\s*tog(?:\\s*(?:x|\\*)?\\s*(\\d+)(?:\\s*times)?)?$`),
    };
  }

  type(name) { return this.names[name]; }

  // Parse a comma-separated list of items.
  parseList(text) {
    const items = [];
    for (const raw of splitTopLevel(starGroupsToParens(text))) {
      const r = this.parseItem(raw);
      if (r.error) return { error: r.error };
      items.push(...r.items);
    }
    return { items };
  }

  parseItem(raw) {
    const s = normalize(raw);
    const bad = { error: `I do not know "${raw.trim()}".` };
    if (!s) return { items: [] };

    // Bracketed group: (sc, inc) x6, [sc, inc] around
    if (s[0] === '(' || s[0] === '[') {
      let depth = 0, end = -1;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '(' || s[i] === '[') depth++;
        if (s[i] === ')' || s[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) return { error: `A bracket is not closed in "${raw.trim()}".` };
      const inner = this.parseList(s.slice(1, end));
      if (inner.error) return inner;
      const t = parseTimes(s.slice(end + 1));
      if (!t) return { error: `I do not understand "${s.slice(end + 1).trim()}" after the brackets.` };
      if (t.fill) return { items: [{ k: 'fill', items: inner.items }] };
      return { items: [{ k: 'group', items: inner.items, times: t.times }] };
    }

    let m;
    // Magic ring, alone or combined: "mr", "mr 6 sc", "6 sc in mr"
    const MR = '(?:mr|magic ring|magic circle|mc|adjustable ring|ring)';
    if (new RegExp(`^${MR}$`).test(s)) return { items: [{ k: 'mr' }] };
    if ((m = s.match(new RegExp(`^(?:mr|magic ring|magic circle|mc|adjustable ring)\\s*:?\\s+(.+)$`)))) {
      const rest = this.parseItem(m[1]);
      return rest.error ? rest : { items: [{ k: 'mr' }, ...rest.items] };
    }
    if ((m = s.match(new RegExp(`^(.+?) (?:in|into) (?:the |a |an )?${MR}$`)))) {
      const rest = this.parseItem(m[1]);
      return rest.error ? rest : { items: [{ k: 'mr' }, ...rest.items] };
    }

    if (/^(?:fo|fasten off|finish off|f\/o)$/.test(s)) return { items: [{ k: 'fo' }] };
    if (/^(?:(?:fo|fasten off) (?:and )?)?(?:close|cinch|pull)(?: (?:the )?(?:hole|opening|it))?(?: closed| shut)?$/.test(s)) return { items: [{ k: 'close' }] };
    if (/^turn$/.test(s)) return { items: [{ k: 'turn' }] };
    if ((m = s.match(/^ch (\d+) (?:and )?turn$/))) return { items: [{ k: 'ch', n: +m[1] }, { k: 'turn' }] };

    if ((m = s.match(/^(?:color|colour|change to|switch to|cc to|cc|join)\s*:?\s*([#a-z0-9]+)(?: yarn)?$/))) {
      return { items: [{ k: 'color', value: m[1] }] };
    }

    if (/^(?:sl st|slst|ss) (?:in|into|to) (?:the )?(?:first|1st|top|beg)/.test(s)) {
      return { error: `Joined rounds ("${raw.trim()}") are not supported yet. Work in a continuous spiral and remove the join.` };
    }

    // "2 sc in each st around" = increase in every stitch
    if ((m = s.match(new RegExp(`^(\\d+) ?(${this.ST}) in (?:each|every) (?:st|ch)(?: around| across| to end)?$`)))) {
      return { items: [{ k: 'fill', items: incItems(this.type(m[2]), +m[1]) }] };
    }

    // "sc around", "sc in each st around", "inc around", "sc across"
    if ((m = s.match(/^(.+?)(?: in (?:each|every) (?:st|ch)(?: around| across| to end)?| (?:around|across|to end|to the end|all around))$/))) {
      const inner = this.parseItem(m[1]);
      if (inner.error) return inner;
      return { items: [{ k: 'fill', items: inner.items }] };
    }

    // "sc in 2nd ch from hook" = skip 1 chain, then 1 sc
    if ((m = s.match(new RegExp(`^(${this.ST}) in (?:the )?(\\d)(?:st|nd|rd|th) ch from (?:the )?hook$`)))) {
      const skip = +m[2] - 1;
      const out = skip > 0 ? [{ k: 'sk', n: skip }] : [];
      return { items: [...out, { k: 'st', type: this.type(m[1]), take: 1 }] };
    }

    // Skip
    if ((m = s.match(/^(?:sk|skip)(?: next)?(?: (\d+))?(?: (?:st|ch))?$/))) {
      return { items: [{ k: 'sk', n: m[1] ? +m[1] : 1 }] };
    }

    // Chain: "ch 5", "5 ch", "ch x5", "ch"
    if ((m = s.match(/^(?:(\d+)\s*)?(?:ch|chain)(?:\s*(?:x\s*)?(\d+))?$/))) {
      const n = (m[1] ? +m[1] : 1) * (m[2] ? +m[2] : 1);
      return { items: [{ k: 'ch', n }] };
    }

    const R = this.re;
    if ((m = s.match(R.inc))) {
      const reps = (m[1] ? +m[1] : 1) * (m[3] ? +m[3] : 1);
      const type = m[2] ? this.type(m[2]) : 'sc';
      return { items: repeat(incItems(type, 2), reps) };
    }
    if ((m = s.match(R.dec))) {
      const reps = (m[1] ? +m[1] : 1) * (m[4] ? +m[4] : 1);
      const type = m[2] ? this.type(m[2]) : 'sc';
      return { items: repeat([{ k: 'st', type, take: 2 }], reps) };
    }
    if ((m = s.match(R.tog))) {
      const take = +m[3];
      if (take < 2 || take > 5) return bad;
      const reps = (m[1] ? +m[1] : 1) * (m[4] ? +m[4] : 1);
      return { items: repeat([{ k: 'st', type: this.type(m[2]), take }], reps) };
    }
    if ((m = s.match(R.inNextN))) {
      return { items: repeat([{ k: 'st', type: this.type(m[1]), take: 1 }], +m[2]) };
    }
    if ((m = s.match(R.inNext1))) {
      return { items: [{ k: 'st', type: this.type(m[1]), take: 1 }] };
    }
    if ((m = s.match(R.inSame))) {
      return { items: [{ k: 'st', type: this.type(m[1]), take: 0, same: true }] };
    }
    if ((m = s.match(R.cluster))) {
      const n = +m[1];
      if (n < 1 || n > 9) return bad;
      return { items: incItems(this.type(m[2]), n) };
    }
    if ((m = s.match(R.plain))) {
      const n = (m[1] ? +m[1] : 1) * (m[3] ? +m[3] : 1);
      return { items: repeat([{ k: 'st', type: this.type(m[2]), take: 1 }], n) };
    }
    return bad;
  }
}

function incItems(type, n) {
  const out = [{ k: 'st', type, take: 1 }];
  for (let i = 1; i < n; i++) out.push({ k: 'st', type, take: 0, same: true });
  return out;
}

function repeat(items, n) {
  if (n === 1) return items;
  return [{ k: 'group', items, times: n }];
}

// Parse a full pattern.
export function parsePattern(text) {
  const rows = [];
  const errors = [];
  const notes = [];
  let terms = 'us';
  let pendingColor = null;
  let parser = new ItemParser(terms);

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, li) => {
    const lineNo = li + 1;
    let line = rawLine.replace(/(#|\/\/).*$/, '').trim();
    if (!line) return;

    let m;
    if ((m = line.match(/^terms?\s*:?\s*(us|uk|american|british)\s*$/i))) {
      terms = /uk|brit/i.test(m[1]) ? 'uk' : 'us';
      parser = new ItemParser(terms);
      return;
    }
    if ((m = line.match(/^(?:colou?r|yarn)\s*:\s*([#a-z0-9]+)\s*$/i))) {
      pendingColor = m[1].toLowerCase();
      return;
    }

    let from = null, to = null, label = null;
    if ((m = line.match(LABEL_RE)) || (m = line.match(NUM_LABEL_RE))) {
      from = +m[1]; to = m[2] ? +m[2] : from;
      line = line.slice(m[0].length);
      if (to < from) { errors.push({ line: lineNo, msg: `The range ${from}-${to} goes backward.` }); return; }
      if (to - from > 200) { errors.push({ line: lineNo, msg: `The range ${from}-${to} is too long.` }); return; }
    } else if ((m = line.match(FOUNDATION_RE))) {
      label = 'Foundation';
      line = line.slice(m[0].length);
    }

    let declared = null;
    const cm = line.match(COUNT_RE);
    if (cm) {
      declared = +(cm[1] || cm[2]);
      line = line.slice(0, cm.index).trim().replace(/[,;.]$/, '').trim();
    }

    const parsed = parser.parseList(line);
    if (parsed.error) { errors.push({ line: lineNo, msg: parsed.error }); return; }
    let items = parsed.items;
    if (pendingColor) { items = [{ k: 'color', value: pendingColor }, ...items]; pendingColor = null; }

    // A line with only finishing steps ("FO, close the hole") belongs to the row before it.
    const finishing = items.length && items.every(i => i.k === 'fo' || i.k === 'close' || i.k === 'turn');
    if (from === null && label === null && finishing && rows.length) {
      const last = rows[rows.length - 1];
      rows[rows.length - 1] = { ...last, items: [...last.items, ...items] };
      return;
    }

    if (from === null) {
      rows.push({ label, line: lineNo, src: rawLine.trim(), items, declared });
    } else {
      for (let r = from; r <= to; r++) {
        rows.push({ label: String(r), line: lineNo, src: rawLine.trim(), items, declared });
      }
    }
  });

  return { rows, terms, errors, notes };
}
