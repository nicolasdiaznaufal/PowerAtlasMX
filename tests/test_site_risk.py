"""site_risk: known cases (Teotihuacan, Sonora desert), synthetic indigenous locality, ITER DMS parser."""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import indig_layer  # noqa: E402
import site_risk  # noqa: E402

CFG = json.loads((ROOT / "config/site_risk.json").read_text())


def test_dms_parser_known_localities():
    # Mexico City Zocalo ~ 19.4326N 99.1332W; Teotihuacan 19.6925N 98.8438W; Hermosillo 29.0729N 110.9559W
    for txt, ref in [("099°07'59\"W", -99.1331), ("098°50'38\"W", -98.8439), ("110°57'21\"W", -110.9558), ("19°41'33\"N", 19.6925)]:
        assert indig_layer.dms_to_deg(txt) == pytest.approx(ref, abs=2e-3)
    assert indig_layer.dms_to_deg("N/D") is None and indig_layer.dms_to_deg("*") is None


def _idx(lat, lon, pop=1000):
    df = pd.DataFrame({"lat": [lat], "lon": [lon], "ind": [pop], "is_ind": [True]})
    return indig_layer.IndigIndex(df, CFG["indig"])


def test_indigenous_penalises_inside_5km_not_beyond():
    lat0, lon0 = 20.0, -100.0
    ix = _idx(lat0, lon0)
    near = ix.risk(ix.metrics(lat0 + 3 / 111.2, lon0))   # 3 km away
    far = ix.risk(ix.metrics(lat0 + 6 / 111.2, lon0))    # 6 km away
    assert near > 0.2 and far == 0.0


@pytest.mark.skipif(not (ROOT / "data/ref/geo/arqueologia/sitios.csv").exists(), reason="no archaeology layer")
def test_teotihuacan_and_sonora():
    r = site_risk.risk_for_points([{"key": "teo", "lat": 19.6925, "lon": -98.8438},
                                   {"key": "son", "lat": 30.5, "lon": -113.0}])
    assert r["teo"]["metrics"]["dist_arch_km"] < 1.0 and r["teo"]["components"]["arch"] <= 0.06
    assert r["son"]["components"]["arch"] > 0.9
