// Example patterns. Each one shows one idea about how stitch counts make shape.

export const PRESETS = [
  {
    id: 'ball',
    name: 'Ball',
    stuffing: 70,
    text: `# Amigurumi ball, 36 stitches around
color: pink
R1: mr, 6 sc (6)
R2: inc x6 (12)
R3: (sc, inc) x6 (18)
R4: (2 sc, inc) x6 (24)
R5: (3 sc, inc) x6 (30)
R6: (4 sc, inc) x6 (36)
R7-R12: sc around (36)
R13: (4 sc, dec) x6 (30)
R14: (3 sc, dec) x6 (24)
R15: (2 sc, dec) x6 (18)
R16: (sc, dec) x6 (12)
R17: dec x6 (6)
FO, close the hole
`,
  },
  {
    id: 'coaster',
    name: 'Coaster',
    stuffing: 0,
    text: `# Flat circle: add 6 sc every round
color: sandybrown
R1: mr, 6 sc (6)
R2: inc x6 (12)
R3: (sc, inc) x6 (18)
R4: (2 sc, inc) x6 (24)
R5: (3 sc, inc) x6 (30)
R6: (4 sc, inc) x6 (36)
R7: (5 sc, inc) x6 (42)
R8: (6 sc, inc) x6 (48)
`,
  },
  {
    id: 'basket',
    name: 'Basket',
    stuffing: 0,
    text: `# Flat base, then no increases: the sides go straight up
color: darkseagreen
R1: mr, 6 sc (6)
R2: inc x6 (12)
R3: (sc, inc) x6 (18)
R4: (2 sc, inc) x6 (24)
R5: (3 sc, inc) x6 (30)
R6-R14: sc around (30)
`,
  },
  {
    id: 'beanie',
    name: 'Beanie',
    stuffing: 0,
    text: `# Crown in hdc (8 increases per round), then stripes
color: teal
R1: mr, 8 hdc (8)
R2: hdc inc x8 (16)
R3: (hdc, hdc inc) x8 (24)
R4: (2 hdc, hdc inc) x8 (32)
R5: (3 hdc, hdc inc) x8 (40)
R6: (4 hdc, hdc inc) x8 (48)
color: white
R7-R8: hdc around (48)
color: teal
R9-R10: hdc around (48)
color: white
R11-R12: hdc around (48)
color: teal
R13-R16: hdc around (48)
`,
  },
  {
    id: 'ruffle',
    name: 'Ruffle',
    stuffing: 0,
    text: `# Too many increases: the edge has no room, so it waves
color: orchid
R1: mr, 6 sc (6)
R2: inc x6 (12)
R3: (sc, inc) around (18)
R4: (sc, inc) around (27)
R5: (sc, inc) around (40)
R6: (sc, inc) around (60)
`,
  },
  {
    id: 'ruffle-cup',
    name: 'Ruffle cup',
    stuffing: 0,
    text: `# Letter symbols: F = dc, FV = 2 dc in one, X = sc, CH = chain, K = skip
color: pink
R1: mr, 12F (12)
R2: 12FV (24)
R3: 12(F, FV) (36)
R4: 12(2F, FV) (48)
R5: 48F (48)
R6: 21F, 6CH, K6, 21F (48)
R7: 48X (48)
R8: 48FV (96)
R9: 32(2F, FV) (128)
`,
  },
  {
    id: 'swatch',
    name: 'Swatch',
    stuffing: 0,
    text: `# Flat swatch, worked in rows
color: lightsteelblue
ch 11
Row 1: sc in 2nd ch from hook, sc x9, turn (10)
Row 2-12: ch 1, sc across, turn (10)
`,
  },
];
