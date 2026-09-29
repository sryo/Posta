// The CSS named colours, less `transparent` and `currentcolor`, which name no
// hue and stay allowed everywhere.
const NAMED = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue
blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink
indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen`.split(/\s+/);

// A literal colour in a CSS value: a hex, a colour function or a named colour.
// Quoted strings and custom property names are skipped, so `content: "red"`
// and `var(--hue-red)` don't count.
const CSS_LITERAL = new RegExp(
  String.raw`#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:${NAMED.join("|")})(?![\w-])`,
  "i",
);

export function cssColorLiteral(value: string): string | null {
  return CSS_LITERAL.exec(value.replace(/"[^"]*"|'[^']*'/g, '""'))?.[0] ?? null;
}

// A literal colour in script: a hex or a colour function inside a string.
const SCRIPT_LITERAL = /["'`][^"'`]*?(#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\()/;

export function scriptColorLiteral(line: string): string | null {
  return SCRIPT_LITERAL.exec(line)?.[1] ?? null;
}
