"""One shared name normaliser for catalog, short-circuit levels, unifilares and archaeology (they all spell names differently)."""
import re
import unicodedata

_STOP = {"de", "del", "la", "las", "el", "los", "y", "zona", "arqueologica", "arqueologico", "sitio", "parque", "nacional", "subestacion", "se"}
_ABBR = {r"\bsta\b": "santa", r"\bsto\b": "santo", r"\bsn\b": "san", r"\bgral\b": "general", r"\bcd\b": "ciudad", r"\bpot\b": "potencia",
         r"\bdist\b": "distribucion", r"\bmpo\b": "municipio", r"\bedo\b": "estado"}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c))


def norm_name(s: str, drop_stop: bool = False) -> str:
    """lower-case, no accents, abbreviations expanded, punctuation to spaces; drop_stop also removes generic words."""
    t = strip_accents(s).lower()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    for a, b in _ABBR.items():
        t = re.sub(a, b, t)
    toks = [w for w in t.split() if not (drop_stop and w in _STOP)]
    return " ".join(toks)
