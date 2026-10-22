import { format, doc } from "prettier";

const { join, hardline } = doc.builders;

const MARK = "// @@jtx ";
const USE_COMPLETE = /^use\s+(?:[\s\S]*?\s+from\s+)?(["'])[^"'\n]+\1\s*;?\s*$/;
const DECL = /^(\s*)(default\s+)?([A-Za-z_$][\w$]*)(\s*\([^)]*\)[^{;=]*\{\s*)$/;
const HOOK_HEAD =
  /^(\s*)(state|ref|id|deferred|context)(\s+)([A-Za-z_$][\w$]*)(.*)$/;

const NOT_DECL = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "else",
  "do",
  "try",
  "with",
]);

function scanLine(line, st) {
  let delta = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (st.block) {
      if (c === "*" && n === "/") {
        st.block = false;
        i++;
      }
      continue;
    }
    if (st.tpl) {
      if (c === "\\") i++;
      else if (c === "`") st.tpl = false;
      continue;
    }
    if (c === "/" && n === "*") {
      st.block = true;
      i++;
      continue;
    }
    if (c === "/" && n === "/") break;
    if (c === "`") {
      st.tpl = true;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) {
        if (line[j] === "\\") j++;
        j++;
      }
      i = j;
      continue;
    }
    if (c === "{") delta++;
    else if (c === "}") delta--;
  }
  return delta;
}

function toTsx(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const st = { block: false, tpl: false };
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const top = depth === 0 && !st.block && !st.tpl;

    if (top && /^use\s/.test(line)) {
      let stmt = line;
      while (!USE_COMPLETE.test(stmt) && i + 1 < lines.length)
        stmt += "\n" + lines[++i];
      stmt = stmt.replace(/^use\s+/, "import ").trimEnd();
      out.push(stmt.endsWith(";") ? stmt : stmt + ";");
      continue;
    }

    if (top && /^\s*@/.test(line)) {
      out.push(MARK + line.trim());
      continue;
    }

    if (top && line.trim() === "<variables>") {
      out.push(MARK + "<variables>", "{");
      while (i + 1 < lines.length && lines[i + 1].trim() !== "</variables>")
        out.push(lines[++i]);
      i++;
      out.push("}");
      continue;
    }

    if (top) {
      const sh = /^(\s*)share(\s+)([A-Za-z_$][\w$]*)(.*)$/.exec(line);
      if (sh) {
        const sm = /^\s*,\s*([A-Za-z_$][\w$]*)(.*)$/.exec(sh[4]);
        const name = sm ? sh[3] + "$$to$$" + sm[1] : sh[3];
        line = `${sh[1]}let $$share$${name}${sm ? sm[2] : sh[4]}`;
      }
    }

    if (top) {
      const m = DECL.exec(line);
      if (m && !NOT_DECL.has(m[3])) {
        line =
          m[1] + (m[2] ? "export default " : "") + "function $$" + m[3] + m[4];
      }
    }

    if (!top && depth >= 1 && !st.block && !st.tpl) {
      const h = HOOK_HEAD.exec(line);

      const sm =
        h && h[2] === "state"
          ? /^\s*,\s*([A-Za-z_$][\w$]*)(.*)$/.exec(h[5])
          : null;
      if (sm) {
        h[4] += "$$to$$" + sm[1];
        h[5] = sm[2];
      }
      if (
        h &&
        (h[2] === "id"
          ? /^\s*;?\s*(\/\/.*)?$/.test(h[5])
          : /^\s*(:|=(?!>)|;?\s*$|;?\s*\/\/)/.test(h[5]))
      ) {
        line = `${h[1]}let $$${h[2]}$${h[4]}${h[5]}`;
      }
    }

    out.push(line);
    depth += scanLine(line, st);
  }
  return out.join("\n");
}

function toJtx(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    if (l === MARK + "<variables>") {
      out.push("<variables>");
      if (lines[i + 1] === "{}") i++;
      else {
        i++;
        while (i + 1 < lines.length && lines[i + 1] !== "}")
          out.push(lines[++i]);
        i++;
      }
      out.push("</variables>");
      continue;
    }

    if (l.startsWith(MARK)) {
      out.push(l.slice(MARK.length));
      continue;
    }

    out.push(
      l
        .replace(
          /^(\s*)let \$\$(state|share)\$([A-Za-z_$][\w$]*?)\$\$to\$\$([A-Za-z_$][\w$]*)/,
          "$1$2 $3, $4",
        )
        .replace(
          /^(\s*)let \$\$(state|ref|id|deferred|context|share)\$/,
          "$1$2 ",
        )
        .replace(/^import\b/, "use")
        .replace(/^export default function \$\$/, "default ")
        .replace(/^function \$\$/, ""),
    );
  }
  return out.join("\n");
}

const PASS_OPTIONS = [
  "printWidth",
  "tabWidth",
  "useTabs",
  "semi",
  "singleQuote",
  "jsxSingleQuote",
  "quoteProps",
  "trailingComma",
  "bracketSpacing",
  "bracketSameLine",
  "arrowParens",
  "singleAttributePerLine",
];

export const languages = [
  {
    name: "JTX",
    parsers: ["jtx"],
    extensions: [".jtx"],
    vscodeLanguageIds: ["jtx"],
  },
];

export const parsers = {
  jtx: {
    astFormat: "jtx-ast",
    locStart: () => 0,
    locEnd: (node) => node.text.length,
    async parse(text, options) {
      const opts = {
        parser: "typescript",
        filepath: "file.tsx",
        endOfLine: "lf",
      };
      for (const k of PASS_OPTIONS)
        if (options[k] !== undefined) opts[k] = options[k];
      const formatted = await format(toTsx(text), opts);
      return { type: "jtx-root", text: toJtx(formatted) };
    },
  },
};

export const printers = {
  "jtx-ast": {
    print(path) {
      const lines = path.node.text.replace(/\n+$/, "").split("\n");
      return [join(hardline, lines), hardline];
    },
  },
};