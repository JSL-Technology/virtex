import json

import pytest

from virtex_ai_engine import benchmark
from virtex_ai_engine.forecasting import exogenous


@pytest.fixture(scope="module")
def synthetic():
    return benchmark.synthetic_history(n_series=40, days=400, seed=1)


def _builder(prices, products, branch_of):
    def build(train, horizon):
        return exogenous.build(train, prices[prices["day"] <= train["ds"].max()], products, branch_of, "DO", horizon)

    return build


def test_every_candidate_is_scored_or_reported_as_skipped(synthetic):
    train, prices, products = synthetic
    branch_of = {u: "b" for u in train["unique_id"].unique()}
    scores = benchmark.run_benchmark(
        train, horizon=14, windows=1, candidates=["seasonal_naive", "lightgbm", "lightgbm_exog", "catboost"],
        exog_builder=_builder(prices, products, branch_of), country="DO",
    )
    by_name = {s.candidate: s for s in scores}
    assert set(by_name) == {"seasonal_naive", "lightgbm", "lightgbm_exog", "catboost"}
    for score in scores:
        assert score.status in {"ok", "skipped"}
        if score.status == "skipped":
            assert score.note
    # Ranked best first; what is skipped goes last.
    ok = [s for s in scores if s.status == "ok"]
    assert [s.wape for s in ok] == sorted(s.wape for s in ok)
    # The baseline's MASE is close to 1 by construction; a learned model must beat it.
    naive = by_name["seasonal_naive"]
    assert 0.7 < naive.mase < 1.4
    assert by_name["lightgbm_exog"].status == "ok"
    assert by_name["lightgbm_exog"].wape < naive.wape


def test_a_failing_candidate_does_not_end_the_run(synthetic, monkeypatch):
    train, _, _ = synthetic

    def broken(*_):
        raise ValueError("boom")

    monkeypatch.setitem(benchmark.CANDIDATES, "prophet", broken)
    scores = benchmark.run_benchmark(train, horizon=7, windows=2, candidates=["prophet", "seasonal_naive"])
    by_name = {s.candidate: s for s in scores}
    assert by_name["prophet"].status == "skipped" and "boom" in by_name["prophet"].note
    assert by_name["seasonal_naive"].status == "ok"
    assert scores[-1].candidate == "prophet"


def test_cli_writes_a_json_report(tmp_path, monkeypatch):
    original = benchmark.synthetic_history
    monkeypatch.setattr(benchmark, "synthetic_history", lambda: original(n_series=6, days=120))
    out = tmp_path / "report.json"
    assert benchmark.main(["--synthetic", "--horizon", "7", "--windows", "1", "--candidates", "seasonal_naive",
                           "--output", str(out)]) == 0
    report = json.loads(out.read_text())
    assert report["series"] == 6 and report["scores"][0]["candidate"] == "seasonal_naive"


def test_unknown_candidates_are_rejected():
    with pytest.raises(SystemExit):
        benchmark.main(["--synthetic", "--candidates", "gpt"])
