"""Read the frontend's hand-written TypeScript API types, so tests can check real responses against them.

Understands the subset those files use: object literals, `A & B` intersections, `T[]` and `Array<T>`,
optional keys (`key?:`), `| null`, and references to other exported types. Anything else (string unions,
Record<...>, indexed types like Enrollment["status"]) is treated as an opaque value.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path

CLIENT_SRC = Path(__file__).resolve().parents[2] / "client" / "src"
TYPE_FILES = ("types/user.ts", "types/forum.ts", "types/admin.ts", "lib/api.ts")


@dataclass
class Shape:
    kind: str  # "object", "array", "number", "string", "boolean" or "any"
    nullable: bool = False
    fields: dict = field(default_factory=dict)  # object: key -> (optional, Shape)
    item: "Shape | None" = None  # array element


def _strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def _split_top(text, sep):
    """Split on `sep` where it isn't nested inside {}, (), [] or <>."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch in "{([<":
            depth += 1
        elif ch in "})]>":
            depth -= 1
        elif depth == 0 and text.startswith(sep, i):
            parts.append(text[start:i])
            start = i + len(sep)
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def _exported_types():
    """name -> (type parameters, type expression text), for every `export type Name<T> = ...;`."""
    sources = {}
    for rel in TYPE_FILES:
        text = _strip_comments((CLIENT_SRC / rel).read_text())
        for match in re.finditer(r"^export type (\w+)(?:<([\w, ]+)>)? = ", text, flags=re.M):
            start, depth, i = match.end(), 0, match.end()
            while i < len(text):
                ch = text[i]
                if ch in "{([<":
                    depth += 1
                elif ch in "})]>":
                    depth -= 1
                elif ch == ";" and depth == 0:
                    break
                i += 1
            params = [p.strip() for p in (match.group(2) or "").split(",") if p.strip()]
            sources[match.group(1)] = (params, text[start:i].strip())
    return sources


class TypeScriptTypes:
    def __init__(self):
        self.sources = _exported_types()

    def __getitem__(self, name):
        return self.parse(self.sources[name][1])

    def parse(self, expr):
        expr = expr.strip()
        alternatives = _split_top(expr, "|")
        nullable = any(a in ("null", "undefined") for a in alternatives)
        alternatives = [a for a in alternatives if a not in ("null", "undefined")]
        if len(alternatives) != 1:
            return Shape("any", nullable)  # a union of literals, e.g. "student" | "admin"
        shape = self._parse_single(alternatives[0])
        shape.nullable = shape.nullable or nullable
        return shape

    def _parse_single(self, expr):
        if expr.startswith("(") and expr.endswith(")"):
            return self.parse(expr[1:-1])
        if expr.endswith("[]"):
            return Shape("array", item=self.parse(expr[:-2]))
        if expr.startswith("Array<") and expr.endswith(">"):
            return Shape("array", item=self.parse(expr[6:-1]))
        parts = _split_top(expr, "&")
        if len(parts) > 1:
            merged = Shape("object")
            for part in parts:
                merged.fields.update(self.parse(part).fields)
            return merged
        if expr.startswith("{"):
            return self._parse_object(expr[1:-1])
        if expr in ("number", "string", "boolean"):
            return Shape(expr)
        if re.fullmatch(r"\w+", expr) and expr in self.sources:
            return self[expr]
        generic = re.fullmatch(r"(\w+)<(.+)>", expr, flags=re.S)
        if generic and generic.group(1) in self.sources:
            params, body = self.sources[generic.group(1)]
            for param, arg in zip(params, _split_top(generic.group(2), ",")):
                body = re.sub(rf"\b{param}\b", f"({arg})", body)
            return self.parse(body)
        return Shape("any")

    def _parse_object(self, body):
        shape = Shape("object")
        for member in _split_top(body.replace("\n", ";"), ";"):
            key, _, type_expr = member.partition(":")
            key = key.strip()
            optional = key.endswith("?")
            shape.fields[key.rstrip("?")] = (optional, self.parse(type_expr))
        return shape


_PRIMITIVES = {"number": (int, float), "string": (str,), "boolean": (bool,)}


def mismatches(value, shape, path="response"):
    """Ways `value` (decoded JSON) doesn't match `shape`, as readable strings."""
    if value is None:
        return [] if shape.nullable or shape.kind == "any" else [f"{path} is null but the type doesn't allow null"]
    if shape.kind == "any":
        return []
    if shape.kind in _PRIMITIVES:
        ok = isinstance(value, _PRIMITIVES[shape.kind]) and not (shape.kind == "number" and isinstance(value, bool))
        return [] if ok else [f"{path} should be a {shape.kind}, got {type(value).__name__} {value!r}"]
    if shape.kind == "array":
        if not isinstance(value, list):
            return [f"{path} should be an array, got {type(value).__name__}"]
        return [m for i, item in enumerate(value[:3]) for m in mismatches(item, shape.item, f"{path}[{i}]")]
    if not isinstance(value, dict):
        return [f"{path} should be an object, got {type(value).__name__}"]
    problems = [f"{path}.{key} is in the response but not in the TypeScript type" for key in value if key not in shape.fields]
    for key, (optional, field_shape) in shape.fields.items():
        if key not in value:
            if not optional:
                problems.append(f"{path}.{key} is required by the TypeScript type but missing from the response")
            continue
        problems.extend(mismatches(value[key], field_shape, f"{path}.{key}"))
    return problems
