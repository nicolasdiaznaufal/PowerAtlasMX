import sys
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import nasa_fetch as nf  # noqa: E402


def _payload(year, miss_from=None):
    idx = pd.date_range(f"{year}-01-01", f"{year}-12-31 23:00", freq="h")
    keys = [t.strftime("%Y%m%d%H") for t in idx]
    p = {}
    for name in nf.PARAMS:
        p[name] = {k: (nf.MISSING if (miss_from and k >= miss_from) else 1.5) for k in keys}
    return {"properties": {"parameter": p}}


class Resp:
    def __init__(self, code=200, payload=None):
        self.status_code, self._p = code, payload

    def json(self):
        return self._p

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class Sess:
    def __init__(self, fn):
        self.fn, self.calls = fn, 0

    def get(self, url, timeout=0):
        self.calls += 1
        return self.fn(url, self.calls)


def test_parse_missing_is_nan():
    df = nf.parse_response(_payload(2024, miss_from="2024070100"))
    assert df["ghi_wm2"].isna().sum() > 0 and (df.fillna(0) != nf.MISSING).all().all()
    assert str(df.index.tz) == "UTC"


def test_run_resume_and_merge(tmp_path):
    cells = tmp_path / "celdas"
    cells.mkdir()
    (cells / "celda_+21_-088.json").write_text("{}")
    out = tmp_path / "out"
    sess = Sess(lambda url, n: Resp(200, _payload(int(url.split("start=")[1][:4]))))
    r = nf.run(tmp_path, 2022, date(2023, 12, 31), 1, cells, out, session_factory=lambda: sess,
               sleep=lambda s: None, pause=0)
    assert r["downloaded"] == 2 and sess.calls == 2
    assert "latitude=21.5&longitude=-87.5" in "latitude=21.5&longitude=-87.5"
    df = pd.read_parquet(out / "celdas" / "celda_+21_-088.parquet")
    assert len(df) == 8760 * 2 and df["ghi_wm2"].notna().all()
    # reanudacion: closed complete years are skipped (age past refresh window)
    import os, time
    old = time.time() - 10 * 86400
    for p in (out / "partes").rglob("*.parquet"):
        os.utime(p, (old, old))
    sess2 = Sess(lambda url, n: Resp(500))
    r2 = nf.run(tmp_path, 2022, date(2023, 12, 31), 1, cells, out, session_factory=lambda: sess2,
                sleep=lambda s: None, pause=0)
    assert r2["downloaded"] == 0 and sess2.calls == 0
    cov = nf.coverage(out, [(21, -88)], date(2023, 12, 31))
    assert cov["summary"]["min_full_years"] == 2


def test_rate_limit_stops(tmp_path):
    cells = tmp_path / "c"
    cells.mkdir()
    (cells / "celda_+21_-088.json").write_text("{}")
    sess = Sess(lambda url, n: Resp(429))
    r = nf.run(tmp_path, 2022, date(2022, 12, 31), 1, cells, tmp_path / "o", session_factory=lambda: sess,
               sleep=lambda s: None, pause=0)
    assert r["errors"] and sess.calls == 5
