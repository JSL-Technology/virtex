"""Which kind of demand a series has — and therefore which models can fit it.

The Syntetos–Boylan scheme splits demand by how often it occurs (ADI: average interval between
non-zero days) and how much the non-zero quantities vary (CV²):

                 CV² < 0.49     CV² ≥ 0.49
    ADI < 1.32   smooth         erratic
    ADI ≥ 1.32   intermittent   lumpy

Smooth and erratic demand is what exponential smoothing and ARIMA were built for. Intermittent and
lumpy demand — the long tail of nearly every catalogue — breaks them: they forecast a small positive
number every day, which is wrong every day. Croston-family methods model the size and the interval
separately and are the standard for it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

ADI_CUTOFF = 1.32
CV2_CUTOFF = 0.49

#: Fewer days than this is a new product: too short for the backtest windows (3 × 28 days) plus a
#: month to fit on.
MIN_HISTORY_DAYS = 112


def classify(train: pd.DataFrame) -> pd.DataFrame:
    """unique_id → n_days, n_nonzero, adi, cv2, demand_class."""

    def stats(y: pd.Series) -> pd.Series:
        values = y.to_numpy(dtype=float)
        nonzero = values[values > 0]
        n = len(values)
        if len(nonzero) == 0:
            return pd.Series({"n_days": n, "n_nonzero": 0, "adi": np.inf, "cv2": 0.0})
        adi = n / len(nonzero)
        mean = nonzero.mean()
        cv2 = float((nonzero.std(ddof=0) / mean) ** 2) if mean > 0 else 0.0
        return pd.Series({"n_days": n, "n_nonzero": len(nonzero), "adi": adi, "cv2": cv2})

    out = train.groupby("unique_id")["y"].apply(stats).unstack().reset_index()
    out["n_days"] = out["n_days"].astype(int)
    out["n_nonzero"] = out["n_nonzero"].astype(int)

    def label(row: pd.Series) -> str:
        if row["n_nonzero"] == 0:
            return "dead"
        if row["n_days"] < MIN_HISTORY_DAYS:
            return "new"
        if row["adi"] < ADI_CUTOFF:
            return "smooth" if row["cv2"] < CV2_CUTOFF else "erratic"
        return "intermittent" if row["cv2"] < CV2_CUTOFF else "lumpy"

    out["demand_class"] = out.apply(label, axis=1)
    return out
