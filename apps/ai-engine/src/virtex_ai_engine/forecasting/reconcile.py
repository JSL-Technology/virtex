"""Making product, branch and company forecasts agree — and better.

A forecast per product and warehouse, summed, gives a branch total; a forecast of the branch total
made directly gives another number. Neither is right on its own: the product-level series are noisy,
the branch-level one hides the mix. MinT reconciliation (Wickramasuriya, Athanasopoulos & Hyndman,
2019) combines forecasts at every level — company, branch, series — into one coherent set whose
levels add up, and which is on average more accurate than any single level. `wls_struct` weights by
the hierarchy's structure alone, which needs no in-sample residuals and is stable on intermittent
demand.

The bands are carried across: each series keeps the width its backtest earned, around the
reconciled median.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

#: Above this many series the sparse solve is still fine, but the gain no longer justifies the time.
MAX_SERIES = 20_000


def reconcile(train: pd.DataFrame, forecasts: pd.DataFrame, branch_of: dict[str, str]) -> tuple[pd.DataFrame, bool]:
    """Returns the forecasts with a reconciled p50 (bands shifted with it), and whether it applied."""
    uids = forecasts["unique_id"].unique()
    if len(uids) < 2 or len(uids) > MAX_SERIES:
        return forecasts, False
    try:
        from hierarchicalforecast.core import HierarchicalReconciliation
        from hierarchicalforecast.methods import MinTraceSparse
        from hierarchicalforecast.utils import aggregate
        from statsforecast import StatsForecast
        from statsforecast.models import AutoETS

        horizon = int(forecasts.groupby("unique_id").size().max())
        data = train[train["unique_id"].isin(uids)].copy()
        data["total"] = "total"
        data["branch"] = data["unique_id"].map(branch_of).fillna("none").astype(str)
        data["series"] = data["unique_id"]
        data = data.drop(columns="unique_id")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y_agg, s_matrix, tags = aggregate(
                data, spec=[["total"], ["total", "branch"], ["total", "branch", "series"]], sparse_s=True
            )
            upper = list(tags["total"]) + list(tags["total/branch"])
            upper_fc = StatsForecast(models=[AutoETS(season_length=7, alias="base")], freq="D").forecast(
                df=y_agg[y_agg["unique_id"].isin(upper)], h=horizon
            )

        bottom_id = {uid.split("/", 2)[2]: uid for uid in tags["total/branch/series"]}
        # A series forecast without history in `train` has no place in the hierarchy; it is left as is.
        bottom = forecasts.loc[forecasts["unique_id"].isin(bottom_id.keys()), ["unique_id", "ds", "p50"]].copy()
        bottom["unique_id"] = bottom["unique_id"].map(bottom_id)
        bottom = bottom.rename(columns={"p50": "base"})
        y_hat = pd.concat([upper_fc[["unique_id", "ds", "base"]], bottom], ignore_index=True)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            reconciled = HierarchicalReconciliation([MinTraceSparse(method="wls_struct")]).reconcile(
                Y_hat_df=y_hat, S_df=s_matrix, tags=tags
            )
        column = [c for c in reconciled.columns if c.startswith("base/")][0]
        rec = reconciled[reconciled["unique_id"].isin(bottom_id.values())][["unique_id", "ds", column]]
        rec["unique_id"] = rec["unique_id"].str.split("/", n=2).str[2]
        rec = rec.rename(columns={column: "p50_rec"})

        out = forecasts.merge(rec, on=["unique_id", "ds"], how="left")
        ok = out["p50_rec"].notna() & np.isfinite(out["p50_rec"])
        shift = np.where(ok, out["p50_rec"].clip(lower=0) - out["p50"], 0.0)
        out["p50"] = out["p50"] + shift
        out["p10"] = (out["p10"] + shift).clip(lower=0)
        out["p90"] = (out["p90"] + shift).clip(lower=0)
        # A series with no demand stays at zero: reconciliation must not invent sales for it.
        dead = out["model"] == "NoDemand"
        out.loc[dead, ["p10", "p50", "p90"]] = 0.0
        return out.drop(columns="p50_rec"), True
    except Exception:  # noqa: BLE001 — reconciliation improves forecasts; it must never lose them
        log.exception("hierarchical reconciliation failed; keeping base forecasts")
        return forecasts, False
